import { PerspectiveCamera, Vector3 } from 'three';
import { Car } from './car';
import { clamp, lerp, wrapAngle } from '../core/math';

/**
 * Chase camera: behind and above the car, following the direction of travel with a little
 * lag (so drifts show the car's angle), dipping toward the road at speed. The field of view
 * is very wide at rest and opens further with speed and boost.
 */
export class ChaseCamera {
  heading = 0;
  private pos = new Vector3();
  private look = new Vector3();
  private init = false;
  fovBase = 74;
  fov = 74;
  shake = 0;
  private yOff = 0;

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
    const dist = lerp(6.4, 7.4, clamp(v / 30, 0, 1));
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
    const kmh = v * 3.6;
    const tf = this.fovBase + 14 * clamp((kmh - 20) / 100, 0, 1) + 10 * boostFx;
    this.fov += (tf - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}
