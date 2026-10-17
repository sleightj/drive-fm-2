import { Path } from '../road/path';
import { CrossSection } from '../road/types';
import { Districts } from '../road/districts';
import { fbm2 } from '../core/noise';
import { hash32 } from '../core/rng';
import { smoothstep } from '../core/math';

/**
 * The land the city sits on, as a pure height function of (x, z) driven by the live road:
 *
 *  - Road stations every 8 m carry the road's edge height. The land is an inverse-distance
 *    blend of them (each road's pull falls off as 1/d², cut off smoothly at 600 m) and of a
 *    broad background swell, so every hill the road climbs is a hill in the land and the
 *    land between two roads ramps from one to the other.
 *  - Away from roads, rolling noise fades in (amplitude by mood: flat docks, hilly edge).
 *  - Under and beside every road the land is held below the road surface (the clamp): flat
 *    just under it out to a margin that depends on the grid spacing (so no triangle of a
 *    terrain level can poke through the road), then free to rise at most at a 0.8 slope.
 *    Where a road runs above the land (embankments, stacked switchbacks) the roadside builds
 *    retaining walls down to it.
 *
 * Runs in Node (tests) and in the browser. The renderer samples it on clipmap grids
 * (src/world/terrainClipmap.ts); the roadside builder uses `groundAt` to stand things on it.
 */

export const STATION = 8;
const COARSE_EVERY = 4; // coarse stations: every 4th (32 m) for far levels
const R_INF = 600; // influence cut-off of a road station (m)
const D_BG = 300; // distance at which the background swell weighs as much as one road
const CELL = 64; // fine hash cell
const CCELL = 256; // coarse hash cell
const SLOPE = 0.8; // steepest land rise away from a road edge beyond the clamp margin
const SLOPE_REACH = 40;

/** Per-level clamp: margin beyond the kerb (in grid spacings) and the drop below the road. */
export function clampMargin(spacing: number) { return 1.5 * spacing + 1; }
export function clampDrop(spacing: number) { return spacing <= 4 ? 0.45 : spacing <= 8 ? 0.6 : spacing <= 16 ? 1.2 : spacing <= 32 ? 2.4 : 4; }

const MOOD_HILLS = [3, 6, 4, 1.5, 7, 12]; // downtown, oldtown, midtown, docks, suburbs, edge

interface Src {
  path: Path;
  /** station index k ↔ arc length k·STATION */
  k0: number; // first live station
  k1: number; // one past the last station
  x: Float64Array; z: Float64Array;
  h: Float32Array; // land target height at this station (mean kerb height)
  hmin: Float32Array; // lowest point of the road surface across the section
  hw: Float32Array; // half-width of the drivable band (max of both sides)
  off: number; // index offset: arrays hold stations [off, off + len)
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }

const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pe = { z: 0, g: 0, k: 0 };
const _pt = { x: 0, z: 0, h: 0, k: 0 };

const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

/** A gathered candidate list (flat arrays) for evaluating a block of points. */
class Gather {
  n = 0;
  x = new Float64Array(1024); z = new Float64Array(1024);
  h = new Float32Array(1024); hw = new Float32Array(1024); w = new Float32Array(1024);
  // segment end (for the clamp): x2, z2, h2/hmin2, hw2; seg = 0 when the station has no next
  x2 = new Float64Array(1024); z2 = new Float64Array(1024);
  hm = new Float32Array(1024); hm2 = new Float32Array(1024); hw2 = new Float32Array(1024);
  seg = new Uint8Array(1024);
  grow() {
    const g = (a: any, C: any) => { const b = new C(a.length * 2); b.set(a); return b; };
    this.x = g(this.x, Float64Array); this.z = g(this.z, Float64Array); this.h = g(this.h, Float32Array);
    this.hw = g(this.hw, Float32Array); this.w = g(this.w, Float32Array);
    this.x2 = g(this.x2, Float64Array); this.z2 = g(this.z2, Float64Array);
    this.hm = g(this.hm, Float32Array); this.hm2 = g(this.hm2, Float32Array); this.hw2 = g(this.hw2, Float32Array);
    this.seg = g(this.seg, Uint8Array);
  }
}

export class TerrainField {
  private srcs = new Map<Path, Src>();
  private fine = new Map<number, number[]>(); // cell → refs (pathId·2^20 + k)
  private coarse = new Map<number, number[]>();
  private byId = new Map<number, Src>();
  private gI = new Gather();
  private gC = new Gather();
  private mw = [0, 0, 0, 0, 0, 0];
  /** version bumps whenever the sources change */
  version = 0;
  stats = { stations: 0, evals: 0 };

  constructor(public seed: number, public districts: Districts) {}

  // ---- sources -------------------------------------------------------------------------

