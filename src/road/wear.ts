import { Rng, hash32 } from '../core/rng';
import { fbm1 } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { Path } from './path';
import { CrossSection, laneCenter } from './types';
import type { Mood } from '../world/moods';

/**
 * Road wear as data. Every feature lives in a path's (s, t) frame. The same functions
 * give the physics its surface offset (`wearHeight`) and fill the per-chunk wear texture the
 * road shader paints (`rasterWear`), so what you see is what the wheels hit.
 */
export const WEAR_CHUNK = 50;

export type WearKind = 'pothole' | 'sag' | 'trench' | 'manhole' | 'patch' | 'cracks';

export interface WearFeature {
  kind: WearKind;
  s: number; // centre
  t: number;
  /** half extents of the bounding box in s and t */
  hs: number;
  ht: number;
  depth: number; // positive = dip (m); trenches may be raised (negative)
  r: number; // radius for round features
  /** pothole outline harmonics (radius multipliers) */
  h1: number; h2: number; h3: number; p1: number; p2: number; p3: number;
  water: boolean;
  seed: number;
}

export interface WearChunk {
  ci: number;
  intensity: number;
  features: WearFeature[];
  /** rut depth at the chunk start/end (m), interpolated along s */
  rut0: number;
  rut1: number;
}

const MOOD_WEAR: Record<Mood, number> = { oldtown: 0.9, docks: 1.0, edge: 0.7, midtown: 0.55, downtown: 0.4, suburbs: 0.25 };
const CLASS_WEAR = { back: 1.0, avenue: 0.85, arterial: 0.75 } as const;
const CLASS_RUT = { back: 0.4, avenue: 0.75, arterial: 1.0 } as const;

const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pt = { x: 0, z: 0, h: 0, k: 0 };

export class WearField {
  private cache = new Map<Path, Map<number, WearChunk>>();
  constructor(private seed: number, private moodAt: (x: number, z: number) => Mood) {}

  /** Overall roughness 0..1.4 at s on a path: mood × class × a slow along-road variation. */
  intensity(p: Path, s: number): number {
    p.pointAt(s, _pt);
    const mood = this.moodAt(_pt.x, _pt.z);
    const cls = p.clsAt(s);
    const slow = 0.65 + 0.55 * fbm1(hash32(this.seed, 71, p.id), s / 420, 2);
    return clamp(MOOD_WEAR[mood] * CLASS_WEAR[cls] * slow, 0.05, 1.4);
  }

  rutDepth(p: Path, s: number, inten: number): number {
    const cls = p.clsAt(s);
    const n = 0.5 + 0.5 * fbm1(hash32(this.seed, 73, p.id), s / 160, 2);
    return 0.028 * CLASS_RUT[cls] * clamp(inten, 0, 1.2) * smoothstep(0.25, 0.75, n);
  }

  chunk(p: Path, ci: number): WearChunk {
    let m = this.cache.get(p);
    if (!m) { m = new Map(); this.cache.set(p, m); }
    let c = m.get(ci);
    if (!c) { c = this.generate(p, ci); m.set(ci, c); }
    return c;
  }

  /** Forget chunks behind s (and whole paths that are gone). */
  trim(p: Path, sBefore: number) {
    const m = this.cache.get(p);
    if (!m) return;
    for (const k of m.keys()) if ((k + 1) * WEAR_CHUNK < sBefore - WEAR_CHUNK) m.delete(k);
  }
  drop(p: Path) { this.cache.delete(p); }

