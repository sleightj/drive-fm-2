import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  ShaderMaterial,
  Texture,
  Vector4,
} from 'three';
import { env } from './environment';
import { ENV_PARS, FOG_FN } from './glsl';

/**
 * Actor shading: the cel look for cars, people and a few hero props.
 * Two light bands (lit / shade), a strongly hue-shifted shade, a cel glint on paint
 * and glass, a sky rim, and lamp emissives that come alive at night.
 * Ink is a separate inverted-hull pass (makeInkMaterial).
 */

export const VEHICLE_SLOTS = [
  'paint', 'accent', 'trim', 'glass', 'metal', 'tyre', 'rim', 'headlamp', 'taillamp',
  'indicator', 'clearlens', 'reverse', 'interior', 'plate', 'grille', 'underbody', 'detail',
] as const;
export const PERSON_SLOTS = ['skin', 'hair', 'top', 'top2', 'bottom', 'shoes', 'accent', 'gear', 'detail'] as const;
export const PROP_SLOTS = ['a', 'b', 'c', 'd', 'e', 'f', 'lamp', 'detail'] as const;
export const NSLOT = 18;

// Emissive kinds (slot props .z)
export const EMIT = { none: 0, head: 1, tail: 2, indicator: 3, reverse: 4, glass: 5, lampHead: 6, window: 7 } as const;

export interface SlotStyle {
  color: number;
  spec?: number; // cel glint strength
  rim?: number; // rim strength
  emit?: number; // EMIT kind
  shade?: number; // how far the shade band darkens (1 = full tint)
}

export const VEHICLE_STYLE: Record<string, SlotStyle> = {
  paint: { color: 0xf4f1ea, spec: 1.0, rim: 1.0 },
  accent: { color: 0x2a2a35, spec: 0.8, rim: 0.8 },
  trim: { color: 0x1c1c26, spec: 0.2, rim: 0.4 },
  glass: { color: 0x18223e, spec: 1.0, rim: 0.6, emit: EMIT.glass },
  metal: { color: 0xc8d0dc, spec: 1.2, rim: 1.0 },
  tyre: { color: 0x202028, spec: 0.0, rim: 0.3 },
  rim: { color: 0xc9ced8, spec: 1.0, rim: 0.8 },
  headlamp: { color: 0xdfe8f2, spec: 1.2, rim: 0.6, emit: EMIT.head },
  taillamp: { color: 0xc4182e, spec: 1.0, rim: 0.5, emit: EMIT.tail },
  indicator: { color: 0xf09a1c, spec: 1.0, rim: 0.5, emit: EMIT.indicator },
  clearlens: { color: 0xd8dde6, spec: 1.2, rim: 0.6 },
  reverse: { color: 0xeef0f4, spec: 1.0, rim: 0.5, emit: EMIT.reverse },
  interior: { color: 0x2a2833, spec: 0.0, rim: 0.0 },
  plate: { color: 0xf0f0e8, spec: 0.2, rim: 0.2 },
  grille: { color: 0x15151c, spec: 0.0, rim: 0.2 },
  underbody: { color: 0x17161d, spec: 0.0, rim: 0.0 },
  detail: { color: 0xffffff, spec: 0.3, rim: 0.3 },
};

export const PERSON_STYLE: Record<string, SlotStyle> = {
  skin: { color: 0xe8b48e, rim: 0.7 },
  hair: { color: 0x2a2030, spec: 0.6, rim: 0.8 },
  top: { color: 0xff5a3c, rim: 0.7 },
  top2: { color: 0xf2f0e8, rim: 0.7 },
  bottom: { color: 0x2a3a6a, rim: 0.6 },
  shoes: { color: 0xf4f4f0, rim: 0.6 },
  accent: { color: 0x31e0c8, rim: 0.8 },
  gear: { color: 0x1d1d26, spec: 0.6, rim: 0.6 },
  detail: { color: 0xffffff, rim: 0.4 },
};