  /**
   * Bring the stations in line with the live paths. `end(p)` is how far each path's profile
   * is final. Returns the world rectangles whose land may have changed (already padded by
   * the influence radius).
   */
  sync(paths: Path[], end: (p: Path) => number): Rect[] {
    const dirty: Rect[] = [];
    const live = new Set(paths);
    for (const [p, s] of this.srcs) {
      if (!live.has(p)) { dirty.push(this.removeRange(s, s.k0, s.k1)); this.srcs.delete(p); this.byId.delete(p.id); }
    }
    for (const p of paths) {
      let s = this.srcs.get(p);
      const kEnd = Math.floor(Math.min(end(p), p.sampleEnd) / STATION) + 1;
      const kBase = Math.ceil(p.base / STATION);
      if (!s) {
        if (kEnd - kBase < 2) continue;
        s = { path: p, k0: kBase, k1: kBase, x: new Float64Array(256), z: new Float64Array(256), h: new Float32Array(256), hmin: new Float32Array(256), hw: new Float32Array(256), off: kBase };
        this.srcs.set(p, s);
        this.byId.set(p.id, s);
      }
      if (kBase > s.k0) dirty.push(this.removeRange(s, s.k0, Math.min(kBase, s.k1)));
      if (kEnd > s.k1) dirty.push(this.append(s, kEnd));
    }
    const out = dirty.filter((r) => r.x1 >= r.x0).map((r) => ({ x0: r.x0 - R_INF, z0: r.z0 - R_INF, x1: r.x1 + R_INF, z1: r.z1 + R_INF }));
    if (out.length) this.version++;
    return out;
  }

  private append(s: Src, kEnd: number): Rect {
    const p = s.path;
    const r: Rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    // compact storage when the dead front is large
    if (s.k0 - s.off > 512) {
      const d = s.k0 - s.off, n = s.k1 - s.k0;
      for (const a of [s.x, s.z, s.h, s.hmin, s.hw] as any[]) a.copyWithin(0, d, d + n);
      s.off = s.k0;
    }
    const need = kEnd - s.off;
    if (need > s.x.length) {
      const L = Math.max(need, s.x.length * 2);
      const g = (a: any, C: any) => { const b = new C(L); b.set(a); return b; };
      s.x = g(s.x, Float64Array); s.z = g(s.z, Float64Array); s.h = g(s.h, Float32Array); s.hmin = g(s.hmin, Float32Array); s.hw = g(s.hw, Float32Array);
    }
    for (let k = s.k1; k < kEnd; k++) {
      const sa = Math.max(p.base, Math.min(k * STATION, p.sampleEnd));
      p.pointAt(sa, _pt);
      p.profile.eval(sa, _pe);
      p.xsAt(sa, _xs);
      const [lo, hi] = p.drivableAt(sa, _xs);
      const cL = p.crossHeight(sa, _xs.kerbL, _pt.k, _xs), cR = p.crossHeight(sa, _xs.kerbR, _pt.k, _xs);
      const c0 = p.crossHeight(sa, _xs.median, _pt.k, _xs);
      const cLo = p.crossHeight(sa, lo, _pt.k, _xs), cHi = p.crossHeight(sa, hi, _pt.k, _xs);
      const i = k - s.off;
      s.x[i] = _pt.x; s.z[i] = _pt.z;
      s.h[i] = _pe.z + (cL + cR) / 2;
      s.hmin[i] = _pe.z + Math.min(cL, cR, c0, cLo, cHi) - 0.13; // allow for wear (potholes)
      s.hw[i] = Math.max(-lo, hi);
      const ref = p.id * 1048576 + k;
      this.cellAdd(this.fine, Math.floor(_pt.x / CELL), Math.floor(_pt.z / CELL), ref);
      if (k % COARSE_EVERY === 0) this.cellAdd(this.coarse, Math.floor(_pt.x / CCELL), Math.floor(_pt.z / CCELL), ref);
      r.x0 = Math.min(r.x0, _pt.x); r.x1 = Math.max(r.x1, _pt.x); r.z0 = Math.min(r.z0, _pt.z); r.z1 = Math.max(r.z1, _pt.z);
      this.stats.stations++;
    }
    // the previous last station's segment now has a successor
    s.k1 = kEnd;
    return r;
  }

  private removeRange(s: Src, ka: number, kb: number): Rect {
    const r: Rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    const id = s.path.id;
    for (let k = ka; k < kb; k++) {
      const i = k - s.off;
      const x = s.x[i], z = s.z[i];
      const ref = id * 1048576 + k;
      this.cellDel(this.fine, Math.floor(x / CELL), Math.floor(z / CELL), ref);
      if (k % COARSE_EVERY === 0) this.cellDel(this.coarse, Math.floor(x / CCELL), Math.floor(z / CCELL), ref);
      r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.z0 = Math.min(r.z0, z); r.z1 = Math.max(r.z1, z);
      this.stats.stations--;
    }
    if (kb >= s.k1) s.k1 = ka;
    s.k0 = Math.max(s.k0, kb);
    if (s.k1 < s.k0) s.k1 = s.k0;
    return r;
  }

