import {
  Bone, Color, DataTexture, DoubleSide, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, ShaderMaterial, Skeleton, SkinnedMesh, Sphere, TextureLoader, Vector3,
} from 'three';
import type { ChunkManager } from '../world/chunks';
import type { Roadside } from '../world/roadside';
import type { LevelSpec } from '../game';
import type { Car } from '../vehicle/car';
import { loadPeople, PersonAsset } from '../render/actorAssets';
import { makeActorMaterial, makeInkMaterial, PERSON_SLOTS, PERSON_STYLE } from '../render/actorMaterial';
import { WalkNet, hyp } from './walknet';
import { Crowd, CrowdView, CLIP_NAMES, MOOD_DENSITY, Person } from './crowd';
import { crowdLimits, crowdOptions, PeopleMeta } from './catalog';
import { bakeVariant, BakedVariant, samplePose } from './anim';
import { hash32 } from '../core/rng';

export interface PeopleDeps {
  chunks: ChunkManager;
  roadside: Roadside;
  level: LevelSpec;
  seed: number;
}

const BASE = './assets/people/';
const POOL = 40; // the most any graphics level asks for (DESIGN.md §6)

interface Variant {
  asset: PersonAsset;
  baked: BakedVariant;
  /** linear RGB per palette, per slot (PERSON_SLOTS order) */
  palettes: Float32Array[];
}

interface Slot {
  group: Group;
  body: SkinnedMesh;
  ink: SkinnedMesh;
  mat: ShaderMaterial;
  inkMat: ShaderMaterial;
  skeleton: Skeleton;
  tex: DataTexture;
  serial: number;
  variant: number;
}

/**
 * Pedestrians on the sidewalks. The crowd logic (crowd.ts, walknet.ts) decides who walks where;
 * this draws them: a pool of skinned meshes (colour + ink, 2 draws each, culled by a bounding
 * sphere), each with its own palette and a baked pose written into its bone texture, plus one
 * instanced draw of soft contact shadows. Everything is allocated at load: memory stays flat.
 * The game calls load() once and update() every frame (dt = 0 while paused).
 */
export class People {
  root = new Group();
  stats = { people: 0, visible: 0, poses: 0, ms: 0, crowdMs: 0 };
  crowd: Crowd | null = null;
  net: WalkNet | null = null;
  private variants: Variant[] = [];
  private slots: Slot[] = [];
  private shadows: InstancedMesh | null = null;
  private frustum = new Frustum();
  private m = new Matrix4();
  private planes = new Float64Array(24);
  private view: CrowdView = { x: 0, y: 0, z: 0, fx: 0, fz: 1, planes: this.planes };
  private frame = 0;
  private cap = -1;
  private scale = -1;
  private _v = new Vector3();
  private _o = new Object3D();
  private _shear = new Matrix4();
  private _sm = new Matrix4();

  constructor(public d: PeopleDeps) { this.root.name = 'people'; }

