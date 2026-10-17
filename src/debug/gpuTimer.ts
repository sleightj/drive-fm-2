/**
 * GPU time of the frame's draw, from EXT_disjoint_timer_query_webgl2 where the browser
 * offers it (results arrive a few frames late; a disjoint event drops them). `last` is the
 * most recent result in ms, or -1 when unavailable.
 */
export class GpuTimer {
  private ext: any;
  private free: WebGLQuery[] = [];
  private busy: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  last = -1;
  readonly available: boolean;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.available = !!this.ext;
  }

  begin() {
    if (!this.ext || this.active) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.busy.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.busy.length) {
      const q = this.busy[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.busy.shift();
      this.free.push(q);
      if (!disjoint) this.last = ns / 1e6;
    }
  }
}