  private cellAdd(m: Map<number, number[]>, i: number, j: number, ref: number) {
    const k = key(i, j);
    const a = m.get(k);
    if (a) a.push(ref); else m.set(k, [ref]);
  }
  private cellDel(m: Map<number, number[]>, i: number, j: number, ref: number) {
    const k = key(i, j);
    const a = m.get(k);
    if (!a) return;
    const at = a.indexOf(ref);
    if (at >= 0) { a[at] = a[a.length - 1]; a.pop(); }
    if (!a.length) m.delete(k);
  }

  /** Memory check for tests: number of hash cells in use. */
  cellCount() { return this.fine.size + this.coarse.size; }

  // ---- evaluation ----------------------------------------------------------------------

  /** Gather IDW candidates (fine or coarse) around a rectangle. */
  private gatherIdw(x0: number, z0: number, x1: number, z1: number, coarse: boolean) {
    const g = coarse ? this.gC : this.gI;
    const m = coarse ? this.coarse : this.fine;
    const C = coarse ? CCELL : CELL;
    const dw = coarse ? STATION * COARSE_EVERY : STATION;
    g.n = 0;
    const i0 = Math.floor((x0 - R_INF) / C), i1 = Math.floor((x1 + R_INF) / C);
    const j0 = Math.floor((z0 - R_INF) / C), j1 = Math.floor((z1 + R_INF) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = m.get(key(i, j));
      if (!a) continue;
      for (const ref of a) {
        const s = this.byId.get(Math.floor(ref / 1048576))!;
        const k = ref % 1048576;
        if (k < s.k0 || k >= s.k1) continue;
        const ii = k - s.off;
        if (g.n >= g.x.length) g.grow();
        g.x[g.n] = s.x[ii]; g.z[g.n] = s.z[ii]; g.h[g.n] = s.h[ii]; g.hw[g.n] = s.hw[ii]; g.w[g.n] = dw;
        g.n++;
      }
    }
    return g;
  }

  /** Gather clamp segments (always fine stations) near a rectangle. */
  private gatherClamp(x0: number, z0: number, x1: number, z1: number, reach: number) {
    const g = this.gClamp;
    g.n = 0;
    const i0 = Math.floor((x0 - reach) / CELL), i1 = Math.floor((x1 + reach) / CELL);
    const j0 = Math.floor((z0 - reach) / CELL), j1 = Math.floor((z1 + reach) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.fine.get(key(i, j));
      if (!a) continue;
      for (const ref of a) {
        const s = this.byId.get(Math.floor(ref / 1048576))!;
        const k = ref % 1048576;
        if (k < s.k0 || k >= s.k1) continue;
        const ii = k - s.off;
        if (g.n >= g.x.length) g.grow();
        g.x[g.n] = s.x[ii]; g.z[g.n] = s.z[ii]; g.hm[g.n] = s.hmin[ii]; g.hw[g.n] = s.hw[ii];
        // segment to the next station; also include the segment from the previous one (via
        // that station's own entry, which may sit in a neighbouring cell outside the gather)
        if (k + 1 < s.k1) {
          g.seg[g.n] = 1;
          g.x2[g.n] = s.x[ii + 1]; g.z2[g.n] = s.z[ii + 1]; g.hm2[g.n] = s.hmin[ii + 1]; g.hw2[g.n] = s.hw[ii + 1];
        } else g.seg[g.n] = 0;
        g.n++;
        if (k > s.k0) {
          // the previous segment, so a segment is never missed because its start fell outside
          if (g.n >= g.x.length) g.grow();
          g.x[g.n] = s.x[ii - 1]; g.z[g.n] = s.z[ii - 1]; g.hm[g.n] = s.hmin[ii - 1]; g.hw[g.n] = s.hw[ii - 1];
          g.seg[g.n] = 1;
          g.x2[g.n] = s.x[ii]; g.z2[g.n] = s.z[ii]; g.hm2[g.n] = s.hmin[ii]; g.hw2[g.n] = s.hw[ii];
          g.n++;
        }
      }
    }
    return g;
  }
  private gClamp = new Gather();

