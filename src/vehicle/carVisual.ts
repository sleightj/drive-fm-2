import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector4 } from 'three';
import { VehicleAsset, actorMeshPair } from '../render/actorAssets';
import { makeActorMaterial, makeInkMaterial, VEHICLE_SLOTS, VEHICLE_STYLE } from '../render/actorMaterial';
import { Car } from './car';
import { clamp } from '../core/math';

/**
 * What you see of the car: the body on a soft visual spring layer (it leans, squats and
 * dives a little more than the physics does), wheels that steer, spin and follow their
 * suspension, lamps that light at dusk and on braking, and a soft contact shadow.
 */
const REST = 0.34;

export class CarVisual {
  root = new Group();
  body = new Group();
  wheels: Group[] = [];
  material: ShaderMaterial;
  ink: ShaderMaterial;
  shadow: Mesh;
  private rollV = 0; private roll = 0;
  private pitchV = 0; private pitch = 0;
  private heaveV = 0; private heave = 0;
  private blink = 0;

  constructor(public asset: VehicleAsset, paint?: Color) {
    this.material = makeActorMaterial({ style: VEHICLE_STYLE, slots: VEHICLE_SLOTS, overrides: paint ? { paint } : undefined });
    this.ink = makeInkMaterial(1);
    this.body.add(actorMeshPair(asset.body, this.material, this.ink));
    for (const w of asset.wheels) {
      const g = new Group();
      const spin = new Group();
      spin.add(actorMeshPair(w.geometry, this.material, this.ink));
      g.add(spin);
      g.position.copy(w.position);
      this.wheels.push(g);
      this.root.add(g);
    }
    this.root.add(this.body);
    // soft contact shadow (a painted blob under the car)
    const sm = new MeshBasicMaterial({ color: new Color(0x1a1030), transparent: true, opacity: 0.45, depthWrite: false });
    sm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `float r = length((vUv - 0.5) * 2.0); diffuseColor.a *= smoothstep(1.0, 0.35, r);`,
      );
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv = uv;');
      sh.vertexShader = 'varying vec2 vUv;\n' + sh.vertexShader.replace('varying vec2 vUv;', '');
      sh.fragmentShader = 'varying vec2 vUv;\n' + sh.fragmentShader;
    };
    this.shadow = new Mesh(new PlaneGeometry(asset.size.x * 1.25, asset.size.z * 1.15), sm);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  /** Update from the physics state. (ox, oz) is the render origin. */
  update(car: Car, dt: number, ox: number, oz: number, lampsOn: number, braking: boolean, reversing: boolean) {
    // visual springs: extra lean/dive driven by the chassis accelerations
    const k = 70, c = 2 * 0.55 * Math.sqrt(k);
    const tRoll = clamp(car.aLat * 0.010, -0.09, 0.09);
    const tPitch = clamp(car.aLong * 0.008, -0.07, 0.06);
    this.rollV += (k * (tRoll - this.roll) - c * this.rollV) * dt; this.roll += this.rollV * dt;
    this.pitchV += (k * (tPitch - this.pitch) - c * this.pitchV) * dt; this.pitch += this.pitchV * dt;
    const tHeave = car.airborne ? 0.03 : 0;
    this.heaveV += (k * (tHeave - this.heave) - c * this.heaveV) * dt; this.heave += this.heaveV * dt;

    const R = car.spec.wheelRadius;
    // ground origin of the model under the car at rest
    const baseY = car.y - (REST - 0.1) - R;
    this.root.position.set(car.x - ox, baseY, car.z - oz);
    this.root.rotation.set(0, car.yaw, 0, 'YXZ');
    this.body.rotation.set(-(car.pitch + this.pitch), 0, car.roll + this.roll, 'YXZ');
    this.body.position.y = this.heave;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const g = this.wheels[i];
      // wheel centre: mount minus the spring length (follows the ground)
      const ext = REST - (w.contact ? w.compression : 0);
      const mountY = w.mz * Math.sin(car.pitch) + w.mx * Math.sin(car.roll);
      g.position.y = (REST - 0.1) + R + mountY - ext;
      g.rotation.set(0, w.steer, 0, 'YXZ');
      g.children[0].rotation.x = w.spin;
    }
    // shadow sits on the road under the car
    this.shadow.position.set(car.x - ox, car.y - (REST - 0.1) - R + 0.04 - Math.max(0, car.airTime) * 0, car.z - oz);
    const gy = car.wheels.reduce((a, w) => a + w.groundY, 0) / 4;
    this.shadow.position.y = gy + 0.03;
    this.shadow.rotation.set(-Math.PI / 2, 0, car.yaw, 'YXZ');
    const sm = this.shadow.material as MeshBasicMaterial;
    const h = Math.max(0, baseY - gy);
    sm.opacity = 0.5 * clamp(1 - h / 3, 0.15, 1);
    this.shadow.scale.setScalar(1 + h * 0.15);
    // lamps
    this.blink = (this.blink + dt) % 1;
    const st = this.material.uniforms.uState.value as Vector4;
    st.set(lampsOn, braking ? 1 : 0, reversing ? 1 : 0, 0);
  }
}
