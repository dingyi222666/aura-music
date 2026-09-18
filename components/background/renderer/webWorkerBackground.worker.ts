import { Mesh, SIDE, prepare, palette, points, type Color } from "./mesh";
import { compose, crease } from "./composition";
import { Motion } from "./motion";
import { Blur } from "./postprocess";
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

const VERTEX = `#version 300 es
in vec2 uv;
out vec2 texcoord;
out vec3 pigment;
uniform vec3 colors[16];
uniform vec2 aspect;
uniform vec2 surface[64];
uniform vec4 foldA;
uniform vec3 foldB;
vec4 basis(float t) {
  return vec4(2.0 * t * t * t - 3.0 * t * t + 1.0,
    -2.0 * t * t * t + 3.0 * t * t,
    t * t * t - 2.0 * t * t + t,
    t * t * t - t * t);
}
vec2 surfaceAt(vec2 point) {
  float gx = clamp(point.x * 3.0, 0.0, 3.0);
  float gy = clamp(point.y * 3.0, 0.0, 3.0);
  int cx = min(2, int(floor(gx)));
  int cy = min(2, int(floor(gy)));
  vec4 bx = basis(gx - float(cx));
  vec4 by = basis(gy - float(cy));
  vec2 result = vec2(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      int p = (cy + j) * 4 + cx + i;
      vec2 pos = surface[p * 4];
      vec2 du = surface[p * 4 + 1];
      vec2 dv = surface[p * 4 + 2];
      vec2 duv = surface[p * 4 + 3];
      result += pos * bx[i] * by[j] + du * bx[i + 2] * by[j] +
        dv * bx[i] * by[j + 2] + duv * bx[i + 2] * by[j + 2];
    }
  }
  return result;
}
float foldAmount(float y) {
  float d = (y - foldB.x) / foldB.y;
  float w = max(0.0, 1.0 - d * d);
  return foldA.z * w * w;
}
float foldX(float x, float y) {
  float amount = foldAmount(y);
  if (amount <= 0.0) return x;
  float center = foldA.x + foldA.y * (y - foldB.x) +
    foldB.z * ((y - foldB.x) / foldB.y) * ((y - foldB.x) / foldB.y);
  float left = amount * tanh(center / foldA.w);
  float right = 1.0 - amount * tanh((1.0 - center) / foldA.w);
  return (x - amount * tanh((x - center) / foldA.w) - left) / (right - left);
}
vec2 mapPoint(vec2 point) {
  float amount = min(1.0, foldAmount(point.y) / foldA.w);
  float blendAmount = amount * amount * (3.0 - 2.0 * amount) * 0.90;
  float x = clamp(foldX(point.x, point.y), 0.0, 1.0);
  vec2 curved = surfaceAt(vec2(x, point.y));
  curved = vec2(curved.x * 2.0 - 1.0, 1.0 - curved.y * 2.0);
  vec2 plane = vec2(x * 2.0 - 1.0, 1.0 - point.y * 2.0);
  return curved * (1.0 - blendAmount) + plane * blendAmount;
}
vec3 colorAt(vec2 point) {
  float gx = clamp(point.x * 3.0, 0.0, 3.0);
  float gy = clamp(point.y * 3.0, 0.0, 3.0);
  int cx = min(2, int(floor(gx)));
  int cy = min(2, int(floor(gy)));
  vec4 bx = basis(gx - float(cx));
  vec4 by = basis(gy - float(cy));
  vec3 result = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    result += colors[(cy + j) * 4 + cx + i] * bx[i] * by[j];
  }
  return result;
}
void main() {
  texcoord = uv;
  pigment = colorAt(uv);
  vec2 mapped = mapPoint(uv);
  gl_Position = vec4(mapped * 1.05 * aspect, 0.8 - uv.x * 1.6, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 texcoord;
in vec3 pigment;
out vec4 outputColor;
uniform float audio;
uniform float time;
uniform vec4 twists[2];
uniform sampler2D artwork;
uniform sampler2D previous;
uniform float blend;
uniform float coverage;
mat2 turn(float angle) {
  float s = sin(angle), c = cos(angle);
  return mat2(c, -s, s, c);
}
vec2 twist(vec2 uv, vec4 control) {
  vec2 delta = uv - control.xy;
  float falloff = max(0.0, 1.0 - length(delta) / control.z);
  return control.xy + turn(control.w * falloff * falloff) * delta;
}
vec3 cover(vec2 uv) {
  uv = 1.0 - abs(mod(uv, 2.0) - 1.0);
  return mix(texture(previous, uv).rgb, texture(artwork, uv).rgb, blend);
}
void main() {
  vec2 uv = texcoord;
  vec2 drift = vec2(sin(time * 0.13), cos(time * 0.11)) * vec2(0.10, 0.08);
  // One continuous artwork field supplies the large-scale composition. Broad
  // advection and bounded twists bend it without rotating the entire picture.
  vec2 flow = uv + vec2(
    sin(uv.y * 3.1 + time * 0.065),
    cos(uv.x * 2.8 - time * 0.055)
  ) * 0.14;
  flow = twist(flow, vec4(twists[0].xyz, twists[0].w * 0.55));
  flow = twist(flow, vec4(twists[1].xyz, twists[1].w * 0.4));
  // Reorient the full cover as it flows, changing which color regions meet.
  // The varying angular speed and local twists keep this from a rigid spin.
  float angle = time * 0.10 + sin(time * 0.16) * 0.42;
  vec2 center = vec2(0.5) + vec2(sin(time * 0.09), cos(time * 0.12)) * 0.06;
  vec3 image = cover(turn(angle) * (flow - center) * 1.15 + center + drift);
  float light = exp(-dot(uv - twists[0].xy, uv - twists[0].xy) * 8.0);
  // Final screen-space blur, exposure and dithering are applied after the
  // mesh is rasterized. Source color enhancement happens once at image upload.
  outputColor = vec4(mix(pigment, image, coverage) * (1.0 + audio * light * 0.08), 1.0);
}`;

