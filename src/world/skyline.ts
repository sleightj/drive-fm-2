import { Group, Mesh, ShaderMaterial } from 'three';
import type { RoadGenerator } from '../road/generator';
import type { CorridorSeg } from '../road/network';
import { WorldGeom } from './kit/geom';
import { buildFarBuilding } from './kit/buildings';
import { Rng, hash32 } from '../core/rng';
import type { Mood } from './moods';

/**
 * The city behind the frontage and out to the skyline. The land is cut into 160 m blocks;
 * each block holds a few far buildings chosen by the district's mood (towers downtown,
 * cranes at the docks, little at the edge), always clear of every known road corridor by
 * more than the roadside's own depth, so they never stand on a road or in the frontage.
 * Blocks are merged into 480 m tiles (one draw call each) out to the level's skyline radius;
 * from crests the city reads as a city, and far off as a skyline in the fog.
 *
 * Roads are generated kilometres ahead, so a new corridor is known long before it is near:
 * tiles it touches are rebuilt (the old mesh stays until the new one is ready). Removed
 * roads (trimmed behind, the untaken branch of a fork) leave their strip empty rather than
 * fill in while in view.
 */

const CELL = 160;
const PER = 3; // cells per tile side
const TILE = CELL * PER;
const SLOT = 40; // 4×4 building slots per cell
const CLEAR = 22; // extra clearance beyond a corridor's own radius (frontage depth)

interface MoodSky {
  n: [number, number]; // buildings per block
  h: [number, number]; // height range (skewed low)
  w: [number, number]; // footprint size range
  skew: number; // height distribution power (>1: mostly low, a few tall)
  /** chance per block of a quay crane (docks) */
  crane?: number;
}
const SKY: Record<Mood, MoodSky> = {
  downtown: { n: [5, 9], h: [26, 130], w: [18, 36], skew: 2.2 },
  midtown: { n: [4, 7], h: [12, 48], w: [16, 32], skew: 1.6 },
  oldtown: { n: [3, 6], h: [6, 10], w: [10, 20], skew: 1 },
  docks: { n: [1, 4], h: [8, 16], w: [22, 36], skew: 1, crane: 0.35 },
  suburbs: { n: [1, 4], h: [6, 12], w: [10, 22], skew: 1.4 },
  edge: { n: [0, 1], h: [5, 8], w: [10, 20], skew: 1 },
};

export interface SkylineDeps {
  gen: RoadGenerator;
  /** land height as drawn (the clipmap), falling back to the field */
  ground: (x: number, z: number) => number;
  mat: ShaderMaterial;
  L: (layer: string) => number;
  seed: number;
  /** the skyline reaches this far, metres */
  outer: number;
}

interface Tile {
  key: string;
  ti: number;
  tj: number;
  mesh: Mesh | null;
  /** a rebuild is queued or running */
  pending: boolean;
  dirty: boolean;
}

interface Spec { x: number; z: number; W: number; D: number; H: number; yaw: number; mood: Mood; seed: number }
/** A tile being built: block by block, one building per step. */
interface Build { tile: Tile; geom: WorldGeom; cell: number; specs: Spec[] | null; k: number }

const _hits: CorridorSeg[] = [];

export class Skyline {
  root = new Group();
  private tiles = new Map<string, Tile>();
  private queue: Build[] = [];
  private originX = 0;
  private originZ = 0;
  stats = { tiles: 0, buildings: 0, tris: 0, builds: 0, maxJobMs: 0 };

  constructor(public d: SkylineDeps) {
    this.root.name = 'skyline';
    d.gen.net.corridorListeners.push((seg) => this.roadAdded(seg));
  }

  setRadius(outer: number) { this.d.outer = outer; }

