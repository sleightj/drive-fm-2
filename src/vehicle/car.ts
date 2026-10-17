import { RoadSurface, Loc } from '../road/surface';
import { Path } from '../road/path';
import { clamp, lerp, wrapAngle } from '../core/math';

/**
 * The player's car. Arcade with weight: a planar tyre model on four wheels (grip from each
 * wheel's suspension load, a slip-angle curve with a long plateau so drifts hold), engine and
 * brakes tuned to the handling targets in docs/DESIGN.md §4, and a vertical model (heave,
 * pitch, roll on four spring-dampers) that rides the road's real surface: crests launch it,
 * potholes drop wheels in, landings compress. A wear hit can never spin the car: the yaw
 * kick a single wheel's load change can cause is limited.
 */

export interface CarInput {
  steer: number; // -1 right .. +1 left
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, or reverse when stopped)
  handbrake: boolean;
  boost: boolean;
}

export interface CarSpec {
  mass: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  cgHeight: number;
  length: number;
  width: number;
}

export const HERO_SPEC: CarSpec = { mass: 1250, wheelbase: 2.6, track: 1.5, wheelRadius: 0.31, cgHeight: 0.48, length: 4.34, width: 1.76 };

const G = 9.81;
// suspension
const REST = 0.34; // spring length at full droop (mount → wheel centre)
const SAG = 0.1;
// tyres
const MU_LAT = 1.18;
const MU_LONG = 1.28;
const ALPHA_PEAK = 0.12; // rad
// engine
const ACC0 = 4.7; // m/s² at low speed (traction-limited launch)
const VTOP = 31.6; // governor knee (≈ 110 km/h top with drag)
const VTOP_BOOST = 40.5; // ≈ 140 km/h
const VREV = 6.4; // reverse top ≈ 23 km/h
const DRAG = 0.36 / 1250; // per kg: a_drag = DRAG * v²  (k = 0.36 N/(m/s)²)
const ROLL = 0.11; // m/s² rolling resistance

export interface WheelState {
  // body-frame mount
  mx: number;
  mz: number;
  front: boolean;
  left: boolean;
  // state
  compression: number; // m (0 = full droop)
  contact: boolean;
  load: number; // N (spring + damper)
  loadSmooth: number; // N, low-passed: grip follows this so bumps can't kick the yaw
  groundY: number;
  wearY: number; // wear part of the ground under the wheel
  spin: number; // wheel angle (rad) for the visuals
  steer: number;
  slip: number; // |slip| for effects
  loc: Loc;
}

const _end = { nx: 0, nz: 0 };
export class Car {
  // planar state (world)
  x = 0;
  z = 0;
  yaw = 0; // heading: forward = (sin yaw, cos yaw)
  vx = 0;
  vz = 0;
  yawRate = 0;
  // vertical state
  y = 0; // height of the body reference (wheel mounts) above world 0
  vy = 0;
  pitch = 0; // nose up positive
  pitchRate = 0;
  roll = 0; // left side up positive
  rollRate = 0;
  // derived
  speed = 0; // signed forward speed
  slipAngle = 0; // body slip (rad)
  airTime = 0;
  lastAir = 0; // duration of the last completed jump
  airborne = false;
  steerAngle = 0;
  /** 0..1: how far into a held drift the car is (loosens the rear, lighter assist) */
  drift = 0;
  wheels: WheelState[];
  boost = 0; // meter 0..1
  boosting = false;
  boostTime = 0;
  /** accelerations (for the visual springs, camera and rumble) */
  aLong = 0;
  aLat = 0;
  impact = 0; // collision/landing impulse this step (m/s), for rumble
  bump = 0; // wear bump intensity this step
  wallHit = 0;
  /** where the car is on the road */
  loc: Loc = { path: null as any, s: 0, t: 0, out: 0, inside: true, side: 0 };
  onRoad = true;
  // tuning
  private k: number;
  private c: number;
  private Iyaw: number;
  private Ipitch: number;
  private Iroll: number;
  private prevVLong = 0;
  private prevVLat = 0;
  /** total distance driven (m) */
  odometer = 0;
  stats = { wearGain: 0, airGain: 0, wallHits: 0, maxYawKick: 0 };

