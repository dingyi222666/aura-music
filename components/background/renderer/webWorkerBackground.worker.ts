import { Mesh, prepare, palette, points, type Color } from "./mesh";
import { Motion } from "./motion";
import type { AudioEnvelope } from "@/services/audioEnvelope";

// Web worker scope is typed explicitly because the app also includes DOM types.
const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  requestAnimationFrame: (callback: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  close: () => void;
  onmessage: ((event: MessageEvent<Command>) => void) | null;
};

type Command =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; colors: string[] }
  | { type: "resize"; width: number; height: number }
  | { type: "colors"; colors: string[] }
  | { type: "play"; isPlaying: boolean }
  | { type: "pause"; paused: boolean }
  | ({ type: "audio" } & AudioEnvelope)
  | { type: "coverImage"; imageData: ImageBitmap }
  | { type: "snapshot" | "watchFrame"; id: number }
  | { type: "clearCover" }
  | { type: "dispose" };

const VERTEX = `
attribute vec2 position;
attribute vec3 color;
attribute vec2 uv;
varying vec2 texcoord;
varying vec3 pigment;
uniform vec2 aspect;
uniform vec2 orientation;
void main() {
  pigment = color;
  texcoord = uv;
  // Rotate the surface independently of the artwork. A constant diagonal
  // margin covers the viewport throughout a turn without rhythmic zooming.
  mat2 turn = mat2(orientation.y, -orientation.x, orientation.x, orientation.y);
  gl_Position = vec4(turn * position * 1.415 * aspect, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec3 pigment;
uniform float audio;
uniform vec2 highlight;
uniform vec2 rotation;
uniform vec3 tension;
uniform sampler2D artwork;
uniform sampler2D previous;
uniform float blend;
uniform float coverage;
varying vec2 texcoord;
vec2 extend(vec2 p) {
  p = 1.0 - abs(mod(p, 2.0) - 1.0);
  vec2 low = clamp(p / 0.10, 0.0, 1.0);
  vec2 high = clamp((1.0 - p) / 0.10, 0.0, 1.0);
  p = mix(p, 0.10 * low * low * (2.0 - low), step(p, vec2(0.10)));
  return mix(p, 1.0 - 0.10 * high * high * (2.0 - high), step(vec2(0.90), p));
}
vec3 cover(vec2 p) {
  return mix(texture2D(previous, p).rgb, texture2D(artwork, p).rgb, blend);
}
void main() {
  // A tiny static dither prevents visible bands in the darkest smooth regions.
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec2 q = texcoord - 0.5;
  float s = rotation.x, c = rotation.y;
  // Two offset views of the complete cover travel at different orientations.
  // Mirrored continuation avoids the solid strips produced by edge clamping.
  vec3 image = cover(extend(mat2(c, -s, s, c) * q * 2.0 + vec2(0.67, 0.62)));
  vec3 echo = cover(extend(mat2(s, -c, c, s) * q * 1.65 + vec2(0.29, 0.61)));
  // Broad neutral artwork regions should not wash out the entire surface.
  // Reveal another view through moving, curved regions of the same mesh.
  // All hues still come from the artwork, without a substituted palette.
  float chroma = max(image.r, max(image.g, image.b)) - min(image.r, min(image.g, image.b));
  // Briefly tighten one moving section of the contour, then let it relax.
  // A finite transition retains smooth edges without an outlined color block.
  vec2 offset = texcoord - tension.yz;
  float width = mix(0.35, 0.025, tension.x *
    (1.0 - smoothstep(0.025, 0.23, dot(offset, offset))));
  // One open curve, with a single crossing along its local normal. Unlike
  // multiplied waves, it cannot create crossing seams or enclosed islands.
  vec2 seam = mat2(c, -s, s, c) * q;
  float line = seam.y - (0.52 + s * 0.16) * seam.x * seam.x - 0.2 * seam.x - 0.03;
  float crossing = smoothstep(-width, width, line);
  float relief = 0.72 * (1.0 - smoothstep(0.08, 0.24, chroma));
  // Compose smooth weights instead of max(), which introduced extra creases
  // wherever the neutral-artwork correction met the main contour.
  image = mix(image, echo, relief + (1.0 - relief) * crossing);
  // Keep shading independent of hue and source luminance, preserving the
  // artwork's relative color areas. Elliptic falloff remains gentle at edges.
  float shade = 1.0 - 0.24 * smoothstep(0.08, 0.60, dot(q, q));
  // Light only a local color region in mesh coordinates. Its footprint bends
  // with the surface and ends along the existing crossing, not a screen-wide
  // exposure pulse or a separate circular spotlight.
  vec2 focus = mat2(c, -s, s, c) * (highlight - 0.5);
  // A single finite arc segment is the beat target. Its along-curve falloff
  // prevents a second spot or a screen-wide brightness pulse.
  float edge = exp(-pow(line / mix(0.12, 0.075, tension.x), 2.0));
  float along = exp(-pow((seam.x - focus.x) / 0.42, 2.0));
  float light = edge * along;
  vec3 color = mix(pigment, image, coverage) * shade * (1.0 + audio * light * 0.38);
  gl_FragColor = vec4(clamp(color + grain / 255.0, 0.0, 1.0), 1.0);
}`;