  private generate(p: Path, ci: number): WearChunk {
    const rng = new Rng(hash32(this.seed, 0x3ea2, p.id, ci));
    const s0 = ci * WEAR_CHUNK, s1 = s0 + WEAR_CHUNK;
    const sm = s0 + WEAR_CHUNK / 2;
    const inten = this.intensity(p, sm);
    const feats: WearFeature[] = [];
    const evs = p.events;
    // features stay off junction gores and away from stop lines / crosswalks; inside the drivable band
    const band = (s: number, margin: number): [number, number] | null => {
      if (s < p.base || s > p.sampleEnd) return null;
      p.xsAt(s, _xs);
      const [lo, hi] = p.drivableAt(s, _xs);
      if (hi - lo < 2 * margin + 0.5) return null;
      return [lo + margin, hi - margin];
    };
    const place = (margin: number): { s: number; t: number } | null => {
      for (let k = 0; k < 4; k++) {
        const s = rng.range(s0 + 1, s1 - 1);
        const b = band(s, margin);
        if (!b) continue;
        return { s, t: rng.range(b[0], b[1]) };
      }
      return null;
    };
    const base = (kind: WearKind, s: number, t: number): WearFeature => ({ kind, s, t, hs: 0, ht: 0, depth: 0, r: 0, h1: 0, h2: 0, h3: 0, p1: 0, p2: 0, p3: 0, water: false, seed: rng.int(0, 1 << 30) });
    const pois = (lambda: number) => {
      // Poisson count
      let k = 0, pr = Math.exp(-lambda), acc = pr;
      const u = rng.next();
      while (u > acc && k < 40) { k++; pr *= lambda / k; acc += pr; }
      return k;
    };
    // potholes: wheel paths are favoured (a pothole there is one you hit)
    const nPot = pois(5.5 * inten * inten);
    for (let i = 0; i < nPot; i++) {
      const q = place(0.5);
      if (!q) continue;
      const f = base('pothole', q.s, q.t);
      f.r = rng.range(0.22, 0.42) + rng.range(0, 0.38) * rng.next();
      f.depth = rng.range(0.035, 0.065) + 0.04 * rng.next() * inten;
      f.h1 = rng.range(0.05, 0.18); f.h2 = rng.range(0.03, 0.12); f.h3 = rng.range(0.02, 0.08);
      f.p1 = rng.range(0, 6.28); f.p2 = rng.range(0, 6.28); f.p3 = rng.range(0, 6.28);
      f.hs = f.ht = f.r * 1.45;
      f.water = f.depth > 0.06 && rng.chance(0.45);
      feats.push(f);
    }
    // sags: shallow dips over several metres
    const nSag = pois(0.55 * inten);
    for (let i = 0; i < nSag; i++) {
      const q = place(1.2);
      if (!q) continue;
      const f = base('sag', q.s, q.t);
      f.hs = rng.range(2, 6);
      f.ht = rng.range(1.0, 2.2);
      f.depth = rng.range(0.035, 0.075);
      f.water = rng.chance(0.25);
      feats.push(f);
    }
    // trench patches: a band across one side of the road, slightly proud or sunken
    if (rng.chance(0.35 * inten)) {
      const s = rng.range(s0 + 4, s1 - 4);
      const b = band(s, 0.1);
      if (b) {
        const side = rng.sign();
        const f = base('trench', s, side > 0 ? (Math.max(0, b[0]) + b[1]) / 2 : (b[0] + Math.min(0, b[1])) / 2);
        f.ht = side > 0 ? (b[1] - Math.max(0, b[0])) / 2 : (Math.min(0, b[1]) - b[0]) / 2;
        f.hs = rng.range(0.45, 0.9);
        f.depth = rng.chance(0.5) ? rng.range(0.012, 0.022) : -rng.range(0.008, 0.016);
        feats.push(f);
      }
    }
    // manhole lids: more downtown/midtown, independent of wear (lids are everywhere)
    const nMan = pois(0.45);
    for (let i = 0; i < nMan; i++) {
      const q = place(0.8);
      if (!q) continue;
      const f = base('manhole', q.s, q.t);
      f.r = 0.32;
      f.depth = rng.range(0.012, 0.035) * (0.5 + inten * 0.5);
      f.hs = f.ht = 0.4;
      feats.push(f);
    }
    // patches: rectangles of newer asphalt, nearly flush
    const nPatch = pois(1.1 * inten);
    for (let i = 0; i < nPatch; i++) {
      const q = place(0.6);
      if (!q) continue;
      const f = base('patch', q.s, q.t);
      f.hs = rng.range(0.6, 2.5);
      f.ht = rng.range(0.5, 1.6);
      f.depth = -rng.range(0.002, 0.006);
      feats.push(f);
    }
    // crack networks (visual, a few millimetres)
    const nCrack = pois(2.2 * inten);
    for (let i = 0; i < nCrack; i++) {
      const q = place(0.3);
      if (!q) continue;
      const f = base('cracks', q.s, q.t);
      f.hs = rng.range(1.5, 4);
      f.ht = rng.range(0.8, 2.2);
      f.depth = 0.004;
      feats.push(f);
    }
    void evs;
    return { ci, intensity: inten, features: feats, rut0: this.rutDepth(p, s0, inten), rut1: this.rutDepth(p, s1, inten) };
  }
}

// ----------------------------------------------------------------- shape functions -------

