import { BufferAttribute, Matrix4, Mesh, ShaderMaterial, Vector3 } from 'three';
import { Path } from '../road/path';
import { RoadGenerator } from '../road/generator';
import { RoadSurface } from '../road/surface';
import { CLASS_SPEC, CrossSection, HARD_TURNS, RoadClass, laneCenter } from '../road/types';
import { CorridorSeg } from '../road/network';
import { Rng, hash32 } from '../core/rng';
import { clamp } from '../core/math';
import { MOODS, Mood } from './moods';
import { WorldGeom, InkedGeom, Mat } from './kit/geom';
import {
  buildProp, buildEdge, buildWires, buildGuideSign, buildCarPark, buildEmptyLot, ROAD_MARKS,
  SURFACES, STRIPS, stripU, SIDEWALK_LAYERS, EdgePoint, EdgeType, Light, Anchor,
} from './kit/street';
import { buildBuilding, buildFarBuilding, pickBuildingType, BUILDING_TYPES } from './kit/buildings';
import { Footprints, Footprint } from './footprints';
import { TerrainField } from './terrain';
import { TerrainClipmap } from './terrainClipmap';
import { WorldLayers } from '../render/worldTextures';
import { addSmoothNormals } from '../render/actorMaterial';
import type { Chunk } from './chunks';
import { roadRows } from './roadMesh';

/**
 * Everything beside the road, chunk by chunk:
 *  - structure: kerbs, sidewalks (narrowed where another road is close, so hairpin legs and
 *    fork islands share the space), raised medians, and walls from the sidewalk down into the
 *    land wherever the road runs above it;
 *  - frontage: runs of buildings, trees, car parks, lots, walls or open verge along each side,
 *    picked by the district's mood; every footprint is tested against every live road
 *    corridor (including roads planned ahead) and against every other footprint;
 *  - furniture: street lamps, utility poles with wires, street trees, small props, hard-turn
 *    warning signs, chevrons and guard rails, the blue guide gantry before each fork, and the
 *    road text and marks (止まれ and stop lines, crosswalks, スピード落とせ, arrows);
 *  - light: street lamps, shop signs and windows bake their light into nearby vertices of the
 *    roadside and of the road itself (lamp pools at night).
 * Work is split into small jobs so no frame spends more than the world-build slice on it.
 * Far chunks get simplified buildings; they are rebuilt in detail as the player approaches.
 */

export const KERB_H = 0.15;
const KERB_BAND = 0.22;
const WALL_DEPTH = 6;

export interface RoadsideMats { world: ShaderMaterial; decal: ShaderMaterial; prop: ShaderMaterial; ink: ShaderMaterial }

export interface RoadsideDeps {
  gen: RoadGenerator;
  surface: RoadSurface;
  terrain: TerrainField;
  clip: TerrainClipmap;
  tex: WorldLayers;
  mats: RoadsideMats;
  foot: Footprints;
  seed: number;
  /** chunks nearer than this get detailed buildings */
  nearR: number;
  detail: number;
}

export interface Job { c: Chunk; run(): void; label: string }

type RunKind = 'build' | 'trees' | 'carpark' | 'lot' | 'wall' | 'open' | 'yard';
interface Run { s0: number; s1: number; kind: RunKind; mood: Mood; seed: number }

interface SideRow {
  s: number;
  kerbT: number;
  width: number; // kerb line to outer edge
  walk: number; // usable sidewalk width (0 = kerb band only)
  hk: number; // road height at the kerb
  top: number; // sidewalk top
  kx: number; kz: number; // kerb point (world)
  ox: number; oz: number; // outer edge point (world)
  nx: number; nz: number; // outward unit normal
  ground: number; // land height at the outer edge
  clear: number; // free space beyond the kerb (to the nearest other road)
}

interface Row {
  s: number;
  x: number; z: number; h: number; k: number;
  median: number;
  zc: number; // centre height
  mood: Mood;
  cls: RoadClass;
  L: SideRow | null;
  R: SideRow | null;
}

interface Plot {
  side: 1 | -1;
  s: number;
  w: number; d: number;
  kind: 'building' | 'carpark' | 'lot';
  type?: string;
  floors?: number;
  height: number;
  mood: Mood;
  seed: number;
  // pose (world): front-centre and yaw
  fx: number; fz: number; yaw: number; y: number;
  minGround: number;
}

interface IntendedPlot { x0: number; x1: number; w: number; d: number; kind: Plot['kind']; type?: string; floors?: number; height: number; seed: number }
interface Placed { type: string; x: number; y: number; z: number; yaw: number; seed: number; ink: boolean }
interface EdgeRun { type: EdgeType; pts: EdgePoint[]; seed: number }
interface Decal { name: string; s: number; t: number; dir: 1 | -1; scaleW?: number; scaleL?: number }
interface Wire { a: Anchor; b: Anchor; sag: number }

interface Plan {
  rows: Row[];
  plots: Plot[];
  props: Placed[];
  edges: EdgeRun[];
  decals: Decal[];
  wires: Wire[];
  guide: { s: number; left: any; right: any; span: number } | null;
}

interface State {
  plan: Plan | null;
  lod: 0 | 1;
  building: { lod: 0 | 1; world: WorldGeom; decal: WorldGeom; inked: InkedGeom; lights: Light[] } | null;
  meshes: Mesh[];
  done: boolean;
}

const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pt = { x: 0, z: 0, h: 0, k: 0 };
const _pe = { z: 0, g: 0, k: 0 };
const _mw = [0, 0, 0, 0, 0, 0];
const _w = { x: 0, y: 0, z: 0 };

/** Sidewalk width by class and mood. */
const WALK: Record<RoadClass, Record<Mood, number>> = {
  arterial: { downtown: 5, oldtown: 3.5, midtown: 4.5, docks: 3, suburbs: 3.5, edge: 2.5 },
  avenue: { downtown: 3.6, oldtown: 2.5, midtown: 3, docks: 2, suburbs: 2.5, edge: 1.6 },
  back: { downtown: 2, oldtown: 0, midtown: 1.8, docks: 1.2, suburbs: 1.4, edge: 0 },
};

const RUN_KINDS: Record<Mood, [RunKind, number][]> = {
  downtown: [['build', 7], ['trees', 0.7], ['carpark', 0.5]],
  oldtown: [['build', 6], ['wall', 1.4], ['trees', 0.5], ['lot', 0.3]],
  midtown: [['build', 5], ['carpark', 1], ['lot', 0.6], ['trees', 0.6]],
  docks: [['build', 4], ['yard', 1.5], ['wall', 1], ['lot', 0.5]],
  suburbs: [['build', 6], ['trees', 1], ['carpark', 0.3], ['lot', 0.4]],
  edge: [['open', 3], ['build', 1.4], ['lot', 0.8], ['trees', 1.2]],
};
const RUN_LEN: Record<RunKind, [number, number]> = {
  build: [50, 140], trees: [25, 70], carpark: [18, 34], lot: [14, 30], wall: [25, 60], open: [40, 160], yard: [30, 80],
};

const LAMP_TYPE = (cls: RoadClass, mood: Mood): string =>
  cls === 'arterial' ? 'lamp_arterial'
    : mood === 'docks' ? 'lamp_docks'
      : cls === 'avenue' ? 'lamp_avenue'
        : mood === 'oldtown' ? 'lamp_oldtown'
          : mood === 'downtown' || mood === 'midtown' ? 'lamp_avenue' : 'lamp_suburb';

const SURF_TILE: Record<string, number> = Object.fromEntries(Object.values(SURFACES).map((s) => [s.layer, s.tile]));

function dominant(w: number[]): Mood {
  let b = 0;
  for (let i = 1; i < 6; i++) if (w[i] > w[b]) b = i;
  return MOODS[b];
}

