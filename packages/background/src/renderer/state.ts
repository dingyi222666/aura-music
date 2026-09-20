import { layouts, tangents, DURATION } from "./mesh";

const vectors = (rows: readonly (readonly (readonly number[])[])[], size: number) =>
  rows.flatMap((row) => row.map((value) => `vec${size}(${value.map((v) => v.toFixed(8)).join(",")})`)).join(",\n");

const VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform float time;
uniform float audio;
uniform uint seed;
uniform uint episode;
uniform vec2 aspect;
out vec4 first;
out vec4 second;
const vec2 layouts[16] = vec2[16](${vectors(layouts, 2)});
const vec4 tangents[16] = vec4[16](${vectors(tangents, 4)});
int stage;
int next;
float fraction;
vec4 foldA;
vec3 foldB;
float ease(float v) {
  float t = clamp(v, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
float random(uint n) {
  n = (n ^ 0x9e3779b9u) * 0x21f0aaadu;
  n = (n ^ (n >> 16u)) * 0x735a2d97u;
  return float(n ^ (n >> 15u)) / 4294967296.0;
}
vec2 point(int x, int y) {
  if (x == 0 || y == 0 || x == 3 || y == 3) return vec2(x, y) / 3.0;
  int i = (y - 1) * 2 + x - 1;
  return mix(layouts[stage * 4 + i], layouts[next * 4 + i], fraction);
}
mat2 turn(float angle) {
  float s = sin(angle), c = cos(angle);
  return mat2(c, s, -s, c);
}
mat4x2 control(int i) {
  int x = i % 4, y = i / 4;
  int left = max(0, x - 1), right = min(3, x + 1);
  int top = max(0, y - 1), bottom = min(3, y + 1);
  vec2 du = (point(right, y) - point(left, y)) / float(right - left);
  vec2 dv = (point(x, bottom) - point(x, top)) / float(bottom - top);
  vec2 duv = (point(right, bottom) - point(left, bottom) - point(right, top) + point(left, top)) /
    float((right - left) * (bottom - top));
  if (x > 0 && x < 3 && y > 0 && y < 3) {
    int index = (y - 1) * 2 + x - 1;
    vec4 tangent = mix(tangents[stage * 4 + index], tangents[next * 4 + index], fraction);
    du = turn(tangent.x) * du * tangent.z;
    dv = turn(tangent.y) * dv * tangent.w;
  }
  return mat4x2(point(x, y), du, dv, duv);
}
void crease() {
  float cycle = floor(time / 24.0);
  float phase = time - cycle * 24.0;
  uint key = seed + uint(cycle) * 9u;
  float start = 2.0 + random(key) * 3.0;
  float hold = 4.0 + random(key + 1u) * 4.0;
  float envelope = ease((phase - start) / 2.4) * (1.0 - ease((phase - start - 2.4 - hold) / 3.2));
  float drift = random(key + 2u) * 6.28318530718;
  foldA = vec4(
    0.48 + random(key + 2u) * 0.04 + sin(time * 0.30 + drift) * 0.065 + sin(time * 0.17 + drift) * 0.025,
    (random(key + 3u) - 0.5) * 0.04,
    (0.14 + random(key + 4u) * 0.035) * envelope,
    0.065 + random(key + 5u) * 0.015);
  float cy = 0.47 + random(key + 6u) * 0.06 + sin(time * 0.22 + drift) * 0.07;
  foldB = vec3(0.5 + (cy - 0.5) / aspect.y,
    (0.31 + random(key + 7u) * 0.045) / aspect.y,
    0.055 + random(key + 8u) * 0.03);
}
void main() {
  float phase = mod(time / ${DURATION.toFixed(1)}, 4.0);
  stage = int(floor(phase));
  next = (stage + 1) % 4;
  fraction = ease(fract(phase));
  int i = gl_VertexID;
  if (i < 16) {
    mat4x2 data = control(i);
    first = vec4(data[0], data[1]);
    second = vec4(data[2], data[3]);
  } else if (i == 17) {
    float angle = 0.55 + time * 0.14;
    first = vec4(cos(angle), sin(angle), sin(time * 0.071) * 0.07, cos(time * 0.093) * 0.07);
    second = vec4(turn(-time * 0.11) * vec2(0.29, 0.16) * audio, 0.0, 0.0);
  } else if (i == 16) {
    crease();
    first = foldA;
    second = vec4(foldB, 0.0);
  } else {
    uint key = seed + episode * 23u;
    int a = min(3, int(random(key + 15u) * 4.0));
    int b = (a + 1 + min(2, int(random(key + 16u) * 3.0))) % 4;
    first = vec4(float(a & 1), float(a >> 1), float(b & 1), float(b >> 1));
    second = vec4(0.68, 0.62, aspect.yx);
  }
  gl_Position = vec4(0.0);
}`;

/** 19 GPU invocations write a 608-byte uniform block. No CPU vertex updates,
 * texture lookup targets, readback, or per-frame buffer uploads are needed. */
export class State {
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly feedback: WebGLTransformFeedback;
  private readonly vao: WebGLVertexArrayObject;
  private readonly clock: WebGLUniformLocation | null;
  private readonly audio: WebGLUniformLocation | null;
  private readonly aspect: WebGLUniformLocation | null;
  private readonly selection: WebGLUniformLocation | null;
  private episode = -1;
  private time = NaN;
  private pulse = NaN;
  private ratio = NaN;

  constructor(private readonly gl: WebGL2RenderingContext, seed: number) {
    this.program = gl.createProgram()!;
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER,
        "#version 300 es\nprecision highp float;\nvoid main() {}"]] as const) {
        const shader = gl.createShader(kind)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        const error = ok ? null : gl.getShaderInfoLog(shader);
        if (ok) gl.attachShader(this.program, shader);
        gl.deleteShader(shader);
        if (!ok) throw new Error(`Background state: ${error}`);
      }
      gl.transformFeedbackVaryings(this.program, ["first", "second"], gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "State link failed");
    } catch (error) {
      gl.deleteProgram(this.program);
      throw error;
    }
    this.buffer = gl.createBuffer()!;
    this.feedback = gl.createTransformFeedback()!;
    this.vao = gl.createVertexArray()!;
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, this.buffer);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 19 * 8 * 4, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    gl.useProgram(this.program);
    gl.uniform1ui(gl.getUniformLocation(this.program, "seed"), seed);
    this.clock = gl.getUniformLocation(this.program, "time");
    this.audio = gl.getUniformLocation(this.program, "audio");
    this.aspect = gl.getUniformLocation(this.program, "aspect");
    this.selection = gl.getUniformLocation(this.program, "episode");
  }

  draw(time: number, pulse: number, ratio: number, episode: number) {
    if (time === this.time && pulse === this.pulse && ratio === this.ratio && episode === this.episode) return;
    this.time = time;
    this.pulse = pulse;
    this.ratio = ratio;
    this.episode = episode;
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.clock, time);
    gl.uniform1f(this.audio, pulse);
    gl.uniform1ui(this.selection, episode);
    gl.uniform2f(this.aspect, Math.max(1, 1 / ratio), Math.max(1, ratio));
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffer);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, 19);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
  }

  dispose() {
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null);
    gl.deleteTransformFeedback(this.feedback);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