const mesh = new Mesh();
const positions = points(0);
const motion = new Motion();
const signal: AudioEnvelope = { level: 0, bass: 0, onset: 0 };
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let vertices: WebGLBuffer | null = null;
let indices: WebGLBuffer | null = null;
let uniform: WebGLUniformLocation | null = null;
let highlight: WebGLUniformLocation | null = null;
let rotation: WebGLUniformLocation | null = null;
let tension: WebGLUniformLocation | null = null;
let aspect: WebGLUniformLocation | null = null;
let orientation: WebGLUniformLocation | null = null;
let mix: WebGLUniformLocation | null = null;
let opacity: WebGLUniformLocation | null = null;
let texture: WebGLTexture | null = null;
let previous: WebGLTexture | null = null;
let pixels: Uint8ClampedArray | null = null;
let before: Uint8ClampedArray | null = null;
let fade = 1;
let coverage = 0;
let covered = false;
let frame = 0;
let last = 0;
let elapsed = 0;
let playing = false;
let paused = false;
let dirty = true;
let target = palette([]);
let origin = target.slice();
const colors = target.slice();
let transition = 1;
let signature = "";
let watches: number[] = [];

const parse = (input: string[]): Color[] => {
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  return input.map((color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#28222e";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map((v) => v / 255) as Color;
  });
};

const change = (next: Float32Array, immediate = false) => {
  origin = colors.slice();
  target = next;
  transition = immediate ? 1 : 0;
  if (immediate) colors.set(next);
};

const compile = (kind: number, source: string): WebGLShader => {
  const shader = gl!.createShader(kind)!;
  gl!.shaderSource(shader, source);
  gl!.compileShader(shader);
  if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
    const message = gl!.getShaderInfoLog(shader);
    gl!.deleteShader(shader);
    throw new Error(`Mesh shader: ${message}`);
  }
  return shader;
};

const upload = (pixels: Uint8ClampedArray, size: number): WebGLTexture => {
  const texture = gl!.createTexture()!;
  gl!.bindTexture(gl!.TEXTURE_2D, texture);
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, size, size, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  return texture;
};

const resize = (width: number, height: number) => {
  if (!gl) return;
  gl.canvas.width = Math.max(1, Math.round(width));
  gl.canvas.height = Math.max(1, Math.round(height));
  dirty = true;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  const ratio = gl.canvas.width / gl.canvas.height;
  gl.uniform2f(aspect, Math.max(1, 1 / ratio), Math.max(1, ratio));
};

const render = (now: number) => {
  if (!gl || !program) return;
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (!paused) {
    motion.step(dt, playing, signal);
    elapsed = motion.time;
    // Palette transitions use wall time, so selecting an album while paused
    // still updates the background. Motion uses a separate playback clock.
    transition = Math.min(1, transition + dt / 1.2);
    fade = Math.min(1, fade + dt / 1.2);
    coverage = Math.max(0, Math.min(1, coverage + (covered ? dt : -dt) / 0.8));
  }
  const blend = transition * transition * (3 - 2 * transition);
  for (let i = 0; i < colors.length; i++) colors[i] = origin[i] + (target[i] - origin[i]) * blend;
  // Shape evolution is subordinate to the turn, avoiding horizontal/vertical
  // sweeps that overpower the visible orbit of each color region.
  mesh.update(points(elapsed * 0.45, 0, positions), colors);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.vertices);
  gl.uniform1f(uniform, motion.climax);
  gl.uniform2f(highlight, 0.5 + 0.1 * Math.sin(elapsed * 0.08 + 0.6), 0.5 + 0.1 * Math.cos(elapsed * 0.061 + 1.4));
  gl.uniform2f(orientation, Math.sin(motion.angle), Math.cos(motion.angle));
  const swing = 0.22 * Math.sin(elapsed * 0.105) + 0.08 * Math.cos(elapsed * 0.067) - 0.08;
  gl.uniform2f(rotation, Math.sin(swing), Math.cos(swing));
  gl.uniform3f(tension,
    Math.pow(Math.max(0, Math.sin(elapsed * 0.29 - 0.7)), 4),
    0.5 + 0.2 * Math.sin(elapsed * 0.13 + 0.9),
    0.5 + 0.2 * Math.cos(elapsed * 0.17 - 0.4),
  );
  gl.uniform1f(mix, fade * fade * (3 - 2 * fade));
  gl.uniform1f(opacity, coverage);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, previous);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  dirty = false;
  for (const id of watches) scope.postMessage({ type: "frame", id });
  watches = [];
};