export class Roadside {
  private state = new Map<string, State>();
  private runs = new Map<string, Run[]>();
  private lightCache = new Map<string, { lights: Light[]; anchors: Anchor[] }>();
  stats = { plots: 0, rejected: 0, jobs: 0, worldTris: 0, inkTris: 0, lastJobMs: 0, maxJobMs: 0, maxJob: '' };

  constructor(public d: RoadsideDeps) {}

  /** The jobs that finish a freshly built road chunk. */
  jobsFor(c: Chunk): Job[] {
    const st: State = { plan: null, lod: c.dist < this.d.nearR ? 0 : 1, building: null, meshes: [], done: false };
    this.state.set(c.key, st);
    return [{ c, label: 'plan', run: () => { st.plan = this.plan(c); } }, ...this.buildJobs(c, st, st.lod)];
  }

  /** Jobs to rebuild a far chunk in detail (called when it comes near). */
  upgradeJobs(c: Chunk): Job[] {
    const st = this.state.get(c.key);
    if (!st || !st.done || st.lod === 0 || c.dist > this.d.nearR - 40) return [];
    st.lod = 0;
    st.done = false;
    return this.buildJobs(c, st, 0);
  }

  needsUpgrade(c: Chunk): boolean {
    const st = this.state.get(c.key);
    return !!st && st.done && st.lod === 1 && c.dist < this.d.nearR - 40;
  }

  removed(c: Chunk) {
    const st = this.state.get(c.key);
    if (st) for (const m of st.meshes) m.geometry.dispose();
    this.state.delete(c.key);
    this.d.foot.removeOwner(c.key);
  }

  /** Forget cached frontage runs of paths that no longer exist (memory stays flat). */
  trimRuns(live: Set<number>) {
    for (const k of this.runs.keys()) if (!live.has(Number(k.split(':')[0]))) this.runs.delete(k);
    for (const [k, l] of this.runs) {
      const p = this.d.gen.net.paths.find((q) => q.id === Number(k.split(':')[0]));
      if (!p) continue;
      while (l.length > 2 && l[1].s1 < p.base - 200) l.shift();
    }
  }

  private buildJobs(c: Chunk, st: State, lod: 0 | 1): Job[] {
    const jobs: Job[] = [];
    jobs.push({ c, label: 'structure', run: () => {
      st.building = { lod, world: new WorldGeom(), decal: new WorldGeom(), inked: new InkedGeom(), lights: [] };
      this.structure(c, st.plan!, st.building.world);
    } });
    jobs.push({ c, label: 'plots', run: () => {
      // far buildings are cheap: all at once; near ones one per job (queued below)
      if (lod === 1) for (const p of st.plan!.plots) this.buildPlot(c, p, st, 1);
    } });
    if (lod === 0) {
      // one job per detailed plot (a building can take a few ms)
      const n = 24; // upper bound; jobs past the plot count do nothing
      for (let i = 0; i < n; i++) jobs.push({ c, label: 'plot', run: () => { const p = st.plan!.plots[i]; if (p) this.buildPlot(c, p, st, 0); } });
    }
    jobs.push({ c, label: 'furniture', run: () => this.furniture(c, st, lod) });
    jobs.push({ c, label: 'finish', run: () => this.finish(c, st) });
    return jobs;
  }

  // ───────────────────────────── planning ─────────────────────────────

  /** Clearance from a point to the nearest road edge, ignoring this road around s. */
  private clearance(x: number, z: number, p: Path, s: number, reach = 40): number {
    let best = reach;
    const pf = p.parent?.forkS ?? null;
    const myFork = p.forkS;
    this.d.gen.net.corridors.query(x - reach, z - reach, x + reach, z + reach, (seg) => {
      if (this.related(seg, p, s, pf, myFork)) return;
      const d = segDist(x, z, seg) - seg.hw;
      if (d < best) best = d;
    });
    return best;
  }

  private related(seg: CorridorSeg, p: Path, s: number, parentFork: number | null, myFork: number | null): boolean {
    const q = seg.path;
    if (q === p) return Math.abs((seg.s0 + seg.s1) / 2 - s) < 40;
    if (q === p.parent && parentFork !== null) return s < 90 && seg.s1 > parentFork - 90;
    if (q.parent === p && myFork !== null) return seg.s0 < 90 && s > myFork - 90;
    return false;
  }

  /** Distance from a point to the nearest road edge of any road (own road included). */
  private edgeDist(x: number, z: number, reach: number, skip: (seg: CorridorSeg) => boolean): number {
    let best = reach;
    this.d.gen.net.corridors.query(x - reach, z - reach, x + reach, z + reach, (seg) => {
      if (skip(seg)) return;
      const d = segDist(x, z, seg) - seg.hw;
      if (d < best) best = d;
    });
    return best;
  }

  private ground(x: number, z: number): number {
    const h = this.d.clip.heightAt(x, z);
    return h ?? this.d.terrain.groundAt(x, z);
  }

  private sideRow(p: Path, s: number, sigma: 1 | -1, lo: number, hi: number, k: number, cls: { from: RoadClass; to: RoadClass; u: number }, mw: number[]): SideRow | null {
    const js = p.junctionStart;
    if (js && s < js.nose && sigma === js.inner) return null;
    const kerbT = sigma > 0 ? hi : lo;
    const ch = Math.cos(_pt.h), sh = Math.sin(_pt.h);
    const nx = sigma * ch, nz = -sigma * sh;
    const kx = _pt.x + ch * kerbT, kz = _pt.z - sh * kerbT;
    const clear = this.clearance(kx, kz, p, s);
    let walk = 0;
    for (let m = 0; m < 6; m++) {
      if (mw[m] <= 0) continue;
      const a = WALK[cls.from][MOODS[m]], b = WALK[cls.to][MOODS[m]];
      walk += mw[m] * (a + (b - a) * cls.u);
    }
    // inside of a bend: never past the bend's centre
    if (k * sigma > 1e-4) walk = Math.min(walk, Math.max(0, 0.6 * (1 / Math.abs(k) - Math.abs(kerbT))));
    walk = Math.min(walk, Math.max(0, clear / 2 - 0.02));
    if (walk < 0.6) walk = 0;
    const width = Math.max(walk, Math.min(KERB_BAND, Math.max(0, clear / 2)));
    const hk = this.d.surface.baseHeight(p, s, kerbT);
    const top = hk + KERB_H;
    const ox = kx + nx * width, oz = kz + nz * width;
    return { s, kerbT, width, walk, hk, top, kx, kz, ox, oz, nx, nz, ground: this.ground(ox, oz), clear };
  }

  /** Frontage runs along one side of a path (deterministic, generated from s = 0 onward). */
  private runsFor(p: Path, side: 1 | -1, upTo: number): Run[] {
    const key = `${p.id}:${side}`;
    let l = this.runs.get(key);
    if (!l) { l = []; this.runs.set(key, l); }
    let s = l.length ? l[l.length - 1].s1 : Math.min(0, p.base);
    let i = l.length ? hash32(l[l.length - 1].seed, 1) : hash32(this.d.seed, 0x5e7, p.id, side);
    while (s < upTo) {
      const r = new Rng(i);
      p.pointAt(Math.max(p.base, Math.min(s + 20, p.sampleEnd)), _pt);
      this.d.gen.districts.moodWeights(_pt.x, _pt.z, _mw);
      const mood = dominant(_mw);
      const opts = RUN_KINDS[mood];
      let kind = r.weighted(opts.map((o) => o[0]), opts.map((o) => o[1]));
      const cls = p.clsAt(Math.max(p.base, Math.min(s, p.sampleEnd)));
      if (cls === 'arterial' && kind === 'wall') kind = 'build';
      const [a, b] = RUN_LEN[kind];
      const len = r.range(a, b);
      l.push({ s0: s, s1: s + len, kind, mood, seed: i });
      s += len;
      i = hash32(i, 1);
    }
    return l;
  }