  constructor(public surf: RoadSurface, public spec: CarSpec = HERO_SPEC) {
    const m = spec.mass;
    this.k = (m * G) / 4 / SAG;
    this.c = 2 * 0.38 * Math.sqrt(this.k * (m / 4));
    const L = spec.length, W = spec.width, H = 1.3;
    this.Iyaw = (m * (L * L + W * W)) / 12;
    this.Ipitch = (m * (L * L + H * H)) / 12;
    this.Iroll = (m * (W * W + H * H)) / 12;
    const a = spec.wheelbase / 2, b = spec.track / 2;
    const mk = (mx: number, mz: number, front: boolean, left: boolean): WheelState => ({
      mx, mz, front, left, compression: SAG, contact: true, load: (m * G) / 4, loadSmooth: (m * G) / 4, groundY: 0, wearY: 0, spin: 0, steer: 0, slip: 0,
      loc: { path: null as any, s: 0, t: 0, out: 0, inside: true, side: 0 },
    });
    // order matches the model: FL, FR, RL, RR (left = +x in the body frame)
    this.wheels = [mk(b, a, true, true), mk(-b, a, true, false), mk(b, -a, false, true), mk(-b, -a, false, false)];
  }

  /** Place the car at (path, s, t), facing along the road, at rest. */
  place(p: Path, s: number, t: number, speed = 0) {
    const w = this.surf.world(p, s, t, { x: 0, y: 0, z: 0 });
    const pt = { x: 0, z: 0, h: 0, k: 0 };
    p.pointAt(s, pt);
    this.x = w.x; this.z = w.z; this.yaw = pt.h;
    this.vx = Math.sin(pt.h) * speed; this.vz = Math.cos(pt.h) * speed;
    this.yawRate = 0;
    this.y = w.y + this.spec.wheelRadius + (REST - SAG);
    this.vy = 0; this.pitch = 0; this.pitchRate = 0; this.roll = 0; this.rollRate = 0;
    this.loc.path = p; this.loc.s = s; this.loc.t = t;
    for (const wh of this.wheels) { wh.loc.path = p; wh.loc.s = s; wh.loc.t = t; wh.compression = SAG; wh.load = wh.loadSmooth = (this.spec.mass * G) / 4; }
    this.airTime = 0;
    this.airborne = false;
  }

