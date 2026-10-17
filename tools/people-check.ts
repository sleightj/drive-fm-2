/**
 * Pedestrian checks, in Node (the crowd logic without three's skinning):
 *   npx tsx tools/people-check.ts [--seeds 1,2,3] [--km 10] [--gfx high|low|verylow] [--fps 60]
 *                                 [--switch N] [--det] [--dump file] [--alloc] [--verbose]
 * Streams the road and the city like tools/world-bench.ts while a car drives the road with a
 * chase camera (stops, crawls and cruises), and runs the crowd every frame. Checks every frame:
 *  - nobody's body on any road's drivable band or its kerb band (projection on every path near)
 *  - nobody inside an obstacle (the roadside's own circles), nobody overlapping anybody
 *  - nobody off the walk band of their sidewalk
 *  - counts within the level's budget; pool size flat
 *  - spawns and despawns never in the camera's view nearer than the far ring, and beyond it
 *    only with a fade (no pops at any distance)
 * and reports the crowd's cost per frame (wall and CPU time, spikes set against GC pauses; the
 * loading-time read of the sidewalks and the first frame apart), people per mood against what
 * the sidewalks would hold, and memory per km (heapByKm, heapGrowth from km 5 to the end).
 * --alloc also reports the JS heap the crowd allocates per frame (garbage is later GC work).
 * --verbose logs what each frame over 2 ms did (chunks read, spawns, departures).
 * --switch N cycles the graphics level (high → low → verylow) every N km, like the pause menu;
 * the surplus dropped at a switch is counted (switchDrops), not failed.
 * Memory per km is the whole process (the world streams in it too); run node with --expose-gc
 * (node --expose-gc --import tsx tools/people-check.ts …) to read it after a full collection.
 * Exits 1 when any check failed.
 */
import { RoadGenerator } from '../src/road/generator';
import { RoadStream } from '../src/road/stream';
import { RoadSurface } from '../src/road/surface';
import { WearField } from '../src/road/wear';
import { Path, resetPathIds } from '../src/road/path';
import { Rng } from '../src/core/rng';
import { ChunkManager } from '../src/world/chunks';
import { TerrainField } from '../src/world/terrain';
import { TerrainClipmap } from '../src/world/terrainClipmap';
import { Roadside } from '../src/world/roadside';
import { Footprints } from '../src/world/footprints';
import { makeRoadMaterial, makeWearPool } from '../src/render/roadMaterial';
import { makeWorldMaterial } from '../src/render/worldMaterial';
import { makeActorMaterial, makeInkMaterial } from '../src/render/actorMaterial';
import { PROP_STYLE, PROP_SLOTS_LIST } from '../src/world/kit/propStyle';
import { LEVELS, GraphicsLevel } from '../src/game';
import { GROUND_LAYERS, GROUND_TILES, SURFACES } from '../src/world/kit/street';
import { MOODS } from '../src/world/moods';
import { ChaseCamera } from '../src/vehicle/camera';
import { WalkNet, KERB_BAND, uMin, uMax, makeFrame } from '../src/people/walknet';
import { Crowd, CrowdView, MOOD_DENSITY, Person } from '../src/people/crowd';
const MODE_NAMES = ['walk', 'wait', 'turn', 'idle'];
const KIND_NAMES = ['walker', 'brisk', 'skater', 'loiter', 'group', 'busWait'];
import { crowdOptions, crowdLimits, PeopleMeta } from '../src/people/catalog';
import { DataArrayTexture, Frustum, Matrix4, PerspectiveCamera } from 'three';
import fs from 'node:fs';
import v8 from 'node:v8';
import { PerformanceObserver, performance as perf } from 'node:perf_hooks';

