import { Color, Vector3 } from 'three';

/**
 * Shared lighting/fog environment. Every game material references these uniform
 * objects directly, so updating a value here updates every material at once.
 */
export const env = {
  uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new Color(1, 0.96, 0.9) },
  uAmbTop: { value: new Color(0.45, 0.55, 0.8) },
  uAmbBottom: { value: new Color(0.35, 0.3, 0.35) },
  uShadowTint: { value: new Color(0.42, 0.36, 0.72) },
  uRimColor: { value: new Color(0.6, 0.8, 1.0) },
  uFogColor: { value: new Color(0.6, 0.75, 0.9) },
  uFogSunColor: { value: new Color(1.0, 0.85, 0.7) },
  uFogDensity: { value: 0.0012 },
  uFogStart: { value: 40 },
  uFogHeight: { value: 0.012 },
  uSkyZenith: { value: new Color(0.1, 0.3, 0.8) },
  uSkyHorizon: { value: new Color(0.6, 0.8, 1.0) },
  uSkyGlow: { value: new Color(1.0, 0.7, 0.4) },
  uNight: { value: 0 },
  uLampsOn: { value: 0 },
  uTime: { value: 0 },
  uCamPos: { value: new Vector3() },
  uMoonDir: { value: new Vector3(-0.3, 0.6, -0.5).normalize() },
  // Player headlights (analytic spot) for the world shaders.
  uHeadPos: { value: new Vector3() },
  uHeadDir: { value: new Vector3(0, 0, 1) },
  uHeadOn: { value: 0 },
  // Outline (ink) scale in device pixels at 1080p; scaled by resolution.
  uInkWidth: { value: 3.5 },
  uResolution: { value: new Vector3(1920, 1080, 1) },
};

export type Env = typeof env;

/** Time-of-day keyframe: everything the look needs at that hour. */
export interface SkyKey {
  h: number; // hour 0..24
  sun: [number, number, number];
  sunI: number;
  ambTop: [number, number, number];
  ambBottom: [number, number, number];
  shadow: [number, number, number];
  rim: [number, number, number];
  zenith: [number, number, number];
  horizon: [number, number, number];
  glow: [number, number, number];
  fog: [number, number, number];
  fogSun: [number, number, number];
  fogDensity: number;
  night: number;
  lamps: number;
}

const hex = (h: number): [number, number, number] => {
  const c = new Color(h); // sRGB hex → linear working space
  return [c.r, c.g, c.b];
};

/**
 * The day. Colours are authored as sRGB hex and stored linear. Shadow tints are
 * deliberately strongly hued (purple/teal), never just darker.
 */
