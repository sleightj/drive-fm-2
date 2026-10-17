import type { Chunk, ChunkManager } from '../world/chunks';
import type { Roadside, Walkway } from '../world/roadside';
import type { Path } from '../road/path';
import type { CrossSection } from '../road/types';
import type { Block } from '../road/network';

/**
 * The walkable sidewalk network for pedestrians, cached from Roadside.walkways() chunk by
 * chunk (pure logic, runs in Node).
 *
 * A Piece is one contiguous strip of sidewalk along one side of one chunk: rows along the kerb
 * (arc length s, kerb point, outward normal, sidewalk top) with the usable walk [inner, outer]
 * measured outward from the kerb line. Pieces are linked end to start where the kerb continues
 * (the next chunk of the same path, or a fork branch), so people walk across chunk borders.
 * Props standing on the sidewalks are kept as obstacles (circles, or capsules along the kerb
 * for the wide things standing against the frontage) in a spatial hash.
 */

/** Kerb band width (roadside.ts KERB_BAND); a body never reaches into it. */
export const KERB_BAND = 0.22;
/** Extra clearance from the kerb band: the kerb is drawn as chords between rows (≤ 5 cm off the arc). */
const KERB_SLACK = 0.06;
/** How far a body may reach past `outer` (walkways() puts outer 0.2 m inside the sidewalk's edge). */
const OUTER_REACH = 0.2;
/** Largest body radius (scale 1.06 × 0.3) the band clip is made for. */
const R_MAX = 0.32;
/** Road cross-sections are gathered this far around a piece (sidewalk width + a body). */
const ROAD_REACH = 9;
/** Floats per stored road cross-section: x, z, tx, tz, lo, hi. */
const XS_STRIDE = 6;

export interface Obstacle {
  /** capsule axis (a point when x0 = x1, z0 = z1), world */
  x0: number; z0: number; x1: number; z1: number;
  r: number;
  kind: ObstacleKind;
  chunk: Chunk;
  /** query stamp (dedupe across grid cells) */
  stamp: number;
}
export const enum ObstacleKind { Generic = 0, Lamp = 1, Tree = 2, BusStop = 3, Frontage = 4 }

export class Piece {
  readonly n: number;
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float32Array;
  readonly nx: Float32Array;
  readonly nz: Float32Array;
  readonly inner: Float32Array;
  readonly outer: Float32Array;
  readonly s0: number;
  readonly s1: number;
  prev: Piece | null = null;
  next: Piece | null = null;
  /** people per m² this sidewalk wants (by mood) */
  density = 0;
  /** usable area (m²) for a person of radius 0.3 */
  area = 0;
  /** midpoint (world) and length */
  cx = 0; cz = 0; length = 0;
  /** bus stops beside this piece (people wait there) */
  busStops: Obstacle[] = [];
  /**
   * The drivable band of every road near this piece, as cross-sections 1 m apart (x, z,
   * tangent, [lo, hi] across): where a sidewalk folds on the inside of a tight bend, or runs
   * close to another road, the walk band given by walkways() can reach over a carriageway.
   * Moves are checked against these, and the band is clipped where it does.
   */
  roads: Float64Array = new Float64Array(0);
  /** rows whose band was clipped against the roads */
  clipped = 0;
  /** (diagnostics) the sync frame it was read in, and how far its path's samples reached then */
  born = 0;
  pathEnd = 0;
  /** per-frame bookkeeping for the crowd */
  count = 0;
  target = 0;
  weight = 0;
  /** which eighths of the piece are out of sight (bit k: s in [k/8, (k+1)/8) of its length) */
  hiddenMask = 0;
  alive = true;