// CPU time (ms) of the process: unlike wall time it leaves out waits for a core on a shared
// machine (it does include V8's helper threads: concurrent GC, the compiler). The per-thread
// counters are only as fine as the scheduler tick (4 ms), too coarse for one frame.
const cpuNow = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '1,2,3').split(',').map(Number);
const KM = Number(opt('km', '10'));
const gfx = opt('gfx', 'high') as GraphicsLevel;
const L = LEVELS[gfx];
const verbose = args.includes('--verbose');
const FPS = Number(opt('fps', '60'));
/** switch the graphics level live every N km (high → low → verylow → high …), like the pause menu */
const SWITCH = Number(opt('switch', '0'));
/**
 * --det: a virtual clock. The road generator, the chunk builder, the roadside and the terrain
 * all slice their work by wall-clock budgets, so on a busy machine two runs of one seed build a
 * different world. With --det every performance.now() call advances 20 µs instead, the budgets
 * become call counts and a seed always replays the same (timings are still taken on the real
 * clock).
 */
const DET = args.includes('--det');
/** --dump file: write each frame's crowd wall time (ms) as JSON, e.g. to take the per-frame
 * minimum over repeated --det runs (what is left is the crowd's own work, not the machine's) */
const DUMP = opt('dump', '');
/** --alloc: the JS heap the crowd allocates per frame (heap use read around each update; frames
 * with a collection inside are left out) — garbage it makes is GC work later, i.e. stutter */
const ALLOC = args.includes('--alloc');
const heapNow = () => v8.getHeapStatistics().used_heap_size;
const realNow = perf.now.bind(perf);
if (DET) { let virt = 0; perf.now = () => (virt += 0.02); }

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/tex/world_layers.json', import.meta.url), 'utf8'));
const meta = JSON.parse(fs.readFileSync(new URL('../public/assets/people/people.json', import.meta.url), 'utf8')) as PeopleMeta;
const tex = {
  albedo: new DataArrayTexture(new Uint8Array(4), 1, 1, 1),
  emit: new DataArrayTexture(new Uint8Array(4), 1, 1, 1),
  layers: manifest.layers as Record<string, number>,
  L: (n: string) => { const v = manifest.layers[n]; if (v === undefined) throw new Error('no layer ' + n); return v; },
  bytes: 0,
};
const pct = (a: ArrayLike<number>, p: number) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
/**
 * Per-frame samples kept in typed-array blocks: their storage is off the JS heap, so the heap
 * read per km measures the world and the crowd, not this tool's own growing records.
 */
class Series {
  private blocks: Float64Array[] = [];
  length = 0;
  push(v: number) {
    const i = this.length & 65535;
    if (i === 0) this.blocks.push(new Float64Array(65536));
    this.blocks[this.blocks.length - 1][i] = v;
    this.length++;
  }
  at(i: number) { return this.blocks[i >>> 16][i & 65535]; }
  values() { const out = new Float64Array(this.length); for (let i = 0; i < this.length; i++) out[i] = this.at(i); return out; }
  sorted() { return this.values().sort(); }
  sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this.at(i); return s; }
  max() { let m = -Infinity; for (let i = 0; i < this.length; i++) m = Math.max(m, this.at(i)); return m; }
}
const countOver = (a: Float64Array, t: number) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] > t) n++; return n; };
// garbage collections (the world streaming in the same process allocates plenty): frames whose
// crowd update overlaps one are reported apart, so a GC pause is not taken for crowd work
// (spans: start, end, start, end …)
const gcs = new Series();
new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcs.push(e.startTime); gcs.push(e.startTime + e.duration); } }).observe({ entryTypes: ['gc'] });
const pt = { x: 0, z: 0, h: 0, k: 0 };

