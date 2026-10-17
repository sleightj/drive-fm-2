import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { env } from './environment';
import { ENV_PARS } from './glsl';

/**
 * The sky dome: a painted gradient (zenith → horizon) with a warm glow around the sun,
 * sun and moon discs, and stars at night. It follows the camera and never writes depth.
 */
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

const SKY_FRAG = /* glsl */ `
${ENV_PARS}
uniform vec3 uMoonDir;
varying vec3 vDir;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);
  // painted bands: horizon colour held low, a soft rise into the zenith
  float g = smoothstep(-0.05, 0.55, up);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(g, 0.8));
  // glow around the sun's azimuth near the horizon
  vec3 sd = normalize(vec3(uSunDir.x, max(uSunDir.y, -0.2), uSunDir.z));
  float sa = max(dot(d, sd), 0.0);
  col = mix(col, uSkyGlow, pow(sa, 4.0) * (1.0 - smoothstep(0.0, 0.6, up)) * 0.85);
  col += uSkyGlow * pow(sa, 40.0) * 0.6;
  // below the horizon: fog colour (the city's haze)
  col = mix(col, uFogColor, smoothstep(0.02, -0.12, up));
  // sun disc (by day) and moon (by night)
  float sunDisc = smoothstep(0.9993, 0.9996, dot(d, uSunDir)) * (1.0 - uNight);
  col = mix(col, vec3(1.0, 0.97, 0.9) * 1.6, sunDisc);
  float md = dot(d, normalize(uMoonDir));
  float moon = smoothstep(0.9990, 0.9993, md) * uNight;
  col = mix(col, vec3(0.92, 0.94, 1.0) * 1.3, moon);
  col += vec3(0.35, 0.4, 0.6) * pow(max(md, 0.0), 300.0) * uNight * 0.5;
  // stars
  if (uNight > 0.3 && up > 0.05) {
    vec3 c = floor(d * 220.0);
    float h = hash13(c);
    float star = step(0.9975, h) * smoothstep(0.05, 0.3, up);
    float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 60.0);
    col += vec3(0.9, 0.92, 1.0) * star * tw * (uNight - 0.3) * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function makeSky(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { ...env },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
  });
  const m = new Mesh(new SphereGeometry(5000, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -1000;
  m.name = 'sky';
  return m;
}
