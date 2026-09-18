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
void main() {
  vec3 color = texture(image, uv).rgb;
  float shade = 0.86 - 0.12 * smoothstep(0.12, 0.65, length(uv - 0.5));
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color = color * shade + grain / 255.0;
  outputColor = vec4(color, 1.0);
}`;

// Hold the low-resolution composition before the final full-size copy. The
// artwork itself is pre-blurred once when a cover arrives.
export class Blur {
  width = 0;
  height = 0;
  private readonly program: WebGLProgram;
  private readonly depth: WebGLRenderbuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly targets: { texture: WebGLTexture; buffer: WebGLFramebuffer }[];

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
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindVertexArray(null);
    this.depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    this.targets = Array.from({ length: 1 }, () => {
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
    // Keep enough pixels for the fold edge. The artwork source is still
    // 128px and Kawase-blurred once; only the deformed contour gets this
    // higher-resolution target.
    const scale = Math.min(1, 768 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
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
    // Artwork is blurred once during cover preparation. The animation pass
    // only upscales that low-resolution result, keeping the flow at a stable
    // 60 FPS without paying for a full separable blur every frame.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
