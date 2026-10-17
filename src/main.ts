import { Game, GraphicsLevel } from './game';
import { TIME_NAMES } from './render/environment';
import type { Mood } from './world/moods';

/**
 * Boot: read options (URL parameters are for tests and the benchmark), load, then hand over
 * to the game loop. window.__DRIVE_FM__ is the test API used by the headless harnesses.
 */
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
let level: GraphicsLevel = 'high';
try {
  const saved = localStorage.getItem('drivefm.graphics');
  if (saved === 'high' || saved === 'low' || saved === 'verylow') level = saved;
} catch { /* storage unavailable */ }
if (q.has('gfx')) level = q.get('gfx') as GraphicsLevel;
const timeQ = q.get('time');
const hour = timeQ ? (TIME_NAMES[timeQ] ?? Number(timeQ)) : 15.2;
const seed = num('seed', Math.floor(Math.random() * 1e6));

const app = document.getElementById('app')!;
const boot = document.createElement('div');
boot.id = 'boot';
boot.textContent = 'DRIVE FM';
app.appendChild(boot);

const game = new Game(app, {
  seed,
  level,
  hour,
  autopilot: q.has('auto'),
  simRate: num('rate', 1),
  freezeTime: q.has('freeze'),
  fixedStep: q.has('fixed'),
  startMood: (q.get('mood') as Mood | null) ?? null,
});

const api = {
  get state() { return game.state; },
  game,
  info() {
    const r = game.renderer.info;
    const c = game.car;
    return {
      state: game.state,
      seed,
      level,
      fps: 1000 / Math.max(1, game.metrics.frameMs),
      metrics: { ...game.metrics },
      calls: r.render.calls,
      triangles: r.render.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
      chunks: game.chunks?.chunks.size ?? 0,
      paths: game.gen.net.paths.length,
      car: { kmh: c.kmh, x: c.x, z: c.z, y: c.y, onRoad: c.loc.inside, path: c.loc.path?.id, s: c.loc.s, t: c.loc.t, boost: c.boost, air: c.lastAir, odometer: c.odometer },
      hour: game.hour,
      heap: (performance as any).memory?.usedJSHeapSize ?? 0,
      load: (window as any).__DRIVE_FM_LOAD__,
    };
  },
  setHour(h: number | string) { game.setHour(h); },
  start() { if (game.state === 'title') game.setState('driving'); },
  /** Start recording per-frame samples, or take (and clear) what was recorded. */
  record(on: boolean) { game.rec = on ? [] : null; },
  takeFrames() { const r = game.rec ?? []; if (game.rec) game.rec = []; return r; },
  timing() { return { chunks: game.chunks?.timing, stats: game.chunks?.stats }; },
};
(window as any).__DRIVE_FM__ = api;

game.load((p, label) => { boot.textContent = `DRIVE FM  ${Math.round(p * 100)}%  ${label}`; }).then(() => {
  boot.remove();
  game.start();
}).catch((e) => {
  boot.textContent = 'DRIVE FM could not start: ' + (e?.message ?? e);
  (window as any).__DRIVE_FM_ERROR__ = String(e?.stack ?? e);
  console.error(e);
});