const mesh = new Mesh();
const positions = points(0);
const twists = new Float32Array(8);
const seed = Math.floor(Math.random() * 0x7fffffff);
const creases = crease(0);
const motion = new Motion();
const signal: AudioEnvelope = { level: 0, bass: 0, onset: 0 };
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let blur: Blur | null = null;
let vertices: WebGLBuffer | null = null;
let indices: WebGLBuffer | null = null;
let vao: WebGLVertexArrayObject | null = null;
let uniform: WebGLUniformLocation | null = null;
let controls: WebGLUniformLocation | null = null;
let surface: WebGLUniformLocation | null = null;
let colorsUniform: WebGLUniformLocation | null = null;
let foldA: WebGLUniformLocation | null = null;
let foldB: WebGLUniformLocation | null = null;
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
  blur?.resize(gl.canvas.width, gl.canvas.height);
  gl.useProgram(program);
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
  // Shape and texture controls share a playback clock, preserving their phase
  // across pauses, visibility changes and cover transitions.
  crease(elapsed, creases, seed);
  // Keep the local fold's height bounded in screen space on wide displays too.
  const ratio = Math.max(1, gl.canvas.width / gl.canvas.height);
  const cy = 0.5 + (creases[4] - 0.5) / ratio;
  const ry = creases[5] / ratio;
  points(elapsed, 0, positions);
  compose(elapsed, twists);
  gl.useProgram(program);
  blur?.begin();
  gl.bindVertexArray(vao);
  gl.uniform2fv(surface, positions);
  gl.uniform3fv(colorsUniform, colors);
  gl.uniform4f(foldA, creases[0], creases[1], creases[2], creases[3]);
  gl.uniform3f(foldB, cy, ry, creases[6]);
  gl.uniform1f(uniform, motion.climax);
  gl.uniform4fv(controls, twists);
  gl.uniform1f(clock, elapsed);
  gl.uniform1f(mix, fade * fade * (3 - 2 * fade));
  gl.uniform1f(opacity, coverage);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, previous);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  blur?.draw();
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
    gl?.deleteVertexArray(vao);
    gl?.deleteBuffer(vertices);
    gl?.deleteBuffer(indices);
    gl?.deleteProgram(program);
    blur?.dispose();
    gl?.deleteTexture(texture);
    gl?.deleteTexture(previous);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    scope.close();
    return;
  }
  if (data.type === "init") {
    gl = data.canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 unavailable for mesh background");
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
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    const coords = new Float32Array(SIDE * SIDE * 2);
    for (let i = 0; i < SIDE * SIDE; i++) {
      coords[i * 2] = mesh.vertices[i * 7 + 5];
      coords[i * 2 + 1] = mesh.vertices[i * 7 + 6];
    }
    gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
    const uv = gl.getAttribLocation(program, "uv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    texture = upload(new Uint8ClampedArray([0, 0, 0, 255]), 1);
    previous = upload(new Uint8ClampedArray([0, 0, 0, 255]), 1);
    gl.uniform1i(gl.getUniformLocation(program, "artwork"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "previous"), 1);
    uniform = gl.getUniformLocation(program, "audio");
    controls = gl.getUniformLocation(program, "twists[0]");
    surface = gl.getUniformLocation(program, "surface[0]");
    colorsUniform = gl.getUniformLocation(program, "colors[0]");
    foldA = gl.getUniformLocation(program, "foldA");
    foldB = gl.getUniformLocation(program, "foldB");
    clock = gl.getUniformLocation(program, "time");
    aspect = gl.getUniformLocation(program, "aspect");
    mix = gl.getUniformLocation(program, "blend");
    opacity = gl.getUniformLocation(program, "coverage");
    indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.clearColor(0.008, 0.008, 0.01, 1);
    blur = new Blur(gl);
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
        const raw = ctx.getImageData(0, 0, 64, 64).data;
        const next = prepare(raw, 64);
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
