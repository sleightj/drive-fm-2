import { Profile } from './profile';
import { CLASS_SPEC, ClassSpan, CrossSection, RoadClass, RoadEvent, kerbHalfWidth } from './types';
import { smooth01, clamp } from '../core/math';

/**
 * A path is one stretch of road between forks (or from the start). It owns its plan
 * (clothoid pieces sampled every metre), vertical profile, class spans and events.
 * Arc length s starts at 0 at the path's start. Heading h: forward = (sin h, cos h) in (x, z);
 * positive curvature turns left (+X side when heading north). Lateral t: left positive.
 */
export interface Piece {
  s0: number;
  len: number;
  k0: number;
  k1: number;
}

class Grow {
  a: Float64Array;
  n = 0;
  constructor(cap = 4096) { this.a = new Float64Array(cap); }
  push(v: number) {
    if (this.n >= this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  dropFront(k: number) {
    this.a.copyWithin(0, k, this.n);
    this.n -= k;
  }
}

export interface JunctionStart {
  /** arc length on this path where the gore nose is (raised island starts) */
  nose: number;
  /** side the sibling is on: +1 left, -1 right */
  inner: 1 | -1;
  /** lateral offset (this path's t) of the midline toward the sibling, per metre up to the nose */
  mid: Float32Array;
  /** where the stop line for this branch's inbound traffic is (only on the yielding branch) */
  stopLine: number | null;
}

export interface JunctionEnd {
  s0: number; // widening starts
  s1: number; // = path length at the fork point
  halfL: number;
  halfR: number;
}

let nextPathId = 1;
export function resetPathIds(n = 1) { nextPathId = n; }

export class Path {
  readonly id: number;
  parent: Path | null = null;
  side: 0 | 1 | -1 = 0; // which branch of the parent (+1 left, -1 right)
  children: Path[] = [];
  alive = true;
  /** the fork that ends this path, if any (s = path length at creation) */
  forkS: number | null = null;
  pieces: Piece[] = [];
  profile = new Profile();
  spans: ClassSpan[] = [];
  events: RoadEvent[] = [];
  junctionEnd: JunctionEnd | null = null;
  junctionStart: JunctionStart | null = null;
  /** district/mood tags (filled by the generator for convenience) */
  // samples
  private X = new Grow();
  private Z = new Grow();
  private H = new Grow();
  private K = new Grow();
  /** arc length of sample index 0 (samples are at integer metres) */
  base = 0;
  /** planned length (end of the last piece) */
  length = 0;
  // integration state at `length`
  private ix: number;
  private iz: number;
  private ih: number;
  private nextSample = 0;
  readonly x0: number;
  readonly z0: number;
  readonly h0: number;
  /** generator bookkeeping */
  gen: any = null;

  constructor(x0: number, z0: number, h0: number, cls: RoadClass) {
    this.id = nextPathId++;
    this.x0 = x0; this.z0 = z0; this.h0 = h0;
    this.ix = x0; this.iz = z0; this.ih = h0;
    this.spans.push({ s0: -1e9, s1: -1e9, from: cls, to: cls });
    this.emitSample(x0, z0, h0, 0);
  }

  private emitSample(x: number, z: number, h: number, k: number) {
    this.X.push(x); this.Z.push(z); this.H.push(h); this.K.push(k);
    this.nextSample++;
  }

  get sampleEnd(): number {
    return this.base + this.X.n - 1;
  }

  /** Appends a clothoid piece (curvature k0 → k1 over len). */
  addPiece(len: number, k0: number, k1: number) {
    if (len <= 0) return;
    const p: Piece = { s0: this.length, len, k0, k1 };
    this.pieces.push(p);
    const step = 0.125;
    let u = 0;
    let x = this.ix, z = this.iz, h = this.ih;
    const hAt = (uu: number) => this.ih + k0 * uu + ((k1 - k0) * uu * uu) / (2 * len);
    const h0 = this.ih;
    while (u < len - 1e-9) {
      const du = Math.min(step, len - u);
      // midpoint integration of (sin h, cos h)
      const hm = h0 + k0 * (u + du / 2) + ((k1 - k0) * (u + du / 2) ** 2) / (2 * len);
      x += Math.sin(hm) * du;
      z += Math.cos(hm) * du;
      u += du;
      h = hAt(u);
      const sNow = this.length + u;
      // emit integer-metre samples crossed in this step (interpolate within the step)
      while (this.nextSample <= sNow + 1e-9) {
        const back = sNow - this.nextSample; // ≤ du
        const hb = hAt(u - back);
        const xs = x - Math.sin((hb + h) / 2) * back;
        const zs = z - Math.cos((hb + h) / 2) * back;
        const kk = k0 + ((k1 - k0) * (u - back)) / len;
        this.emitSample(xs, zs, hb, kk);
      }
    }
    this.ix = x; this.iz = z; this.ih = h;
    this.length += len;
  }

  /** End state of the plan (position and heading at `length`). */
  tip() {
    return { x: this.ix, z: this.iz, h: this.ih, s: this.length };
  }

  curvatureAtEnd(): number {
    const p = this.pieces[this.pieces.length - 1];
    return p ? p.k1 : 0;
  }

  // ---- sample access -------------------------------------------------------------------

  private idx(s: number) {
    return s - this.base;
  }

  sx(i: number) { return this.X.a[i - this.base]; }
  sz(i: number) { return this.Z.a[i - this.base]; }
  sh(i: number) { return this.H.a[i - this.base]; }
  sk(i: number) { return this.K.a[i - this.base]; }

  /** Position/heading at arc length s (cubic Hermite between metre samples). */
  pointAt(s: number, out: { x: number; z: number; h: number; k: number }) {
    const lo = this.base, hi = this.sampleEnd;
    if (hi <= lo) {
      out.x = this.X.a[0]; out.z = this.Z.a[0]; out.h = this.H.a[0]; out.k = 0;
      return out;
    }
    let sc = clamp(s, lo, hi);
    let i = Math.floor(sc);
    if (i >= hi) i = hi - 1;
    const u = sc - i;
    const j = i - lo;
    const x0 = this.X.a[j], z0 = this.Z.a[j], h0 = this.H.a[j];
    const x1 = this.X.a[j + 1], z1 = this.Z.a[j + 1], h1 = this.H.a[j + 1];
    const t0x = Math.sin(h0), t0z = Math.cos(h0), t1x = Math.sin(h1), t1z = Math.cos(h1);
    const u2 = u * u, u3 = u2 * u;
    const a = 2 * u3 - 3 * u2 + 1, b = u3 - 2 * u2 + u, c = -2 * u3 + 3 * u2, d = u3 - u2;
    out.x = a * x0 + b * t0x + c * x1 + d * t1x;
    out.z = a * z0 + b * t0z + c * z1 + d * t1z;
    out.h = h0 + (h1 - h0) * u;
    out.k = this.K.a[j] + (this.K.a[j + 1] - this.K.a[j]) * u;
    // extrapolate linearly past the ends
    if (s > hi) { const e = s - hi; out.x += Math.sin(out.h) * e; out.z += Math.cos(out.h) * e; }
    else if (s < lo) { const e = s - lo; out.x += Math.sin(out.h) * e; out.z += Math.cos(out.h) * e; }
    return out;
  }

  /** World position of (s, t) on the plan (no elevation). */
  worldXZ(s: number, t: number, out: { x: number; z: number; h: number; k: number }) {
    this.pointAt(s, out);
    out.x += Math.cos(out.h) * t;
    out.z += -Math.sin(out.h) * t;
    return out;
  }

  // ---- cross-section -------------------------------------------------------------------

  classAt(s: number): { from: RoadClass; to: RoadClass; u: number } {
    let sp = this.spans[0];
    for (let i = this.spans.length - 1; i >= 0; i--) {
      if (this.spans[i].s0 <= s) { sp = this.spans[i]; break; }
    }
    const u = sp.s1 > sp.s0 ? smooth01((s - sp.s0) / (sp.s1 - sp.s0)) : 1;
    return { from: sp.from, to: sp.to, u };
  }

  /** The class in force at s (the target class once a taper has passed its midpoint). */
  clsAt(s: number): RoadClass {
    const c = this.classAt(s);
    return c.u >= 0.5 ? c.to : c.from;
  }

  xsAt(s: number, out: CrossSection): CrossSection {
    const c = this.classAt(s);
    const A = CLASS_SPEC[c.from], B = CLASS_SPEC[c.to];
    const u = c.u;
    const hw = kerbHalfWidth(c.from) + (kerbHalfWidth(c.to) - kerbHalfWidth(c.from)) * u;
    out.kerbL = hw;
    out.kerbR = -hw;
    // a median appears only once the taper is complete; until then the centre is hatched
    if (A.median > 0 && B.median > 0) { out.median = A.median; out.hatch = 0; }
    else if (B.median > 0) { out.median = u >= 1 ? B.median : 0; out.hatch = u < 1 ? B.median * u : 0; }
    else if (A.median > 0) { out.median = 0; out.hatch = A.median * (1 - u); }
    else { out.median = 0; out.hatch = 0; }
    out.laneW = A.laneW + (B.laneW - A.laneW) * u;
    out.margin = A.margin + (B.margin - A.margin) * u;
    const lanes = u < 0.5 ? A.lanes : B.lanes;
    out.lanesOut = lanes;
    out.lanesIn = lanes;
    out.crown = A.crown;
    out.cls = u < 0.5 ? c.from : c.to;
    out.fromCls = c.from;
    out.clsBlend = u;
    // fork widening at the end of a trunk
    const je = this.junctionEnd;
    if (je && s > je.s0) {
      const w = smooth01((s - je.s0) / (je.s1 - je.s0));
      out.kerbL = hw + (je.halfL - hw) * w;
      out.kerbR = -hw + (je.halfR + hw) * w;
      out.median = out.median * (1 - w) > 0.05 && w < 0.5 ? out.median : 0;
    }
    return out;
  }

  /** Lateral extent of the drivable surface at s: [tMin, tMax] (wider than kerbs at a branch start). */
  drivableAt(s: number, xs: CrossSection): [number, number] {
    let lo = xs.kerbR, hi = xs.kerbL;
    const js = this.junctionStart;
    if (js && s >= 0 && s < js.nose) {
      const m = js.mid[Math.min(js.mid.length - 1, Math.max(0, Math.floor(s)))];
      if (js.inner > 0) hi = Math.max(hi, m);
      else lo = Math.min(lo, m);
    }
    return [lo, hi];
  }

  /** Cross slope height offset at (s, t) relative to the centreline elevation. */
  crossHeight(s: number, t: number, k: number, xs: CrossSection): number {
    let crownF = 1;
    const je = this.junctionEnd;
    if (je && s > je.s0) crownF *= 1 - smooth01((s - je.s0) / (je.s1 - je.s0));
    const js = this.junctionStart;
    if (js && s < js.nose + 25) crownF *= smooth01((s - js.nose) / 25);
    const cls = xs.cls;
    let e = 0;
    if (cls !== 'back') e = clamp(k * 6, -0.05, 0.05) * crownF;
    const a = smooth01((Math.abs(e) - 0.005) / 0.015);
    // crown measured from the centre line (or from the median edge)
    const tc = Math.max(0, Math.abs(t) - xs.median);
    const crownH = -xs.crown * tc * crownF;
    return crownH * (1 - a) + -e * t * a;
  }

  /** Bounding box of samples [i0, i1] padded by r (for spatial hashing). */
  bbox(i0: number, i1: number, r: number): [number, number, number, number] {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = Math.max(i0, this.base); i <= Math.min(i1, this.sampleEnd); i++) {
      const x = this.sx(i), z = this.sz(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return [x0 - r, z0 - r, x1 + r, z1 + r];
  }

  /** Discards samples before s (rounded down to a block). */
  trimBefore(s: number) {
    const k = Math.floor(s) - this.base;
    if (k <= 64) return;
    this.X.dropFront(k); this.Z.dropFront(k); this.H.dropFront(k); this.K.dropFront(k);
    this.base += k;
    this.profile.trimBefore(s - 200);
    while (this.events.length && this.events[0].s1 < s - 400) this.events.shift();
  }
}
