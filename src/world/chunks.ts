import { DataArrayTexture, Group, Mesh, ShaderMaterial } from 'three';
import { Path } from '../road/path';
import { RoadSurface } from '../road/surface';
import { RoadGenerator } from '../road/generator';
import { WEAR_CHUNK, rasterWearColumns } from '../road/wear';
import { CrossSection } from '../road/types';
import { buildRoadChunk, WearTileRef } from './roadMesh';

/**
 * The near world, chunk by chunk: one chunk is WEAR_CHUNK metres of one path. Chunks are
 * built nearest-first inside a per-frame time budget and dropped when far away or when their
 * path is discarded. Wear tiles (the detailed surface texture) are only kept for chunks close
 * to the camera; far chunks sample a neutral layer.
 */

export interface ChunkPart {
  /** called when the chunk is dropped */
  dispose(): void;
}

export interface Chunk {
  key: string;
  path: Path;
  ci: number;
  s0: number;
  s1: number;
  /** render-space origin this chunk's vertices are relative to (world x, z) */
  ox: number;
  oz: number;
  group: Group;
  road: Mesh | null;
  wearLayer: number; // 0 = neutral
  tMin: number;
  tMax: number;
  parts: ChunkPart[];
  /** distance to the camera when last ranked */
  dist: number;
  alive: boolean;
}

/** A small piece of world-building work tied to a chunk (run in order, inside the frame budget). */
/** run() may return follow-up jobs, which go straight after it in the queue. */
export interface ChunkJob { c: Chunk; run(): void | ChunkJob[]; label: string }

export interface ChunkHooks {
  /** the jobs that build everything beside a freshly built road chunk */
  roadside?(c: Chunk): ChunkJob[];
  /** jobs to rebuild a chunk in more detail now that it is near (empty when not needed) */
  upgrade?(c: Chunk): ChunkJob[];
  /** a chunk was removed */
  removed?(c: Chunk): void;
}

/** Index of the chunk that ends at a fork at arc length `f` (stretched by up to 1 m rather than leave a sliver). */
const forkChunk = (f: number) => Math.ceil((f - 1) / WEAR_CHUNK) - 1;
const _pt = { x: 0, z: 0, h: 0, k: 0 };
const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };

export interface ChunkOptions {
  radius: number; // build chunks whose centre is within this distance of the camera
  wearRadius: number; // keep a wear tile within this distance
  wearLayers: number;
  wearW: number; // tile texels along s
  wearH: number; // tile texels across t
  wearPx: number; // texels per metre along s
}

export class ChunkManager {
  chunks = new Map<string, Chunk>();
  root = new Group();
  private freeLayers: number[] = [];
  originX = 0;
  originZ = 0;
  stats = { built: 0, dropped: 0, buildMs: 0, maxBuildMs: 0, wearMs: 0, jobs: 0, maxJobMs: 0, maxJob: '', pendingJobs: 0, prepMs: 0, maxPrepMs: 0, frameMaxJobMs: 0, frameMaxJob: '' };
  /** Time per kind of work (label → count, total ms, max ms), for the perf tools. */
  timing: Record<string, { n: number; ms: number; max: number }> = {};
  private time(label: string, ms: number) {
    const t = this.timing[label] ?? (this.timing[label] = { n: 0, ms: 0, max: 0 });
    t.n++; t.ms += ms; if (ms > t.max) t.max = ms;
  }
  private jobs: ChunkJob[] = [];
  /** wear tiles being rasterised, a band of columns at a time */
  private wearTasks: { c: Chunk; layer: number; x: number }[] = [];

  constructor(
    public gen: RoadGenerator,
    public surface: RoadSurface,
    public wearTex: DataArrayTexture,
    public roadMat: ShaderMaterial,
    public opt: ChunkOptions,
    public hooks: ChunkHooks = {},
    public tone: (p: Path, s: number) => [number, number, number] = () => [0.36, 0.37, 0.42],
  ) {
    this.root.name = 'chunks';
    for (let i = opt.wearLayers - 1; i >= 1; i--) this.freeLayers.push(i);
  }

