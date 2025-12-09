const defaultColors = [
  "rgb(60, 20, 80)",
  "rgb(100, 40, 60)",
  "rgb(20, 20, 40)",
  "rgb(40, 40, 90)",
];

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;

  #define S(a,b,t) smoothstep(a,b,t)

  mat2 Rot(float a) {
      float s = sin(a);
      float c = cos(a);
      return mat2(c, -s, s, c);
  }

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
              dot(-1.0 + 2.0 * hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
      return 0.5 + 0.5 * n;
  }

  void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      float ratio = uResolution.x / uResolution.y;

      vec2 tuv = uv;
      tuv -= 0.5;

      float degree = noise(vec2(uTime * 0.1, tuv.x * tuv.y));

      tuv.y *= 1.0 / ratio;
      tuv *= Rot(radians((degree - 0.5) * 720.0 + 180.0));
      tuv.y *= ratio;

      float frequency = 5.0;
      float amplitude = 30.0;
      float speed = uTime * 2.0;
      tuv.x += sin(tuv.y * frequency + speed) / amplitude;
      tuv.y += sin(tuv.x * frequency * 1.5 + speed) / (amplitude * 0.5);

      vec3 layer1 = mix(uColor1, uColor2, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));
      vec3 layer2 = mix(uColor3, uColor4, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));

      vec3 finalComp = mix(layer1, layer2, S(0.5, -0.3, tuv.y));
      vec3 col = finalComp;

      gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAME_INTERVAL = 1000 / 60;

interface WorkerCommand {
  type: "init" | "resize" | "colors" | "play" | "pause";
  canvas?: OffscreenCanvas;
  width?: number;
  height?: number;
  colors?: string[];
  isPlaying?: boolean;
  paused?: boolean;
}

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let resolutionUniform: WebGLUniformLocation | null = null;
let timeUniform: WebGLUniformLocation | null = null;
let color1Uniform: WebGLUniformLocation | null = null;
let color2Uniform: WebGLUniformLocation | null = null;
let color3Uniform: WebGLUniformLocation | null = null;
let color4Uniform: WebGLUniformLocation | null = null;

let timeAccumulator = 0;
let lastFrameTime = 0;
let lastRenderTime = 0;
let playing = true;
let paused = false;
let currentColors = [...defaultColors];
let rafId: number | null = null;

const parseColor = (colorStr: string): [number, number, number] => {
  const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return [0, 0, 0];
  return [
    parseInt(match[1], 10) / 255,
    parseInt(match[2], 10) / 255,
    parseInt(match[3], 10) / 255,
  ];
};

const createShader = (
  glCtx: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = glCtx.createShader(type);
  if (!shader) return null;
  glCtx.shaderSource(shader, source);
  glCtx.compileShader(shader);
  if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
    console.error(glCtx.getShaderInfoLog(shader));
    glCtx.deleteShader(shader);
    return null;
  }
  return shader;
};

const initProgram = () => {
  if (!gl) return false;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertexShader || !fragmentShader) return false;

  const prog = gl.createProgram();
  if (!prog) return false;

  gl.attachShader(prog, vertexShader);
  gl.attachShader(prog, fragmentShader);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const positionLocation = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  resolutionUniform = gl.getUniformLocation(prog, "uResolution");
  timeUniform = gl.getUniformLocation(prog, "uTime");
  color1Uniform = gl.getUniformLocation(prog, "uColor1");
  color2Uniform = gl.getUniformLocation(prog, "uColor2");
  color3Uniform = gl.getUniformLocation(prog, "uColor3");
  color4Uniform = gl.getUniformLocation(prog, "uColor4");

  program = prog;
  return true;
};

const render = (now: number) => {
  if (!gl || !program || !resolutionUniform || !timeUniform) return;

  if (now - lastRenderTime < FRAME_INTERVAL) {
    return;
  }
  lastRenderTime = now - ((now - lastRenderTime) % FRAME_INTERVAL);

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.useProgram(program);
  gl.uniform2f(resolutionUniform, gl.canvas.width, gl.canvas.height);

  const delta = now - lastFrameTime;
  lastFrameTime = now;
  if (playing && !paused) {
    timeAccumulator += delta;
  }

  const colors = currentColors.length >= 4 ? currentColors : defaultColors;
  const [c1, c2, c3, c4] = colors.map(parseColor);

  gl.uniform1f(timeUniform, timeAccumulator * 0.0005);
  gl.uniform3f(color1Uniform, c1[0], c1[1], c1[2]);
  gl.uniform3f(color2Uniform, c2[0], c2[1], c2[2]);
  gl.uniform3f(color3Uniform, c3[0], c3[1], c3[2]);
  gl.uniform3f(color4Uniform, c4[0], c4[1], c4[2]);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const loop = (now: number) => {
  render(now);
  rafId = self.requestAnimationFrame(loop);
};

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const { data } = event;
  if (data.type === "init" && data.canvas) {
    const canvas = data.canvas;
    if (!canvas) return;

    gl = canvas.getContext("webgl");
    if (!gl) {
      console.error("WebGL not supported in web worker background");
      return;
    }

    gl.canvas.width = data.width;
    gl.canvas.height = data.height;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    if (!initProgram()) {
      console.error("Failed to initialize shader program in worker");
      return;
    }

    currentColors = data.colors ?? defaultColors;
    lastFrameTime = performance.now();
    lastRenderTime = performance.now();
    timeAccumulator = 0;
    playing = true;
    paused = false;

    rafId = self.requestAnimationFrame(loop);
    return;
  }

  if (!gl) return;

  if (data.type === "resize" && typeof data.width === "number" && typeof data.height === "number") {
    gl.canvas.width = data.width;
    gl.canvas.height = data.height;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    return;
  }

  if (data.type === "colors" && data.colors) {
    currentColors = data.colors;
    return;
  }

  if (data.type === "play" && typeof data.isPlaying === "boolean") {
    playing = data.isPlaying;
    return;
  }

  if (data.type === "pause" && typeof data.paused === "boolean") {
    paused = data.paused;
  }
};
