import { SpatialHash } from '../core/spatialHash';

/**
 * Every placed footprint beside the road (buildings, car parks, lots), as oriented rectangles
 * in world x/z, so nothing is placed on top of anything else. Footprints belong to a chunk and
 * are removed with it.
 */
export interface Footprint {
  cx: number; cz: number; // centre
  ux: number; uz: number; // unit axis along the width
  hw: number; hd: number; // half width (along u), half depth (along the normal)
  owner: string;
}

export class Footprints {
  private hash = new SpatialHash<Footprint>(48);
  private byOwner = new Map<string, Footprint[]>();
  count = 0;

  private box(f: Footprint): [number, number, number, number] {
    const ex = Math.abs(f.ux) * f.hw + Math.abs(f.uz) * f.hd;
    const ez = Math.abs(f.uz) * f.hw + Math.abs(f.ux) * f.hd;
    return [f.cx - ex, f.cz - ez, f.cx + ex, f.cz + ez];
  }

  /** True when f overlaps no registered footprint (shrunk by `slack` metres each way). */
  free(f: Footprint, slack = 0.05): boolean {
    const [x0, z0, x1, z1] = this.box(f);
    let ok = true;
    this.hash.query(x0, z0, x1, z1, (g) => {
      if (overlap(f, g, slack)) { ok = false; return true; }
    });
    return ok;
  }

  add(f: Footprint) {
    const [x0, z0, x1, z1] = this.box(f);
    this.hash.insert(f, x0, z0, x1, z1);
    let l = this.byOwner.get(f.owner);
    if (!l) { l = []; this.byOwner.set(f.owner, l); }
    l.push(f);
    this.count++;
  }

  removeOwner(owner: string) {
    const l = this.byOwner.get(owner);
    if (!l) return;
    for (const f of l) { const [x0, z0, x1, z1] = this.box(f); this.hash.remove(f, x0, z0, x1, z1); this.count--; }
    this.byOwner.delete(owner);
  }

  /** All footprints (tests). */
  all(): Footprint[] { return [...this.byOwner.values()].flat(); }
}

/** Separating-axis test between two oriented rectangles. */
export function overlap(a: Footprint, b: Footprint, slack = 0): boolean {
  const axes = [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [ax, az] of axes) {
    const ra = Math.abs(a.ux * ax + a.uz * az) * a.hw + Math.abs(-a.uz * ax + a.ux * az) * a.hd;
    const rb = Math.abs(b.ux * ax + b.uz * az) * b.hw + Math.abs(-b.uz * ax + b.ux * az) * b.hd;
    if (Math.abs(dx * ax + dz * az) >= ra + rb - 2 * slack) return false;
  }
  return true;
}
