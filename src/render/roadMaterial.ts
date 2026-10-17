import { DataArrayTexture, LinearFilter, RGBAFormat, ShaderMaterial, UnsignedByteType, ClampToEdgeWrapping } from 'three';
import { env } from './environment';
import { ENV_PARS, FOG_FN, HEADLIGHT_FN } from './glsl';
import { WEAR_HEIGHT_RANGE } from '../road/wear';

/**
 * The road: flat painted asphalt with soft mottling, crisp anti-aliased lane paint computed
 * from the cross-section carried by each vertex, and the wear tile (height → shading,
 * cracks, patches, iron lids, standing water) that the physics feels.
 */

const ROAD_VERT = /* glsl */ `
attribute vec2 aST;
attribute vec4 aWear;
attribute vec4 aPaint0;
attribute vec4 aPaint1;
attribute vec2 aGore;
attribute vec3 aTone;
varying vec2 vST;
varying vec4 vWear;
varying vec4 vP0;
varying vec4 vP1;
varying vec2 vGore;
varying vec3 vTone;
varying vec3 vN;
varying vec3 vWP;
varying vec2 vFrame; // heading of the road at this vertex as (sin h, cos h) — for wear normals
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vST = aST; vWear = aWear; vP0 = aPaint0; vP1 = aPaint1; vGore = aGore; vTone = aTone;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROAD_FRAG = /* glsl */ `
precision highp sampler2DArray;
${ENV_PARS}
${FOG_FN}
${HEADLIGHT_FN}
uniform sampler2DArray uWearTex;
uniform vec2 uWearTexel; // 1/W, 1/H
uniform float uWearPxS;   // texels per metre along s (t resolution comes per vertex in vWear.w)
uniform float uDetail;    // 1 HIGH, 0.5 LOW, 0 VERY LOW
varying vec2 vST;
varying vec4 vWear;
varying vec4 vP0;
varying vec4 vP1;
varying vec2 vGore;
varying vec3 vTone;
varying vec3 vN;
varying vec3 vWP;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

// coverage of a line of width w centred at c, anti-aliased with the pixel footprint aa
float lineAA(float x, float c, float w, float aa) {
  return 1.0 - smoothstep(-aa, aa, abs(x - c) - w * 0.5);
}
// dashes along s: on for 'on' metres of each 'period'
float dashAA(float s, float period, float on, float aa) {
  float m = mod(s, period);
  return smoothstep(-aa, aa, m) * (1.0 - smoothstep(on - aa, on + aa, m));
}