  constructor(public readonly id: number, public readonly chunk: Chunk, public readonly path: Path, public readonly side: 1 | -1, w: Walkway) {
    const n = (this.n = w.pts.length);
    this.s = new Float64Array(n); this.x = new Float64Array(n); this.z = new Float64Array(n);
    this.y = new Float32Array(n); this.nx = new Float32Array(n); this.nz = new Float32Array(n);
    this.inner = new Float32Array(n); this.outer = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = w.pts[i];
      this.s[i] = p.s; this.x[i] = p.x; this.z[i] = p.z; this.y[i] = p.y;
      const l = hyp(p.nx, p.nz) || 1;
      this.nx[i] = p.nx / l; this.nz[i] = p.nz / l;
      this.inner[i] = p.inner; this.outer[i] = p.outer;
    }
    this.s0 = this.s[0];
    this.s1 = this.s[n - 1];
    this.measure();
  }

  /** Usable area, length, midpoint. */
  measure() {
    const n = this.n;
    let area = 0, len = 0;
    for (let i = 0; i < n - 1; i++) {
      const ds = hyp(this.x[i + 1] - this.x[i], this.z[i + 1] - this.z[i]);
      const wa = Math.max(0, uMax(this.outer[i], 0.3) - uMin(this.inner[i], 0.3));
      const wb = Math.max(0, uMax(this.outer[i + 1], 0.3) - uMin(this.inner[i + 1], 0.3));
      area += ds * (wa + wb) / 2;
      len += ds;
    }
    this.area = area;
    this.length = len;
    const m = n >> 1;
    this.cx = this.x[m] + this.nx[m] * 1.5;
    this.cz = this.z[m] + this.nz[m] * 1.5;
  }

  /** Row index i with s[i] <= s <= s[i+1] (hint: a previous answer). */
  row(s: number, hint = 0): number {
    const S = this.s, n = this.n;
    let i = Math.min(Math.max(hint, 0), n - 2);
    if (S[i] <= s && s <= S[i + 1]) return i;
    if (s > S[i + 1] && i + 2 < n && s <= S[i + 2]) return i + 1;
    if (s < S[i] && i > 0 && s >= S[i - 1]) return i - 1;
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (S[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}

/** Lowest centre offset from the kerb line for a body of radius r. */
/**
 * Lengths without Math.hypot: in V8 Math.hypot is a builtin call that allocates on every call
 * (measured: about half the crowd's garbage came from it), and the crowd takes hundreds of
 * lengths a frame. These inline to a square root.
 */
export function hyp(a: number, b: number): number { return Math.sqrt(a * a + b * b); }
export function hyp3(a: number, b: number, c: number): number { return Math.sqrt(a * a + b * b + c * c); }

export function uMin(inner: number, r: number) { return Math.max(inner, KERB_BAND + KERB_SLACK + r); }
/** Highest centre offset from the kerb line for a body of radius r. */
export function uMax(outer: number, r: number) { return Math.min(outer, outer + OUTER_REACH - r); }

/** A local frame on a piece at (s, u): see WalkNet.frame(). */
export interface Frame {
  piece: Piece;
  i: number; // row
  f: number; // fraction between rows
  /** kerb point, outward normal, tangent (+s), sidewalk height at the kerb */
  kx: number; kz: number; nx: number; nz: number; tx: number; tz: number; y: number;
  inner: number; outer: number;
  /** ground metres per metre of s at offset u */
  stretch: number;
  /** world point at the asked offset */
  px: number; pz: number; py: number;
  /** the asked position (inputs, see WalkNet.frame) */
  s: number; u: number;
}

export function makeFrame(): Frame {
  return { piece: null as any, i: 0, f: 0, kx: 0, kz: 0, nx: 0, nz: 0, tx: 0, tz: 0, y: 0, inner: 0, outer: 0, stretch: 1, px: 0, pz: 0, py: 0, s: 0, u: 0 };
}

/** Result of moving along the network (see WalkNet.walk()). */
export interface Spot { piece: Piece; s: number; row: number; end: boolean; /** signed s actually covered */ moved: number }

let nextPieceId = 1;

export class WalkNet {
  pieces: Piece[] = [];
  obstacles = new ObstacleGrid();
  private byChunk = new Map<Chunk, { pieces: Piece[]; obstacles: Obstacle[] }>();
  /** piece endpoints for linking, by quantised position */
  private ends = new Map<number, Piece[]>();
  private starts = new Map<number, Piece[]>();
  private _mw = [0, 0, 0, 0, 0, 0];
  stats = { pieces: 0, obstacles: 0, cachedChunks: 0, links: 0, forkLinks: 0, polled: 0, busStops: 0, clippedRows: 0 };

  constructor(
    public chunks: ChunkManager,
    public roadside: Roadside,
    /** mood weights at a point (downtown, oldtown, midtown, docks, suburbs, edge) */
    public moodWeights: (x: number, z: number, out: number[]) => number[],
    /** people per m² by mood index */
    public densities: readonly number[],
  ) {}

  /**
   * Bring the cache up to date: forget dropped chunks (their pieces are returned in `removed`)
   * and read the walkways of finished chunks within `radius` of (cx, cz), at most `maxPolls`
   * chunks per call, and no more once `budgetMs` is spent on reading them (one always gets read:
   * a chunk with sidewalks takes 0.2–0.7 ms, more on code not yet optimised).
   */
  sync(cx: number, cz: number, radius: number, maxPolls: number, removed: Piece[], frame: number, budgetMs = Infinity) {
    const t0 = budgetMs < Infinity ? performance.now() : 0;
    let added = 0;
    for (const c of this.byChunk.keys()) { // (keys: an entries loop makes a pair per chunk per frame)
      if (c.alive && this.chunks.chunks.get(c.key) === c) continue;
      const e = this.byChunk.get(c)!;
      for (const p of e.pieces) { this.unlink(p); p.alive = false; removed.push(p); }
      for (const o of e.obstacles) this.obstacles.remove(o, ...bbox(o));
      this.stats.obstacles -= e.obstacles.length;
      this.byChunk.delete(c);
    }
    if (removed.length) this.pieces = this.pieces.filter((p) => p.alive);
    let polls = 0;
    const r2 = (radius + 40) ** 2;
    for (const c of this.chunks.chunks.values()) {
      if (polls >= maxPolls || (added && performance.now() - t0 > budgetMs)) break;
      if (!c.alive || this.byChunk.has(c)) continue;
      if ((this.nextPoll.get(c) ?? 0) > frame) continue;
      // near enough? (the chunk's midpoint on its path)
      c.path.pointAt((c.s0 + c.s1) / 2, this._pt);
      if ((this._pt.x - cx) ** 2 + (this._pt.z - cz) ** 2 > r2) { this.nextPoll.set(c, frame + 30); continue; }
      polls++;
      this.stats.polled++;
      const w = this.roadside.walkways(c);
      // empty both before the chunk's roadside is finished and when it has nothing on it:
      // look again later (cheap), keep anything that has sidewalks or props
      if (!w.sides.length && !w.obstacles.length) { this.nextPoll.set(c, frame + 20); continue; }
      this.add(c, w, frame);
      added++;
    }
    this.stats.pieces = this.pieces.length;
    this.stats.cachedChunks = this.byChunk.size;
  }
  /**
   * While loading: read the walkways of every finished chunk within `radius` of where the chunks
   * were last ranked (the car), so the first frame only has to place people (reading a whole
   * ring of chunks at once, on cold code, is tens of ms). Returns the chunks read.
   */
  prewarm(radius: number): number {
    let n = 0;
    for (const c of this.chunks.chunks.values()) {
      if (!c.alive || this.byChunk.has(c) || c.dist > radius) continue;
      const w = this.roadside.walkways(c);
      if (!w.sides.length && !w.obstacles.length) continue;
      this.add(c, w, 0);
      n++;
    }
    this.stats.pieces = this.pieces.length;
    this.stats.cachedChunks = this.byChunk.size;
    return n;
  }
  private nextPoll = new WeakMap<Chunk, number>();
  private _pt = { x: 0, z: 0, h: 0, k: 0 };

  private add(c: Chunk, w: ReturnType<Roadside['walkways']>, frame = 0) {
    const pieces: Piece[] = [];
    for (const side of w.sides) {
      if (side.pts.length < 2) continue;
      let p = new Piece(nextPieceId++, c, c.path, side.side, side);
      this.gatherRoads(p);
      if (this.clipBand(p)) {
        // the band reaches over a road somewhere: rows a metre apart, so the clip holds between them
        p = new Piece(p.id, c, c.path, side.side, densify(side, 1));
        this.gatherRoads(p);
        this.stats.clippedRows += this.clipBand(p);
      }
      p.born = frame;
      p.pathEnd = c.path.sampleEnd;
      this.moodWeights(p.cx, p.cz, this._mw);
      let d = 0, tw = 0;
      for (let m = 0; m < 6; m++) { d += this._mw[m] * this.densities[m]; tw += this._mw[m]; }
      p.density = tw > 0 ? d / tw : 0;
      pieces.push(p);
      this.pieces.push(p);
      this.link(p);
    }
    const obstacles: Obstacle[] = [];
    for (const o of w.obstacles as { x: number; z: number; r: number; type?: string }[]) {
      const ob = this.classify(o, pieces, c);
      obstacles.push(ob);
      this.obstacles.insert(ob, ...bbox(ob));
    }
    this.byChunk.set(c, { pieces, obstacles });
    this.stats.obstacles += obstacles.length;
  }

  /**
   * Obstacles come as circles. Wide props stand against the frontage (vending machines,
   * planters, garbage stations are up to 2.1 m long along the kerb), so a circle near a
   * piece's outer edge becomes a capsule along the kerb covering ±1.2 m.
   */
  private classify(o: { x: number; z: number; r: number; type?: string }, pieces: Piece[], c: Chunk): Obstacle {
    const ob: Obstacle = { x0: o.x, z0: o.z, x1: o.x, z1: o.z, r: o.r, kind: ObstacleKind.Generic, chunk: c, stamp: 0 };
    const t = o.type;
    if (t) {
      if (t.startsWith('lamp')) ob.kind = ObstacleKind.Lamp;
      else if (t.startsWith('tree') || t === 'shrub') ob.kind = ObstacleKind.Tree;
      else if (t === 'bus_stop') ob.kind = ObstacleKind.BusStop;
    } else if (o.r >= 1.9) ob.kind = ObstacleKind.BusStop;
    else if (Math.abs(o.r - 0.9) < 0.05) ob.kind = ObstacleKind.Tree;
    // where it stands on the nearest piece
    let best: Piece | null = null, bu = 0, bi = 0, bd = Infinity;
    for (const p of pieces) {
      for (let i = 0; i < p.n; i++) {
        const dx = o.x - p.x[i], dz = o.z - p.z[i];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = p; bi = i; bu = dx * p.nx[i] + dz * p.nz[i]; }
      }
    }
    if (best && bd < 36) {
      if (ob.kind === ObstacleKind.BusStop) { best.busStops.push(ob); this.stats.busStops++; }
      const outer = best.outer[bi];
      if (ob.kind === ObstacleKind.Generic && o.r < 0.8 && bu > Math.max(0.9, outer - 0.7)) {
        // against the frontage: a capsule along the kerb
        const i0 = Math.max(0, bi - 1), i1 = Math.min(best.n - 1, bi + 1);
        let tx = best.x[i1] - best.x[i0], tz = best.z[i1] - best.z[i0];
        const l = hyp(tx, tz) || 1;
        tx /= l; tz /= l;
        ob.x0 = o.x - tx * 0.6; ob.z0 = o.z - tz * 0.6;
        ob.x1 = o.x + tx * 0.6; ob.z1 = o.z + tz * 0.6;
        ob.kind = ObstacleKind.Frontage;
      } else if (ob.kind === ObstacleKind.Generic && bu < 1.2) ob.kind = ObstacleKind.Lamp;
    }
    return ob;
  }

  private key(x: number, z: number) {
    return (Math.floor(x * 2) + 2 ** 25) * 2 ** 26 + (Math.floor(z * 2) + 2 ** 25);
  }

  /** Link p to pieces whose start meets its end (and the other way round). */
  private link(p: Piece) {
    const e = p.n - 1;
    const match = (a: Piece, ai: number, b: Piece, bi: number) =>
      hyp(a.x[ai] - b.x[bi], a.z[ai] - b.z[bi]) < 0.3 && a.nx[ai] * b.nx[bi] + a.nz[ai] * b.nz[bi] > 0.9;
    const near = (map: Map<number, Piece[]>, x: number, z: number, fn: (q: Piece) => void) => {
      const kx = Math.floor(x * 2), kz = Math.floor(z * 2);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const l = map.get((kx + dx + 2 ** 25) * 2 ** 26 + (kz + dz + 2 ** 25));
        if (l) for (const q of l) fn(q);
      }
    };
    near(this.starts, p.x[e], p.z[e], (q) => {
      if (!p.next && !q.prev && q !== p && match(p, e, q, 0)) { p.next = q; q.prev = p; this.stats.links++; if (q.path !== p.path) this.stats.forkLinks++; }
    });
    near(this.ends, p.x[0], p.z[0], (q) => {
      if (!p.prev && !q.next && q !== p && match(q, q.n - 1, p, 0)) { q.next = p; p.prev = q; this.stats.links++; if (q.path !== p.path) this.stats.forkLinks++; }
    });
    push(this.starts, this.key(p.x[0], p.z[0]), p);
    push(this.ends, this.key(p.x[e], p.z[e]), p);
  }

  private unlink(p: Piece) {
    if (p.next) { p.next.prev = null; p.next = null; }
    if (p.prev) { p.prev.next = null; p.prev = null; }
    pull(this.starts, this.key(p.x[0], p.z[0]), p);
    pull(this.ends, this.key(p.x[p.n - 1], p.z[p.n - 1]), p);
  }

  /**
   * The frame at (piece, s) and the world point at offset u. `hint` is a row to start from.
   * (A wrapper small enough to be inlined everywhere: the work is in frameAt, which takes its
   * position from `out`, since a call that is not inlined boxes each fractional number argument
   * in V8, and the crowd asks for frames many times a frame.)
   */
  frame(piece: Piece, s: number, u: number, hint: number, out: Frame): Frame {
    out.s = s; out.u = u;
    return this.frameAt(piece, hint, out);
  }

  private frameAt(piece: Piece, hint: number, out: Frame): Frame {
    const s = out.s, u = out.u;
    const i = piece.row(s, hint);
    const S = piece.s;
    const ds = S[i + 1] - S[i];
    const f = ds > 1e-9 ? Math.min(1, Math.max(0, (s - S[i]) / ds)) : 0;
    const X = piece.x, Z = piece.z;
    const kx = X[i] + (X[i + 1] - X[i]) * f, kz = Z[i] + (Z[i + 1] - Z[i]) * f;
    let nx = piece.nx[i] + (piece.nx[i + 1] - piece.nx[i]) * f, nz = piece.nz[i] + (piece.nz[i + 1] - piece.nz[i]) * f;
    const nl = hyp(nx, nz) || 1;
    nx /= nl; nz /= nl;
    let tx = X[i + 1] - X[i], tz = Z[i + 1] - Z[i];
    const tl = hyp(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // ground length of this row step at offset u
    const ax = X[i] + piece.nx[i] * u, az = Z[i] + piece.nz[i] * u;
    const bx = X[i + 1] + piece.nx[i + 1] * u, bz = Z[i + 1] + piece.nz[i + 1] * u;
    const stretch = ds > 1e-9 ? Math.max(0.05, hyp(bx - ax, bz - az) / ds) : 1;
    out.piece = piece; out.i = i; out.f = f;
    out.kx = kx; out.kz = kz; out.nx = nx; out.nz = nz; out.tx = tx; out.tz = tz;
    out.y = piece.y[i] + (piece.y[i + 1] - piece.y[i]) * f;
    out.inner = piece.inner[i] + (piece.inner[i + 1] - piece.inner[i]) * f;
    out.outer = piece.outer[i] + (piece.outer[i + 1] - piece.outer[i]) * f;
    out.stretch = stretch;
    out.px = kx + nx * u; out.pz = kz + nz * u;
    // the pavement rises 1.5 % outward from the kerb band
    out.py = out.y + 0.015 * Math.max(0, u - KERB_BAND);
    return out;
  }

  /**
   * Move `ds` along s from (piece, s), following links; stops at the end of the network
   * (end = true, s clamped to the last row).
   */
  walk(piece: Piece, s: number, ds: number, out: Spot): Spot {
    let p = piece, t = s + ds;
    out.end = false;
    out.moved = ds;
    for (let guard = 0; guard < 8; guard++) {
      if (t > p.s1) {
        if (p.next) { t = p.next.s0 + (t - p.s1); p = p.next; continue; }
        out.moved -= t - p.s1;
        t = p.s1; out.end = true;
      } else if (t < p.s0) {
        if (p.prev) { t = p.prev.s1 - (p.s0 - t); p = p.prev; continue; }
        out.moved += p.s0 - t;
        t = p.s0; out.end = true;
      }
      break;
    }
    out.piece = p; out.s = t; out.row = p.row(t);
    return out;
  }

  /** Collect the drivable cross-sections of every road near a piece (see Piece.roads). */
  private gatherRoads(p: Piece) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.n; i++) {
      x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]);
      z0 = Math.min(z0, p.z[i]); z1 = Math.max(z1, p.z[i]);
    }
    x0 -= ROAD_REACH; z0 -= ROAD_REACH; x1 += ROAD_REACH; z1 += ROAD_REACH;
    const net = this.chunks.gen.net;
    const seen = this._seen;
    seen.clear();
    const out = this._xsBuf;
    out.length = 0;
    const pt = this._pt, xs = this._xs;
    net.blocks.query(x0, z0, x1, z1, (b: Block) => {
      if (seen.has(b)) return;
      seen.add(b);
      const q = b.path;
      for (let k = Math.max(b.i0, q.base); k <= Math.min(b.i1, q.sampleEnd); k++) {
        const sx = q.sx(k), sz = q.sz(k);
        if (sx < x0 || sx > x1 || sz < z0 || sz > z1) continue;
        q.pointAt(k, pt);
        const [lo, hi] = q.drivableAt(k, q.xsAt(k, xs));
        out.push(pt.x, pt.z, Math.sin(pt.h), Math.cos(pt.h), lo, hi);
      }
    });
    p.roads = Float64Array.from(out);
  }
  private _seen = new Set<Block>();
  private _xsBuf: number[] = [];
  private _xs = {} as CrossSection;

  /**
   * How far (x, z) is from the nearest drivable band among a piece's roads (negative: on one),
   * looking no further than `cap`. Each cross-section stands for the metre of road around it.
   */
  roadClearance(p: Piece, x: number, z: number, cap = 3): number {
    const R = p.roads;
    let best = cap;
    for (let j = 0; j < R.length; j += XS_STRIDE) {
      const dx = x - R[j], dz = z - R[j + 1];
      const lo = R[j + 4], hi = R[j + 5];
      const reach = Math.max(hi, -lo) + best;
      if (dx * dx + dz * dz > reach * reach + 0.36) continue;
      const tx = R[j + 2], tz = R[j + 3];
      const a = dx * tx + dz * tz;
      if (a > 0.55 || a < -0.55) continue;
      const t = dx * tz - dz * tx; // across, + to the path's left (network.projectOn)
      const c = t > hi ? t - hi : t < lo ? lo - t : -Math.min(t - lo, hi - t);
      if (c < best) best = c;
    }
    return best;
  }

  /**
   * Clip each row's band to where a body of the largest radius stays clear of every road's
   * drivable band by the kerb band (on a normal stretch this changes nothing: the band already
   * starts that far from its own kerb).
   */
  private clipBand(p: Piece): number {
    const R = p.roads;
    if (!R.length) return 0;
    const need = KERB_BAND + R_MAX;
    const ex = this._ex;
    let clipped = 0;
    for (let i = 0; i < p.n; i++) {
      const lo = uMin(p.inner[i], R_MAX), hi = uMax(p.outer[i], R_MAX);
      if (hi < lo) continue;
      const kx = p.x[i], kz = p.z[i], nx = p.nx[i], nz = p.nz[i];
      // offsets u in [lo, hi] each cross-section rules out: within its metre of road (|a| ≤ 0.55)
      // and within `need` of its drivable band. Both are linear in u, so each is an interval.
      ex.length = 0;
      for (let j = 0; j < R.length; j += XS_STRIDE) {
        const dx = kx - R[j], dz = kz - R[j + 1];
        const rlo = R[j + 4] - need, rhi = R[j + 5] + need;
        // nearest point of the row's band segment to the cross-section's centre: far off, skip
        const us = Math.min(hi, Math.max(lo, -(dx * nx + dz * nz)));
        const ex0 = dx + nx * us, ez0 = dz + nz * us;
        const reach = Math.max(rhi, -rlo) + 0.6;
        if (ex0 * ex0 + ez0 * ez0 > reach * reach) continue;
        const tx = R[j + 2], tz = R[j + 3];
        let a0 = lo, a1 = hi;
        // |a0' + da·u| ≤ 0.55
        const aa = dx * tx + dz * tz, da = nx * tx + nz * tz;
        if (Math.abs(da) < 1e-9) { if (Math.abs(aa) > 0.55) continue; }
        else {
          const ua = (-0.55 - aa) / da, ub = (0.55 - aa) / da;
          a0 = Math.max(a0, Math.min(ua, ub)); a1 = Math.min(a1, Math.max(ua, ub));
        }
        // rlo < t0 + dt·u < rhi
        const t0 = dx * tz - dz * tx, dt = nx * tz - nz * tx;
        if (Math.abs(dt) < 1e-9) { if (t0 <= rlo || t0 >= rhi) continue; }
        else {
          const ua = (rlo - t0) / dt, ub = (rhi - t0) / dt;
          a0 = Math.max(a0, Math.min(ua, ub)); a1 = Math.min(a1, Math.max(ua, ub));
        }
        if (a1 > a0 + 1e-6) ex.push(a0, a1);
      }
      if (!ex.length) continue;
      // what is left of [lo, hi]: its longest run (the one nearest the kerb when they tie)
      const order = this._exOrder;
      order.length = 0;
      for (let k = 0; k < ex.length; k += 2) order.push(k);
      order.sort((x, y) => ex[x] - ex[y]);
      let runA = 0, runB = -1, at = lo;
      for (const k of order) {
        if (ex[k] > at && ex[k] - at > runB - runA) { runA = at; runB = ex[k]; }
        at = Math.max(at, ex[k + 1]);
      }
      if (hi > at && hi - at > runB - runA) { runA = at; runB = hi; }
      if (runA <= lo + 1e-6 && runB >= hi - 1e-6) continue;
      clipped++;
      if (runB - runA < 0.02) { p.inner[i] = 9; p.outer[i] = 0; continue; } // nowhere: an empty band
      if (runA > lo + 1e-6) p.inner[i] = runA;
      if (runB < hi - 1e-6) p.outer[i] = runB + (R_MAX - OUTER_REACH);
    }
    p.clipped = clipped;
    if (clipped) p.measure();
    return clipped;
  }
  private _ex: number[] = [];
  private _exOrder: number[] = [];


  /** Is the body at (x, z) with radius r clear of every obstacle (by `margin`)? */
  clearOfObstacles(x: number, z: number, r: number, margin: number): boolean {
    const list = this._near;
    const n = this.obstacles.near(x, z, r + 2.2, list);
    for (let i = 0; i < n; i++) {
      const o = list[i];
      if (segDist(x, z, o.x0, o.z0, o.x1, o.z1) < o.r + r + margin) return false;
    }
    return true;
  }
  private _near: Obstacle[] = [];

  /** Forget everything (tests). */
  clear() {
    this.pieces = [];
    this.obstacles.clear();
    this.byChunk.clear();
    this.ends.clear();
    this.starts.clear();
  }
}

