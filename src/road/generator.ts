import { Rng, hash32 } from '../core/rng';
import { clamp, DEG, wrapAngle } from '../core/math';
import { fbm1 } from '../core/noise';
import { Path } from './path';
import { RoadNetwork, CorridorSeg } from './network';
import { CLASS_SPEC, RoadClass, RoadEvent, EventType, kerbHalfWidth } from './types';
import { Districts, District } from './districts';
import type { Mood } from '../world/moods';

/**
 * The endless road generator. Deterministic from the seed: every path draws from its own
 * random stream keyed by (seed, path id), sections are tested against the live road's
 * corridors before they are committed, and forks extend both branches in lockstep.
 */

export const BAND = 70 * DEG; // base heading band around north outside hard-turn events
export const BRANCH_HORIZON = 1500; // both branches are generated this far past a fork
const ROADSIDE = 34; // corridor radius beyond the kerb reserved for roadside buildings
const GAP = 2.5; // minimum kerb-to-kerb gap between two stretches of road

type Intent = 'free' | 'climb' | 'descend' | 'flat' | 'crest' | 'roll' | 'dip';
interface Zone { s0: number; s1: number; cap: number; intent: Intent; vcMax?: number; dir?: number }

interface ProposedPiece { len: number; k0: number; k1: number }
interface Proposal {
  pieces: ProposedPiece[];
  type: EventType | 'straight' | 'sbend';
  event?: { type: EventType; dir: number; radius: number; turns: [number, number, number][] };
  zones: { a: number; b: number; cap?: number; intent?: Intent; vcMax?: number }[]; // offsets within the section
  /** extend the event's skip-region this far before the section (for doubled-back pairs) */
  eventPre?: number;
  eventPost?: number;
  hard: boolean;
}

export interface ForkInfo {
  trunk: Path;
  s: number; // fork point on the trunk (= trunk length)
  left: Path;
  right: Path;
  signS: number; // guide sign position on the trunk
  district: District; // district at the fork
  destL: District;
  destR: District;
  committed: 0 | 1 | -1;
}

interface GenState {
  rng: Rng;
  phase: 'flow' | 'tech';
  phaseLeft: number;
  nextForkAt: number;
  cls: RoadClass;
  clsLeft: number;
  zones: Zone[];
  zLast: number; // last VPI elevation
  sLast: number; // last VPI s
  gLast: number; // grade into last VPI... (grade of the last segment)
  dLast: number; // length of the last VPI segment
  zT: number;
  sector: [number, number] | null;
  sectorUntil: number;
  target: District | null;
  noiseSeed: number;
  techCount: number;
  stopped: boolean; // a dead branch is never extended
  pendingFork: boolean;
  lastTech: EventType | null;
  sinceTech: number;
  /** stretches a doubled-back event runs beside (soft rule off between them) until `until` */
  near: { s0: number; s1: number; until: number }[];
  stuck: number;
}

let eventIds = 1;

export interface GeneratorOptions {
  seed: number;
  startMood?: Mood | null;
}

export class RoadGenerator {
  readonly seed: number;
  readonly net = new RoadNetwork();
  readonly districts: Districts;
  readonly forks: ForkInfo[] = [];
  root: Path;
  /** counters for tests */
  stats = { rejected: 0, sections: 0, stuck: 0, fallbacks: 0 };

  constructor(o: GeneratorOptions) {
    this.seed = o.seed >>> 0;
    this.districts = new Districts(this.seed, o.startMood ?? null);
    const d0 = this.districts.cell(0, 0);
    const cls = this.preferredClass(d0.mood, new Rng(hash32(this.seed, 3)));
    this.root = new Path(d0.x, d0.z - 400, 0, cls);
    this.net.add(this.root);
    this.initState(this.root, cls, 0, 0);
    // a calm, straight start: the title camera looks at the parked car here
    const st = this.root.gen as GenState;
    this.commit(this.root, { pieces: [{ len: 220, k0: 0, k1: 0 }], type: 'straight', zones: [{ a: 0, b: 220, cap: 0.03, intent: 'flat' }], hard: false });
    st.nextForkAt = 2600 + st.rng.range(0, 1200);
  }

  private initState(p: Path, cls: RoadClass, z0: number, g0: number) {
    const rng = new Rng(hash32(this.seed, 101, p.id));
    const st: GenState = {
      rng,
      phase: 'flow',
      phaseLeft: rng.range(500, 1200),
      nextForkAt: 1e9,
      cls,
      clsLeft: rng.range(900, 2200),
      zones: [],
      zLast: z0,
      sLast: 0,
      gLast: g0,
      dLast: 1e9,
      zT: rng.range(-30, 40),
      sector: null,
      sectorUntil: 0,
      target: null,
      noiseSeed: hash32(this.seed, 55, p.id),
      techCount: 0,
      stopped: false,
      pendingFork: false,
      lastTech: null,
      sinceTech: 0,
      near: [],
      stuck: 0,
    };
    p.gen = st;
    p.profile.add({ s: 0, z: z0, L: 0 });
  }

  // ------------------------------------------------------------------ helpers ----------

  preferredClass(mood: Mood, rng: Rng): RoadClass {
    const W: Record<Mood, [number, number, number]> = {
      downtown: [0.1, 0.4, 0.5],
      midtown: [0.25, 0.5, 0.25],
      oldtown: [0.75, 0.25, 0],
      docks: [0.3, 0.5, 0.2],
      suburbs: [0.55, 0.45, 0],
      edge: [0.6, 0.4, 0],
    };
    return rng.weighted(['back', 'avenue', 'arterial'] as RoadClass[], W[mood]);
  }

