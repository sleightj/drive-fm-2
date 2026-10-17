import { WalkNet, Piece, Frame, makeFrame, Spot, uMin, uMax, segDist, ObstacleKind, Obstacle, KERB_BAND, hyp, hyp3 } from './walknet';
import { Rng } from '../core/rng';

/**
 * The sidewalk crowd (pure logic, runs in Node): who is where, walking which way, how fast,
 * and which animation clip at what time. people.ts draws it; tools/people-check.ts tests it.
 *
 * Motion is 1-D along a sidewalk (arc length s on a Piece, following links across chunks)
 * plus a lateral offset u from the kerb line. Each walker looks ahead along a handful of
 * lateral lanes, steers toward the freest one (weaving past slower people, oncoming people,
 * lamp posts and trees), slows behind someone it cannot pass, and turns round at the end of
 * the sidewalk or when the way is blocked for good. Every move is checked before it is taken:
 * a body never overlaps another body or an obstacle and never leaves the walk band, so the
 * invariants hold whatever the steering decides.
 *
 * Spawning and despawning happen only out of view (outside the camera frustum, or beyond
 * `farR` where a person is a few pixels tall). The crowd is spread over the sidewalks in
 * front of the camera by each sidewalk's mood density, capped by the graphics level; people
 * behind a moving camera are recycled to the front.
 */

export const enum Clip { Walk = 0, Fast = 1, Skate = 2, Idle = 3 }
export const CLIP_NAMES = ['walk', 'walk_fast', 'skate', 'idle'] as const;

export const enum Mode { Walk = 0, Wait = 1, Turn = 2, Idle = 3 }
export const enum Kind { Walker = 0, Brisk = 1, Skater = 2, Loiter = 3, Group = 4, BusWait = 5 }

export interface VariantInfo { name: string; skates: boolean; palettes: number; height: number }
export interface ClipInfo { speed: number; seconds: number }

export interface CrowdOptions {
  cap: number;
  /** pool slots (≥ cap; the cap can change with the graphics level) */
  poolSize?: number;
  /** people live within this distance of the camera */
  liveR: number;
  /** in view, people appear and vanish only beyond this distance */
  farR: number;
  variants: VariantInfo[];
  /** by Clip */
  clips: ClipInfo[];
  seed: number;
}

export interface CrowdView {
  /** camera world position */
  x: number; y: number; z: number;
  /** horizontal forward (unit) */
  fx: number; fz: number;
  /** 6 planes (nx, ny, nz, d) in world space; a point is inside when n·p + d >= 0 */
  planes: Float64Array;
}

export interface CrowdCar { x: number; z: number; vx: number; vz: number }

/** People per m² of usable sidewalk by mood (downtown, oldtown, midtown, docks, suburbs, edge). */
export const MOOD_DENSITY = [0.07, 0.05, 0.045, 0.008, 0.016, 0.005];

/** Variant weights by mood (bomber … jersey, people.json order). */
const VARIANT_MOOD: Record<string, number[]> = {
  //            downtown oldtown midtown docks suburbs edge
  bomber: [1.2, 0.8, 1.2, 1.0, 0.8, 0.8],
  hoodie: [1.0, 0.7, 1.1, 0.6, 1.0, 0.8],
  longcoat: [1.3, 0.8, 1.0, 0.8, 0.5, 0.5],
  schoolgirl: [0.8, 1.0, 1.0, 0.3, 1.4, 0.8],
  salaryman: [2.0, 0.7, 1.6, 0.6, 0.8, 0.4],
  roller: [0.8, 0.5, 1.0, 0.5, 0.9, 0.6],
  puffer: [0.9, 0.9, 1.0, 1.2, 1.0, 1.0],
  tracksuit: [0.7, 0.8, 0.9, 1.3, 1.1, 1.0],
  dress: [1.0, 1.1, 1.0, 0.3, 1.2, 0.7],
  courier: [1.2, 0.9, 1.2, 1.4, 0.8, 0.6],
  elder: [0.5, 1.8, 0.7, 0.9, 1.3, 1.5],
  twintails: [1.1, 0.8, 1.1, 0.3, 0.8, 0.5],
  punk: [1.1, 0.7, 0.9, 0.7, 0.4, 0.4],
  jersey: [0.8, 0.5, 1.0, 0.7, 1.0, 0.6],
};

const BODY_R = 0.3; // footprint radius at scale 1
const TAU = Math.PI * 2;
const FADE = 0.25; // clip cross-fade seconds
/** seconds to dither in (or out) a person who appears (or leaves) far away but in view */
const APPEAR = 0.7;

export class Person {
  active = false;
  kind = Kind.Walker;
  mode = Mode.Walk;
  variant = 0;
  palette = 0;
  scale = 1;
  r = BODY_R;
  piece: Piece = null as any;
  s = 0;
  u = 0;
  row = 0;
  dir: 1 | -1 = 1;
  /** world position (feet) and facing (0 = +z) */
  x = 0; y = 0; z = 0; yaw = 0;
  /** sidewalk slope here: height gained per metre along world x and z */
  gx = 0; gz = 0;
  vx = 0; vz = 0;
  /** speed along the ground now, and the one this person walks at (clip speed × scale × rate) */
  v = 0; vPref = 1.3;
  uPref = 1; uTarget = 1;
  /** animation: current clip/time, the one fading out, fade progress (1 = done) */
  clip = Clip.Walk; t = 0; prevClip = Clip.Walk; prevT = 0; fade = 1;
  idleRate = 1;
  /** facing when standing (radians), and how far it may turn to look at the car */
  baseYaw = 0;
  turnTo = 0;
  wait = 0; waitLimit = 1; idleT = 0; age = 0; stuck = 0;
  /** seconds in a row every step was refused */
  jam = 0;
  group = 0;
  /** view bookkeeping (updated every frame) */
  dist = 0; inView = false; visibleT = 0;
  /** frames between pose updates (animation LOD; 0 = out of view, no pose) */
  lod = 1;
  /** bumped on every spawn (a pool slot is reused by many people) */
  serial = 0;
  /** drawn opacity (screen-door dither): people who arrive or leave far off but in view fade */
  appear = 1;
  leaving = false;
  constructor(public readonly id: number) {}
}