export function segDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((x - x0) * dx + (z - z0) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hyp(x - x0 - dx * t, z - z0 - dz * t);
}

/** The walkway with rows inserted (linearly, as frame() interpolates) so none are over `step` apart. */
function densify(w: Walkway, step: number): Walkway {
  const pts: Walkway['pts'] = [];
  for (let i = 0; i < w.pts.length; i++) {
    const a = w.pts[i];
    pts.push(a);
    const b = w.pts[i + 1];
    if (!b) break;
    const k = Math.ceil((b.s - a.s) / step);
    for (let j = 1; j < k; j++) {
      const f = j / k, l = (x: number, y: number) => x + (y - x) * f;
      pts.push({ s: l(a.s, b.s), x: l(a.x, b.x), z: l(a.z, b.z), y: l(a.y, b.y), nx: l(a.nx, b.nx), nz: l(a.nz, b.nz), inner: l(a.inner, b.inner), outer: l(a.outer, b.outer) });
    }
  }
  return { side: w.side, pts };
}

function bbox(o: Obstacle): [number, number, number, number] {
  return [Math.min(o.x0, o.x1) - o.r, Math.min(o.z0, o.z1) - o.r, Math.max(o.x0, o.x1) + o.r, Math.max(o.z0, o.z1) + o.r];
}