  /** World position of a body-frame point (x left, y up, z forward), small-angle pitch/roll. */
  bodyToWorld(bx: number, by: number, bz: number, out: { x: number; y: number; z: number }) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    out.x = this.x + c * bx + s * bz;
    out.z = this.z - s * bx + c * bz;
    out.y = this.y + by + bz * Math.sin(this.pitch) + bx * Math.sin(this.roll);
    return out;
  }

  private groundUnder(w: WheelState, wx: number, wz: number): boolean {
    const found = this.surf.locate(wx, wz, w.loc, w.loc);
    if (!found) return false;
    const p = w.loc.path;
    const R = this.spec.wheelRadius;
    // wheel-radius envelope along the rolling direction: the tyre bridges small holes
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const pt = { x: 0, z: 0, h: 0, k: 0 };
    p.pointAt(w.loc.s, pt);
    const along = fx * Math.sin(pt.h) + fz * Math.cos(pt.h); // cos of angle between car and road
    let best = -Infinity, bestWear = 0;
    const base = this.surf.baseHeight(p, w.loc.s, w.loc.t);
    for (const dx of [-0.24, -0.12, 0, 0.12, 0.24]) {
      const ds = dx * along;
      const wear = this.surf.wearAt(p, w.loc.s + ds, w.loc.t);
      const h = wear + Math.sqrt(R * R - dx * dx) - R;
      if (h > best) { best = h; bestWear = wear; }
    }
    w.groundY = base + best;
    w.wearY = bestWear;
    return true;
  }

  step(dt: number, inp: CarInput) {
    const sp = this.spec;
    const m = sp.mass;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward / left unit vectors (world)
    const fx = sy, fz = cy, lx = cy, lz = -sy;
    const vLong = this.vx * fx + this.vz * fz;
    const vLat = this.vx * lx + this.vz * lz;
    this.speed = vLong;
    const v = Math.hypot(this.vx, this.vz);

    // ---- steering: speed-sensitive lock, rate-limited, with drift counter-steer assist
    const maxSteer = lerp(0.56, 0.12, clamp(Math.abs(vLong) / 31, 0, 1));
    this.slipAngle = v > 2 ? Math.atan2(vLat, Math.abs(vLong)) : 0;
    let target = inp.steer * maxSteer;
    // drift state: a handbrake flick or power at a slip angle starts it; lifting ends it
    const thr0 = clamp(inp.throttle, 0, 1);
    const wantDrift = v > 8 && vLong > 0 && ((inp.handbrake && Math.abs(inp.steer) > 0.3) || (Math.abs(this.slipAngle) > 0.14 && thr0 > 0.45));
    const keep = this.drift > 0 && v > 6 && thr0 > 0.25 && Math.abs(this.slipAngle) > 0.07;
    this.drift = clamp(this.drift + (wantDrift || keep ? 4 : -2.5) * dt, 0, 1);
    // assist: steer the fronts toward the direction of travel when the rear is out
    if (v > 6 && vLong > 0) target += clamp(this.slipAngle * (0.55 - 0.25 * this.drift), -0.35, 0.35);
    const rate = 2.8;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);

    // ---- suspension and loads
    const tmp = { x: 0, y: 0, z: 0 };
    let anyContact = false;
    let Fy = 0, Mp = 0, Mr = 0;
    let wearSignal = 0;
    for (const w of this.wheels) {
      this.bodyToWorld(w.mx, 0, w.mz, tmp);
      const prevWear = w.wearY;
      const found = this.groundUnder(w, tmp.x, tmp.z);
      // wheel centre hangs REST below the mount at full droop
      const reach = tmp.y - REST - sp.wheelRadius; // tyre bottom at full droop
      const prevC = w.compression;
      let comp = found ? w.groundY - reach : -1;
      if (comp > 0) {
        if (comp > REST - 0.04) {
          // bump stop
          comp = REST - 0.04 + (comp - (REST - 0.04)) * 0.2;
        }
        const vel = (comp - prevC) / dt;
        let F = this.k * comp + this.c * vel;
        if (comp > REST - 0.06) F += (comp - (REST - 0.06)) * this.k * 6;
        F = Math.max(0, F);
        w.contact = true;
        w.compression = comp;
        w.load = F;
        anyContact = true;
      } else {
        w.contact = false;
        w.compression = 0;
        w.load = 0;
      }
      // grip follows a smoothed load (≈ 60 ms): a pothole can't yank the car sideways
      w.loadSmooth += (w.load - w.loadSmooth) * Math.min(1, dt / 0.06);
      if (w.contact) wearSignal += Math.abs(w.wearY - prevWear);
      Fy += w.load;
      Mp += w.load * w.mz; // positive load at the front pitches the nose up
      Mr += w.load * w.mx; // positive load on the left rolls left-up
    }

    // ---- tyre forces (planar)
    let Fx = 0, Fz = 0, Mz = 0;
    const throttle = clamp(inp.throttle, 0, 1);
    const brake = clamp(inp.brake, 0, 1);
    // reverse: brake held while (nearly) stopped
    const reversing = brake > 0.1 && throttle < 0.1 && vLong < 0.8;
    // engine acceleration (per kg), governed toward the top speed
    const vt = this.boosting ? VTOP_BOOST : VTOP;
    let aEng = 0;
    if (throttle > 0 && vLong > -1) aEng = throttle * ACC0 * clamp(1 - Math.pow(Math.max(0, vLong) / vt, 3.5), 0, 1);
    if (reversing) aEng = -brake * 3.2 * clamp(1 - Math.pow(Math.max(0, -vLong) / VREV, 3), 0, 1);
    if (this.boosting) aEng += 5.0 * Math.exp(-this.boostTime / 1.6) + 1.2;
    const driveF = aEng * m;
    const brakeF = !reversing && vLong > 0.2 ? brake * MU_LONG * m * G : 0;
    let frontLoad = 1e-3, rearLoad = 1e-3;
    for (const w of this.wheels) if (w.contact) { if (w.front) frontLoad += w.loadSmooth; else rearLoad += w.loadSmooth; }
    for (const w of this.wheels) {
      if (!w.contact) { w.slip = 0; continue; }
      const N = w.loadSmooth;
      const steer = w.front ? this.steerAngle : 0;
      w.steer = steer;
      // wheel heading
      const wh = this.yaw + steer;
      const wfx = Math.sin(wh), wfz = Math.cos(wh), wlx = Math.cos(wh), wlz = -Math.sin(wh);
      // contact patch velocity: v + ω × r (planar)
      const rx = lx * w.mx + fx * w.mz, rz = lz * w.mx + fz * w.mz; // world offset of the wheel
      const pvx = this.vx + this.yawRate * rz, pvz = this.vz - this.yawRate * rx;
      const vl = pvx * wfx + pvz * wfz;
      const vt2 = pvx * wlx + pvz * wlz;
      // longitudinal: drive (rear-biased), brakes (front-biased), handbrake on the rear
      // axle split by bias, each axle's share split between its wheels by load
      const share = N / (w.front ? frontLoad : rearLoad);
      let fLong = driveF * (w.front ? 0.35 : 0.65) * share;
      if (brakeF > 0) fLong -= Math.sign(vl) * brakeF * (w.front ? 0.6 : 0.4) * share;
      if (inp.handbrake && !w.front && Math.abs(vl) > 0.3) fLong -= Math.sign(vl) * 0.5 * N;
      // rolling to a stop gently when coasting at walking pace
      if (throttle === 0 && brake === 0 && Math.abs(vLong) < 1.5) fLong -= vl * N * 0.06;
      const muLong = MU_LONG * N;
      fLong = clamp(fLong, -muLong, muLong);
      // lateral: slip curve with a long plateau
      const alpha = Math.atan2(vt2, Math.max(Math.abs(vl), 1.5));
      const a = Math.abs(alpha);
      let f = a < ALPHA_PEAK ? Math.sin((a / ALPHA_PEAK) * Math.PI / 2) : 1 - 0.18 * clamp((a - ALPHA_PEAK) / 0.35, 0, 1);
      let mu = MU_LAT;
      if (!w.front && inp.handbrake) mu *= 0.42;
      else if (!w.front) mu *= 1 - 0.28 * this.drift;
      // power-over: lots of throttle at slip loosens the rear a little (drifts stay lit)
      if (!w.front && throttle > 0.6 && a > 0.12) mu *= 0.9;
      let fLat = -Math.sign(alpha) * f * mu * N;
      // low-speed damping so the car never jitters at rest
      if (Math.abs(vl) < 1.5) fLat = clamp(-vt2 * N * 0.6, -mu * N, mu * N);
      // friction circle: braking/drive eats lateral grip
      const lim = Math.max(muLong, mu * N);
      const tot = Math.hypot(fLong / MU_LONG, fLat / mu);
      if (tot > N && tot > 0) { const s = N / tot; fLong *= s; fLat *= s; void lim; }
      w.slip = a;
      const wfX = wfx * fLong + wlx * fLat, wfZ = wfz * fLong + wlz * fLat;
      Fx += wfX; Fz += wfZ;
      // yaw moment about the CG: r × F (y-component in our frame)
      Mz += rz * wfX - rx * wfZ;
    }
    // drag & rolling resistance
    if (v > 0.01) {
      const ad = DRAG * v * v + (anyContact ? ROLL : 0);
      Fx -= (this.vx / v) * ad * m;
      Fz -= (this.vz / v) * ad * m;
    }

    // ---- yaw: limit the kick (a wear impact may not spin the car) and keep drifts bounded
    let yawAcc = Mz / this.Iyaw;
    const yawCap = 9 + Math.abs(this.yawRate) * 2;
    if (Math.abs(yawAcc) > yawCap) { this.stats.maxYawKick = Math.max(this.stats.maxYawKick, Math.abs(yawAcc)); yawAcc = clamp(yawAcc, -yawCap, yawCap); }
    // beyond ~38° of body slip the car resists rotating further (no spins)
    const over = Math.abs(this.slipAngle) - 0.56;
    if (over > 0 && v > 5 && Math.sign(this.yawRate) === -Math.sign(this.slipAngle)) yawAcc -= Math.sign(this.yawRate) * over * 45;
    if (!anyContact) yawAcc = 0;
    this.yawRate += yawAcc * dt;
    if (anyContact) this.yawRate *= Math.exp(-dt * 0.4);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // ---- planar integration
    const ax = Fx / m, az = Fz / m;
    this.vx += ax * dt;
    this.vz += az * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // accelerations in the car frame (for springs and camera)
    const vLong2 = this.vx * fx + this.vz * fz, vLat2 = this.vx * lx + this.vz * lz;
    this.aLong = (vLong2 - this.prevVLong) / dt;
    this.aLat = (vLat2 - this.prevVLat) / dt + this.yawRate * vLong2;
    this.prevVLong = vLong2; this.prevVLat = vLat2;

    // ---- vertical: heave, pitch, roll
    const hcg = sp.cgHeight;
    // load transfer from planar acceleration acts through the CG height
    const transferP = m * (ax * fx + az * fz) * hcg * (anyContact ? 1 : 0);
    const transferR = m * (ax * lx + az * lz) * hcg * (anyContact ? 1 : 0);
    this.vy += (Fy / m - G) * dt;
    this.y += this.vy * dt;
    this.pitchRate += ((Mp + transferP) / this.Ipitch) * dt;
    this.rollRate += ((Mr + transferR) / this.Iroll) * dt;
    if (anyContact) { this.pitchRate *= Math.exp(-dt * 2.5); this.rollRate *= Math.exp(-dt * 2.5); }
    else { this.pitchRate *= Math.exp(-dt * 0.8); this.rollRate *= Math.exp(-dt * 1.5); }
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -0.45, 0.45);
    this.roll = clamp(this.roll + this.rollRate * dt, -0.35, 0.35);

    // ---- air
    this.impact = 0;
    if (!anyContact) {
      this.airTime += dt;
      this.airborne = this.airTime > 0.08;
    } else {
      if (this.airTime > 0.15) {
        this.lastAir = this.airTime;
        this.impact = Math.max(this.impact, Math.abs(this.vy) * 0.5 + this.airTime);
      }
      this.airTime = 0;
      this.airborne = false;
    }

    // ---- boost: charged by wear and air at speed, not by cornering or crawling
    const speedGate = clamp((v - 7) / (19.4 - 7), 0, 1);
    this.bump = wearSignal / dt;
    if (!this.boosting) {
      const gWear = wearSignal * 0.33 * speedGate;
      const gAir = !anyContact && v > 12 ? dt * 0.42 : 0;
      this.boost = clamp(this.boost + gWear + gAir, 0, 1);
      this.stats.wearGain += gWear; this.stats.airGain += gAir;
    }
    if (inp.boost && this.boost > 0.02 && !this.boosting && vLong > 3) { this.boosting = true; this.boostTime = 0; }
    if (this.boosting) {
      this.boostTime += dt;
      this.boost -= dt / 3.5;
      if (this.boost <= 0 || !inp.boost) { this.boosting = false; this.boost = Math.max(0, this.boost); }
    }

    // ---- walls: the kerb line, raised medians and gore islands are solid
    this.collideRoad();

    // ---- where we are
    this.surf.locate(this.x, this.z, this.loc, this.loc);
    for (const w of this.wheels) w.spin += (vLong / sp.wheelRadius) * dt * (w.contact || !inp.handbrake || w.front ? 1 : 0);
    this.odometer += v * dt;
  }

  /** Corner and side points of the body against the road's edges. */
  private collideRoad() {
    const L = this.spec.length / 2 - 0.05, W = this.spec.width / 2 - 0.04;
    const pts: [number, number][] = [[W, L], [-W, L], [W, -L], [-W, -L], [W, 0], [-W, 0], [W, L * 0.55], [-W, L * 0.55], [W, -L * 0.55], [-W, -L * 0.55], [0, L], [0, -L]];
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const lx = cy, lz = -sy, fx = sy, fz = cy;
    const loc: Loc = { path: this.loc.path, s: this.loc.s, t: this.loc.t, out: 0, inside: true, side: 0 };
    const pt = { x: 0, z: 0, h: 0, k: 0 };
    this.wallHit = 0;
    for (let iter = 0; iter < 2; iter++) {
      let worst = 0, wn = 0, wnx = 0, wnz = 0, wrx = 0, wrz = 0;
      for (const [bx, bz] of pts) {
        const rx = lx * bx + fx * bz, rz = lz * bx + fz * bz;
        const px = this.x + rx, pz = this.z + rz;
        if (!this.surf.locate(px, pz, loc, loc)) continue;
        // a closed road end is a wall across the road
        const e = this.surf.endDepth(loc.path!, loc.s, px, pz, _end);
        if (e > worst) { worst = e; wnx = _end.nx; wnz = _end.nz; wrx = rx; wrz = rz; wn = 1; }
        if (loc.inside || loc.side === 0) continue;
        if (loc.out > worst) {
          worst = loc.out;
          loc.path.pointAt(loc.s, pt);
          // inward normal: toward the band (side +1 = toward larger t = the path's left)
          wnx = Math.cos(pt.h) * loc.side; wnz = -Math.sin(pt.h) * loc.side;
          wrx = rx; wrz = rz; wn = 1;
        }
      }
      if (!wn) break;
      // push out
      const push = worst + 0.002;
      this.x += wnx * push; this.z += wnz * push;
      // velocity of the contact point
      const cvx = this.vx + this.yawRate * wrz, cvz = this.vz - this.yawRate * wrx;
      const vn = cvx * wnx + cvz * wnz;
      if (vn < 0) {
        const e = 0.15;
        // effective mass at the contact (planar rigid body)
        const rCrossN = wrz * wnx - wrx * wnz;
        const invM = 1 / this.spec.mass + (rCrossN * rCrossN) / this.Iyaw;
        const j = (-(1 + e) * vn) / invM;
        // friction along the wall
        const tx = -wnz, tz = wnx;
        const vt = cvx * tx + cvz * tz;
        const jt = clamp(-vt / invM, -0.35 * j, 0.35 * j);
        const Jx = wnx * j + tx * jt, Jz = wnz * j + tz * jt;
        this.vx += Jx / this.spec.mass;
        this.vz += Jz / this.spec.mass;
        this.yawRate += (wrz * Jx - wrx * Jz) / this.Iyaw * 0.6;
        this.wallHit = Math.max(this.wallHit, -vn);
        this.impact = Math.max(this.impact, -vn * 0.4);
        if (-vn > 1.5) this.stats.wallHits++;
      }
    }
  }

  /**
   * A contact with another body (a traffic car), solved like the walls in collideRoad(): one impulse
   * at the contact point (px, pz) along the unit normal (nx, nz), which points from the other body
   * toward this car, with restitution and friction, plus separation of the penetration `depth`
   * shared by inverse mass. Applies this car's share and writes the other body's: the impulse
   * (jx, jz) to add to it and how far (`push`) to move it along -n.
   */
  applyContact(
    px: number, pz: number, nx: number, nz: number, depth: number,
    o: { mass: number; inertia: number; x: number; z: number; vx: number; vz: number; yawRate: number },
    out: { jx: number; jz: number; push: number },
  ) {
    const m = this.spec.mass;
    const im = 1 / m, iom = 1 / o.mass;
    const share = im / (im + iom);
    this.x += nx * depth * share;
    this.z += nz * depth * share;
    out.push = depth * (1 - share);
    out.jx = 0; out.jz = 0;
    const rx = px - this.x, rz = pz - this.z, ox = px - o.x, oz = pz - o.z;
    // relative velocity of the two contact points
    const vrx = this.vx + this.yawRate * rz - (o.vx + o.yawRate * oz);
    const vrz = this.vz - this.yawRate * rx - (o.vz - o.yawRate * ox);
    const vn = vrx * nx + vrz * nz;
    if (vn >= 0) return;
    const e = 0.15;
    const rn = rz * nx - rx * nz, on = oz * nx - ox * nz;
    const invM = im + iom + (rn * rn) / this.Iyaw + (on * on) / o.inertia;
    const j = (-(1 + e) * vn) / invM;
    const tx = -nz, tz = nx;
    const jt = clamp(-(vrx * tx + vrz * tz) / invM, -0.3 * j, 0.3 * j);
    const Jx = nx * j + tx * jt, Jz = nz * j + tz * jt;
    this.vx += Jx * im;
    this.vz += Jz * im;
    this.yawRate += ((rz * Jx - rx * Jz) / this.Iyaw) * 0.6;
    this.impact = Math.max(this.impact, -vn * 0.4);
    out.jx = -Jx; out.jz = -Jz;
  }

  get kmh() { return Math.hypot(this.vx, this.vz) * 3.6; }
}
