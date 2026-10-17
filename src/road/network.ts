import { SpatialHash } from '../core/spatialHash';
import { Path } from './path';
import { CrossSection } from './types';

/**
 * The live road: every path still in memory, a spatial index of their samples (for
 * projection and surface queries) and of their corridors (for self-avoidance).
 */

export interface Block {
  path: Path;
  i0: number; // first sample (arc length) in the block
  i1: number; // last sample
}

export interface CorridorSeg {
  path: Path;
  s0: number;
  s1: number;
  x0: number; z0: number;
  x1: number; z1: number;
  r: number; // corridor radius (kerb half width + roadside)
  hw: number; // kerb half width
  ev: number; // event id it belongs to (0 = none)
}

export interface Projection {
  path: Path;
  s: number;
  t: number;
  /** lateral distance outside the drivable band (0 when inside) */
  out: number;
  inside: boolean;
}

const BLOCK = 8;

export class RoadNetwork {
  paths: Path[] = [];
  blocks = new SpatialHash<Block>(32);
  corridors = new SpatialHash<CorridorSeg>(64);
  private blockList = new Map<Path, Block[]>();
  private corrList = new Map<Path, CorridorSeg[]>();
  private indexed = new Map<Path, number>(); // last sample indexed per path
  private _p = { x: 0, z: 0, h: 0, k: 0 };
  private _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };

  add(p: Path) {
    this.paths.push(p);
    this.blockList.set(p, []);
    this.corrList.set(p, []);
    this.indexed.set(p, p.base);
  }

  /** Index samples added since the last call (blocks of 8 m). */
  index(p: Path) {
    let from = this.indexed.get(p) ?? p.base;
    const end = p.sampleEnd;
    const list = this.blockList.get(p)!;
    while (from + BLOCK <= end) {
      const b: Block = { path: p, i0: from, i1: from + BLOCK };
      const bb = p.bbox(b.i0, b.i1, 0);
      this.blocks.insert(b, bb[0], bb[1], bb[2], bb[3]);
      list.push(b);
      from += BLOCK;
    }
    this.indexed.set(p, from);
  }

  /** Told about every corridor segment as it is added (the skyline keeps clear of new roads). */
  corridorListeners: ((seg: CorridorSeg) => void)[] = [];

  addCorridor(seg: CorridorSeg) {
    const r = seg.r;
    for (const f of this.corridorListeners) f(seg);
    this.corridors.insert(seg, Math.min(seg.x0, seg.x1) - r, Math.min(seg.z0, seg.z1) - r, Math.max(seg.x0, seg.x1) + r, Math.max(seg.z0, seg.z1) + r);
    this.corrList.get(seg.path)!.push(seg);
  }

  /** Remove a path's index entries before arc length s (memory stays flat). */
  trim(p: Path, s: number) {
    const bl = this.blockList.get(p);
    if (bl) {
      while (bl.length && bl[0].i1 < s) {
        const b = bl.shift()!;
        const bb = p.bbox(b.i0, b.i1, 0);
        this.blocks.remove(b, bb[0], bb[1], bb[2], bb[3]);
      }
    }
    const cl = this.corrList.get(p);
    if (cl) {
      while (cl.length && cl[0].s1 < s - 2000) {
        const c = cl.shift()!;
        this.corridors.remove(c, Math.min(c.x0, c.x1) - c.r, Math.min(c.z0, c.z1) - c.r, Math.max(c.x0, c.x1) + c.r, Math.max(c.z0, c.z1) + c.r);
      }
    }
    p.trimBefore(s);
  }

  remove(p: Path) {
    const bl = this.blockList.get(p);
    if (bl) for (const b of bl) { const bb = p.bbox(b.i0, b.i1, 0); this.blocks.remove(b, bb[0], bb[1], bb[2], bb[3]); }
    const cl = this.corrList.get(p);
    if (cl) for (const c of cl) this.corridors.remove(c, Math.min(c.x0, c.x1) - c.r, Math.min(c.z0, c.z1) - c.r, Math.max(c.x0, c.x1) + c.r, Math.max(c.z0, c.z1) + c.r);
    this.blockList.delete(p);
    this.corrList.delete(p);
    this.indexed.delete(p);
    const i = this.paths.indexOf(p);
    if (i >= 0) this.paths.splice(i, 1);
  }

  /** Project onto one path near a hint arc length (fast path for things that move along a road). */
  projectOn(p: Path, x: number, z: number, sHint: number, out: Projection): Projection {
    let s = sHint;
    const pt = this._p;
    for (let it = 0; it < 4; it++) {
      p.pointAt(s, pt);
      const tx = Math.sin(pt.h), tz = Math.cos(pt.h);
      const ds = (x - pt.x) * tx + (z - pt.z) * tz;
      s += ds;
      if (Math.abs(ds) < 1e-4) break;
    }
    s = Math.max(p.base, Math.min(p.sampleEnd, s));
    p.pointAt(s, pt);
    const t = (x - pt.x) * Math.cos(pt.h) - (z - pt.z) * Math.sin(pt.h);
    const xs = p.xsAt(s, this._xs);
    const [lo, hi] = p.drivableAt(s, xs);
    const out_ = t > hi ? t - hi : t < lo ? lo - t : 0;
    out.path = p; out.s = s; out.t = t; out.out = out_; out.inside = out_ === 0 && s > p.base && s < p.sampleEnd;
    return out;
  }

  /**
   * Find the road under (x, z): every path with a sample block within `radius` is projected;
   * a path whose drivable band contains the point wins (the hint path first), else the nearest.
   */
  project(x: number, z: number, radius = 30, hint: Path | null = null, out?: Projection): Projection | null {
    let best: Projection | null = null;
    const tmp: Projection = { path: null as any, s: 0, t: 0, out: 0, inside: false };
    const seen = new Set<Block>();
    const res = out ?? { path: null as any, s: 0, t: 0, out: 0, inside: false };
    this.blocks.query(x - radius, z - radius, x + radius, z + radius, (b) => {
      if (seen.has(b)) return;
      seen.add(b);
      const p = b.path;
      // nearest sample in block
      let bi = b.i0, bd = Infinity;
      for (let i = Math.max(b.i0, p.base); i <= Math.min(b.i1, p.sampleEnd); i++) {
        const d = (p.sx(i) - x) ** 2 + (p.sz(i) - z) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      if (bd > radius * radius) return;
      this.projectOn(p, x, z, bi, tmp);
      const score = (tmp.inside ? 0 : 1000 + tmp.out) - (tmp.inside && p === hint ? 1 : 0);
      const bestScore = best ? (best.inside ? 0 : 1000 + best.out) - (best.inside && best.path === hint ? 1 : 0) : Infinity;
      if (score < bestScore || (score === bestScore && Math.abs(tmp.t) < Math.abs(best!.t))) {
        best = Object.assign(res, tmp);
      }
    });
    return best;
  }
}