  private plan(c: Chunk): Plan {
    const p = c.path;
    const rows: Row[] = [];
    const ss = roadRows(p, c.s0, c.s1);
    for (const s of ss) {
      p.pointAt(s, _pt);
      p.xsAt(s, _xs);
      const [lo, hi] = p.drivableAt(s, _xs);
      const cls = p.classAt(s);
      this.d.gen.districts.moodWeights(_pt.x, _pt.z, _mw);
      const x = _pt.x, z = _pt.z, h = _pt.h, k = _pt.k;
      p.profile.eval(s, _pe);
      const median = _xs.median;
      const clsNow = _xs.cls;
      const L = this.sideRow(p, s, 1, lo, hi, k, cls, _mw);
      p.pointAt(s, _pt); // sideRow may have moved _pt? (no) keep consistent
      const R = this.sideRow(p, s, -1, lo, hi, k, cls, _mw);
      rows.push({ s, x, z, h, k, median, zc: _pe.z, mood: dominant(_mw), cls: clsNow, L, R });
    }
    const plan: Plan = { rows, plots: [], props: [], edges: [], decals: [], wires: [], guide: null };
    for (const side of [1, -1] as const) this.planSide(c, plan, side);
    this.planFurniture(c, plan);
    this.planMarks(c, plan);
    return plan;
  }

  /** Side row at arc length s (interpolated between the plan's rows). */
  private sideAt(plan: Plan, side: 1 | -1, s: number): SideRow | null {
    const rows = plan.rows;
    let i = 0;
    while (i < rows.length - 2 && rows[i + 1].s < s) i++;
    const a = side > 0 ? rows[i].L : rows[i].R;
    const b = side > 0 ? rows[i + 1]?.L : rows[i + 1]?.R;
    if (!a) return b ?? null;
    if (!b) return a;
    const u = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    const L = (x: number, y: number) => x + (y - x) * u;
    return {
      s, kerbT: L(a.kerbT, b.kerbT), width: L(a.width, b.width), walk: Math.min(a.walk, b.walk), hk: L(a.hk, b.hk), top: L(a.top, b.top),
      kx: L(a.kx, b.kx), kz: L(a.kz, b.kz), ox: L(a.ox, b.ox), oz: L(a.oz, b.oz), nx: L(a.nx, b.nx), nz: L(a.nz, b.nz), ground: L(a.ground, b.ground), clear: Math.min(a.clear, b.clear),
    };
  }

  private isHardTurn(p: Path, s: number, pad: number): boolean {
    for (const ev of p.events) if (HARD_TURNS.includes(ev.type) && s > ev.s0 - pad && s < ev.s1 + pad) return true;
    return false;
  }

  /** The plots a run intends to hold (deterministic; some may be rejected when placed). */
  private intended(run: Run): IntendedPlot[] {
    const cached = this.intendedCache.get(run);
    if (cached) return cached;
    const out: IntendedPlot[] = [];
    if (run.kind === 'build' || run.kind === 'carpark' || run.kind === 'yard' || run.kind === 'lot') {
      const r = new Rng(hash32(run.seed, 0x9107));
      let x = run.s0 + r.range(0, 3);
      let lastType = '', sameRun = 0;
      while (x < run.s1 - 4) {
        let w: number, d: number, kind: Plot['kind'] = 'building', type: string | undefined, floors: number | undefined, height = 6, gap = 0;
        if (run.kind === 'carpark' || run.kind === 'yard') {
          kind = run.kind === 'yard' ? 'lot' : 'carpark';
          w = Math.min(run.s1 - x, r.range(16, 30)); d = r.range(12, 22);
        } else if (run.kind === 'lot') {
          kind = 'lot'; w = Math.min(run.s1 - x, r.range(10, 24)); d = r.range(10, 18);
        } else {
          let def = pickBuildingType(run.mood, r.next());
          if (def.type === lastType && sameRun >= def.maxRun) def = pickBuildingType(run.mood, r.next());
          sameRun = def.type === lastType ? sameRun + 1 : 1;
          lastType = def.type;
          type = def.type;
          w = r.range(def.width[0], def.width[1]);
          d = r.range(def.depth[0], def.depth[1]);
          floors = r.int(def.floors[0], def.floors[1]);
          height = r.range(def.height[0], def.height[1]);
          gap = r.range(def.sideGap[0], def.sideGap[1]);
        }
        out.push({ x0: x, x1: x + w, w, d, kind, type, floors, height, seed: hash32(run.seed, Math.round(x * 10)) });
        x += w + gap + (kind === 'building' ? 0 : r.range(1, 4));
      }
    }
    this.intendedCache.set(run, out);
    return out;
  }
  private intendedCache = new WeakMap<Run, IntendedPlot[]>();

  private planSide(c: Chunk, plan: Plan, side: 1 | -1) {
    const p = c.path;
    const runs = this.runsFor(p, side, c.s1 + 200);
    for (const run of runs) {
      if (run.s1 <= c.s0 - 60 || run.s0 >= c.s1) continue;
      const ips = this.intended(run);
      // edges along the part of the run inside this chunk
      const a = Math.max(run.s0, c.s0), b = Math.min(run.s1, c.s1);
      if (b > a) this.planEdge(c, plan, side, run, a, b, ips);
      if (run.kind === 'trees') { this.planTrees(c, plan, side, run); continue; }
      // plots are kept by the chunk holding their centre
      for (const ip of ips) {
        const sc = (ip.x0 + ip.x1) / 2;
        if (sc < c.s0 || sc >= c.s1) continue;
        const pl = this.placePlot(c, plan, side, sc, ip.w, ip.d, ip.kind, ip.type, ip.floors, ip.height, run.mood, ip.seed);
        if (pl) plan.plots.push(pl);
      }
    }
  }

