import { BufferAttribute, BufferGeometry } from 'three';
import { Path } from '../road/path';
import { RoadSurface } from '../road/surface';
import { CLASS_SPEC, CrossSection, HARD_TURNS, RoadClass } from '../road/types';
import { clamp } from '../core/math';
import { fbm1 } from '../core/noise';
import { hash32 } from '../core/rng';

/**
 * The carriageway of one chunk of a path as a grid of rows (along s) × columns (across t).
 * Rows are spaced by curvature, columns follow the cross-section (crown ridge or median
 * edges always have a column). Each vertex carries its road coordinates so the road shader
 * paints lane lines, wear and puddles exactly where the data says they are.
 */

export const PAINT_FLAG = {
  CENTRE_YELLOW: 1, // solid yellow centre (no overtaking: through hard turns)
  CENTRE_DASHED: 2, // dashed white centre (back streets on easy stretches)
  NO_CENTRE: 4,
  NO_LANES: 8,
  GORE: 16,
} as const;

const EDGE_OFF: Record<RoadClass, number> = { back: 0.22, avenue: 0.45, arterial: 0.55 };

export interface WearTileRef {
  layer: number;
  s0: number; // tile origin
  tMin: number;
  pxS: number; // texels per metre along s / t
  pxT: number;
  W: number; // texture layer size (texels)
  H: number;
}

const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pt = { x: 0, z: 0, h: 0, k: 0 };
const _w = { x: 0, y: 0, z: 0 };

/** Rows (s values) for [s0, s1], denser where the road bends or the cross-section changes. */
export function roadRows(p: Path, s0: number, s1: number): number[] {
  const rows = [s0];
  let s = s0;
  while (s < s1 - 1e-6) {
    p.pointAt(s, _pt);
    const k = Math.abs(_pt.k);
    let ds = clamp(0.09 / Math.max(k, 1e-4), 1, 4);
    // junction widenings and tapers want finer rows
    if (p.junctionEnd && s > p.junctionEnd.s0 - 4) ds = Math.min(ds, 2);
    if (p.junctionStart && s < p.junctionStart.nose + 4) ds = Math.min(ds, 2);
    s = Math.min(s1, s + ds);
    if (s1 - s < 0.4) s = s1;
    rows.push(s);
  }
  return rows;
}

/** Lateral extent [lo, hi] and the inner crown/median edges at s. */
function layout(p: Path, s: number): { lo: number; hi: number; cR: number; cL: number; xs: CrossSection } {
  p.xsAt(s, _xs);
  const [lo, hi] = p.drivableAt(s, _xs);
  const m = _xs.median;
  return { lo, hi, cR: -m, cL: m, xs: _xs };
}

export interface RoadChunkGeometry {
  geometry: BufferGeometry;
  tMin: number;
  tMax: number;
  hasMedian: boolean;
}

/**
 * Build the carriageway mesh for s ∈ [s0, s1] of path p, in render space (world minus
 * origin). `tone` gives the asphalt colour for a point (mood/age), `wear` the tile mapping.
 */
