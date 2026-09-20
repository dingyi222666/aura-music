import { triangles, SIDE, palette, type Color } from "./mesh";
import { GEOMETRY } from "./geometry";
import { State } from "./state";
import { Motion } from "./motion";
import { Artwork } from "./artwork";
import { Frames } from "./frames";
import { Budget } from "./budget";
import type { AudioEnvelope } from "@aura-music/core/audioEnvelope";

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
  | { type: "beat"; enabled: boolean }
  | { type: "pause"; paused: boolean }
  | ({ type: "audio" } & AudioEnvelope)
  | { type: "coverImage"; imageData: ImageBitmap }
  | { type: "snapshot" | "watchFrame"; id: number }
  | { type: "clearCover" }
  | { type: "dispose" };

const VERTEX = `#version 300 es

out vec2 texcoord;
out vec2 offset;
layout(std140) uniform Controls { vec4 state[38]; };
#define mapping state[34]
uniform float coverage;
out vec3 pigment;
uniform vec3 colors[16];
uniform vec2 aspect;
#define foldA state[32]
#define foldB state[33].xyz
mat4x2 control(int i) {
  return mat4x2(state[i * 2].xy, state[i * 2].zw, state[i * 2 + 1].xy, state[i * 2 + 1].zw);
}
${GEOMETRY}
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
float region(vec2 screen, vec2 center, float radius) {
  vec2 d = (screen - center) * state[37].zw / radius;
  float w = max(0.0, 1.0 - dot(d, d));
  // Compact C2 falloff: outside these two neighborhoods the beat is zero.
  return w * w * w;
}
void main() {
  vec2 uv = vec2(gl_VertexID % ${SIDE}, gl_VertexID / ${SIDE}) / ${SIDE - 1}.0;
  // Rotation and drift are shared by the complete frame, not recomputed for
  // every mesh vertex. The surface itself still runs entirely on the GPU.
  mat2 turn = mat2(mapping.x, -mapping.y, mapping.y, mapping.x);
  texcoord = turn * (uv - vec2(0.23, 0.27)) + 0.5 + mapping.zw;
  pigment = coverage < 1.0 ? colorAt(uv) : vec3(0.0);
  vec2 mapped = mapPoint(uv);
  gl_Position = vec4(mapped * 1.05 * aspect, 0.8 - uv.x * 1.6, 1.0);
  vec2 screen = gl_Position.xy * 0.5 + 0.5;
  float weight = dot(state[35].xy, state[35].xy) > 0.00000001
    ? max(region(screen, state[36].xy, state[37].x), region(screen, state[36].zw, state[37].y) * 0.85)
    : 0.0;
  // Interpolate the smooth neighborhood mask with the existing mesh instead
  // of evaluating two distances and cubic falloffs for every fragment.
  offset = state[35].xy * weight;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 texcoord;
in vec2 offset;
in vec3 pigment;
out vec4 outputColor;
uniform sampler2D artwork;
uniform sampler2D previous;
uniform float blend;
uniform float coverage;
uniform vec2 resolution;
vec3 cover(vec2 uv) {
  // MIRRORED_REPEAT provides the same edge extension in the sampler.
  vec3 color = texture(artwork, uv).rgb;
  // The previous cover is only sampled while changing tracks.
  if (blend < 1.0) color = mix(texture(previous, uv).rgb, color, blend);
  return color;
}
void main() {
  vec3 color = pigment;
  if (coverage > 0.0) {
    vec3 image;
    if (dot(offset, offset) > 0.00000001) {
      image = (cover(texcoord + offset) + cover(texcoord - offset)) * 0.5;
    } else {
      image = cover(texcoord);
    }
    color = mix(pigment, image, coverage);
  }
  // Apply exposure in the same draw. The browser's compositor handles the
  // final upscale, removing a full-screen pass and its intermediate target.
  vec2 uv = gl_FragCoord.xy / resolution;
  float shade = mix(0.58, 0.78, smoothstep(0.0, 1.0, uv.y));
  shade -= 0.045 * smoothstep(0.18, 0.70, length(uv - 0.5));
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outputColor = vec4(color * shade + grain / 255.0, 1.0);
}`;

const topology = triangles();
const seed = Math.floor(Math.random() * 0x7fffffff);
const motion = new Motion();
const signal: AudioEnvelope = { level: 0, bass: 0, onset: 0 };
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let artwork: Artwork | null = null;
let state: State | null = null;
let fallback: WebGLTexture | null = null;
let indices: WebGLBuffer | null = null;
let vao: WebGLVertexArrayObject | null = null;
let colorsUniform: WebGLUniformLocation | null = null;
let aspect: WebGLUniformLocation | null = null;
let resolution: WebGLUniformLocation | null = null;
let mix: WebGLUniformLocation | null = null;
let opacity: WebGLUniformLocation | null = null;
let texture: WebGLTexture | null = null;
let previous: WebGLTexture | null = null;
let fade = 1;
let coverage = 0;
let covered = false;
let budget: Budget | null = null;
let width = 1;
let height = 1;
let scale = 1;
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
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.MIRRORED_REPEAT);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.MIRRORED_REPEAT);
  return texture;
};

