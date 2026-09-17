const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 step;
uniform float finish;
void main() {
  vec3 color = vec3(0.0);
  if (finish > 0.5) {
    color = texture2D(image, uv).rgb;
    float shade = 0.86 - 0.12 * smoothstep(0.12, 0.65, length(uv - 0.5));
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    color = color * shade + grain / 255.0;
  } else {
    float total = 0.0;
    for (int i = -12; i <= 12; i++) {
      float weight = exp(-float(i * i) / 32.0);
      color += texture2D(image, uv + step * float(i)).rgb * weight;
      total += weight;
    }
    color /= total;
  }
  gl_FragColor = vec4(color, 1.0);
}`;

// Blur the composed, deformed image in screen space. A bounded render target
// keeps the two Gaussian passes cheap on mobile; only the final copy is full size.
export class Blur {
  width = 1;
  height = 1;
  private readonly program: WebGLProgram;
  private readonly depth: WebGLRenderbuffer;
  private readonly quad: WebGLBuffer;
  private readonly targets: { texture: WebGLTexture; buffer: WebGLFramebuffer }[];
  private readonly step: WebGLUniformLocation | null;
  private readonly finish: WebGLUniformLocation | null;

  constructor(private readonly gl: WebGLRenderingContext) {
    this.program = gl.createProgram()!;
    for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(kind)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Background blur: ${message}`);
      }
      gl.attachShader(this.program, shader);
      gl.deleteShader(shader);
    }
    gl.bindAttribLocation(this.program, 0, "position");
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) ?? "Background blur link failed");
    }
    this.step = gl.getUniformLocation(this.program, "step");
    this.finish = gl.getUniformLocation(this.program, "finish");
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    this.targets = Array.from({ length: 2 }, () => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const buffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, buffer };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].buffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    const scale = Math.min(1, 512 / Math.max(width, height));
    this.width = Math.max(1, Math.round(width * scale));
    this.height = Math.max(1, Math.round(height * scale));
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
    for (const target of this.targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Background blur framebuffer is incomplete");
      }
    }
  }

  begin() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.targets[0].buffer);
    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LESS);
  }

  draw() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    // sigma = 0.45% of the short edge, independent of screen orientation.
    const stride = Math.min(this.width, this.height) * 0.0045 / 4;
    for (let i = 0; i < 3; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, i === 2 ? null : this.targets[1 - i].buffer);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[i % 2].texture);
      gl.uniform2f(this.step, i === 0 ? stride / this.width : 0, i === 1 ? stride / this.height : 0);
      gl.uniform1f(this.finish, i === 2 ? 1 : 0);
      if (i === 2) gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose() {
    this.gl.deleteRenderbuffer(this.depth);
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.quad);
    for (const target of this.targets) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.buffer);
    }
  }
}
