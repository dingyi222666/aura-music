import { Mesh, prepare, palette, points, type Color } from "./mesh";

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
  | { type: "audio"; level: number }
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
void main() {
  pigment = color;
  texcoord = uv;
  gl_Position = vec4(position * aspect, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec3 pigment;
uniform float audio;
uniform float time;
uniform sampler2D artwork;
uniform sampler2D previous;
uniform float blend;
uniform float coverage;
varying vec2 texcoord;
void main() {
  // A tiny static dither prevents visible bands in the darkest smooth regions.
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  // The cubic mesh defines the contours. Move the artwork through that mesh
  // with one rigid rotation, avoiding a second competing distortion field.
  vec2 q = texcoord - 0.5;
  float angle = time * 0.24;
  float s = sin(angle), c = cos(angle);
  vec2 p = mat2(c, -s, s, c) * q + 0.5;
  // Ease into edge extension with a continuous first derivative. This removes
  // the crease created by abruptly clamping a rotating texture coordinate.
  vec2 low = clamp(p / 0.10, 0.0, 1.0);
  vec2 high = clamp((1.0 - p) / 0.10, 0.0, 1.0);
  p = mix(p, 0.10 * low * low * (2.0 - low), step(p, vec2(0.10)));
  p = mix(p, 1.0 - 0.10 * high * high * (2.0 - high), step(vec2(0.90), p));
  vec3 image = mix(texture2D(previous, p).rgb, texture2D(artwork, p).rgb, blend);
  // Keep shading independent of hue and source luminance, preserving the
  // artwork's relative color areas. Elliptic falloff remains gentle at edges.
  float shade = 1.0 - 0.24 * smoothstep(0.08, 0.60, dot(q, q));
  vec3 color = mix(pigment, image, coverage) * shade * (1.0 + audio * 0.035);
  gl_FragColor = vec4(clamp(color + grain / 255.0, 0.0, 1.0), 1.0);
}`;

const mesh = new Mesh();
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let vertices: WebGLBuffer | null = null;
let indices: WebGLBuffer | null = null;
let uniform: WebGLUniformLocation | null = null;
let clock: WebGLUniformLocation | null = null;
let aspect: WebGLUniformLocation | null = null;
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
let level = 0;
let energy = 0;
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
    if (playing) elapsed += dt;
    const next = playing ? level : 0;
    energy += (next - energy) * (1 - Math.exp(-dt / (next > energy ? 0.12 : 0.55)));
    // Palette transitions use wall time, so selecting an album while paused
    // still updates the background. Motion uses a separate playback clock.
    transition = Math.min(1, transition + dt / 1.2);
    fade = Math.min(1, fade + dt / 1.2);
    coverage = Math.max(0, Math.min(1, coverage + (covered ? dt : -dt) / 0.8));
  }
  const blend = transition * transition * (3 - 2 * transition);
  for (let i = 0; i < colors.length; i++) colors[i] = origin[i] + (target[i] - origin[i]) * blend;
  mesh.update(points(elapsed, energy), colors);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.vertices);
  gl.uniform1f(uniform, energy);
  gl.uniform1f(clock, elapsed);
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
  const unsettled = transition < 1 || fade < 1 || energy > 0.0001 || coverage !== Number(covered);
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
    clock = gl.getUniformLocation(program, "time");
    aspect = gl.getUniformLocation(program, "aspect");
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
  if (data.type === "audio") { level = Number.isFinite(data.level) ? Math.max(0, Math.min(1, data.level)) : 0; return; }
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