const resize = (w: number, h: number) => {
  if (!gl) return;
  width = Math.max(1, w);
  height = Math.max(1, h);
  scale = budget?.scale ?? 1;
  // Keep the existing 768px mesh detail. Browser compositing performs the
  // same linear upscale without a second application-owned render target.
  const ratio = Math.min(1, 768 * scale / Math.max(width, height));
  const x = Math.max(1, Math.round(width * ratio));
  const y = Math.max(1, Math.round(height * ratio));
  if (gl.canvas.width !== x) gl.canvas.width = x;
  if (gl.canvas.height !== y) gl.canvas.height = y;
  dirty = true;
  gl.useProgram(program);
  gl.uniform2f(aspect, Math.max(1, height / width), Math.max(1, width / height));
  gl.uniform2f(resolution, x, y);
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
  state?.draw(elapsed, motion.pulse, width / height, motion.episode);
  gl.useProgram(program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(vao);
  gl.uniform3fv(colorsUniform, colors);
  gl.uniform1f(mix, fade * fade * (3 - 2 * fade));
  gl.uniform1f(opacity, coverage);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture ?? fallback);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, previous ?? texture ?? fallback);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, topology.length, gl.UNSIGNED_SHORT, 0);
  gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH]);
  // Crossfade inputs are no longer needed after the final transition frame.
  if (fade >= 1 && previous) {
    gl.deleteTexture(previous);
    previous = null;
  }
  if (!covered && coverage === 0 && texture) {
    gl.deleteTexture(texture);
    texture = null;
  }
  if (fade >= 1 && coverage === Number(covered)) artwork?.trim();
  dirty = false;
  for (const id of watches) scope.postMessage({ type: "frame", id });
  watches = [];
};

const frames = new Frames(scope,
  () => !!gl && ((!paused && (playing || transition < 1 || fade < 1 || coverage !== Number(covered) || dirty)) || watches.length > 0),
  (now) => {
    if (!budget?.begin(now)) return;
    if (scale !== budget.scale) resize(width, height);
    render(now);
    budget.end();
  },
);

const wake = () => {
  if (!frames.pending) last = performance.now();
  frames.wake();
};

const snapshot = async (id: number) => {
  if (!gl) return scope.postMessage({ type: "snapshot", id, bitmap: null });
  try {
    render(performance.now());
    // Let the browser copy the canvas; avoid two full-size CPU pixel buffers.
    const bitmap = await createImageBitmap(gl.canvas);
    scope.postMessage({ type: "snapshot", id, bitmap }, [bitmap]);
  } catch (error) {
    console.warn("Background snapshot failed", error);
    scope.postMessage({ type: "snapshot", id, bitmap: null });
  }
};

scope.onmessage = ({ data }) => {
  if (data.type === "dispose") {
    frames.stop();
    budget?.dispose();
    gl?.deleteVertexArray(vao);
    gl?.deleteBuffer(indices);
    gl?.deleteProgram(program);
    artwork?.dispose();
    state?.dispose();
    gl?.deleteTexture(fallback);
    gl?.deleteTexture(texture);
    gl?.deleteTexture(previous);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    scope.postMessage({ type: "disposed" });
    scope.close();
    return;
  }
  if (data.type === "init") {
    gl = data.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: "low-power" });
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
    fallback = upload(new Uint8ClampedArray([0, 0, 0, 255]), 1);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "Controls"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "artwork"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "previous"), 1);
    colorsUniform = gl.getUniformLocation(program, "colors[0]");
    aspect = gl.getUniformLocation(program, "aspect");
    resolution = gl.getUniformLocation(program, "resolution");
    mix = gl.getUniformLocation(program, "blend");
    opacity = gl.getUniformLocation(program, "coverage");
    indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topology, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.clearColor(0.008, 0.008, 0.01, 1);
    artwork = new Artwork(gl);
    state = new State(gl, seed);
    budget = new Budget(gl);
    resize(data.width, data.height);
    signature = data.colors.join("|");
    change(palette(parse(data.colors)), true);
    last = performance.now();
    wake();
    return;
  }
  if (data.type === "clearCover") { covered = false; wake(); return; }
  if (data.type === "resize") { resize(data.width, data.height); wake(); return; }
  if (data.type === "play") {
    playing = data.isPlaying;
    if (!playing) artwork?.trim();
    wake();
    return;
  }
  if (data.type === "beat") {
    if (!data.enabled) {
      signal.level = signal.bass = signal.onset = 0;
      motion.pulse = 0;
      dirty = true;
      wake();
    }
    return;
  }
  if (data.type === "pause") {
    paused = data.paused;
    if (paused) { frames.stop(); artwork?.trim(); }
    else wake();
    return;
  }
  if (data.type === "audio") {
    for (const key of ["level", "bass", "onset"] as const) {
      signal[key] = Number.isFinite(data[key]) ? Math.max(0, Math.min(1, data[key])) : 0;
    }
    return;
  }
  if (data.type === "snapshot") return snapshot(data.id);
  if (data.type === "watchFrame") { watches.push(data.id); wake(); return; }
  if (data.type === "colors") {
    const key = data.colors.join("|");
    if (key !== signature) {
      signature = key;
      change(palette(parse(data.colors)));
      wake();
    }
    return;
  }
  if (data.type === "coverImage") {
    try {
      if (gl && artwork) {
        const next = artwork.prepare(data.imageData);
        // Interrupted song transitions begin at the image currently on screen,
        // rather than jumping to the preceding track's fully resolved cover.
        if (covered && fade < 1 && previous && texture) {
          const amount = fade * fade * (3 - 2 * fade);
          const current = artwork.mix(previous, texture, amount);
          gl.deleteTexture(texture);
          texture = current;
        }
        gl.deleteTexture(previous);
        previous = covered ? texture : null;
        if (!covered) gl.deleteTexture(texture);
        texture = next;
        fade = previous ? 0 : 1;
        covered = true;
        dirty = true;
        wake();
      }
    } finally {
      data.imageData.close();
      if (!playing || paused) artwork?.trim();
    }
  }
};
