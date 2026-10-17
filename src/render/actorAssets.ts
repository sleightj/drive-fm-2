import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
  Skeleton,
  SkinnedMesh,
  Texture,
  AnimationClip,
  Vector3,
  Box3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addSmoothNormals } from './actorMaterial';

/**
 * Turns a glTF node (one mesh with N primitives, or a group of meshes) into a single
 * geometry with a `slot` attribute taken from each primitive's material name, plus
 * `smoothNormal` for the ink pass. One geometry → one draw for colour, one for ink.
 */
export function mergeNodeBySlots(node: Object3D, slots: readonly string[], rootInverse?: Matrix4): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  node.updateWorldMatrix(true, true);
  const nodeInv = rootInverse ?? new Matrix4().copy(node.matrixWorld).invert();
  node.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const src = m.geometry;
    const rel = new Matrix4().multiplyMatrices(nodeInv, m.matrixWorld);
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.getAttribute('position').count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      const name = (mat?.name || '').toLowerCase().replace(/\.\d+$/, '');
      let slot = slots.indexOf(name);
      if (slot < 0) {
        console.warn(`[assets] unknown material "${mat?.name}" on ${node.name}; using slot 0`);
        slot = 0;
      }
      let g = src.index ? src.toNonIndexed() : src.clone();
      if (src.index && src.groups.length) {
        // extract just this group's triangles
        const full = src.toNonIndexed();
        g = sliceTriangles(full, gr.start, gr.count);
      } else if (!src.index && src.groups.length) {
        g = sliceTriangles(src, gr.start, gr.count);
      }
      if (!(m as SkinnedMesh).isSkinnedMesh) g.applyMatrix4(rel);
      const n = g.getAttribute('position').count;
      const sa = new Float32Array(n).fill(slot);
      g.setAttribute('slot', new BufferAttribute(sa, 1));
      if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
      // keep a consistent attribute set for merging
      for (const k of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'slot', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
      }
      g.morphAttributes = {};
      parts.push(g);
    }
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  if (!merged) return null;
  addSmoothNormals(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function sliceTriangles(g: BufferGeometry, start: number, count: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) {
    const attr = a as BufferAttribute;
    const arr = (attr.array as Float32Array).slice(start * attr.itemSize, (start + count) * attr.itemSize);
    out.setAttribute(k, new BufferAttribute(arr, attr.itemSize, attr.normalized));
  }
  return out;
}

export interface VehicleAsset {
  name: string;
  body: BufferGeometry;
  wheels: { name: string; geometry: BufferGeometry; position: Vector3 }[];
  lamps: Record<string, Vector3>;
  wheelRadius: number;
  track: number;
  wheelbase: number;
  size: Vector3;
  triangles: number;
}

const loader = new GLTFLoader();

export async function loadGLB(url: string) {
  return loader.loadAsync(url);
}

