import { Path } from './path';
import { RoadNetwork, Projection } from './network';
import { CrossSection } from './types';
import { WearField, wearHeight } from './wear';

/**
 * Surface queries on the live road: where a point is (path, s, t), how high the road is
 * there (profile + cross slope + wear), and whether the point is on drivable surface.
 * The car's physics and the traffic use these; the road mesh is built from the same
 * functions so the visible surface and the physical one agree.
 */
export interface Loc {
  path: Path;
  s: number;
  t: number;
  /** metres outside the drivable band (0 inside); negative never */
  out: number;
  inside: boolean;
  /** lateral direction (+1/-1) to move back inside, when outside */
  side: number;
}

const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pe = { z: 0, g: 0, k: 0 };
const _pt = { x: 0, z: 0, h: 0, k: 0 };

export class RoadSurface {
  private proj: Projection = { path: null as any, s: 0, t: 0, out: 0, inside: false };
  constructor(public net: RoadNetwork, public wear: WearField) {}

  /**
   * Locate (x, z) on the road. Tries the hint path first (cheap), then every path nearby.
   * Inside means: within some path's drivable band and not on a raised median.
   */
  /** Closed road ends (set by the game from the generator); null: only the data's own ends. */
  closedAt: ((p: Path) => { s0: number | null; s1: number | null }) | null = null;

  /**
   * How far (x, z), located on `p` at arc length `s`, is past a closed end of the road
   * (0 when not), with the inward normal in `out`: road ends are solid walls.
   */
  endDepth(p: Path, s: number, x: number, z: number, out: { nx: number; nz: number }): number {
    const c = this.closedAt?.(p);
    if (!c) return 0;
    if (c.s0 !== null && s < c.s0 + 4) {
      p.pointAt(c.s0, _pt);
      const tx = Math.sin(_pt.h), tz = Math.cos(_pt.h);
      const along = (x - _pt.x) * tx + (z - _pt.z) * tz;
      if (along < 0.5) { out.nx = tx; out.nz = tz; return 0.5 - along; }
    }
    if (c.s1 !== null && s > c.s1 - 4) {
      p.pointAt(c.s1, _pt);
      const tx = Math.sin(_pt.h), tz = Math.cos(_pt.h);
      const along = (x - _pt.x) * tx + (z - _pt.z) * tz;
      if (along > -0.5) { out.nx = -tx; out.nz = -tz; return along + 0.5; }
    }
    return 0;
  }

  locate(x: number, z: number, hint: Loc | null, out: Loc): boolean {
    if (hint && hint.path && this.net.paths.includes(hint.path)) {
      this.net.projectOn(hint.path, x, z, hint.s, this.proj);
      if (this.proj.inside && this.fill(this.proj, out) && out.inside) return true;
    }
    const pr = this.net.project(x, z, 40, hint?.path ?? null, this.proj);
    if (!pr) return false;
    this.fill(pr, out);
    // a point outside its nearest path may still be inside another (junctions): project() already
    // prefers any path whose band contains the point
    return true;
  }

  private fill(pr: Projection, out: Loc): boolean {
    const p = pr.path;
    out.path = p; out.s = pr.s; out.t = pr.t;
    p.xsAt(pr.s, _xs);
    const [lo, hi] = p.drivableAt(pr.s, _xs);
    let o = 0, side = 0;
    if (pr.t > hi) { o = pr.t - hi; side = -1; }
    else if (pr.t < lo) { o = lo - pr.t; side = 1; }
    else if (_xs.median > 0 && Math.abs(pr.t) < _xs.median) { o = _xs.median - Math.abs(pr.t); side = pr.t >= 0 ? 1 : -1; }
    // off the ends of the live road
    if (pr.s <= p.base + 0.5 || pr.s >= p.sampleEnd - 0.5) { if (o === 0) { o = 0.01; side = 0; } }
    out.out = o; out.side = side; out.inside = o === 0;
    return true;
  }

  /** Road elevation without wear at (s, t) on a path. */
  baseHeight(p: Path, s: number, t: number): number {
    p.profile.eval(s, _pe);
    p.pointAt(s, _pt);
    p.xsAt(s, _xs);
    return _pe.z + p.crossHeight(s, t, _pt.k, _xs);
  }

  /** Road elevation including wear. */
  height(p: Path, s: number, t: number): number {
    return this.baseHeight(p, s, t) + wearHeight(this.wear, p, s, t);
  }

  wearAt(p: Path, s: number, t: number): number {
    return wearHeight(this.wear, p, s, t);
  }

  /** World position of (s, t): x, z and the base height y. */
  world(p: Path, s: number, t: number, out: { x: number; y: number; z: number }) {
    p.pointAt(s, _pt);
    out.x = _pt.x + Math.cos(_pt.h) * t;
    out.z = _pt.z - Math.sin(_pt.h) * t;
    out.y = this.baseHeight(p, s, t);
    return out;
  }
}
