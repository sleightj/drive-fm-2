import type { Game } from '../game';
import { GpuTimer } from './gpuTimer';

/**
 * Benchmark route and overlay (?bench): a fixed seed driven by the autopilot from the
 * downtown start at dusk (lamps, lit windows, the busiest streets), for `duration` seconds.
 * The overlay shows live frame interval, JS time, GPU time (timer queries, where the browser
 * offers them), draw calls and triangles; at the end it freezes a summary against the
 * level's budgets (docs/DESIGN.md §6): frame interval p95 ≤ 14 ms at HIGH (16.7 ms at LOW and
 * VERY LOW), JS p95 within its budget, calls and triangles within budget at every frame.
 * Vsync caps the interval at the display's rate: for a true reading run the browser with
 * vsync off (e.g. Chrome --disable-gpu-vsync --disable-frame-rate-limit).
 */
const BUDGET = {
  high: { frame: 14, js: 7, calls: 650, tris: 1.2e6 },
  low: { frame: 16.7, js: 6, calls: 420, tris: 700e3 },
  verylow: { frame: 16.7, js: 5, calls: 260, tris: 320e3 },
};

export class BenchOverlay {
  private el: HTMLDivElement;
  private interval: number[] = [];
  private js: number[] = [];
  private gpu: number[] = [];
  private calls = 0;
  private tris = 0;
  private worldMax = 0;
  private last = 0;
  private t0 = 0;
  private shownAt = 0;
  private done = false;
  readonly timer: GpuTimer;

  constructor(private game: Game, private duration = 90) {
    this.timer = new GpuTimer(game.renderer.getContext() as WebGL2RenderingContext);
    const el = (this.el = document.createElement('div'));
    el.style.cssText = 'position:fixed;left:10px;top:10px;z-index:30;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e8ffd0;background:rgba(10,10,26,.78);padding:8px 10px;border-left:3px solid #c8ff1a;white-space:pre;pointer-events:none;min-width:250px';
    document.body.appendChild(el);
  }

  /** Called once per frame, after the frame is drawn. */
  frame() {
    const now = performance.now();
    const g = this.game;
    if (g.state !== 'driving') { this.last = now; return; }
    if (!this.t0) { this.t0 = now; this.last = now; return; }
    const ri = g.renderer.info.render;
    if (!this.done) {
      // skip the first two seconds (shader compiles, first uploads)
      if (now - this.t0 > 2000) {
        this.interval.push(now - this.last);
        this.js.push(g.metrics.frameMs - g.metrics.renderMs);
        if (this.timer.last >= 0) this.gpu.push(this.timer.last);
        this.calls = Math.max(this.calls, ri.calls);
        this.tris = Math.max(this.tris, ri.triangles);
        this.worldMax = Math.max(this.worldMax, g.metrics.worldMs);
      }
      if (now - this.t0 > this.duration * 1000) { this.done = true; this.summary(); }
    }
    this.last = now;
    if (!this.done && now - this.shownAt > 500) {
      this.shownAt = now;
      const W = Math.round(g.renderer.domElement.width), H = Math.round(g.renderer.domElement.height);
      const iv = this.interval.slice(-120), jv = this.js.slice(-120), gv = this.gpu.slice(-120);
      this.el.textContent = [
        `DRIVE FM BENCH  ${g.graphics.toUpperCase()}  ${W}×${H}`,
        `time        ${Math.max(0, Math.round(this.duration - (now - this.t0) / 1000))} s left`,
        `frame       ${fmt(avg(iv))} ms   p95 ${fmt(pct(iv, 0.95))}   ${Math.round(1000 / Math.max(1, avg(iv)))} fps`,
        `js          ${fmt(avg(jv))} ms   p95 ${fmt(pct(jv, 0.95))}`,
        `gpu         ${this.timer.available ? `${fmt(avg(gv))} ms   p95 ${fmt(pct(gv, 0.95))}` : 'timer queries unavailable'}`,
        `calls/tris  ${ri.calls}  ${(ri.triangles / 1000).toFixed(0)}k`,
        `world       ${fmt(g.metrics.worldMs)} ms   ${(g.car.odometer / 1000).toFixed(2)} km`,
      ].join('\n');
    }
  }

  private summary() {
    const g = this.game;
    const b = BUDGET[g.graphics];
    const W = g.renderer.domElement.width, H = g.renderer.domElement.height;
    const f95 = pct(this.interval, 0.95), j95 = pct(this.js, 0.95), g95 = pct(this.gpu, 0.95);
    const rows: [string, string, boolean][] = [
      ['frame p95', `${fmt(f95)} ms (≤ ${b.frame})`, f95 <= b.frame],
      ['frame p99', `${fmt(pct(this.interval, 0.99))} ms`, true],
      ['js p95', `${fmt(j95)} ms (≤ ${b.js})`, j95 <= b.js],
      ['gpu p95', this.gpu.length ? `${fmt(g95)} ms` : 'n/a', true],
      ['draw calls', `${this.calls} (≤ ${b.calls})`, this.calls <= b.calls],
      ['triangles', `${(this.tris / 1000).toFixed(0)}k (≤ ${b.tris / 1000}k)`, this.tris <= b.tris],
      ['world max', `${fmt(this.worldMax)} ms (≤ 20)`, this.worldMax <= 20],
    ];
    const pass = rows.every((r) => r[2]);
    this.el.textContent = [
      `DRIVE FM BENCH  ${g.graphics.toUpperCase()}  ${W}×${H}  ${pass ? 'PASS' : 'FAIL'}`,
      `${this.interval.length} frames over ${this.duration - 2} s`,
      ...rows.map(([k, v, ok]) => `${ok ? '  ' : '✗ '}${k.padEnd(11)} ${v}`),
    ].join('\n');
    this.el.style.borderLeftColor = pass ? '#c8ff1a' : '#ff2d88';
    (window as any).__DRIVE_FM_BENCH__ = { pass, level: g.graphics, width: W, height: H, frameP95: f95, jsP95: j95, gpuP95: this.gpu.length ? g95 : null, calls: this.calls, tris: this.tris, worldMax: this.worldMax, frames: this.interval.length };
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function pct(a: number[], p: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
const fmt = (v: number) => v.toFixed(1);