  moodAt(p: Path, s: number): Mood {
    const pt = { x: 0, z: 0, h: 0, k: 0 };
    p.pointAt(Math.min(s, p.sampleEnd), pt);
    return this.districts.moodAt(pt.x, pt.z);
  }

  /** Turn of `theta` (signed, + left) at radius R with entry/exit spirals of length ls. */
  private turn(theta: number, R: number, ls: number): ProposedPiece[] {
    const k = Math.sign(theta) / R;
    const a = Math.abs(theta);
    let L = ls;
    // two spirals turn k*L in total
    if (L / R > a) L = a * R; // too short a turn for the spirals: all-spiral
    const arc = (a - L / R) * R;
    const out: ProposedPiece[] = [];
    if (L > 0) out.push({ len: L, k0: 0, k1: k });
    if (arc > 0.01) out.push({ len: arc, k0: k, k1: k });
    if (L > 0) out.push({ len: L, k0: k, k1: 0 });
    return out;
  }

  private static headingChange(pieces: ProposedPiece[]) {
    let h = 0;
    for (const p of pieces) h += ((p.k0 + p.k1) / 2) * p.len;
    return h;
  }

  /** Simulate pieces from a tip; returns points every `step` metres. */
  private simulate(x: number, z: number, h: number, pieces: ProposedPiece[], step = 4) {
    const pts: { x: number; z: number; h: number; d: number }[] = [];
    let d = 0;
    let next = 0;
    const dt = 0.5;
    for (const p of pieces) {
      let u = 0;
      const h0 = h;
      while (u < p.len - 1e-9) {
        const du = Math.min(dt, p.len - u);
        const um = u + du / 2;
        const hm = h0 + p.k0 * um + ((p.k1 - p.k0) * um * um) / (2 * p.len);
        x += Math.sin(hm) * du;
        z += Math.cos(hm) * du;
        u += du;
        d += du;
        if (d >= next) { pts.push({ x, z, h: hm, d }); next += step; }
      }
      h = h0 + p.k0 * p.len + ((p.k1 - p.k0) * p.len) / 2;
    }
    pts.push({ x, z, h, d });
    return { pts, x, z, h, len: d };
  }

  /**
   * True if the simulated points stay clear of the live road. Two rules:
   *  - hard: the kerbs of two different stretches never come closer than GAP (always, on any path,
   *    except where a stretch meets itself within a few metres of arc, or at a fork's junction);
   *  - soft: the roadside corridors (kerb + ROADSIDE) of unrelated stretches don't overlap, so there
   *    is room for buildings; relaxed for hard-turn events (scale) and skipped for the road the
   *    proposal naturally runs beside (its own last ~200 m, a doubled-back hairpin pair).
   */
  private fits(p: Path, pts: { x: number; z: number; d: number }[], sStart: number, hw: number, r: number, scale: number, near: { s0: number; s1: number }[]): boolean {
    for (const q of pts) {
      let bad = false;
      const sq = sStart + q.d;
      const R = r + 60;
      this.net.corridors.query(q.x - R, q.z - R, q.x + R, q.z + R, (c: CorridorSeg) => {
        if (this.isRelated(p, c, sq)) return;
        const dx = c.x1 - c.x0, dz = c.z1 - c.z0;
        const L2 = dx * dx + dz * dz || 1;
        const u = clamp(((q.x - c.x0) * dx + (q.z - c.z0) * dz) / L2, 0, 1);
        const dist = Math.hypot(c.x0 + dx * u - q.x, c.z0 + dz * u - q.z);
        const hardNeed = hw + c.hw + GAP;
        if (c.path === p) {
          const ds = sq - c.s1;
          if (ds < 1.6 * hardNeed + 8) return;
          if (dist < hardNeed) { bad = true; return true; }
          if (ds < 160 + r) return;
          for (const n of near) if (c.s1 >= n.s0 && c.s0 <= n.s1) return;
        } else if (dist < hardNeed) { bad = true; return true; }
        if (dist < (r + c.r) * scale) { bad = true; return true; }
      });
      if (bad) return false;
    }
    return true;
  }

  /** Corridors near a fork are allowed to overlap between parent and branches / siblings. */
  private isRelated(p: Path, c: CorridorSeg, sOwn: number): boolean {
    const q = c.path;
    const near = 420;
    // parent's approach to this path's fork
    if (p.parent && q === p.parent && sOwn < near && c.s1 > q.length - near) return true;
    // sibling near the shared start
    if (p.parent && q.parent === p.parent && q !== p && sOwn < near && c.s0 < near) return true;
    // grandparent: two forks in quick succession never happen (forks are > 2 km apart)
    return false;
  }