const _f = makeFrame(), _g = makeFrame(), _h = makeFrame(), _f2 = makeFrame();
const _spot: Spot = { piece: null as any, s: 0, row: 0, end: false, moved: 0 };
const _spot2: Spot = { piece: null as any, s: 0, row: 0, end: false, moved: 0 };

export class Crowd {
  pool: Person[] = [];
  active: Person[] = [];
  private rng: Rng;
  private frameNo = 0;
  private removed: Piece[] = [];
  // the people and obstacles near the person being moved, in its own frame (bSg ahead along its
  // way, bLam across from the kerb, bR the clearance, bVs their speed along my way, bFlags
  // 1 moving | 2 a person | 4 going my way). Arrays of numbers, not objects with number
  // arguments: see freeLanes.
  private nb = 0;
  private bSg = new Float64Array(64);
  private bLam = new Float64Array(64);
  private bR = new Float64Array(64);
  private bVs = new Float64Array(64);
  private bFlags = new Uint8Array(64);
  private lanes = new Float64Array(16);
  private laneFree = new Float64Array(16);
  private laneLim = new Int32Array(16);
  // freeLanes' inputs
  private _u = 0;
  private _look = 0;
  private _endAt = 0;
  private warm = false;
  private refreshIn = 0;
  private refX = 0;
  private refZ = 0;
  private groupId = 1;
  private obsTmp: Obstacle[] = [];
  /** counters for tests and the overlay */
  stats = {
    active: 0, spawned: 0, despawned: 0, forced: 0, spawnInView: 0, despawnInView: 0,
    blockedMoves: 0, turns: 0, attempts: 0, ms: 0, maxMs: 0, pieces: 0,
    syncMs: 0, spawnMs: 0, moveMs: 0,
    /** people the sidewalks in view would hold at their mood's density, before the cap */
    wanted: 0,
  };
  /** every spawn this frame (tests): person and whether it was in view, its distance */
  spawnLog: { p: Person; inView: boolean; dist: number }[] = [];

  constructor(public net: WalkNet, public o: CrowdOptions) {
    this.rng = new Rng(o.seed ^ 0x9e0b1e);
    for (let i = 0; i < Math.max(o.cap, o.poolSize ?? 0); i++) this.pool.push(new Person(i));
  }

  /**
   * New limits (graphics level changed). When the cap drops, the surplus leaves at once: people
   * out of sight first, then the farthest.
   */
  setLimits(lim: { cap: number; liveR: number; farR: number }) {
    this.o.cap = Math.min(lim.cap, this.pool.length);
    this.o.liveR = lim.liveR;
    this.o.farR = lim.farR;
    while (this.active.length > this.o.cap) {
      let bi = 0, bs = -Infinity;
      for (let i = 0; i < this.active.length; i++) {
        const p = this.active[i];
        const sc = (p.inView && p.dist < this.o.farR ? 0 : 1e6) + p.dist;
        if (sc > bs) { bs = sc; bi = i; }
      }
      const p = this.active[bi];
      if (p.inView && p.dist < this.o.farR) this.stats.despawnInView++;
      this.kill(bi);
      this.stats.despawned++;
    }
  }

  /** Everything is new: the next update may fill the view (first frame, teleports). */
  reset() {
    for (let ia = 0; ia < this.active.length; ia++) { const p = this.active[ia]; p.active = false; }
    this.active.length = 0;
    this.warm = false;
  }

