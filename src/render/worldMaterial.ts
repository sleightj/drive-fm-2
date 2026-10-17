import { Color, DataArrayTexture, DoubleSide, FrontSide, ShaderMaterial, Texture } from 'three';
import { env } from './environment';
import { ENV_PARS, FOG_FN, HEADLIGHT_FN } from './glsl';

/**
 * The painted world: buildings, walls, fences, sidewalks, props that are not inked.
 *
 * Vertex attributes (see src/world/kit/geom.ts for the builder that writes them):
 *  - position, normal
 *  - uvl   vec3  (u, v, layer) into the albedo/emissive texture arrays; layer < 0 = untextured
 *               (flat colour from `color` only, used for small trim)
 *  - color vec3  tint multiplied into the albedo (per-building colour variation)
 *  - aGrad float 0 at the foot of a wall → 1 at its top (painted vertical gradient: darker and
 *               more saturated at the base); < 0 disables the gradient (ground-level surfaces)
 *  - aLight vec4 rgb = baked street-lamp light reaching this vertex at night,
 *               a = per-building window seed, an integer 0-63 (which windows are lit)
 *
 * Textures:
 *  - uAlbedo  sampler2DArray RGBA: painted colour, alpha = coverage (cutouts below 0.5)
 *  - uEmit    sampler2DArray RGBA: night emissive colour; alpha ≥ 0.9 = window region, lit or
 *             dark at random per window (one window per texture repeat); alpha ≈ 0.4 = always
 *             lit at night (neon, signs, lanterns). Painters stamp alpha over whole regions
 *             (paintlib emitKind) so filtering never mixes the two kinds at a window's edge.
 */

const WORLD_VERT = /* glsl */ `
attribute vec3 uvl;
attribute float aGrad;
attribute vec4 aLight;
varying vec3 vUvl;
varying vec3 vColor;
varying float vGrad;
varying vec4 vLight;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #endif
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUvl = uvl;
  #ifdef USE_COLOR
  vColor = color;
  #else
  vColor = vec3(1.0);
  #endif
  vGrad = aGrad;
  vLight = aLight;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WORLD_FRAG = /* glsl */ `
precision highp sampler2DArray;
${ENV_PARS}
${FOG_FN}
${HEADLIGHT_FN}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uEmit;
uniform float uWindowsLit;
uniform float uEmitGain;
varying vec3 vUvl;
varying vec3 vColor;
varying float vGrad;
varying vec4 vLight;
varying vec3 vN;
varying vec3 vWP;

float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// Integer hash (pcg3d): exact for integer inputs, so per-window decisions never flicker.
float hash3u(ivec3 i) {
  uvec3 v = uvec3(i) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float(v.x & 0xffffffu) / 16777216.0;
}

void main() {
  vec3 alb = vColor;
  vec4 em = vec4(0.0);
  if (vUvl.z >= 0.0) {
    vec4 t = texture(uAlbedo, vUvl);
    #ifdef ALPHA_CUTOUT
    if (t.a < 0.5) discard;
    #endif
    alb *= t.rgb;
    em = texture(uEmit, vUvl);
  }
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float ndl = dot(N, uSunDir);
  // Soft, painted sun: a wide wrap, not a hard terminator.
  float sunT = smoothstep(0.25, 0.8, ndl * 0.5 + 0.5);
  vec3 amb = mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
  vec3 shadeLight = amb * 0.55 + uShadowTint * 0.55;
  vec3 sunLight = uSunColor * 0.92 + amb * 0.28;
  vec3 light = mix(shadeLight, sunLight, sunT);

  // Painted vertical gradient: darker, more saturated at the foot of every wall.
  float g = vGrad < 0.0 ? 1.0 : clamp(vGrad, 0.0, 1.0);
  float lum = dot(alb, vec3(0.299, 0.587, 0.114));
  vec3 sat = mix(vec3(lum), alb, 1.0 + 0.45 * (1.0 - g));
  vec3 col = sat * light * mix(0.58, 1.1, smoothstep(0.0, 0.9, g));
  // a hint of the shadow hue pooled at the base
  col = mix(col, col * uShadowTint * 1.6, (1.0 - smoothstep(0.0, 0.35, g)) * 0.35 * step(0.0, vGrad));

  // Night: baked lamp pools, the player's headlights, lit windows and neon.
  col += alb * vLight.rgb * uLampsOn;
  col += alb * headlight(vWP, N);
  if (em.r + em.g + em.b > 0.004) {
    float w = smoothstep(0.6, 0.85, em.a);
    // window cell + building seed (integer 0-63 in aLight.a) + texture layer, all rounded:
    // interpolated constants carry ulp jitter that a float hash would amplify into speckle
    ivec2 cell = ivec2(floor(vUvl.xy + 1e-3));
    int seedI = int(floor(vLight.a + 0.5));
    int layerI = int(floor(vUvl.z + 0.5));
    float r = hash3u(ivec3(cell, seedI * 64 + layerI));
    float lit = mix(1.0, step(r, uWindowsLit), w);
    // a few windows in a different colour temperature
    em.rgb = mix(em.rgb, em.rgb * vec3(0.7, 0.95, 1.25), step(0.82, h11(r * 77.0)) * w);
    col += em.rgb * lit * uLampsOn * uEmitGain;
  }

  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface WorldMaterialOptions {
  albedo: Texture | DataArrayTexture | null;
  emit: Texture | DataArrayTexture | null;
  cutout?: boolean;
  doubleSided?: boolean;
}

export function makeWorldMaterial(o: WorldMaterialOptions): ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.cutout) defines.ALPHA_CUTOUT = '';
  return new ShaderMaterial({
    uniforms: {
      ...env,
      uAlbedo: { value: o.albedo },
      uEmit: { value: o.emit },
      uWindowsLit: worldShared.uWindowsLit,
      uEmitGain: worldShared.uEmitGain,
    },
    defines,
    vertexShader: WORLD_VERT,
    fragmentShader: WORLD_FRAG,
    vertexColors: true,
    side: o.doubleSided ? DoubleSide : FrontSide,
  });
}

export const worldShared = {
  uWindowsLit: { value: 0.62 },
  uEmitGain: { value: 1.6 },
};

export const WORLD_DEFAULT_TINT = new Color(1, 1, 1);