  /** Commit a proposal onto a path: pieces, event, zones, corridors. */
  private commit(p: Path, pr: Proposal): void {
    const st = p.gen as GenState;
    const s0 = p.length;
    let evId = 0;
    if (pr.event) {
      evId = eventIds++;
      const ev: RoadEvent = {
        type: pr.event.type,
        s0: s0,
        s1: s0,
        dir: pr.event.dir,
        turns: pr.event.turns.map(([a, b, d]) => [s0 + a, s0 + b, d]),
        radius: pr.event.radius,
        id: evId,
      };
      p.events.push(ev);
    }
    for (const pc of pr.pieces) p.addPiece(pc.len, pc.k0, pc.k1);
    const s1 = p.length;
    if (pr.event) p.events[p.events.length - 1].s1 = s1;
    for (const z of pr.zones) st.zones.push({ s0: s0 + z.a, s1: s0 + z.b, cap: z.cap ?? CLASS_SPEC[st.cls].maxGrade, intent: z.intent ?? 'free', vcMax: z.vcMax });
    // corridors every 8 m
    const pt = { x: 0, z: 0, h: 0, k: 0 }, pt2 = { x: 0, z: 0, h: 0, k: 0 };
    for (let s = s0; s < s1 - 1e-6; s += 8) {
      const e = Math.min(s1, s + 8);
      p.pointAt(s, pt);
      p.pointAt(e, pt2);
      const c = p.classAt(s), c2 = p.classAt(e);
      const hw = Math.max(kerbHalfWidth(c.from), kerbHalfWidth(c.to), kerbHalfWidth(c2.to));
      this.net.addCorridor({ path: p, s0: s, s1: e, x0: pt.x, z0: pt.z, x1: pt2.x, z1: pt2.z, r: hw + ROADSIDE, hw, ev: evId });
    }
    // a doubled-back pair runs beside the road before it, and the road after it runs beside both:
    // only the hard rule applies between them
    if (pr.eventPre && evId) st.near.push({ s0: s0 - pr.eventPre, s1: s1, until: s1 + (pr.eventPost ?? 0) });
    this.net.index(p);
    this.stats.sections++;
  }

  // ------------------------------------------------------------- section choice ---------

  /** Base heading the road is steering toward at the path's tip. */
  private targetHeading(p: Path): number {
    const st = p.gen as GenState;
    const tip = p.tip();
    let t = fbm1(st.noiseSeed, (p.length + 1000 * p.id) / 2600, 2) * 50 * DEG;
    if (st.target) {
      const d = this.districts.districtAt(tip.x, tip.z);
      if (d.i === st.target.i && d.j === st.target.j) st.target = null;
      else t = Math.atan2(st.target.x - tip.x, st.target.z - tip.z);
    }
    if (st.sector && p.length < st.sectorUntil) t = clamp(t, st.sector[0], st.sector[1]);
    return clamp(wrapAngle(t), -BAND + 8 * DEG, BAND - 8 * DEG);
  }

  private proposeFlow(p: Path, st: GenState, tries: number): Proposal {
    const rng = st.rng;
    const tip = p.tip();
    const cls = st.cls;
    const tgt = this.targetHeading(p);
    const err = wrapAngle(tgt - tip.h);
    const kind = tries > 3 ? 'straight' : rng.weighted(['straight', 'sweeper', 'sbend'] as const, cls === 'arterial' ? [0.4, 0.45, 0.15] : [0.32, 0.4, 0.28]);
    if (kind === 'straight') {
      const L = rng.range(60, cls === 'back' ? 200 : 320) * (tries > 3 ? 0.5 : 1);
      // a gentle correction toward the target heading rides along with straights
      const pcs: ProposedPiece[] = Math.abs(err) > 4 * DEG && tries < 6 ? this.turn(clamp(err, -20 * DEG, 20 * DEG), rng.range(400, 900), 40) : [];
      pcs.push({ len: L, k0: 0, k1: 0 });
      return { pieces: pcs, type: 'straight', zones: [{ a: 0, b: L + 80 }], hard: false };
    }
    const Rmin = cls === 'arterial' ? 300 : cls === 'avenue' ? 180 : 110;
    if (kind === 'sweeper') {
      let th = clamp(err + rng.range(-25, 25) * DEG, -65 * DEG, 65 * DEG);
      if (Math.abs(th) < 12 * DEG) th = Math.sign(th || 1) * rng.range(12, 30) * DEG;
      const R = rng.range(Rmin, Rmin * 2.8);
      const pcs = this.turn(th, R, clamp(R / 6, 30, 110));
      const len = pcs.reduce((a, b) => a + b.len, 0);
      return { pieces: pcs, type: 'sweeper', zones: [{ a: 0, b: len }], hard: false };
    }
    // S-bend
    const dir = Math.sign(err || rng.sign());
    const th1 = rng.range(18, 40) * DEG * dir;
    const th2 = -th1 + clamp(err, -15 * DEG, 15 * DEG);
    const R1 = rng.range(Rmin * 0.7, Rmin * 1.8), R2 = rng.range(Rmin * 0.7, Rmin * 1.8);
    const pcs = [...this.turn(th1, R1, clamp(R1 / 5, 20, 80)), { len: rng.range(10, 60), k0: 0, k1: 0 }, ...this.turn(th2, R2, clamp(R2 / 5, 20, 80))];
    const len = pcs.reduce((a, b) => a + b.len, 0);
    return { pieces: pcs, type: 'sbend', zones: [{ a: 0, b: len }], hard: false };
  }