export const SKY_KEYS: SkyKey[] = [
  { h: 0, sun: hex(0x8fa8ff), sunI: 0.32, ambTop: hex(0x1d2a6e), ambBottom: hex(0x140f2e), shadow: hex(0x2a2470), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
  { h: 4.6, sun: hex(0x8fa8ff), sunI: 0.3, ambTop: hex(0x22307a), ambBottom: hex(0x1a1238), shadow: hex(0x2d2678), rim: hex(0x5a84ff), zenith: hex(0x07103a), horizon: hex(0x2a3580), glow: hex(0x5a4aa8), fog: hex(0x1d2766), fogSun: hex(0x3a3a90), fogDensity: 0.0016, night: 1, lamps: 1 },
  // twilight before dawn
  { h: 5.3, sun: hex(0xb09cff), sunI: 0.35, ambTop: hex(0x3f3f9a), ambBottom: hex(0x2c1c4a), shadow: hex(0x3b2a86), rim: hex(0xff8fc8), zenith: hex(0x101a5a), horizon: hex(0x7a5ab8), glow: hex(0xff7aa8), fog: hex(0x4a4296), fogSun: hex(0xd879b0), fogDensity: 0.0016, night: 0.8, lamps: 1 },
  // dawn
  { h: 6.1, sun: hex(0xffa27a), sunI: 0.95, ambTop: hex(0x7d7ad0), ambBottom: hex(0x5a3a5e), shadow: hex(0x5a3fa8), rim: hex(0xffb0d0), zenith: hex(0x2a4cb0), horizon: hex(0xffa8b8), glow: hex(0xffb070), fog: hex(0xd898c0), fogSun: hex(0xffc090), fogDensity: 0.0013, night: 0.25, lamps: 0.6 },
  { h: 7.3, sun: hex(0xffd8a8), sunI: 1.1, ambTop: hex(0x8cb0f0), ambBottom: hex(0x6a5070), shadow: hex(0x5a50b8), rim: hex(0xbfe0ff), zenith: hex(0x2a62d8), horizon: hex(0xb8d8ff), glow: hex(0xffd0a0), fog: hex(0xb0c8f0), fogSun: hex(0xffe0b8), fogDensity: 0.0011, night: 0, lamps: 0 },
  // day
  { h: 12, sun: hex(0xfff4e0), sunI: 1.25, ambTop: hex(0x86b8ff), ambBottom: hex(0x7a6a78), shadow: hex(0x5a58c8), rim: hex(0xc8ecff), zenith: hex(0x1f5fe0), horizon: hex(0x9fd8ff), glow: hex(0xfff0c0), fog: hex(0xa8d4f8), fogSun: hex(0xfff0d0), fogDensity: 0.001, night: 0, lamps: 0 },
  { h: 16, sun: hex(0xffe4b8), sunI: 1.2, ambTop: hex(0x86b0f8), ambBottom: hex(0x7a6070), shadow: hex(0x5a4cc0), rim: hex(0xd0e8ff), zenith: hex(0x2458d0), horizon: hex(0xb0d4ff), glow: hex(0xffe0a0), fog: hex(0xb0ccf0), fogSun: hex(0xffe0b0), fogDensity: 0.001, night: 0, lamps: 0 },
  // dusk
  { h: 17.6, sun: hex(0xff8a4a), sunI: 1.05, ambTop: hex(0x8a6ac8), ambBottom: hex(0x6a3a58), shadow: hex(0x5a2fa0), rim: hex(0xffa0c0), zenith: hex(0x3a3aa8), horizon: hex(0xff8a7a), glow: hex(0xff7a30), fog: hex(0xf09090), fogSun: hex(0xffa060), fogDensity: 0.0012, night: 0.1, lamps: 0.5 },
  // evening
  { h: 18.5, sun: hex(0xff6a5a), sunI: 0.6, ambTop: hex(0x5a4aa8), ambBottom: hex(0x4a2848), shadow: hex(0x46248e), rim: hex(0xff7ab0), zenith: hex(0x1c2280), horizon: hex(0xd8608a), glow: hex(0xff6a50), fog: hex(0x8a4a90), fogSun: hex(0xff7a6a), fogDensity: 0.0013, night: 0.45, lamps: 1 },
  // twilight
  { h: 19.4, sun: hex(0x9a8aff), sunI: 0.38, ambTop: hex(0x34349a), ambBottom: hex(0x24163e), shadow: hex(0x33247a), rim: hex(0x7a7aff), zenith: hex(0x0c1250), horizon: hex(0x4a3a9a), glow: hex(0x8a4ab0), fog: hex(0x2c2a78), fogSun: hex(0x5a3a9a), fogDensity: 0.0015, night: 0.85, lamps: 1 },
  // night
  { h: 20.5, sun: hex(0x8fa8ff), sunI: 0.32, ambTop: hex(0x1d2a6e), ambBottom: hex(0x140f2e), shadow: hex(0x2a2470), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
  { h: 24, sun: hex(0x8fa8ff), sunI: 0.32, ambTop: hex(0x1d2a6e), ambBottom: hex(0x140f2e), shadow: hex(0x2a2470), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
];

export const TIME_NAMES: Record<string, number> = {
  dawn: 6.15,
  day: 12.5,
  noon: 12.5,
  dusk: 17.55,
  evening: 18.55,
  twilight: 19.4,
  night: 22.5,
};

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number, out: Color) {
  out.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/** Sun direction for an hour: rises east (+X), sets west (-X), arcs south (-Z). */
export function sunDirection(hour: number, out: Vector3): Vector3 {
  const a = ((hour - 6) / 12) * Math.PI; // 0 at 6h, PI at 18h
  const elev = Math.sin(a);
  out.set(Math.cos(a), elev * 0.92 + 0.0, -0.38);
  return out.normalize();
}

const tmpV = new Vector3();

export interface EnvState {
  hour: number;
  night: number;
  lamps: number;
  sunAbove: boolean;
}

/** Apply the palette for `hour` to the shared uniforms. */
export function applyTimeOfDay(hour: number, fogTint?: Color, fogTintAmount = 0): EnvState {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= hour) i++;
  const a = SKY_KEYS[i];
  const b = SKY_KEYS[i + 1];
  const t = smooth(Math.min(1, Math.max(0, (hour - a.h) / Math.max(1e-6, b.h - a.h))));
  const s = env.uSunColor.value;
  lerp3(a.sun, b.sun, t, s);
  s.multiplyScalar(a.sunI + (b.sunI - a.sunI) * t);
  lerp3(a.ambTop, b.ambTop, t, env.uAmbTop.value);
  lerp3(a.ambBottom, b.ambBottom, t, env.uAmbBottom.value);
  lerp3(a.shadow, b.shadow, t, env.uShadowTint.value);
  lerp3(a.rim, b.rim, t, env.uRimColor.value);
  lerp3(a.zenith, b.zenith, t, env.uSkyZenith.value);
  lerp3(a.horizon, b.horizon, t, env.uSkyHorizon.value);
  lerp3(a.glow, b.glow, t, env.uSkyGlow.value);
  lerp3(a.fog, b.fog, t, env.uFogColor.value);
  lerp3(a.fogSun, b.fogSun, t, env.uFogSunColor.value);
  if (fogTint && fogTintAmount > 0) {
    env.uFogColor.value.lerp(fogTint, fogTintAmount);
    env.uFogSunColor.value.lerp(fogTint, fogTintAmount * 0.5);
  }
  env.uFogDensity.value = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  const night = a.night + (b.night - a.night) * t;
  const lamps = a.lamps + (b.lamps - a.lamps) * t;
  env.uNight.value = night;
  env.uLampsOn.value = lamps;
  // Key light: the sun by day, the moon by night (both from above the horizon).
  sunDirection(hour, tmpV);
  const sunAbove = tmpV.y > -0.02;
  if (sunAbove) {
    env.uSunDir.value.copy(tmpV);
    if (env.uSunDir.value.y < 0.12) env.uSunDir.value.y = 0.12; // keep a usable key light at the horizon
    env.uSunDir.value.normalize();
  } else {
    // moon roughly opposite, but kept high enough to light the world
    env.uSunDir.value.set(-tmpV.x * 0.6, Math.max(0.45, -tmpV.y), 0.35).normalize();
  }
  env.uMoonDir.value.set(-tmpV.x, -tmpV.y, 0.3).normalize();
  return { hour, night, lamps, sunAbove };
}
