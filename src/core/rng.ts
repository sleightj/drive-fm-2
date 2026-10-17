/** Deterministic hashing and random streams. Everything procedural derives from these. */

export function hash32(...xs: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (let x of xs) {
    x = Math.floor(x) | 0;
    h ^= x & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (x >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  // final avalanche
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** sfc32 generator. */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number) {
    this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = seed >>> 0;
    for (let i = 0; i < 12; i++) this.next();
  }
  static of(...keys: number[]) { return new Rng(hash32(...keys)); }
  next(): number {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let tot = 0;
    for (const w of weights) tot += Math.max(0, w);
    let r = this.next() * tot;
    for (let i = 0; i < items.length; i++) { r -= Math.max(0, weights[i]); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
}

/** Uniform float in [0,1) from integer keys (stateless). */
export function rand01(...keys: number[]) { return hash32(...keys) / 4294967296; }