  /** Final arc length a path can be built to (profile fixed, before its fork). */
  private buildEnd(p: Path): number {
    return Math.min(this.gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
  }

  /**
   * The last chunk of a path that can be built. A road that is still growing is drawn in whole
   * chunks up to its final end; a road that forks ends there for good, so its last chunk runs
   * to the fork (a part chunk, or one stretched by up to a metre), where the branches start.
   */
  private lastChunk(p: Path): number {
    const end = this.buildEnd(p);
    const whole = Math.floor(end / WEAR_CHUNK) - 1;
    if (p.forkS === null) return whole;
    const k = forkChunk(p.forkS);
    // the chunk that runs to the fork waits until the road is built that far (samples are a
    // metre apart: the last fraction of a metre is the straight approach, extrapolated exactly)
    return end >= p.forkS - 1 ? k : Math.min(whole, k - 1);
  }

  /** Arc length where chunk `ci` of `p` ends (see lastChunk). */
  chunkEnd(p: Path, ci: number): number {
    if (p.forkS !== null && ci === forkChunk(p.forkS)) return p.forkS;
    return (ci + 1) * WEAR_CHUNK;
  }

  /**
   * Bring the chunk set up to date around (cx, cz) within `budgetMs`. Returns the number of
   * chunks still waiting to be built.
   */
  update(cx: number, cz: number, budgetMs: number, now: () => number = () => performance.now()): number {
    const t0 = now();
    const want = new Map<string, { p: Path; ci: number; d: number }>();
    const R = this.opt.radius;
    for (const p of this.gen.net.paths) {
      const c0 = Math.ceil(p.base / WEAR_CHUNK), c1 = this.lastChunk(p);
      for (let ci = c0; ci <= c1; ci++) {
        p.pointAt((ci * WEAR_CHUNK + this.chunkEnd(p, ci)) / 2, _pt);
        const d = Math.hypot(_pt.x - cx, _pt.z - cz);
        if (d < R) want.set(`${p.id}:${ci}`, { p, ci, d });
      }
    }
    // drop chunks no longer wanted (with hysteresis) or whose path is gone
    for (const [k, c] of this.chunks) {
      const alive = this.gen.net.paths.includes(c.path) && c.s0 >= c.path.base;
      if (!alive) { this.drop(c); continue; }
      c.path.pointAt((c.s0 + c.s1) / 2, _pt);
      c.dist = Math.hypot(_pt.x - cx, _pt.z - cz);
      if (!want.has(k) && c.dist > R + 120) this.drop(c);
    }
    // wear tiles: release far ones, assign near ones (nearest first)
    for (const c of this.chunks.values()) if (c.wearLayer > 0 && c.dist > this.opt.wearRadius + 60) this.releaseWear(c);
    const todo = [...want.entries()].filter(([k]) => !this.chunks.has(k)).sort((a, b) => a[1].d - b[1].d);
    // start tiles for the nearest chunks without one (at most two in flight), then rasterise
    // bands of columns: a whole tile is too much for one frame
    const nearNoWear = [...this.chunks.values()].filter((c) => c.wearLayer === 0 && c.dist < this.opt.wearRadius && !this.wearTasks.some((w) => w.c === c)).sort((a, b) => a.dist - b.dist);
    let started = 0;
    for (const c of nearNoWear) {
      if (this.wearTasks.length >= 2 || !this.freeLayers.length) break;
      this.wearTasks.push({ c, layer: this.freeLayers.pop()!, x: 0 });
      started++;
    }
    const wearWaiting = this.freeLayers.length ? nearNoWear.length - started : 0;
    while (this.wearTasks.length && now() - t0 <= budgetMs) {
      const tw = now();
      this.wearBand(this.wearTasks[0]);
      this.time('wear', now() - tw);
    }
    // chunks that came near and want more detail
    if (this.hooks.upgrade) {
      const busy = new Set(this.jobs.map((j) => j.c));
      for (const c of this.chunks.values()) if (!busy.has(c)) this.jobs.push(...this.hooks.upgrade(c));
    }
    // one queue: road builds and roadside jobs, nearest chunk first (jobs of a chunk keep order)
    this.jobs = this.jobs.filter((j) => j.c.alive);
    this.jobs.sort((a, b) => a.c.dist - b.c.dist);
    this.stats.prepMs = now() - t0;
    this.time('prep', this.stats.prepMs);
    this.stats.maxPrepMs = Math.max(this.stats.maxPrepMs, this.stats.prepMs);
    let ti = 0, ji = 0;
    this.stats.frameMaxJobMs = 0;
    while (now() - t0 <= budgetMs) {
      const nb = ti < todo.length ? todo[ti][1].d : Infinity;
      const nj = ji < this.jobs.length ? this.jobs[ji].c.dist + 1 : Infinity;
      if (nb === Infinity && nj === Infinity) break;
      const tb = now();
      if (nb <= nj) {
        const [key, w] = todo[ti++];
        this.build(key, w.p, w.ci, w.d);
        const dt = now() - tb;
        this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, dt);
        this.time('road', dt);
        if (dt > this.stats.frameMaxJobMs) { this.stats.frameMaxJobMs = dt; this.stats.frameMaxJob = 'road'; }
      } else {
        const j = this.jobs[ji++];
        if (!j.c.alive) continue;
        const more = j.run();
        if (more && more.length) this.jobs.splice(ji, 0, ...more);
        const dt = now() - tb;
        this.stats.jobs++;
        this.time(j.label, dt);
        if (dt > this.stats.frameMaxJobMs) { this.stats.frameMaxJobMs = dt; this.stats.frameMaxJob = j.label; }
        if (dt > this.stats.maxJobMs) { this.stats.maxJobMs = dt; this.stats.maxJob = j.label; }
      }
    }
    this.jobs.splice(0, ji);
    this.stats.pendingJobs = this.jobs.length;
    this.stats.buildMs = now() - t0;
    return todo.length - ti + this.jobs.length + this.wearTasks.length + wearWaiting;
  }

