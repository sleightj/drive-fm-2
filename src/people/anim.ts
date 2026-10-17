import { AnimationClip, Bone, Interpolant, Matrix4, Object3D, PropertyBinding } from 'three';
import type { PersonAsset } from '../render/actorAssets';

/**
 * Baked skeletal animation: every clip of a variant sampled at its own 30 fps into final
 * skinning matrices (bone world × inverse bind × bind), so a person's pose each frame is a
 * blend of two baked frames copied straight into its bone texture. No bone hierarchy, no
 * AnimationMixer and no matrix products per person per frame.
 */

export interface BakedClip {
  name: string;
  frames: number;
  fps: number;
  /** frames × bones × 16 floats */
  data: Float32Array;
}

export interface BakedVariant {
  bones: number;
  /** by the crowd's Clip index (null when the file lacks the clip) */
  clips: (BakedClip | null)[];
}

export function bakeVariant(asset: PersonAsset, clipNames: readonly (string | null)[], fps = 30): BakedVariant {
  // a private copy of the bone tree, rooted at the origin like a skinned mesh's own bones
  const root = cloneBones(asset.skeletonRoot);
  root.position.copy(asset.skeletonRoot.position);
  root.quaternion.copy(asset.skeletonRoot.quaternion);
  root.scale.copy(asset.skeletonRoot.scale);
  const byName = new Map<string, Object3D>();
  root.traverse((o) => byName.set(o.name, o));
  const bones = asset.bones.map((b) => byName.get(b.name)!);
  const nb = bones.length;
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  const bind = asset.bindMatrix;
  const M = new Matrix4();
  const clips: (BakedClip | null)[] = [];
  for (const name of clipNames) {
    const clip = name ? asset.clips.find((c: AnimationClip) => c.name === name) : undefined;
    if (!clip) { clips.push(null); continue; }
    // reset to the rest pose so tracks a clip lacks don't inherit the previous clip's last frame
    bones.forEach((b, i) => { b.position.copy(rest[i].p); b.quaternion.copy(rest[i].q); b.scale.copy(rest[i].s); });
    const tracks: { node: Object3D; prop: 'position' | 'quaternion' | 'scale'; it: Interpolant }[] = [];
    for (const tr of clip.tracks) {
      const pn = PropertyBinding.parseTrackName(tr.name);
      const node = byName.get(pn.nodeName);
      const prop = pn.propertyName as 'position' | 'quaternion' | 'scale';
      if (!node || (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale')) continue;
      tracks.push({ node, prop, it: (tr as unknown as { createInterpolant(): Interpolant }).createInterpolant() });
    }
    // the loop's last key repeats the first: bake [0, duration) and wrap
    const frames = Math.max(1, Math.round(clip.duration * fps));
    const data = new Float32Array(frames * nb * 16);
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      for (const tk of tracks) {
        const v = tk.it.evaluate(t) as unknown as ArrayLike<number>;
        if (tk.prop === 'quaternion') tk.node.quaternion.set(v[0], v[1], v[2], v[3]);
        else tk.node[tk.prop].set(v[0], v[1], v[2]);
      }
      root.updateMatrixWorld(true);
      for (let i = 0; i < nb; i++) {
        M.multiplyMatrices(bones[i].matrixWorld, asset.boneInverses[i]).multiply(bind);
        data.set(M.elements, (f * nb + i) * 16);
      }
    }
    clips.push({ name: name!, frames, fps, data });
  }
  return { bones: nb, clips };
}

function cloneBones(b: Object3D): Object3D {
  const c = b.clone(false);
  for (const ch of b.children) if ((ch as Bone).isBone) c.add(cloneBones(ch));
  return c;
}

/**
 * Pose into `out` (bones × 16 floats): clip `a` at time ta, blended toward clip `b` at time tb
 * with weight wb (0 = all a). Times wrap.
 */
export function samplePose(out: Float32Array, n: number, a: BakedClip, ta: number, b: BakedClip | null, tb: number, wb: number) {
  const fa = wrapFrame(a, ta);
  const a0 = fa.i0 * n * 16, a1 = fa.i1 * n * 16, wa = fa.w;
  const A = a.data;
  const m = n * 16;
  if (!b || wb <= 0.001) {
    for (let j = 0; j < m; j++) out[j] = A[a0 + j] + (A[a1 + j] - A[a0 + j]) * wa;
    return;
  }
  const fb = wrapFrame(b, tb);
  const b0 = fb.i0 * n * 16, b1 = fb.i1 * n * 16, wv = fb.w;
  const B = b.data;
  const k = 1 - wb;
  for (let j = 0; j < m; j++) {
    const x = A[a0 + j] + (A[a1 + j] - A[a0 + j]) * wa;
    const y = B[b0 + j] + (B[b1 + j] - B[b0 + j]) * wv;
    out[j] = x * k + y * wb;
  }
}

const _fr = { i0: 0, i1: 0, w: 0 };
function wrapFrame(c: BakedClip, t: number) {
  let ft = t * c.fps;
  ft = ft - Math.floor(ft / c.frames) * c.frames;
  const i0 = Math.floor(ft);
  _fr.i0 = i0 % c.frames;
  _fr.i1 = (i0 + 1) % c.frames;
  _fr.w = ft - i0;
  return _fr;
}