  /** A new stretch of road: rebuild the tiles whose buildings it could touch. */
  private roadAdded(seg: CorridorSeg) {
    const pad = Math.max(seg.r, seg.hw + 40) + CLEAR + SLOT;
    const i0 = Math.floor((Math.min(seg.x0, seg.x1) - pad) / TILE), i1 = Math.floor((Math.max(seg.x0, seg.x1) + pad) / TILE);
    const j0 = Math.floor((Math.min(seg.z0, seg.z1) - pad) / TILE), j1 = Math.floor((Math.max(seg.z0, seg.z1) + pad) / TILE);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const t = this.tiles.get(`${i},${j}`);
      if (t) t.dirty = true;
    }
  }

  /**
   * Keep the ring of tiles around (cx, cz) current within `budgetMs`. `force` builds
   * everything (loading). Returns the number of tiles waiting.
   */
  update(cx: number, cz: number, budgetMs: number, force = false): number {
    const t0 = performance.now();
    const { outer } = this.d;
    const half = TILE * 0.7072;
    const i0 = Math.floor((cx - outer) / TILE), i1 = Math.floor((cx + outer) / TILE);
    const j0 = Math.floor((cz - outer) / TILE), j1 = Math.floor((cz + outer) / TILE);
    // wanted tiles: within the radius
    const want: { i: number; j: number; d: number }[] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const d = Math.hypot((i + 0.5) * TILE - cx, (j + 0.5) * TILE - cz);
      if (d - half < outer) want.push({ i, j, d });
    }
    // drop tiles well outside the ring
    for (const [k, t] of this.tiles) {
      const d = Math.hypot((t.ti + 0.5) * TILE - cx, (t.tj + 0.5) * TILE - cz);
      if (d - half > outer + 200) this.drop(k, t);
    }
    // new and dirty tiles, nearest first
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      const k = `${w.i},${w.j}`;
      let t = this.tiles.get(k);
      if (!t) { t = { key: k, ti: w.i, tj: w.j, mesh: null, pending: false, dirty: true }; this.tiles.set(k, t); }
      if (t.dirty && !t.pending) {
        t.dirty = false;
        t.pending = true;
        this.queue.push({ tile: t, geom: new WorldGeom(), cell: 0, specs: null, k: 0 });
      }
    }
    // build one building per step; a tile's mesh is swapped in when its last block is done
    while (this.queue.length && (force || performance.now() - t0 < budgetMs)) {
      const tj = performance.now();
      const b = this.queue[0];
      if (!this.tiles.has(b.tile.key)) { this.queue.shift(); continue; }
      if (b.tile.dirty) { b.tile.dirty = false; b.geom = new WorldGeom(); b.cell = 0; b.specs = null; } // invalidated mid-build
      if (!b.specs) {
        const ci = b.tile.ti * PER + (b.cell % PER), cj = b.tile.tj * PER + Math.floor(b.cell / PER);
        b.specs = this.plan(ci, cj);
        b.k = 0;
      } else if (b.k < b.specs.length) {
        this.place(b.geom, b.specs[b.k++], b.tile.ti * TILE, b.tile.tj * TILE);
      }
      if (b.k >= b.specs.length) {
        b.specs = null;
        if (++b.cell >= PER * PER) { this.queue.shift(); this.finish(b); }
      }
      this.stats.maxJobMs = Math.max(this.stats.maxJobMs, performance.now() - tj);
    }
    this.stats.tiles = this.tiles.size;
    return this.queue.length;
  }

  private finish(b: Build) {
    const t = b.tile;
    t.pending = false;
    if (t.mesh) { this.root.remove(t.mesh); t.mesh.geometry.dispose(); this.stats.tris -= t.mesh.userData.tris; t.mesh = null; }
    this.stats.builds++;
    if (b.geom.vertexCount === 0) return;
    b.geom.compact();
    const mesh = new Mesh(b.geom.toGeometry(), this.d.mat);
    mesh.name = 'skyline';
    mesh.matrixAutoUpdate = false;
    mesh.userData.tris = b.geom.triangleCount;
    this.stats.tris += b.geom.triangleCount;
    mesh.position.set(t.ti * TILE - this.originX, 0, t.tj * TILE - this.originZ);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    t.mesh = mesh;
    this.root.add(mesh);
  }

  private drop(k: string, t: Tile) {
    if (t.mesh) { this.root.remove(t.mesh); t.mesh.geometry.dispose(); this.stats.tris -= t.mesh.userData.tris; }
    this.tiles.delete(k);
  }

  rebase(ox: number, oz: number) {
    this.originX = ox;
    this.originZ = oz;
    for (const t of this.tiles.values()) {
      if (!t.mesh) continue;
      t.mesh.position.set(t.ti * TILE - ox, 0, t.tj * TILE - oz);
      t.mesh.updateMatrix();
      t.mesh.updateMatrixWorld(true);
    }
  }

  /** One 160 m block's buildings (positions, sizes), clear of the roads. */
  private plan(ci: number, cj: number): Spec[] {
    const { gen, seed } = this.d;
    const mood = gen.districts.moodAt((ci + 0.5) * CELL, (cj + 0.5) * CELL);
    const sky = SKY[mood];
    const r = new Rng(hash32(seed, 0x5c1e, ci, cj));
    let n = r.int(sky.n[0], sky.n[1]);
    const slots = [...Array(16).keys()];
    for (let i = slots.length - 1; i > 0; i--) { const k = r.int(0, i); [slots[i], slots[k]] = [slots[k], slots[i]]; }
    const crane = sky.crane !== undefined && r.chance(sky.crane);
    if (crane) n = Math.max(1, n - 1);
    const out: Spec[] = [];
    for (let k = 0; k < n + (crane ? 1 : 0); k++) {
      const isCrane = crane && k === n;
      const si = slots[k];
      let W = r.range(sky.w[0], sky.w[1]), D = r.range(sky.w[0], sky.w[1]);
      let H = sky.h[0] + (sky.h[1] - sky.h[0]) * Math.pow(r.next(), sky.skew);
      if (isCrane) { W = 18; D = 30; H = r.range(42, 56); }
      const ext = Math.max(W, D);
      if (ext > SLOT - 2) { const f = (SLOT - 2) / ext; W *= f; D *= f; }
      const yaw = r.int(0, 3) * Math.PI / 2;
      const x = ci * CELL + ((si % 4) + 0.5) * SLOT, z = cj * CELL + (Math.floor(si / 4) + 0.5) * SLOT;
      if (this.nearRoad(x, z, Math.hypot(W, D) / 2)) continue;
      out.push({ x, z, W, D, H, yaw, mood: isCrane ? 'docks' : mood, seed: hash32(seed, ci, cj, k) & 0xffff });
    }
    return out;
  }

  /** Build one far building into a tile (local frame at ox, oz). */
  private place(w: WorldGeom, b: Spec, ox: number, oz: number) {
    // the ground under the footprint: steep ground stays empty; otherwise stand a little above
    // the lowest point (the base runs 4 m below, so the downhill side never floats)
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const g = this.d.ground;
    const ex = (b.W / 2) * c + (b.D / 2) * s, ez = (b.D / 2) * c - (b.W / 2) * s;
    const fx = (b.W / 2) * c - (b.D / 2) * s, fz = -(b.D / 2) * c - (b.W / 2) * s;
    const h0 = g(b.x, b.z), h1 = g(b.x + ex, b.z + ez), h2 = g(b.x - ex, b.z - ez), h3 = g(b.x + fx, b.z + fz), h4 = g(b.x - fx, b.z - fz);
    const lo = Math.min(h0, h1, h2, h3, h4), hi = Math.max(h0, h1, h2, h3, h4);
    if (hi - lo > Math.min(8, b.H * 0.5)) return;
    const y = Math.min((lo + hi) / 2, lo + 3.5);
    // far building frame: front face at z = 0, back at -D; centred on the slot
    w.m.makeRotationY(b.yaw).setPosition(b.x + s * (b.D / 2) - ox, y, b.z + c * (b.D / 2) - oz);
    buildFarBuilding(w, this.d.L, { mood: b.mood, width: b.W, depth: b.D, height: b.H, seed: b.seed });
    w.m.identity();
    this.stats.buildings++;
  }

  private nearRoad(x: number, z: number, halfDiag: number): boolean {
    const reach = halfDiag + CLEAR + 90;
    _hits.length = 0;
    let hit = false;
    this.d.gen.net.corridors.query(x - reach, z - reach, x + reach, z + reach, (seg) => {
      if (hit) return;
      const bx = seg.x1 - seg.x0, bz = seg.z1 - seg.z0;
      const L2 = bx * bx + bz * bz;
      let t = L2 > 1e-9 ? ((x - seg.x0) * bx + (z - seg.z0) * bz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (seg.x0 + bx * t), z - (seg.z0 + bz * t));
      if (d < Math.max(seg.r, seg.hw + 40) + CLEAR + halfDiag) hit = true;
    });
    return hit;
  }
}