const ACTOR_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float slot;
#ifdef USE_INSTANCING
attribute vec3 aPaint;
attribute vec3 aAccent;
attribute vec4 aState;
varying vec3 vPaint;
varying vec3 vAccent;
varying vec4 vState;
#endif
varying vec3 vN;
varying vec3 vWP;
varying float vSlot;
varying vec2 vUv;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  vPaint = aPaint;
  vAccent = aAccent;
  vState = aState;
  #endif
  vec4 wp = m * vec4(transformed, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(m) * objectNormal);
  vSlot = slot;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ACTOR_FRAG = /* glsl */ `
${ENV_PARS}
${FOG_FN}
uniform vec3 uPalette[${NSLOT}];
uniform vec4 uSlotProps[${NSLOT}];
uniform vec4 uState; // x lamps on, y brake, z reverse, w indicator blink
uniform float uShadow;
#ifdef USE_DETAIL
uniform sampler2D uDetail;
#endif
#ifdef USE_INSTANCING
varying vec3 vPaint;
varying vec3 vAccent;
varying vec4 vState;
#endif
varying vec3 vN;
varying vec3 vWP;
varying float vSlot;
varying vec2 vUv;

void main() {
  int s = int(vSlot + 0.5);
  vec3 base = uPalette[s];
  vec4 props = uSlotProps[s];
  vec4 st = uState;
  #ifdef USE_INSTANCING
  if (s == 0) base = vPaint;
  if (s == 1) base = vAccent;
  st = vState;
  #endif
  #ifdef USE_DETAIL
  vec4 dt = texture2D(uDetail, vUv);
  base = mix(base, dt.rgb, dt.a);
  #endif
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWP);
  float ndl = dot(N, uSunDir);
  // Two bands: a crisp terminator, lightly anti-aliased.
  float lit = smoothstep(-0.02, 0.06, ndl) * uShadow;
  vec3 amb = mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
  float kind = props.z;
  vec3 shadeCol = base * uShadowTint * 1.05 + base * amb * 0.18;
  vec3 litCol = base * (uSunColor * 0.92 + amb * 0.22);
  vec3 col = mix(shadeCol, litCol, lit);

  // Glass: dark, with a painted horizon reflection and a sky band.
  if (kind > 4.5 && kind < 5.5) {
    vec3 R = reflect(-V, N);
    float horizon = smoothstep(-0.05, 0.12, R.y);
    vec3 skyR = mix(uSkyHorizon * 0.55, uSkyZenith * 0.8 + uSkyHorizon * 0.2, horizon);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = mix(base * (0.55 + 0.45 * lit), skyR, 0.35 + 0.5 * fres);
    // a bold diagonal glint band
    float band = smoothstep(0.02, 0.0, abs(fract(dot(vWP.xz, vec2(0.37, 0.21)) + R.y * 0.6) - 0.5) - 0.08);
    col += uSunColor * band * 0.08 * (1.0 - uNight);
  }

  // Cel glint (specular as a hard-edged shape)
  vec3 H = normalize(uSunDir + V);
  float g = smoothstep(0.955, 0.97, dot(N, H)) * props.x * lit;
  col += uSunColor * g * 0.55;
  // Rim from the sky
  float rim = smoothstep(0.62, 0.8, 1.0 - max(dot(N, V), 0.0)) * props.y;
  col += uRimColor * rim * (0.22 + 0.25 * lit) * (0.6 + 0.4 * (N.y * 0.5 + 0.5));

  // Lamps
  float lampsOn = st.x;
  if (kind > 0.5 && kind < 1.5) col += vec3(1.0, 0.95, 0.82) * lampsOn * 2.6;
  else if (kind > 1.5 && kind < 2.5) col = mix(col, base * (0.9 + lampsOn * 1.6 + st.y * 4.0) + vec3(0.25, 0.02, 0.02) * st.y, clamp(lampsOn + st.y, 0.0, 1.0));
  else if (kind > 2.5 && kind < 3.5) col += vec3(1.0, 0.55, 0.1) * st.w * 2.5;
  else if (kind > 3.5 && kind < 4.5) col += vec3(1.0) * st.z * 2.0;

  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const INK_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec3 smoothNormal;
uniform float uInkWidth;
uniform vec3 uResolution;
uniform float uInkScale;
varying vec3 vWP;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  vec3 objectNormal = smoothNormal;
  #ifdef USE_SKINNING
  mat4 skinMatrix = mat4( 0.0 );
  skinMatrix += skinWeight.x * boneMatX;
  skinMatrix += skinWeight.y * boneMatY;
  skinMatrix += skinWeight.z * boneMatZ;
  skinMatrix += skinWeight.w * boneMatW;
  skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
  objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
  #endif
  #include <skinning_vertex>
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(transformed, 1.0);
  vWP = wp.xyz;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  vec3 wn = normalize(mat3(m) * objectNormal);
  vec4 clipN = projectionMatrix * viewMatrix * vec4(wn, 0.0);
  vec2 dirPx = clipN.xy * uResolution.xy;
  float l = length(dirPx);
  vec2 dir = l > 1e-6 ? dirPx / l : vec2(0.0);
  float d = max(clip.w, 0.1);
  float px = uInkWidth * uInkScale * (uResolution.y / 1080.0) * clamp(22.0 / d, 0.3, 1.0);
  clip.xy += dir * px * 2.0 / uResolution.xy * clip.w;
  gl_Position = clip;
}
`;

