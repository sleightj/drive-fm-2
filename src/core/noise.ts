import { hash32 } from './rng';

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 1-D value noise in [-1,1]. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash32(seed, i) / 2147483648 - 1;
  const b = hash32(seed, i + 1) / 2147483648 - 1;
  return a + (b - a) * fade(f);
}

/** 2-D value noise in [-1,1]. */
export function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (a: number, b: number) => hash32(seed, a, b) / 2147483648 - 1;
  const u = fade(fx), v = fade(fy);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

export function fbm1(seed: number, x: number, oct = 3): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise1(seed + i * 101, x * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function fbm2(seed: number, x: number, y: number, oct = 3): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(seed + i * 101, x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