  private proposeTech(p: Path, st: GenState, tries: number): Proposal {
    const rng = st.rng;
    const tip = p.tip();
    const cls = st.cls;
    const mood = this.moodAt(p, p.length);
    const types: EventType[] = ['switchbacks', 'hairpin', 'blockturn', 'chicane', 'tightening'];
    let w: number[];
    if (cls === 'arterial') w = [0, 0, 0, 0.3, 0.7];
    else {
      const hilly = mood === 'oldtown' || mood === 'edge' || mood === 'suburbs';
      const grid = mood === 'downtown' || mood === 'midtown' || mood === 'docks';
      w = [hilly ? 0.32 : 0.12, hilly ? 0.2 : 0.1, grid ? 0.4 : 0.18, 0.18, 0.18];
      if (cls === 'avenue') { w[0] *= 0.6; w[1] *= 0.6; }
    }
    // keep the mix varied: never repeat the same event back to back
    if (st.lastTech) w[types.indexOf(st.lastTech)] *= 0.25;
    const type = rng.weighted(types, w);
    const err = wrapAngle(this.targetHeading(p) - tip.h);
    const hairR = cls === 'avenue' ? rng.range(14, 17) : rng.range(9.5, 13);
    const back = cls === 'back';
    const capLeg = CLASS_SPEC[cls].maxGrade;
    const hairCap = 0.06;
    const vertical: Intent = st.zT > (st.zLast ?? 0) ? 'climb' : 'descend';

    if (type === 'switchbacks') {
      const n = rng.int(2, back ? 4 : 3);
      const sigma = err > 0 ? -1 : err < 0 ? 1 : rng.sign(); // entry turn direction (+1 left)
      const entry = this.turn(sigma * 90 * DEG, rng.range(16, 24), 10);
      const legL = rng.range(55, 105);
      const pcs: ProposedPiece[] = [{ len: 30, k0: 0, k1: 0 }, ...entry, { len: legL * 0.8, k0: 0, k1: 0 }];
      const turns: [number, number, number][] = [];
      let off = pcs.reduce((a, b) => a + b.len, 0);
      const zones: Proposal['zones'] = [{ a: 0, b: off, cap: 0.08, intent: vertical }];
      turns.push([30, 30 + entry.reduce((a, b) => a + b.len, 0), sigma]);
      let d = -sigma;
      for (let i = 0; i < n; i++) {
        const hp = this.turn(d * Math.PI, hairR, 8);
        const hl = hp.reduce((a, b) => a + b.len, 0);
        turns.push([off, off + hl, d]);
        zones.push({ a: off - 6, b: off + hl + 6, cap: hairCap, intent: vertical, vcMax: 26 });
        pcs.push(...hp);
        off += hl;
        const leg = i < n - 1 ? legL : legL * 0.8;
        pcs.push({ len: leg, k0: 0, k1: 0 });
        zones.push({ a: off + 6, b: off + leg - 6, cap: capLeg, intent: vertical });
        off += leg;
        d = -d;
      }
      // exit back to the base heading: after n hairpins the heading is sigma*90 if n even...
      const hNow = sigma * 90 * DEG + (n % 2 === 1 ? -sigma * 180 * DEG : 0);
      const exit = this.turn(-hNow, rng.range(16, 24), 10);
      const el = exit.reduce((a, b) => a + b.len, 0);
      turns.push([off, off + el, Math.sign(-hNow)]);
      pcs.push(...exit, { len: 30, k0: 0, k1: 0 });
      zones.push({ a: off, b: off + el + 30, cap: 0.08, intent: vertical });
      return { pieces: pcs, type, event: { type, dir: sigma, radius: hairR, turns }, zones, hard: true };
    }
    if (type === 'hairpin') {
      // a doubled-back pair: the road reverses, runs back alongside itself, then reverses again
      const d = err > 0 ? 1 : err < 0 ? -1 : rng.sign();
      const leg = rng.range(45, 85);
      const h1 = this.turn(d * Math.PI, hairR, 8);
      const h2 = this.turn(-d * Math.PI, hairR, 8);
      const l1 = h1.reduce((a, b) => a + b.len, 0), l2 = h2.reduce((a, b) => a + b.len, 0);
      const pcs = [{ len: 25, k0: 0, k1: 0 }, ...h1, { len: leg, k0: 0, k1: 0 }, ...h2, { len: 40, k0: 0, k1: 0 }];
      const turns: [number, number, number][] = [[25, 25 + l1, d], [25 + l1 + leg, 25 + l1 + leg + l2, -d]];
      const tot = 25 + l1 + leg + l2 + 40;
      const zones = [
        { a: 0, b: 25, cap: 0.06, intent: 'flat' as Intent },
        { a: 25, b: 25 + l1, cap: hairCap, intent: vertical, vcMax: 26 },
        { a: 25 + l1, b: 25 + l1 + leg, cap: capLeg, intent: vertical },
        { a: 25 + l1 + leg, b: tot, cap: hairCap, intent: 'flat' as Intent, vcMax: 26 },
      ];
      return { pieces: pcs, type, event: { type, dir: d, radius: hairR, turns }, zones, eventPre: leg + 60, eventPost: leg + 160, hard: true };
    }
    if (type === 'blockturn') {
      // a block corner, usually answered by the next corner a block later
      const d = err > 10 * DEG ? 1 : err < -10 * DEG ? -1 : rng.sign();
      let th = d * rng.range(80, 98) * DEG;
      if (Math.abs(wrapAngle(tip.h + th)) > 100 * DEG) th = -th;
      const R = rng.range(10, back ? 15 : 19);
      const c1 = this.turn(th, R, 6);
      const blk = rng.range(55, 140);
      const c2 = this.turn(-th + clamp(err, -12 * DEG, 12 * DEG) * 0.5, rng.range(10, back ? 16 : 20), 6);
      const l1 = c1.reduce((a, b) => a + b.len, 0), l2 = c2.reduce((a, b) => a + b.len, 0);
      const pcs = [{ len: 35, k0: 0, k1: 0 }, ...c1, { len: blk, k0: 0, k1: 0 }, ...c2, { len: 35, k0: 0, k1: 0 }];
      const turns: [number, number, number][] = [[35, 35 + l1, Math.sign(th)], [35 + l1 + blk, 35 + l1 + blk + l2, -Math.sign(th)]];
      const tot = 70 + l1 + l2 + blk;
      return { pieces: pcs, type, event: { type, dir: Math.sign(th), radius: R, turns }, zones: [{ a: 0, b: 35 + l1 + 5, cap: 0.05, intent: 'flat' }, { a: 35 + l1 + 5, b: 35 + l1 + blk - 5, intent: 'free' }, { a: 35 + l1 + blk - 5, b: tot, cap: 0.05, intent: 'flat' }], hard: true };
    }
    if (type === 'chicane') {
      const d = rng.sign();
      const th = rng.range(18, 30) * DEG * d;
      const R = rng.range(cls === 'arterial' ? 60 : 24, cls === 'arterial' ? 90 : 42);
      const a = this.turn(th, R, 8), b = this.turn(-2 * th, R, 8), c = this.turn(th, R, 8);
      const g1 = rng.range(3, 10), g2 = rng.range(3, 10);
      const la = a.reduce((x, y) => x + y.len, 0), lb = b.reduce((x, y) => x + y.len, 0), lc = c.reduce((x, y) => x + y.len, 0);
      const pcs = [{ len: 20, k0: 0, k1: 0 }, ...a, { len: g1, k0: 0, k1: 0 }, ...b, { len: g2, k0: 0, k1: 0 }, ...c, { len: 20, k0: 0, k1: 0 }];
      const turns: [number, number, number][] = [[20, 20 + la, d], [20 + la + g1, 20 + la + g1 + lb, -d], [20 + la + g1 + lb + g2, 20 + la + g1 + lb + g2 + lc, d]];
      const tot = 40 + la + lb + lc + g1 + g2;
      return { pieces: pcs, type, event: { type, dir: d, radius: R, turns }, zones: [{ a: 0, b: tot, cap: Math.min(0.07, capLeg) }], hard: true };
    }
    // tightening corner: radius decreasing through the turn
    const d = err > 0 ? 1 : err < 0 ? -1 : rng.sign();
    const total = rng.range(70, cls === 'arterial' ? 80 : 115) * DEG;
    const R0 = cls === 'arterial' ? rng.range(200, 260) : rng.range(70, 110);
    const R1 = cls === 'arterial' ? rng.range(65, 85) : rng.range(19, 28);
    // entry spiral 0→1/R0, tightening spiral 1/R0→1/R1, short arc, exit spiral 1/R1→0
    const lin = 25;
    const exitL = 14;
    const turnEntry = (lin / R0) / 2;
    const turnExit = (exitL / R1) / 2;
    const remain = total - turnEntry - turnExit;
    // tightening spiral turns (1/R0 + 1/R1)/2 * L
    const Lt = Math.max(15, (remain * 0.85) / ((1 / R0 + 1 / R1) / 2));
    const turnT = ((1 / R0 + 1 / R1) / 2) * Lt;
    const arcL = Math.max(0, (total - turnEntry - turnExit - turnT) * R1);
    const pcs: ProposedPiece[] = [
      { len: 20, k0: 0, k1: 0 },
      { len: lin, k0: 0, k1: d / R0 },
      { len: Lt, k0: d / R0, k1: d / R1 },
      ...(arcL > 0.5 ? [{ len: arcL, k0: d / R1, k1: d / R1 }] : []),
      { len: exitL, k0: d / R1, k1: 0 },
      { len: 25, k0: 0, k1: 0 },
    ];
    const tot = pcs.reduce((a, b) => a + b.len, 0);
    return { pieces: pcs, type: 'tightening', event: { type: 'tightening', dir: d, radius: R1, turns: [[20, tot - 25, d]] }, zones: [{ a: 0, b: tot, cap: Math.min(0.08, capLeg) }], hard: true };
  }

