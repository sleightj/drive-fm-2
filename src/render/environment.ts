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
  // The sun where it really is (sky disc and glow); uSunDir is the key light, which hands over
  // to the moon at night and never drops below the horizon.
  uSunSky: { value: new Vector3(0.4, 0.8, -0.3).normalize() },
  // Colour grade for the hour (display space; see GRADE_KEYS). The post chain applies it; on VERY
  // LOW, where there is no post chain, uGradeOn = 1 makes every material apply it itself.
  uGradeLift: { value: new Vector3(0, 0, 0) },
  uGradeGamma: { value: new Vector3(1, 1, 1) },
  uGradeGain: { value: new Vector3(1, 1, 1) },
  uGradeSat: { value: new Vector3(1, 0, 0) }, // x saturation, y extra push on greys (vibrance), z contrast
  uGradeOn: { value: 0 },
  uGradeVig: { value: new Vector3(0, 0, 0.16) }, // x = highlight hue-keep (night share), z = vignette (post chain)
  // share of windows lit at this hour (x homes and shops, y offices)
  uWindowsTime: { value: new Vector3(1, 1, 1) },
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
  { h: 0, sun: hex(0x8fa8ff), sunI: 0.26, ambTop: hex(0x19245f), ambBottom: hex(0x110d28), shadow: hex(0x252063), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
  { h: 4.6, sun: hex(0x8fa8ff), sunI: 0.26, ambTop: hex(0x1d2a6c), ambBottom: hex(0x161032), shadow: hex(0x29236e), rim: hex(0x5a84ff), zenith: hex(0x07103a), horizon: hex(0x2a3580), glow: hex(0x5a4aa8), fog: hex(0x1d2766), fogSun: hex(0x3a3a90), fogDensity: 0.0016, night: 1, lamps: 1 },
  // twilight before dawn
  { h: 5.3, sun: hex(0xb09cff), sunI: 0.35, ambTop: hex(0x3f3f9a), ambBottom: hex(0x2c1c4a), shadow: hex(0x3b2a86), rim: hex(0xff8fc8), zenith: hex(0x101a5a), horizon: hex(0x7a5ab8), glow: hex(0xff7aa8), fog: hex(0x4a4296), fogSun: hex(0xd879b0), fogDensity: 0.0016, night: 0.8, lamps: 1 },
  // dawn: pale gold light through a lilac morning mist, cool blue-teal shadows (dusk is the
  // hot one: orange-red sun, magenta haze, purple shadows)
  { h: 6.1, sun: hex(0xffc890), sunI: 0.95, ambTop: hex(0x8aa2e0), ambBottom: hex(0x56506e), shadow: hex(0x3c5cb4), rim: hex(0xffe0b8), zenith: hex(0x3a6ad0), horizon: hex(0xffd0b4), glow: hex(0xffc878), fog: hex(0xc4bce4), fogSun: hex(0xffdcb0), fogDensity: 0.0015, night: 0.25, lamps: 0.6 },
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
  { h: 20.5, sun: hex(0x8fa8ff), sunI: 0.26, ambTop: hex(0x19245f), ambBottom: hex(0x110d28), shadow: hex(0x252063), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
  { h: 24, sun: hex(0x8fa8ff), sunI: 0.26, ambTop: hex(0x19245f), ambBottom: hex(0x110d28), shadow: hex(0x252063), rim: hex(0x4f7dff), zenith: hex(0x050a2a), horizon: hex(0x1b2a6b), glow: hex(0x3a3f9a), fog: hex(0x16205a), fogSun: hex(0x2a3a8a), fogDensity: 0.0016, night: 1, lamps: 1 },
];

/**
 * The grade for the hour, in display (sRGB) space: c = c·gain + lift·(1 − c), then c^gamma,
 * an S-curve of strength `con`, then saturation `sat` with an extra push `vib` on greys.
 * Identity: lift 0, gamma 1, gain 1, sat 1, vib 0, con 0. Kept gentle: the palette above does
 * the heavy lifting; the grade adds punch, a tinted floor to the shadows and the hour's cast.
 */
export interface GradeKey {
  h: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  sat: number;
  vib: number;
  con: number;
}
const NIGHT_GRADE: Omit<GradeKey, 'h'> = { lift: [0.012, 0.006, 0.034], gamma: [1.06, 1.05, 1.0], gain: [1.0, 1.0, 1.03], sat: 1.1, vib: 0.16, con: 0.16 };
export const GRADE_KEYS: GradeKey[] = [
  { h: 0, ...NIGHT_GRADE },
  { h: 4.6, ...NIGHT_GRADE },
  { h: 5.3, lift: [0.024, 0.012, 0.048], gamma: [1.0, 1.0, 0.97], gain: [1.02, 0.99, 1.03], sat: 1.1, vib: 0.16, con: 0.13 },
  // dawn: gold highlights over a cool floor, soft and misty
  { h: 6.1, lift: [0.018, 0.028, 0.05], gamma: [0.99, 1.0, 1.0], gain: [1.04, 1.01, 0.96], sat: 1.03, vib: 0.12, con: 0.06 },
  { h: 7.3, lift: [0.02, 0.014, 0.035], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.99], sat: 1.06, vib: 0.14, con: 0.1 },
  // day: clean, punchy, a lavender floor under the shadows
  { h: 12, lift: [0.018, 0.012, 0.036], gamma: [1, 1, 1], gain: [1.01, 1.0, 0.99], sat: 1.07, vib: 0.16, con: 0.12 },
  { h: 16, lift: [0.02, 0.012, 0.036], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.98], sat: 1.07, vib: 0.16, con: 0.12 },
  // dusk: warm gain, magenta floor
  { h: 17.6, lift: [0.04, 0.012, 0.045], gamma: [0.98, 1.0, 1.0], gain: [1.05, 0.98, 0.94], sat: 1.1, vib: 0.18, con: 0.13 },
  // evening: rose to violet
  { h: 18.5, lift: [0.035, 0.01, 0.055], gamma: [0.97, 0.98, 0.97], gain: [1.03, 0.97, 1.0], sat: 1.12, vib: 0.2, con: 0.13 },
  // twilight: cool, deep blue floor
  { h: 19.4, lift: [0.018, 0.01, 0.048], gamma: [1.02, 1.02, 0.98], gain: [0.99, 0.99, 1.04], sat: 1.12, vib: 0.18, con: 0.14 },
  { h: 20.5, ...NIGHT_GRADE },
  { h: 24, ...NIGHT_GRADE },
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

