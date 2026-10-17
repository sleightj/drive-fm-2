/**
 * Vertical profile: vertical points of intersection (VPIs) joined by constant grades, with a
 * parabolic vertical curve of length L centred on each interior VPI. Elevation, grade and
 * vertical curvature are continuous (C1) everywhere: no kinks, no steps.
 */
export interface VPI {
  s: number;
  z: number;
  L: number; // vertical curve length centred on this VPI (0 at the ends)
}

export class Profile {
  vpis: VPI[] = [];
  private last = 0; // search hint

  add(v: VPI) {
    if (this.vpis.length && v.s <= this.vpis[this.vpis.length - 1].s) throw new Error('VPI order');
    this.vpis.push(v);
  }

  get end(): number {
    return this.vpis.length ? this.vpis[this.vpis.length - 1].s : 0;
  }

  /** Last grade (between the final two VPIs). */
  lastGrade(): number {
    const n = this.vpis.length;
    if (n < 2) return 0;
    const a = this.vpis[n - 2], b = this.vpis[n - 1];
    return (b.z - a.z) / (b.s - a.s);
  }

  private grade(i: number): number {
    const a = this.vpis[i], b = this.vpis[i + 1];
    return (b.z - a.z) / (b.s - a.s);
  }

  /** Index i such that vpis[i].s <= s < vpis[i+1].s (clamped). */
  private seg(s: number): number {
    const v = this.vpis;
    let i = Math.min(this.last, v.length - 2);
    if (i < 0) return 0;
    while (i > 0 && s < v[i].s) i--;
    while (i < v.length - 2 && s >= v[i + 1].s) i++;
    this.last = i;
    return i;
  }

  /** Elevation, grade and vertical curvature (d²z/ds²) at s. */
  eval(s: number, out: { z: number; g: number; k: number }): { z: number; g: number; k: number } {
    const v = this.vpis;
    if (v.length === 0) { out.z = 0; out.g = 0; out.k = 0; return out; }
    if (v.length === 1) { out.z = v[0].z; out.g = 0; out.k = 0; return out; }
    if (s <= v[0].s) { const g = this.grade(0); out.z = v[0].z + g * (s - v[0].s); out.g = g; out.k = 0; return out; }
    const n = v.length;
    if (s >= v[n - 1].s) { const g = this.grade(n - 2); out.z = v[n - 1].z + g * (s - v[n - 1].s); out.g = g; out.k = 0; return out; }
    const i = this.seg(s);
    // Check curve at VPI i (behind) and VPI i+1 (ahead).
    for (const j of [i, i + 1]) {
      if (j <= 0 || j >= n - 1) continue;
      const P = v[j];
      const h = P.L / 2;
      if (h > 0 && s > P.s - h && s < P.s + h) {
        const g1 = this.grade(j - 1), g2 = this.grade(j);
        const x = s - (P.s - h);
        const zb = P.z - g1 * h;
        out.z = zb + g1 * x + ((g2 - g1) / (2 * P.L)) * x * x;
        out.g = g1 + ((g2 - g1) / P.L) * x;
        out.k = (g2 - g1) / P.L;
        return out;
      }
    }
    const g = this.grade(i);
    out.z = v[i].z + g * (s - v[i].s);
    out.g = g;
    out.k = 0;
    return out;
  }

  /** Drop VPIs well behind s (keeps the two before so eval stays valid). */
  trimBefore(s: number) {
    let k = 0;
    while (k + 3 < this.vpis.length && this.vpis[k + 2].s < s) k++;
    if (k > 0) { this.vpis.splice(0, k); this.last = 0; }
  }
}
