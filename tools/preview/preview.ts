/**
 * Asset preview: renders an actor glb with the game's own cel shader and ink, on a
 * painted ground under the game's sky, at any hour. Driven by tools/shoot-asset.mjs.
 * Query: ?file=/assets/cars/hero.glb&kind=vehicle|person&times=day,night&views=turntable8,chase,side,top&size=800x500&anim=walk&frames=0
 */
import {
  AnimationMixer, Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer,
  Group, SRGBColorSpace, TextureLoader, Vector3, SphereGeometry, BackSide, Object3D,
} from 'three';
import { env, applyTimeOfDay, TIME_NAMES } from '../../src/render/environment';
import { makeActorMaterial, makeInkMaterial, VEHICLE_SLOTS, VEHICLE_STYLE, PERSON_SLOTS, PERSON_STYLE } from '../../src/render/actorMaterial';
import { loadVehicle, loadPeople, actorMeshPair, cloneSkinnedPair } from '../../src/render/actorAssets';
import { ENV_PARS, FOG_FN } from '../../src/render/glsl';

const q = new URLSearchParams(location.search);
const file = q.get('file')!;
const kind = q.get('kind') || (file.includes('people') || file.includes('person') ? 'person' : 'vehicle');
const times = (q.get('times') || 'day,night').split(',');
const views = (q.get('views') || 'turntable8,chase,side').split(',');
const [W, H] = (q.get('size') || '800x500').split('x').map(Number);
const anim = q.get('anim') || '';
const frames = Number(q.get('frames') || '0');
const paint = q.get('paint');

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);
env.uResolution.value.set(W, H, 1);