  async load(): Promise<void> {
    const meta = (await (await fetch(BASE + 'people.json')).json()) as PeopleMeta;
    const detailP = new TextureLoader().loadAsync(BASE + meta.atlas).then((t) => { t.colorSpace = SRGBColorSpace; t.flipY = false; t.needsUpdate = true; return t; });
    const files = await Promise.all(meta.variants.map((v) => loadPeople(BASE + v.file, PERSON_SLOTS)));
    const detail = await detailP;
    const c = new Color();
    for (let i = 0; i < meta.variants.length; i++) {
      const asset = files[i].variants[0];
      if (!asset) throw new Error(`people: ${meta.variants[i].file} has no skinned mesh`);
      const palettes = meta.variants[i].palettes.map((pal) => {
        const a = new Float32Array(PERSON_SLOTS.length * 3);
        PERSON_SLOTS.forEach((slot, k) => {
          c.set(pal[slot] ?? PERSON_STYLE[slot].color);
          a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b;
        });
        return a;
      });
      // only the skate variants ever skate (people.json): the others skip that clip
      const names = CLIP_NAMES.map((n) => (n === 'skate' && !meta.variants[i].skates ? null : n));
      this.variants.push({ asset, baked: bakeVariant(asset, names, meta.fps || 30), palettes });
    }
    // the pool: every person a body and an ink hull sharing one skeleton whose bone matrices
    // come straight from the baked clips (Skeleton.update is a no-op for them)
    const nb = this.variants[0].baked.bones;
    const bones: Bone[] = [];
    const inv: Matrix4[] = [];
    for (let i = 0; i < nb; i++) { bones.push(new Bone()); inv.push(new Matrix4()); }
    const I = new Matrix4();
    const sphere = new Sphere(new Vector3(0, 0.95, 0), 1.3);
    for (let i = 0; i < POOL; i++) {
      const mat = withFade(makeActorMaterial({ style: PERSON_STYLE, slots: PERSON_SLOTS, detail }));
      const inkMat = withFade(makeInkMaterial(1));
      const skeleton = new Skeleton(bones, inv);
      skeleton.update = () => {};
      skeleton.computeBoneTexture();
      const geo = this.variants[0].asset.geometry;
      const body = new SkinnedMesh(geo, mat);
      const ink = new SkinnedMesh(geo, inkMat);
      for (const m of [body, ink]) {
        m.bindMode = 'detached';
        m.bind(skeleton, I);
        m.boundingSphere = sphere.clone();
        m.frustumCulled = true;
      }
      ink.renderOrder = -1;
      const group = new Group();
      group.add(body, ink);
      group.visible = false;
      group.matrixAutoUpdate = false;
      this.root.add(group);
      this.slots.push({ group, body, ink, mat, inkMat, skeleton, tex: skeleton.boneTexture!, serial: -1, variant: 0 });
    }
    // soft contact shadows, one instanced draw
    const sm = new MeshBasicMaterial({ color: new Color(0x1a1030), transparent: true, opacity: 0.4, depthWrite: false, side: DoubleSide });
    sm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'float r = length((vUv - 0.5) * 2.0); diffuseColor.a *= smoothstep(1.0, 0.25, r);');
      sh.vertexShader = 'varying vec2 vUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv = uv;');
      sh.fragmentShader = 'varying vec2 vUv;\n' + sh.fragmentShader;
    };
    sm.polygonOffset = true;
    sm.polygonOffsetFactor = -2;
    sm.polygonOffsetUnits = -4;
    const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(plane, sm, POOL);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.root.add(this.shadows);

    const { chunks, roadside, level, seed } = this.d;
    const gen = chunks.gen;
    this.net = new WalkNet(chunks, roadside, (x, z, out) => gen.districts.moodWeights(x, z, out), MOOD_DENSITY);
    this.crowd = new Crowd(this.net, { ...crowdOptions(meta, level, seed), poolSize: POOL });
    this.cap = this.crowd.o.cap;
    // the game builds the nearest chunks before its first frame (they are ready by now): read
    // their sidewalks here, behind the loading screen, not in the first frame
    this.net.prewarm(this.crowd.o.liveR + 70);
  }

  update(dt: number, camera: PerspectiveCamera, originX: number, originZ: number, car: Car): void {
    const crowd = this.crowd;
    if (!crowd) return;
    const t0 = performance.now();
    this.frame++;
    // the graphics level can change live (pause menu: the level object is updated in place)
    if (this.d.level.scale !== this.scale) {
      this.scale = this.d.level.scale;
      const lim = crowdLimits(this.d.level);
      if (lim.cap !== this.cap) { crowd.setLimits(lim); this.cap = lim.cap; }
    }
    // the camera in world space (the scene is drawn relative to the floating origin)
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const P = this.planes;
    for (let i = 0; i < 6; i++) {
      const pl = this.frustum.planes[i];
      P[i * 4] = pl.normal.x; P[i * 4 + 1] = pl.normal.y; P[i * 4 + 2] = pl.normal.z;
      P[i * 4 + 3] = pl.constant - pl.normal.x * originX - pl.normal.z * originZ;
    }
    const v = this.view;
    v.x = camera.position.x + originX; v.y = camera.position.y; v.z = camera.position.z + originZ;
    camera.getWorldDirection(this._v);
    const l = hyp(this._v.x, this._v.z) || 1;
    v.fx = this._v.x / l; v.fz = this._v.z / l;
    const c0 = performance.now();
    crowd.update(dt, v, car);
    this.stats.crowdMs = performance.now() - c0;

    // ---- draw
    let visible = 0, poses = 0, ns = 0;
    for (const s of this.slots) s.group.visible = false;
    const sh = this.shadows!;
    for (const p of crowd.active) {
      const s = this.slots[p.id];
      const fresh = s.serial !== p.serial;
      if (fresh) this.dress(s, p);
      s.group.visible = true;
      const g = s.group;
      g.position.set(p.x - originX, p.y, p.z - originZ);
      g.rotation.set(0, p.yaw, 0);
      g.scale.setScalar(p.scale);
      g.updateMatrix();
      const ap = p.appear;
      s.mat.uniforms.uFade.value = ap;
      s.inkMat.uniforms.uFade.value = ap;
      if (p.lod > 0) {
        visible++;
        if (fresh || p.visibleT === 1 || (this.frame + p.id) % p.lod === 0) { this.pose(s, p); poses++; }
        // contact shadow, laid on the sidewalk's slope
        const o = this._o;
        o.position.set(0, 0, 0);
        o.rotation.set(0, p.yaw, 0);
        o.scale.set(0.95 * p.scale * ap, 1, 1.1 * p.scale * ap);
        o.updateMatrix();
        const e = this._shear.elements;
        e[1] = p.gx; e[9] = p.gz; // y += gx·x + gz·z
        this._sm.multiplyMatrices(this._shear, o.matrix).setPosition(p.x - originX, p.y + 0.025, p.z - originZ);
        sh.setMatrixAt(ns++, this._sm);
      }
    }
    sh.count = ns;
    if (ns) sh.instanceMatrix.needsUpdate = true;
    this.stats.people = crowd.active.length;
    this.stats.visible = visible;
    this.stats.poses = poses;
    this.stats.ms = performance.now() - t0;
  }

  /** A pool slot takes on a new person: body, palette (with a little per-person shading). */
  private dress(s: Slot, p: Person) {
    s.serial = p.serial;
    const V = this.variants[p.variant];
    if (s.variant !== p.variant) {
      s.body.geometry = V.asset.geometry;
      s.ink.geometry = V.asset.geometry;
      s.variant = p.variant;
    }
    const pal = V.palettes[p.palette % V.palettes.length];
    const out = s.mat.uniforms.uPalette.value as Color[];
    const h = hash32(p.serial, p.id, 77);
    for (let k = 0; k < PERSON_SLOTS.length; k++) {
      // clothes vary a touch in brightness from person to person; skin and detail stay true
      const j = k >= 2 && k <= 6 ? 1 + (((h >>> (k * 3)) & 7) - 3.5) * 0.025 : 1;
      out[k].setRGB(pal[k * 3] * j, pal[k * 3 + 1] * j, pal[k * 3 + 2] * j);
    }
  }

  private pose(s: Slot, p: Person) {
    const B = this.variants[p.variant].baked;
    const a = B.clips[p.clip] ?? B.clips[0]!;
    const w = p.fade >= 1 ? 0 : 1 - smooth(p.fade);
    const b = w > 0 ? B.clips[p.prevClip] ?? null : null;
    samplePose(s.skeleton.boneMatrices!, B.bones, a, p.t, b, p.prevT, w);
    s.tex.needsUpdate = true;
  }
}

/**
 * A per-person fade (uFade, 1 = solid) drawn as a screen-door dither, the same pattern the
 * traffic uses: people who arrive or leave far off but in view fade instead of popping. Patched
 * onto these materials only (one shared program for all people); the car's, traffic's and
 * props' materials are untouched.
 */
function withFade(m: ShaderMaterial): ShaderMaterial {
  const src = m.fragmentShader;
  const main = /void\s+main\s*\(\s*(void)?\s*\)\s*\{/.exec(src);
  m.uniforms.uFade = { value: 1 };
  if (!main) { console.warn('people: no fade (shader has no main): far people will pop'); return m; }
  const at = main.index, end = at + main[0].length;
  m.fragmentShader = src.slice(0, at) + 'uniform float uFade;\n' + 'void main() {\n  if (uFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= uFade) discard;' + src.slice(end);
  return m;
}

function smooth(x: number) {
  return x * x * (3 - 2 * x);
}