  /** The heading after a proposal must be back inside the band (events may leave it briefly). */
  private headingOk(h: number): boolean {
    return Math.abs(wrapAngle(h)) <= BAND;
  }

  // ---------------------------------------------------------------- generation -----------

  /** Extend `p` until its plan reaches `sTarget` (forks spawn children; they are extended separately). */
  extend(p: Path, sTarget: number) {
    const st = p.gen as GenState;
    if (!st || st.stopped) return;
    let guard = 0;
    while (p.length < sTarget && p.forkS === null && guard++ < 400) {
      this.step(p);
    }
    this.extendProfile(p);
  }

  private step(p: Path) {
    const st = p.gen as GenState;
    const tip = p.tip();
    // class changes (taper) at the start of a section
    if (st.clsLeft <= 0 && st.phase === 'flow') {
      const mood = this.moodAt(p, p.length);
      const nc = this.preferredClass(mood, st.rng);
      st.clsLeft = st.rng.range(900, 2400);
      if (nc !== st.cls) {
        const taper = 80;
        p.spans.push({ s0: p.length, s1: p.length + taper, from: st.cls, to: nc });
        // taper on a straight, low grade
        const strict = Math.min(CLASS_SPEC[nc].maxGrade, CLASS_SPEC[st.cls].maxGrade);
        st.cls = nc;
        this.commit(p, { pieces: [{ len: taper + 20, k0: 0, k1: 0 }], type: 'straight', zones: [{ a: -40, b: taper + 60, cap: strict }], hard: false });
        return;
      }
    }
    // fork?
    if (st.phase === 'flow' && p.length >= st.nextForkAt) {
      if (this.tryFork(p)) return;
      st.nextForkAt = p.length + 300;
    }
    let pr: Proposal | null = null;
    st.near = st.near.filter((n) => n.until > p.length);
    const hw = kerbHalfWidth(st.cls), r = hw + ROADSIDE;
    for (let tries = 0; tries < 12; tries++) {
      const cand = st.phase === 'tech' && tries < 8 ? this.proposeTech(p, st, tries) : this.proposeFlow(p, st, tries);
      const sim = this.simulate(tip.x, tip.z, tip.h, cand.pieces);
      if (!this.headingOk(sim.h)) { this.stats.rejected++; continue; }
      if (!cand.hard && Math.abs(wrapAngle(sim.h)) > BAND - 5 * DEG) { this.stats.rejected++; continue; }
      // a doubled-back pair runs beside the road just built: that adjacency is allowed
      const near = cand.eventPre ? [...st.near, { s0: p.length - cand.eventPre, s1: p.length, until: 0 }] : st.near;
      if (!this.fits(p, sim.pts, p.length, hw, r, cand.hard ? 0.75 : 1, near)) { this.stats.rejected++; continue; }
      pr = cand;
      break;
    }
    if (!pr) pr = this.escape(p, st, hw, r);
    this.commit(p, pr);
    const len = pr.pieces.reduce((a, b) => a + b.len, 0);
    st.phaseLeft -= len;
    st.clsLeft -= len;
    if (pr.event) { st.techCount++; st.lastTech = pr.event.type; }
    if (st.phaseLeft <= 0) {
      if (st.phase === 'flow') { st.phase = 'tech'; st.phaseLeft = st.rng.range(180, 650); }
      else { st.phase = 'flow'; st.phaseLeft = st.rng.range(550, 1700); }
    }
  }