const scene = new Scene();
// Sky dome
const skyMat = new ShaderMaterial({
  uniforms: { ...env },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: `${ENV_PARS} varying vec3 vD; void main(){ float y = vD.y; vec3 c = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, y)); float s = pow(max(dot(normalize(vD), uSunDir),0.0), 8.0); c += uSkyGlow * s * 0.6 * smoothstep(-0.1, 0.3, 1.0 - y); c = mix(c, uFogColor, smoothstep(0.08, -0.05, y)); gl_FragColor = vec4(c,1.0);
  #include <colorspace_fragment>
  }`,
  side: BackSide, depthWrite: false,
});
const sky = new Mesh(new SphereGeometry(500, 32, 16), skyMat);
scene.add(sky);
// Painted asphalt ground with a soft graded disc
const groundMat = new ShaderMaterial({
  uniforms: { ...env },
  vertexShader: `varying vec3 vWP; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `${ENV_PARS} ${FOG_FN} varying vec3 vWP; void main(){
    float r = length(vWP.xz);
    vec3 base = mix(vec3(0.16,0.17,0.22), vec3(0.11,0.12,0.17), smoothstep(2.0, 14.0, r));
    // painted parking bay lines for scale
    float line = smoothstep(0.06, 0.03, abs(mod(vWP.x + 1.25, 2.5) - 1.25 + 0.0) ) * step(abs(vWP.z), 3.5) * step(3.5, abs(vWP.x) + 3.5) * 0.0;
    float edge = smoothstep(0.07, 0.04, abs(abs(vWP.x) - 1.6)) * step(abs(vWP.z), 6.0);
    base = mix(base, vec3(0.92,0.9,0.82), edge);
    vec3 amb = mix(uAmbBottom, uAmbTop, 0.9);
    vec3 c = base * (uSunColor * max(uSunDir.y,0.0) * 0.9 + amb * 0.45);
    // contact shadow under the actor
    float sh = smoothstep(2.6, 0.6, length(vWP.xz * vec2(1.0, 0.45)));
    c = mix(c, c * uShadowTint * 0.7, sh * 0.75);
    c = applyFog(c, vWP);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`,
});
const ground = new Mesh(new PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new PerspectiveCamera(40, W / H, 0.05, 2000);
const shots: { name: string; data: string }[] = [];
(window as any).__shots = shots;

async function main() {
  const actor = new Group();
  scene.add(actor);
  let mixer: AnimationMixer | null = null;
  let height = 1.4, length = 4.4;
  let info: any = {};
  if (kind === 'vehicle') {
    const v = await loadVehicle(file, VEHICLE_SLOTS);
    const overrides: any = {};
    if (paint) overrides.paint = new Color(paint);
    const mat = makeActorMaterial({ style: VEHICLE_STYLE, slots: VEHICLE_SLOTS, overrides });
    const ink = makeInkMaterial(1);
    actor.add(actorMeshPair(v.body, mat, ink));
    for (const w of v.wheels) {
      const p = actorMeshPair(w.geometry, mat, ink);
      p.position.copy(w.position);
      actor.add(p);
    }
    height = v.size.y; length = v.size.z;
    info = { triangles: v.triangles, size: v.size.toArray().map((x) => +x.toFixed(3)), wheelRadius: +v.wheelRadius.toFixed(3), track: +v.track.toFixed(3), wheelbase: +v.wheelbase.toFixed(3), lamps: Object.keys(v.lamps) };
    (window as any).__mat = mat;
  } else {
    const detailUrl = q.get('detail') || '/assets/people/detail.png';
    let detail = null;
    try { detail = await new TextureLoader().loadAsync(detailUrl); detail.colorSpace = SRGBColorSpace; detail.flipY = false; } catch {}
    const p = await loadPeople(file, PERSON_SLOTS);
    const which = q.get('variant');
    const list = which ? p.variants.filter((v) => v.name === which) : p.variants;
    const spacing = 1.1;
    list.forEach((v, i) => {
      const mat = makeActorMaterial({ style: PERSON_STYLE, slots: PERSON_SLOTS, detail });
      const ink = makeInkMaterial(1);
      const pair = cloneSkinnedPair(v, mat, ink);
      pair.group.position.x = (i - (list.length - 1) / 2) * spacing;
      actor.add(pair.group);
      const clip = p.clips.find((c) => c.name === anim);
      if (clip) {
        const mx = new AnimationMixer(pair.mesh);
        mx.clipAction(clip).play();
        (pair as any).mx = mx;
        (actor as any).mixers = [...((actor as any).mixers || []), mx];
      }
    });
    length = Math.max(1.2, list.length * spacing);
    height = 1.8;
    info = { variants: list.map((v) => ({ name: v.name, triangles: v.triangles })), clips: p.clips.map((c) => ({ name: c.name, duration: +c.duration.toFixed(3) })) };
  }
  (window as any).__info = info;

  const mixers: AnimationMixer[] = (actor as any).mixers || [];
  const target = new Vector3(0, height * 0.45, 0);
  const R = Math.max(5.5, length * 1.55);
  const viewList: { name: string; pos: Vector3; tgt: Vector3; fov: number }[] = [];
  for (const v of views) {
    if (v === 'turntable8') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2; // 0 = front
        viewList.push({ name: `turn${i * 45}`, pos: new Vector3(Math.sin(a) * R, 1.25, Math.cos(a) * R), tgt: target, fov: 40 });
      }
    } else if (v === 'chase') {
      viewList.push({ name: 'chase', pos: new Vector3(0, 2.3, -6.2), tgt: new Vector3(0, 0.9, 2.5), fov: 75 });
    } else if (v === 'title') {
      viewList.push({ name: 'title', pos: new Vector3(-2.6, 0.8, -4.6), tgt: new Vector3(0.3, 0.6, 0.6), fov: 55 });
    } else if (v === 'side') {
      viewList.push({ name: 'side', pos: new Vector3(R * 1.2, height * 0.5, 0), tgt: new Vector3(0, height * 0.5, 0), fov: 36 });
    } else if (v === 'front') {
      viewList.push({ name: 'front', pos: new Vector3(0, 1.2, R), tgt: target, fov: 40 });
    } else if (v === 'top') {
      viewList.push({ name: 'top', pos: new Vector3(0.01, R * 1.6, 0), tgt: new Vector3(0, 0, 0), fov: 40 });
    } else if (v === 'close') {
      viewList.push({ name: 'close', pos: new Vector3(R * 0.35, 1.5, R * 0.45), tgt: new Vector3(0, 1.2, 0), fov: 40 });
    }
  }
  const frameTimes = anim ? (frames > 0 ? Array.from({ length: frames }, (_, i) => i / frames) : [0.25]) : [0];
  for (const t of times) {
    const hour = TIME_NAMES[t] ?? Number(t);
    applyTimeOfDay(hour);
    const lampsOn = env.uLampsOn.value;
    actor.traverse((o: Object3D) => {
      const m = (o as Mesh).material as ShaderMaterial | undefined;
      if (m && m.uniforms && m.uniforms.uState) m.uniforms.uState.value.set(lampsOn, q.get('brake') ? 1 : 0, 0, 0);
    });
    for (const view of viewList) {
      for (const ft of frameTimes) {
        for (const mx of mixers) {
          const clip = (mx as any)._actions[0]?._clip;
          mx.setTime(clip ? clip.duration * ft : 0);
        }
        camera.fov = view.fov;
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        camera.position.copy(view.pos);
        camera.lookAt(view.tgt);
        env.uCamPos.value.copy(camera.position);
        sky.position.copy(camera.position);
        renderer.render(scene, camera);
        shots.push({ name: `${t}_${view.name}${anim ? `_${anim}${Math.round(ft * 100)}` : ''}`, data: renderer.domElement.toDataURL('image/png') });
      }
    }
  }
  (window as any).__done = true;
}
main().catch((e) => { console.error(e); (window as any).__error = String(e && e.stack || e); (window as any).__done = true; });