export function buildRoadChunk(
  surf: RoadSurface,
  p: Path,
  s0: number,
  s1: number,
  ox: number,
  oz: number,
  wear: WearTileRef,
  tone: (s: number) => [number, number, number],
  seed: number,
): RoadChunkGeometry {
  const rows = roadRows(p, s0, s1);
  // columns per side: enough that no column spans more than ~3.4 m
  let wR = 0, wL = 0, anyMedian = false;
  for (const s of rows) {
    const L = layout(p, s);
    wR = Math.max(wR, L.cR - L.lo);
    wL = Math.max(wL, L.hi - L.cL);
    if (L.xs.median > 0) anyMedian = true;
  }
  const nR = Math.max(1, Math.ceil(wR / 3.4));
  const nL = Math.max(1, Math.ceil(wL / 3.4));
  // with a median the two sides are separate strips; without, they share the crown column
  const cols = anyMedian ? nR + 1 + nL + 1 : nR + nL + 1;
  const nv = rows.length * cols;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const st = new Float32Array(nv * 2);
  const wuv = new Float32Array(nv * 4);
  const p0 = new Float32Array(nv * 4);
  const p1 = new Float32Array(nv * 4);
  const gore = new Float32Array(nv * 2);
  const ton = new Float32Array(nv * 3);
  let tMin = Infinity, tMax = -Infinity;

  const evs = p.events;
  const je = p.junctionEnd, js = p.junctionStart;
  const dashSeed = hash32(seed, 5);
  for (let r = 0; r < rows.length; r++) {
    const s = rows[r];
    const L = layout(p, s);
    const xs = L.xs;
    const ts: number[] = [];
    for (let i = 0; i <= nR; i++) ts.push(L.lo + ((L.cR - L.lo) * i) / nR);
    if (anyMedian) ts.push(L.cL); // the left strip starts at the median edge (else it shares the crown column)
    for (let i = 1; i <= nL; i++) ts.push(L.cL + ((L.hi - L.cL) * i) / nL);
    // paint parameters for this row
    const cls = xs.cls;
    const e = EDGE_OFF[cls];
    let flags = 0;
    // centre style
    if (cls === 'back') {
      const near = evs.some((ev) => HARD_TURNS.includes(ev.type) && s > ev.s0 - 40 && s < ev.s1 + 20);
      const n = fbm1(dashSeed, s / 300, 1);
      flags |= near || n > 0.25 ? PAINT_FLAG.CENTRE_YELLOW : PAINT_FLAG.CENTRE_DASHED;
    } else if (cls === 'avenue') {
      const near = evs.some((ev) => HARD_TURNS.includes(ev.type) && s > ev.s0 - 60 && s < ev.s1 + 30);
      if (near) flags |= PAINT_FLAG.CENTRE_YELLOW;
    }
    if (je && s > je.s0 + 12) flags |= PAINT_FLAG.NO_CENTRE | PAINT_FLAG.NO_LANES;
    let gA = 0, gB = 0;
    if (js && s < js.nose) {
      if (s < js.nose - 3) flags |= PAINT_FLAG.NO_CENTRE | PAINT_FLAG.NO_LANES;
      flags |= PAINT_FLAG.GORE;
      // hatched gore between the inner kerb and the midline
      if (js.inner > 0) { gA = xs.kerbL; gB = Math.max(xs.kerbL, L.hi); }
      else { gA = Math.min(xs.kerbR, L.lo); gB = xs.kerbR; }
    }
    const tn = tone(s);
    for (let c = 0; c < cols; c++) {
      const t = ts[c];
      const i = r * cols + c;
      surf.world(p, s, t, _w);
      pos[i * 3] = _w.x - ox; pos[i * 3 + 1] = _w.y; pos[i * 3 + 2] = _w.z - oz;
      // normal from the surface (central differences)
      const hs1 = surf.baseHeight(p, s + 0.5, t), hs0 = surf.baseHeight(p, s - 0.5, t);
      const ht1 = surf.baseHeight(p, s, t + 0.3), ht0 = surf.baseHeight(p, s, t - 0.3);
      p.pointAt(s, _pt);
      const sx = Math.sin(_pt.h), sz = Math.cos(_pt.h);
      const lx = Math.cos(_pt.h), lz = -Math.sin(_pt.h);
      const dhs = hs1 - hs0, dht = (ht1 - ht0) / 0.6;
      // tangent along s: (sx, dhs, sz); along t: (lx, dht, lz); normal = t × s (up)
      const ax = lx, ay = dht, az = lz, bx = sx, by = dhs, bz = sz;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz);
      nrm[i * 3] = nx / nl; nrm[i * 3 + 1] = ny / nl; nrm[i * 3 + 2] = nz / nl;
      st[i * 2] = s; st[i * 2 + 1] = t;
      wuv[i * 4] = ((s - wear.s0) * wear.pxS) / wear.W;
      wuv[i * 4 + 1] = ((t - wear.tMin) * wear.pxT) / wear.H;
      wuv[i * 4 + 2] = wear.layer;
      wuv[i * 4 + 3] = wear.pxT;
      p0[i * 4] = xs.kerbL - e; p0[i * 4 + 1] = xs.kerbR + e; p0[i * 4 + 2] = Math.max(xs.median, 0); p0[i * 4 + 3] = xs.laneW;
      p1[i * 4] = xs.lanesOut; p1[i * 4 + 1] = xs.lanesIn; p1[i * 4 + 2] = xs.hatch; p1[i * 4 + 3] = flags;
      gore[i * 2] = gA; gore[i * 2 + 1] = gB;
      ton[i * 3] = tn[0]; ton[i * 3 + 1] = tn[1]; ton[i * 3 + 2] = tn[2];
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
  }
  // indices: quads between rows; with a median, skip the quad across it
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (anyMedian && c === nR) continue;
      const a = r * cols + c, b = a + 1, d = a + cols, e2 = d + 1;
      // counter-clockwise seen from above (columns increase in t, i.e. to the left)
      idx.push(a, d, b, b, d, e2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('aST', new BufferAttribute(st, 2));
  g.setAttribute('aWear', new BufferAttribute(wuv, 4));
  g.setAttribute('aPaint0', new BufferAttribute(p0, 4));
  g.setAttribute('aPaint1', new BufferAttribute(p1, 4));
  g.setAttribute('aGore', new BufferAttribute(gore, 2));
  g.setAttribute('aTone', new BufferAttribute(ton, 3));
  g.setIndex(nv > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return { geometry: g, tMin, tMax, hasMedian: anyMedian };
}

export function classSpec(c: RoadClass) { return CLASS_SPEC[c]; }