  /**
   * Nothing normal fits: steer toward open space. Headings fan out from the target heading;
   * first with the roadside rule, then with only the hard (kerbs never touch) rule.
   */
  private escape(p: Path, st: GenState, hw: number, r: number): Proposal {
    this.stats.fallbacks++;
    const tip = p.tip();
    const tgt = this.targetHeading(p);
    const Rmin = st.cls === 'arterial' ? 300 : st.cls === 'avenue' ? 180 : 110;
    for (const scale of [1, 0.75, 0.5, 0]) {
      for (let i = 0; i <= 14; i++) {
        const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 10 * DEG;
        const hTarget = clamp(tgt + off, -BAND, BAND);
        const th = wrapAngle(hTarget - tip.h);
        for (const R of [Rmin * 1.5, Rmin]) {
          const pcs = Math.abs(th) > 2 * DEG ? this.turn(th, R, Math.min(40, R / 4)) : [];
          pcs.push({ len: 50, k0: 0, k1: 0 });
          const sim = this.simulate(tip.x, tip.z, tip.h, pcs);
          if (!this.fits(p, sim.pts, p.length, hw, r, scale, st.near)) continue;
          const len = pcs.reduce((a, b) => a + b.len, 0);
          return { pieces: pcs, type: 'sweeper', zones: [{ a: 0, b: len }], hard: false };
        }
      }
    }
    // boxed in (never expected): keep going straight and let the checks report it
    this.stats.stuck++;
    st.stuck++;
    return { pieces: [{ len: 40, k0: 0, k1: 0 }], type: 'straight', zones: [{ a: 0, b: 40 }], hard: false };
  }

  // -------------------------------------------------------------------- forks ------------

