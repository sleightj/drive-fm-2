import { Color, DataArrayTexture, DoubleSide, FrontSide, ShaderMaterial, Texture, Vector2 } from 'three';
import { env } from './environment';
import { ENV_PARS, FOG_FN, HEADLIGHT_FN } from './glsl';
// The texture build's manifest (layer name → index), so the shader can treat some layers specially.
import manifest from '../../public/assets/tex/world_layers.json';

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
 *
 * Layer classes (bit masks over the layer index, from the manifest by name):
 *  - signs (rs_*, gs_*): retro-reflective sheeting. In shade the face keeps a neutral, readable
 *    light instead of the hued shadow, and at night it throws the headlights back at the car.
 *  - see-through mesh (st_chainlink): holes are painted at alpha 0.4 (a sheen) and wires at 1.
 *    Up close the cutout is the usual alpha ≥ 0.5; as the texture minifies (mips average holes
 *    and wires), the wire coverage is tested against an ordered dither instead, so a far fence
 *    stays a faint, see-through mesh instead of vanishing or turning into a solid sheet.
 *  - offices (glass curtain walls, office bands and punched windows, far offices and glass): a
 *    lower share of lit windows than homes and shops, thinning through the night (env).
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
uniform float uWindowsOffice;
uniform vec3 uWindowsTime;
uniform float uEmitGain;
uniform uvec4 uSignMask;
uniform uvec4 uSheenMask;
uniform uvec4 uOfficeMask;
uniform vec2 uAlbedoSize;
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

bool inMask(uvec4 m, int l) {
  if (l < 0 || l > 127) return false;
  uint w = l < 32 ? m.x : l < 64 ? m.y : l < 96 ? m.z : m.w;
  return ((w >> uint(l & 31)) & 1u) != 0u;
}
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(floor(p), 4.0));
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[i.x + i.y * 4] + 0.5) / 16.0;
}

void main() {
  vec3 alb = vColor;
  vec4 em = vec4(0.0);
  int layerI = int(floor(vUvl.z + 0.5));
  bool isSign = false;
  #ifdef ALPHA_CUTOUT
  // texture minification (texels per pixel, log2) — outside any branch so derivatives are valid
  vec2 tc = vUvl.xy * uAlbedoSize;
  vec2 tdx = dFdx(tc), tdy = dFdy(tc);
  float lod = 0.5 * log2(max(max(dot(tdx, tdx), dot(tdy, tdy)), 1e-8));
  #endif
  if (vUvl.z >= 0.0) {
    vec4 t = texture(uAlbedo, vUvl);
    #ifdef ALPHA_CUTOUT
    if (inMask(uSheenMask, layerI)) {
      // wire coverage (holes are the 0.4 sheen); a crisp cut up close, dithered once minified
      float cov = clamp((t.a - 0.4) / 0.6, 0.0, 1.0);
      float thr = mix(1.0 / 6.0, bayer4(gl_FragCoord.xy), smoothstep(-0.25, 1.25, lod));
      if (cov < thr) discard;
    } else if (t.a < 0.5) discard;
    #endif
    alb *= t.rgb;
    em = texture(uEmit, vUvl);
    isSign = inMask(uSignMask, layerI);
  }
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float ndl = dot(N, uSunDir);
  // Soft, painted sun: a wide wrap, not a hard terminator.
  float sunT = smoothstep(0.25, 0.8, ndl * 0.5 + 0.5);
  vec3 amb = mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
  vec3 shadeLight = amb * 0.55 + uShadowTint * 0.55;
  // retro-reflective sign faces read in shade: a neutral light, not the shadow hue
  if (isSign) shadeLight = mix(vec3(dot(shadeLight, vec3(0.3333))) * 1.7, shadeLight, 0.25);
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
  if (isSign && uHeadOn > 0.001) {
    // the sheeting sends the headlights straight back toward the car (and the camera behind it)
    vec3 Lh = vWP - uHeadPos;
    float dh = length(Lh);
    Lh /= max(dh, 1e-3);
    float cone = smoothstep(0.55, 0.85, dot(Lh, uHeadDir));
    float facing = max(dot(N, -Lh), 0.0);
    // capped so the face blooms a little but keeps its colour and lettering
    float retro = cone * facing * facing * 3.0 / (1.0 + dh * dh * 0.0012) * smoothstep(170.0, 50.0, dh);
    col += alb * vec3(1.0, 0.95, 0.85) * min(retro, 1.5) * uHeadOn;
  }
  if (em.r + em.g + em.b > 0.004) {
    float w = smoothstep(0.6, 0.85, em.a);
    // window cell + building seed (integer 0-63 in aLight.a) + texture layer, all rounded:
    // interpolated constants carry ulp jitter that a float hash would amplify into speckle
    ivec2 cell = ivec2(floor(vUvl.xy + 1e-3));
    int seedI = int(floor(vLight.a + 0.5));
    float r = hash3u(ivec3(cell, seedI * 64 + layerI));
    float share = inMask(uOfficeMask, layerI) ? uWindowsOffice * uWindowsTime.y : uWindowsLit * uWindowsTime.x;
    float lit = mix(1.0, step(r, share), w);
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

const LAYERS: Record<string, number> = (manifest as { layers: Record<string, number> }).layers;
/** Bit mask (4 × 32 bits) of the layers whose name matches any pattern. */
function layerMask(...patterns: (string | RegExp)[]): number[] {
  const m = [0, 0, 0, 0];
  for (const [name, i] of Object.entries(LAYERS)) {
    if (i < 0 || i > 127) continue;
    if (patterns.some((p) => (typeof p === 'string' ? p === name : p.test(name)))) m[i >> 5] = (m[i >> 5] | (1 << (i & 31))) >>> 0;
  }
  return m;
}
export const LAYER_CLASSES = {
  sign: layerMask(/^rs_/, /^gs_/),
  sheen: layerMask('st_chainlink'),
  office: layerMask(/^fac_curtain_/, 'fac_office_band', 'fac_office_punch', 'far_office', 'far_glass'),
};

export function makeWorldMaterial(o: WorldMaterialOptions): ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.cutout) defines.ALPHA_CUTOUT = '';
  const img = (o.albedo as DataArrayTexture | null)?.image as { width?: number; height?: number } | undefined;
  return new ShaderMaterial({
    uniforms: {
      ...env,
      uAlbedo: { value: o.albedo },
      uEmit: { value: o.emit },
      uWindowsLit: worldShared.uWindowsLit,
      uWindowsOffice: worldShared.uWindowsOffice,
      uEmitGain: worldShared.uEmitGain,
      uSignMask: { value: LAYER_CLASSES.sign },
      uSheenMask: { value: LAYER_CLASSES.sheen },
      uOfficeMask: { value: LAYER_CLASSES.office },
      uAlbedoSize: { value: new Vector2(img?.width ?? 512, img?.height ?? 512) },
    },
    defines,
    vertexShader: WORLD_VERT,
    fragmentShader: WORLD_FRAG,
    vertexColors: true,
    side: o.doubleSided ? DoubleSide : FrontSide,
  });
}

export const worldShared = {
  /** share of lit windows in homes and shops (evening; env.uWindowsTime thins it late at night) */
  uWindowsLit: { value: 0.62 },
  /** share of lit windows in office towers (downtown's glass and office slabs) */
  uWindowsOffice: { value: 0.46 },
  uEmitGain: { value: 1.6 },
};

export const WORLD_DEFAULT_TINT = new Color(1, 1, 1);
