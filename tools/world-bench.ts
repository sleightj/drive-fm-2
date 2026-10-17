/**
 * World-building benchmark and checks, in Node (no GPU, nothing competing for the CPU):
 *   npx tsx tools/world-bench.ts [--seeds 7] [--km 5] [--gfx high] [--slice 4]
 * Streams the road and the city exactly as the game does while a point drives the road at
 * 30 m/s in 1/60 s frames, giving the world builder the level's per-frame slice. Reports:
 *  - cost per kind of job (count, mean, p95, max) and the worst frames of world building
 *  - footprint overlaps (buildings, car parks and lots must never overlap)
 *  - memory flatness: live chunks, footprints, cached runs and JS heap per km
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
import { Skyline } from '../src/world/skyline';
import { Footprints, overlap } from '../src/world/footprints';
import { makeRoadMaterial, makeWearPool } from '../src/render/roadMaterial';
import { makeWorldMaterial } from '../src/render/worldMaterial';
import { makeActorMaterial, makeInkMaterial } from '../src/render/actorMaterial';
import { PROP_STYLE, PROP_SLOTS_LIST } from '../src/world/kit/propStyle';
import { LEVELS, GraphicsLevel } from '../src/game';
import { GROUND_LAYERS, GROUND_TILES, SURFACES } from '../src/world/kit/street';
import { MOODS } from '../src/world/moods';
import { DataArrayTexture } from 'three';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '7').split(',').map(Number);
const KM = Number(opt('km', '5'));
const gfx = opt('gfx', 'high') as GraphicsLevel;
const L = LEVELS[gfx];
const slice = Number(opt('slice', String(L.budgetMs)));

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/tex/world_layers.json', import.meta.url), 'utf8'));
const tex = {
  albedo: new DataArrayTexture(new Uint8Array(4), 1, 1, 1),
  emit: new DataArrayTexture(new Uint8Array(4), 1, 1, 1),
  layers: manifest.layers as Record<string, number>,
  L: (n: string) => { const v = manifest.layers[n]; if (v === undefined) throw new Error('no layer ' + n); return v; },
  bytes: 0,
};

const pt = { x: 0, z: 0, h: 0, k: 0 };
const pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

function run(seed: number) {
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
  const skyline = new Skyline({ gen, ground: (x, z) => clip.heightAt(x, z) ?? terrain.gridHeight(Math.round(x / 4), Math.round(z / 4), 4), mat: makeWorldMaterial({ albedo: tex.albedo, emit: tex.emit, cutout: true }), L: tex.L, seed, outer: L.skyline });
  const end = (p: Path) => Math.min(gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
  const rng = new Rng(seed * 31 + 1);

  // per-job samples (wrap the job runner by timing labels from the manager)
  const samples: Record<string, number[]> = {};
  const origTime = (chunks as any).time.bind(chunks);
  (chunks as any).time = (label: string, ms: number) => { (samples[label] ??= []).push(ms); origTime(label, ms); };

  let cur: Path = gen.root;
  let s = 60, driven = 0;
  stream.ensure(cur, s);
  cur.pointAt(s, pt);
  const t0 = performance.now();
  terrain.sync(gen.net.paths, end);
  clip.update(pt.x, pt.z, 1e9, true);
  while (chunks.update(pt.x, pt.z, 1e9) > 0) { /* load */ }
  const ts = performance.now();
  skyline.update(pt.x, pt.z, 1e9, true);
  const skyLoadMs = performance.now() - ts;
  const loadMs = performance.now() - t0;
  const skyAtLoad = { ...skyline.stats };
  skyline.stats.maxJobMs = 0;
  for (const k in samples) samples[k] = []; // only count streaming after load
  const skyMs: number[] = [];
  const frames: { world: number; terrain: number; total: number; km: number; gen: number; sync: number; prep: number; maxBlock: number; job: string }[] = [];
  const mem: { km: number; chunks: number; foot: number; runs: number; heapMB: number; paths: number }[] = [];
  let lastKm = 0;
  const step = 30 / 60; // 30 m/s, 60 fps
  while (driven < KM * 1000) {
    s += step; driven += step;
    const js = cur.junctionStart;
    if (cur.forkS !== null && s >= cur.forkS) {
      const f = stream.forkOf(cur)!;
      const b = rng.next() < 0.5 ? f.left : f.right;
      s -= cur.forkS; cur = b;
    }
    const g0 = performance.now();
    if (Math.floor(driven / step) % 12 === 0) {
      stream.ensure(cur, s, 2);
      if (js && s > js.nose) stream.enter(cur);
      const removed = stream.trim(cur, s);
      for (const p of removed) wear.drop(p);
      if (removed.length) roadside.trimRuns(new Set(gen.net.paths.map((q) => q.id)));
      wear.trim(cur, s - 400);
    }
    cur.pointAt(s, pt);
    const f0 = performance.now();
    const rects = terrain.sync(gen.net.paths, end);
    if (rects.length) clip.invalidate(rects);
    const w0 = performance.now();
    chunks.update(pt.x, pt.z, slice);
    const k0 = performance.now();
    skyline.update(pt.x, pt.z, L.skylineMs);
    const w1 = performance.now();
    skyMs.push(w1 - k0);
    clip.update(pt.x, pt.z, L.terrainMs);
    const f1 = performance.now();
    frames.push({ world: w1 - w0, terrain: f1 - w1, total: f1 - g0, km: driven / 1000, gen: f0 - g0, sync: w0 - f0, prep: chunks.stats.prepMs, maxBlock: clip.stats.lastMaxBlockMs, job: `${chunks.stats.frameMaxJob} ${chunks.stats.frameMaxJobMs.toFixed(1)}` });
    if (driven - lastKm >= 1000) {
      lastKm = driven;
      mem.push({ km: Math.round(driven / 1000), chunks: chunks.chunks.size, foot: foot.count, runs: (roadside as any).runs.size, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), paths: gen.net.paths.length });
    }
  }
  // overlaps among live footprints
  const all = foot.all();
  let overlaps = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i], all[j], 0.05)) overlaps++;
  const jobs = Object.fromEntries(Object.entries(samples).map(([k, v]) => {
    const a = [...v].sort((x, y) => x - y);
    return [k, { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2), p95: +pct(a, 0.95).toFixed(2), max: +(a[a.length - 1] ?? 0).toFixed(2) }];
  }));
  const tot = frames.map((f) => f.total).sort((a, b) => a - b);
  const worst = [...frames].sort((a, b) => b.total - a.total).slice(0, 8).map((f) => `${f.total.toFixed(1)} (road gen ${f.gen.toFixed(1)}, land sync ${f.sync.toFixed(1)}, world ${f.world.toFixed(1)} [prep ${f.prep.toFixed(1)}, ${f.job}], land ${f.terrain.toFixed(1)} [block ${f.maxBlock.toFixed(1)}]) @${f.km.toFixed(2)} km`);
  return {
    seed, km: KM, gfx, slice, loadMs: Math.round(loadMs), frames: frames.length,
    frameMs: { p50: +pct(tot, 0.5).toFixed(2), p95: +pct(tot, 0.95).toFixed(2), p99: +pct(tot, 0.99).toFixed(2), max: +tot[tot.length - 1].toFixed(2) },
    over20: frames.filter((f) => f.total > 20).length, over10: frames.filter((f) => f.total > 10).length,
    worst, jobs, overlaps, footprints: all.length,
    skyline: { loadMs: Math.round(skyLoadMs), atLoad: skyAtLoad, now: skyline.stats, frameMax: +Math.max(...skyMs).toFixed(2), frameP95: +pct([...skyMs].sort((a, b) => a - b), 0.95).toFixed(2) },
    mem: mem.length > 6 ? [mem[0], mem[Math.floor(mem.length / 2)], mem[mem.length - 1]] : mem,
  };
}

let bad = 0;
for (const seed of seeds) {
  const r = run(seed);
  console.log(JSON.stringify(r, null, 1));
  if (r.over20 || r.overlaps) bad++;
}
process.exit(bad ? 1 : 0);