  /**
   * Evaluate the land on a grid block: points (gx0 + i)·sp, (gz0 + j)·sp for i < nx, j < nz.
   * Writes heights (row-major, j outer) to outH, and per point 8 bytes of material to outM
   * (six mood weights, road proximity, variation) when given.
   */
  fillBlock(gx0: number, gz0: number, nx: number, nz: number, sp: number, outH: Float32Array, outM: Uint8Array | null) {
    const x0 = gx0 * sp, z0 = gz0 * sp, x1 = (gx0 + nx - 1) * sp, z1 = (gz0 + nz - 1) * sp;
    const coarse = sp >= 16;
    const gi = this.gatherIdw(x0, z0, x1, z1, coarse);
    const margin = clampMargin(sp), drop = clampDrop(sp);
    const reach = 13 + margin + SLOPE_REACH;
    const gc = this.gatherClamp(x0, z0, x1, z1, reach);
    const R2 = R_INF * R_INF;
    const wbg = 2 / (D_BG * D_BG);
    const seed = this.seed;
    const mw = this.mw;
    for (let j = 0; j < nz; j++) {
      const z = (gz0 + j) * sp;
      for (let i = 0; i < nx; i++) {
        const x = (gx0 + i) * sp;
        // inverse-distance blend of road stations
        let sw = 0, swh = 0, dmin = 1e9;
        for (let c = 0; c < gi.n; c++) {
          const dx = gi.x[c] - x, dz = gi.z[c] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= R2) continue;
          const d = Math.sqrt(d2);
          const de = d > gi.hw[c] ? d - gi.hw[c] : 0;
          if (de < dmin) dmin = de;
          const q = 1 - d2 / R2;
          const e = de + 6;
          const w = (gi.w[c] * q * q) / (e * e * e);
          sw += w; swh += w * gi.h[c];
        }
        this.stats.evals += gi.n;
        const hbg = -4 + 16 * fbm2(seed ^ 0x51a7, x / 2200, z / 2200, 3);
        let H = (swh + wbg * hbg) / (sw + wbg);
        // rolling land away from the road, by mood
        this.districts.moodWeights(x, z, mw);
        let amp = 0;
        for (let m = 0; m < 6; m++) amp += mw[m] * MOOD_HILLS[m];
        const away = smoothstep(25, 220, dmin);
        H += amp * away * fbm2(seed ^ 0x7e11, x / 380, z / 380, 3);
        // hold the land below every road nearby
        for (let c = 0; c < gc.n; c++) {
          let px: number, pz: number, hm: number, hw: number;
          if (gc.seg[c]) {
            const ax = gc.x[c], az = gc.z[c], bx = gc.x2[c] - ax, bz = gc.z2[c] - az;
            const L2 = bx * bx + bz * bz;
            let t = L2 > 1e-9 ? ((x - ax) * bx + (z - az) * bz) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            px = ax + bx * t; pz = az + bz * t;
            hm = gc.hm[c] + (gc.hm2[c] - gc.hm[c]) * t;
            hw = gc.hw[c] + (gc.hw2[c] - gc.hw[c]) * t;
          } else { px = gc.x[c]; pz = gc.z[c]; hm = gc.hm[c]; hw = gc.hw[c]; }
          const dx = x - px, dz = z - pz;
          const d = Math.sqrt(dx * dx + dz * dz);
          const de = d - hw - margin;
          if (de > SLOPE_REACH) continue;
          const lim = hm - drop + (de > 0 ? SLOPE * de : 0);
          if (H > lim) H = lim;
        }
        const o = j * nx + i;
        outH[o] = H;
        if (outM) {
          const b = o * 8;
          for (let m = 0; m < 6; m++) outM[b + m] = Math.round(mw[m] * 255);
          outM[b + 6] = Math.round(255 * (1 - smoothstep(0, 30, dmin)));
          outM[b + 7] = hash32(seed, 0x7e44, Math.floor(x / 16), Math.floor(z / 16)) & 255;
        }
      }
    }
  }

  private one = new Float32Array(1);
  /** Land height at a grid point of the given spacing (exactly what that terrain level stores). */
  gridHeight(gx: number, gz: number, sp: number): number {
    this.fillBlock(gx, gz, 1, 1, sp, this.one, null);
    return this.one[0];
  }

  /**
   * Height of the rendered finest terrain at (x, z): the 4 m grid, interpolated on the same
   * triangles the clipmap draws (split along the (0,0)–(1,1) diagonal). `cache` may supply
   * already-known grid heights.
   */
  groundAt(x: number, z: number, cache?: (gx: number, gz: number) => number | undefined): number {
    const sp = 4;
    const fx = x / sp, fz = z / sp;
    const gx = Math.floor(fx), gz = Math.floor(fz);
    const u = fx - gx, v = fz - gz;
    const h = (a: number, b: number) => cache?.(a, b) ?? this.gridHeight(a, b, sp);
    const h00 = h(gx, gz), h11 = h(gx + 1, gz + 1);
    if (u >= v) { const h10 = h(gx + 1, gz); return h00 + (h10 - h00) * u + (h11 - h10) * v; }
    const h01 = h(gx, gz + 1);
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
}
