/**
 * Renders kit pieces (buildings, props, edges) with the real world + actor shaders.
 * Query: ?group=downtown&items=name1,name2&times=day,night&views=front,three,wide&size=900x560&seed=1
 * Driven by tools/shoot-kit.mjs.
 */
import { Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer, SRGBColorSpace, Vector3, SphereGeometry, BackSide } from 'three';
import { env, applyTimeOfDay, TIME_NAMES } from '../../src/render/environment';
import { makeWorldMaterial } from '../../src/render/worldMaterial';
import { makeActorMaterial, makeInkMaterial, addSmoothNormals } from '../../src/render/actorMaterial';
import { PROP_STYLE, PROP_SLOTS_LIST } from '../../src/world/kit/propStyle';
import { loadWorldLayers } from '../../src/render/worldTextures';
import { WorldGeom, InkedGeom } from '../../src/world/kit/geom';
import type { KitPreviewItem } from '../../src/world/kit/catalog';
import { ENV_PARS, FOG_FN } from '../../src/render/glsl';

const q = new URLSearchParams(location.search);
const group = q.get('group');
const only = q.get('items')?.split(',');
const times = (q.get('times') || 'day,night').split(',');
const views = (q.get('views') || 'front,three').split(',');
const [W, H] = (q.get('size') || '900x560').split('x').map(Number);
const seed = Number(q.get('seed') || '1');

const mods = import.meta.glob('../../src/world/kit/catalog_*.ts', { eager: true }) as Record<string, { items: KitPreviewItem[] }>;
let items: KitPreviewItem[] = Object.values(mods).flatMap((m) => m.items || []);
if (group) items = items.filter((i) => i.group === group);
if (only) items = items.filter((i) => only.includes(i.name));

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);
env.uResolution.value.set(W, H, 1);
const scene = new Scene();
const sky = new Mesh(new SphereGeometry(900, 32, 16), new ShaderMaterial({
  uniforms: { ...env },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: `${ENV_PARS} varying vec3 vD; void main(){ float y = vD.y; vec3 c = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, y)); c = mix(c, uFogColor, smoothstep(0.08, -0.05, y)); gl_FragColor = vec4(c,1.0);
  #include <colorspace_fragment>
  }`, side: BackSide, depthWrite: false }));
scene.add(sky);
const ground = new Mesh(new PlaneGeometry(2000, 2000), new ShaderMaterial({
  uniforms: { ...env },
  vertexShader: `varying vec3 vWP; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `${ENV_PARS} ${FOG_FN} varying vec3 vWP; void main(){ vec3 base = vec3(0.2,0.2,0.24); vec3 amb = mix(uAmbBottom, uAmbTop, 0.9); vec3 c = base * (uSunColor * 0.8 + amb * 0.5); c = applyFog(c, vWP); gl_FragColor = vec4(c,1.0);
  #include <colorspace_fragment>
  }` }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);
const camera = new PerspectiveCamera(50, W / H, 0.1, 3000);
const shots: { name: string; data: string }[] = [];
(window as any).__shots = shots;

async function main() {
  const tex = await loadWorldLayers('/assets/tex', 1);
  const world = new WorldGeom();
  const inked = new InkedGeom();
  // lay items out in a row along +X, fronts facing +Z
  let x = 0;
  const placed: { item: KitPreviewItem; x: number }[] = [];
  const gap = 4;
  for (const it of items) {
    const cx = x + it.size[0] / 2;
    world.m.makeTranslation(cx, 0, 0);
    inked.m.makeTranslation(cx, 0, 0);
    it.build(world, inked, tex.L, seed);
    placed.push({ item: it, x: cx });
    x += it.size[0] + gap;
  }
  world.m.identity(); inked.m.identity();
  const wm = makeWorldMaterial({ albedo: tex.albedo, emit: tex.emit, cutout: true, doubleSided: false });
  const wmesh = new Mesh(world.toGeometry(), wm);
  scene.add(wmesh);
  if (inked.vertexCount) {
    const ig = inked.toGeometry();
    addSmoothNormals(ig);
    const am = makeActorMaterial({ style: PROP_STYLE, slots: PROP_SLOTS_LIST });
    scene.add(new Mesh(ig, am));
    const ink = new Mesh(ig, makeInkMaterial(1));
    scene.add(ink);
  }
  (window as any).__info = { items: placed.map((p) => p.item.name), worldTriangles: world.triangleCount, inkedTriangles: inked.vertexCount / 3, layers: Object.keys(tex.layers).length };
  const total = x;
  for (const t of times) {
    applyTimeOfDay(TIME_NAMES[t] ?? Number(t));
    for (const v of views) {
      const list: { name: string; pos: Vector3; tgt: Vector3 }[] = [];
      if (v === 'wide') {
        const D = Math.max(30, total * 0.7);
        list.push({ name: 'wide', pos: new Vector3(total / 2, D * 0.35, D), tgt: new Vector3(total / 2, 4, 0) });
      } else {
        for (const p of placed) {
          const [sx, sy, sz] = p.item.size;
          const D = Math.max(sx, sy * 1.1, 6) * 1.25 + sz * 0.5;
          if (v === 'front') list.push({ name: `${p.item.name}_front`, pos: new Vector3(p.x, Math.min(1.7, sy * 0.5), D), tgt: new Vector3(p.x, sy * 0.45, 0) });
          if (v === 'three') list.push({ name: `${p.item.name}_three`, pos: new Vector3(p.x + D * 0.6, sy * 0.35 + 1.5, D * 0.8), tgt: new Vector3(p.x, sy * 0.4, 0) });
          if (v === 'street') list.push({ name: `${p.item.name}_street`, pos: new Vector3(p.x - sx * 0.9, 1.4, sz * 0.5 + 9), tgt: new Vector3(p.x, sy * 0.35, 0) });
        }
      }
      for (const s of list) {
        camera.position.copy(s.pos);
        camera.lookAt(s.tgt);
        camera.updateProjectionMatrix();
        env.uCamPos.value.copy(camera.position);
        sky.position.copy(camera.position);
        renderer.render(scene, camera);
        shots.push({ name: `${t}_${s.name}`, data: renderer.domElement.toDataURL('image/png') });
      }
    }
  }
  (window as any).__done = true;
}
main().catch((e) => { console.error(e); (window as any).__error = String(e && e.stack || e); (window as any).__done = true; });