async function run(seed: number) {
  resetPathIds(1);
  const gen = new RoadGenerator({ seed });
  const stream = new RoadStream(gen);
  const wear = new WearField(seed, (x, z) => gen.districts.moodAt(x, z));
  const surface = new RoadSurface(gen.net, wear);
  const terrain = new TerrainField(seed, gen.districts);
  const tl = (m: string) => tex.L(GROUND_LAYERS[m as keyof typeof GROUND_LAYERS]);
  const clip = new TerrainClipmap(terrain, {
    levels: L.terrainLevels, moodLayers: MOODS.map((m) => tl(m)), moodTiles: MOODS.map((m) => GROUND_TILES[m]),
    slopeLayer: tex.L(SURFACES.earth.layer), slopeTile: SURFACES.earth.tile, albedo: tex.albedo,
  });
  const wearTex = makeWearPool(L.wearLayers, L.wearW, L.wearH);
  const roadMat = makeRoadMaterial(wearTex, L.wearPx, L.detail);
  const foot = new Footprints();
  const world = makeWorldMaterial({ albedo: tex.albedo, emit: tex.emit, cutout: true });
  const roadside = new Roadside({
    gen, surface, terrain, clip, tex, foot, seed, nearR: L.nearR, detail: L.detail,
    mats: { world, decal: world, prop: makeActorMaterial({ style: PROP_STYLE, slots: PROP_SLOTS_LIST }), ink: makeInkMaterial(1) },
  });
  const chunks = new ChunkManager(gen, surface, wearTex, roadMat, {
    radius: L.radius, wearRadius: 260, wearLayers: L.wearLayers, wearW: L.wearW, wearH: L.wearH, wearPx: L.wearPx,
  }, { roadside: (c) => roadside.jobsFor(c), upgrade: (c) => roadside.upgradeJobs(c), removed: (c) => roadside.removed(c) });
  const end = (p: Path) => Math.min(gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
  const rng = new Rng(seed * 31 + 7);

  const net = new WalkNet(chunks, roadside, (x, z, out) => gen.districts.moodWeights(x, z, out), MOOD_DENSITY);
  const co = crowdOptions(meta, L, seed);
  const crowd = new Crowd(net, co);
  let prewarm = { ms: 0, chunks: 0 };

  // the car: a point on the left lane, the chase camera behind it
  const camera = new PerspectiveCamera(74, 16 / 9, 0.3, 6000);
  const chase = new ChaseCamera(camera);
  const car = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, speed: 0, airborne: false, kmh: 0 };
  let cur: Path = gen.root;
  let s = 60, driven = 0;
  stream.ensure(cur, s);
  const lane = () => { const xs: any = {}; cur.xsAt(s, xs); return Math.min(xs.kerbL - 1.8, Math.max(1.7, xs.laneW * 0.5 + xs.median)); };
  const placeCar = (v: number) => {
    cur.pointAt(s, pt);
    const t = lane();
    car.x = pt.x + Math.cos(pt.h) * t; car.z = pt.z - Math.sin(pt.h) * t;
    car.y = surface.baseHeight(cur, s, t) + 0.5;
    car.yaw = pt.h; car.vx = Math.sin(pt.h) * v; car.vz = Math.cos(pt.h) * v; car.speed = v;
  };
  placeCar(0);
  terrain.sync(gen.net.paths, end);
  clip.update(car.x, car.z, 1e9, true);
  while (chunks.update(car.x, car.z, 1e9) > 0) { /* load */ }
  // as People.load(): the sidewalks of the chunks built while loading are read before frame 1
  { const t = realNow(); const n = net.prewarm(co.liveR + 70); prewarm = { ms: +(realNow() - t).toFixed(2), chunks: n }; }

  const frustum = new Frustum();
  const m = new Matrix4();
  const planes = new Float64Array(24);
  const view: CrowdView = { x: 0, y: 0, z: 0, fx: 0, fz: 1, planes };
  const setView = () => {
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    for (let i = 0; i < 6; i++) {
      const pl = frustum.planes[i];
      planes[i * 4] = pl.normal.x; planes[i * 4 + 1] = pl.normal.y; planes[i * 4 + 2] = pl.normal.z; planes[i * 4 + 3] = pl.constant;
    }
    view.x = camera.position.x; view.y = camera.position.y; view.z = camera.position.z;
    const d = camera.getWorldDirection(new (camera.position.constructor as any)());
    const l = Math.hypot(d.x, d.z) || 1;
    view.fx = d.x / l; view.fz = d.z / l;
  };
  // strict visibility for the checks: the body's own sphere (no margin)
  const visible = (p: { x: number; y: number; z: number; scale: number }) => {
    const cy = p.y + 0.9 * p.scale, r = 1.0 * p.scale;
    for (let i = 0; i < 24; i += 4) if (planes[i] * p.x + planes[i + 1] * cy + planes[i + 2] * p.z + planes[i + 3] < -r) return false;
    return true;
  };
  const distTo = (p: { x: number; y: number; z: number; scale: number }) => Math.hypot(p.x - view.x, p.y + 0.9 * p.scale - view.y, p.z - view.z);

  // speed plan: cruise, with stops and crawls (people must stay out of sight while the camera dwells)
  const speedAt = (d: number) => {
    const k = d % 2500;
    if (k < 120) return 0.01; // stop and look (crawl so the camera keeps its heading)
    if (k < 600) return 5;
    if (k < 1400) return 22;
    return 30;
  };
  let stopT = 0;

  const fails: Record<string, number> = { road: 0, kerb: 0, obstacle: 0, overlap: 0, band: 0, budget: 0, spawnInView: 0, despawnInView: 0, popIn: 0, popOut: 0 };
  const failSamples: string[] = [];
  const fail = (k: string, msg: string) => { fails[k]++; if (failSamples.length < 30) failSamples.push(`${k} @${(driven / 1000).toFixed(2)}km ${msg}`); };
  const crowdMs = new Series(), syncMs = new Series(), spawnMs = new Series(), moveMs = new Series();
  /** frames over 1 ms, 7 values each: start, end, sync, spawn, move, cpu, frame */
  const spikes = new Series();
  const cpuMs = new Series();
  const wanted: Record<string, Series> = {};
  const mem: { km: number; heapMB: number; pieces: number; obstacles: number; pool: number; active: number }[] = [];
  const counts: Record<string, Series> = {};
  const kinds = [0, 0, 0, 0, 0, 0];
  const modes = [0, 0, 0, 0];
  let switchDrops = 0;
  let firstFrame = {};
  // (what two heap readings in a row cost, taken off each frame's)
  let allocBase = 0, allocSum = 0, allocN = 0, allocMax = 0;
  const allocS = new Series();
  if (ALLOC) { for (let i = 0; i < 200; i++) { const a = heapNow(); allocBase += heapNow() - a; } allocBase /= 200; }
  let lastKm = 0, frames = 0, worldFrames = 0, visSum = 0;
  const prev = new Map<Person, { x: number; y: number; z: number; scale: number; serial: number; appear: number }>();
  let fadeIns = 0, fadeOuts = 0;
  const ff = makeFrame();
  const roadBlocks = new Set<{ path: Path; i0: number; i1: number }>();
  const xs: any = {};
  const dt = 1 / FPS;

  // the roadside's own obstacle circles (independent of the crowd's capsules)
  const circles = new Map<object, { x: number; z: number; r: number }[]>();

  while (driven < KM * 1000) {
    let v = speedAt(driven);
    if (v < 0.1) { stopT += dt; if (stopT > 12) { v = 5; } } else stopT = 0;
    const step = v * dt;
    s += step; driven += step;
    if (cur.forkS !== null && s >= cur.forkS) {
      const f = stream.forkOf(cur)!;
      const b = rng.next() < 0.5 ? f.left : f.right;
      s -= cur.forkS; cur = b;
    }
    if (Math.floor(driven / 0.5) % 12 === 0 || frames % 12 === 0) {
      const js = cur.junctionStart;
      stream.ensure(cur, s, 2);
      if (js && s > js.nose) stream.enter(cur);
      const removed = stream.trim(cur, s);
      for (const p of removed) wear.drop(p);
      if (removed.length) roadside.trimRuns(new Set(gen.net.paths.map((q) => q.id)));
      wear.trim(cur, s - 400);
    }
    placeCar(v);
    const rects = terrain.sync(gen.net.paths, end);
    if (rects.length) clip.invalidate(rects);
    chunks.update(car.x, car.z, L.budgetMs);
    clip.update(car.x, car.z, L.terrainMs);
    chase.update(car as any, dt, 0, 0, 0);
    setView();
    let switched = false;
    if (SWITCH > 0 && Math.floor(driven / (SWITCH * 1000)) !== Math.floor((driven - step) / (SWITCH * 1000))) {
      switched = true;
      const order: GraphicsLevel[] = ['high', 'low', 'verylow'];
      const g = order[Math.floor(driven / (SWITCH * 1000)) % 3];
      const lim = crowdLimits(LEVELS[g]);
      crowd.setLimits(lim);
      co.cap = lim.cap; co.farR = lim.farR; co.liveR = lim.liveR;
      if (verbose) console.error(`switch to ${g}: cap ${lim.cap}, active ${crowd.active.length}`);
    }
    const h0 = ALLOC ? heapNow() : 0;
    const was = verbose ? [net.stats.polled, net.pieces.length, crowd.stats.spawned, crowd.stats.attempts, crowd.stats.despawned] : null;
    const c0 = cpuNow(), u0 = realNow();
    crowd.update(dt, view, car);
    const u1 = realNow(), cpu = cpuNow() - c0;
    // (what a slow frame did: chunks read, pieces added, spawns and tries, departures)
    if (was && u1 - u0 > 2) console.error(`slow frame ${frames}: ${(u1 - u0).toFixed(2)} ms, cpu ${cpu.toFixed(2)}; polled +${net.stats.polled - was[0]}, pieces ${was[1]}→${net.pieces.length}, spawned +${crowd.stats.spawned - was[2]}, tries +${crowd.stats.attempts - was[3]}, left +${crowd.stats.despawned - was[4]}, active ${crowd.active.length}`);
    if (ALLOC) { const d = heapNow() - h0 - allocBase; if (d >= -allocBase) { allocSum += Math.max(0, d); allocN++; allocMax = Math.max(allocMax, d); allocS.push(Math.max(0, d)); } }
    cpuMs.push(cpu);
    if (u1 - u0 > 1) for (const v of [u0, u1, crowd.stats.syncMs, crowd.stats.spawnMs, crowd.stats.moveMs, cpu, frames]) spikes.push(v);
    // the first frame fills the empty view at once (walk network for the whole live ring, then everyone)
    if (frames === 0) firstFrame = { ms: +(u1 - u0).toFixed(2), cpu: +cpu.toFixed(2), sync: +crowd.stats.syncMs.toFixed(2), spawn: +crowd.stats.spawnMs.toFixed(2), active: crowd.active.length, pieces: net.pieces.length };
    frames++;
    if (frames % 2000 === 0) await new Promise((r) => setImmediate(r)); // let GC entries arrive
    // (the crowd's own part timings read performance.now(): virtual under --det, so left out)
    crowdMs.push(u1 - u0);
    if (!DET) { syncMs.push(crowd.stats.syncMs); spawnMs.push(crowd.stats.spawnMs); moveMs.push(crowd.stats.moveMs); }

    // ---- checks
    const act = crowd.active;
    if (act.length > co.cap) fail('budget', `${act.length} > ${co.cap}`);
    // spawns: never in view nearer than the far ring (frame 1 fills the empty view and is exempt)
    if (frames > 1) for (const sp of crowd.spawnLog) {
      if (visible(sp.p) && distTo(sp.p) < co.farR) fail('spawnInView', `kind ${sp.p.kind} at ${distTo(sp.p).toFixed(1)} m`);
      // at any distance, someone appearing in view fades in (dither) rather than pops
      if (visible(sp.p) && sp.p.appear > 0.05) fail('popIn', `kind ${sp.p.kind} at ${distTo(sp.p).toFixed(1)} m, opacity ${sp.p.appear.toFixed(2)}`);
      if (visible(sp.p)) fadeIns++;
    }
    // despawns: gone this frame, in view, near
    const now = new Map<Person, number>();
    for (const p of act) now.set(p, p.serial);
    for (const [p, st] of prev) {
      if (now.get(p) === st.serial) continue;
      if (visible(st) && distTo(st) < co.farR) {
        // a lower graphics level drops the surplus at once (pause menu): counted, not a failure
        if (switched) switchDrops++;
        else fail('despawnInView', `at ${distTo(st).toFixed(1)} m`);
      } else if (visible(st) && !switched) {
        if (st.appear > 0.02) fail('popOut', `at ${distTo(st).toFixed(1)} m, opacity ${st.appear.toFixed(2)}`);
        fadeOuts++;
      }
    }
    prev.clear();
    for (const p of act) prev.set(p, { x: p.x, y: p.y, z: p.z, scale: p.scale, serial: p.serial, appear: p.appear });
    // bodies
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      kinds[p.kind]++; modes[p.mode]++;
      if (visible(p)) visSum++;
      for (let j = i + 1; j < act.length; j++) {
        const q = act[j];
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < p.r + q.r - 1e-6) fail('overlap', `${d.toFixed(3)} < ${(p.r + q.r).toFixed(3)} (${MODE_NAMES[p.mode]}/${MODE_NAMES[q.mode]})`);
      }
      // walk band of its own sidewalk
      net.frame(p.piece, p.s, p.u, p.row, ff);
      if (p.u < uMin(ff.inner, p.r) - 1e-4 || p.u > uMax(ff.outer, p.r) + 1e-4) fail('band', `u ${p.u.toFixed(3)} not in [${uMin(ff.inner, p.r).toFixed(3)}, ${uMax(ff.outer, p.r).toFixed(3)}]`);
      // every road nearby: the body clear of its drivable band and kerb band. Every stretch of a
      // path that passes within 30 m (each local minimum of the distance to its samples) is
      // projected exactly, by a ternary search along its centreline, so a road that bends back
      // past the sidewalk is seen as well as the sidewalk's own
      roadBlocks.clear();
      gen.net.blocks.query(p.x - 30, p.z - 30, p.x + 30, p.z + 30, (b) => { roadBlocks.add(b); });
      for (const b of roadBlocks) {
        const q = b.path;
        const d2 = (k: number) => (q.sx(k) - p.x) ** 2 + (q.sz(k) - p.z) ** 2;
        const c2 = (sv: number) => { q.pointAt(sv, pt); return (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2; };
        for (let k = Math.max(b.i0, q.base); k <= Math.min(b.i1, q.sampleEnd); k++) {
          const d = d2(k);
          if (d > 900 || (k > q.base && d2(k - 1) < d) || (k < q.sampleEnd && d2(k + 1) < d)) continue;
          let a = Math.max(q.base, k - 1), c = Math.min(q.sampleEnd, k + 1);
          for (let it = 0; it < 40; it++) {
            const m1 = a + (c - a) / 3, m2 = c - (c - a) / 3;
            if (c2(m1) < c2(m2)) c = m2; else a = m1;
          }
          const sm = (a + c) / 2;
          if (sm <= q.base + 0.5 || sm >= q.sampleEnd - 0.5) continue;
          q.pointAt(sm, pt);
          const t = (p.x - pt.x) * Math.cos(pt.h) - (p.z - pt.z) * Math.sin(pt.h);
          q.xsAt(sm, xs);
          const [lo, hi] = q.drivableAt(sm, xs);
          const out = t > hi ? t - hi : t < lo ? lo - t : -1;
          if (out < 0) fail('road', `on path ${q.id} s ${sm.toFixed(1)} t ${t.toFixed(2)} band [${lo.toFixed(2)}, ${hi.toFixed(2)}] (piece path ${p.piece.path.id} s ${p.s.toFixed(1)})`);
          else if (out < KERB_BAND + p.r - 1e-3) fail('kerb', `path ${q.id} s ${sm.toFixed(1)}: ${(out - p.r).toFixed(3)} m from the kerb line (piece path ${p.piece.path.id} s ${p.s.toFixed(1)})`);
          if (out < KERB_BAND + p.r - 1e-3 && verbose) console.error(JSON.stringify({ frame: frames, clearance: +net.roadClearance(p.piece, p.x, p.z, 5).toFixed(3), roads: p.piece.roads.length / 6, born: p.piece.born, pathEndAtBirth: p.piece.pathEnd, sampleEnd: q.sampleEnd, js: q.junctionStart ? q.junctionStart.nose : null, je: q.junctionEnd ? [q.junctionEnd.s0, q.junctionEnd.s1] : null, path: q.id, projS: +sm.toFixed(2), projT: +t.toFixed(3), lo, hi, piece: p.piece.id, piecePath: p.piece.path.id, side: p.piece.side, chunk: p.piece.chunk.key, s: +p.s.toFixed(2), s0: p.piece.s0, s1: p.piece.s1, u: +p.u.toFixed(3), inner: +ff.inner.toFixed(3), outer: +ff.outer.toFixed(3), px: +p.x.toFixed(2), pz: +p.z.toFixed(2), mode: MODE_NAMES[p.mode], kind: KIND_NAMES[p.kind], age: +p.age.toFixed(1), forkS: q.forkS, base: q.base }));
        }
      }
    }
    // obstacles (the roadside's circles), refreshed for chunks the crowd knows
    if (frames % 30 === 1) {
      circles.clear();
      for (const c of chunks.chunks.values()) {
        const w = roadside.walkways(c);
        if (w.obstacles.length) circles.set(c, w.obstacles);
      }
    }
    for (const p of act) {
      for (const list of circles.values()) for (const o of list) {
        if (Math.abs(o.x - p.x) > 4 || Math.abs(o.z - p.z) > 4) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d < o.r + p.r - 1e-6) fail('obstacle', `${d.toFixed(3)} < ${(o.r + p.r).toFixed(3)} r ${o.r}`);
      }
    }
    // density by mood
    const mood = gen.districts.moodAt(car.x, car.z);
    (counts[mood] ??= new Series()).push(act.length);
    (wanted[mood] ??= new Series()).push(crowd.stats.wanted);
    worldFrames++;
    if (driven - lastKm >= 1000) {
      lastKm = driven;
      // (run node with --expose-gc for the live heap after a full collection)
      const g = (globalThis as { gc?: () => void }).gc;
      if (g) g();
      mem.push({ km: Math.round(driven / 1000), heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), pieces: net.pieces.length, obstacles: net.stats.obstacles, pool: crowd.pool.length, active: act.length });
      if (verbose) console.error(`seed ${seed} km ${Math.round(driven / 1000)} active ${act.length} pieces ${net.pieces.length} fails ${JSON.stringify(fails)}`);
    }
  }
  await new Promise((r) => setImmediate(r));
  if (DUMP) fs.writeFileSync(DUMP.replace('%s', String(seed)), JSON.stringify(Array.from(crowdMs.values(), (x) => +x.toFixed(4))));
  const sorted = crowdMs.sorted();
  const inGc = (a: number, b: number) => { for (let i = 0; i < gcs.length; i += 2) if (gcs.at(i) < b && gcs.at(i + 1) > a) return true; return false; };
  const sp: { ms: number; gc: boolean; sy: number; spn: number; mv: number; cpu: number; fr: number }[] = [];
  for (let i = 0; i < spikes.length; i += 7) {
    const a = spikes.at(i), b = spikes.at(i + 1);
    sp.push({ ms: b - a, gc: inGc(a, b), sy: spikes.at(i + 2), spn: spikes.at(i + 3), mv: spikes.at(i + 4), cpu: spikes.at(i + 5), fr: spikes.at(i + 6) });
  }
  if (verbose) for (const x of sp) if (x.ms > 2) console.error(`spike frame ${x.fr} ${x.ms.toFixed(2)} ms cpu ${x.cpu.toFixed(2)} gc ${x.gc}`);
  const cpuSorted = cpuMs.sorted();
  const noGc = sp.filter((x) => !x.gc).sort((x, y) => y.ms - x.ms);
  const kindN = kinds.reduce((a, b) => a + b, 0) || 1, modeN = modes.reduce((a, b) => a + b, 0) || 1;
  return {
    seed, km: KM, gfx, fps: FPS, cap: co.cap, frames,
    /** the first frame's cost (parts on the virtual clock under --det: see ms and cpu) */
    prewarm, firstFrame,
    ...(ALLOC ? { alloc: (() => { const q = allocS.sorted(); return { bytesPerFrame: Math.round(allocSum / Math.max(1, allocN)), p50: Math.round(pct(q, 0.5)), p95: Math.round(pct(q, 0.95)), p99: Math.round(pct(q, 0.99)), maxBytes: Math.round(allocMax), frames: allocN }; })() } : {}),
    fails, failSamples, switchDrops, fadeIns, fadeOuts,
    crowdMs: { mean: +(crowdMs.sum() / sorted.length).toFixed(3), p95: +pct(sorted, 0.95).toFixed(3), p99: +pct(sorted, 0.99).toFixed(3), max: +sorted[sorted.length - 1].toFixed(3) },
    parts: DET ? 'n/a under --det' : Object.fromEntries(([['sync', syncMs], ['spawn', spawnMs], ['move', moveMs]] as [string, Series][]).map(([k, a]) => { const q = a.sorted(); return [k, { mean: +(a.sum() / q.length).toFixed(3), p99: +pct(q, 0.99).toFixed(3), max: +q[q.length - 1].toFixed(2) }]; })),
    spikes: {
      over1ms: sp.length, over2ms: sp.filter((x) => x.ms > 2).length, over4ms: sp.filter((x) => x.ms > 4).length,
      over2msDuringGc: sp.filter((x) => x.ms > 2 && x.gc).length,
      /** over 2 ms of wall time and of CPU time, with no GC: the crowd's own work (or the compiler) */
      over2msBusy: sp.filter((x) => x.ms > 2 && x.cpu > 2 && !x.gc).length,
      over4msBusy: sp.filter((x) => x.ms > 4 && x.cpu > 4 && !x.gc).length,
      worstBusy: noGc.filter((x) => x.cpu > 2).slice(0, 3).map((x) => ({ ms: +x.ms.toFixed(2), cpu: +x.cpu.toFixed(2), sync: +x.sy.toFixed(2), spawn: +x.spn.toFixed(2), move: +x.mv.toFixed(2) })),
    },
    /** the crowd's CPU time per frame (process CPU: not counting waits for a core) */
    cpuMs: {
      mean: +(cpuMs.sum() / cpuSorted.length).toFixed(3), p95: +pct(cpuSorted, 0.95).toFixed(3), p99: +pct(cpuSorted, 0.99).toFixed(3),
      p999: +pct(cpuSorted, 0.999).toFixed(3), max: +cpuSorted[cpuSorted.length - 1].toFixed(3),
      over1ms: countOver(cpuSorted, 1), over2ms: countOver(cpuSorted, 2), over4ms: countOver(cpuSorted, 4),
    },
    peoplePerMood: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { frames: v.length, mean: +(v.sum() / v.length).toFixed(1), max: v.max(), wanted: +(wanted[k].sum() / v.length).toFixed(1) }])),
    meanVisible: +(visSum / frames).toFixed(1),
    kinds: Object.fromEntries(kinds.map((n, i) => [KIND_NAMES[i], +(n / kindN).toFixed(3)])),
    modes: Object.fromEntries(modes.map((n, i) => [MODE_NAMES[i], +(n / modeN).toFixed(3)])),
    stats: { ...crowd.stats, links: net.stats.links, forkLinks: net.stats.forkLinks, busStops: net.stats.busStops, clippedRows: net.stats.clippedRows },
    mem: mem.length > 6 ? [mem[0], mem[1], mem[Math.floor(mem.length / 2)], mem[mem.length - 1]] : mem,
    /** the heap (MB) at each km, and its change from km 5 (or the first reading) to the last */
    heapByKm: mem.map((x) => x.heapMB),
    heapGrowth: mem.length > 1 ? +((mem[mem.length - 1].heapMB / mem[Math.min(4, mem.length - 2)].heapMB - 1) * 100).toFixed(1) + ' %' : 'n/a',
  };
}

let bad = 0;
for (const seed of seeds) {
  const r = await run(seed);
  console.log(JSON.stringify(r, null, 1));
  const f = r.fails;
  if (Object.values(f).some((n) => n > 0)) bad++;
}
process.exit(bad ? 1 : 0);