  private build(key: string, p: Path, ci: number, d: number) {
    const s0 = ci * WEAR_CHUNK, s1 = this.chunkEnd(p, ci);
    // origin: the chunk's own start point (keeps vertex floats small)
    p.pointAt(s0, _pt);
    const ox = Math.round(_pt.x), oz = Math.round(_pt.z);
    const group = new Group();
    group.name = key;
    const c: Chunk = { key, path: p, ci, s0, s1, ox, oz, group, road: null, wearLayer: 0, tMin: 0, tMax: 0, parts: [], dist: d, alive: true };
    // lateral extent first (the wear tile must cover it)
    this.extent(c);
    const tile = this.tileRef(c, 0);
    const rc = buildRoadChunk(this.surface, p, s0, s1, ox, oz, tile, (s) => this.tone(p, s), p.id * 1000 + ci);
    const mesh = new Mesh(rc.geometry, this.roadMat);
    mesh.name = 'road';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    c.road = mesh;
    group.position.set(ox - this.originX, 0, oz - this.originZ);
    group.updateMatrixWorld(true);
    this.root.add(group);
    this.chunks.set(key, c);
    if (this.hooks.roadside) this.jobs.push(...this.hooks.roadside(c));
    this.stats.built++;
  }

  private extent(c: Chunk) {
    let lo = Infinity, hi = -Infinity;
    for (let s = c.s0; s <= c.s1; s += 2) {
      c.path.xsAt(s, _xs);
      const [a, b] = c.path.drivableAt(s, _xs);
      lo = Math.min(lo, a); hi = Math.max(hi, b);
    }
    c.tMin = lo - 0.5;
    c.tMax = hi + 0.5;
  }

  private tileRef(c: Chunk, layer: number): WearTileRef {
    const width = Math.max(1, c.tMax - c.tMin);
    return { layer, s0: c.s0, tMin: c.tMin, pxS: this.opt.wearPx, pxT: this.opt.wearH / width, W: this.opt.wearW, H: this.opt.wearH };
  }

