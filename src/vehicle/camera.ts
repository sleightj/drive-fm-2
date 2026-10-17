import { PerspectiveCamera, Vector3 } from 'three';
import { Car } from './car';
import { clamp, lerp, wrapAngle } from '../core/math';

/**
 * Chase camera: behind and above the car, following the direction of travel with a little
 * lag (so drifts show the car's angle), dipping toward the road at speed. The field of view
 * is very wide at rest and opens further with speed and boost.
 *
 * FOV (vertical, at 16:9): 72° at rest (≈104° across), easing to +11° by top speed (eased on
 * a smoothed speed so bumps and gear changes never make it breathe), +8° while boosting with
 * a quick attack and a slow release, and the camera tucks in a little as the boost FOV opens
 * (a gentle dolly-zoom: the city stretches, the car keeps its size). Together with the speed
 * lines (src/render/post.ts) that reads as fast without the rubbery edges of a 100°+ view.
 * Narrow screens (portrait phones) get a taller view so the road isn't a slot.
 */
export const FOV = {
  base: 72,
  speed: 11, // added by top speed
  speedFrom: 25, // km/h where it starts opening
  speedTo: 125,
  boost: 8,
  attack: 5, // 1/s toward a wider view
  release: 1.6, // 1/s back
  wideAspect: 1.45, // below this aspect the vertical FOV opens (half the shortfall)
};
export class ChaseCamera {
  heading = 0;
  private pos = new Vector3();
  private look = new Vector3();
  private init = false;
  fovBase = FOV.base;
  fov = FOV.base;
  shake = 0;
  private yOff = 0;
  private vSmooth = 0;
  private boostSmooth = 0;

  constructor(public cam: PerspectiveCamera) {}

  reset() { this.init = false; }

  update(car: Car, dt: number, ox: number, oz: number, boostFx: number) {
    const v = Math.hypot(car.vx, car.vz);
    const velH = v > 3 ? Math.atan2(car.vx, car.vz) : car.yaw;
    // travel direction when moving forward, the car's heading when slow or reversing
    const fwd = car.speed > 2 ? 1 : 0;
    const target = fwd ? car.yaw + wrapAngle(velH - car.yaw) * 0.55 : car.yaw;
    if (!this.init) { this.heading = car.yaw; }
    const rate = 4.2 + v * 0.06;
    this.heading += wrapAngle(target - this.heading) * Math.min(1, rate * dt);
    // smoothed speed and boost: the view widens on these, never on raw jitter
    this.vSmooth += (v - this.vSmooth) * Math.min(1, dt * 2.5);
    this.boostSmooth += (boostFx - this.boostSmooth) * Math.min(1, dt * (boostFx > this.boostSmooth ? FOV.attack : FOV.release));
    if (!this.init) { this.vSmooth = v; this.boostSmooth = boostFx; }
    const dist = lerp(6.4, 7.4, clamp(v / 30, 0, 1)) - 0.55 * this.boostSmooth;
    const height = lerp(2.35, 2.0, clamp(v / 30, 0, 1));
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const carY = car.y - 0.1;
    // vertical follow is softened so bumps don't shake the view, but jumps are followed
    this.yOff += (carY - this.yOff) * Math.min(1, dt * (car.airborne ? 3 : 7));
    if (!this.init) this.yOff = carY;
    const want = new Vector3(car.x - ox - hx * dist, this.yOff + height, car.z - oz - hz * dist);
    const lookAt = new Vector3(car.x - ox + hx * 4.5, this.yOff + 0.9, car.z - oz + hz * 4.5);
    if (!this.init) { this.pos.copy(want); this.look.copy(lookAt); this.init = true; }
    this.pos.lerp(want, Math.min(1, dt * 12));
    this.look.lerp(lookAt, Math.min(1, dt * 16));
    this.cam.position.copy(this.pos);
    // shake from impacts (decays fast)
    if (this.shake > 0.001) {
      const s = this.shake;
      this.cam.position.x += (Math.random() - 0.5) * s * 0.25;
      this.cam.position.y += (Math.random() - 0.5) * s * 0.25;
      this.shake *= Math.exp(-dt * 9);
    }
    this.cam.lookAt(this.look);
    const kmh = this.vSmooth * 3.6;
    const sp = clamp((kmh - FOV.speedFrom) / (FOV.speedTo - FOV.speedFrom), 0, 1);
    const tf = this.fovBase + FOV.speed * sp * sp * (3 - 2 * sp) + FOV.boost * this.boostSmooth;
    this.fov += (tf - this.fov) * Math.min(1, dt * 3);
    // narrow screens: open the vertical view by half the aspect shortfall (in tan space)
    let vf = this.fov;
    const aspect = this.cam.aspect;
    if (aspect > 0 && aspect < FOV.wideAspect) {
      const t = Math.tan((vf * Math.PI) / 360) * Math.sqrt(FOV.wideAspect / aspect);
      vf = Math.min(110, (Math.atan(t) * 360) / Math.PI);
    }
    if (Math.abs(this.cam.fov - vf) > 0.01) { this.cam.fov = vf; this.cam.updateProjectionMatrix(); }
  }
}