  private placePlot(c: Chunk, plan: Plan, side: 1 | -1, s: number, w: number, d: number, kind: Plot['kind'], type: string | undefined, floors: number | undefined, height: number, mood: Mood, seed: number): Plot | null {
    const p = c.path;
    if (this.isHardTurn(p, s, 25)) { this.stats.rejected++; return null; }
    const sr = this.sideAt(plan, side, s);
    if (!sr || sr.clear < 12) { this.stats.rejected++; return null; }
    p.pointAt(s, _pt);
    const ux = Math.sin(_pt.h), uz = Math.cos(_pt.h);
    const setback = kind === 'building' ? 0.15 : 0.3;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ww = attempt === 0 ? w : w * 0.6;
      if (ww < 5) break;
      const fx = sr.ox + sr.nx * setback, fz = sr.oz + sr.nz * setback;
      const f: Footprint = { cx: fx + sr.nx * d / 2, cz: fz + sr.nz * d / 2, ux, uz, hw: ww / 2, hd: d / 2, owner: c.key };
      // the rectangle must keep clear of every road: its own road (by the sidewalk) and any other
      const need = Math.max(0.5, sr.width + setback - 0.3);
      let ok = true;
      for (let iu = -1; iu <= 1 && ok; iu++) for (let id = 0; id <= 2 && ok; id++) {
        const px = fx + ux * (iu * ww / 2) + sr.nx * (id * d / 2), pz = fz + uz * (iu * ww / 2) + sr.nz * (id * d / 2);
        const dd = this.edgeDist(px, pz, 30, () => false);
        if (dd < (id === 0 ? need : Math.max(need, 3))) ok = false;
      }
      if (ok && !this.d.foot.free(f)) ok = false;
      if (!ok) continue;
      this.d.foot.add(f);
      let minG = Infinity;
      for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 0.5]]) {
        minG = Math.min(minG, this.ground(fx + ux * a * ww / 2 + sr.nx * b * d, fz + uz * a * ww / 2 + sr.nz * b * d));
      }
      this.stats.plots++;
      // local +Z (street side) = -n; yaw so that rotateY(yaw) maps +Z onto -n
      const yaw = Math.atan2(-sr.nx, -sr.nz);
      return { side, s, w: ww, d, kind, type, floors, height, mood, seed, fx, fz, yaw, y: sr.top, minGround: minG };
    }
    this.stats.rejected++;
    return null;
  }

  private planEdge(c: Chunk, plan: Plan, side: 1 | -1, run: Run, a: number, b: number, ips: IntendedPlot[]) {
    const p = c.path;
    const r = new Rng(hash32(run.seed, 0xed9e));
    let type: EdgeType | null = null;
    switch (run.kind) {
      case 'build': type = run.mood === 'suburbs' || run.mood === 'edge' ? (r.chance(0.7) ? 'blockwall' : 'woodfence') : null; break;
      case 'lot': type = r.chance(0.5) ? 'chainlink' : 'hoarding'; break;
      case 'yard': type = 'chainlink'; break;
      case 'wall': type = run.mood === 'oldtown' && r.chance(0.5) ? 'woodfence' : 'blockwall'; break;
      case 'trees': type = 'verge'; break;
      case 'open': type = 'verge'; break;
      case 'carpark': type = null; break;
    }
    // split [a, b] into pieces by what the place needs: guard rail on hard turns and over big
    // drops, railing over a drop where nothing else stands
    let cur: { type: EdgeType; pts: EdgePoint[] } | null = null;
    const flush = () => { if (cur && cur.pts.length >= 2) plan.edges.push({ type: cur.type, pts: cur.pts, seed: hash32(run.seed, Math.round(cur.pts[0].x * 10)) }); cur = null; };
    for (const row of plan.rows) {
      if (row.s < a - 1e-6 || row.s > b + 1e-6) continue;
      const sr = side > 0 ? row.L : row.R;
      if (!sr || sr.clear < 1.2) { flush(); continue; }
      const drop = sr.top - sr.ground;
      const hard = this.isHardTurn(p, row.s, 15) && this.outsideOfTurn(p, row.s, side);
      // a building fronting the sidewalk hides any drop behind it
      const fronted = run.kind === 'build' && ips.some((ip) => row.s > ip.x0 - 0.5 && row.s < ip.x1 + 0.5);
      let t: EdgeType | null = type;
      if (hard) t = 'guardrail';
      else if (!fronted && drop > 1.2 && (t === null || t === 'verge')) t = sr.walk > 0 ? 'railing' : 'guardrail';
      if (sr.clear < 5 && t !== 'guardrail' && t !== 'railing') t = drop > 0.8 ? 'railing' : null; // islands and tight gaps: nothing tall
      if (!t) { flush(); continue; }
      if (cur && cur.type !== t) { const last: EdgePoint = cur.pts[cur.pts.length - 1]; flush(); cur = { type: t, pts: [last] }; }
      if (!cur) cur = { type: t, pts: [] };
      cur.pts.push({ x: sr.ox - c.ox, y: sr.top, z: sr.oz - c.oz, nx: sr.nx, nz: sr.nz });
    }
    flush();
  }

  private outsideOfTurn(p: Path, s: number, side: 1 | -1): boolean {
    for (const ev of p.events) {
      if (!HARD_TURNS.includes(ev.type) || s < ev.s0 - 15 || s > ev.s1 + 15) continue;
      for (const [a, b, dir] of ev.turns) if (s > a - 15 && s < b + 15) return side === -Math.sign(dir);
    }
    return false;
  }

  private planTrees(c: Chunk, plan: Plan, side: 1 | -1, run: Run) {
    const r = new Rng(hash32(run.seed, 0x7ee5));
    const type = run.mood === 'oldtown' || run.mood === 'suburbs' ? (r.chance(0.5) ? 'tree_cherry' : 'tree_street') : run.mood === 'edge' || run.mood === 'docks' ? 'tree_pine' : 'tree_street';
    let s = run.s0 + r.range(2, 6);
    while (s < run.s1) {
      if (s >= c.s0 && s < c.s1 && !this.isHardTurn(c.path, s, 10)) {
        const sr = this.sideAt(plan, side, s);
        if (sr && sr.clear > 10) {
          const back = r.range(2.5, Math.min(9, sr.clear / 2 - 2));
          const x = sr.ox + sr.nx * back, z = sr.oz + sr.nz * back;
          if (this.edgeDist(x, z, 12, () => false) > 2.2) {
            const yaw = Math.atan2(-sr.nx, -sr.nz);
            plan.props.push({ type: r.chance(0.2) ? 'shrub' : type, x: x - c.ox, y: this.ground(x, z), z: z - c.oz, yaw, seed: hash32(run.seed, Math.round(s * 10)), ink: false });
          }
        }
      }
      s += r.range(5, 9);
    }
  }

  /** Lamps, poles and wires, street trees, small props, hard-turn signs, the guide gantry. */
  private planFurniture(c: Chunk, plan: Plan) {
    const p = c.path;
    const seed = this.d.seed;
    const occupied: number[][] = [[], []]; // s positions used per side (L, R)
    const free = (side: 1 | -1, s: number, gap: number) => occupied[side > 0 ? 0 : 1].every((q) => Math.abs(q - s) > gap);
    const use = (side: 1 | -1, s: number) => occupied[side > 0 ? 0 : 1].push(s);
    const facing = (sr: SideRow) => Math.atan2(-sr.nx, -sr.nz); // +Z toward the road
    // ---- street lamps: arterials and avenues both sides staggered; back streets one side
    for (const side of [1, -1] as const) {
      const mid = plan.rows[Math.floor(plan.rows.length / 2)];
      const cls = mid.cls;
      if (cls === 'back' && side < 0) continue;
      const spacing = cls === 'arterial' ? 34 : cls === 'avenue' ? 30 : 27;
      const phase = (hash32(seed, 0x1a, p.id) % 1000) / 1000 * spacing + (side < 0 ? spacing / 2 : 0);
      for (let s = Math.ceil((c.s0 - phase) / spacing) * spacing + phase; s < c.s1; s += spacing) {
        const sr = this.sideAt(plan, side, s);
        if (!sr || sr.clear < 3) continue;
        const row = plan.rows.find((rw) => rw.s >= s) ?? mid;
        const type = LAMP_TYPE(row.cls, row.mood);
        const off = sr.walk >= 1 ? 0.55 : sr.width + 0.25;
        const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
        const y = sr.walk >= 1 || off <= sr.width ? sr.top : this.ground(x, z);
        plan.props.push({ type, x: x - c.ox, y, z: z - c.oz, yaw: facing(sr), seed: hash32(seed, 0x1b, p.id, Math.round(s)), ink: true });
        use(side, s);
      }
    }
    // ---- median lamps on arterials
    for (const row of plan.rows) {
      if (row.median < 0.8) continue;
      const spacing = 34;
      const phase = (hash32(seed, 0x1c, p.id) % 1000) / 1000 * spacing;
      const k = Math.round((row.s - phase) / spacing);
      const s = k * spacing + phase;
      if (Math.abs(row.s - s) > 1.5 || s < c.s0 || s >= c.s1) continue;
      p.pointAt(row.s, _pt);
      const y = row.zc + KERB_H;
      plan.props.push({ type: 'lamp_arterial', x: row.x - c.ox, y, z: row.z - c.oz, yaw: row.h + Math.PI / 2, seed: hash32(seed, 0x1d, p.id, k), ink: true });
    }
    // ---- utility poles with wires on back streets (right side)
    const midRow = plan.rows[Math.floor(plan.rows.length / 2)];
    if (midRow.cls === 'back' && midRow.mood !== 'downtown') {
      const spacing = 31;
      const phase = (hash32(seed, 0x2a, p.id) % 1000) / 1000 * spacing;
      const poleAt = (s: number) => {
        const sr = this.sideAtAny(c, plan, -1, s);
        if (!sr || sr.clear < 3) return null;
        const off = sr.width + 0.3;
        const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
        return { x, z, y: this.ground(x, z), yaw: Math.atan2(-sr.nx, -sr.nz), seed: hash32(seed, 0x2b, p.id, Math.round(s)) };
      };
      for (let s = Math.ceil((c.s0 - phase) / spacing) * spacing + phase; s < c.s1; s += spacing) {
        if (this.isHardTurn(p, s, 5)) continue;
        const a = poleAt(s);
        if (!a) continue;
        plan.props.push({ type: 'utility_pole', x: a.x - c.ox, y: a.y, z: a.z - c.oz, yaw: a.yaw, seed: a.seed, ink: true });
        use(-1, s);
        const b = s + spacing <= p.sampleEnd - 2 && !this.isHardTurn(p, s + spacing, 5) ? poleAt(s + spacing) : null;
        if (b && Math.hypot(b.x - a.x, b.z - a.z) < spacing * 1.4) {
          const A = this.anchors('utility_pole', a.seed), B = this.anchors('utility_pole', b.seed);
          const n = Math.min(A.length, B.length);
          for (let i = 0; i < n; i++) {
            const pa = rot(A[i], a.yaw), pb = rot(B[i], b.yaw);
            plan.wires.push({ a: { x: a.x - c.ox + pa.x, y: a.y + A[i].y, z: a.z - c.oz + pa.z }, b: { x: b.x - c.ox + pb.x, y: b.y + B[i].y, z: b.z - c.oz + pb.z }, sag: 0.35 + 0.1 * i });
          }
        }
      }
    }
    // ---- street trees on wide sidewalks
    for (const side of [1, -1] as const) {
      const spacing = 11;
      const phase = (hash32(seed, 0x3a, p.id, side) % 1000) / 1000 * spacing;
      for (let s = Math.ceil((c.s0 - phase) / spacing) * spacing + phase; s < c.s1; s += spacing) {
        const sr = this.sideAt(plan, side, s);
        if (!sr || sr.walk < 2.6 || !free(side, s, 4) || this.isHardTurn(p, s, 10)) continue;
        const row = plan.rows.find((rw) => rw.s >= s) ?? plan.rows[0];
        const x = sr.kx + sr.nx * 1.05, z = sr.kz + sr.nz * 1.05;
        plan.props.push({ type: row.mood === 'oldtown' ? 'tree_cherry' : 'tree_street', x: x - c.ox, y: sr.top, z: z - c.oz, yaw: Math.atan2(-sr.nx, -sr.nz), seed: hash32(seed, 0x3b, p.id, Math.round(s)), ink: false });
        use(side, s);
      }
    }
    // ---- small things on sidewalks (against the frontage)
    const r = new Rng(hash32(seed, 0x4a, p.id, c.ci));
    for (const side of [1, -1] as const) {
      const n = r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const s = r.range(c.s0 + 2, c.s1 - 2);
        const sr = this.sideAt(plan, side, s);
        if (!sr || sr.walk < 1.5 || !free(side, s, 3) || this.isHardTurn(p, s, 10)) continue;
        const row = plan.rows.find((rw) => rw.s >= s) ?? plan.rows[0];
        const pool: string[] = row.mood === 'docks' ? ['drums', 'pallets', 'cone', 'vending_machine'] : row.mood === 'oldtown' ? ['vending_machine', 'post_box', 'bicycles', 'planter', 'garbage_station'] : ['vending_machine', 'post_box', 'bicycles', 'phone_box', 'garbage_station', 'hydrant', 'planter'];
        if (row.cls !== 'back' && r.chance(0.25)) pool.push('bus_stop');
        const type = r.pick(pool);
        const off = sr.width - 0.6;
        const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
        plan.props.push({ type, x: x - c.ox, y: sr.top, z: z - c.oz, yaw: Math.atan2(-sr.nx, -sr.nz), seed: r.int(0, 1e9), ink: type === 'phone_box' || type === 'bus_stop' });
        use(side, s);
      }
    }
    // ---- hard turns: warning signs before them (both directions) and chevrons outside
    for (const ev of p.events) {
      if (!HARD_TURNS.includes(ev.type)) continue;
      const first = ev.turns[0]?.[2] ?? ev.dir, last = ev.turns[ev.turns.length - 1]?.[2] ?? ev.dir;
      const hair = ev.type === 'hairpin' || ev.type === 'switchbacks';
      // outbound (+s) drivers: sign on the left 90 m before, facing back down the road
      const sOut = ev.s0 - 90;
      if (sOut >= c.s0 && sOut < c.s1) {
        const sr = this.sideAt(plan, 1, sOut);
        if (sr && sr.clear > 1.5) {
          const type = hair ? (first > 0 ? 'sign_hairpin_l' : 'sign_hairpin_r') : (first > 0 ? 'sign_curve_l' : 'sign_curve_r');
          const off = Math.min(sr.width, 0.6) + 0.2;
          p.pointAt(sOut, _pt);
          const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
          plan.props.push({ type, x: x - c.ox, y: off <= sr.width ? sr.top : this.ground(x, z), z: z - c.oz, yaw: _pt.h + Math.PI, seed: ev.id, ink: true });
        }
      }
      // inbound (−s) drivers: sign on the right 90 m after the event, facing up the road; the
      // last turn comes first for them, mirrored
      const sIn = ev.s1 + 90;
      if (sIn >= c.s0 && sIn < c.s1) {
        const sr = this.sideAt(plan, -1, sIn);
        if (sr && sr.clear > 1.5) {
          const type = hair ? (last > 0 ? 'sign_hairpin_r' : 'sign_hairpin_l') : (last > 0 ? 'sign_curve_r' : 'sign_curve_l');
          const off = Math.min(sr.width, 0.6) + 0.2;
          p.pointAt(sIn, _pt);
          const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
          plan.props.push({ type, x: x - c.ox, y: off <= sr.width ? sr.top : this.ground(x, z), z: z - c.oz, yaw: _pt.h, seed: ev.id + 1, ink: true });
        }
      }
      // chevron boards on the outside of each turn, every ~8 m, facing the road
      for (const [a, b, dir] of ev.turns) {
        const side = (-Math.sign(dir) || 1) as 1 | -1;
        const n = Math.max(2, Math.round((b - a) / 8));
        for (let i = 0; i <= n; i++) {
          const s = a + ((b - a) * i) / n;
          if (s < c.s0 || s >= c.s1) continue;
          const sr = this.sideAt(plan, side, s);
          if (!sr || sr.clear < 1.2) continue;
          const off = Math.min(sr.width, 0.5) + 0.35;
          const x = sr.kx + sr.nx * off, z = sr.kz + sr.nz * off;
          plan.props.push({ type: dir > 0 ? 'chevron_l' : 'chevron_r', x: x - c.ox, y: off <= sr.width ? sr.top : this.ground(x, z), z: z - c.oz, yaw: Math.atan2(-sr.nx, -sr.nz), seed: ev.id * 31 + i, ink: true });
        }
      }
    }
    // ---- the guide gantry before a fork
    const f = this.d.gen.forks.find((ff) => ff.trunk === p);
    if (f && f.signS >= c.s0 && f.signS < c.s1) {
      p.xsAt(f.signS, _xs);
      plan.guide = { s: f.signS, left: f.destL.place, right: f.destR.place, span: _xs.kerbL - _xs.kerbR + 1.2 };
    }
  }

  /** sideAt for an s that may lie outside this chunk (wires reaching the next pole). */
  private sideAtAny(c: Chunk, plan: Plan, side: 1 | -1, s: number): SideRow | null {
    if (s >= plan.rows[0].s && s <= plan.rows[plan.rows.length - 1].s) return this.sideAt(plan, side, s);
    const p = c.path;
    if (s > p.sampleEnd - 1 || s < p.base) return null;
    p.pointAt(s, _pt);
    p.xsAt(s, _xs);
    const [lo, hi] = p.drivableAt(s, _xs);
    this.d.gen.districts.moodWeights(_pt.x, _pt.z, _mw);
    return this.sideRow(p, s, side, lo, hi, _pt.k, p.classAt(s), _mw);
  }

  private anchors(type: string, seed: number): Anchor[] {
    return this.propInfo(type, seed).anchors;
  }

  private propInfo(type: string, seed: number): { lights: Light[]; anchors: Anchor[] } {
    const key = `${type}:${seed % 8}`;
    let v = this.lightCache.get(key);
    if (!v) {
      const w = new WorldGeom(), ik = new InkedGeom();
      const r = buildProp(w, ik, this.d.tex.L, type, seed % 8);
      v = { lights: r.lights, anchors: r.wireAnchors ?? [] };
      this.lightCache.set(key, v);
    }
    return v;
  }

  /** Road text and marks for this chunk. */
  private planMarks(c: Chunk, plan: Plan) {
    const p = c.path;
    const xs = _xs;
    // 止まれ + stop line where this branch's inbound traffic yields
    const js = p.junctionStart;
    if (js && js.stopLine !== null && js.stopLine >= c.s0 && js.stopLine < c.s1) {
      p.xsAt(js.stopLine, xs);
      const lanes = xs.lanesIn;
      for (let i = 0; i < lanes; i++) {
        const t = laneCenter(xs, -1, i);
        plan.decals.push({ name: 'stopline', s: js.stopLine, t, dir: -1, scaleW: xs.laneW });
        plan.decals.push({ name: 'tomare', s: js.stopLine + 6.5, t, dir: -1 });
      }
    }
    // hard turns: スピード落とせ (slow down) before them, in both directions
    for (const ev of p.events) {
      if (!HARD_TURNS.includes(ev.type)) continue;
      const sOut = ev.s0 - 55, sIn = ev.s1 + 55;
      if (sOut >= c.s0 && sOut < c.s1) { p.xsAt(sOut, xs); plan.decals.push({ name: 'slow_down', s: sOut, t: laneCenter(xs, 1, 0), dir: 1 }); }
      if (sIn >= c.s0 && sIn < c.s1) { p.xsAt(sIn, xs); plan.decals.push({ name: 'slow_down', s: sIn, t: laneCenter(xs, -1, 0), dir: -1 }); }
    }
    // a fork ahead: arrows in each outbound lane
    const f = this.d.gen.forks.find((ff) => ff.trunk === p);
    if (f) {
      const sA = (p.junctionEnd?.s0 ?? f.s - 70) - 25;
      if (sA >= c.s0 && sA < c.s1) {
        p.xsAt(sA, xs);
        const n = xs.lanesOut;
        for (let i = 0; i < n; i++) {
          const name = n === 1 ? 'arrow_left_right' : i < n / 2 ? (n % 2 === 1 && i === (n - 1) / 2 ? 'arrow_left_right' : 'arrow_right') : 'arrow_left';
          // lane 0 is nearest the centre: with left-hand traffic the leftmost lane is the last one
          plan.decals.push({ name, s: sA, t: laneCenter(xs, 1, i), dir: 1 });
        }
      }
    }
    // crosswalks on straight, level town stretches
    const mid = plan.rows[Math.floor(plan.rows.length / 2)];
    const town = mid.mood !== 'edge' && mid.mood !== 'docks';
    const cw = hash32(this.d.seed, 0xc055, p.id, c.ci) % 1000 / 1000;
    if (town && mid.cls !== 'arterial' && cw < 0.22) {
      const s = (c.s0 + c.s1) / 2;
      let ok = !this.isHardTurn(p, s, 60) && !(p.junctionEnd && s > p.junctionEnd.s0 - 60) && !(js && s < js.nose + 60);
      for (let q = s - 25; q <= s + 25 && ok; q += 5) {
        p.pointAt(q, _pt); p.profile.eval(q, _pe);
        if (Math.abs(_pt.k) > 0.004 || Math.abs(_pe.g) > 0.04) ok = false;
      }
      const L = this.sideAt(plan, 1, s), R = this.sideAt(plan, -1, s);
      if (ok && L && R && L.walk > 0 && R.walk > 0) {
        p.xsAt(s, xs);
        for (let t = xs.kerbR + 0.6; t <= xs.kerbL - 0.6; t += 0.9) plan.decals.push({ name: 'crosswalk_bar', s, t, dir: 1 });
        for (const [dd, dir, side] of [[-30, 1, 1], [-50, 1, 1], [30, -1, -1], [50, -1, -1]] as const) {
          const q = s + dd;
          if (q > c.s0 - 60 && q > p.base + 2) plan.decals.push({ name: 'diamond', s: q, t: laneCenter(xs, side, 0), dir });
        }
        for (const side of [1, -1] as const) {
          const sr = side > 0 ? L : R;
          const x = sr.kx + sr.nx * 0.5, z = sr.kz + sr.nz * 0.5;
          p.pointAt(s, _pt);
          plan.props.push({ type: 'sign_crossing', x: x - c.ox, y: sr.top, z: z - c.oz, yaw: side > 0 ? _pt.h + Math.PI : _pt.h, seed: c.ci, ink: true });
        }
      }
    }
  }

  // ───────────────────────────── geometry ─────────────────────────────

  private structure(c: Chunk, plan: Plan, w: WorldGeom) {
    const L = this.d.tex.L;
    const concrete: Mat = { layer: L('st_concrete'), tile: [3, 3] };
    const kerbLayer = L(STRIPS.kerb.layer);
    const [ku0, ku1] = stripU(STRIPS.kerb);
    const grass: Mat = { layer: L('st_grass'), tile: [4, 4] };
    const ox = c.ox, oz = c.oz;
    const V = (x: number, y: number, z: number) => new Vector3(x - ox, y, z - oz);
    const rows = plan.rows;
    for (let i = 0; i < rows.length - 1; i++) {
      const r0 = rows[i], r1 = rows[i + 1];
      for (const side of [1, -1] as const) {
        const a = side > 0 ? r0.L : r0.R, b = side > 0 ? r1.L : r1.R;
        if (!a || !b) continue;
        const ka0 = V(a.kx, a.hk - 0.16, a.kz), kb0 = V(b.kx, b.hk - 0.16, b.kz);
        const ka1 = V(a.kx, a.top, a.kz), kb1 = V(b.kx, b.top, b.kz);
        // kerb face (toward the road)
        quadFacing(w, ka0, kb0, kb1, ka1, [a.s / 3, 0, b.s / 3, 0, b.s / 3, 0.1, a.s / 3, 0.1], { ...concrete, color: [0.92, 0.92, 0.94] }, -a.nx, -a.nz, 0, 1);
        // kerb band on top
        const band = Math.min(KERB_BAND, a.width, b.width);
        const ba = V(a.kx + a.nx * band, a.top, a.kz + a.nz * band), bb = V(b.kx + b.nx * band, b.top, b.kz + b.nz * band);
        if (band > 0.02) quadUp(w, ka1, kb1, bb, ba, [ku0, a.s / 2, ku0, b.s / 2, ku1, b.s / 2, ku1, a.s / 2], { layer: kerbLayer });
        // pavement
        if (a.width > band + 0.05 || b.width > band + 0.05) {
          const fallA = 0.015 * a.width, fallB = 0.015 * b.width;
          const oa = V(a.ox, a.top + fallA, a.oz), ob = V(b.ox, b.top + fallB, b.oz);
          const layerName = SIDEWALK_LAYERS[r0.mood];
          const tile = SURF_TILE[layerName] ?? 2.4;
          const ta = (a.kerbT + side * band) / tile, tb = (a.kerbT + side * a.width) / tile;
          quadUp(w, ba, bb, ob, oa, [a.s / tile, ta, b.s / tile, ta, b.s / tile, tb, a.s / tile, tb], { layer: L(layerName), tile: [tile, tile] });
        }
        // outer face down into the land
        const topA = a.top + 0.015 * a.width, topB = b.top + 0.015 * b.width;
        const botA = Math.min(a.ground, topA) - WALL_DEPTH, botB = Math.min(b.ground, topB) - WALL_DEPTH;
        quadFacing(w, V(a.ox, botA, a.oz), V(b.ox, botB, b.oz), V(b.ox, topB, b.oz), V(a.ox, topA, a.oz),
          [a.s / 3, botA / 3, b.s / 3, botB / 3, b.s / 3, topB / 3, a.s / 3, topA / 3], { ...concrete, color: [0.86, 0.85, 0.88] }, a.nx, a.nz, 0, 1);
      }
      // raised median
      if (r0.median > 0.05 && r1.median > 0.05) {
        const m0 = r0.median, m1 = r1.median;
        const pts = (r: Row, t: number, y: number) => {
          const x = r.x + Math.cos(r.h) * t, z = r.z - Math.sin(r.h) * t;
          return V(x, y, z);
        };
        const y0 = r0.zc + KERB_H, y1 = r1.zc + KERB_H;
        const yb0 = r0.zc - 0.2, yb1 = r1.zc - 0.2;
        for (const sg of [1, -1]) {
          const nx0 = sg * Math.cos(r0.h), nz0 = -sg * Math.sin(r0.h);
          quadFacing(w, pts(r0, sg * m0, yb0), pts(r1, sg * m1, yb1), pts(r1, sg * m1, y1), pts(r0, sg * m0, y0), [r0.s / 3, 0, r1.s / 3, 0, r1.s / 3, 0.12, r0.s / 3, 0.12], { ...concrete, color: [0.92, 0.92, 0.94] }, nx0, nz0, 0, 1);
          // kerb band
          const bw = Math.min(KERB_BAND, m0 * 0.4);
          quadUp(w, pts(r0, sg * m0, y0), pts(r1, sg * m1, y1), pts(r1, sg * (m1 - bw), y1), pts(r0, sg * (m0 - bw), y0), [ku0, r0.s / 2, ku0, r1.s / 2, ku1, r1.s / 2, ku1, r0.s / 2], { layer: kerbLayer });
        }
        const bw0 = Math.min(KERB_BAND, m0 * 0.4), bw1 = Math.min(KERB_BAND, m1 * 0.4);
        quadUp(w, pts(r0, -(m0 - bw0), y0 + 0.02), pts(r1, -(m1 - bw1), y1 + 0.02), pts(r1, m1 - bw1, y1 + 0.02), pts(r0, m0 - bw0, y0 + 0.02), [r0.s / 4, -m0 / 4, r1.s / 4, -m1 / 4, r1.s / 4, m1 / 4, r0.s / 4, m0 / 4], grass);
      }
      // median end caps
      const capAt = (r: Row, dirSign: number) => {
        const m = r.median, y = r.zc + KERB_H;
        const ux = Math.sin(r.h) * dirSign, uz = Math.cos(r.h) * dirSign;
        const pl = (t: number, yy: number) => V(r.x + Math.cos(r.h) * t, yy, r.z - Math.sin(r.h) * t);
        quadFacing(w, pl(-m, r.zc - 0.2), pl(m, r.zc - 0.2), pl(m, y), pl(-m, y), [0, 0, 1, 0, 1, 0.1, 0, 0.1], concrete, ux, uz, 0, 1);
      };
      if (r0.median > 0.05 && r1.median > 0.05) {
        if (i === 0 && rows[0].median > 0.05) { /* continues from the previous chunk */ }
        const prev = rows[i - 1];
        if (prev && prev.median <= 0.05) capAt(r0, -1);
        const next = rows[i + 2];
        if (next && next.median <= 0.05) capAt(r1, 1);
      }
    }
  }

  private buildPlot(c: Chunk, pl: Plot, st: State, lod: 0 | 1) {
    const B = st.building!;
    const w = B.world, ik = B.inked;
    const L = this.d.tex.L;
    const m = new Matrix4().makeRotationY(pl.yaw).setPosition(pl.fx - c.ox, pl.y, pl.fz - c.oz);
    const save = w.m.clone(), saveI = ik.m.clone();
    w.m.copy(m); ik.m.copy(m);
    const lights: Light[] = [];
    if (pl.kind === 'building' && pl.type) {
      if (lod === 0) {
        const r = buildBuilding(w, ik, L, { type: pl.type, width: pl.w, depth: pl.d, floors: pl.floors, seed: pl.seed });
        lights.push(...r.lights);
      } else {
        buildFarBuilding(w, L, { mood: pl.mood, width: pl.w, depth: pl.d, height: pl.height, seed: pl.seed });
      }
    } else if (pl.kind === 'carpark') {
      lights.push(...buildCarPark(w, ik, L, pl.w, pl.d, pl.seed).lights);
    } else {
      lights.push(...buildEmptyLot(w, ik, L, pl.w, pl.d, pl.seed).lights);
    }
    // plinth down into the land where it falls away under the plot
    if (pl.minGround < pl.y - 0.3) {
      const conc: Mat = { layer: L('st_concrete'), tile: [3, 3], color: [0.8, 0.8, 0.84] };
      const y0 = pl.minGround - WALL_DEPTH;
      w.box(-pl.w / 2 + 0.02, y0 - pl.y, -pl.d + 0.02, pl.w / 2 - 0.02, -0.02, -0.02, { pz: conc, nz: conc, px: conc, nx: conc });
    }
    for (const l of lights) {
      const v = new Vector3(l.x, l.y, l.z).applyMatrix4(m);
      B.lights.push({ ...l, x: v.x, y: v.y, z: v.z });
    }
    w.m.copy(save); ik.m.copy(saveI);
  }

  private furniture(c: Chunk, st: State, lod: 0 | 1) {
    const B = st.building!, plan = st.plan!;
    const w = B.world, ik = B.inked, L = this.d.tex.L;
    const place = (x: number, y: number, z: number, yaw: number) => new Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    for (const pr of plan.props) {
      if (lod === 1 && !pr.ink && !pr.type.startsWith('tree')) continue; // far: lamps, poles, signs, trees only
      const m = place(pr.x, pr.y, pr.z, pr.yaw);
      const sw = w.m.clone(), si = ik.m.clone();
      w.m.copy(m); ik.m.copy(m);
      const r = buildProp(w, ik, L, pr.type, pr.seed);
      w.m.copy(sw); ik.m.copy(si);
      for (const l of r.lights) { const v = new Vector3(l.x, l.y, l.z).applyMatrix4(m); B.lights.push({ ...l, x: v.x, y: v.y, z: v.z }); }
    }
    for (const e of plan.edges) B.lights.push(...buildEdge(w, ik, L, e.type, e.pts, e.seed).lights);
    if (lod === 0) for (const wi of plan.wires) buildWires(w, wi.a, wi.b, wi.sag);
    if (plan.guide) {
      const p = c.path;
      p.pointAt(plan.guide.s, _pt);
      const y = this.d.surface.baseHeight(p, plan.guide.s, 0);
      const m = place(_pt.x - c.ox, y, _pt.z - c.oz, _pt.h + Math.PI);
      const sw = w.m.clone(), si = ik.m.clone();
      w.m.copy(m); ik.m.copy(m);
      const r = buildGuideSign(w, ik, L, { left: plan.guide.left, right: plan.guide.right, span: plan.guide.span });
      w.m.copy(sw); ik.m.copy(si);
      for (const l of r.lights) { const v = new Vector3(l.x, l.y, l.z).applyMatrix4(m); B.lights.push({ ...l, x: v.x, y: v.y, z: v.z }); }
    }
    if (lod === 0) this.decals(c, plan, B.decal);
  }

  /** Road marks as quads that follow the road surface (wear included) just above it. */
  private decals(c: Chunk, plan: Plan, w: WorldGeom) {
    const p = c.path, surf = this.d.surface, L = this.d.tex.L;
    for (const d of plan.decals) {
      let layer: number, uv: [number, number, number, number], width: number, length: number;
      if (d.name === 'stopline') {
        const [u0, u1] = stripU(STRIPS.line);
        layer = L(STRIPS.line.layer); uv = [u0, 0, u1, 1]; width = d.scaleW ?? 3; length = 0.45;
        // the strip's u runs across its width: draw it rotated (u along the bar)
        const hw = width / 2, hl = length / 2;
        this.decalQuad(c, p, d.s, d.t, d.dir, hw, hl, (a, b) => [u0 + (u1 - u0) * b, a * 2], layer, w);
        continue;
      }
      const m = ROAD_MARKS[d.name];
      if (!m) continue;
      layer = L(m.layer); uv = m.uv; width = m.width * (d.scaleW ?? 1); length = m.length * (d.scaleL ?? 1);
      const hw = width / 2, hl = length / 2;
      this.decalQuad(c, p, d.s, d.t, d.dir, hw, hl, (a, b) => [uv[0] + (uv[2] - uv[0]) * a, uv[1] + (uv[3] - uv[1]) * b], layer, w);
    }
    void surf;
  }

  /**
   * A mark centred at (s, t), `hl` metres either way along the road and `hw` across, for traffic
   * moving in `dir`. uvAt(a, b): a ∈ [0,1] across from the driver's left, b ∈ [0,1] near → far.
   */
  private decalQuad(c: Chunk, p: Path, s: number, t: number, dir: 1 | -1, hw: number, hl: number, uvAt: (a: number, b: number) => [number, number], layer: number, w: WorldGeom) {
    const nS = Math.max(1, Math.ceil((2 * hl) / 0.8));
    const nT = Math.max(1, Math.ceil((2 * hw) / 1.2));
    const grid: Vector3[][] = [];
    const uvs: [number, number][][] = [];
    for (let i = 0; i <= nS; i++) {
      const b = i / nS; // near → far
      const ss = s + dir * (-hl + 2 * hl * b);
      const row: Vector3[] = [], ur: [number, number][] = [];
      for (let j = 0; j <= nT; j++) {
        const a = j / nT; // driver's left → right
        // the driver's left is +t for outbound (dir 1) and −t for inbound
        const tt = t + dir * (hw - 2 * hw * a);
        this.d.surface.world(p, ss, tt, _w);
        const y = this.d.surface.height(p, ss, tt) + 0.015;
        row.push(new Vector3(_w.x - c.ox, y, _w.z - c.oz));
        ur.push(uvAt(a, b));
      }
      grid.push(row); uvs.push(ur);
    }
    for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) {
      const A = grid[i][j], Bv = grid[i][j + 1], C = grid[i + 1][j + 1], D = grid[i + 1][j];
      const ua = uvs[i][j], ub = uvs[i][j + 1], uc = uvs[i + 1][j + 1], ud = uvs[i + 1][j];
      quadUp(w, A, Bv, C, D, [ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]], { layer });
    }
  }

  private finish(c: Chunk, st: State) {
    const B = st.building!;
    // bake night light into the roadside and the road
    bakeLights(B.world, B.lights);
    bakeLights(B.decal, B.lights);
    if (c.road) bakeRoadLights(c.road, B.lights);
    const meshes: Mesh[] = [];
    if (B.world.vertexCount) {
      const m = new Mesh(B.world.toGeometry(), this.d.mats.world);
      m.name = 'roadside'; m.matrixAutoUpdate = false;
      meshes.push(m);
    }
    if (B.decal.vertexCount) {
      const m = new Mesh(B.decal.toGeometry(), this.d.mats.decal);
      m.name = 'marks'; m.matrixAutoUpdate = false; m.renderOrder = 1;
      meshes.push(m);
    }
    if (B.inked.vertexCount) {
      const g = B.inked.toGeometry();
      addSmoothNormals(g);
      g.computeBoundingSphere();
      const m = new Mesh(g, this.d.mats.prop);
      m.name = 'props'; m.matrixAutoUpdate = false;
      meshes.push(m);
      if (B.lod === 0) {
        const ink = new Mesh(g, this.d.mats.ink);
        ink.name = 'ink'; ink.matrixAutoUpdate = false; ink.renderOrder = -1;
        meshes.push(ink);
      }
    }
    // swap
    for (const m of st.meshes) { c.group.remove(m); if (!meshes.some((n) => n.geometry === m.geometry)) m.geometry.dispose(); }
    for (const m of meshes) { c.group.add(m); m.updateMatrixWorld(true); }
    st.meshes = meshes;
    this.stats.worldTris += B.world.triangleCount;
    st.building = null;
    st.done = true;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function segDist(x: number, z: number, s: CorridorSeg): number {
  const bx = s.x1 - s.x0, bz = s.z1 - s.z0;
  const L2 = bx * bx + bz * bz;
  let t = L2 > 1e-9 ? ((x - s.x0) * bx + (z - s.z0) * bz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (s.x0 + bx * t), z - (s.z0 + bz * t));
}

function rot(a: Anchor, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * a.x + s * a.z, z: -s * a.x + c * a.z };
}