  private tryFork(p: Path): boolean {
    const st = p.gen as GenState;
    const rng = st.rng;
    const tip = p.tip();
    // pick branch classes
    const opts: [RoadClass, RoadClass][] =
      st.cls === 'arterial' ? [['avenue', 'avenue'], ['arterial', 'avenue'], ['avenue', 'arterial']]
        : st.cls === 'avenue' ? [['avenue', 'back'], ['back', 'avenue'], ['back', 'back'], ['avenue', 'avenue']]
          : [['back', 'back']];
    const [cL, cR] = rng.pick(opts);
    const WL = 2 * kerbHalfWidth(cL), WR = 2 * kerbHalfWidth(cR);
    const half = (WL + WR) / 2;
    // destinations: districts ahead-left and ahead-right
    const here = this.districts.districtAt(tip.x, tip.z);
    const cand: { d: District; ang: number; dist: number }[] = [];
    const ci = Math.floor(tip.x / 2100), cj = Math.floor(tip.z / 2100);
    for (let di = -2; di <= 2; di++) for (let dj = 0; dj <= 3; dj++) {
      const d = this.districts.cell(ci + di, cj + dj);
      if (d.i === here.i && d.j === here.j) continue;
      const dist = Math.hypot(d.x - tip.x, d.z - tip.z);
      if (dist < 900 || dist > 5200) continue;
      const ang = Math.atan2(d.x - tip.x, d.z - tip.z); // absolute heading to it
      if (Math.abs(ang) > BAND) continue;
      cand.push({ d, ang, dist });
    }
    const h = tip.h;
    const leftC = cand.filter((c) => wrapAngle(c.ang - h) > 8 * DEG).sort((a, b) => a.dist - b.dist);
    const rightC = cand.filter((c) => wrapAngle(c.ang - h) < -8 * DEG).sort((a, b) => a.dist - b.dist);
    let dL = leftC.find((c) => true)?.d, dR = rightC.find((c) => !dL || c.d.place.jp !== dL.place.jp)?.d;
    if (!dL || !dR || dL.place.jp === dR.place.jp) return false;
    // junction approach: straight, gentle grade, sign 220 m before the split
    const approach = 280;
    const hwT = kerbHalfWidth(st.cls);
    const sim = this.simulate(tip.x, tip.z, tip.h, [{ len: approach, k0: 0, k1: 0 }]);
    if (!this.fits(p, sim.pts, p.length, Math.max(hwT, half), Math.max(hwT, half) + ROADSIDE, 1, st.near)) return false;
    // both branch openings (and some room beyond them) must fit too, before anything is committed
    const open = [1, -1].map((d) => {
      const R = rng.range(170, 260);
      const th = rng.range(16, 26) * DEG * d;
      return [{ len: 6, k0: 0, k1: 0 }, ...this.turn(th, R, 55)];
    });
    const lx0 = Math.cos(sim.h), lz0 = -Math.sin(sim.h);
    for (const [i, cls] of [[0, cL], [1, cR]] as [number, RoadClass][]) {
      const off = i === 0 ? WR / 2 : -WL / 2;
      const o = this.simulate(sim.x + lx0 * off, sim.z + lz0 * off, sim.h, [...open[i], { len: 260, k0: 0, k1: 0 }]);
      const hb = kerbHalfWidth(cls);
      if (!this.fits(p, o.pts, p.length + approach, hb, hb + ROADSIDE, 1, st.near)) return false;
    }
    this.commit(p, { pieces: [{ len: approach, k0: 0, k1: 0 }], type: 'straight', zones: [{ a: -60, b: approach + 60, cap: 0.04, intent: 'flat' }], hard: false });
    const sFork = p.length;
    p.junctionEnd = { s0: sFork - 75, s1: sFork, halfL: half, halfR: -half };
    p.forkS = sFork;
    const end = p.tip();
    const lx = Math.cos(end.h), lz = -Math.sin(end.h);
    const left = new Path(end.x + lx * (WR / 2), end.z + lz * (WR / 2), end.h, cL);
    const right = new Path(end.x - lx * (WL / 2), end.z - lz * (WL / 2), end.h, cR);
    for (const [b, side] of [[left, 1], [right, -1]] as [Path, 1 | -1][]) {
      b.parent = p;
      b.side = side;
      p.children.push(b);
      this.net.add(b);
    }
    // elevation continues from the trunk at the fork
    const pe = { z: 0, g: 0, k: 0 };
    this.extendProfile(p, true);
    p.profile.eval(sFork, pe);
    this.initState(left, cL, pe.z, pe.g);
    this.initState(right, cR, pe.z, pe.g);
    const sl = left.gen as GenState, sr = right.gen as GenState;
    sl.target = dL; sr.target = dR;
    sl.sector = [wrapAngle(h + 12 * DEG), BAND - 6 * DEG];
    sr.sector = [-BAND + 6 * DEG, wrapAngle(h - 12 * DEG)];
    sl.sectorUntil = sr.sectorUntil = 2200;
    sl.nextForkAt = rng.range(2800, 4400);
    sr.nextForkAt = rng.range(2800, 4400);
    sl.phase = sr.phase = 'flow';
    sl.phaseLeft = rng.range(500, 900);
    sr.phaseLeft = rng.range(500, 900);
    // the profile through the junction is shared and flat-ish
    for (const [i, b] of [left, right].entries()) {
      const bs = b.gen as GenState;
      bs.zones.push({ s0: 0, s1: 140, cap: 0.04, intent: 'flat' });
      // opening: diverge with opposite clothoids
      const pcs = open[i];
      this.commit(b, { pieces: pcs, type: 'sweeper', zones: [{ a: 0, b: pcs.reduce((x, y) => x + y.len, 0) }], hard: false });
    }
    // junction details: gore nose and midline between the branches
    this.setupJunction(left, right);
    const fi: ForkInfo = { trunk: p, s: sFork, left, right, signS: sFork - 220, district: here, destL: dL, destR: dR, committed: 0 };
    this.forks.push(fi);
    st.pendingFork = false;
    return true;
  }

  private setupJunction(left: Path, right: Path) {
    // walk along the left branch; the midline is half the distance to the right branch
    const n = 160;
    const midL = new Float32Array(n), midR = new Float32Array(n);
    const pa = { x: 0, z: 0, h: 0, k: 0 }, pb = { x: 0, z: 0, h: 0, k: 0 };
    let nose = n - 1;
    const xsA: any = {}, xsB: any = {};
    for (let s = 0; s < n; s++) {
      left.pointAt(s, pa);
      right.pointAt(s, pb);
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      // lateral distance of right branch centre in left's frame (negative = to the right)
      const tl = dx * Math.cos(pa.h) - dz * Math.sin(pa.h);
      const tr = -dx * Math.cos(pb.h) + dz * Math.sin(pb.h);
      midL[s] = tl / 2;
      midR[s] = tr / 2;
      const kL = left.xsAt(s, xsA), kR = right.xsAt(s, xsB);
      // gap between the inner kerbs of the two branches
      const sep = Math.abs(tl) - Math.abs(kL.kerbR) - kR.kerbL;
      if (sep >= 1.5 && nose === n - 1) nose = s;
    }
    left.junctionStart = { nose, inner: -1, mid: midL, stopLine: Math.max(8, nose - 4) };
    right.junctionStart = { nose, inner: 1, mid: midR, stopLine: null };
  }

  /** Mark a fork's branch as taken; the other stops growing (it is trimmed when out of view). */
  commitFork(f: ForkInfo, side: 1 | -1) {
    if (f.committed === side) return;
    f.committed = side;
    const take = side === 1 ? f.left : f.right;
    const drop = side === 1 ? f.right : f.left;
    (take.gen as GenState).stopped = false;
    take.alive = true;
    (drop.gen as GenState).stopped = true;
    drop.alive = false;
  }

  // ------------------------------------------------------------------- profile -----------

