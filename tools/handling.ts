/**
 * Handling numbers for the car, measured in Node on test roads (no rendering).
 *   npx tsx tools/handling.ts [--json out.json]
 * Each scenario builds a purpose-made path (flat straight, crest, pothole, wide pad) and drives
 * the real car model with scripted inputs at the game's 120 Hz step.
 */
import fs from 'node:fs';
import { Path } from '../src/road/path';
import { RoadNetwork } from '../src/road/network';
import { RoadSurface } from '../src/road/surface';
import { WearField, WearFeature } from '../src/road/wear';
import { Car, CarInput } from '../src/vehicle/car';
import { CrossSection, RoadClass } from '../src/road/types';

const DT = 1 / 120;
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';

class TestWear extends WearField {
  feats: WearFeature[] = [];
  constructor() { super(1, () => 'suburbs'); }
  chunk(_p: Path, ci: number) { return { ci, intensity: 0, features: this.feats, rut0: 0, rut1: 0 }; }
}

function road(cls: RoadClass, len: number, vpis: { s: number; z: number; L: number }[], wide = 0) {
  const p = new Path(0, 0, 0, cls);
  p.addPiece(len, 0, 0);
  for (const v of vpis) p.profile.add(v);
  p.gen = { stopped: true };
  if (wide) {
    const orig = p.xsAt.bind(p);
    p.xsAt = (s: number, out: CrossSection) => { orig(s, out); out.kerbL = wide; out.kerbR = -wide; out.median = 0; out.hatch = 0; return out; };
  }
  const net = new RoadNetwork();
  net.add(p);
  net.index(p);
  const wear = new TestWear();
  const surf = new RoadSurface(net, wear);
  return { p, net, wear, surf };
}

const flat = (len: number) => [{ s: 0, z: 0, L: 0 }, { s: len, z: 0, L: 0 }];
const input = (o: Partial<CarInput> = {}): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...o });

const results: Record<string, any> = {};