const INK_FRAG = /* glsl */ `
${ENV_PARS}
${FOG_FN}
uniform vec3 uInkColor;
varying vec3 vWP;
void main() {
  vec3 col = applyFog(uInkColor, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface ActorMaterialOptions {
  style: Record<string, SlotStyle>;
  slots: readonly string[];
  detail?: Texture | null;
  skinning?: boolean;
  instancing?: boolean;
  overrides?: Record<string, number | Color>;
}

export function makeActorMaterial(o: ActorMaterialOptions): ShaderMaterial {
  const palette: Color[] = [];
  const props: Vector4[] = [];
  for (let i = 0; i < NSLOT; i++) {
    const name = o.slots[i];
    const st = (name && o.style[name]) || { color: 0xff00ff };
    const ov = name ? o.overrides?.[name] : undefined;
    palette.push(ov instanceof Color ? ov.clone() : new Color(ov ?? st.color));
    props.push(new Vector4(st.spec ?? 0, st.rim ?? 0.5, st.emit ?? 0, st.shade ?? 1));
  }
  const defines: Record<string, string> = {};
  if (o.detail) defines.USE_DETAIL = '';
  const m = new ShaderMaterial({
    uniforms: {
      ...env,
      uPalette: { value: palette },
      uSlotProps: { value: props },
      uState: { value: new Vector4(0, 0, 0, 0) },
      uShadow: { value: 1 },
      uDetail: { value: o.detail ?? null },
    },
    defines,
    vertexShader: ACTOR_VERT,
    fragmentShader: ACTOR_FRAG,
    side: FrontSide,
  });
  return m;
}

export function makeInkMaterial(scale = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...env,
      uInkColor: { value: new Color(0x0a0812) },
      uInkScale: { value: scale },
    },
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    side: BackSide,
  });
}

/**
 * Adds `smoothNormal`: normals averaged across every vertex sharing a position, so
 * the inverted hull stays closed across hard edges and UV seams.
 */
export function addSmoothNormals(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = pos.count;
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const groups = new Map<string, number>();
  const gid = new Int32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    let id = groups.get(k);
    if (id === undefined) {
      id = next++;
      groups.set(k, id);
    }
    gid[i] = id;
  }
  const acc = new Float32Array(next * 3);
  const tri = idx ? idx.count / 3 : n / 3;
  const ax = [0, 0, 0], bx = [0, 0, 0], cx = [0, 0, 0];
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    ax[0] = pos.getX(a); ax[1] = pos.getY(a); ax[2] = pos.getZ(a);
    bx[0] = pos.getX(b); bx[1] = pos.getY(b); bx[2] = pos.getZ(b);
    cx[0] = pos.getX(c); cx[1] = pos.getY(c); cx[2] = pos.getZ(c);
    const e1x = bx[0] - ax[0], e1y = bx[1] - ax[1], e1z = bx[2] - ax[2];
    const e2x = cx[0] - ax[0], e2y = cx[1] - ax[1], e2z = cx[2] - ax[2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      const id = gid[v] * 3;
      acc[id] += nx;
      acc[id + 1] += ny;
      acc[id + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const id = gid[i] * 3;
    let x = acc[id], y = acc[id + 1], z = acc[id + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  g.setAttribute('smoothNormal', new BufferAttribute(out, 3));
}
