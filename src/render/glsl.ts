/** Shared GLSL chunks for every game material. */

export const ENV_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uShadowTint;
uniform vec3 uRimColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uFogHeight;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform float uNight;
uniform float uLampsOn;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
`;

export const FOG_FN = /* glsl */ `
// Colour-tinted distance fog, thicker low down, glowing toward the sun.
float fogAmount(vec3 worldPos) {
  vec3 v = worldPos - uCamPos;
  float d = length(v);
  float h = clamp(exp(-(worldPos.y - uCamPos.y + 20.0) * uFogHeight), 0.35, 2.2);
  float f = 1.0 - exp(-max(d - uFogStart, 0.0) * uFogDensity * h);
  return clamp(f, 0.0, 1.0);
}
vec3 fogColorAt(vec3 worldPos) {
  vec3 v = normalize(worldPos - uCamPos);
  float s = pow(max(dot(v, uSunDir), 0.0), 6.0) * (1.0 - uNight * 0.7);
  return mix(uFogColor, uFogSunColor, s);
}
vec3 applyFog(vec3 col, vec3 worldPos) {
  return mix(col, fogColorAt(worldPos), fogAmount(worldPos));
}
`;

export const HEADLIGHT_FN = /* glsl */ `
// The player's headlight pair as one analytic spot, for world surfaces.
vec3 headlight(vec3 worldPos, vec3 n) {
  if (uHeadOn <= 0.001) return vec3(0.0);
  vec3 L = worldPos - uHeadPos;
  float d = length(L);
  L /= max(d, 1e-3);
  float cone = smoothstep(0.80, 0.95, dot(L, uHeadDir));
  float fall = 1.0 / (1.0 + d * d * 0.004);
  float facing = clamp(dot(n, -L) * 0.8 + 0.4, 0.0, 1.0);
  return vec3(1.0, 0.93, 0.78) * cone * fall * facing * uHeadOn * 2.2 * smoothstep(80.0, 20.0, d);
}
`;

export const DITHER_FN = /* glsl */ `
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
