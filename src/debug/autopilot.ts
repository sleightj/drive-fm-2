import { Car, CarInput } from '../vehicle/car';
import { Path } from '../road/path';
import { RoadStream } from '../road/stream';
import { CrossSection, laneCenter } from '../road/types';
import { Rng } from '../core/rng';
import { clamp, wrapAngle } from '../core/math';

/**
 * A test driver: keeps to the leftmost outbound lane, slows for bends it can see coming
 * (lateral acceleration limit with braking distance), and picks a random branch at every
 * fork. Used by the long-drive and perf harnesses; never by the game itself.
 */
const _xs: CrossSection = { kerbL: 0, kerbR: 0, median: 0, hatch: 0, laneW: 0, lanesOut: 0, lanesIn: 0, margin: 0, crown: 0, cls: 'back', clsBlend: 1, fromCls: 'back' };
const _pt = { x: 0, z: 0, h: 0, k: 0 };

export class Autopilot {
  private rng: Rng;
  private choice = new Map<Path, Path>();
  maxSpeed = 30; // m/s cap (≈ top speed)
  aLat = 6.0;
  aBrake = 7.5;
  boostOnStraights = true;

  constructor(public stream: RoadStream, seed = 1) {
    this.rng = new Rng(seed * 9973 + 7);
  }

  /** The branch this driver will take at the end of `p` (decided once). */
  next(p: Path): Path | null {
    if (p.forkS === null) return null;
    let c = this.choice.get(p);
    if (!c) {
      const f = this.stream.forkOf(p);
      if (!f) return null;
      c = this.rng.chance(0.5) ? f.left : f.right;
      this.choice.set(p, c);
      if (this.choice.size > 64) this.choice.delete(this.choice.keys().next().value!);
    }
    return c;
  }

  /** Point on the route `d` metres ahead of (p, s): follows the chosen branches. */
  private ahead(p: Path, s: number, d: number): { p: Path; s: number } {
    let q = p, ss = s + d;
    for (let i = 0; i < 4; i++) {
      if (q.forkS !== null && ss > q.forkS) {
        const n = this.next(q);
        if (!n) { ss = q.forkS; break; }
        ss -= q.forkS;
        q = n;
      } else break;
    }
    return { p: q, s: Math.min(ss, q.sampleEnd) };
  }

  private laneT(p: Path, s: number): number {
    p.xsAt(s, _xs);
    return laneCenter(_xs, 1, Math.max(0, _xs.lanesOut - 1));
  }

  drive(car: Car): CarInput {
    const loc = car.loc;
    const inp: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    if (!loc.path) return inp;
    const v = Math.max(0, car.speed);
    // pure pursuit on the lane centre
    const L = 7 + v * 0.55;
    const a = this.ahead(loc.path, loc.s, L);
    const t = this.laneT(a.p, a.s);
    a.p.worldXZ(a.s, t, _pt);
    const dx = _pt.x - car.x, dz = _pt.z - car.z;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const lx = Math.cos(car.yaw), lz = -Math.sin(car.yaw);
    const yLocal = dx * lx + dz * lz, xLocal = dx * fx + dz * fz;
    const ang = Math.atan2(2 * car.spec.wheelbase * yLocal, xLocal * xLocal + yLocal * yLocal);
    const maxSteer = 0.56 + (0.12 - 0.56) * clamp(v / 31, 0, 1);
    inp.steer = clamp(ang / maxSteer, -1, 1);
    // if pointing far from the road direction (after a knock), steer hard back
    a.p.pointAt(a.s, _pt);
    const err = wrapAngle(_pt.h - car.yaw);
    if (Math.abs(err) > 1.2) inp.steer = Math.sign(err);
    // speed: curvature ahead with braking distance
    let vAllow = this.maxSpeed;
    for (let d = 0; d <= 160; d += 4) {
      const q = this.ahead(loc.path, loc.s, d);
      q.p.pointAt(q.s, _pt);
      const k = Math.abs(_pt.k);
      const vk = k > 1e-4 ? Math.sqrt(this.aLat / k) : this.maxSpeed;
      vAllow = Math.min(vAllow, Math.sqrt(vk * vk + 2 * this.aBrake * Math.max(0, d - 6)));
    }
    const e = vAllow - v;
    if (e > 0.5) inp.throttle = clamp(e / 4, 0.25, 1);
    else if (e < -1) inp.brake = clamp(-e / 6, 0.1, 1);
    else inp.throttle = 0.25;
    if (this.boostOnStraights && vAllow >= this.maxSpeed - 0.1 && car.boost > 0.6 && v > 15) inp.boost = true;
    if (car.speed < -0.5) { inp.brake = 0; inp.throttle = 1; }
    return inp;
  }
}
