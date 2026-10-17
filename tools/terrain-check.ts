/**
 * Terrain checks, in Node:
 *   npx tsx tools/terrain-check.ts [--seeds 1,2,3] [--km 20] [--map out-dir]
 * Drives the road stream like the game, keeps the terrain field in sync, and checks:
 *  - the land never rises through the road: on every level's grid, every triangle that touches
 *    the drivable band stays below the road surface (sampled along the road every 2 m across the band)
 *  - evaluation cost per block and per level fill
 *  - station memory stays flat (stations, hash cells) as the road streams
 * With --map, writes a shaded height map PNG of the last stretch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RoadGenerator } from '../src/road/generator';
import { RoadStream } from '../src/road/stream';
import { Path, resetPathIds } from '../src/road/path';
import { CrossSection } from '../src/road/types';
import { Rng } from '../src/core/rng';
import { TerrainField, clampDrop } from '../src/world/terrain';
import { createCanvas } from '@napi-rs/canvas';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '1,2,3').split(',').map(Number);
const KM = Number(opt('km', '20'));
const mapDir = opt('map', '');

const xs: CrossSection = {} as any;
const pe = { z: 0, g: 0, k: 0 };
const pt = { x: 0, z: 0, h: 0, k: 0 };

/** Triangle-interpolated grid height (same split as the clipmap mesh). */
function gridTri(f: TerrainField, x: number, z: number, sp: number, cache: Map<string, number>) {
  const fx = x / sp, fz = z / sp;
  const gx = Math.floor(fx), gz = Math.floor(fz);
  const u = fx - gx, v = fz - gz;
  const h = (a: number, b: number) => {
    const k = `${a},${b}`;
    let r = cache.get(k);
    if (r === undefined) { r = f.gridHeight(a, b, sp); cache.set(k, r); }
    return r;
  };
  const h00 = h(gx, gz), h11 = h(gx + 1, gz + 1);
  if (u >= v) { const h10 = h(gx + 1, gz); return h00 + (h10 - h00) * u + (h11 - h10) * v; }
  const h01 = h(gx, gz + 1);
  return h00 + (h11 - h01) * u + (h01 - h00) * v;
}