function push(m: Map<number, Piece[]>, k: number, p: Piece) {
  const l = m.get(k);
  if (l) l.push(p); else m.set(k, [p]);
}
function pull(m: Map<number, Piece[]>, k: number, p: Piece) {
  const l = m.get(k);
  if (!l) return;
  const i = l.indexOf(p);
  if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
  if (!l.length) m.delete(k);
}

/** Obstacles in an 8 m grid; queries fill a caller's array without allocating. */
export class ObstacleGrid {
  private cells = new Map<number, Obstacle[]>();
  private stamp = 1;
  // a small integer key (15 bits a side: cells 262 km apart share one, never both alive):
  // a key past the small-integer range is a boxed number in V8, made anew on every lookup
  private key(ix: number, iz: number) { return ((ix & 0x7fff) << 15) | (iz & 0x7fff); }
  insert(o: Obstacle, x0: number, z0: number, x1: number, z1: number) {
    for (let ix = Math.floor(x0 / 8); ix <= Math.floor(x1 / 8); ix++) for (let iz = Math.floor(z0 / 8); iz <= Math.floor(z1 / 8); iz++) {
      const k = this.key(ix, iz);
      const l = this.cells.get(k);
      if (l) l.push(o); else this.cells.set(k, [o]);
    }
  }
  remove(o: Obstacle, x0: number, z0: number, x1: number, z1: number) {
    for (let ix = Math.floor(x0 / 8); ix <= Math.floor(x1 / 8); ix++) for (let iz = Math.floor(z0 / 8); iz <= Math.floor(z1 / 8); iz++) {
      const k = this.key(ix, iz);
      const l = this.cells.get(k);
      if (!l) continue;
      const i = l.indexOf(o);
      if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
      if (!l.length) this.cells.delete(k);
    }
  }
  /**
   * Every obstacle whose cells touch the square of half-size R around (x, z), once each, written
   * to out[0 … n) (n returned). `out` only ever grows: emptying an array (length = 0) gives its
   * storage back in V8, and the next pushes allocate it again.
   */
  near(x: number, z: number, R: number, out: Obstacle[]): number {
    let n = 0;
    const st = ++this.stamp;
    const ax = Math.floor((x - R) / 8), bx = Math.floor((x + R) / 8), az = Math.floor((z - R) / 8), bz = Math.floor((z + R) / 8);
    for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
      const l = this.cells.get(this.key(ix, iz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) { const o = l[i]; if (o.stamp !== st) { o.stamp = st; out[n++] = o; } }
    }
    return n;
  }
  get size() { return this.cells.size; }
  clear() { this.cells.clear(); }
}