  update(dt: number, view: CrowdView, car: CrowdCar) {
    const t0 = now();
    this.frameNo++;
    this._dt = Math.max(1e-4, dt);
    this._view = view;
    this.spawnLog.length = 0;
    // ---- the sidewalk network near the camera
    this.removed.length = 0;
    this.net.sync(view.x, view.z, this.o.liveR + 30, this.warm ? 6 : 400, this.removed, this.frameNo, this.warm ? 0.5 : Infinity);
    const t1 = now();
    this.stats.syncMs = t1 - t0;
    if (this.removed.length) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const p = this.active[i];
        if (!p.piece.alive) { this.stats.forced++; if (p.inView && p.dist < this.o.farR) this.stats.despawnInView++; this.kill(i); }
      }
    }
    this.stats.pieces = this.net.pieces.length;
    // ---- view state of everyone
    for (let ia = 0; ia < this.active.length; ia++) { const p = this.active[ia]; this.look(p, view); }
    if (dt > 0) {
      // ---- where people are wanted
      // (by time and by camera travel: frame rates vary a lot)
      this.refreshIn -= dt;
      const moved = hyp(view.x - this.refX, view.z - this.refZ);
      if (this.refreshIn <= 0 || moved > 6 || this.removed.length) {
        this.targets(view, car);
        this.refreshIn = 0.15;
        this.refX = view.x; this.refZ = view.z;
      }
      this.count();
      // ---- out of view: leave where there are too many, arrive where there are too few
      const t2 = now();
      this.despawn();
      this.spawn(view, !this.warm, dt);
      if (this.active.length || this.net.pieces.length) this.warm = true;
      const t3 = now();
      this.stats.spawnMs = t3 - t2;
      // ---- move
      for (let ia = 0; ia < this.active.length; ia++) { const p = this.active[ia]; this.move(p, dt, car); }
      this.stats.moveMs = now() - t3;
    }
    this.stats.active = this.active.length;
    const ms = now() - t0;
    this.stats.ms = ms;
    if (this.frameNo > 30) this.stats.maxMs = Math.max(this.stats.maxMs, ms);
  }

  // ───────────────────────────── view, targets ─────────────────────────────

  private inView(v: CrowdView, x: number, y: number, z: number, r: number): boolean {
    const P = v.planes;
    for (let i = 0; i < 24; i += 4) if (P[i] * x + P[i + 1] * y + P[i + 2] * z + P[i + 3] < -r) return false;
    return true;
  }

  private look(p: Person, v: CrowdView) {
    const cy = p.y + 0.9 * p.scale;
    p.dist = hyp3(p.x - v.x, cy - v.y, p.z - v.z);
    // generous sphere: arms, skateboards, a margin so the edge of the screen counts as in view
    p.inView = this.inView(v, p.x, cy, p.z, 1.6 * p.scale);
    p.visibleT = p.inView ? p.visibleT + 1 : 0;
    p.lod = !p.inView ? 0 : p.dist < 35 ? 1 : p.dist < 75 ? 2 : 3;
  }

  /** May a person appear or vanish at this spot now? */
  private hidden(v: CrowdView, x: number, y: number, z: number, scale: number): { ok: boolean; inView: boolean; dist: number } {
    const cy = y + 0.9 * scale;
    const h = this._sv;
    h.dist = hyp3(x - v.x, cy - v.y, z - v.z);
    h.inView = this.inView(v, x, cy, z, 1.6 * scale);
    // (a metre past the far ring: a newcomer may step toward the camera in its first frame)
    h.ok = !h.inView || h.dist >= this.o.farR + 1;
    return h;
  }

  /** How many people each sidewalk piece wants: density × area, in front of the camera, capped. */
  private targets(v: CrowdView, car: CrowdCar) {
    const R = this.o.liveR;
    // a stopped camera may look anywhere (the title orbit, a parked car): all round it counts;
    // a moving one only looks ahead
    const speed = hyp(car.vx, car.vz);
    const around = Math.max(0, 1 - speed / 8);
    let total = 0;
    for (let ip = 0; ip < this.net.pieces.length; ip++) {
      const pc = this.net.pieces[ip];
      const dx = pc.cx - v.x, dz = pc.cz - v.z;
      const d = hyp(dx, dz);
      let w = 0;
      if (d < R) {
        const ahead = d < 1e-3 ? 1 : (dx * v.fx + dz * v.fz) / d;
        // within the live radius: the part of a piece that lies inside it
        const inside = Math.min(1, Math.max(0, (R - d) / Math.max(1, pc.length / 2) + 0.5));
        if (ahead > 0.15) w = inside;
        else if (d < 60) w = around;
      }
      pc.weight = w;
      pc.target = pc.density * pc.area * w;
      total += pc.target;
      // where on it a person could appear unseen
      pc.hiddenMask = 0;
      if (w > 0) {
        for (let k = 0; k < 8; k++) {
          const f = this.net.frame(pc, pc.s0 + ((k + 0.5) / 8) * (pc.s1 - pc.s0), 1, 0, _g);
          f.px = f.kx + f.nx * (f.inner + f.outer) / 2; f.pz = f.kz + f.nz * (f.inner + f.outer) / 2;
          if (this.hidden(v, f.px, f.py, f.pz, 1).ok) pc.hiddenMask |= 1 << k;
        }
      }
    }
    this.stats.wanted = total;
    const k = total > this.o.cap ? this.o.cap / total : 1;
    for (let ip = 0; ip < this.net.pieces.length; ip++) { const pc = this.net.pieces[ip]; pc.target *= k; }
  }

  private count() {
    for (let ip = 0; ip < this.net.pieces.length; ip++) { const pc = this.net.pieces[ip]; pc.count = 0; }
    // (someone already fading out no longer counts where they stand)
    for (let ia = 0; ia < this.active.length; ia++) { const p = this.active[ia]; if (!p.leaving) p.piece.count++; }
  }

  // ───────────────────────────── despawn / spawn ─────────────────────────────

  private despawn() {
    const o = this.o;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      const hidden = !p.inView || p.dist >= o.farR;
      const pc = p.piece;
      if (!hidden) {
        // came back into the near view: stay after all
        if (p.leaving) { p.leaving = false; pc.count++; }
        continue;
      }
      let go = p.leaving;
      if (p.dist > o.liveR + 25) go = true;
      else if (p.age > 3 && pc.count > pc.target * 1.25 + 0.5) go = true;
      else if (p.stuck > 25) go = true;
      if (!go) continue;
      // out of sight: gone now; far off but in view: fade out first
      if (p.inView && p.appear > 0) {
        if (!p.leaving) { p.leaving = true; pc.count--; }
        continue;
      }
      if (!p.leaving) pc.count--;
      this.kill(i); this.stats.despawned++;
    }
  }

  private kill(i: number) {
    const p = this.active[i];
    p.active = false;
    p.piece = null as any; // let a dropped chunk go (pool slots outlive what they stood on)
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
  }

  private spawn(v: CrowdView, fill: boolean, dt: number) {
    const cap = this.o.cap;
    // bus stops are rare: anyone wanted there waits there first
    if (this.frameNo % 15 === 0 || fill) {
      for (let ip = 0; ip < this.net.pieces.length; ip++) {
        const pc = this.net.pieces[ip];
        if (!pc.busStops.length || pc.weight <= 0 || this.active.length >= cap) continue;
        this.spawnBusWait(pc, v, fill);
      }
    }
    // attempts per second, not per frame (a slow frame covers more new sidewalk)
    let tries = fill ? 400 : Math.min(60, Math.ceil(6 + 360 * dt));
    while (tries-- > 0 && this.active.length < cap) {
      // a piece by deficit
      let tot = 0;
      for (let ip = 0; ip < this.net.pieces.length; ip++) { const pc = this.net.pieces[ip]; const d = pc.target - pc.count; if (d > 0.35 && (fill || pc.hiddenMask)) tot += d; }
      if (tot <= 0) break;
      let r = this.rng.next() * tot;
      let pick: Piece | null = null;
      for (let ip = 0; ip < this.net.pieces.length; ip++) { const pc = this.net.pieces[ip]; const d = pc.target - pc.count; if (d > 0.35 && (fill || pc.hiddenMask)) { r -= d; if (r <= 0) { pick = pc; break; } } }
      if (!pick) break;
      this.stats.attempts++;
      // somewhere out of sight on it
      let sp: number;
      if (fill) sp = this.rng.range(pick.s0, pick.s1);
      else {
        const bits = this._bits;
        let nb = 0;
        for (let k = 0; k < 8; k++) if (pick.hiddenMask & (1 << k)) bits[nb++] = k;
        const k = bits[this.rng.int(0, nb - 1)];
        sp = pick.s0 + ((k + this.rng.next()) / 8) * (pick.s1 - pick.s0);
      }
      this.trySpawn(pick, sp, v, fill);
    }
  }

  private pickVariant(pc: Piece, skater: boolean): number {
    const vs = this.o.variants;
    const mw = this._mw;
    this.net.moodWeights(pc.cx, pc.cz, mw);
    let tot = 0;
    const w = this._vw;
    for (let i = 0; i < vs.length; i++) {
      const tbl = VARIANT_MOOD[vs[i].name] ?? [1, 1, 1, 1, 1, 1];
      let x = 0;
      for (let m = 0; m < 6; m++) x += mw[m] * tbl[m];
      if (skater && !vs[i].skates) x = 0;
      w[i] = x; tot += x;
    }
    let r = this.rng.next() * tot;
    for (let i = 0; i < vs.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return vs.length - 1;
  }
  private _mw = [0, 0, 0, 0, 0, 0];
  private _vw: number[] = [];

  /** Try to place a new person (or a group) on a piece. */
  private _bits = new Int32Array(8);
  private trySpawn(pc: Piece, s: number, v: CrowdView, fill: boolean) {
    const rng = this.rng;
    // the band at this spot
    const f = this.net.frame(pc, s, 0, 0, _f);
    const lo = uMin(f.inner, BODY_R * 1.08), hi = uMax(f.outer, BODY_R * 1.08);
    if (hi < lo) return;
    const width = hi - lo;
    // what kind of person
    let kind: Kind;
    const x = rng.next();
    if (x < 0.6) kind = Kind.Walker;
    else if (x < 0.72) kind = Kind.Brisk;
    else if (x < 0.8) kind = width > 0.9 ? Kind.Skater : Kind.Walker;
    else if (x < 0.88) kind = width > 1.2 ? Kind.Loiter : Kind.Walker;
    else kind = width > 1.8 ? Kind.Group : Kind.Walker;
    if (kind === Kind.Group) return this.spawnGroup(pc, s, v, fill);
    const p = this.free();
    if (!p) return;
    this.setup(p, pc, kind);
    // lateral place: walkers keep to their lane, loiterers stand back by the frontage
    p.dir = rng.chance(0.5) ? 1 : -1;
    const plo = uMin(f.inner, p.r), phi = uMax(f.outer, p.r);
    if (phi < plo) return;
    p.uPref = this.lanePref(p, plo, phi);
    let u = p.uPref;
    if (kind === Kind.Loiter) u = phi - rng.range(0, Math.min(0.4, phi - plo));
    this.net.frame(pc, s, u, 0, _f);
    if (!this.placeOk(p, pc, s, u, _f, v, fill, 0.25)) return;
    this.activate(p, pc, s, u, _f);
    if (kind === Kind.Loiter) {
      // facing the shop fronts or the street
      const out = Math.atan2(_f.nx, _f.nz);
      p.baseYaw = rng.chance(0.6) ? out + rng.range(-0.5, 0.5) : out + Math.PI + rng.range(-0.6, 0.6);
      p.yaw = p.baseYaw;
      p.idleT = rng.range(4, 30);
    }
  }

  private lanePref(p: Person, lo: number, hi: number): number {
    // keep left: walking +s on the path's left side (side +1) the walker's left is outward
    const leftOut = p.dir * p.piece.side > 0;
    const w = hi - lo;
    const a = this.rng.range(0.15, 0.45);
    return w < 0.4 ? (lo + hi) / 2 : leftOut ? hi - a * w : lo + a * w;
  }

  private spawnGroup(pc: Piece, s: number, v: CrowdView, fill: boolean) {
    const rng = this.rng;
    const n = rng.chance(0.6) ? 2 : 3;
    if (this.active.length + n > this.o.cap) return;
    const f = this.net.frame(pc, s, 0, 0, _g);
    const lo = uMin(f.inner, BODY_R * 1.08), hi = uMax(f.outer, BODY_R * 1.08);
    // the circle they stand in, toward the frontage so walkers can pass on the kerb side
    const rad = n === 2 ? 0.42 : 0.5;
    const uc = Math.max(lo + rad, hi - rad - rng.range(0, 0.3));
    if (uc + rad > hi + 1e-6 || uc - rad < lo - 1e-6) return;
    const members: Person[] = [];
    const a0 = rng.range(0, TAU);
    const ok = () => {
      const gid = this.groupId++;
      for (let k = 0; k < n; k++) {
        const p = this.free(members);
        if (!p) return false;
        this.setup(p, pc, Kind.Group);
        // friends dress differently: no two of a group in the same outfit
        for (let t = 0; t < 4 && members.some((m) => m.variant === p.variant); t++) {
          p.variant = this.pickVariant(pc, false);
          p.palette = rng.int(0, Math.max(0, this.o.variants[p.variant].palettes - 1));
        }
        p.group = gid;
        const a = a0 + (k / n) * TAU + rng.range(-0.25, 0.25);
        const du = Math.cos(a) * rad, dsg = Math.sin(a) * rad;
        const sk = s + dsg / Math.max(0.2, f.stretch);
        if (sk < pc.s0 || sk > pc.s1) return false;
        const fk = this.net.frame(pc, sk, uc + du, 0, _f);
        if (!this.placeOk(p, pc, sk, uc + du, fk, v, fill, 0.08, members)) return false;
        p.s = sk; p.u = uc + du; p.x = fk.px; p.y = fk.py; p.z = fk.pz;
        members.push(p);
      }
      return true;
    };
    if (!ok()) { for (const m of members) m.active = false; return; }
    // face the middle of the circle
    const fc = this.net.frame(pc, s, uc, 0, _g);
    for (const p of members) {
      const fk = this.net.frame(pc, p.s, p.u, 0, _f);
      this.activate(p, pc, p.s, p.u, fk);
      p.baseYaw = Math.atan2(fc.px - fk.px, fc.pz - fk.pz) + rng.range(-0.3, 0.3);
      p.yaw = p.baseYaw;
      p.idleT = Infinity;
    }
  }

  private spawnBusWait(pc: Piece, v: CrowdView, fill: boolean) {
    const rng = this.rng;
    const bs = pc.busStops[rng.int(0, pc.busStops.length - 1)];
    // already someone waiting?
    for (let ia = 0; ia < this.active.length; ia++) { const q = this.active[ia]; if (q.kind === Kind.BusWait && hyp(q.x - bs.x0, q.z - bs.z0) < 6) return; }
    const n = rng.int(1, 3);
    // stand in line beside the stop, toward the kerb half of the walk, facing the road
    let placed = 0;
    for (let k = 0; k < 8 && placed < n && this.active.length < this.o.cap; k++) {
      const p = this.free();
      if (!p) return;
      this.setup(p, pc, Kind.BusWait);
      // the bus stop's arc length on this piece: nearest row
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pc.n; i++) { const d = (pc.x[i] - bs.x0) ** 2 + (pc.z[i] - bs.z0) ** 2; if (d < bd) { bd = d; bi = i; } }
      const along = (rng.chance(0.5) ? 1 : -1) * (bs.r + p.r + 0.1 + placed * 0.75 + rng.range(0, 0.3));
      const s = pc.s[bi] + along;
      if (s < pc.s0 || s > pc.s1) continue;
      const f = this.net.frame(pc, s, 0, 0, _f);
      const lo = uMin(f.inner, p.r), hi = uMax(f.outer, p.r);
      if (hi < lo) continue;
      const u = rng.range(lo, hi);
      this.net.frame(pc, s, u, 0, _f);
      if (!this.placeOk(p, pc, s, u, _f, v, fill, 0.1)) continue;
      this.activate(p, pc, s, u, _f);
      p.baseYaw = Math.atan2(-_f.nx, -_f.nz) + rng.range(-0.5, 0.5);
      p.yaw = p.baseYaw;
      p.idleT = Infinity;
      placed++;
    }
  }

  /** A free pool slot (not one of `taken`). */
  private free(taken?: Person[]): Person | null {
    for (const p of this.pool) if (!p.active && !(taken && taken.includes(p))) return p;
    return null;
  }

  private setup(p: Person, pc: Piece, kind: Kind) {
    const rng = this.rng;
    const skater = kind === Kind.Skater;
    p.kind = kind;
    p.variant = this.pickVariant(pc, skater);
    p.palette = rng.int(0, Math.max(0, this.o.variants[p.variant].palettes - 1));
    p.scale = rng.range(0.93, 1.06);
    p.r = BODY_R * p.scale;
    p.piece = pc;
    const C = this.o.clips;
    if (kind === Kind.Skater) { p.clip = Clip.Skate; p.vPref = C[Clip.Skate].speed * p.scale * rng.range(0.85, 1.05); }
    else if (kind === Kind.Brisk) { p.clip = Clip.Fast; p.vPref = C[Clip.Fast].speed * p.scale * rng.range(0.92, 1.04); }
    else { p.clip = Clip.Walk; p.vPref = C[Clip.Walk].speed * p.scale * rng.range(0.88, 1.08); }
    p.mode = kind === Kind.Walker || kind === Kind.Brisk || kind === Kind.Skater ? Mode.Walk : Mode.Idle;
    if (p.mode === Mode.Idle) p.clip = Clip.Idle;
    p.t = rng.range(0, C[p.clip].seconds);
    p.prevClip = p.clip; p.prevT = p.t; p.fade = 1;
    p.idleRate = rng.range(0.85, 1.1);
    p.v = p.mode === Mode.Walk ? p.vPref : 0;
    p.wait = 0; p.stuck = 0; p.jam = 0; p.age = 0; p.group = 0; p.idleT = 0; p.dir = 1;
    p.waitLimit = rng.range(0.6, 2.2);
    p.vx = 0; p.vz = 0;
  }

  /** Is (s, u) a legal, free, hidden spot for p? */
  private placeOk(p: Person, pc: Piece, s: number, u: number, f: Frame, v: CrowdView, fill: boolean, margin: number, ignore?: Person[]): boolean {
    if (u < uMin(f.inner, p.r) - 1e-6 || u > uMax(f.outer, p.r) + 1e-6) return false;
    const h = this.hidden(v, f.px, f.py, f.pz, p.scale);
    if (h.dist > this.o.liveR) return false;
    if (!fill && !h.ok) return false;
    if (h.dist < 2.5) return false;
    if (!this.net.clearOfObstacles(f.px, f.pz, p.r, 0.05)) return false;
    if (this.net.roadClearance(pc, f.px, f.pz, 1) < KERB_BAND + p.r + 0.02) return false;
    for (let ia = 0; ia < this.active.length; ia++) {
      const q = this.active[ia];
      if (q === p || (ignore && ignore.includes(q))) continue;
      if (hyp(q.x - f.px, q.z - f.pz) < q.r + p.r + margin) return false;
    }
    if (ignore) for (const q of ignore) if (q !== p && hyp(q.x - f.px, q.z - f.pz) < q.r + p.r + margin) return false;
    void s;
    return true;
  }

  private activate(p: Person, pc: Piece, s: number, u: number, f: Frame) {
    p.active = true;
    p.serial++;
    p.piece = pc; p.s = s; p.u = u; p.row = f.i;
    p.uTarget = u;
    p.x = f.px; p.y = f.py; p.z = f.pz;
    this.slope(p, f);
    p.yaw = Math.atan2(f.tx * p.dir, f.tz * p.dir);
    p.baseYaw = p.yaw;
    p.visibleT = 0;
    if (this._view) this.look(p, this._view);
    // far off but in view: fade in (the first fill of an empty view is a scene cut: no fade)
    p.appear = this.warm && p.inView ? 0 : 1;
    p.leaving = false;
    this.active.push(p);
    pc.count++;
    this.stats.spawned++;
    this.spawnLog.push({ p, inView: p.inView, dist: p.dist });
  }
  private _sv = { ok: true, inView: false, dist: 0 };
  private _view: CrowdView | null = null;

  // ───────────────────────────── motion ─────────────────────────────

  private move(p: Person, dt: number, car: CrowdCar) {
    p.age += dt;
    if (p.leaving) p.appear = Math.max(0, p.appear - dt / APPEAR);
    else if (p.appear < 1) p.appear = Math.min(1, p.appear + dt / APPEAR);
    const C = this.o.clips;
    if (p.mode === Mode.Idle) this.idle(p, dt, car);
    else if (p.mode === Mode.Turn) this.turn(p, dt);
    else this.walk(p, dt, car);
    // animation clocks
    if (p.fade < 1) p.fade = Math.min(1, p.fade + dt / FADE);
    if (p.clip === Clip.Idle) p.t = (p.t + dt * p.idleRate) % C[Clip.Idle].seconds;
  }

  private setClip(p: Person, c: Clip) {
    if (c === p.clip) return;
    const C = this.o.clips;
    p.prevClip = p.clip; p.prevT = p.t; p.fade = 0;
    if (c === Clip.Idle) p.t = this.rng.range(0, C[Clip.Idle].seconds);
    else if (p.clip !== Clip.Idle) p.t = (p.t / C[p.clip].seconds) * C[c].seconds;
    else p.t = 0;
    p.clip = c;
  }

  private walkClip(p: Person): Clip {
    return p.kind === Kind.Skater ? Clip.Skate : p.kind === Kind.Brisk ? Clip.Fast : Clip.Walk;
  }

  private idle(p: Person, dt: number, car: CrowdCar) {
    p.vx = 0; p.vz = 0; p.v = 0;
    // glance at the car when it passes close and quick
    const dx = car.x - p.x, dz = car.z - p.z;
    const cd = hyp(dx, dz), cs = hyp(car.vx, car.vz);
    let want = p.baseYaw;
    if (cd < 14 && cs > 6) {
      const a = Math.atan2(dx, dz);
      const off = wrap(a - p.baseYaw);
      want = p.baseYaw + Math.max(-1.6, Math.min(1.6, off));
    }
    p.yaw = approach(p.yaw, want, 2.2 * dt);
    if (p.idleT !== Infinity) {
      p.idleT -= dt;
      if (p.idleT <= 0) {
        // off for a walk: whichever way is freer
        p.kind = Kind.Walker;
        p.vPref = this.o.clips[Clip.Walk].speed * p.scale * this.rng.range(0.88, 1.06);
        const f = this.net.frame(p.piece, p.s, p.u, p.row, _f);
        p.dir = this.rng.chance(0.5) ? 1 : -1;
        p.uPref = this.lanePref(p, uMin(f.inner, p.r), uMax(f.outer, p.r));
        p.uTarget = p.u;
        this.startTurnTo(p, Math.atan2(f.tx * p.dir, f.tz * p.dir));
      }
    }
  }

  private startTurnTo(p: Person, yaw: number) {
    p.mode = Mode.Turn;
    p.turnTo = p.yaw + wrap(yaw - p.yaw);
    p.v = 0; p.vx = 0; p.vz = 0;
    this.setClip(p, Clip.Idle);
  }

  private turn(p: Person, dt: number) {
    p.vx = 0; p.vz = 0;
    const d = p.turnTo - p.yaw;
    const step = 3.4 * dt;
    if (Math.abs(d) <= step) {
      p.yaw = p.turnTo;
      p.mode = Mode.Walk;
      p.v = 0;
      p.wait = 0;
      this.setClip(p, this.walkClip(p));
    } else p.yaw += Math.sign(d) * step;
  }

  /** Turn round on the spot (walk the other way). */
  private turnRound(p: Person) {
    p.dir = (-p.dir) as 1 | -1;
    const f = this.net.frame(p.piece, p.s, p.u, p.row, _h);
    p.uPref = this.lanePref(p, uMin(f.inner, p.r), uMax(f.outer, p.r));
    p.uTarget = p.u;
    // turn through the side away from the road
    const fwd = Math.atan2(f.tx * p.dir, f.tz * p.dir);
    let d = wrap(fwd - p.yaw);
    const outward = Math.atan2(f.nx, f.nz);
    if (Math.abs(Math.abs(d) - Math.PI) < 0.35) d = Math.sign(wrap(outward - p.yaw)) * Math.abs(d) || d;
    p.mode = Mode.Turn;
    p.turnTo = p.yaw + d;
    p.v = 0;
    this.setClip(p, Clip.Idle);
    this.stats.turns++;
  }

  private walk(p: Person, dt: number, car: CrowdCar) {
    const net = this.net;
    const f = net.frame(p.piece, p.s, p.u, p.row, _f);
    p.row = f.i;
    const dir = p.dir;
    const dx = f.tx * dir, dz = f.tz * dir; // walking direction
    const nx = f.nx, nz = f.nz; // outward
    const r = p.r;
    const look = 1.6 + p.vPref * 1.5;
    // ---- what is near, in (σ along my way, λ = offset from the kerb)
    this.nb = 0;
    const reach = look + 2.5;
    for (let ia = 0; ia < this.active.length; ia++) {
      const q = this.active[ia];
      if (q === p) continue;
      const ex = q.x - f.px, ez = q.z - f.pz;
      if (ex * ex + ez * ez > reach * reach) continue;
      const sg = ex * dx + ez * dz;
      if (sg < -(r + q.r + 0.3)) continue;
      const vs = q.vx * dx + q.vz * dz;
      // walking my way (moving or queueing)?
      const qdx = Math.sin(q.yaw), qdz = Math.cos(q.yaw);
      const same = (q.mode === Mode.Walk || q.mode === Mode.Wait) && qdx * dx + qdz * dz > 0.5;
      const k = this.addBlocker();
      this.bSg[k] = sg; this.bLam[k] = p.u + ex * nx + ez * nz; this.bR[k] = r + q.r; this.bVs[k] = vs;
      this.bFlags[k] = (hyp(q.vx, q.vz) > 0.15 ? 1 : 0) | 2 | (same ? 4 : 0);
    }
    const obs = this.obsTmp;
    const nObs = net.obstacles.near(f.px, f.pz, reach + 2, obs);
    for (let oi = 0; oi < nObs; oi++) {
      const o = obs[oi];
      const len = hyp(o.x1 - o.x0, o.z1 - o.z0);
      const n = len > 0.01 ? Math.ceil(len / 0.3) : 0;
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n : 0;
        const ox = o.x0 + (o.x1 - o.x0) * t, oz = o.z0 + (o.z1 - o.z0) * t;
        const ex = ox - f.px, ez = oz - f.pz;
        const sg = ex * dx + ez * dz;
        if (sg < -(r + o.r + 0.3) || sg > reach + o.r) continue;
        const b = this.addBlocker();
        this.bSg[b] = sg; this.bLam[b] = p.u + ex * nx + ez * nz; this.bR[b] = r + o.r; this.bVs[b] = 0; this.bFlags[b] = 0;
      }
    }
    // ---- the band ahead (it narrows, it ends)
    const lo0 = uMin(f.inner, r), hi0 = uMax(f.outer, r);
    let endAt = Infinity;
    const pLo = this._pLo, pHi = this._pHi, pSg = this._pSg;
    for (let j = 0; j < 3; j++) {
      const sg = ((j + 1) / 3) * look;
      pSg[j] = sg;
      if (endAt < Infinity) { pLo[j] = Infinity; pHi[j] = -Infinity; continue; }
      net.walk(p.piece, p.s, (dir * sg) / f.stretch, _spot);
      if (_spot.end) {
        endAt = Math.max(0, Math.abs(_spot.moved) * f.stretch);
        pLo[j] = Infinity; pHi[j] = -Infinity;
        continue;
      }
      const g = net.frame(_spot.piece, _spot.s, 0, _spot.row, _g);
      pLo[j] = uMin(g.inner, r); pHi[j] = uMax(g.outer, r);
    }
    // ---- lanes: a few lateral positions across the band, plus where I am, like to be, aim for
    // (within the band here and a step ahead, so a narrowing walk steers people in early)
    let lo1 = lo0, hi1 = hi0;
    if (pLo[0] <= pHi[0]) {
      lo1 = Math.max(lo0, pLo[0]); hi1 = Math.min(hi0, pHi[0]);
      if (hi1 < lo1) { lo1 = lo0; hi1 = hi0; }
    }
    const lanes = this.lanes;
    let nl = 0;
    const w = hi1 - lo1;
    const k = w <= 0.05 ? 1 : Math.min(9, Math.max(2, Math.floor(w / 0.28) + 1));
    for (let i = 0; i < k; i++) lanes[nl++] = k === 1 ? (lo1 + hi1) / 2 : lo1 + (w * i) / (k - 1);
    const iCur = nl;
    lanes[nl++] = Math.min(hi1, Math.max(lo1, p.u));
    lanes[nl++] = Math.min(hi1, Math.max(lo1, p.uPref));
    const iTgt = nl;
    lanes[nl++] = Math.min(hi1, Math.max(lo1, p.uTarget));
    // the car close and quick: keep off the kerb edge
    const cdx = car.x - p.x, cdz = car.z - p.z;
    const carNear = cdx * cdx + cdz * cdz < 144 && car.vx * car.vx + car.vz * car.vz > 100;
    let best = -Infinity, bestI = iCur, bestFree = 0, curFree = look, curLim = -1, tgtScore = -Infinity, tgtFree = 0;
    this._u = p.u; this._look = look; this._endAt = endAt;
    this.freeLanes(nl, iCur);
    for (let i = 0; i < nl; i++) {
      const lam = lanes[i];
      const free = this.laneFree[i];
      let sc = Math.min(free, look) - 0.5 * Math.abs(lam - p.u) - 0.22 * Math.abs(lam - p.uPref);
      if (carNear && lam < lo0 + 0.5) sc -= 0.6;
      if (i === iCur) { curFree = free; curLim = this.laneLim[i]; }
      if (i === iTgt) { tgtScore = sc; tgtFree = free; }
      if (sc > best) { best = sc; bestI = i; bestFree = free; }
    }
    if (tgtScore >= best - 0.25) { bestI = iTgt; bestFree = tgtFree; }
    p.uTarget = lanes[bestI];
    // ---- speed: by the room in my lane, or in the lane I am stepping into
    const comfort = 0.35 + 0.75 * p.vPref;
    const room = Math.abs(p.uTarget - p.u) < 0.05 ? curFree : Math.max(curFree, Math.min(bestFree, curFree + 0.9));
    let vt = p.vPref * Math.max(0, Math.min(1, (room - 0.12) / comfort));
    if (p.mode === Mode.Wait && room < 0.7) vt = 0;
    const acc = vt > p.v ? 1.6 : 4.5;
    p.v += Math.max(-acc * dt, Math.min(acc * dt, vt - p.v));
    if (p.v < 0.04) p.v = 0;
    // ---- blocked: wait, then turn round (at once when the way is shut for good)
    if (vt < 0.18 * p.vPref && p.v < 0.3 * p.vPref) {
      if (p.mode !== Mode.Wait) { p.mode = Mode.Wait; p.wait = 0; this.setClip(p, Clip.Idle); }
      p.wait += dt;
      p.stuck += dt;
      const bf = curLim >= 0 ? this.bFlags[curLim] : 0;
      // the end of the walk or an obstacle: turn now; an oncoming or standing person: a moment;
      // a queue of people going my way: patience
      const limit = !(bf & 2) ? 0.3 : bf & 4 ? 5 + p.waitLimit * 3 : p.waitLimit;
      p.v = 0; p.vx = 0; p.vz = 0;
      if (p.wait > limit) this.turnRound(p);
      return;
    }
    if (p.mode === Mode.Wait) { p.mode = Mode.Walk; this.setClip(p, this.walkClip(p)); }
    p.stuck = Math.max(0, p.stuck - dt);
    // ---- step: lateral glide toward the chosen lane, the rest of the speed along the way
    const vMove = Math.max(p.v, 0.35 * p.vPref);
    let vl = Math.max(-0.7, Math.min(0.7, (p.uTarget - p.u) * 2.5));
    if (Math.abs(vl) > vMove * 0.7) vl = Math.sign(vl) * vMove * 0.7;
    const va = Math.sqrt(Math.max(0, p.v * p.v - vl * vl));
    const ds = (dir * va * dt) / f.stretch;
    const du = vl * dt;
    const moved = this.tryMove(p, ds, du) || (du !== 0 && this.tryMove(p, ds, 0)) || (du !== 0 && this.tryMove(p, 0, du));
    if (!moved) {
      this.stats.blockedMoves++; p.v = 0; p.vx = 0; p.vz = 0;
      // every step refused for a while (the band folds shut, someone stands in the gap): go back
      p.jam += dt;
      if (p.jam > 0.6) { p.jam = 0; this.turnRound(p); return; }
    } else p.jam = 0;
    // ---- facing and the clip clock: feet move with the ground actually covered
    const gs = hyp(p.vx, p.vz);
    if (gs > 0.05) p.yaw = approach(p.yaw, Math.atan2(p.vx, p.vz), 5 * dt);
    const cs = this.o.clips[p.clip];
    if (p.clip !== Clip.Idle && cs.speed > 0) p.t = (p.t + (dt * gs) / (cs.speed * p.scale)) % cs.seconds;
  }
  private _pLo = new Float64Array(4);
  private _pHi = new Float64Array(4);
  private _pSg = new Float64Array(4);
  private addBlocker(): number {
    if (this.nb === this.bSg.length) {
      const grow = <T extends Float64Array | Uint8Array>(a: T): T => { const b = new (a.constructor as any)(a.length * 2); b.set(a); return b; };
      this.bSg = grow(this.bSg); this.bLam = grow(this.bLam); this.bR = grow(this.bR); this.bVs = grow(this.bVs); this.bFlags = grow(this.bFlags);
    }
    return this.nb++;
  }

  /**
   * Free distance ahead along each lane i < nl (laneFree[i]; laneLim[i] the blocker that limits
   * it, -1 the sidewalk itself) for a body now at lateral _u, looking _look ahead, the walk
   * ending _endAt ahead. Numbers come in fields and go out in arrays: in V8 a call that is not
   * inlined boxes every fractional number passed or returned (a heap object each), and this
   * runs for every lane of every person every frame.
   */
  private freeLanes(nl: number, iCur: number) {
    const u = this._u, look = this._look, endAt = this._endAt;
    const nb = this.nb, S = this.bSg, L = this.bLam, BR = this.bR, V = this.bVs, F = this.bFlags;
    const pLo = this._pLo, pHi = this._pHi, pSg = this._pSg;
    const pad = 0.1;
    for (let li = 0; li < nl; li++) {
      const lam = this.lanes[li];
      const current = li === iCur;
      let free = Math.min(look, endAt);
      let lim = -1;
      for (let i = 0; i < nb; i++) {
        if (current && S[i] < 0) continue;
        const R = BR[i] + pad;
        const dl = Math.abs(L[i] - lam);
        if (dl >= R) continue;
        let d = S[i] - Math.sqrt(R * R - dl * dl);
        if (F[i] & 1) {
          if (V[i] > 0.2) d += V[i] * 1.2; // walking away: the gap holds
          else if (V[i] < -0.2) d -= -V[i] * 0.5; // coming toward: it closes
        }
        if (d < free) { free = d; lim = i; }
      }
      // the band narrowing or ending ahead
      for (let j = 0; j < 3; j++) {
        if (lam < pLo[j] - 0.02 || lam > pHi[j] + 0.02) {
          const d = pSg[j] - 0.6;
          if (d < free) { free = d; lim = -1; }
          break;
        }
      }
      // stepping across to the lane: someone beside me on that side is in the way
      if (!current && Math.abs(lam - u) > 0.05) {
        const sgn = Math.sign(lam - u);
        for (let i = 0; i < nb; i++) {
          if (S[i] < -BR[i] || S[i] > BR[i] + 0.3) continue;
          const side = (L[i] - u) * sgn;
          if (side > 0 && side < Math.abs(lam - u) + BR[i]) { free = Math.min(free, -0.1); break; }
        }
      }
      this.laneFree[li] = free;
      this.laneLim[li] = lim;
    }
  }

  /** Move by (ds along s, du across) if the new spot is legal; updates the person. */
  private tryMove(p: Person, ds: number, du: number): boolean {
    // (inlined: the step goes in fields, not as boxed arguments; see WalkNet.frame)
    this._ds = ds; this._du = du;
    return this.tryStep(p);
  }
  private _ds = 0;
  private _du = 0;

  private tryStep(p: Person): boolean {
    const ds = this._ds, du = this._du;
    const net = this.net;
    net.walk(p.piece, p.s, ds, _spot2);
    let u = p.u + du;
    let g = net.frame(_spot2.piece, _spot2.s, u, _spot2.row, _h);
    const lo = uMin(g.inner, p.r), hi = uMax(g.outer, p.r);
    if (u < lo - 1e-6 || u > hi + 1e-6) {
      // outside the band there. Where it narrows under a body walking at its edge, a nudge of
      // a few cm keeps it inside; otherwise only a move that cuts how far outside the body
      // already is (measured where it stands now) is allowed, never one that leaves the band.
      const h = net.frame(p.piece, p.s, p.u, p.row, _f2);
      const before = Math.max(0, uMin(h.inner, p.r) - p.u, p.u - uMax(h.outer, p.r));
      const uc = Math.min(hi, Math.max(lo, u));
      if (hi >= lo && Math.abs(uc - u) <= 0.03 && before <= 1e-6) {
        u = uc;
        g = net.frame(_spot2.piece, _spot2.s, u, _spot2.row, _h);
      } else {
        const after = Math.max(0, lo - u, u - hi);
        if (!(after < before - 1e-9)) return false;
      }
    }
    if (!net.clearOfObstacles(g.px, g.pz, p.r, 0)) return false;
    // never onto a road or its kerb band (where the sidewalk folds round a tight bend or runs
    // beside another road); a body somehow already too close may only move further off
    const need = KERB_BAND + p.r;
    const cl = net.roadClearance(_spot2.piece, g.px, g.pz, 1);
    if (cl < need && !(cl > net.roadClearance(p.piece, p.x, p.z, 1) + 1e-9)) return false;
    const act = this.active;
    for (let i = 0; i < act.length; i++) {
      const q = act[i];
      if (q === p) continue;
      const ex = q.x - g.px, ez = q.z - g.pz, rr = q.r + p.r;
      const d2 = ex * ex + ez * ez;
      if (d2 < rr * rr) {
        const fx = q.x - p.x, fz = q.z - p.z;
        if (!(d2 > fx * fx + fz * fz + 1e-12)) return false;
      }
    }
    const ox = p.x, oz = p.z;
    p.piece = _spot2.piece; p.s = _spot2.s; p.row = g.i; p.u = u;
    p.x = g.px; p.y = g.py; p.z = g.pz;
    this.slope(p, g);
    const step = this._dt;
    p.vx = (p.x - ox) / step; p.vz = (p.z - oz) / step;
    return true;
  }
  private _dt = 1 / 60;

  private slope(p: Person, f: Frame) {
    const pc = f.piece, i = f.i;
    const dl = hyp(pc.x[i + 1] - pc.x[i], pc.z[i + 1] - pc.z[i]);
    const g = dl > 1e-6 ? (pc.y[i + 1] - pc.y[i]) / dl : 0;
    p.gx = g * f.tx; p.gz = g * f.tz;
  }

}

function wrap(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function approach(a: number, b: number, step: number) {
  const d = wrap(b - a);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { segDist, ObstacleKind };
