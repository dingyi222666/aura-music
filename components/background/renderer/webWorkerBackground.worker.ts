// ============================================================================
// Cover Background - Web Worker + WebGL
//
// The cover image is rendered directly as the background, then melted with a
// Kawase blur post-process. A full-screen shader applies slow swing rotation,
// safety zoom, noise UV displacement, saturation, overlay lift, and a final
// darkening pass. Song changes keep the existing texA/texB crossfade.
// ============================================================================

const defaultColors = [
  "rgb(60, 20, 80)",
  "rgb(100, 40, 60)",
  "rgb(20, 20, 40)",
  "rgb(40, 40, 90)",
];

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const FULLSCREEN_VS = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const KAWASE_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 uTexelSize;
uniform float uOffset;
void main() {
  vec2 p = uTexelSize * uOffset;
  vec4 color = texture2D(uTexture, vUv + vec2(-p.x, -p.y));
  color += texture2D(uTexture, vUv + vec2( p.x, -p.y));
  color += texture2D(uTexture, vUv + vec2(-p.x,  p.y));
  color += texture2D(uTexture, vUv + vec2( p.x,  p.y));
  gl_FragColor = color * 0.25;
}
`;

const MAIN_FS = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec2 uTexASize;
uniform vec2 uTexBSize;
uniform float uMix;
uniform vec2 uResolution;
uniform float uTime;

const float swing_period = 20.0;
const float PI = 3.14159265;

// 2D simplex noise from the MIT-licensed Ashima Arts implementation.
// Author: Ian McEwan, Ashima Arts.
// Also mirrored in pyalot/craftscape/simplex.shader; kept with attribution
// because this background uses the same simplex gradient math for UV flow.
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v, float noiseFactor) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0)) +
    i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return noiseFactor * dot(m, g);
}

vec3 saturateColor(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

float blendOverlayChannel(float base, float overlay) {
  return (base < 0.5)
    ? (2.0 * base * overlay)
    : (1.0 - 2.0 * (1.0 - base) * (1.0 - overlay));
}

vec3 blendOverlay(vec3 base, vec3 overlay) {
  return vec3(
    blendOverlayChannel(base.r, overlay.r),
    blendOverlayChannel(base.g, overlay.g),
    blendOverlayChannel(base.b, overlay.b)
  );
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

mat2 rot(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

vec2 coverUv(vec2 uv, vec2 size) {
  float screen = uResolution.x / uResolution.y;
  float image = size.x / size.y;
  vec2 st = uv;
  if (image > screen) {
    st.x = (uv.x - 0.5) * screen / image + 0.5;
  } else {
    st.y = (uv.y - 0.5) * image / screen + 0.5;
  }
  return st;
}

float swingProgress(float time) {
  float progress = mod(time, swing_period);
  float mid = swing_period * 0.5;
  if (progress < mid) {
    return (progress * 2.0 - mid) / mid;
  }
  return (swing_period - mid * 0.5 - progress) * 2.0 / mid;
}

vec2 movingUv(vec2 uv, vec2 size, float angle, float zoom) {
  float ratio = uResolution.x / uResolution.y;
  vec2 p = uv - 0.5;
  p.x *= ratio;
  p = rot(-angle) * p / zoom;
  p.x /= ratio;
  return coverUv(p + 0.5, size);
}

vec3 sampleCover(sampler2D tex, vec2 size, float angle, float zoom) {
  vec2 coord = movingUv(vUv, size, angle, zoom);
  float randV = rand(coord);
  vec2 st = coord + 4.0 / 480.0 * randV;
  st = clamp(st, 0.0, 1.0);

  float tmpTime = 0.6 * uTime;
  float dx = 0.065 * (
    sin(tmpTime) +
    cos(tmpTime * 0.8) +
    sin(tmpTime * 1.3) +
    cos(tmpTime * 1.5)
  );
  float dy = 0.065 * (
    cos(tmpTime * 1.4) +
    sin(tmpTime * 1.2) +
    cos(tmpTime * 0.8) +
    sin(tmpTime * 0.6)
  );
  float s = snoise(vec2(st.x + tmpTime * 0.1, st.y - tmpTime * 0.1), 530.0);
  st *= vec2(1.0 + 0.5 * s * dx, 1.0 + 0.5 * s * dy);

  return texture2D(tex, clamp(st, 0.0, 1.0)).rgb;
}

void main() {
  float tmpTime = uTime * 0.5;
  float maxAngle = (
    10.0 +
    sin(tmpTime * 1.1) +
    cos(tmpTime * 0.9) +
    sin(tmpTime * 1.25) +
    cos(tmpTime * 1.35)
  ) * 0.08;
  float angle = maxAngle * swingProgress(uTime);
  float ratio = uResolution.x / uResolution.y;
  float zoom = 1.28 + abs(sin(maxAngle)) * (0.2 + abs(ratio - 1.0) * 0.15);

  vec3 a = sampleCover(uTexA, uTexASize, angle, zoom);
  vec3 b = sampleCover(uTexB, uTexBSize, angle, zoom);
  vec3 color = mix(b, a, uMix);

  color = saturateColor(color, 1.2);
  vec3 overlayColor = blendOverlay(color, vec3(0.902, 0.902, 0.902));
  vec3 resColor = mix(color, overlayColor, 0.3);
  gl_FragColor = mix(vec4(resColor, 1.0), vec4(0.0, 0.0, 0.0, 1.0), 0.2);
}
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkerCommand {
  type: "init" | "resize" | "colors" | "play" | "pause" | "coverImage";
  canvas?: OffscreenCanvas;
  width?: number;
  height?: number;
  colors?: string[];
  isPlaying?: boolean;
  paused?: boolean;
  imageData?: ImageBitmap;
}

type Tex = {
  tex: WebGLTexture;
  w: number;
  h: number;
  cover: boolean;
};

type FBO = {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gl: WebGLRenderingContext | null = null;
let kawaseProg: WebGLProgram | null = null;
let mainProg: WebGLProgram | null = null;
let quadBuffer: WebGLBuffer | null = null;

let kawaseU_texture: WebGLUniformLocation | null = null;
let kawaseU_texelSize: WebGLUniformLocation | null = null;
let kawaseU_offset: WebGLUniformLocation | null = null;

let mainU_texA: WebGLUniformLocation | null = null;
let mainU_texB: WebGLUniformLocation | null = null;
let mainU_texASize: WebGLUniformLocation | null = null;
let mainU_texBSize: WebGLUniformLocation | null = null;
let mainU_mix: WebGLUniformLocation | null = null;
let mainU_resolution: WebGLUniformLocation | null = null;
let mainU_time: WebGLUniformLocation | null = null;

let texA: Tex | null = null;
let texB: Tex | null = null;
let blurFboA: FBO | null = null;
let blurFboB: FBO | null = null;

let mixProgress = 1.0;
let mixStartTime = 0;
const MIX_DURATION = 0.6;

let timeAccumulator = 0;
let lastFrameTime = 0;
let lastRenderTime = 0;
let playing = true;
let paused = false;
let currentColors = [...defaultColors];
let rafId: number | null = null;
let renderWidth = 0;
let renderHeight = 0;

const FRAME_INTERVAL = 1000 / 60;
const BLUR_SIZE = 512;
const BLUR_OFFSETS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0];

// ---------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------

const compileShader = (type: number, src: string): WebGLShader | null => {
  if (!gl) return null;
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const linkProgram = (vs: string, fs: string): WebGLProgram | null => {
  if (!gl) return null;
  const v = compileShader(gl.VERTEX_SHADER, vs);
  const f = compileShader(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Link:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
};

const drawQuad = (prog: WebGLProgram) => {
  if (!gl) return;
  const loc = gl.getAttribLocation(prog, "position");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const makeFbo = (w: number, h: number): FBO | null => {
  if (!gl) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer();
  if (!fb) {
    gl.deleteTexture(tex);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fb, tex };
};

const freeFbo = (fbo: FBO | null) => {
  if (!gl || !fbo) return;
  gl.deleteFramebuffer(fbo.fb);
  gl.deleteTexture(fbo.tex);
};

const makeTex = (
  source: TexImageSource,
  w: number,
  h: number,
  cover: boolean,
): Tex | null => {
  if (!gl) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, w, h, cover };
};

const makeBlackTex = (): Tex | null => {
  if (!gl) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, w: 1, h: 1, cover: false };
};

const freeTex = (item: Tex | null) => {
  if (!gl || !item) return;
  gl.deleteTexture(item.tex);
};

const swapTex = (next: Tex) => {
  if (!gl) return;
  freeTex(texB);
  texB = texA;
  texA = next;
  mixProgress = 0.0;
  mixStartTime = timeAccumulator * 0.001;
};

const blurTexture = (src: Tex): Tex | null => {
  if (!gl || !kawaseProg) return null;

  freeFbo(blurFboA);
  freeFbo(blurFboB);
  blurFboA = makeFbo(src.w, src.h);
  blurFboB = makeFbo(src.w, src.h);
  if (!blurFboA || !blurFboB) return null;

  gl.useProgram(kawaseProg);
  gl.uniform2f(kawaseU_texelSize, 1.0 / src.w, 1.0 / src.h);

  let read = src.tex;
  let write = blurFboA;
  let spare = blurFboB;

  for (let i = 0; i < BLUR_OFFSETS.length; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fb);
    gl.viewport(0, 0, src.w, src.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read);
    gl.uniform1i(kawaseU_texture, 0);
    gl.uniform1f(kawaseU_offset, BLUR_OFFSETS[i]);
    drawQuad(kawaseProg);

    read = write.tex;
    const fbo = write;
    write = spare;
    spare = fbo;
  }

  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    src.w,
    src.h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const result = read === blurFboA.tex ? blurFboA : blurFboB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, result.fb);
  gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, src.w, src.h, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  freeFbo(blurFboA);
  freeFbo(blurFboB);
  blurFboA = null;
  blurFboB = null;

  return { tex, w: src.w, h: src.h, cover: src.cover };
};

// ---------------------------------------------------------------------------
// Fallback texture from theme colors
// ---------------------------------------------------------------------------

const generateGradientTex = (colors: string[]): Tex | null => {
  const size = BLUR_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const palette = colors.length > 0 ? colors : defaultColors;
  const bg = ctx.createLinearGradient(0, 0, size, size);
  palette.forEach((color, idx) => {
    bg.addColorStop(
      palette.length === 1 ? 0 : idx / (palette.length - 1),
      color,
    );
  });
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  palette.forEach((color, idx) => {
    const x = (0.2 + (0.6 * ((idx * 37) % 100)) / 100) * size;
    const y = (0.2 + (0.6 * ((idx * 61) % 100)) / 100) * size;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, size * 0.65);
    rg.addColorStop(0, color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, size, size);
  });
  ctx.globalAlpha = 1;

  const raw = makeTex(canvas, size, size, false);
  if (!raw) return null;
  const blurred = blurTexture(raw);
  freeTex(raw);
  return blurred;
};

const makeCoverTex = (bitmap: ImageBitmap): Tex | null => {
  const canvas = new OffscreenCanvas(BLUR_SIZE, BLUR_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const scale = Math.max(BLUR_SIZE / bitmap.width, BLUR_SIZE / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (BLUR_SIZE - w) * 0.5, (BLUR_SIZE - h) * 0.5, w, h);

  const raw = makeTex(canvas, BLUR_SIZE, BLUR_SIZE, true);
  if (!raw) return null;
  const blurred = blurTexture(raw);
  freeTex(raw);
  return blurred;
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const initPipeline = (): boolean => {
  if (!gl) return false;

  quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  kawaseProg = linkProgram(FULLSCREEN_VS, KAWASE_FS);
  mainProg = linkProgram(FULLSCREEN_VS, MAIN_FS);
  if (!kawaseProg || !mainProg) return false;

  kawaseU_texture = gl.getUniformLocation(kawaseProg, "uTexture");
  kawaseU_texelSize = gl.getUniformLocation(kawaseProg, "uTexelSize");
  kawaseU_offset = gl.getUniformLocation(kawaseProg, "uOffset");

  mainU_texA = gl.getUniformLocation(mainProg, "uTexA");
  mainU_texB = gl.getUniformLocation(mainProg, "uTexB");
  mainU_texASize = gl.getUniformLocation(mainProg, "uTexASize");
  mainU_texBSize = gl.getUniformLocation(mainProg, "uTexBSize");
  mainU_mix = gl.getUniformLocation(mainProg, "uMix");
  mainU_resolution = gl.getUniformLocation(mainProg, "uResolution");
  mainU_time = gl.getUniformLocation(mainProg, "uTime");

  texA = makeBlackTex();
  texB = makeBlackTex();

  return Boolean(texA && texB);
};

// ---------------------------------------------------------------------------
// Incoming media
// ---------------------------------------------------------------------------

const onNewCover = (bitmap: ImageBitmap) => {
  const next = makeCoverTex(bitmap);
  if (!next) return;
  swapTex(next);
};

const onNewColors = (colors: string[]) => {
  currentColors = colors;
  if (texA?.cover) return;
  const next = generateGradientTex(colors);
  if (next) swapTex(next);
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const render = (now: number) => {
  if (!gl || !mainProg || !texA || !texB) return;

  if (now - lastRenderTime < FRAME_INTERVAL) return;
  lastRenderTime = now - ((now - lastRenderTime) % FRAME_INTERVAL);

  const delta = now - lastFrameTime;
  lastFrameTime = now;
  if (playing && !paused) timeAccumulator += delta;
  const t = timeAccumulator * 0.001;

  if (mixProgress < 1.0) {
    const elapsed = t - mixStartTime;
    const progress = Math.min(1.0, elapsed / MIX_DURATION);
    mixProgress = progress * progress * (3.0 - 2.0 * progress);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.useProgram(mainProg);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA.tex);
  gl.uniform1i(mainU_texA, 0);
  gl.uniform2f(mainU_texASize, texA.w, texA.h);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texB.tex);
  gl.uniform1i(mainU_texB, 1);
  gl.uniform2f(mainU_texBSize, texB.w, texB.h);

  gl.uniform1f(mainU_mix, mixProgress);
  gl.uniform2f(mainU_resolution, gl.canvas.width, gl.canvas.height);
  gl.uniform1f(mainU_time, t);

  drawQuad(mainProg);
};

const loop = (now: number) => {
  render(now);
  rafId = self.requestAnimationFrame(loop);
};

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const data = event.data;

  if (data.type === "init" && data.canvas) {
    gl = data.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      console.error("WebGL not available");
      return;
    }

    renderWidth = data.width ?? data.canvas.width;
    renderHeight = data.height ?? data.canvas.height;
    data.canvas.width = renderWidth;
    data.canvas.height = renderHeight;

    if (!initPipeline()) {
      console.error("Pipeline init failed");
      return;
    }

    currentColors = data.colors ?? defaultColors;
    const tex = generateGradientTex(currentColors);
    if (tex) {
      freeTex(texA);
      texA = tex;
    }
    mixProgress = 1.0;

    lastFrameTime = performance.now();
    lastRenderTime = performance.now();
    timeAccumulator = 0;
    playing = true;
    paused = false;
    if (rafId !== null) self.cancelAnimationFrame(rafId);
    rafId = self.requestAnimationFrame(loop);
    return;
  }

  if (!gl) return;

  if (
    data.type === "resize" &&
    typeof data.width === "number" &&
    typeof data.height === "number"
  ) {
    renderWidth = data.width;
    renderHeight = data.height;
    (gl.canvas as OffscreenCanvas).width = renderWidth;
    (gl.canvas as OffscreenCanvas).height = renderHeight;
    return;
  }
  if (data.type === "colors" && data.colors) {
    onNewColors(data.colors);
    return;
  }
  if (data.type === "play" && typeof data.isPlaying === "boolean") {
    playing = data.isPlaying;
    return;
  }
  if (data.type === "pause" && typeof data.paused === "boolean") {
    paused = data.paused;
    return;
  }
  if (data.type === "coverImage" && data.imageData) {
    onNewCover(data.imageData);
  }
};