// 1. top speed and 0–100
{
  const { p, surf } = road('arterial', 6000, flat(6000));
  const car = new Car(surf);
  car.place(p, 20, 5.5);
  let t = 0, t100 = -1, vmax = 0;
  while (t < 70) {
    car.step(DT, input({ throttle: 1 }));
    t += DT;
    const v = car.kmh;
    if (t100 < 0 && v >= 100) t100 = t;
    vmax = Math.max(vmax, v);
  }
  results.topSpeedKmh = +vmax.toFixed(1);
  results.zeroTo100s = +t100.toFixed(2);
}
// 2. braking 100–0
{
  const { p, surf } = road('arterial', 3000, flat(3000));
  const car = new Car(surf);
  car.place(p, 20, 5.5, 100 / 3.6);
  for (let i = 0; i < 30; i++) car.step(DT, input({ throttle: 0.3 }));
  // re-set speed exactly 100 at the start of braking
  const v0 = car.kmh;
  const x0 = car.x, z0 = car.z;
  let t = 0;
  while (car.kmh > 0.5 && t < 10) { car.step(DT, input({ brake: 1 })); t += DT; }
  results.brake100m = +(Math.hypot(car.x - x0, car.z - z0) * (100 / v0) ** 2).toFixed(1);
}
// 3. reverse
{
  const { p, surf } = road('arterial', 2000, flat(2000));
  const car = new Car(surf);
  car.place(p, 1000, 5.5);
  let vmin = 0;
  for (let i = 0; i < 120 * 15; i++) { car.step(DT, input({ brake: 1 })); vmin = Math.min(vmin, car.speed); }
  results.reverseKmh = +(-vmin * 3.6).toFixed(1);
}
// 4. drift on a wide pad: handbrake flick then throttle; a simple driver holds the angle
{
  const { p, surf } = road('arterial', 3000, flat(3000), 400);
  const car = new Car(surf);
  car.place(p, 100, 0, 75 / 3.6);
  let t = 0, held = 0, best = 0, spun = false, maxSlip = 0;
  const slips: number[] = [];
  while (t < 9) {
    const beta = car.slipAngle; // negative in a left drift
    const deg = (-beta * 180) / Math.PI;
    let steer = 1, throttle = 0.9, hb = false;
    if (t < 0.35) { hb = true; throttle = 0.3; }
    else {
      // hold ~30°: counter-steer harder as the angle grows past it
      steer = Math.max(-1, Math.min(1, (30 - deg) / 14));
      throttle = deg > 36 ? 0.5 : 1;
    }
    car.step(DT, input({ steer, throttle, handbrake: hb }));
    t += DT;
    const d = Math.abs(car.slipAngle) * 180 / Math.PI;
    maxSlip = Math.max(maxSlip, d);
    if (d > 100) spun = true;
    if (d >= 20 && d <= 40 && car.kmh > 25) { held += DT; best = Math.max(best, held); } else held = 0;
    if (Math.round(t * 120) % 12 === 0) slips.push(+d.toFixed(0));
  }
  results.driftHeldS = +best.toFixed(2);
  results.driftMaxSlipDeg = +maxSlip.toFixed(1);
  results.driftSpun = spun;
  results.driftTrace = slips.join(',');
}
// 5. pothole at 100 km/h under the left wheels
{
  const { p, surf, wear } = road('avenue', 3000, flat(3000));
  const car = new Car(surf);
  const t0 = 3.2;
  car.place(p, 100, t0, 100 / 3.6);
  for (let i = 0; i < 60; i++) car.step(DT, input({ throttle: 0.55 }));
  const s0 = car.loc.s;
  // pothole centred on the left wheel path 20 m ahead
  wear.feats.push({ kind: 'pothole', s: s0 + 20, t: t0 + 0.75, hs: 0.8, ht: 0.8, depth: 0.09, r: 0.55, h1: 0.1, h2: 0.05, h3: 0.03, p1: 0, p2: 1, p3: 2, water: false, seed: 1 });
  const yaw0 = car.yaw;
  let maxDev = 0, minLoad = Infinity;
  for (let i = 0; i < 240; i++) {
    car.step(DT, input({ throttle: 0.55 }));
    maxDev = Math.max(maxDev, Math.abs(car.yaw - yaw0));
    minLoad = Math.min(minLoad, car.wheels[0].load);
  }
  results.potholeHeadingDeg = +(maxDev * 180 / Math.PI).toFixed(2);
  results.potholeWheelDropped = minLoad < 1000;
  results.potholeBoostGain = +car.boost.toFixed(3);
}
// 6. air: back-street blind crest at 90 km/h, avenue crest at 100, arterial at 100
for (const [name, cls, g, L, kmh] of [['airBack90', 'back', 0.12, 14, 90], ['airAvenue100', 'avenue', 0.08, 40, 100], ['airArterial100', 'arterial', 0.06, 90, 100]] as const) {
  const sC = 600;
  const vp = [{ s: 0, z: 0, L: 0 }, { s: 300, z: 0, L: 0 }, { s: sC, z: g * 300, L: 0 }, { s: 900, z: 0, L: 0 }, { s: 1500, z: 0, L: 0 }];
  vp[1].L = 30; vp[2].L = L; vp[3].L = 30;
  const { p, surf } = road(cls, 1500, vp);
  const car = new Car(surf);
  car.place(p, sC - 120, 1.6, kmh / 3.6);
  let air = 0, best = 0, t = 0;
  while (t < 8) {
    // hold the speed until the crest, then coast
    const thr = car.loc.s < sC ? (car.kmh < kmh ? 1 : 0.2) : 0.3;
    car.step(DT, input({ throttle: thr }));
    t += DT;
    if (car.wheels.every((w) => !w.contact)) { air += DT; best = Math.max(best, air); } else air = 0;
  }
  results[name + 's'] = +best.toFixed(2);
}

console.log(JSON.stringify(results, null, 1));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