const loop = (now: number) => {
  const unsettled = transition < 1 || fade < 1 || coverage !== Number(covered);
  if ((!paused && (playing || unsettled || dirty)) || watches.length) render(now);
  else last = now;
  frame = scope.requestAnimationFrame(loop);
};

const snapshot = (id: number) => {
  if (!gl) return scope.postMessage({ type: "snapshot", id, bitmap: null });
  render(performance.now());
  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const bytes = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const data = new Uint8ClampedArray(bytes.length);
  for (let y = 0; y < h; y++) data.set(bytes.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return scope.postMessage({ type: "snapshot", id, bitmap: null });
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ type: "snapshot", id, bitmap }, [bitmap]);
};

scope.onmessage = ({ data }) => {
  if (data.type === "dispose") {
    scope.cancelAnimationFrame(frame);
    gl?.deleteBuffer(vertices);
    gl?.deleteBuffer(indices);
    gl?.deleteProgram(program);
    gl?.deleteTexture(texture);
    gl?.deleteTexture(previous);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    scope.close();
    return;
  }
  if (data.type === "init") {
    gl = data.canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL unavailable for mesh background");
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Mesh link failed");
    gl.useProgram(program);
    vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices.byteLength, gl.DYNAMIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    const color = gl.getAttribLocation(program, "color");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 28, 8);
    const uv = gl.getAttribLocation(program, "uv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 28, 20);
    texture = upload(new Uint8ClampedArray([0, 0, 0, 255]), 1);
    previous = upload(new Uint8ClampedArray([0, 0, 0, 255]), 1);
    gl.uniform1i(gl.getUniformLocation(program, "artwork"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "previous"), 1);
    uniform = gl.getUniformLocation(program, "audio");
    highlight = gl.getUniformLocation(program, "highlight");
    rotation = gl.getUniformLocation(program, "rotation");
    tension = gl.getUniformLocation(program, "tension");
    aspect = gl.getUniformLocation(program, "aspect");
    orientation = gl.getUniformLocation(program, "orientation");
    mix = gl.getUniformLocation(program, "blend");
    opacity = gl.getUniformLocation(program, "coverage");
    indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.clearColor(0.008, 0.008, 0.01, 1);
    resize(data.width, data.height);
    signature = data.colors.join("|");
    change(palette(parse(data.colors)), true);
    last = performance.now();
    frame = scope.requestAnimationFrame(loop);
    return;
  }
  if (data.type === "clearCover") { covered = false; return; }
  if (data.type === "resize") return resize(data.width, data.height);
  if (data.type === "play") { playing = data.isPlaying; return; }
  if (data.type === "pause") { paused = data.paused; last = performance.now(); return; }
  if (data.type === "audio") {
    for (const key of ["level", "bass", "onset"] as const) {
      signal[key] = Number.isFinite(data[key]) ? Math.max(0, Math.min(1, data[key])) : 0;
    }
    return;
  }
  if (data.type === "snapshot") return snapshot(data.id);
  if (data.type === "watchFrame") { watches.push(data.id); return; }
  if (data.type === "colors") {
    const key = data.colors.join("|");
    if (key !== signature) {
      signature = key;
      change(palette(parse(data.colors)));
    }
    return;
  }
  if (data.type === "coverImage") {
    try {
      const canvas = new OffscreenCanvas(64, 64);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(data.imageData, 0, 0, 64, 64);
        const next = prepare(ctx.getImageData(0, 0, 64, 64).data, 64);
        // Interrupted song transitions begin at the image currently on screen,
        // rather than jumping to the preceding track's fully resolved cover.
        if (pixels && before && fade < 1) {
          const amount = fade * fade * (3 - 2 * fade);
          pixels = pixels.map((value, i) => before![i] + (value - before![i]) * amount);
          gl?.deleteTexture(texture);
          texture = upload(pixels, 64);
        }
        gl?.deleteTexture(previous);
        previous = texture;
        before = pixels;
        pixels = next;
        texture = upload(next, 64);
        fade = covered ? 0 : 1;
        covered = true;
      }
    } finally {
      data.imageData.close();
    }
  }
};