void main() {
  float s = vST.x, t = vST.y;
  float aaT = max(fwidth(t), 1e-4) * 0.8;
  float aaS = max(fwidth(s), 1e-4) * 0.8;

  // ---- wear tile
  vec3 wuv = vWear.xyz;
  vec4 W = texture(uWearTex, wuv);
  float h = (W.r * 255.0 - 128.0) / 127.0 * ${WEAR_HEIGHT_RANGE.toFixed(4)};
  vec3 N = normalize(vN);
  // wear normal: height slopes in road space, tilted around the road frame
  float hS = (texture(uWearTex, wuv + vec3(uWearTexel.x, 0.0, 0.0)).r - texture(uWearTex, wuv - vec3(uWearTexel.x, 0.0, 0.0)).r) * 255.0 / 127.0 * ${WEAR_HEIGHT_RANGE.toFixed(4)} * uWearPxS * 0.5;
  float hT = (texture(uWearTex, wuv + vec3(0.0, uWearTexel.y, 0.0)).r - texture(uWearTex, wuv - vec3(0.0, uWearTexel.y, 0.0)).r) * 255.0 / 127.0 * ${WEAR_HEIGHT_RANGE.toFixed(4)} * vWear.w * 0.5;
  // road frame from screen derivatives of (s, t) → world
  vec3 dPdx = dFdx(vWP), dPdy = dFdy(vWP);
  vec2 dSTdx = dFdx(vST), dSTdy = dFdy(vST);
  float det = dSTdx.x * dSTdy.y - dSTdx.y * dSTdy.x;
  vec3 Ts = vec3(0.0), Tt = vec3(0.0);
  if (abs(det) > 1e-12) {
    Ts = normalize((dPdx * dSTdy.y - dPdy * dSTdx.y) / det);
    Tt = normalize((dPdy * dSTdx.x - dPdx * dSTdy.x) / det);
  }
  float bump = clamp(uDetail * 1.6, 0.0, 1.6);
  N = normalize(N - (Ts * hS + Tt * hT) * bump * 2.2);

  // ---- asphalt
  vec3 base = vTone;
  // soft painted mottling in world space (no speckle)
  float m1 = vnoise(vWP.xz * 0.11) * 0.6 + vnoise(vWP.xz * 0.37) * 0.4;
  base *= 0.9 + 0.2 * m1;
  // polished wheel paths are a touch darker, worn centres a touch lighter
  base *= 1.0 + clamp(h * 8.0, -0.12, 0.05);
  float mat = W.b;
  // patches: darker, fresher asphalt; trench seal: near-black tar; iron lids
  base = mix(base, base * vec3(0.62, 0.64, 0.7), smoothstep(0.35, 0.5, mat) * (1.0 - smoothstep(0.6, 0.7, mat)));
  base = mix(base, vec3(0.06, 0.06, 0.075), smoothstep(0.6, 0.7, mat) * (1.0 - smoothstep(0.9, 0.97, mat)));
  base = mix(base, vec3(0.19, 0.19, 0.21), smoothstep(0.92, 0.98, mat));
  // pothole interiors: darker with a warm gravel tint
  float hole = smoothstep(0.012, 0.04, -h);
  base = mix(base, base * vec3(0.55, 0.5, 0.46), hole * 0.85);
  // cracks and lid grooves
  float crack = W.g;
  base = mix(base, base * 0.35, crack * 0.85);

  // ---- paint
  float paintCov = 0.0;
  vec3 paintCol = vec3(0.93, 0.93, 0.9);
  float edgeL = vP0.x, edgeR = vP0.y, med = vP0.z, laneW = vP0.w;
  float lanesOut = vP1.x, lanesIn = vP1.y, hatch = vP1.z, flags = vP1.w;
  bool fYellow = mod(flags, 2.0) >= 1.0;
  bool fDashed = mod(floor(flags / 2.0), 2.0) >= 1.0;
  bool fNoCentre = mod(floor(flags / 4.0), 2.0) >= 1.0;
  bool fNoLanes = mod(floor(flags / 8.0), 2.0) >= 1.0;
  bool fGore = mod(floor(flags / 16.0), 2.0) >= 1.0;
  float w = laneW > 3.2 ? 0.15 : 0.12;
  // outer edge lines
  paintCov = max(paintCov, lineAA(t, edgeL, w, aaT));
  paintCov = max(paintCov, lineAA(t, edgeR, w, aaT));
  float inner = max(med, hatch);
  if (!fNoCentre) {
    if (med > 0.01) {
      // white lines along the raised median
      paintCov = max(paintCov, lineAA(t, med + 0.2, w, aaT));
      paintCov = max(paintCov, lineAA(t, -med - 0.2, w, aaT));
    } else if (hatch > 0.05) {
      // a hatched taper: two lines and diagonal zebra between them
      paintCov = max(paintCov, lineAA(t, hatch, w, aaT));
      paintCov = max(paintCov, lineAA(t, -hatch, w, aaT));
      float z = mod(s * 0.5 + t * 0.5, 1.5);
      float zebra = smoothstep(-aaS, aaS, z) * (1.0 - smoothstep(0.35 - aaS, 0.35 + aaS, z));
      paintCov = max(paintCov, zebra * (1.0 - smoothstep(hatch - aaT, hatch + aaT, abs(t))));
    } else {
      float c = lineAA(t, 0.0, w, aaT);
      if (fYellow) {
        paintCov = max(paintCov, c);
        paintCol = mix(paintCol, vec3(0.98, 0.72, 0.1), c);
      } else if (fDashed) {
        paintCov = max(paintCov, c * dashAA(s, 10.0, 5.0, aaS));
      } else {
        // avenues: solid white centre
        paintCov = max(paintCov, c);
      }
    }
  }
  if (!fNoLanes) {
    for (int i = 1; i < 3; i++) {
      float fi = float(i);
      if (fi < lanesOut) paintCov = max(paintCov, lineAA(t, inner + 0.25 * step(0.01, med) + laneW * fi, w, aaT) * dashAA(s + 3.0, 10.0, 5.0, aaS));
      if (fi < lanesIn) paintCov = max(paintCov, lineAA(t, -inner - 0.25 * step(0.01, med) - laneW * fi, w, aaT) * dashAA(s + 3.0, 10.0, 5.0, aaS));
    }
  }
  if (fGore) {
    float a = min(vGore.x, vGore.y), b = max(vGore.x, vGore.y);
    if (b - a > 0.05) {
      float inside = smoothstep(a - aaT, a + aaT, t) * (1.0 - smoothstep(b - aaT, b + aaT, t));
      float z = mod(s * 0.6 - t * 0.6, 2.0);
      float zebra = smoothstep(-aaS, aaS, z) * (1.0 - smoothstep(0.45 - aaS, 0.45 + aaS, z));
      paintCov = max(paintCov, zebra * inside);
    }
  }
  // paint wears: faded in the wheel paths, broken by cracks and holes
  float fade = 0.78 + 0.22 * vnoise(vec2(s * 0.7, t * 2.3));
  fade *= 1.0 - clamp(-h * 22.0, 0.0, 1.0);
  fade *= 1.0 - crack;
  base = mix(base, paintCol, paintCov * fade * 0.94);

  // ---- light
  float ndl = dot(N, uSunDir);
  float sunT = smoothstep(0.15, 0.75, ndl * 0.5 + 0.5);
  vec3 amb = mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
  vec3 shadeLight = amb * 0.55 + uShadowTint * 0.55;
  vec3 sunLight = uSunColor * 0.88 + amb * 0.3;
  vec3 col = base * mix(shadeLight, sunLight, sunT);
  col += base * headlight(vWP, N);

  // ---- standing water: a sky mirror with a sun glint
  float wet = W.a * uDetail;
  if (wet > 0.01) {
    vec3 V = normalize(vWP - uCamPos);
    vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
    vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 1.6, 0.0, 1.0));
    float glint = pow(max(dot(R, uSunDir), 0.0), 120.0) * (1.0 - uNight);
    vec3 water = sky * 0.75 + uSunColor * glint * 3.0 + col * 0.25;
    col = mix(col, water, smoothstep(0.1, 0.6, wet) * 0.85);
  }

  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function makeWearPool(layers: number, W: number, H: number): DataArrayTexture {
  const data = new Uint8Array(W * H * 4 * layers);
  for (let i = 0; i < W * H * layers; i++) { data[i * 4] = 128; }
  const tex = new DataArrayTexture(data, W, H, layers);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeRoadMaterial(wearTex: DataArrayTexture, pxS: number, detail: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...env,
      uWearTex: { value: wearTex },
      uWearTexel: { value: [1 / wearTex.image.width, 1 / wearTex.image.height] },
      uWearPxS: { value: pxS },
      uDetail: { value: detail },
    },
    vertexShader: ROAD_VERT,
    fragmentShader: ROAD_FRAG,
  });
}