export async function loadVehicle(url: string, slots: readonly string[]): Promise<VehicleAsset> {
  const gltf = await loadGLB(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(root.matrixWorld).invert();
  const find = (n: string) => root.getObjectByName(n);
  const bodyNode = find('body');
  if (!bodyNode) throw new Error(`${url}: no body node`);
  const body = mergeNodeBySlots(bodyNode, slots, rootInv)!;
  const wheels: VehicleAsset['wheels'] = [];
  for (const wn of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const node = find(wn);
    if (!node) throw new Error(`${url}: missing ${wn}`);
    node.updateWorldMatrix(true, true);
    const p = new Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(rootInv);
    // wheel geometry in the wheel node's own frame (hub at origin)
    const inv = new Matrix4().copy(node.matrixWorld).invert();
    const geometry = mergeNodeBySlots(node, slots, inv)!;
    wheels.push({ name: wn, geometry, position: p });
  }
  const lamps: Record<string, Vector3> = {};
  root.traverse((o) => {
    if (o.name.startsWith('lamp_')) {
      lamps[o.name] = new Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(rootInv);
    }
  });
  const bb = new Box3();
  bb.union(body.boundingBox!);
  for (const w of wheels) {
    const wb = w.geometry.boundingBox!.clone().translate(w.position);
    bb.union(wb);
  }
  const wr = wheels[0].geometry.boundingBox!;
  const wheelRadius = (wr.max.y - wr.min.y) / 2;
  const fl = wheels[0].position, fr = wheels[1].position, rl = wheels[2].position;
  let tris = body.getAttribute('position').count / 3;
  for (const w of wheels) tris += w.geometry.getAttribute('position').count / 3;
  return {
    name: url.split('/').pop()!.replace('.glb', ''),
    body,
    wheels,
    lamps,
    wheelRadius,
    track: Math.abs(fl.x - fr.x),
    wheelbase: Math.abs(fl.z - rl.z),
    size: bb.getSize(new Vector3()),
    triangles: Math.round(tris),
  };
}

export interface PersonAsset {
  name: string;
  geometry: BufferGeometry;
  skeletonRoot: Object3D;
  bones: Bone[];
  boneInverses: Matrix4[];
  bindMatrix: Matrix4;
  clips: AnimationClip[];
  triangles: number;
}

/** Loads every skinned mesh in a people glb as a merged single-draw variant. */
export async function loadPeople(url: string, slots: readonly string[]): Promise<{ variants: PersonAsset[]; clips: AnimationClip[]; scene: Group }> {
  const gltf = await loadGLB(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const variants: PersonAsset[] = [];
  const byParent = new Map<Object3D, SkinnedMesh[]>();
  scene.traverse((o) => {
    const s = o as SkinnedMesh;
    if (s.isSkinnedMesh) {
      const key = s.parent && !(s.parent as any).isBone && s.parent !== scene && (s.parent as Mesh).type === 'Group' ? s.parent : s;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(s);
    }
  });
  for (const [key, meshes] of byParent) {
    const first = meshes[0];
    const parts: BufferGeometry[] = [];
    for (const m of meshes) {
      const tmp = new Group();
      tmp.add(m.clone());
      const g = mergeNodeBySlots(m, slots, new Matrix4());
      if (g) {
        g.deleteAttribute('smoothNormal');
        parts.push(g);
      }
    }
    const merged = mergeGeometries(parts, false)!;
    addSmoothNormals(merged);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    variants.push({
      name: key.name || first.name,
      geometry: merged,
      skeletonRoot: first.skeleton.bones[0],
      bones: first.skeleton.bones,
      boneInverses: first.skeleton.boneInverses,
      bindMatrix: first.bindMatrix.clone(),
      clips: gltf.animations,
      triangles: merged.getAttribute('position').count / 3,
    });
  }
  return { variants, clips: gltf.animations, scene };
}

/** Builds a colour mesh + ink mesh pair sharing one geometry. */
export function actorMeshPair(geometry: BufferGeometry, material: ShaderMaterial, ink: ShaderMaterial | null): Group {
  const g = new Group();
  const m = new Mesh(geometry, material);
  g.add(m);
  if (ink) {
    const i = new Mesh(geometry, ink);
    i.renderOrder = -1;
    g.add(i);
  }
  return g;
}

export function cloneSkinnedPair(
  asset: PersonAsset,
  material: ShaderMaterial,
  ink: ShaderMaterial | null,
): { group: Group; mesh: SkinnedMesh; ink: SkinnedMesh | null; skeleton: Skeleton; root: Object3D } {
  // Clone the bone hierarchy so each person animates independently.
  const srcRoot = asset.skeletonRoot;
  const rootClone = cloneBones(srcRoot);
  const map = new Map<string, Bone>();
  rootClone.traverse((o) => { if ((o as Bone).isBone) map.set(o.name, o as Bone); });
  const bones = asset.bones.map((b) => map.get(b.name)!);
  const skeleton = new Skeleton(bones, asset.boneInverses.map((m) => m.clone()));
  const mesh = new SkinnedMesh(asset.geometry, material);
  mesh.add(rootClone);
  mesh.bind(skeleton, asset.bindMatrix);
  mesh.frustumCulled = false;
  let inkMesh: SkinnedMesh | null = null;
  if (ink) {
    inkMesh = new SkinnedMesh(asset.geometry, ink);
    inkMesh.bind(skeleton, asset.bindMatrix);
    inkMesh.frustumCulled = false;
  }
  const group = new Group();
  group.add(mesh);
  if (inkMesh) group.add(inkMesh);
  return { group, mesh, ink: inkMesh, skeleton, root: rootClone };
}

function cloneBones(b: Object3D): Object3D {
  const c = b.clone(false);
  for (const ch of b.children) if ((ch as Bone).isBone) c.add(cloneBones(ch));
  return c;
}

export function textureOrNull(t: Texture | undefined | null) {
  return t ?? null;
}