/** Height offset of one feature at (s, t) (negative = below the road surface). */
export function featureHeight(f: WearFeature, s: number, t: number): number {
  const ds = s - f.s, dt = t - f.t;
  if (Math.abs(ds) > f.hs || Math.abs(dt) > f.ht) return 0;
  switch (f.kind) {
    case 'pothole': {
      const a = Math.atan2(dt, ds);
      const rr = f.r * (1 + f.h1 * Math.sin(2 * a + f.p1) + f.h2 * Math.sin(3 * a + f.p2) + f.h3 * Math.sin(5 * a + f.p3));
      const d = Math.hypot(ds, dt) / rr;
      if (d >= 1) return 0;
      // a bowl with a broken, steep rim
      const bowl = 1 - smoothstep(0.55, 1.0, d);
      return -f.depth * (0.75 * bowl + 0.25 * (1 - d * d));
    }
    case 'sag': {
      const u = ds / f.hs, v = dt / f.ht;
      const q = u * u + v * v;
      if (q >= 1) return 0;
      const w = 1 - q;
      return -f.depth * w * w;
    }
    case 'trench': {
      const u = Math.abs(ds) / f.hs, v = Math.abs(dt) / f.ht;
      const e = (1 - smoothstep(0.82, 1.0, u)) * (1 - smoothstep(0.9, 1.0, v));
      return -f.depth * e;
    }
    case 'manhole': {
      const d = Math.hypot(ds, dt);
      if (d > f.r + 0.06) return 0;
      // a sunken lid with a bevelled edge
      return -f.depth * (1 - smoothstep(f.r - 0.03, f.r + 0.05, d));
    }
    case 'patch': {
      const u = Math.abs(ds) / f.hs, v = Math.abs(dt) / f.ht;
      return -f.depth * (1 - smoothstep(0.92, 1.0, u)) * (1 - smoothstep(0.92, 1.0, v));
    }
    case 'cracks':
      return 0; // visual only (a few mm, below anything a tyre feels)
  }
}

/** Rut profile across the road at lateral t: dips under each lane's two wheel paths. */
export function rutHeight(xs: CrossSection, t: number, depth: number): number {
  if (depth <= 0) return 0;
  const side: 1 | -1 = t >= 0 ? 1 : -1;
  const n = side > 0 ? xs.lanesOut : xs.lanesIn;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const c = laneCenter(xs, side, i);
    for (const o of [-0.78, 0.78]) {
      const d = (t - (c + o)) / 0.32;
      h -= depth * Math.exp(-d * d);
    }
  }
  return h;
}

/** Physics: total wear offset at (s, t) on a path. */
export function wearHeight(field: WearField, p: Path, s: number, t: number): number {
  if (s < p.base || s > p.sampleEnd) return 0;
  const ci = Math.floor(s / WEAR_CHUNK);
  const c = field.chunk(p, ci);
  let h = 0;
  for (const f of c.features) h += featureHeight(f, s, t);
  // neighbours may reach across the chunk border
  const fs = s - ci * WEAR_CHUNK;
  if (fs < 6.5 && ci > 0) for (const f of field.chunk(p, ci - 1).features) h += featureHeight(f, s, t);
  if (fs > WEAR_CHUNK - 6.5) for (const f of field.chunk(p, ci + 1).features) h += featureHeight(f, s, t);
  const u = fs / WEAR_CHUNK;
  const depth = c.rut0 + (c.rut1 - c.rut0) * u;
  if (depth > 0.001) {
    p.xsAt(s, _xs);
    h += rutHeight(_xs, t, depth);
  }
  return h;
}

// ------------------------------------------------------------------- texture ------------

export const WEAR_HEIGHT_RANGE = 0.12; // ± metres encoded in the height channel

/**
 * Fill an RGBA8 wear tile for s ∈ [s0, s0 + W/px), t ∈ [tMin, tMin + H/px):
 *  R height (128 = 0, ±WEAR_HEIGHT_RANGE), G crack/line mask, B material (0 asphalt,
 *  ~110 patch, ~170 trench seal, 255 iron lid), A standing water.
 */
