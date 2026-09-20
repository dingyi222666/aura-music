/** Bound driver work and sample actual GPU time without blocking either thread. */
export class Budget {
  scale = 1;
  private readonly fences: WebGLSync[] = [];
  private readonly timer;
  private query: WebGLQuery | null = null;
  private measuring = false;
  private count = 0;
  private pressure = 0;
  private headroom = 0;
  private changed = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  private lower(now: number) {
    if (now - this.changed < 3000) return;
    this.scale = Math.max(0.625, this.scale - 0.125);
    this.changed = now;
    this.pressure = this.headroom = 0;
  }

  begin(now: number) {
    const gl = this.gl;
    while (this.fences.length) {
      const result = gl.clientWaitSync(this.fences[0], 0, 0);
      if (result === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(this.fences.shift()!);
    }
    if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
        this.pressure = ms > 7 ? this.pressure + 1 : 0;
        this.headroom = ms < 3 ? this.headroom + 1 : 0;
        if (this.pressure >= 4) this.lower(now);
        if (this.headroom >= 40 && now - this.changed > 20000) {
          this.scale = Math.min(1, this.scale + 0.125);
          this.changed = now;
          this.headroom = 0;
        }
      }
      gl.deleteQuery(this.query);
      this.query = null;
    }
    // Never enqueue an unbounded chain when a driver/thermal limit slows down.
    if (this.fences.length >= 2) {
      if (++this.pressure >= 12) this.lower(now);
      return false;
    }
    if (this.timer && !this.query && this.count++ % 30 === 0) {
      this.query = gl.createQuery();
      if (this.query) {
        gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query);
        this.measuring = true;
      }
    }
    return true;
  }

  end() {
    const gl = this.gl;
    if (this.measuring) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.measuring = false;
    }
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence) this.fences.push(fence);
    gl.flush();
  }

  dispose() {
    if (this.measuring) this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.measuring = false;
    if (this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    for (const fence of this.fences) this.gl.deleteSync(fence);
    this.fences.length = 0;
  }
}