  /**
   * A band of a wear tile: 16 columns at a time until ~1.5 ms is spent; the last band uploads
   * the layer and hands it to the chunk.
   */
  private wearBand(w: { c: Chunk; layer: number; x: number }) {
    const tb = performance.now();
    const c = w.c;
    const ref = this.tileRef(c, w.layer);
    const img = this.wearTex.image as { data: Uint8Array; width: number; height: number };
    const view = img.data.subarray(w.layer * ref.W * ref.H * 4, (w.layer + 1) * ref.W * ref.H * 4);
    while (w.x < ref.W && performance.now() - tb < 1.5) {
      const x1 = Math.min(ref.W, w.x + 16);
      rasterWearColumns(this.surface.wear, c.path, c.s0, c.tMin, ref.pxS, ref.pxT, ref.W, ref.H, view, w.x, x1);
      w.x = x1;
    }
    if (w.x >= ref.W) {
      this.wearTasks.shift();
      this.wearTex.addLayerUpdate(w.layer);
      this.wearTex.needsUpdate = true;
      this.setLayer(c, w.layer);
    }
    this.stats.wearMs += performance.now() - tb;
  }

  /** Stop a tile in progress for this chunk (its layer goes back to the pool). */
  private cancelWear(c: Chunk) {
    const i = this.wearTasks.findIndex((w) => w.c === c);
    if (i >= 0) { this.freeLayers.push(this.wearTasks[i].layer); this.wearTasks.splice(i, 1); }
  }

  private releaseWear(c: Chunk) {
    this.cancelWear(c);
    if (c.wearLayer > 0) this.freeLayers.push(c.wearLayer);
    this.setLayer(c, 0);
  }

  private setLayer(c: Chunk, layer: number) {
    c.wearLayer = layer;
    const a = c.road!.geometry.getAttribute('aWear');
    const arr = a.array as Float32Array;
    for (let i = 2; i < arr.length; i += 4) arr[i] = layer;
    a.needsUpdate = true;
  }

  private drop(c: Chunk) {
    c.alive = false;
    this.cancelWear(c);
    if (c.wearLayer > 0) this.freeLayers.push(c.wearLayer);
    c.road?.geometry.dispose();
    for (const part of c.parts) part.dispose();
    this.root.remove(c.group);
    this.chunks.delete(c.key);
    this.hooks.removed?.(c);
    this.stats.dropped++;
  }

  /** Queue extra jobs for chunks with no work pending (e.g. rebuilds after a settings change). */
  requeue(jobsFor: (c: Chunk) => ChunkJob[]) {
    const busy = new Set(this.jobs.map((j) => j.c));
    for (const c of this.chunks.values()) if (!busy.has(c)) this.jobs.push(...jobsFor(c));
  }

  /**
   * Switch to a new wear pool (graphics settings change the tile size and count). Tiles in
   * progress are abandoned, every chunk falls back to the neutral layer with wear coordinates
   * for the new tile size, and near chunks get fresh tiles over the next frames.
   */
  resetWear(wearTex: DataArrayTexture, opt: Pick<ChunkOptions, 'wearLayers' | 'wearW' | 'wearH' | 'wearPx'>) {
    this.wearTasks.length = 0;
    Object.assign(this.opt, opt);
    this.wearTex = wearTex;
    this.freeLayers.length = 0;
    for (let i = opt.wearLayers - 1; i >= 1; i--) this.freeLayers.push(i);
    for (const c of this.chunks.values()) {
      c.wearLayer = 0;
      const ref = this.tileRef(c, 0);
      const g = c.road!.geometry;
      const st = g.getAttribute('aST').array as Float32Array;
      const a = g.getAttribute('aWear');
      const w = a.array as Float32Array;
      for (let i = 0, k = 0; i < w.length; i += 4, k += 2) {
        w[i] = ((st[k] - ref.s0) * ref.pxS) / ref.W;
        w[i + 1] = ((st[k + 1] - ref.tMin) * ref.pxT) / ref.H;
        w[i + 2] = 0;
        w[i + 3] = ref.pxT;
      }
      a.needsUpdate = true;
    }
  }

  /** Move the render origin (floating origin); every chunk group is re-placed. */
  rebase(ox: number, oz: number) {
    this.originX = ox;
    this.originZ = oz;
    for (const c of this.chunks.values()) {
      c.group.position.set(c.ox - ox, 0, c.oz - oz);
      c.group.updateMatrixWorld(true);
    }
  }
}
