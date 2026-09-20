const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D image;
uniform sampler2D previous;
uniform vec2 texel;
uniform int mode;
uniform float blend;
out vec4 color;
vec3 sampleAt(vec2 p) {
  // Mirrored extension avoids either dark rims or repeated edge streaks.
  return texture(image, 1.0 - abs(mod(p, 2.0) - 1.0)).rgb;
}
void main() {
  if (mode == 0) {
    vec4 pixel = texture(image, uv);
    float luma = dot(pixel.rgb, vec3(.30, .59, .11));
    float tone = luma * .72 + .14;
    vec3 delta = pixel.rgb - luma;
    float gain = 1.9;
    for (int i = 0; i < 3; i++) {
      if (delta[i] > 0.0) gain = min(gain, (1.0 - tone) / delta[i]);
      if (delta[i] < 0.0) gain = min(gain, -tone / delta[i]);
    }
    color = vec4((tone + delta * gain) * pixel.a, 1.0);
    return;
  }
  if (mode == 3) {
    color = vec4(mix(texture(previous, uv).rgb, texture(image, uv).rgb, blend), 1.0);
    return;
  }
  if (mode == 1) {
    vec3 sum = sampleAt(uv) * 4.0;
    sum += sampleAt(uv + texel) + sampleAt(uv - texel);
    sum += sampleAt(uv + vec2(texel.x, -texel.y)) + sampleAt(uv + vec2(-texel.x, texel.y));
    color = vec4(sum / 8.0, 1.0);
    return;
  }
  vec3 sum = sampleAt(uv + vec2(texel.x, 0.0)) + sampleAt(uv - vec2(texel.x, 0.0));
  sum += sampleAt(uv + vec2(0.0, texel.y)) + sampleAt(uv - vec2(0.0, texel.y));
  sum += 2.0 * (sampleAt(uv + texel * .5) + sampleAt(uv - texel * .5));
  sum += 2.0 * (sampleAt(uv + vec2(texel.x, -texel.y) * .5) + sampleAt(uv + vec2(-texel.x, texel.y) * .5));
  color = vec4(sum / 12.0, 1.0);
}`;

/** Cover-only GPU preprocessing. No readback or blur work in the animation loop. */
export class Artwork {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLFramebuffer;
  private source: WebGLTexture | null = null;
  private readonly targets = new Map<number, WebGLTexture>();
  private readonly mode: WebGLUniformLocation | null;
  private readonly texel: WebGLUniformLocation | null;
  private readonly blend: WebGLUniformLocation | null;
  private readonly canvas = new OffscreenCanvas(128, 128);

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = gl.createProgram()!;
    for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(kind)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        gl.deleteProgram(this.program);
        throw new Error(`Artwork shader: ${message}`);
      }
      gl.attachShader(this.program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(this.program);
      gl.deleteProgram(this.program);
      throw new Error(`Artwork shader: ${message}`);
    }
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createFramebuffer()!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "image"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "previous"), 1);
    this.mode = gl.getUniformLocation(this.program, "mode");
    this.texel = gl.getUniformLocation(this.program, "texel");
    this.blend = gl.getUniformLocation(this.program, "blend");
  }

  private texture(size: number, mirror = false) {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mirror ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mirror ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    return texture;
  }

  private draw(source: WebGLTexture, target: WebGLTexture, width: number, size: number, mode: number) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(this.mode, mode);
    gl.uniform2f(this.texel, 1.3 / width, 1.3 / width);
    gl.viewport(0, 0, size, size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  prepare(bitmap: ImageBitmap) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.source) {
      this.source = this.texture(128);
      for (const size of [128, 64, 32, 16]) this.targets.set(size, this.texture(size));
    }
    this.canvas.width = this.canvas.height = 128;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Artwork canvas unavailable");
    ctx.clearRect(0, 0, 128, 128);
    ctx.drawImage(bitmap, 0, 0, 128, 128);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    // Allocate only the final cover; all pyramid targets are reused.
    const result = this.texture(128, true);
    let source = this.source;
    let width = 128;
    // Reuse the downsample targets on the way back up: each previous value is
    // already consumed before its texture becomes an output again.
    for (const size of [128, 64, 32, 16, 32, 64]) {
      const target = this.targets.get(size)!;
      this.draw(source, target, width, size, source === this.source ? 0 : size < width ? 1 : 2);
      source = target;
      width = size;
    }
    this.draw(source, result, width, 128, 2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    return result;
  }

  mix(previous: WebGLTexture, current: WebGLTexture, amount: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const result = this.texture(128, true);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous);
    gl.uniform1f(this.blend, amount);
    this.draw(current, result, 128, 128, 3);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    return result;
  }

  /** The final cover is independent of these scratch targets. */
  trim() {
    if (!this.source) return;
    const gl = this.gl;
    gl.deleteTexture(this.source);
    this.source = null;
    for (const texture of this.targets.values()) gl.deleteTexture(texture);
    this.targets.clear();
    this.canvas.width = this.canvas.height = 1;
  }

  dispose() {
    const gl = this.gl;
    this.trim();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteFramebuffer(this.buffer);
  }
}
