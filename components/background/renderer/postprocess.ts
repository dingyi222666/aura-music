const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D image;
out vec4 outputColor;
uniform vec2 step;
uniform float mode;
void main() {
  vec3 color = vec3(0.0);
  if (mode < 0.5) {
    float total = 0.0;
    for (int i = -12; i <= 12; i++) {
      float weight = exp(-float(i * i) / 32.0);
      color += texture(image, uv + step * float(i)).rgb * weight;
      total += weight;
    }
    color /= total;
  } else {
    color = texture(image, uv).rgb;
    float shade = 0.86 - 0.12 * smoothstep(0.12, 0.65, length(uv - 0.5));
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    color = color * shade + grain / 255.0;
  }
  outputColor = vec4(color, 1.0);
}`;

// Blur the composed, deformed image in screen space. A bounded render target
// keeps the two Gaussian passes cheap on mobile; only the final copy is full size.
export class Blur {
  width = 1;
  height = 1;
  private readonly program: WebGLProgram;
  private readonly depth: WebGLRenderbuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly targets: { texture: WebGLTexture; buffer: WebGLFramebuffer }[];
  private readonly step: WebGLUniformLocation | null;
  private readonly mode: WebGLUniformLocation | null;

  constructor(private readonly gl: WebGL2RenderingContext) {
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
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) ?? "Background blur link failed");
    }
    this.step = gl.getUniformLocation(this.program, "step");
    this.mode = gl.getUniformLocation(this.program, "mode");
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindVertexArray(null);
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
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].buffer);
    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LESS);
  }

  draw() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    // sigma = 0.45% of the short edge, independent of screen orientation.
    const stride = Math.min(this.width, this.height) * 0.0045 / 4;
    for (let i = 0; i < 3; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, i === 2 ? null : this.targets[1 - i].buffer);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[i % 2].texture);
      gl.uniform2f(this.step, i === 0 ? stride / this.width : 0, i === 1 ? stride / this.height : 0);
      gl.uniform1f(this.mode, i === 2 ? 1 : 0);
      if (i === 2) gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  dispose() {
    this.gl.deleteRenderbuffer(this.depth);
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
    for (const target of this.targets) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.buffer);
    }
  }
}