  /** Extend the vertical profile over newly planned road. `toEnd` finalises up to the plan end. */
  extendProfile(p: Path, toEnd = false) {
    const st = p.gen as GenState;
    const spec = () => CLASS_SPEC[p.clsAt(st.sLast + 1)];
    const limit = toEnd ? p.length + 1 : p.length - 100;
    let guard = 0;
    while (st.sLast < limit && guard++ < 500) {
      const sp = spec();
      const rng = st.rng;
      // segment length; snap to the next cap change so curves land outside capped zones
      let D = rng.range(sp.vpiMin, sp.vpiMax);
      const s0 = st.sLast;
      const zoneAt = (s: number) => st.zones.find((z) => s >= z.s0 && s < z.s1);
      const z0 = zoneAt(s0 + 1);
      // boundaries of zones that start ahead
      let snap = Infinity;
      for (const z of st.zones) {
        if (z.s0 > s0 + 20 && z.s0 < s0 + D + 30) snap = Math.min(snap, z.s0);
        if (z.s1 > s0 + 20 && z.s1 < s0 + D + 30 && z.cap < sp.maxGrade) snap = Math.min(snap, z.s1);
      }
      if (snap < Infinity) D = Math.max(18, snap - s0);
      if (toEnd) D = Math.min(D, Math.max(18, p.length + 1 - s0));
      // only decide a grade once the plan (classes, zones) is known past the segment and its curves
      else if (s0 + D + 100 > p.length) break;
      // grade cap over the segment, with room for the vertical curves at both ends (a curve's grade
      // lies between its two segments' grades, so a cap must cover the curve's half-length too)
      let cap = sp.maxGrade;
      const mz = sp.vcMax / 2 + 6;
      for (const z of st.zones) if (z.s1 > s0 - mz && z.s0 < s0 + D + mz) cap = Math.min(cap, z.cap);
      for (let s = s0 - 90; s <= s0 + D + 90; s += 5) cap = Math.min(cap, CLASS_SPEC[p.clsAt(s)].maxGrade);
      const intent = (zoneAt(s0 + D / 2)?.intent ?? z0?.intent ?? 'free') as Intent;
      // a branch's first segment continues the trunk's grade through the junction (no kink)
      const firstOfBranch = p.parent !== null && p.profile.vpis.length === 1;
      if (firstOfBranch) D = Math.max(D, 150);
      // choose the new grade
      const zNow = st.zLast;
      if (Math.abs(zNow - st.zT) < 6 || rng.chance(0.05)) st.zT = zNow > 5 ? rng.range(-48, -8) : rng.range(15, 52);
      let g: number;
      switch (intent) {
        case 'climb': g = cap * rng.range(0.8, 1); break;
        case 'descend': g = -cap * rng.range(0.8, 1); break;
        case 'flat': g = rng.range(-0.25, 0.25) * cap; break;
        case 'roll': g = rng.range(-0.6, 0.6) * cap; break;
        default: {
          const want = (st.zT - zNow) / D;
          // back streets love a crest: alternate steep up and down for blind crests and dips
          if (sp.maxGrade >= 0.1 && rng.chance(0.55)) g = (st.gLast > 0 ? -1 : 1) * cap * rng.range(0.6, 1);
          else g = clamp(want + rng.range(-0.3, 0.3) * cap, -cap, cap);
        }
      }
      if (intent === 'climb' || intent === 'descend') {
        // switchbacks climb toward the elevation target; flip if it would leave the range
        const dirWanted = st.zT > zNow ? 1 : -1;
        if (Math.sign(g) !== dirWanted && Math.abs(zNow) > 35) g = -g;
      }
      g = clamp(g, -cap, cap);
      if (firstOfBranch) g = st.gLast;
      // keep the elevation in range
      const zN = zNow + g * D;
      if (!firstOfBranch) {
        if (zN > 58) g = (58 - zNow) / D;
        if (zN < -52) g = (-52 - zNow) / D;
        g = clamp(g, -cap, cap);
      }
      // limit the grade change at the VPI
      const dg = clamp(g - st.gLast, -sp.maxDeltaGrade, sp.maxDeltaGrade);
      g = st.gLast + dg;
      // vertical curve at the current last VPI (between gLast and g)
      const last = p.profile.vpis[p.profile.vpis.length - 1];
      if (p.profile.vpis.length >= 2) {
        const zc = zoneAt(s0);
        let vcMax = Math.min(sp.vcMax, zc?.vcMax ?? 1e9);
        let L = rng.range(sp.vcMin, Math.max(sp.vcMin, vcMax));
        // sharp crests on back streets (air!), gentle on wide roads
        if (sp.maxGrade >= 0.1 && st.gLast > 0.05 && g < -0.03 && rng.chance(0.6)) L = rng.range(11, 17);
        // vertical curves must fit inside both neighbouring segments
        L = Math.min(L, 0.96 * Math.min(st.dLast, D));
        // a curve must also be long enough for its grade change to be smooth (≥ 50 m per unit grade·... )
        L = Math.max(L, Math.min(0.96 * Math.min(st.dLast, D), Math.abs(g - st.gLast) * 55));
        last.L = L;
      }
      const vp = { s: s0 + D, z: zNow + g * D, L: 0 };
      p.profile.add(vp);
      st.sLast = vp.s;
      st.zLast = vp.z;
      st.dLast = D;
      st.gLast = g;
      // drop consumed zones
      while (st.zones.length && st.zones[0].s1 < s0 - 200) st.zones.shift();
    }
  }

  /** Arc length up to which a path's profile is final (curves at the last VPI not yet fixed). */
  finalEnd(p: Path): number {
    const v = p.profile.vpis;
    if (v.length < 2) return 0;
    const st = p.gen as GenState;
    return v[v.length - 1].s - 0.5 * st.dLast;
  }
}
