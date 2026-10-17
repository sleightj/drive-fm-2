import { hash32 } from '../core/rng';
import { MOODS, Mood, MOOD_INDEX } from '../world/moods';
import { PLACES, Place } from '../world/places';
import { smoothstep } from '../core/math';

/**
 * Districts: a jittered-grid Voronoi field over the plane. Each cell has one mood and a
 * place name. Neighbouring cells along the road's progress direction (+Z) and across it
 * get different moods by construction, so the roadside changes every few kilometres.
 */
export const DISTRICT_CELL = 2100;

export interface District {
  i: number;
  j: number;
  x: number; // site position
  z: number;
  mood: Mood;
  place: Place;
}

export class Districts {
  private cache = new Map<number, District>();
  private perm: number[];
  constructor(private seed: number, private startMood: Mood | null = null) {
    // per-seed permutation of the six moods
    const p = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) {
      const j = hash32(seed, 777, i) % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = p;
  }

  cell(i: number, j: number): District {
    const key = (i + 5000) * 100000 + (j + 5000);
    let d = this.cache.get(key);
    if (d) return d;
    const h1 = hash32(this.seed, 11, i, j), h2 = hash32(this.seed, 13, i, j);
    const x = (i + 0.2 + 0.6 * (h1 / 4294967296)) * DISTRICT_CELL;
    const z = (j + 0.2 + 0.6 * (h2 / 4294967296)) * DISTRICT_CELL;
    // Latin-square style assignment: (i,j)→(i,j+1) differ by 3, (i,j)→(i+1,j) by 2.
    let m = ((2 * i + 3 * j) % 6 + 6) % 6;
    let mood = MOODS[this.perm[m]];
    if (this.startMood && i === 0 && j === 0) mood = this.startMood;
    if (this.startMood && !(i === 0 && j === 0)) {
      // keep the start cell's neighbours different from it
      if (mood === this.startMood && Math.abs(i) <= 1 && Math.abs(j) <= 1) mood = MOODS[this.perm[(m + 1) % 6]];
    }
    const names = PLACES.filter((p) => p.mood === mood);
    const place = names[hash32(this.seed, 17, i, j) % names.length];
    d = { i, j, x, z, mood, place };
    this.cache.set(key, d);
    if (this.cache.size > 4000) this.cache.clear();
    return d;
  }

  /** Nearest and second-nearest district sites to (x, z). */
  nearest2(x: number, z: number): { a: District; b: District; da: number; db: number } {
    const ci = Math.floor(x / DISTRICT_CELL), cj = Math.floor(z / DISTRICT_CELL);
    let a: District | null = null, b: District | null = null, da = Infinity, db = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const d = this.cell(ci + di, cj + dj);
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < da) { b = a; db = da; a = d; da = dd; }
      else if (dd < db) { b = d; db = dd; }
    }
    return { a: a!, b: b!, da, db };
  }

  districtAt(x: number, z: number): District {
    return this.nearest2(x, z).a;
  }

  /**
   * Mood weights at a point (sum 1): the nearest district dominates; within `blend` metres
   * of a border the neighbour's mood mixes in. Every district site's weight is a continuous
   * function of position (it depends only on how much farther that site is than the nearest),
   * so the blend has no seams where the second-nearest district changes.
   */
  moodWeights(x: number, z: number, out: number[] = [0, 0, 0, 0, 0, 0], blend = 260): number[] {
    for (let i = 0; i < 6; i++) out[i] = 0;
    const ci = Math.floor(x / DISTRICT_CELL), cj = Math.floor(z / DISTRICT_CELL);
    const ds = this._d9, ms = this._m9;
    let da = Infinity, n = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const d = this.cell(ci + di, cj + dj);
      const dd = Math.hypot(d.x - x, d.z - z);
      ds[n] = dd; ms[n] = MOOD_INDEX[d.mood]; n++;
      if (dd < da) da = dd;
    }
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const w = 1 - smoothstep(0, blend, (ds[k] - da) / 2);
      if (w <= 0) continue;
      out[ms[k]] += w;
      sum += w;
    }
    for (let i = 0; i < 6; i++) out[i] /= sum;
    return out;
  }
  private _d9 = new Float64Array(9);
  private _m9 = new Int8Array(9);

  /** The dominant mood at a point. */
  moodAt(x: number, z: number): Mood {
    return this.districtAt(x, z).mood;
  }
}