/**
 * Moon direction for an hour: rises in the east at dusk, crosses the northern sky low (about
 * 30° up at its highest) and sets in the west at dawn. The road heads broadly north, so the
 * moon hangs ahead of the driver at night, where the wide view actually shows it.
 */
export function moonDirection(hour: number, out: Vector3): Vector3 {
  const t = (((hour - 18.2 + 24) % 24) / 12.0); // 0 at 18.2h, 1 at 6.2h
  const a = Math.min(1.08, Math.max(-0.08, t)) * Math.PI;
  out.set(Math.cos(a), Math.sin(a) * 0.6 - 0.04, Math.sin(a) * 0.8 + 0.25);
  return out.normalize();
}

const tmpV = new Vector3();
const tmpM = new Vector3();
const tmpK = new Vector3();

export interface EnvState {
  hour: number;
  night: number;
  lamps: number;
  sunAbove: boolean;
}

/** Strength of the per-area tint in the night grade's shadow floor (display units at night). */
const MOOD_CAST = 0.02;

function gradeAt(hour: number) {
  let i = 0;
  while (i < GRADE_KEYS.length - 2 && GRADE_KEYS[i + 1].h <= hour) i++;
  const a = GRADE_KEYS[i], b = GRADE_KEYS[i + 1];
  const t = smooth(Math.min(1, Math.max(0, (hour - a.h) / Math.max(1e-6, b.h - a.h))));
  const L = (x: number, y: number) => x + (y - x) * t;
  env.uGradeLift.value.set(L(a.lift[0], b.lift[0]), L(a.lift[1], b.lift[1]), L(a.lift[2], b.lift[2]));
  env.uGradeGamma.value.set(L(a.gamma[0], b.gamma[0]), L(a.gamma[1], b.gamma[1]), L(a.gamma[2], b.gamma[2]));
  env.uGradeGain.value.set(L(a.gain[0], b.gain[0]), L(a.gain[1], b.gain[1]), L(a.gain[2], b.gain[2]));
  env.uGradeSat.value.set(L(a.sat, b.sat), L(a.vib, b.vib), L(a.con, b.con));
}

/** Share of windows lit through the night: full in the evening, thinning after midnight. */
function windowsAt(hour: number) {
  // hours since 17:00, wrapped (0..24)
  const h = (hour - 17 + 24) % 24;
  // homes: all on by 19h, thinning from 23h to 3h (to 75 %), back up a little before dawn
  const home = h < 6 ? 1 : h < 10 ? 1 - 0.25 * smooth((h - 6) / 4) : h < 12 ? 0.75 + 0.1 * smooth((h - 10) / 2) : 0.85;
  // offices: busy at 18-20h, emptying through the evening to 55 %
  const office = h < 3 ? 1 : h < 8 ? 1 - 0.45 * smooth((h - 3) / 5) : 0.55;
  env.uWindowsTime.value.set(home, office, 1);
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
  env.uGradeVig.value.x = night; // lights keep their colour past white at night (post.ts dfmHueKeep)
  env.uLampsOn.value = lamps;
  gradeAt(hour);
  if (fogTint && fogTintAmount > 0) {
    // after dark each area's haze colour also tints the grade's shadow floor, so the moods stay
    // apart when the palette has gone blue everywhere (the sky shows the haze as a city glow)
    const m = Math.max(fogTint.r, fogTint.g, fogTint.b, 1e-3);
    const k = MOOD_CAST * night * (fogTintAmount / 0.35);
    env.uGradeLift.value.x += (fogTint.r / m) * k;
    env.uGradeLift.value.y += (fogTint.g / m) * k;
    env.uGradeLift.value.z += (fogTint.b / m) * k;
  }
  windowsAt(hour);
  // Sun and moon where they are in the sky.
  sunDirection(hour, tmpV);
  moonDirection(hour, tmpM);
  env.uSunSky.value.copy(tmpV);
  env.uMoonDir.value.copy(tmpM);
  const sunAbove = tmpV.y > -0.02;
  // Key light: the sun by day (kept at least 7° up, so the world stays lit at the horizon), the
  // moon by night (kept high, so it lights the city from above). The hand-over is a cross-fade
  // through the half hour around sunset/sunrise, with the key dimmed through it, so the light
  // never jumps direction.
  tmpK.copy(tmpV);
  if (tmpK.y < 0.12) { tmpK.y = 0.12; tmpK.normalize(); }
  const moonKey = tmpM.set(tmpM.x * 0.55, Math.max(0.5, tmpM.y) + 0.35, tmpM.z * 0.55).normalize();
  const w = smooth(Math.min(1, Math.max(0, (tmpV.y + 0.1) / 0.22))); // 1 = sun, 0 = moon
  env.uSunDir.value.copy(moonKey).lerp(tmpK, w).normalize();
  s.multiplyScalar(0.55 + 0.45 * Math.abs(2 * w - 1));
  return { hour, night, lamps, sunAbove };
}
