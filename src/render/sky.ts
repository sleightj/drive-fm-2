import { BackSide, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, RepeatWrapping, RGBAFormat, ShaderMaterial, SphereGeometry, UnsignedByteType } from 'three';
import { env } from './environment';
import { ENV_PARS } from './glsl';

/**
 * The sky dome: a painted gradient (zenith → horizon) with a warm glow around the sun, the sun
 * and a painted moon where they really are in the sky (env.uSunSky / uMoonDir, not the key
 * light), two-tone painted clouds drifting on a deck, and stars at night. It follows the camera
 * and never writes depth.
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
uniform vec3 uSunSky;
uniform sampler2D uClouds;
uniform float uCloudCover;
varying vec3 vDir;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// explicit gradients: also valid inside the branches below
float cloudAt(vec2 p, vec2 gx, vec2 gy) {
  return textureGrad(uClouds, p, gx, gy).r * 0.72 + textureGrad(uClouds, p * 2.7 + vec2(0.37, 0.61), gx * 2.7, gy * 2.7).g * 0.28;
}
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);
  // painted bands: horizon colour held low, a soft rise into the zenith
  float g = smoothstep(-0.05, 0.55, up);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(g, 0.8));
  // glow around the sun near the horizon (around the moon, faintly, at night)
  vec3 sunD = normalize(uSunSky);
  vec3 gd = normalize(mix(sunD, normalize(uMoonDir), smoothstep(-0.05, -0.25, sunD.y)));
  gd = normalize(vec3(gd.x, max(gd.y, -0.2), gd.z));
  float sa = max(dot(d, gd), 0.0);
  col = mix(col, uSkyGlow, pow(sa, 4.0) * (1.0 - smoothstep(0.0, 0.6, up)) * 0.85);
  col += uSkyGlow * pow(sa, 40.0) * 0.6;

  // sun disc (where the sun is, clipped by the horizon) and a painted moon
  float horizonClip = smoothstep(-0.01, 0.015, up);
  float sd = dot(d, sunD);
  float sunDisc = smoothstep(0.9993, 0.9996, sd) * horizonClip * (1.0 - uNight * 0.8);
  vec3 sunCol = mix(vec3(1.0, 0.97, 0.9) * 1.7, uSkyGlow * 2.2 + vec3(0.3, 0.1, 0.0), smoothstep(0.35, 0.02, sunD.y));
  vec3 md3 = normalize(uMoonDir);
  float md = dot(d, md3);
  float moonVis = smoothstep(0.2, 0.6, uNight) * horizonClip;
  float moon = smoothstep(0.99905, 0.99925, md) * moonVis;
  // moon surface: soft grey maria from the cloud noise in the disc's own frame
  vec3 moonCol = vec3(0.95, 0.96, 1.0) * 1.45;
  if (moon > 0.0) {
    vec3 mx = normalize(cross(md3, vec3(0.0, 1.0, 0.0)));
    vec3 my = cross(mx, md3);
    vec2 mp = vec2(dot(d, mx), dot(d, my)) * 24.0;
    moonCol -= vec3(0.95, 0.96, 1.0) * 0.35 * smoothstep(0.5, 0.7, textureLod(uClouds, mp + vec2(0.3, 0.7), 0.0).r);
  }
  // halo: a tight bright ring and a wide faint one
  col += vec3(0.35, 0.42, 0.7) * (pow(max(md, 0.0), 900.0) * 0.5 + pow(max(md, 0.0), 60.0) * 0.07) * moonVis;

  // stars (above the haze; hidden by clouds below)
  vec3 stars = vec3(0.0);
  if (uNight > 0.3 && up > 0.05) {
    vec3 c = floor(d * 220.0);
    float h = hash13(c);
    float star = step(0.9975, h) * smoothstep(0.05, 0.3, up);
    float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 60.0);
    stars = vec3(0.9, 0.92, 1.0) * star * tw * (uNight - 0.3) * 1.4;
  }

  // painted clouds on a flat deck: crisp edges, a lit side toward the sun (or moon), a cool
  // shade side, thinning out toward the horizon
  float cloud = 0.0;
  vec3 cloudCol = vec3(0.0);
  if (up > 0.0) {
    vec2 cp = d.xz / (up + 0.1) * 0.11 + uTime * vec2(0.0016, 0.0006);
    vec2 gx = dFdx(cp), gy = dFdy(cp);
    float n = cloudAt(cp, gx, gy);
    float aa = max(fwidth(n), 1e-4);
    float cover = uCloudCover + 0.07 * uNight; // thinner at night: room for the moon and stars
    cloud = smoothstep(cover - aa, cover + aa, n) * smoothstep(0.0, 0.16, up);
    if (cloud > 0.001) {
      // key for the clouds: the sun by day, the moon by night
      vec3 kd = normalize(mix(sunD, md3, smoothstep(0.05, -0.15, sunD.y)));
      vec2 toKey = normalize(kd.xz + vec2(1e-4)) * 0.035;
      float n2 = cloudAt(cp + toKey, gx, gy);
      // denser toward the light = this side faces away from it
      float shade = smoothstep(-0.005, 0.03, n2 - n);
      // a thin bright rim just inside the edge facing the light
      float rim = (1.0 - smoothstep(cover + aa, cover + 0.05, n)) * (1.0 - shade);
      vec3 keyHue = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
      float keyI = mix(1.0, 0.17, uNight);
      vec3 lit = mix(uSkyHorizon, keyHue, 0.72) * keyI + uSkyGlow * pow(sa, 3.0) * 0.6;
      vec3 shd = mix(uSkyZenith, uShadowTint * 1.4, 0.55) * mix(1.15, 0.5, uNight) + uSkyGlow * pow(sa, 3.0) * 0.25;
      cloudCol = mix(lit, shd, shade * 0.85) + keyHue * rim * 0.12 * keyI;
      // far clouds melt into the horizon haze
      cloudCol = mix(cloudCol, col, (1.0 - smoothstep(0.02, 0.3, up)) * 0.55);
    }
  }
  col = mix(col, sunCol, sunDisc * (1.0 - cloud * 0.85));
  col = mix(col, moonCol, moon * (1.0 - cloud * 0.9));
  col += stars * (1.0 - cloud);
  col = mix(col, cloudCol, cloud * 0.92);

  // the area's haze rises a little above the horizon (stronger at night: the city's glow, in
  // the area's own colour), then below the horizon the fog colour takes over
  col = mix(col, uFogColor, exp(-max(up, 0.0) * 14.0) * (0.2 + 0.5 * uNight));
  col = mix(col, uFogColor, smoothstep(0.02, -0.12, up));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * A tileable cloud-noise texture: R = broad fbm (cloud masses), G = finer fbm (detail). Value
 * noise on a periodic lattice so the deck tiles without seams; 256² is plenty because the
 * shader thresholds the filtered field (smooth contours at any scale).
 */
function makeCloudTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    let s = seed >>> 0;
    for (let i = 0; i < v.length; i++) {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      s ^= s >>> 12;
      v[i] = (s & 0xffff) / 65535;
    }
    return v;
  };
  const noise = (x: number, y: number, period: number, v: Float32Array) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = v[y0 * period + x0], b = v[y0 * period + x1], c = v[y1 * period + x0], d = v[y1 * period + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (u: number, w: number, base: number, oct: number, seed: number) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) {
      const p = base << o;
      const lat = lattices[seed * 8 + o] ??= lattice(p, 0x51ed + seed * 977 + o * 131);
      sum += noise(u * p, w * p, p, lat) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
  const lattices: Float32Array[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, w = y / size;
      const r = fbm(u, w, 4, 5, 1);
      const g = fbm(u, w, 8, 4, 2);
      const i = (y * size + x) * 4;
      // spread the broad field so the threshold sweeps clear sky to overcast
      data[i] = Math.max(0, Math.min(255, Math.round(((r - 0.5) * 1.6 + 0.5) * 255)));
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function makeSky(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { ...env, uClouds: { value: makeCloudTexture() }, uCloudCover: { value: 0.6 } },
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