function run(seed: number) {
  resetPathIds(1);
  const gen = new RoadGenerator({ seed });
  const stream = new RoadStream(gen);
  const rng = new Rng(seed * 13 + 5);
  const field = new TerrainField(seed, gen.districts);
  const end = (p: Path) => Math.min(gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
  let cur: Path = gen.root;
  let s = 0, driven = 0;
  const res = { seed, km: KM, checks: 0, through: 0, worst: 0, examples: [] as string[], blockMs: 0, blocks: 0, level0FillMs: 0, stations: [] as number[], cells: [] as number[], syncMs: 0 };
  const caches = [4, 8, 16, 32, 64].map(() => new Map<string, number>());
  let lastCheck = 0;
  while (driven < KM * 1000) {
    stream.ensure(cur, s);
    const t0 = performance.now();
    field.sync(gen.net.paths, end);
    res.syncMs += performance.now() - t0;
    // advance 20 m
    s += 20; driven += 20;
    const js = cur.junctionStart;
    if (cur.forkS !== null && s >= cur.forkS) {
      const f = stream.forkOf(cur)!;
      const b = rng.next() < 0.5 ? f.left : f.right;
      s -= cur.forkS; cur = b;
    }
    if (js && s > js.nose) stream.enter(cur);
    stream.trim(cur, s);
    if (driven - lastCheck >= 1000) {
      lastCheck = driven;
      res.stations.push(field.stats.stations);
      res.cells.push(field.cellCount());
      for (const c of caches) c.clear();
      // check the land under the road for the 200 m ahead of the player, on every level
      for (let ds = 0; ds < 200; ds += 2) {
        const sa = s + ds;
        if (sa > end(cur) - 2) break;
        cur.pointAt(sa, pt);
        cur.profile.eval(sa, pe);
        cur.xsAt(sa, xs);
        const [lo, hi] = cur.drivableAt(sa, xs);
        for (let t = lo; t <= hi + 1e-6; t += (hi - lo) / 6) {
          const x = pt.x + Math.cos(pt.h) * t, z = pt.z - Math.sin(pt.h) * t;
          const road = pe.z + cur.crossHeight(sa, t, pt.k, xs) - 0.12;
          [4, 8, 16, 32, 64].forEach((sp, li) => {
            const g = gridTri(field, x, z, sp, caches[li]);
            res.checks++;
            const over = g - (road - Math.min(0.3, clampDrop(sp) * 0.5));
            if (over > 0) {
              res.through++;
              res.worst = Math.max(res.worst, over);
              if (res.examples.length < 8) res.examples.push(`p${cur.id}@${sa.toFixed(0)} t=${t.toFixed(1)} sp=${sp} over=${over.toFixed(2)}`);
            }
          });
        }
      }
      // block cost (level 0 block, 8×8) around the player
      const tb = performance.now();
      const H = new Float32Array(64), M = new Uint8Array(512);
      for (let k = 0; k < 8; k++) field.fillBlock(Math.floor(pt.x / 4) + k * 8 - 32, Math.floor(pt.z / 4), 8, 8, 4, H, M);
      res.blockMs = Math.max(res.blockMs, (performance.now() - tb) / 8);
      res.blocks += 8;
    }
  }
  // a full level-0 fill (128×128) at the end
  const t1 = performance.now();
  const H = new Float32Array(64), M = new Uint8Array(512);
  cur.pointAt(s, pt);
  const gx0 = Math.round(pt.x / 4) - 64, gz0 = Math.round(pt.z / 4) - 64;
  for (let bz = 0; bz < 16; bz++) for (let bx = 0; bx < 16; bx++) field.fillBlock(gx0 + bx * 8, gz0 + bz * 8, 8, 8, 4, H, M);
  res.level0FillMs = performance.now() - t1;
  if (mapDir) drawMap(field, gen, pt.x, pt.z, seed);
  return res;
}

function drawMap(field: TerrainField, gen: RoadGenerator, cx: number, cz: number, seed: number) {
  const W = 512, sp = 8;
  const c = createCanvas(W, W);
  const g = c.getContext('2d');
  const img = g.createImageData(W, W);
  const H = new Float32Array(64), M = new Uint8Array(512);
  const hs = new Float32Array(W * W);
  const gx0 = Math.round(cx / sp) - W / 2, gz0 = Math.round(cz / sp) - W / 2;
  for (let bz = 0; bz < W / 8; bz++) for (let bx = 0; bx < W / 8; bx++) {
    field.fillBlock(gx0 + bx * 8, gz0 + bz * 8, 8, 8, sp, H, M);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) hs[(bz * 8 + j) * W + bx * 8 + i] = H[j * 8 + i];
  }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const h = hs[j * W + i];
    const hx = hs[j * W + Math.min(W - 1, i + 1)] - h, hz = hs[Math.min(W - 1, j + 1) * W + i] - h;
    const shade = Math.max(0, Math.min(1, 0.6 - (hx - hz) * 0.12));
    const band = (h + 60) / 120;
    const o = ((W - 1 - j) * W + i) * 4;
    img.data[o] = 255 * shade * (0.5 + 0.5 * band);
    img.data[o + 1] = 255 * shade * (0.6 + 0.3 * band);
    img.data[o + 2] = 255 * shade * (0.8 - 0.3 * band);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#ff3355';
  g.lineWidth = 1.5;
  for (const p of gen.net.paths) {
    g.beginPath();
    for (let s = p.base; s < p.sampleEnd; s += 8) {
      p.pointAt(s, pt);
      const X = pt.x / sp - gx0, Y = W - 1 - (pt.z / sp - gz0);
      if (s === p.base) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.stroke();
  }
  fs.mkdirSync(mapDir, { recursive: true });
  fs.writeFileSync(path.join(mapDir, `terrain_seed${seed}.png`), c.toBuffer('image/png'));
}

let bad = 0;
for (const seed of seeds) {
  const r = run(seed);
  const flat = r.stations.length > 4 ? Math.max(...r.stations.slice(3)) / Math.max(1, Math.min(...r.stations.slice(3))) : 1;
  console.log(JSON.stringify({ ...r, examples: r.examples, stations: `${Math.min(...r.stations)}..${Math.max(...r.stations)}`, cells: `${Math.min(...r.cells)}..${Math.max(...r.cells)}`, stationRatio: flat.toFixed(2), blockMs: r.blockMs.toFixed(2), level0FillMs: r.level0FillMs.toFixed(0), syncMs: r.syncMs.toFixed(0) }));
  if (r.through > 0) bad++;
}
process.exit(bad ? 1 : 0);