export function rasterWear(field: WearField, p: Path, s0: number, tMin: number, px: number, py: number, W: number, H: number, out: Uint8Array) {
  const sc = 127 / WEAR_HEIGHT_RANGE;
  // clear: neutral height, no masks
  for (let i = 0; i < W * H; i++) { out[i * 4] = 128; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; out[i * 4 + 3] = 0; }
  const hbuf = new Float32Array(W * H);
  const ci0 = Math.floor(s0 / WEAR_CHUNK) - 1, ci1 = Math.floor((s0 + W / px) / WEAR_CHUNK) + 1;
  const sEnd = s0 + W / px;
  const tEnd = tMin + H / py;
  // ruts: row by row
  for (let x = 0; x < W; x++) {
    const s = s0 + (x + 0.5) / px;
    if (s < p.base || s > p.sampleEnd) continue;
    const ci = Math.floor(s / WEAR_CHUNK);
    const c = field.chunk(p, ci);
    const u = (s - ci * WEAR_CHUNK) / WEAR_CHUNK;
    const depth = c.rut0 + (c.rut1 - c.rut0) * u;
    if (depth < 0.001) continue;
    p.xsAt(s, _xs);
    for (let y = 0; y < H; y++) {
      const t = tMin + (y + 0.5) / py;
      if (t < _xs.kerbR || t > _xs.kerbL) continue;
      hbuf[y * W + x] += rutHeight(_xs, t, depth);
    }
  }
  for (let ci = Math.max(0, ci0); ci <= ci1; ci++) {
    const c = field.chunk(p, ci);
    for (const f of c.features) {
      if (f.s + f.hs < s0 || f.s - f.hs > sEnd || f.t + f.ht < tMin || f.t - f.ht > tEnd) continue;
      const xa = Math.max(0, Math.floor((f.s - f.hs - s0) * px)), xb = Math.min(W - 1, Math.ceil((f.s + f.hs - s0) * px));
      const ya = Math.max(0, Math.floor((f.t - f.ht - tMin) * py)), yb = Math.min(H - 1, Math.ceil((f.t + f.ht - tMin) * py));
      if (f.kind === 'cracks') { rasterCracks(f, s0, tMin, px, py, W, H, out); continue; }
      for (let x = xa; x <= xb; x++) {
        const s = s0 + (x + 0.5) / px;
        for (let y = ya; y <= yb; y++) {
          const t = tMin + (y + 0.5) / py;
          const h = featureHeight(f, s, t);
          if (h === 0) continue;
          const i = y * W + x;
          hbuf[i] += h;
          const o = i * 4;
          switch (f.kind) {
            case 'pothole': {
              // broken edge and gravel inside read as cracks around the rim
              const d = -h / f.depth;
              out[o + 1] = Math.max(out[o + 1], d > 0.05 && d < 0.35 ? 200 : 0);
              if (f.water) out[o + 3] = Math.max(out[o + 3], Math.round(255 * smoothstep(0.35, 0.6, d)));
              break;
            }
            case 'sag':
              if (f.water) out[o + 3] = Math.max(out[o + 3], Math.round(255 * smoothstep(0.45, 0.8, -h / f.depth)));
              break;
            case 'trench':
              out[o + 2] = Math.max(out[o + 2], 170);
              break;
            case 'patch':
              out[o + 2] = Math.max(out[o + 2], 110);
              break;
            case 'manhole': {
              const d = Math.hypot(s - f.s, t - f.t);
              if (d < f.r) {
                out[o + 2] = 255;
                // lid pattern: rim ring + concentric ring + a grid, drawn into the line mask
                const ring = Math.abs(d - (f.r - 0.035)) < 0.02 || Math.abs(d - f.r * 0.55) < 0.015;
                const gx = Math.abs(((s - f.s) * 10 + 100.5) % 1 - 0.5) < 0.14, gy = Math.abs(((t - f.t) * 10 + 100.5) % 1 - 0.5) < 0.14;
                out[o + 1] = ring ? 255 : (d < f.r * 0.5 && (gx || gy)) ? 150 : out[o + 1];
              }
              break;
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < W * H; i++) out[i * 4] = clamp(Math.round(128 + hbuf[i] * sc), 0, 255);
}

/** A crack network: a few branching random walks drawn into the line mask. */
function rasterCracks(f: WearFeature, s0: number, tMin: number, px: number, py: number, W: number, H: number, out: Uint8Array) {
  const rng = new Rng(f.seed);
  const n = rng.int(2, 5);
  const plot = (s: number, t: number, v: number) => {
    const x = Math.floor((s - s0) * px), y = Math.floor((t - tMin) * py);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4 + 1;
    out[o] = Math.max(out[o], v);
  };
  for (let k = 0; k < n; k++) {
    let s = f.s + rng.range(-f.hs, f.hs) * 0.6, t = f.t + rng.range(-f.ht, f.ht) * 0.6;
    let a = rng.range(0, 6.28);
    const len = rng.range(1.2, 4.0);
    const step = 0.5 / Math.max(px, py);
    for (let d = 0; d < len; d += step) {
      a += rng.range(-0.35, 0.35);
      s += Math.cos(a) * step; t += Math.sin(a) * step;
      if (Math.abs(s - f.s) > f.hs || Math.abs(t - f.t) > f.ht) break;
      plot(s, t, 230);
      if (rng.chance(0.02)) {
        // a short branch
        let bs = s, bt = t, ba = a + rng.sign() * rng.range(0.6, 1.2);
        for (let e = 0; e < rng.range(0.3, 1.2); e += step) {
          ba += rng.range(-0.3, 0.3);
          bs += Math.cos(ba) * step; bt += Math.sin(ba) * step;
          plot(bs, bt, 190);
        }
      }
    }
  }
}
