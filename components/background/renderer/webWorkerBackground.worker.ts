// ============================================================================
// Gradient Mesh Background – Web Worker + WebGL
//
// Apple Music style flowing gradient:
//   1. Cover → slice into 8×5 grid → average color per cell → solid color
//      blocks → heavy Kawase blur → smooth gradient texture
//   2. Every frame: sample the blurred texture 3× at different animated UV
//      positions (each layer pans/zooms on independent Lissajous orbits).
//      Overlapping layers create organic color mixing while preserving
//      distinct color block regions.
//   3. Song change → crossfade between old and new textures
// ============================================================================

const defaultColors = [
  "rgb(60, 20, 80)",
  "rgb(100, 40, 60)",
  "rgb(20, 20, 40)",
  "rgb(40, 40, 90)",
];

const GRID_COLS = 7;
const GRID_ROWS = 6;

// ---------------------------------------------------------------------------
//  Shaders
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
  vec2 ofs = uTexelSize * uOffset;
  vec4 s  = texture2D(uTexture, vUv + vec2(-ofs.x, -ofs.y));
       s += texture2D(uTexture, vUv + vec2( ofs.x, -ofs.y));
       s += texture2D(uTexture, vUv + vec2(-ofs.x,  ofs.y));
       s += texture2D(uTexture, vUv + vec2( ofs.x,  ofs.y));
  gl_FragColor = s * 0.25;
}
`;

// --- Main shader: reference Shadertoy algorithm adapted ---
// Noise rotation + sine-wave warp creates flowing UV → smoothstep on
// the warped UV draws animated dividing lines that CUT between color
// regions sampled from the blurred texture. Colors stay blocky, boundaries flow.
const MAIN_FS = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform vec2 uResolution;
uniform float uTime;

// iq gradient noise
vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
  return fract(sin(p) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(dot(-1.0 + 2.0 * hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(-1.0 + 2.0 * hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(-1.0 + 2.0 * hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(-1.0 + 2.0 * hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y);
  return 0.5 + 0.5 * n;
}

mat2 Rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 uv = vUv;
  float ratio = uResolution.x / uResolution.y;
  float t = uTime;

  // --- Warp UV ---
  vec2 tuv = uv - 0.5;

  // Noise-driven rotation
  float degree = noise(vec2(t * 0.1, tuv.x * tuv.y));
  tuv.y *= 1.0 / ratio;
  tuv *= Rot(radians((degree - 0.5) * 720.0 + 180.0));
  tuv.y *= ratio;

  // Slow undulating warp — broad curves, not ripples
  float speed = t * 0.8;
  tuv.x += sin(tuv.y * 2.0 + speed) / 50.0;
  tuv.y += sin(tuv.x * 2.5 + speed * 0.9) / 50.0;

  // --- 6 colors sampled from blurred texture on wandering orbits ---
  vec2 s1 = vec2(0.5 + sin(t * 0.013)         * 0.35,
                 0.5 + cos(t * 0.017)         * 0.35);
  vec2 s2 = vec2(0.5 + cos(t * 0.011 + 1.5)  * 0.35,
                 0.5 + sin(t * 0.015 + 2.3)  * 0.35);
  vec2 s3 = vec2(0.5 + sin(t * 0.014 + 3.7)  * 0.35,
                 0.5 + cos(t * 0.012 + 4.1)  * 0.35);
  vec2 s4 = vec2(0.5 + cos(t * 0.016 + 5.2)  * 0.35,
                 0.5 + sin(t * 0.010 + 6.8)  * 0.35);
  vec2 s5 = vec2(0.5 + sin(t * 0.009 + 0.8)  * 0.35,
                 0.5 + cos(t * 0.014 + 5.5)  * 0.35);
  vec2 s6 = vec2(0.5 + cos(t * 0.012 + 3.1)  * 0.35,
                 0.5 + sin(t * 0.008 + 7.4)  * 0.35);

  vec3 c1 = mix(texture2D(uTexB, s1).rgb, texture2D(uTexA, s1).rgb, uMix);
  vec3 c2 = mix(texture2D(uTexB, s2).rgb, texture2D(uTexA, s2).rgb, uMix);
  vec3 c3 = mix(texture2D(uTexB, s3).rgb, texture2D(uTexA, s3).rgb, uMix);
  vec3 c4 = mix(texture2D(uTexB, s4).rgb, texture2D(uTexA, s4).rgb, uMix);
  vec3 c5 = mix(texture2D(uTexB, s5).rgb, texture2D(uTexA, s5).rgb, uMix);
  vec3 c6 = mix(texture2D(uTexB, s6).rgb, texture2D(uTexA, s6).rgb, uMix);

  // --- Flowing smoothstep blending across 6 colors ---
  // Three layers, each split left/right on warped x (reference pattern),
  // then stacked vertically with two separated smoothstep transitions.
  vec2 rtuv = tuv * Rot(radians(-5.0));

  vec3 layer1 = mix(c1, c2, smoothstep(-0.3, 0.2, rtuv.x));
  vec3 layer2 = mix(c3, c4, smoothstep(-0.3, 0.2, rtuv.x));
  vec3 layer3 = mix(c5, c6, smoothstep(-0.3, 0.2, rtuv.x));

  vec3 lower = mix(layer3, layer2, smoothstep(-0.3, 0.1, tuv.y));
  vec3 col = mix(lower, layer1, smoothstep(0.0, 0.35, tuv.y));

  // --- Dark-area processing ---
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float darkMask = smoothstep(0.12, 0.0, lum);
  col = mix(vec3(lum), col, 1.0 + darkMask * 1.5);
  float peak = max(col.r, max(col.g, col.b));
  vec3 colorDir = col / max(peak, 0.001);
  col = max(col, colorDir * 0.08);

  // Gentle vignette
  vec2 vc = uv - 0.5;
  vc.x *= ratio;
  col *= 1.0 - 0.25 * dot(vc, vc);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
//  Types
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

type FBO = { fb: WebGLFramebuffer; tex: WebGLTexture };

// ---------------------------------------------------------------------------
//  State
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
let mainU_mix: WebGLUniformLocation | null = null;
let mainU_resolution: WebGLUniformLocation | null = null;
let mainU_time: WebGLUniformLocation | null = null;

let texA: WebGLTexture | null = null;
let texB: WebGLTexture | null = null;
let hasCoverA = false;
let hasCoverB = false;

let blurFBO_A: FBO | null = null;
let blurFBO_B: FBO | null = null;

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

// Heavy blur to melt the grid into smooth gradients
const BLUR_OFFSETS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0];

// ---------------------------------------------------------------------------
//  GL Helpers
// ---------------------------------------------------------------------------

const compileShader = (type: number, src: string): WebGLShader | null => {
  if (!gl) return null;
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Shader:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
};

const linkProgram = (vs: string, fs: string): WebGLProgram | null => {
  if (!gl) return null;
  const v = compileShader(gl.VERTEX_SHADER, vs);
  const f = compileShader(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("Link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
};

const makeFBO = (w: number, h: number): FBO | null => {
  if (!gl) return null;
  const tex = gl.createTexture()!;
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
  const fb = gl.createFramebuffer()!;
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

const freeFBO = (fbo: FBO) => {
  if (!gl) return;
  gl.deleteFramebuffer(fbo.fb);
  gl.deleteTexture(fbo.tex);
};

const drawQuad = (prog: WebGLProgram) => {
  if (!gl) return;
  const loc = gl.getAttribLocation(prog, "position");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const makeTexFromSource = (source: TexImageSource): WebGLTexture | null => {
  if (!gl) return null;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
};

const makeBlackTex = (): WebGLTexture | null => {
  if (!gl) return null;
  const tex = gl.createTexture()!;
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
};

// ---------------------------------------------------------------------------
//  Kawase blur
// ---------------------------------------------------------------------------

const blurTexture = (
  srcTex: WebGLTexture,
  w: number,
  h: number,
): WebGLTexture | null => {
  if (!gl || !kawaseProg) return null;

  if (blurFBO_A) freeFBO(blurFBO_A);
  if (blurFBO_B) freeFBO(blurFBO_B);
  blurFBO_A = makeFBO(w, h);
  blurFBO_B = makeFBO(w, h);
  if (!blurFBO_A || !blurFBO_B) return null;

  gl.useProgram(kawaseProg);
  gl.uniform2f(kawaseU_texelSize, 1.0 / w, 1.0 / h);

  let readTex = srcTex;
  let writeFBO = blurFBO_A;
  let readFBO = blurFBO_B;

  for (let i = 0; i < BLUR_OFFSETS.length; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fb);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(kawaseU_texture, 0);
    gl.uniform1f(kawaseU_offset, BLUR_OFFSETS[i]);
    drawQuad(kawaseProg);

    readTex = writeFBO.tex;
    const tmp = writeFBO;
    writeFBO = readFBO;
    readFBO = tmp;
  }

  const resultTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, resultTex);
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);

  const resultFBO = readTex === blurFBO_A.tex ? blurFBO_A : blurFBO_B;
  gl.bindFramebuffer(gl.FRAMEBUFFER, resultFBO.fb);
  gl.bindTexture(gl.TEXTURE_2D, resultTex);
  gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  freeFBO(blurFBO_A);
  freeFBO(blurFBO_B);
  blurFBO_A = null;
  blurFBO_B = null;

  return resultTex;
};

// ---------------------------------------------------------------------------
//  Color grid: slice cover into 8×5, average each cell
// ---------------------------------------------------------------------------

const buildColorGrid = (bitmap: ImageBitmap): OffscreenCanvas => {
  const sampleW = GRID_COLS * 10;
  const sampleH = GRID_ROWS * 10;
  const sample = new OffscreenCanvas(sampleW, sampleH);
  const sCtx = sample.getContext("2d")!;

  const scale = Math.max(sampleW / bitmap.width, sampleH / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (sampleW - w) / 2;
  const y = (sampleH - h) / 2;
  sCtx.drawImage(bitmap, x, y, w, h);

  const imgData = sCtx.getImageData(0, 0, sampleW, sampleH);
  const pixels = imgData.data;

  const cellW = sampleW / GRID_COLS;
  const cellH = sampleH / GRID_ROWS;

  const outSize = 512;
  const out = new OffscreenCanvas(outSize, outSize);
  const ctx = out.getContext("2d")!;

  const blockW = outSize / GRID_COLS;
  const blockH = outSize / GRID_ROWS;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      const x0 = Math.floor(col * cellW);
      const y0 = Math.floor(row * cellH);
      const x1 = Math.floor((col + 1) * cellW);
      const y1 = Math.floor((row + 1) * cellH);

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * sampleW + px) * 4;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          count++;
        }
      }

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        Math.floor(col * blockW),
        Math.floor(row * blockH),
        Math.ceil(blockW),
        Math.ceil(blockH),
      );
    }
  }

  // Boost saturation
  const saturated = new OffscreenCanvas(outSize, outSize);
  const sCtx2 = saturated.getContext("2d")!;
  sCtx2.filter = "saturate(1.5)";
  sCtx2.drawImage(out, 0, 0);

  return saturated;
};

// ---------------------------------------------------------------------------
//  Fallback gradient from colors
// ---------------------------------------------------------------------------

const generateGradientTex = (
  colors: string[],
  w: number,
  h: number,
): WebGLTexture | null => {
  if (!gl) return null;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const palette = colors.length > 0 ? colors : defaultColors;
  const blockW = w / GRID_COLS;
  const blockH = h / GRID_ROWS;
  let colorIdx = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      ctx.fillStyle = palette[colorIdx % palette.length];
      ctx.fillRect(
        Math.floor(col * blockW),
        Math.floor(row * blockH),
        Math.ceil(blockW),
        Math.ceil(blockH),
      );
      colorIdx++;
    }
  }

  const rawTex = makeTexFromSource(canvas);
  if (!rawTex) return null;

  const blurred = blurTexture(rawTex, w, h);
  gl.deleteTexture(rawTex);
  return blurred;
};

// ---------------------------------------------------------------------------
//  Init
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
  mainU_mix = gl.getUniformLocation(mainProg, "uMix");
  mainU_resolution = gl.getUniformLocation(mainProg, "uResolution");
  mainU_time = gl.getUniformLocation(mainProg, "uTime");

  texA = makeBlackTex();
  texB = makeBlackTex();

  return true;
};

// ---------------------------------------------------------------------------
//  Handle new cover
// ---------------------------------------------------------------------------

const onNewCover = (bitmap: ImageBitmap) => {
  if (!gl) return;

  const gridCanvas = buildColorGrid(bitmap);
  const rawTex = makeTexFromSource(gridCanvas);
  if (!rawTex) return;

  const blurred = blurTexture(rawTex, 512, 512);
  gl.deleteTexture(rawTex);
  if (!blurred) return;

  if (texB) gl.deleteTexture(texB);
  texB = texA;
  hasCoverB = hasCoverA;

  texA = blurred;
  hasCoverA = true;

  mixProgress = 0.0;
  mixStartTime = timeAccumulator * 0.001;
};

const onNewColors = (colors: string[]) => {
  currentColors = colors;
  if (!hasCoverA) {
    const gradTex = generateGradientTex(colors, 256, 256);
    if (gradTex) {
      if (texB) gl!.deleteTexture(texB);
      texB = texA;
      hasCoverB = hasCoverA;
      texA = gradTex;
      hasCoverA = false;
      mixProgress = 0.0;
      mixStartTime = timeAccumulator * 0.001;
    }
  }
};

// ---------------------------------------------------------------------------
//  Render
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
    mixProgress = Math.min(1.0, elapsed / MIX_DURATION);
    mixProgress = mixProgress * mixProgress * (3.0 - 2.0 * mixProgress);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.useProgram(mainProg);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(mainU_texA, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.uniform1i(mainU_texB, 1);

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
//  Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const { data } = event;

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

    const gradTex = generateGradientTex(currentColors, 256, 256);
    if (gradTex) {
      if (texA) gl.deleteTexture(texA);
      texA = gradTex;
    }
    mixProgress = 1.0;

    lastFrameTime = performance.now();
    lastRenderTime = performance.now();
    timeAccumulator = 0;
    playing = true;
    paused = false;
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
  }
  if (data.type === "coverImage" && data.imageData) {
    onNewCover(data.imageData);
  }
};
