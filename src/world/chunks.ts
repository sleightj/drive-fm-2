import { DataArrayTexture, Group, Mesh, ShaderMaterial } from 'three';
import { Path } from '../road/path';
import { RoadSurface } from '../road/surface';
import { RoadGenerator } from '../road/generator';
import { WEAR_CHUNK, rasterWear } from '../road/wear';
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
}

export interface ChunkHooks {
  /** build everything beside the road (edges, lamps, buildings); may add parts */
  roadside?(c: Chunk): void;
  /** a chunk was removed */
  removed?(c: Chunk): void;
}

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
  private tileBuf: Uint8Array;
  originX = 0;
  originZ = 0;
  stats = { built: 0, dropped: 0, buildMs: 0, maxBuildMs: 0, wearMs: 0 };

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
    this.tileBuf = new Uint8Array(opt.wearW * opt.wearH * 4);
  }

  /** Final arc length a path can be built to (profile fixed, before its fork). */
  private buildEnd(p: Path): number {
    return Math.min(this.gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
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
      const end = this.buildEnd(p);
      const c0 = Math.ceil(p.base / WEAR_CHUNK), c1 = Math.floor(end / WEAR_CHUNK) - 1;
      for (let ci = c0; ci <= c1; ci++) {
        p.pointAt(ci * WEAR_CHUNK + WEAR_CHUNK / 2, _pt);
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
    const nearNoWear = [...this.chunks.values()].filter((c) => c.wearLayer === 0 && c.dist < this.opt.wearRadius).sort((a, b) => a.dist - b.dist);
    let pending = todo.length;
    for (const c of nearNoWear) {
      if (now() - t0 > budgetMs) break;
      this.assignWear(c);
    }
    for (const [key, w] of todo) {
      if (now() - t0 > budgetMs) break;
      const tb = now();
      this.build(key, w.p, w.ci, w.d);
      const dt = now() - tb;
      this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, dt);
      pending--;
    }
    this.stats.buildMs = now() - t0;
    return pending;
  }

  private build(key: string, p: Path, ci: number, d: number) {
    const s0 = ci * WEAR_CHUNK, s1 = s0 + WEAR_CHUNK;
    // origin: the chunk's own start point (keeps vertex floats small)
    p.pointAt(s0, _pt);
    const ox = Math.round(_pt.x), oz = Math.round(_pt.z);
    const group = new Group();
    group.name = key;
    const c: Chunk = { key, path: p, ci, s0, s1, ox, oz, group, road: null, wearLayer: 0, tMin: 0, tMax: 0, parts: [], dist: d };
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
    if (d < this.opt.wearRadius) this.assignWear(c);
    this.hooks.roadside?.(c);
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

  private assignWear(c: Chunk) {
    const layer = this.freeLayers.pop();
    if (layer === undefined || !c.road) return;
    const tb = performance.now();
    const ref = this.tileRef(c, layer);
    rasterWear(this.surface.wear, c.path, c.s0, c.tMin, ref.pxS, ref.pxT, ref.W, ref.H, this.tileBuf);
    const img = this.wearTex.image as { data: Uint8Array; width: number; height: number };
    img.data.set(this.tileBuf, layer * ref.W * ref.H * 4);
    this.wearTex.addLayerUpdate(layer);
    this.wearTex.needsUpdate = true;
    this.setLayer(c, layer);
    this.stats.wearMs += performance.now() - tb;
  }

  private releaseWear(c: Chunk) {
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
    if (c.wearLayer > 0) this.freeLayers.push(c.wearLayer);
    c.road?.geometry.dispose();
    for (const part of c.parts) part.dispose();
    this.root.remove(c.group);
    this.chunks.delete(c.key);
    this.hooks.removed?.(c);
    this.stats.dropped++;
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