const _e1 = new Vector3(), _e2 = new Vector3(), _n = new Vector3();
/** Quad whose front faces (fx, fz) horizontally; gradient g0 at the bottom edge (p0,p1), g1 at the top. */
function quadFacing(w: WorldGeom, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, uv: [number, number, number, number, number, number, number, number], mat: Mat, fx: number, fz: number, g0: number, g1: number) {
  _e1.subVectors(p1, p0); _e2.subVectors(p3, p0); _n.crossVectors(_e1, _e2);
  if (_n.x * fx + _n.z * fz >= 0) w.quadUV(p0, p1, p2, p3, uv, mat, g0, g1);
  else w.quadUV(p1, p0, p3, p2, [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], mat, g0, g1);
}
/** Horizontal-ish quad facing up. */
function quadUp(w: WorldGeom, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, uv: [number, number, number, number, number, number, number, number], mat: Mat) {
  _e1.subVectors(p1, p0); _e2.subVectors(p3, p0); _n.crossVectors(_e1, _e2);
  if (_n.y >= 0) w.quadUV(p0, p1, p2, p3, uv, mat, -1, -1);
  else w.quadUV(p1, p0, p3, p2, [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], mat, -1, -1);
}

/** Bakes lamp light into the aLight rgb of world vertices (soft falloff, facing term). */
export function bakeLights(w: WorldGeom, lights: Light[]) {
  if (!lights.length) return;
  const n = w.vertexCount, P = w.pos.a, N = w.nor.a, A = w.light.a;
  for (const l of lights) {
    const r = l.radius, r2 = r * r;
    for (let i = 0; i < n; i++) {
      const dx = l.x - P[i * 3], dy = l.y - P[i * 3 + 1], dz = l.z - P[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const q = 1 - d2 / r2;
      const facing = Math.max(0.15, (N[i * 3] * dx + N[i * 3 + 1] * dy + N[i * 3 + 2] * dz) / d * 0.7 + 0.3);
      const k = q * q * facing;
      A[i * 4] += l.r * k; A[i * 4 + 1] += l.g * k; A[i * 4 + 2] += l.b * k;
    }
  }
}

/** Same light into the road mesh's aLamp attribute (lamp pools on the asphalt). */
export function bakeRoadLights(road: Mesh, lights: Light[]) {
  const g = road.geometry;
  let a = g.getAttribute('aLamp') as BufferAttribute | undefined;
  const pos = g.getAttribute('position');
  const n = pos.count;
  if (!a) { a = new BufferAttribute(new Float32Array(n * 3), 3); g.setAttribute('aLamp', a); }
  const A = a.array as Float32Array;
  A.fill(0);
  for (const l of lights) {
    const r2 = l.radius * l.radius;
    for (let i = 0; i < n; i++) {
      const dx = l.x - pos.getX(i), dy = l.y - pos.getY(i), dz = l.z - pos.getZ(i);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const q = 1 - d2 / r2;
      const k = q * q * Math.min(1, Math.max(0.2, dy / Math.sqrt(d2 + 1e-6)));
      A[i * 3] += l.r * k; A[i * 3 + 1] += l.g * k; A[i * 3 + 2] += l.b * k;
    }
  }
  a.needsUpdate = true;
}
