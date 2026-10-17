import { Matrix4, Vector3 } from 'three';
import type { InkedGeom, Mat, WorldGeom } from './geom';
import type { Mood } from '../moods';

/**
 * City-kit buildings: every near building type of the six moods plus the far skyline.
 *
 * Local frame (docs/ASSET-CONVENTIONS.md "The city kit"): metres, +Y up, street facade on z = 0
 * facing +Z, footprint x ∈ [-w/2, w/2], z ∈ [-depth, 0], foundations down to y = -4. Pieces with
 * a forecourt (konbini parking, house yards, the temple courtyard) keep it inside the footprint,
 * so every piece is placed with z = 0 on the back of the sidewalk. Awnings, sign boxes, blade signs
 * and lanterns may hang up to ~1.1 m beyond z = 0 over the sidewalk, above 2 m (a machiya's big door
 * lantern hangs to 1.6 m, 0.6 m out from the wall); a type's `notes` list anything larger.
 *
 * Painted look: everything is textured from the painted layers (assets-src/textures/painters/
 * 10_facades, 12_signs, 14_graffiti); untextured faces are only small trim. Walls carry the
 * vertical gradient (aGrad) of the whole building, so a facade fades from its dark saturated foot
 * to a bright top as one painted surface.
 *
 * Variety: all choices (colours, shopfronts and their matching signs, floor counts, setbacks,
 * rooftop clutter, balcony laundry, graffiti) come from the seed, so a street of one type never
 * repeats.
 */

// ───────────────────────────── public types ─────────────────────────────

export type RGB = [number, number, number];
export interface BuildingLight { x: number; y: number; z: number; r: number; g: number; b: number; radius: number }
export interface BuildingSpec { type: string; width: number; depth: number; floors?: number; seed: number }
export interface BuildingResult { lights: BuildingLight[]; height: number }
export interface FarSpec { mood: Mood; width: number; depth: number; height: number; seed: number }

export interface BuildingTypeDef {
  type: string;
  label: string;
  /** moods this type appears in */
  moods: Mood[];
  /** relative pick weight per mood (types absent from a mood have weight 0) */
  weight: Partial<Record<Mood, number>>;
  /** frontage width along the street (m) */
  width: [number, number];
  /** plot depth (m), including any forecourt the piece draws itself */
  depth: [number, number];
  /** storeys above ground (the `floors` spec field; ignored by single-volume types) */
  floors: [number, number];
  /** resulting height range to the top of the roof/crown (m), for culling and skyline planning */
  height: [number, number];
  /** street corner preference */
  corner: 'prefer' | 'any' | 'avoid';
  /** depth of the piece's own forecourt (yard, parking, courtyard) inside its footprint (m) */
  forecourt: [number, number];
  /** gap the type wants to its neighbours on each side (m); 0 = can share a party wall */
  sideGap: [number, number];
  /** accents (temple gate, kura): use sparingly; minimum spacing between two of them (m) */
  accent?: { minSpacing: number };
  /** the most of this type in a row before something else should break it up */
  maxRun: number;
  /** extra placement notes for the world builder */
  notes?: string;
}

// ───────────────────────────── type table ─────────────────────────────

export const BUILDING_TYPES: BuildingTypeDef[] = [
  // Downtown
  { type: 'glass_tower', label: 'Glass curtain-wall tower', moods: ['downtown'], weight: { downtown: 3 }, width: [16, 26], depth: [16, 26], floors: [12, 30], height: [60, 145], corner: 'prefer', forecourt: [0, 0], sideGap: [2, 6], maxRun: 2, notes: 'lobby + shops at street level (wrapping the corner); entrance canopy projects 2.6 m beyond z=0; red beacon on the mast' },
  { type: 'office_setback', label: 'Office slab with setbacks', moods: ['downtown', 'midtown'], weight: { downtown: 3, midtown: 0.6 }, width: [18, 32], depth: [16, 28], floors: [8, 20], height: [35, 80], corner: 'any', forecourt: [0, 0], sideGap: [0, 4], maxRun: 2 },
  { type: 'zakkyo_tower', label: 'Mixed-use tenant tower with blade signs', moods: ['downtown', 'midtown'], weight: { downtown: 4, midtown: 1.2 }, width: [7, 13], depth: [12, 20], floors: [6, 11], height: [26, 48], corner: 'any', forecourt: [0, 0], sideGap: [0, 1], maxRun: 4, notes: 'stacked blade signs project 0.9 m beyond z=0 on one edge; rooftop billboard' },
  { type: 'pachinko_hall', label: 'Pachinko / game centre with neon', moods: ['downtown', 'midtown'], weight: { downtown: 1.5, midtown: 0.4 }, width: [16, 28], depth: [18, 30], floors: [3, 5], height: [18, 32], corner: 'prefer', forecourt: [0, 0], sideGap: [0, 3], maxRun: 1, notes: 'bright: 4-6 coloured lights' },
  // Old Town
  { type: 'machiya', label: 'Machiya shop house (2 storeys)', moods: ['oldtown'], weight: { oldtown: 5 }, width: [5.4, 9.1], depth: [10, 16], floors: [2, 2], height: [7.5, 9.5], corner: 'avoid', forecourt: [0, 0], sideGap: [0, 0.3], maxRun: 8, notes: 'pent roof and lantern string project 1 m beyond z=0' },
  { type: 'kanban_shop', label: 'Old shop with signboard front', moods: ['oldtown', 'midtown'], weight: { oldtown: 2.5, midtown: 0.5 }, width: [5.5, 9], depth: [9, 14], floors: [2, 3], height: [8, 13], corner: 'any', forecourt: [0, 0], sideGap: [0, 0.5], maxRun: 3 },
  { type: 'kura', label: 'Kura storehouse', moods: ['oldtown'], weight: { oldtown: 0.8 }, width: [5, 8], depth: [7, 10], floors: [2, 2], height: [8.5, 10.5], corner: 'any', forecourt: [0, 0], sideGap: [0.5, 2], accent: { minSpacing: 60 }, maxRun: 2 },
  { type: 'temple_gate', label: 'Temple gate, walls and hall', moods: ['oldtown'], weight: { oldtown: 0.35 }, width: [11, 16], depth: [12, 18], floors: [1, 1], height: [8, 9], corner: 'avoid', forecourt: [7, 11], sideGap: [0, 1], accent: { minSpacing: 400 }, maxRun: 1, notes: 'gate roof projects 1.3 m beyond z=0' },
  // Midtown
  { type: 'mixed_block', label: 'Mid-rise mixed block (shops + flats)', moods: ['midtown', 'downtown'], weight: { midtown: 4, downtown: 1 }, width: [10, 20], depth: [12, 20], floors: [4, 8], height: [16, 37], corner: 'any', forecourt: [0, 0], sideGap: [0, 1.5], maxRun: 3 },
  { type: 'mansion', label: 'Apartment mansion with balconies', moods: ['midtown', 'suburbs', 'downtown'], weight: { midtown: 3, suburbs: 0.6, downtown: 0.5 }, width: [14, 30], depth: [10, 16], floors: [4, 11], height: [16, 38], corner: 'any', forecourt: [0, 0], sideGap: [1.5, 4], maxRun: 2, notes: 'facade set back 1.25 m so the balconies end at z=0' },
  { type: 'konbini', label: 'Convenience store with parking', moods: ['midtown', 'suburbs', 'edge', 'docks'], weight: { midtown: 1, suburbs: 0.8, edge: 0.5, docks: 0.3 }, width: [15, 21], depth: [18, 25], floors: [1, 1], height: [5, 9], corner: 'prefer', forecourt: [7, 9], sideGap: [0, 2], maxRun: 1, notes: 'pylon sign at the front corner; very bright at night' },
  { type: 'small_office', label: 'Small office building', moods: ['midtown', 'downtown', 'docks'], weight: { midtown: 2, downtown: 0.8, docks: 0.6 }, width: [8, 14], depth: [10, 16], floors: [3, 5], height: [12, 21], corner: 'any', forecourt: [0, 0], sideGap: [0, 2], maxRun: 3 },
  // Docks
  { type: 'warehouse', label: 'Warehouse shed with roller doors', moods: ['docks', 'edge'], weight: { docks: 4, edge: 0.4 }, width: [20, 40], depth: [24, 40], floors: [1, 1], height: [9, 15], corner: 'any', forecourt: [3, 3], sideGap: [2, 8], maxRun: 3, notes: 'loading dock and canopy inside the first 3 m' },
  { type: 'port_office', label: 'Port office with external stair', moods: ['docks'], weight: { docks: 1.5 }, width: [10, 18], depth: [9, 14], floors: [2, 3], height: [14, 21], corner: 'prefer', forecourt: [0, 0], sideGap: [2, 6], maxRun: 1 },
  { type: 'cold_storage', label: 'Cold-storage block', moods: ['docks'], weight: { docks: 1.5 }, width: [20, 36], depth: [20, 34], floors: [1, 1], height: [15, 23], corner: 'any', forecourt: [3, 3], sideGap: [2, 8], maxRun: 1 },
  // Suburbs
  { type: 'house', label: 'Two-storey house (gable / hip / box)', moods: ['suburbs', 'edge'], weight: { suburbs: 6, edge: 1.5 }, width: [7, 12], depth: [10, 16], floors: [2, 2], height: [7, 9.5], corner: 'any', forecourt: [2.5, 5], sideGap: [0.6, 1.5], maxRun: 12, notes: 'block wall / gate along z=0 belongs to the street kit' },
  { type: 'apaato', label: 'Small two-storey apartment (apaato)', moods: ['suburbs', 'midtown'], weight: { suburbs: 2, midtown: 0.8 }, width: [11, 18], depth: [8, 11], floors: [2, 2], height: [6.5, 8], corner: 'any', forecourt: [1.5, 2.5], sideGap: [1, 2], maxRun: 2 },
  // Edge of town
  { type: 'farm_shed', label: 'Farm shed', moods: ['edge'], weight: { edge: 3 }, width: [6, 12], depth: [6, 10], floors: [1, 1], height: [3.5, 6], corner: 'any', forecourt: [0, 2], sideGap: [4, 20], maxRun: 2 },
  { type: 'workshop', label: 'Small workshop', moods: ['edge', 'docks', 'suburbs'], weight: { edge: 2, docks: 1, suburbs: 0.4 }, width: [8, 14], depth: [10, 16], floors: [1, 2], height: [5, 8.5], corner: 'any', forecourt: [2, 3], sideGap: [2, 10], maxRun: 2, notes: 'a vending machine out front glows at night' },
  { type: 'greenhouse', label: 'Vinyl greenhouse', moods: ['edge'], weight: { edge: 1.5 }, width: [6, 9], depth: [15, 30], floors: [1, 1], height: [3, 3.6], corner: 'any', forecourt: [0, 1], sideGap: [1.5, 6], maxRun: 3, notes: 'lit at night like the chrysanthemum farms' },
];
const TYPE_INDEX = new Map(BUILDING_TYPES.map((t) => [t.type, t]));

// ───────────────────────────── atlases (mirror the painters) ─────────────────────────────

type Rect = readonly [number, number, number, number];
const BITS = { stripes: [0, 0, 512, 64], steel: [0, 64, 512, 64], acFront: [0, 128, 256, 192], tank: [256, 128, 256, 192], door: [0, 320, 64, 128], louvre: [64, 320, 128, 128], acSide: [192, 320, 128, 128], solar: [320, 320, 192, 128] } as const;
const SW = { white: 0, warm: 1, red: 2, cyan: 3, pink: 4, green: 5, amber: 6, blue: 7 } as const;
const swatch = (k: keyof typeof SW): Rect => [SW[k] * 64 + 10, 458, 44, 44];
const CUT = { rail: [0, 0, 512, 96], truss: [0, 96, 512, 80], inuyarai: [0, 176, 512, 80], laundry: [0, 256, 256, 128], futon: [256, 256, 128, 128], plants: [384, 256, 128, 128], ladder: [0, 384, 64, 128], bike: [64, 384, 128, 128], dish: [192, 384, 64, 64], laundry2: [256, 384, 256, 128] } as const;
const HOUSE = { slider: [0, 0, 192, 192], frosted: [192, 0, 128, 128], shut: [320, 0, 192, 192], door: [0, 192, 128, 256], balcony: [128, 192, 192, 256], tall: [320, 192, 96, 192], apt: [416, 192, 96, 192], kitchen: [0, 448, 192, 64], flower: [320, 384, 192, 128] } as const;
const HOUSE_SIZE: Record<keyof typeof HOUSE, [number, number]> = { slider: [1.65, 1.65], frosted: [0.75, 0.75], shut: [1.65, 1.65], door: [1.0, 2.2], balcony: [1.7, 2.25], tall: [0.6, 1.4], apt: [0.85, 2.0], kitchen: [1.6, 0.55], flower: [1.5, 1.0] };
const BOX = { side40: [0, 0, 512, 256], door: [0, 256, 256, 256], roof: [256, 256, 256, 128], side20: [256, 384, 256, 128] } as const;

type ShopKind = 'konbini' | 'ramen' | 'izakaya' | 'cafe' | 'salon' | 'pachinko' | 'shutter' | 'bakery' | 'lobby' | 'drugstore';
const SHOP: Record<ShopKind, [string, 0 | 1]> = { konbini: ['shop_a', 0], ramen: ['shop_a', 1], izakaya: ['shop_b', 0], cafe: ['shop_b', 1], salon: ['shop_c', 0], pachinko: ['shop_c', 1], shutter: ['shop_d', 0], bakery: ['shop_d', 1], lobby: ['shop_e', 0], drugstore: ['shop_e', 1] };
const shopRect = (half: 0 | 1): Rect => (half ? [0, 260, 512, 250] : [0, 2, 512, 250]);
/** the glass doors of the lobby shopfront, reused as a narrow entrance */
const LOBBY_DOOR: Rect = [140, 30, 232, 222];

type Sign = [string, number];
const BLADE: Record<string, Sign> = {
  karaoke: ['sign_blade_a', 0], yakiniku: ['sign_blade_a', 1], ramen: ['sign_blade_a', 2], izakaya: ['sign_blade_a', 3], dentist: ['sign_blade_a', 4], mahjong: ['sign_blade_a', 5], snack: ['sign_blade_a', 6], english: ['sign_blade_a', 7],
  drug: ['sign_blade_b', 0], sushi: ['sign_blade_b', 1], kissa: ['sign_blade_b', 2], pachinko: ['sign_blade_b', 3], pawn: ['sign_blade_b', 4], salon: ['sign_blade_b', 5], chinese: ['sign_blade_b', 6], game: ['sign_blade_b', 7],
};
const BAND: Record<string, Sign> = {
  momo: ['sign_band_a', 0], momoStripe: ['sign_band_a', 1], lumi: ['sign_band_a', 2], lumiStripe: ['sign_band_a', 3], ramen: ['sign_band_a', 4], izakaya: ['sign_band_a', 5], kissa: ['sign_band_a', 6], salon: ['sign_band_a', 7],
  galaxy: ['sign_band_b', 0], bakery: ['sign_band_b', 1], drug: ['sign_band_b', 2], sushi: ['sign_band_b', 3], chinese: ['sign_band_b', 4], realty: ['sign_band_b', 5], karaoke: ['sign_band_b', 6], cleaning: ['sign_band_b', 7],
  wagashi: ['sign_band_c', 0], books: ['sign_band_c', 1], sento: ['sign_band_c', 2], sake: ['sign_band_c', 3], kimono: ['sign_band_c', 4], tea: ['sign_band_c', 5], tofu: ['sign_band_c', 6], hardware: ['sign_band_c', 7],
};
const bandRect = (i: number): Rect => [0, i * 64 + 1, 512, 62];
const bladeRect = (i: number): Rect => [i * 64 + 1, 0, 62, 512];
const BILL: Sign[] = [['sign_bill_a', 0], ['sign_bill_a', 1], ['sign_bill_b', 0], ['sign_bill_b', 1], ['sign_bill_c', 0], ['sign_bill_c', 1]];
const billRect = (h: number): Rect => [0, h * 256 + 2, 512, 252];
const NEON = { bar: ['sign_neon_a', 0], snack: ['sign_neon_a', 1], sake: ['sign_neon_a', 2], ramen: ['sign_neon_a', 3], sushi: ['sign_neon_b', 0], karaoke: ['sign_neon_b', 1], game: ['sign_neon_b', 2], manga: ['sign_neon_b', 3] } as const;
const NEON_COL: Record<keyof typeof NEON, RGB> = { bar: [1, 0.3, 0.7], snack: [0.8, 0.4, 1], sake: [1, 0.25, 0.2], ramen: [1, 0.6, 0.15], sushi: [0.3, 0.9, 1], karaoke: [1, 0.35, 0.85], game: [1, 0.85, 0.2], manga: [0.3, 1, 0.5] };
const neonRect = (i: number): Rect => [(i % 2) * 256 + 2, Math.floor(i / 2) * 256 + 2, 252, 252];
/** tenant plates (sign_tenant), 4×8 cells */
const TEN = { karaoke2: 0, mahjong3: 1, english4: 2, dentist5: 3, bar: 4, snack: 5, nail: 6, seitai: 7, juku: 8, tax: 9, massage: 10, photo: 11, dance: 12, manga: 13, go: 14, cafe2: 15, bldMatsumoto: 16, bldChuo: 17, bldMidori: 18, bldAoi: 19, aptSakura: 20, aptAoba: 21, aptWakaba: 22, aptSun: 23, logoMomo: 24, logoLumi: 25, parking: 26, suzuki: 27, n1: 28, n2: 29, n3: 30, n4: 31 } as const;
const tenRect = (i: number): Rect => [(i % 4) * 128 + 2, Math.floor(i / 4) * 64 + 2, 124, 60];
const AWN_RECT = (i: number): Rect => [0, i * 64, 512, 64];
const VAL_RECT = (i: number): Rect => [0, 256 + i * 32, 512, 32];
const NOREN_RECT = (i: number): Rect => [i * 128 + 2, 384, 124, 126];
const NOREN = { yu: 0, sake: 1, soba: 2, tea: 3 } as const;
const LANT = { matsuri: 0, sake: 1, yakitori: 2, oden: 3, white: 4, temple: 5, izakaya: 6, ramen: 7 } as const;
const lantRect = (i: number): Rect => [(i % 2) * 256, Math.floor(i / 2) * 128 + 2, 256, 124];
const companyRect = (i: number): Rect => [0, i * 128, 512, 128];
const VEND_FRONT = (i: number): Rect => [i * 128 + 1, 1, 126, 254];
const VEND_SIDE = (i: number): Rect => [i * 128 + 4, 260, 120, 248];
/** graffiti */
const tagRect = (i: number): Rect => [(i % 3) * 170, Math.floor(i / 3) * 128, i % 3 === 2 ? 172 : 170, 128];
const throwRect = (i: number): Rect => [(i % 2) * 256, Math.floor(i / 2) * 256, 256, 256];
const PIECES: Sign[] = [['graf_piece_a', 0], ['graf_piece_a', 1], ['graf_piece_b', 0], ['graf_piece_b', 1]];
const stickRect = (i: number): Rect => [(i % 4) * 128, Math.floor(i / 4) * 128, 128, 128];

/** metres per texture repeat, matching the painters */
const TILE = {
  curtainA: [3, 4], curtainB: [3, 3.6], curtainC: [3, 3.8], officeBand: [3.2, 3.6], officePunch: [2.6, 3.4], mansion: [3.6, 2.95], zakkyo: [3, 3.3],
  plain: [4, 4], tile: [3, 3], koshi: [1.82, 2.9], mushiko: [1.82, 2.3], plaster: [3, 3], namako: [1, 1], wood: [2, 3],
  corrugated: [2.4, 3], sandwich: [3, 3], whwin: [3, 1.2], siding: [3, 3], mortar: [3, 3], kawara: [1.2, 1], metal: [2, 2], flat: [6, 6],
  farOffice: [3.5, 3.8], farApart: [3.4, 3], farGlass: [3, 3.6], lot: [2.5, 7.14],
} as const satisfies Record<string, readonly [number, number]>;

// ───────────────────────────── utilities ─────────────────────────────

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** sRGB hex → linear RGB tint */
export function hexRGB(h: number): RGB { return [s2l(((h >> 16) & 255) / 255), s2l(((h >> 8) & 255) / 255), s2l((h & 255) / 255)]; }
const mulRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const WHITE: RGB = [1, 1, 1];

class Rng {
  private a: number;
  constructor(seed: number) { this.a = (Math.imul((seed | 0) ^ 0x5bd1e995, 0x9e3779b1) ^ 0x2545f491) >>> 0; this.f(); }
  f(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.f(); }
  int(a: number, b: number) { return Math.floor(a + (b - a + 1) * this.f()); }
  chance(p: number) { return this.f() < p; }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.f() * a.length) % a.length]; }
  /** pick by weights [[item, w], ...] */
  wpick<T>(a: readonly (readonly [T, number])[]): T {
    let s = 0; for (const [, w] of a) s += w;
    let r = this.f() * s;
    for (const [v, w] of a) { r -= w; if (r <= 0) return v; }
    return a[a.length - 1][0];
  }
  /** a colour from a palette with a small random shift (keeps a street from matching exactly) */
  col(p: readonly number[], jitter = 0.05): RGB {
    const c = hexRGB(this.pick(p));
    return [c[0] * (1 + (this.f() - 0.5) * jitter), c[1] * (1 + (this.f() - 0.5) * jitter), c[2] * (1 + (this.f() - 0.5) * jitter)];
  }
}

const PAL = {
  wallLight: [0xf4eee2, 0xece4d4, 0xf6e8d6, 0xe8eee8, 0xf2e6e2, 0xe6e8f2, 0xfaf6ee],
  wallWarm: [0xf8cfa4, 0xf0bf98, 0xfadcaa, 0xe8b48e, 0xf6d4bc, 0xffe2a8],
  wallCool: [0xcfe2f0, 0xd2ecdc, 0xdcdcf2, 0xbcd8ee, 0xe0f0f0],
  wallVivid: [0xff9a7a, 0x8ac8ff, 0xffd56a, 0x8ae0b0, 0xd0a8ff, 0xffb0d0, 0x7ae0d8],
  tile: [0xffffff, 0xf4e0c8, 0xe8d8ff, 0xffd8c8, 0xd8e8ff, 0xe0f4e0],
  granite: [0xb8b0b8, 0xa8a4b4, 0xc8bca8, 0x9aa4b8, 0xd0c4b4, 0x8a8aa0],
  corrugated: [0x3f7fd0, 0xf0e8d4, 0xc8503a, 0x3aa070, 0xb8c0c8, 0xffffff, 0xf08a3a, 0x5aa0e0, 0x8aa0b0],
  rustRoof: [0xb05a3a, 0x8a6a5a, 0x5a7a9a, 0x4a8a6a, 0xa0a4a8],
  metalRoof: [0xd84a3a, 0x3a6ac8, 0x3a9a6a, 0x8a5a3a, 0x5a6a7a, 0x2a3a6a, 0x9a3a4a],
  kawara: [0xffffff, 0xd8dcff, 0x9aa0b8, 0xa89080, 0x7a8aa8],
  siding: [0xfff4d8, 0xffdcb4, 0xd4ecff, 0xfff0a8, 0xd8f4cc, 0xffd8e0, 0xf0e4d0, 0xbcd8f4, 0xffffff, 0xe8c8a8],
  wood: [0xffffff, 0xd8c0b0, 0xb8a090],
  bengara: [0xffa080, 0xff9a70],
  plaster: [0xfff8ee, 0xfff0d8, 0xf8e8c8, 0xeee8e0],
  trimLight: [0xf4f6f8, 0xe8ecf0, 0xfff8ee],
  trimDark: [0x3a3442, 0x2e3440, 0x4a3a32],
  container: [0xc8302a, 0x2a5ab0, 0x2a8a4a, 0xf07a20, 0x8a2a3a, 0x8a8e96, 0xf4f4f0, 0x1e8a9a, 0xe8c020, 0x5a3a8a],
} as const;

const TRIM_STEEL = hexRGB(0xb8c0cc);
const TRIM_DARK = hexRGB(0x2a2632);
const TRIM_WOOD = hexRGB(0x4a2c1c);
const TRIM_CONCRETE = hexRGB(0xc8c4bc);
const TRIM_STONE = hexRGB(0x8a8680);
const TRIM_SOFFIT = hexRGB(0xe8e4dc);

// ───────────────────────────── builder ─────────────────────────────

/** Face spec: a texture layer by name (or null for flat trim), tint, and tile size in metres. */
interface FS { layer: string | null; col?: RGB; tile?: readonly [number, number]; uo?: number; vo?: number }

/**
 * Wraps WorldGeom with the building's gradient, a local transform stack (for lights) and
 * helpers that place textures in metres and atlas cells by rect.
 */
class B {
  lights: BuildingLight[] = [];
  gSpan: number;
  local = new Matrix4();
  private stack: Matrix4[] = [];
  private v = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  constructor(public w: WorldGeom, public L: (n: string) => number, public r: Rng, public H: number, public inked?: InkedGeom) {
    this.gSpan = Math.min(34, Math.max(4.5, H * 0.85));
  }
  g(y: number) { return y <= 0 ? 0 : Math.min(1, y / this.gSpan); }
  lay(n: string | null) { return n === null ? -1 : this.L(n); }
  mat(f: FS): Mat { return { layer: this.lay(f.layer), color: f.col ?? WHITE }; }

  push(m: Matrix4) { this.stack.push(this.local.clone()); this.local.multiply(m); this.w.push(m); }
  pop() { this.local.copy(this.stack.pop()!); this.w.pop(); }
  /** Runs fn in a frame translated to (x,y,z) and rotated by `ry` about +Y. */
  at(x: number, y: number, z: number, ry: number, fn: () => void) {
    const m = new Matrix4().makeRotationY(ry).setPosition(x, y, z);
    this.push(m); fn(); this.pop();
  }
  /** Runs fn in a facade frame for one side of the box [x0,x1]×[z0,z1]: facade spans
   *  x ∈ [-len/2, len/2] at z = 0 facing outward. Returns nothing; fn gets the length. */
  side(s: 'front' | 'back' | 'left' | 'right', x0: number, x1: number, z0: number, z1: number, fn: (len: number) => void) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (s === 'front') this.at(cx, 0, z1, 0, () => fn(x1 - x0));
    else if (s === 'back') this.at(cx, 0, z0, Math.PI, () => fn(x1 - x0));
    else if (s === 'right') this.at(x1, 0, cz, Math.PI / 2, () => fn(z1 - z0));
    else this.at(x0, 0, cz, -Math.PI / 2, () => fn(z1 - z0));
  }
  light(x: number, y: number, z: number, c: RGB, radius: number) {
    const p = new Vector3(x, y, z).applyMatrix4(this.local);
    this.lights.push({ x: p.x, y: p.y, z: p.z, r: c[0], g: c[1], b: c[2], radius });
  }

  /** Vertical quad facing +Z in the current frame, explicit uv [u0, v0, u1, v1]. */
  q(x0: number, x1: number, y0: number, y1: number, z: number, f: FS, uv: readonly [number, number, number, number], g?: [number, number]) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    this.w.wall(x0, z, x1, z, y0, y1, this.mat(f), { uv: [uv[0], uv[1], uv[2], uv[3]], gBase: g ? g[0] : this.g(y0), gTop: g ? g[1] : this.g(y1) });
  }
  /** Facade session: inside fn, tiled walls on the facade plane (b.t at z≈0) are deferred and
   *  drawn at the end with every registered opening (shopfronts, recessed doors) cut out, so a
   *  backdrop wall never covers a recessed shopfront whatever order the parts were drawn in. */
  private session: { holes: [number, number, number, number][]; walls: [number, number, number, number, number, FS][] } | null = null;
  facade(fn: () => void) {
    const prev = this.session;
    const s = (this.session = { holes: [], walls: [] });
    fn();
    this.session = prev;
    for (const w of s.walls) this.cut(w, s.holes);
  }
  /** Registers an opening in the facade plane of the current session. */
  hole(x0: number, x1: number, y0: number, y1: number) { if (this.session) this.session.holes.push([x0, x1, y0, y1]); }
  private cut([x0, x1, y0, y1, z, f]: [number, number, number, number, number, FS], holes: [number, number, number, number][]) {
    const hs = holes.filter((h) => h[0] < x1 - 1e-3 && h[1] > x0 + 1e-3 && h[2] < y1 - 1e-3 && h[3] > y0 + 1e-3);
    if (!hs.length) { this.t(x0, x1, y0, y1, z, f); return; }
    const xs = [...new Set([x0, x1, ...hs.flatMap((h) => [h[0], h[1]]).filter((x) => x > x0 && x < x1)])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const cov = hs.filter((h) => h[0] <= xa + 1e-4 && h[1] >= xb - 1e-4).map((h) => [Math.max(y0, h[2]), Math.min(y1, h[3])]).sort((a, b) => a[0] - b[0]);
      let y = y0;
      for (const [ha, hb] of cov) { if (ha > y + 1e-3) this.t(xa, xb, y, ha, z, f); y = Math.max(y, hb); }
      if (y < y1 - 1e-3) this.t(xa, xb, y, y1, z, f);
    }
  }
  /** Tiled vertical quad facing +Z (texture repeats per f.tile metres; u from x, v from y). */
  t(x0: number, x1: number, y0: number, y1: number, z: number, f: FS) {
    if (this.session && Math.abs(z) < 0.02) { this.session.walls.push([x0, x1, y0, y1, z, f]); return; }
    const [tu, tv] = f.tile ?? [4, 4];
    const uo = f.uo ?? 0, vo = f.vo ?? 0;
    this.q(x0, x1, y0, y1, z, f, [x0 / tu + uo, y0 / tv + vo, x1 / tu + uo, y1 / tv + vo]);
  }
  /** Window bays: exactly round(width/bay) repeats across, floors of fh from yBase. */
  bays(x0: number, x1: number, y0: number, y1: number, z: number, layer: string, bay: number, fh: number, yBase: number, col: RGB = WHITE, uo = 0) {
    const n = Math.max(1, Math.round((x1 - x0) / bay));
    this.q(x0, x1, y0, y1, z, { layer, col }, [uo, (y0 - yBase) / fh, uo + n, (y1 - yBase) / fh]);
  }
  /** Atlas decal (rect in 512 px, y from the top), facing +Z at z. uOff shifts by whole repeats
   *  (same texels, a different random-light cell for window decals). */
  d(x0: number, y0: number, x1: number, y1: number, z: number, layer: string, rect: Rect, col?: RGB, uOff = 0) {
    const [rx, ry, rw, rh] = rect;
    this.q(x0, x1, y0, y1, z, { layer, col }, [rx / 512 + uOff, 1 - (ry + rh) / 512, (rx + rw) / 512 + uOff, 1 - ry / 512]);
  }
  /** Atlas decal on a horizontal strip that repeats in u (full-width rows): u from x / tileU. */
  strip(x0: number, x1: number, y0: number, y1: number, z: number, layer: string, rect: Rect, tileU: number, col?: RGB) {
    const [, ry, , rh] = rect;
    this.q(x0, x1, y0, y1, z, { layer, col }, [x0 / tileU, 1 - (ry + rh) / 512, x1 / tileU, 1 - ry / 512]);
  }
  /** Horizontal quad (up, or down with flip) tiled in metres; gradient g (default -1). */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, f: FS, flip = false, g = -1) {
    const [tu, tv] = f.tile ?? [4, 4];
    this.w.flat(x0, z0, x1, z1, y, this.mat(f), { flip, g, uv: [x0 / tu + (f.uo ?? 0), z0 / tv, x1 / tu + (f.uo ?? 0), z1 / tv] });
  }
  /** Box with per-face specs; side faces tiled by f.tile with the building gradient. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: { all?: FS; side?: FS; front?: FS | null; back?: FS | null; left?: FS | null; right?: FS | null; top?: FS | null; bottom?: FS | null }) {
    const sd = (k: 'front' | 'back' | 'left' | 'right') => (f[k] === null ? null : f[k] ?? f.side ?? f.all);
    const tl = (fs: FS, len: number, ya: number, yb: number, u0 = 0): [number, number, number, number] => { const [tu, tv] = fs.tile ?? [4, 4]; return [u0 / tu + (fs.uo ?? 0), ya / tv + (fs.vo ?? 0), (u0 + len) / tu + (fs.uo ?? 0), yb / tv + (fs.vo ?? 0)]; };
    const gg = { gBase: this.g(y0), gTop: this.g(y1) };
    let m = sd('front'); if (m) this.w.wall(x0, z1, x1, z1, y0, y1, this.mat(m), { uv: tl(m, x1 - x0, y0, y1, x0), ...gg });
    m = sd('back'); if (m) this.w.wall(x1, z0, x0, z0, y0, y1, this.mat(m), { uv: tl(m, x1 - x0, y0, y1, -x1), ...gg });
    m = sd('right'); if (m) this.w.wall(x1, z1, x1, z0, y0, y1, this.mat(m), { uv: tl(m, z1 - z0, y0, y1, -z1), ...gg });
    m = sd('left'); if (m) this.w.wall(x0, z0, x0, z1, y0, y1, this.mat(m), { uv: tl(m, z1 - z0, y0, y1, z0), ...gg });
    const top = f.top === undefined ? f.all : f.top;
    if (top) this.flat(x0, z0, x1, z1, y1, top);
    const bot = f.bottom === undefined ? null : f.bottom;
    if (bot) this.flat(x0, z0, x1, z1, y0, bot, true);
  }
  /** Flat-colour trim box (small parts only). */
  trim(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, o: { top?: boolean; bottom?: boolean; back?: boolean } = {}) {
    const f: FS = { layer: null, col };
    this.box(x0, y0, z0, x1, y1, z1, { front: f, left: f, right: f, back: o.back === false ? undefined : f, top: o.top === false ? null : f, bottom: o.bottom ? f : null });
  }
  /** Arbitrary quad by four points (counter-clockwise seen from the front). */
  quad(p: [number, number, number][], f: FS, uv: [number, number, number, number, number, number, number, number], g0 = -1, g1 = -1) {
    for (let i = 0; i < 4; i++) this.v[i].set(p[i][0], p[i][1], p[i][2]);
    this.w.quadUV(this.v[0], this.v[1], this.v[2], this.v[3], uv, this.mat(f), g0, g1);
  }
  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], f: FS, uv: [number, number, number, number, number, number], g = -1) {
    this.v[0].set(...a); this.v[1].set(...b); this.v[2].set(...c);
    this.w.tri(this.v[0], this.v[1], this.v[2], this.mat(f), uv, g);
  }
}

// ───────────────────────────── shared parts ─────────────────────────────

/** Foundation band from y=-4 to the plinth top, slightly proud of the walls. */
function plinth(b: B, x0: number, x1: number, z0: number, z1: number, col: RGB = hexRGB(0x8a8890), top = 0.3) {
  const e = 0.04;
  const f: FS = { layer: 'fac_wall_plain', col, tile: TILE.plain };
  b.box(x0 - e, -4, z0 - e, x1 + e, top, z1 + e, { side: f, top: { layer: null, col: mulRGB(col, 1.1) } });
}

/** Four walls of a volume, each through a facade callback; corners meet exactly. */
function walls(b: B, x0: number, x1: number, z0: number, z1: number, fn: (side: 'front' | 'back' | 'left' | 'right', len: number) => void, sides: ('front' | 'back' | 'left' | 'right')[] = ['front', 'right', 'back', 'left']) {
  for (const s of sides) b.side(s, x0, x1, z0, z1, (len) => b.facade(() => fn(s, len)));
}

/** Plain tiled wall face in a facade frame. */
function plainFace(b: B, len: number, y0: number, y1: number, f: FS) { b.t(-len / 2, len / 2, y0, y1, 0, f); }

/** Flat roof with parapet: roof surface, inner parapet faces and a cap (outer faces are the caller's walls run up to y+ph). */
function flatRoof(b: B, x0: number, x1: number, z0: number, z1: number, y: number, ph: number, inner: FS, cap: RGB, t = 0.25) {
  b.flat(x0 + t, z0 + t, x1 - t, z1 - t, y, { layer: 'roof_flat', tile: TILE.flat, col: [1, 1, 1] });
  if (ph <= 0) return;
  // inner faces look inward
  b.w.wall(x1 - t, z1 - t, x0 + t, z1 - t, y, y + ph, b.mat({ ...inner, tile: inner.tile ?? TILE.plain }), { uv: [0, 0, (x1 - x0) / 4, ph / 4], gBase: b.g(y), gTop: b.g(y + ph) });
  b.w.wall(x0 + t, z0 + t, x1 - t, z0 + t, y, y + ph, b.mat(inner), { uv: [0, 0, (x1 - x0) / 4, ph / 4], gBase: b.g(y), gTop: b.g(y + ph) });
  b.w.wall(x0 + t, z1 - t, x0 + t, z0 + t, y, y + ph, b.mat(inner), { uv: [0, 0, (z1 - z0) / 4, ph / 4], gBase: b.g(y), gTop: b.g(y + ph) });
  b.w.wall(x1 - t, z0 + t, x1 - t, z1 - t, y, y + ph, b.mat(inner), { uv: [0, 0, (z1 - z0) / 4, ph / 4], gBase: b.g(y), gTop: b.g(y + ph) });
  const c: FS = { layer: null, col: cap };
  b.flat(x0, z1 - t, x1, z1, y + ph, c); b.flat(x0, z0, x1, z0 + t, y + ph, c);
  b.flat(x0, z0 + t, x0 + t, z1 - t, y + ph, c); b.flat(x1 - t, z0 + t, x1, z1 - t, y + ph, c);
}

/** Gable roof over [x0,x1]×[z0,z1] with the ridge along X; eaves at yE; overhang o (front/back), os (sides). */
function gableX(b: B, x0: number, x1: number, z0: number, z1: number, yE: number, rise: number, o: number, os: number, roof: FS, gable: FS | null, o2: { fascia?: RGB; soffit?: RGB; ridge?: RGB; back?: number } = {}) {
  const zc = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const slope = rise / half;
  const ob = o2.back ?? o;
  const yF = yE - o * slope, yB = yE - ob * slope, yR = yE + rise;
  const xa = x0 - os, xb = x1 + os;
  const [tu, tv] = roof.tile ?? TILE.kawara;
  const lenF = Math.hypot(half + o, rise + o * slope), lenB = Math.hypot(half + ob, rise + ob * slope);
  const th = 0.16;
  // front and back slopes
  b.quad([[xa, yF, z1 + o], [xb, yF, z1 + o], [xb, yR, zc], [xa, yR, zc]], roof, [xa / tu, 0, xb / tu, 0, xb / tu, lenF / tv, xa / tu, lenF / tv]);
  b.quad([[xb, yB, z0 - ob], [xa, yB, z0 - ob], [xa, yR, zc], [xb, yR, zc]], roof, [-xb / tu, 0, -xa / tu, 0, -xa / tu, lenB / tv, -xb / tu, lenB / tv]);
  // fascia boards along the eaves and the undersides of the overhangs
  const fc: FS = { layer: null, col: o2.fascia ?? TRIM_WOOD };
  const sc: FS = { layer: null, col: o2.soffit ?? mulRGB(TRIM_WOOD, 1.4) };
  b.quad([[xa, yF - th, z1 + o], [xb, yF - th, z1 + o], [xb, yF, z1 + o], [xa, yF, z1 + o]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xb, yB - th, z0 - ob], [xa, yB - th, z0 - ob], [xa, yB, z0 - ob], [xb, yB, z0 - ob]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xa, yE - th, z1], [xb, yE - th, z1], [xb, yF - th, z1 + o], [xa, yF - th, z1 + o]], sc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xb, yE - th, z0], [xa, yE - th, z0], [xa, yB - th, z0 - ob], [xb, yB - th, z0 - ob]], sc, [0, 0, 1, 0, 1, 1, 0, 1]);
  // barge boards at the gable ends (sloped strips) + gable triangles
  for (const [x, s] of [[xa, -1], [xb, 1]] as const) {
    const pF: [number, number, number] = [x, yF - th, z1 + o], pR: [number, number, number] = [x, yR - th, zc], pB: [number, number, number] = [x, yB - th, z0 - ob];
    const qF: [number, number, number] = [x, yF, z1 + o], qR: [number, number, number] = [x, yR, zc], qB: [number, number, number] = [x, yB, z0 - ob];
    if (s > 0) { b.quad([pF, pR, qR, qF], fc, [0, 0, 1, 0, 1, 1, 0, 1]); b.quad([pR, pB, qB, qR], fc, [0, 0, 1, 0, 1, 1, 0, 1]); }
    else { b.quad([pR, pF, qF, qR], fc, [0, 0, 1, 0, 1, 1, 0, 1]); b.quad([pB, pR, qR, qB], fc, [0, 0, 1, 0, 1, 1, 0, 1]); }
  }
  if (gable) {
    const [gu, gv] = gable.tile ?? [3, 3];
    const g0 = b.g(yE), g1 = b.g(yR);
    // +X end (faces +X): z from z1 (left as seen from +X) to z0
    b.tri([x1, yE, z1], [x1, yE, z0], [x1, yR, zc], gable, [-z1 / gu, yE / gv, -z0 / gu, yE / gv, -zc / gu, yR / gv], (g0 + g1) / 2);
    b.tri([x0, yE, z0], [x0, yE, z1], [x0, yR, zc], gable, [z0 / gu, yE / gv, z1 / gu, yE / gv, zc / gu, yR / gv], (g0 + g1) / 2);
  }
  // ridge cap
  if (o2.ridge) b.trim(xa - 0.05, yR - 0.06, zc - 0.16, xb + 0.05, yR + 0.16, zc + 0.16, o2.ridge, {});
}

/** Gable with the ridge along Z (gable end facing the street). */
function gableZ(b: B, x0: number, x1: number, z0: number, z1: number, yE: number, rise: number, o: number, os: number, roof: FS, gable: FS | null, o2: { fascia?: RGB; soffit?: RGB; ridge?: RGB } = {}) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  // rotate the footprint 90°: local X' = -z, local Z' = x  (ridge along X' == world Z)
  b.at(cx, 0, cz, -Math.PI / 2, () => gableX(b, -hd, hd, -hw, hw, yE, rise, o, os, roof, gable, o2));
}

/** Hip roof over the box with overhang o. */
function hipRoof(b: B, x0: number, x1: number, z0: number, z1: number, yE: number, rise: number, o: number, roof: FS, o2: { fascia?: RGB; soffit?: RGB; ridge?: RGB } = {}) {
  const w = x1 - x0, dd = z1 - z0;
  const slope = rise / (Math.min(w, dd) / 2);
  const ya = yE - o * slope, yR = yE + rise;
  const xa = x0 - o, xb = x1 + o, za = z0 - o, zb = z1 + o;
  const inset = Math.min(w, dd) / 2 + o;
  let rx0 = xa + inset, rx1 = xb - inset, rz0 = za + inset, rz1 = zb - inset;
  if (rx1 < rx0) { rx0 = rx1 = (xa + xb) / 2; }
  if (rz1 < rz0) { rz0 = rz1 = (za + zb) / 2; }
  const [tu, tv] = roof.tile ?? TILE.kawara;
  const len = Math.hypot(inset, rise + o * slope);
  // front (+z) and back trapezoids
  b.quad([[xa, ya, zb], [xb, ya, zb], [rx1, yR, rz1], [rx0, yR, rz1]], roof, [xa / tu, 0, xb / tu, 0, rx1 / tu, len / tv, rx0 / tu, len / tv]);
  b.quad([[xb, ya, za], [xa, ya, za], [rx0, yR, rz0], [rx1, yR, rz0]], roof, [-xb / tu, 0, -xa / tu, 0, -rx0 / tu, len / tv, -rx1 / tu, len / tv]);
  // side trapezoids (+x, -x)
  b.quad([[xb, ya, zb], [xb, ya, za], [rx1, yR, rz0], [rx1, yR, rz1]], roof, [-zb / tu, 0, -za / tu, 0, -rz0 / tu, len / tv, -rz1 / tu, len / tv]);
  b.quad([[xa, ya, za], [xa, ya, zb], [rx0, yR, rz1], [rx0, yR, rz0]], roof, [za / tu, 0, zb / tu, 0, rz1 / tu, len / tv, rz0 / tu, len / tv]);
  const th = 0.16;
  const fc: FS = { layer: null, col: o2.fascia ?? TRIM_WOOD };
  const sc: FS = { layer: null, col: o2.soffit ?? TRIM_SOFFIT };
  // fascia ring + soffit ring
  b.quad([[xa, ya - th, zb], [xb, ya - th, zb], [xb, ya, zb], [xa, ya, zb]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xb, ya - th, za], [xa, ya - th, za], [xa, ya, za], [xb, ya, za]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xb, ya - th, zb], [xb, ya - th, za], [xb, ya, za], [xb, ya, zb]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[xa, ya - th, za], [xa, ya - th, zb], [xa, ya, zb], [xa, ya, za]], fc, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.flat(xa, za, xb, zb, ya - th, sc, true, -1);
  if (o2.ridge && rx1 > rx0) b.trim(rx0, yR - 0.05, rz0 - 0.14, rx1, yR + 0.14, rz0 + 0.14, o2.ridge);
}

/** Lean-to (pent) roof along the front of a facade frame: from (y1 at z=0) down to (y0 at z=dz). */
function pentRoof(b: B, x0: number, x1: number, y0: number, y1: number, dz: number, roof: FS, fascia: RGB, soffit: RGB) {
  const [tu, tv] = roof.tile ?? TILE.kawara;
  const len = Math.hypot(dz, y1 - y0);
  b.quad([[x0, y0, dz], [x1, y0, dz], [x1, y1, 0.02], [x0, y1, 0.02]], roof, [x0 / tu, 0, x1 / tu, 0, x1 / tu, len / tv, x0 / tu, len / tv]);
  const th = 0.14;
  b.quad([[x0, y0 - th, dz], [x1, y0 - th, dz], [x1, y0, dz], [x0, y0, dz]], { layer: null, col: fascia }, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[x1, y0 - th, dz], [x0, y0 - th, dz], [x0, y1 - th, 0.02], [x1, y1 - th, 0.02]], { layer: null, col: soffit }, [0, 0, 1, 0, 1, 1, 0, 1]);
  // end caps
  b.quad([[x1, y0 - th, dz], [x1, y1 - th, 0.02], [x1, y1, 0.02], [x1, y0, dz]], { layer: null, col: fascia }, [0, 0, 1, 0, 1, 1, 0, 1]);
  b.quad([[x0, y1 - th, 0.02], [x0, y0 - th, dz], [x0, y0, dz], [x0, y1, 0.02]], { layer: null, col: fascia }, [0, 0, 1, 0, 1, 1, 0, 1]);
}

/** A shopfront module in a facade frame: recessed glass front (painted shop), jambs, head, and the
 *  matching sign band above. Returns the band's top y. */
function shopfront(b: B, x0: number, x1: number, y0: number, y1: number, kind: ShopKind, o: { band?: string | null; bandY?: number; recess?: number; jamb?: FS; awning?: number; light?: boolean } = {}) {
  const rc = o.recess ?? 0.18;
  const [layer, half] = SHOP[kind];
  b.hole(x0, x1, y0, y1);
  b.d(x0, y0, x1, y1, -rc, layer, shopRect(half));
  const jamb = o.jamb ?? { layer: null, col: TRIM_DARK };
  // jambs and head soffit (recess reveals)
  b.w.wall(x0, 0, x0, -rc, y0, y1, b.mat(jamb), { uv: [0, 0, 0.1, 1], gBase: b.g(y0), gTop: b.g(y1) });
  b.w.wall(x1, -rc, x1, 0, y0, y1, b.mat(jamb), { uv: [0, 0, 0.1, 1], gBase: b.g(y0), gTop: b.g(y1) });
  b.flat(x0, -rc, x1, 0, y1, { layer: null, col: TRIM_SOFFIT }, true);
  b.flat(x0, -rc, x1, 0, y0, { layer: null, col: TRIM_STONE });
  let top = y1;
  if (o.band) {
    const [bl, bi] = BAND[o.band];
    const bw = Math.min(x1 - x0 - 0.2, 7.2), bh = Math.max(0.55, Math.min(0.95, bw / 8));
    const by = o.bandY ?? y1 + 0.12;
    const cx = (x0 + x1) / 2;
    signBox(b, cx - bw / 2, cx + bw / 2, by, by + bh, 0, 0.22, bl, bandRect(bi));
    top = by + bh;
  }
  if (o.awning !== undefined) awning(b, x0 + 0.1, x1 - 0.1, y1 + 0.02, o.awning);
  if (o.light !== false && kind !== 'shutter') {
    const warm: Record<ShopKind, RGB> = { konbini: [0.9, 0.95, 1], ramen: [1, 0.7, 0.35], izakaya: [1, 0.62, 0.3], cafe: [1, 0.75, 0.4], salon: [1, 0.9, 0.95], pachinko: [1, 0.85, 0.5], shutter: [0, 0, 0], bakery: [1, 0.8, 0.5], lobby: [0.9, 0.95, 1], drugstore: [0.95, 1, 0.95] };
    b.light((x0 + x1) / 2, 1.2, 1.6, warm[kind], kind === 'konbini' || kind === 'pachinko' ? 9 : 6);
  }
  return top;
}

/** Lit sign box against a facade (front face = atlas rect, rest trim). */
function signBox(b: B, x0: number, x1: number, y0: number, y1: number, z: number, dz: number, layer: string, rect: Rect, frame: RGB = TRIM_STEEL) {
  b.d(x0, y0, x1, y1, z + dz, layer, rect);
  const f: FS = { layer: null, col: frame };
  b.w.wall(x0, z, x0, z + dz, y0, y1, b.mat(f), { gBase: b.g(y0), gTop: b.g(y1) });
  b.w.wall(x1, z + dz, x1, z, y0, y1, b.mat(f), { gBase: b.g(y0), gTop: b.g(y1) });
  b.flat(x0, z, x1, z + dz, y1, f);
  b.flat(x0, z, x1, z + dz, y0, f, true);
}

/** Blade sign projecting from the facade at x (both faces readable), from y0 for height h. */
function blade(b: B, x: number, y0: number, h: number, key: string, depth = 0.7, off = 0.18) {
  const [layer, i] = BLADE[key];
  const t = 0.1, z0 = off, z1 = off + depth;
  const r = bladeRect(i);
  const [rx, ry, rw, rh] = r;
  const uv: [number, number, number, number] = [rx / 512, 1 - (ry + rh) / 512, (rx + rw) / 512, 1 - ry / 512];
  const m = b.mat({ layer });
  b.w.wall(x + t, z1, x + t, z0, y0, y0 + h, m, { uv, gBase: b.g(y0), gTop: b.g(y0 + h) });
  b.w.wall(x - t, z0, x - t, z1, y0, y0 + h, m, { uv, gBase: b.g(y0), gTop: b.g(y0 + h) });
  const f: FS = { layer: null, col: TRIM_STEEL };
  b.w.wall(x - t, z1, x + t, z1, y0, y0 + h, b.mat(f), { gBase: b.g(y0), gTop: b.g(y0 + h) });
  b.flat(x - t, z0, x + t, z1, y0 + h, f); b.flat(x - t, z0, x + t, z1, y0, f, true);
  // brackets
  for (const yy of [y0 + 0.3, y0 + h - 0.4]) b.trim(x - 0.04, yy, 0, x + 0.04, yy + 0.08, z0, TRIM_DARK);
  const col: Record<string, RGB> = { karaoke: [1, 0.35, 0.65], yakiniku: [1, 0.3, 0.2], ramen: [1, 0.8, 0.2], izakaya: [0.5, 0.6, 1], dentist: [0.8, 0.9, 1], mahjong: [0.3, 1, 0.5], snack: [0.75, 0.4, 1], english: [0.35, 0.7, 1], drug: [1, 0.95, 0.3], sushi: [1, 0.95, 0.85], kissa: [1, 0.7, 0.4], pachinko: [1, 0.4, 0.3], pawn: [1, 1, 1], salon: [1, 0.7, 0.85], chinese: [1, 0.5, 0.2], game: [0.3, 0.9, 1] };
  b.light(x, y0 + h * 0.5, z1, col[key] ?? [1, 1, 1], 5);
}

/** Striped canvas awning sloping out from a facade (cutout layer). */
function awning(b: B, x0: number, x1: number, y: number, ci: number, depth = 1.1, drop = 0.55) {
  const ay = y + 0.75;
  const r = AWN_RECT(ci);
  const [, ry, , rh] = r;
  const v0 = 1 - (ry + rh) / 512, v1 = 1 - ry / 512;
  b.quad([[x0, ay - drop, depth], [x1, ay - drop, depth], [x1, ay, 0.03], [x0, ay, 0.03]], { layer: 'sign_awning' }, [x0 / 1.4, v0, x1 / 1.4, v0, x1 / 1.4, v1, x0 / 1.4, v1], b.g(ay - drop), b.g(ay));
  // underside (so it reads from below) and valance
  b.quad([[x1, ay - drop, depth], [x0, ay - drop, depth], [x0, ay, 0.03], [x1, ay, 0.03]], { layer: 'sign_awning', col: [0.7, 0.66, 0.72] }, [x1 / 1.4, v0, x0 / 1.4, v0, x0 / 1.4, v1, x1 / 1.4, v1], b.g(ay - drop), b.g(ay));
  const vr = VAL_RECT(ci);
  b.q(x0, x1, ay - drop - 0.32, ay - drop, depth, { layer: 'sign_awning' }, [x0 / 1.4, 1 - (vr[1] + vr[3]) / 512, x1 / 1.4, 1 - vr[1] / 512]);
  b.at(0, 0, depth, Math.PI, () => b.q(-x1, -x0, ay - drop - 0.32, ay - drop, 0, { layer: 'sign_awning', col: [0.75, 0.72, 0.78] }, [-x1 / 1.4, 1 - (vr[1] + vr[3]) / 512, -x0 / 1.4, 1 - vr[1] / 512]));
}

/** Chōchin / paper lantern: a faceted barrel with dark caps, art from sign_lantern. */
function lantern(b: B, x: number, y: number, z: number, r: number, h: number, idx: number, seg = 8) {
  const [rx, ry, rw, rh] = lantRect(idx);
  const v0 = 1 - (ry + rh) / 512, v1 = 1 - ry / 512;
  const f: FS = { layer: 'sign_lantern' };
  const rings = [[0, 0.72], [0.22, 0.97], [0.5, 1], [0.78, 0.97], [1, 0.72]];
  for (let k = 0; k < rings.length - 1; k++) {
    const ya = y + rings[k][0] * h, yb = y + rings[k + 1][0] * h, ra = r * rings[k][1], rb = r * rings[k + 1][1];
    const va = v0 + (v1 - v0) * rings[k][0], vb = v0 + (v1 - v0) * rings[k + 1][0];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / seg) * Math.PI * 2 - Math.PI / 2;
      // u decreases with angle so the art reads left→right from the front (+Z at the cell centre)
      const u0 = (rx + rw * (1 - i / seg)) / 512, u1 = (rx + rw * (1 - (i + 1) / seg)) / 512;
      b.quad([[x + Math.cos(a1) * ra, ya, z + Math.sin(a1) * ra], [x + Math.cos(a0) * ra, ya, z + Math.sin(a0) * ra], [x + Math.cos(a0) * rb, yb, z + Math.sin(a0) * rb], [x + Math.cos(a1) * rb, yb, z + Math.sin(a1) * rb]], f, [u1, va, u0, va, u0, vb, u1, vb]);
    }
  }
  // dark rims: the bottom one capped (seen from the street), the top one open (under the eaves)
  const cap = (yy: number, rr: number, hh: number, bottom: boolean) => b.w.cylinder(x, z, yy, yy + hh, rr, rr, 6, { layer: -1, color: TRIM_DARK }, { capTop: false, capBottom: bottom, gBase: -1, gTop: -1 });
  cap(y - 0.05, r * 0.74, 0.06, true);
  cap(y + h - 0.01, r * 0.74, 0.06, false);
}

/** A string of small lanterns hanging along a facade frame at height y, z out from the wall. */
function lanternString(b: B, x0: number, x1: number, y: number, z: number, kinds: number[], spacing = 1.3) {
  const n = Math.max(2, Math.round((x1 - x0) / spacing));
  b.trim(x0, y + 0.02, z - 0.01, x1, y + 0.04, z + 0.01, TRIM_DARK, { back: false });
  const col: RGB = [1, 0.55, 0.25];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0);
    lantern(b, x, y - 0.56, z, 0.18, 0.48, kinds[i % kinds.length], 6);
    b.trim(x - 0.008, y - 0.1, z - 0.008, x + 0.008, y + 0.02, z + 0.008, TRIM_DARK, { top: false });
    if (i % 3 === 1) b.light(x, y - 0.3, z, col, 3.2);
  }
}

/** AC outdoor unit standing against a facade frame wall at (x, y), front +Z. */
function acUnit(b: B, x: number, y: number, z = 0) {
  const w = 0.8, h = 0.6, d = 0.3;
  b.d(x - w / 2, y, x + w / 2, y + h, z + d, 'roof_bits', BITS.acFront);
  const s: FS = { layer: 'roof_bits' };
  const r = BITS.acSide;
  const uv: [number, number, number, number] = [r[0] / 512, 1 - (r[1] + r[3]) / 512, (r[0] + r[2]) / 512, 1 - r[1] / 512];
  b.w.wall(x + w / 2, z + d, x + w / 2, z, y, y + h, b.mat(s), { uv, gBase: b.g(y), gTop: b.g(y + h) });
  b.w.wall(x - w / 2, z, x - w / 2, z + d, y, y + h, b.mat(s), { uv, gBase: b.g(y), gTop: b.g(y + h) });
  b.flat(x - w / 2, z, x + w / 2, z + d, y + h, { layer: null, col: hexRGB(0xe4e0d6) });
  if (y > 0.5) b.flat(x - w / 2, z, x + w / 2, z + d, y, { layer: null, col: hexRGB(0xb8b4ac) }, true);
}

/** FRP water tank on a steel stand (rooftop of older blocks). */
function waterTank(b: B, x: number, z: number, y: number, w = 2.2, d = 1.6, h = 1.6) {
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.trim(x + dx * (w / 2 - 0.1) - 0.06, y, z + dz * (d / 2 - 0.1) - 0.06, x + dx * (w / 2 - 0.1) + 0.06, y + 0.9, z + dz * (d / 2 - 0.1) + 0.06, TRIM_STEEL, { top: false });
  const r = BITS.tank;
  const f: FS = { layer: 'roof_bits' };
  const uv: [number, number, number, number] = [r[0] / 512, 1 - (r[1] + r[3]) / 512, (r[0] + r[2]) / 512, 1 - r[1] / 512];
  const y0 = y + 0.9, y1 = y0 + h;
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const gg = { uv, gBase: b.g(y0), gTop: b.g(y1) };
  b.w.wall(x0, z1, x1, z1, y0, y1, b.mat(f), gg); b.w.wall(x1, z0, x0, z0, y0, y1, b.mat(f), gg);
  b.w.wall(x1, z1, x1, z0, y0, y1, b.mat(f), gg); b.w.wall(x0, z0, x0, z1, y0, y1, b.mat(f), gg);
  b.flat(x0, z0, x1, z1, y1, { layer: null, col: hexRGB(0xd8e4ea) });
  b.flat(x0, z0, x1, z1, y0, { layer: null, col: TRIM_STEEL }, true);
  b.trim(x - 0.25, y1, z - 0.25, x + 0.25, y1 + 0.12, z + 0.25, hexRGB(0xc8d4dc));
}

/** Rooftop stair/lift house with a door on the +Z side. */
function stairHouse(b: B, x0: number, x1: number, z0: number, z1: number, y: number, h: number, wall: FS) {
  b.box(x0, y, z0, x1, y + h, z1, { side: wall, top: { layer: 'roof_flat', tile: TILE.flat } });
  const cx = (x0 + x1) / 2;
  b.d(cx - 0.45, y, cx + 0.45, y + 2.0, z1 + 0.02, 'roof_bits', BITS.door);
  b.d(x0 + 0.3, y + h - 1.1, x0 + 1.0, y + h - 0.4, z1 + 0.02, 'roof_bits', BITS.louvre);
  b.trim(x0 - 0.1, y + h, z0 - 0.1, x1 + 0.1, y + h + 0.12, z1 + 0.1, TRIM_CONCRETE);
}

/** Double-sided cutout railing between two points at height y. */
function railing(b: B, x0: number, z0: number, x1: number, z1: number, y: number, h = 1.1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const [, ry, , rh] = CUT.rail;
  const uv: [number, number, number, number] = [0, 1 - (ry + rh) / 512, len / 2, 1 - ry / 512];
  b.w.wall(x0, z0, x1, z1, y, y + h, b.mat({ layer: 'deco_cut' }), { uv, gBase: b.g(y), gTop: b.g(y + h) });
  b.w.wall(x1, z1, x0, z0, y, y + h, b.mat({ layer: 'deco_cut' }), { uv: [-len / 2, uv[1], 0, uv[3]], gBase: b.g(y), gTop: b.g(y + h) });
}

/** Billboard on a steel frame standing on a roof at (cx, y, cz), facing +Z. */
function billboard(b: B, cx: number, y: number, cz: number, w: number, idx: number, legH = 1.6) {
  const h = w / 2;
  const [layer, half] = BILL[idx];
  const y0 = y + legH, y1 = y0 + h;
  b.d(cx - w / 2, y0, cx + w / 2, y1, cz + 0.3, layer, billRect(half));
  // back: steel plate, edges, truss legs
  const steel: FS = { layer: 'roof_bits' };
  const r = BITS.steel;
  b.w.wall(cx + w / 2, cz - 0.2, cx - w / 2, cz - 0.2, y0, y1, b.mat(steel), { uv: [0, 1 - (r[1] + r[3]) / 512, w / 4, 1 - r[1] / 512], gBase: b.g(y0), gTop: b.g(y1) });
  b.trim(cx - w / 2 - 0.08, y0 - 0.1, cz - 0.2, cx - w / 2, y1 + 0.1, cz + 0.32, TRIM_STEEL);
  b.trim(cx + w / 2, y0 - 0.1, cz - 0.2, cx + w / 2 + 0.08, y1 + 0.1, cz + 0.32, TRIM_STEEL);
  b.trim(cx - w / 2, y1, cz - 0.2, cx + w / 2, y1 + 0.1, cz + 0.32, TRIM_STEEL);
  b.trim(cx - w / 2, y0 - 0.1, cz - 0.2, cx + w / 2, y0, cz + 0.32, TRIM_STEEL);
  const n = Math.max(2, Math.round(w / 3));
  for (let i = 0; i <= n; i++) {
    const x = cx - w / 2 + (i / n) * w;
    b.trim(x - 0.08, y, cz - 0.1, x + 0.08, y0, cz + 0.06, TRIM_STEEL, { top: false });
    b.trim(x - 0.06, y, cz - 1.4, x + 0.06, y0 - 0.3, cz - 1.28, TRIM_STEEL, { top: false });
  }
  // truss band between the legs, both sides
  const tr = CUT.truss;
  const tv: [number, number, number, number] = [0, 1 - (tr[1] + tr[3]) / 512, w / 4, 1 - tr[1] / 512];
  b.w.wall(cx - w / 2, cz + 0.08, cx + w / 2, cz + 0.08, y + 0.2, y0 - 0.15, b.mat({ layer: 'deco_cut' }), { uv: tv, gBase: b.g(y), gTop: b.g(y0) });
  b.w.wall(cx + w / 2, cz + 0.07, cx - w / 2, cz + 0.07, y + 0.2, y0 - 0.15, b.mat({ layer: 'deco_cut' }), { uv: tv, gBase: b.g(y), gTop: b.g(y0) });
  // floodlights on arms over the face
  for (const fx of [-w / 3, 0, w / 3]) {
    b.trim(cx + fx - 0.04, y1 + 0.1, cz + 0.3, cx + fx + 0.04, y1 + 0.18, cz + 1.1, TRIM_DARK);
    b.d(cx + fx - 0.18, y1 + 0.05, cx + fx + 0.18, y1 + 0.22, cz + 1.12, 'roof_bits', swatch('white'));
  }
  b.light(cx, y0 + h * 0.5, cz + 1.5, [1, 0.95, 0.85], Math.max(6, w * 0.7));
}

/** Neon panel standing proud of a wall (dark backing box + neon art). */
function neonPanel(b: B, cx: number, y: number, s: number, key: keyof typeof NEON, z = 0) {
  const [layer, i] = NEON[key];
  signBox(b, cx - s / 2, cx + s / 2, y, y + s, z, 0.18, layer, neonRect(i), TRIM_DARK);
  b.light(cx, y + s / 2, z + 1, NEON_COL[key], Math.max(4, s * 1.6));
}

/** Vending machine against a facade frame at x, on the ground in front of z=0. */
function vending(b: B, x: number, i: number, z = 0) {
  const w = 1.0, h = 1.83, d = 0.72;
  const zf = z + d;
  b.d(x - w / 2, 0, x + w / 2, h, zf, 'sign_vending', VEND_FRONT(i));
  const r = VEND_SIDE(i);
  const uv: [number, number, number, number] = [r[0] / 512, 1 - (r[1] + r[3]) / 512, (r[0] + r[2]) / 512, 1 - r[1] / 512];
  b.w.wall(x + w / 2, zf, x + w / 2, z, 0, h, b.mat({ layer: 'sign_vending' }), { uv, gBase: 0, gTop: b.g(h) });
  b.w.wall(x - w / 2, z, x - w / 2, zf, 0, h, b.mat({ layer: 'sign_vending' }), { uv, gBase: 0, gTop: b.g(h) });
  b.flat(x - w / 2, z, x + w / 2, zf, h, { layer: null, col: TRIM_STEEL });
  b.trim(x - w / 2, -0.3, z, x + w / 2, 0.02, zf, TRIM_DARK, { top: false });
  b.light(x, 1.1, zf + 0.6, [0.85, 0.95, 1], 3.5);
}

/** Graffiti decal on a facade frame at z (a few cm proud). kind: tag/throw/piece/sticker. */
function graffiti(b: B, kind: 'tag' | 'throw' | 'piece' | 'sticker', x: number, y: number, scale: number, z = 0.035) {
  const r = b.r;
  if (kind === 'tag') { const w = 1.5 * scale, h = w * (128 / 170); b.d(x - w / 2, y, x + w / 2, y + h, z, 'graf_tags', tagRect(r.int(0, 11))); }
  else if (kind === 'throw') { const w = 2.2 * scale; b.d(x - w / 2, y, x + w / 2, y + w, z, 'graf_throws', throwRect(r.int(0, 3))); }
  else if (kind === 'piece') { const w = 5.6 * scale, h = w / 2; const [layer, half] = r.pick(PIECES); b.d(x - w / 2, y, x + w / 2, y + h, z, layer, [0, half * 256, 512, 256]); }
  else { const w = 0.45 * scale; b.d(x - w / 2, y, x + w / 2, y + w, z, 'graf_stickers', stickRect(r.int(0, 15))); }
}

/** Scatter street-level graffiti over a stretch of wall in a facade frame. */
function graffitiRun(b: B, x0: number, x1: number, amount: number, yMax = 3) {
  const r = b.r;
  const len = x1 - x0;
  if (len < 1.5) return;
  let z = 0.03;
  if (amount > 0.6 && len > 7 && r.chance(amount * 0.8)) { const s = Math.min(1, (len - 1) / 5.6) * r.range(0.75, 1); graffiti(b, 'piece', x0 + len / 2 + r.range(-0.5, 0.5), r.range(0.2, 0.5), s, z); z += 0.012; }
  const n = Math.floor(len / 3 * amount);
  for (let i = 0; i < n; i++) {
    const k = r.wpick([['tag', 4], ['throw', 1.5], ['sticker', 2]] as const);
    const s = k === 'sticker' ? r.range(0.8, 1.3) : r.range(0.6, 1.0);
    const span = k === 'throw' ? 2.2 * s : k === 'tag' ? 1.5 * s : 0.5;
    if (span > len) continue;
    graffiti(b, k, r.range(x0 + span / 2, x1 - span / 2), k === 'sticker' ? r.range(1.2, 2.2) : r.range(0.25, Math.max(0.3, yMax - span * 0.7)), s, z);
    z += 0.006;
  }
}

/** House-atlas window/door decal centred at (x, y0 bottom). Window cells get a random u shift so each lights on its own. */
function hwin(b: B, k: keyof typeof HOUSE, x: number, y0: number, z = 0.03, scale = 1) {
  const [w, h] = HOUSE_SIZE[k];
  b.d(x - (w * scale) / 2, y0, x + (w * scale) / 2, y0 + h * scale, z, 'deco_house', HOUSE[k], undefined, b.r.int(1, 300));
}

/** Rooftop clutter on a flat roof rectangle: AC units, tank, dish, vents. */
function roofClutter(b: B, x0: number, x1: number, z0: number, z1: number, y: number, o: { tank?: boolean; ac?: number; dish?: boolean; solar?: boolean } = {}) {
  const r = b.r;
  const w = x1 - x0, d = z1 - z0;
  if (w < 3 || d < 3) return;
  const nAC = o.ac ?? r.int(1, Math.max(1, Math.floor(w / 4)));
  for (let i = 0; i < nAC; i++) {
    const x = r.range(x0 + 0.8, x1 - 0.8), z = r.range(z0 + 0.6, z1 - 1.2);
    b.at(x, y, z, r.chance(0.7) ? 0 : Math.PI / 2, () => acUnit(b, 0, 0, 0));
  }
  if (o.tank && w > 5 && d > 5) waterTank(b, r.range(x0 + 1.8, x1 - 1.8), r.range(z0 + 1.5, z1 - 1.5), y);
  if (o.dish && r.chance(0.6)) { const x = r.range(x0 + 0.5, x1 - 0.5), z = r.range(z0 + 0.5, z1 - 0.5); b.d(x - 0.35, y + 0.5, x + 0.35, y + 1.2, z, 'deco_cut', CUT.dish); b.trim(x - 0.03, y, z - 0.05, x + 0.03, y + 0.6, z, TRIM_STEEL); }
  if (o.solar && w > 6) {
    const sx = r.range(x0 + 1, x1 - 4.5), sz = r.range(z0 + 1, z1 - 3);
    b.quad([[sx, y + 0.4, sz + 2.2], [sx + 3.6, y + 0.4, sz + 2.2], [sx + 3.6, y + 1.2, sz], [sx, y + 1.2, sz]], { layer: 'roof_bits' }, [BITS.solar[0] / 512, 1 - (BITS.solar[1] + BITS.solar[3]) / 512, (BITS.solar[0] + BITS.solar[2]) / 512, 1 - (BITS.solar[1] + BITS.solar[3]) / 512, (BITS.solar[0] + BITS.solar[2]) / 512, 1 - BITS.solar[1] / 512, BITS.solar[0] / 512, 1 - BITS.solar[1] / 512]);
  }
}

/** Corner pilaster strips (proud, flat-colour) on the four vertical edges of a box. */
function cornerPiers(b: B, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, w: number, f: FS) {
  const e = 0.08;
  for (const [cx, cz, sx, sz] of [[x0, z1, 1, -1], [x1, z1, -1, -1], [x1, z0, -1, 1], [x0, z0, 1, 1]] as const) {
    // proud of the walls by e outside, w deep inside the corner (sx/sz point inward)
    const xa = sx > 0 ? cx - e : cx - w, xb = sx > 0 ? cx + w : cx + e;
    const za = sz > 0 ? cz - e : cz - w, zb = sz > 0 ? cz + w : cz + e;
    b.box(xa, y0, za, xb, y1, zb, { side: f, top: { layer: null, col: f.col } });
  }
}

/** A run of floor bands (thin protruding rings) every k floors. */
function floorBands(b: B, x0: number, x1: number, z0: number, z1: number, ys: number[], col: RGB, e = 0.12, h = 0.32) {
  const f: FS = { layer: null, col };
  for (const y of ys) b.box(x0 - e, y - h / 2, z0 - e, x1 + e, y + h / 2, z1 + e, { side: f, top: f, bottom: { layer: null, col: mulRGB(col, 0.8) } });
}

// ───────────────────────────── Downtown ─────────────────────────────

function glassTower(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const gk = r.pick(['a', 'a', 'b', 'c'] as const);
  const va = gk === 'a';
  const layer = `fac_curtain_${gk}`;
  const fh = gk === 'a' ? TILE.curtainA[1] : gk === 'b' ? TILE.curtainB[1] : TILE.curtainC[1];
  const accent = r.col(PAL.wallVivid);
  const finC = r.chance(0.4);
  const podH = 5.6;
  const inset = r.chance(0.55) ? r.range(1.6, 3.2) : 0;
  const tx0 = -W / 2 + inset, tx1 = W / 2 - inset, tz1 = -inset, tz0 = -D + Math.min(inset, 1.5);
  const topY = podH + F * fh;
  const tint = r.pick<RGB>([[1, 1, 1], [0.92, 0.97, 1.08], [1.06, 0.97, 1.0], [0.94, 1.05, 1.0], [1.04, 1.02, 0.94]]);
  const granite: FS = { layer: 'fac_wall_plain', col: r.col(PAL.granite), tile: TILE.plain };
  const alu = r.col([0xdfe6ee, 0xc8d0dc, 0xe8e4dc, 0x9aa4b8]);
  plinth(b, -W / 2, W / 2, -D, 0, mulRGB(granite.col!, 0.9));

  // podium: lobby in the middle, shops either side
  const lob = Math.min(8, W * 0.45);
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s !== 'front') {
      plainFace(b, len, 0.3, podH + (inset ? 0.9 : 0), granite);
      if (s === 'back') return;
      // corner sites: the podium shops wrap round the front corner
      const fe = s === 'right' ? -1 : 1;
      const sw = Math.min(8, len * 0.45);
      const a = fe < 0 ? -len / 2 + 0.6 : len / 2 - 0.6 - sw, c = a + sw;
      const kind = r.pick<ShopKind>(['cafe', 'drugstore', 'salon', 'bakery', 'ramen']);
      shopfront(b, a, c, 0.3, 3.6, kind, { band: SHOP_BAND[kind], bandY: 3.7, jamb: granite });
      graffitiRun(b, fe < 0 ? c + 0.6 : -len / 2 + 1, fe < 0 ? len / 2 - 1 : a - 0.6, 0.15);
      return;
    }
    b.t(-len / 2, len / 2, 0.3, podH + (inset ? 0.9 : 0), 0, granite);
    shopfront(b, -lob / 2, lob / 2, 0.3, 4.4, 'lobby', { recess: 0.5, jamb: granite });
    const rest = (len - lob) / 2;
    for (const sgn of [-1, 1]) {
      const a = sgn < 0 ? -len / 2 : lob / 2, c = sgn < 0 ? -lob / 2 : len / 2;
      if (rest > 5) {
        const kind = r.pick<ShopKind>(['cafe', 'drugstore', 'salon', 'bakery', 'konbini']);
        const pa = a + 0.45, pc = c - 0.45;
        const band: Record<ShopKind, string | null> = { cafe: 'kissa', drugstore: 'drug', salon: 'salon', bakery: 'bakery', konbini: r.pick(['momo', 'lumi']), ramen: 'ramen', izakaya: 'izakaya', pachinko: 'galaxy', shutter: null, lobby: null };
        shopfront(b, pa, pc, 0.3, 3.6, kind, { band: band[kind], bandY: 3.7, jamb: granite });
      }
    }
    // entrance canopy with a lit soffit strip, and the building name
    const cw = lob + 1.2;
    b.trim(-cw / 2, 4.55, 0, cw / 2, 4.85, 2.6, alu, { bottom: true });
    b.d(-cw / 2 + 0.3, 4.53, cw / 2 - 0.3, 4.55, 0.6, 'roof_bits', swatch('warm'));
    b.flat(-cw / 2 + 0.4, 0.4, cw / 2 - 0.4, 2.3, 4.54, { layer: 'roof_bits', col: WHITE }, true);
    b.light(0, 4.4, 1.6, [1, 0.9, 0.75], 7);
    const name = r.pick([TEN.bldChuo, TEN.bldAoi, TEN.bldMidori, TEN.bldMatsumoto]);
    b.d(-1.6, 4.95, 1.6, 5.45, 0.04, 'sign_tenant', tenRect(name));
  });
  if (inset > 0) {
    // podium roof ring around the shaft
    const pf: FS = { layer: 'roof_flat', tile: TILE.flat };
    b.flat(-W / 2, tz1, W / 2, 0, podH, pf);
    b.flat(-W / 2, tz0, tx0, tz1, podH, pf); b.flat(tx1, tz0, W / 2, tz1, podH, pf);
    if (tz0 > -D) b.flat(-W / 2, -D, W / 2, tz0, podH, pf);
    b.trim(-W / 2, podH + 0.9, -0.25, W / 2, podH + 1.0, 0, alu);
    railing(b, -W / 2 + 0.3, -0.3, W / 2 - 0.3, -0.3, podH);
  }
  // shaft: curtain wall all round
  const uo = { front: 0, right: 40, back: 80, left: 120 } as const;
  walls(b, tx0, tx1, tz0, tz1, (s, len) => {
    const y0 = inset ? podH : podH;
    if (!inset && s === 'front') b.bays(-len / 2, len / 2, y0, topY + 2.2, 0, layer, 3, fh, podH, tint, uo[s]);
    else if (!inset) b.bays(-len / 2, len / 2, y0, topY + 2.2, 0, layer, 3, fh, podH, tint, uo[s]);
    else b.bays(-len / 2, len / 2, podH, topY + 2.2, 0, layer, 3, fh, podH, tint, uo[s]);
  });
  // vertical fins on the long faces
  if (va || r.chance(0.4)) {
    const n = Math.max(1, Math.round((tx1 - tx0) / 3));
    for (let i = 1; i < n; i++) {
      const x = tx0 + (i / n) * (tx1 - tx0);
      b.trim(x - 0.07, podH + 0.4, tz1, x + 0.07, topY + 2.2, tz1 + 0.45, finC ? accent : alu, { back: false });
    }
  }
  cornerPiers(b, tx0, tx1, tz0, tz1, podH, topY + 2.4, 0.45, { layer: null, col: finC ? accent : alu });
  // crown: a coloured band round the top with a glowing strip under it
  {
    const e = 0.12, y0 = topY + 0.9, y1 = topY + 2.4;
    const glow = r.pick(['cyan', 'pink', 'white', 'amber', 'blue'] as const);
    b.box(tx0 - e, y0, tz0 - e, tx1 + e, y1, tz1 + e, { side: { layer: 'fac_wall_plain', col: accent, tile: TILE.plain }, top: null, bottom: { layer: null, col: mulRGB(accent, 0.7) } });
    for (const sd of ['front', 'right', 'back', 'left'] as const) b.side(sd, tx0 - e, tx1 + e, tz0 - e, tz1 + e, (len) => b.d(-len / 2, y0 - 0.22, len / 2, y0 - 0.06, 0.04, 'roof_bits', swatch(glow)));
  }
  const every = r.int(5, 8);
  const ys: number[] = [];
  for (let k = every; k < F; k += every) ys.push(podH + k * fh);
  floorBands(b, tx0, tx1, tz0, tz1, ys, alu, 0.1, 0.3);
  // crown: screen walls continue 2.2 m above the roof; roof, penthouse, mast and beacon
  flatRoof(b, tx0, tx1, tz0, tz1, topY, 2.2, { layer: 'fac_wall_plain', col: hexRGB(0xb8bcc8), tile: TILE.plain }, alu, 0.3);
  const pw = (tx1 - tx0) * 0.45, pd = (tz1 - tz0) * 0.4;
  const pcx = r.range(tx0 + pw / 2 + 1, tx1 - pw / 2 - 1), pcz = (tz0 + tz1) / 2;
  b.box(pcx - pw / 2, topY, pcz - pd / 2, pcx + pw / 2, topY + 4.2, pcz + pd / 2, { side: { layer: 'fac_whwin', col: hexRGB(0xc8d0e0), tile: [3, 4.2] }, top: { layer: 'roof_flat', tile: TILE.flat } });
  const mh = r.range(6, 14);
  b.trim(pcx - 0.15, topY + 4.2, pcz - 0.15, pcx + 0.15, topY + 4.2 + mh, pcz + 0.15, hexRGB(0xd04040));
  for (let k = 1; k < 4; k++) b.trim(pcx - 0.3, topY + 4.2 + (mh * k) / 4, pcz - 0.3, pcx + 0.3, topY + 4.25 + (mh * k) / 4, pcz + 0.3, WHITE);
  b.box(pcx - 0.22, topY + 4.2 + mh, pcz - 0.22, pcx + 0.22, topY + 4.6 + mh, pcz + 0.22, { side: { layer: 'roof_bits' }, top: { layer: null, col: TRIM_DARK } });
  b.at(pcx, topY + 4.2 + mh, pcz + 0.23, 0, () => b.d(-0.2, 0.02, 0.2, 0.38, 0, 'roof_bits', swatch('red')));
  b.light(pcx, topY + 4.4 + mh, pcz, [1, 0.15, 0.1], 3);
  roofClutter(b, tx0 + 0.6, tx1 - 0.6, tz0 + 0.6, tz1 - 0.6, topY, { ac: r.int(2, 5) });
  if (r.chance(0.2) && tx1 - tx0 > 14) billboard(b, (tx0 + tx1) / 2, topY + 2.2, tz1 - 1.4, Math.min(14, (tx1 - tx0) - 4), r.int(0, 5), 1.2);
  return topY + 4.6 + mh;
}

function officeSetback(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = TILE.officeBand[1], g0 = 4.6;
  const wallC = r.col([...PAL.wallLight, ...PAL.wallCool]);
  const wall: FS = { layer: r.chance(0.5) ? 'fac_wall_tile' : 'fac_wall_plain', col: wallC, tile: TILE.tile };
  const tint = r.col([0xffffff, 0xfff4e8, 0xf0f4ff, 0xfff0f0], 0.04);
  const pier: FS = { layer: 'fac_wall_plain', col: mulRGB(wallC, 0.86), tile: TILE.plain };
  const nT = F > 12 ? 3 : 2;
  const fl = nT === 3 ? [Math.round(F * 0.5), Math.round(F * 0.3)] : [Math.round(F * 0.65)];
  fl.push(F - fl.reduce((a, c) => a + c, 0));
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7684));
  let x0 = -W / 2, x1 = W / 2, z0 = -D, z1 = 0, y = 0.3, floor = 0;
  const ux = r.range(0.3, 0.7);
  let top = 0;
  for (let t = 0; t < fl.length; t++) {
    const yTop = (t === 0 ? g0 : y) + fl[t] * fh - (t === 0 ? 0 : 0);
    const yb = y;
    const sidesBlank = r.chance(0.45);
    walls(b, x0, x1, z0, z1, (s, len) => {
      if (t === 0) {
        if (s === 'front') {
          b.t(-len / 2, len / 2, 0.3, g0, 0, pier); // backdrop piers
          const lob = Math.min(7.5, len * 0.4);
          const lx = (ux - 0.5) * (len - lob - 2);
          shopfront(b, lx - lob / 2, lx + lob / 2, 0.3, 3.9, 'lobby', { recess: 0.4, jamb: pier });
          const left = lx - lob / 2 - (-len / 2), right = len / 2 - (lx + lob / 2);
          for (const [a, c] of [[-len / 2 + 0.5, lx - lob / 2 - 0.5], [lx + lob / 2 + 0.5, len / 2 - 0.5]] as const) {
            if (c - a > 5) { const k = r.pick<ShopKind>(['cafe', 'drugstore', 'bakery', 'konbini', 'ramen']); shopfront(b, a, c, 0.3, 3.5, k, { band: ({ cafe: 'kissa', drugstore: 'drug', bakery: 'bakery', konbini: 'lumi', ramen: 'ramen' } as Record<string, string>)[k], bandY: 3.62, jamb: pier }); }
          }
          void left; void right;
        } else { plainFace(b, len, 0.3, g0, pier); if (s !== 'back') graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.2); }
        if (s !== 'front' && sidesBlank) plainFace(b, len, g0, yTop + 1, wall);
        else b.bays(-len / 2, len / 2, g0, yTop, 0, 'fac_office_band', TILE.officeBand[0], fh, g0, tint, s.length * 31);
        if (!(s !== 'front' && sidesBlank)) b.t(-len / 2, len / 2, yTop, yTop + 1, 0, wall);
      } else {
        if (s !== 'front' && sidesBlank) plainFace(b, len, yb, yTop + 1, wall);
        else { b.bays(-len / 2, len / 2, yb, yTop, 0, 'fac_office_band', TILE.officeBand[0], fh, yb, tint, s.length * 31 + t * 7); b.t(-len / 2, len / 2, yTop, yTop + 1, 0, wall); }
      }
    });
    cornerPiers(b, x0, x1, z0, z1, t === 0 ? 0.3 : yb, yTop + 1, 0.7, pier);
    flatRoof(b, x0, x1, z0, z1, yTop, 1, wall, mulRGB(wallC, 1.05));
    floor += fl[t];
    top = yTop;
    // next tier: set back
    if (t < fl.length - 1) {
      const fz = r.range(2.5, 4.5), sx = r.range(1.5, 3.5), skew = r.range(-1.5, 1.5);
      const nx0 = x0 + sx + skew, nx1 = x1 - sx + skew, nz1 = z1 - fz, nz0 = z0 + r.range(0, 2);
      if (nx1 - nx0 > 8 && nz1 - nz0 > 8) { railing(b, x0 + 0.4, z1 - 0.35, x1 - 0.4, z1 - 0.35, yTop + 1); x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1; }
      y = yTop;
      roofClutter(b, x0 - sx + 0.5, x0 - 0.3, z0, z1, yTop, { ac: 1 });
    }
  }
  const tw = Math.min(6, (x1 - x0) * 0.4);
  stairHouse(b, x1 - tw - 1, x1 - 1, z0 + 1, z0 + 4.5, top, 3.2, wall);
  roofClutter(b, x0 + 0.6, x1 - tw - 1.5, z0 + 0.6, z1 - 0.6, top, { tank: r.chance(0.5), ac: r.int(2, 4) });
  let h = top + 4.4;
  if (r.chance(0.35) && x1 - x0 > 12) { const bw = Math.min(12, x1 - x0 - 4); billboard(b, (x0 + x1) / 2, top + 1, z1 - 1.2, bw, r.int(0, 5), 1.0); h = Math.max(h, top + 2 + bw / 2); }
  return h;
}

const TENANT_FLOORS = [TEN.karaoke2, TEN.mahjong3, TEN.english4, TEN.dentist5, TEN.bar, TEN.snack, TEN.nail, TEN.seitai, TEN.juku, TEN.tax, TEN.massage, TEN.photo, TEN.dance, TEN.manga, TEN.go, TEN.cafe2];
const SHOP_BAND: Record<ShopKind, string | null> = { konbini: 'momo', ramen: 'ramen', izakaya: 'izakaya', cafe: 'kissa', salon: 'salon', pachinko: 'galaxy', shutter: null, bakery: 'bakery', lobby: null, drugstore: 'drug' };
const SHOP_BLADE: Partial<Record<ShopKind, string>> = { ramen: 'ramen', izakaya: 'izakaya', cafe: 'kissa', salon: 'salon', pachinko: 'pachinko', drugstore: 'drug' };

function zakkyoTower(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = TILE.zakkyo[1], g0 = 4.0;
  const top = g0 + (F - 1) * fh;
  const wallC = r.col([...PAL.tile, ...PAL.wallWarm, ...PAL.wallCool]);
  const wall: FS = { layer: 'fac_wall_tile', col: wallC, tile: TILE.tile };
  const side: FS = { layer: r.chance(0.5) ? 'fac_wall_plain' : 'fac_wall_tile', col: mulRGB(wallC, 0.95), tile: TILE.plain };
  const frame: FS = { layer: 'fac_wall_plain', col: mulRGB(r.col(PAL.wallVivid), 0.9), tile: TILE.plain };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7480));
  const bladeSide = r.chance(0.5) ? 1 : -1;
  const kind = r.pick<ShopKind>(['ramen', 'izakaya', 'cafe', 'drugstore', 'salon', 'konbini', 'shutter', 'bakery']);
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front') {
      // ground floor: shop + narrow lift-lobby entrance
      const ew = 1.6;
      const ex = bladeSide > 0 ? -len / 2 + 0.4 : len / 2 - 0.4 - ew;
      const sx0 = bladeSide > 0 ? ex + ew + 0.4 : -len / 2 + 0.4, sx1 = bladeSide > 0 ? len / 2 - 0.4 : ex - 0.4;
      b.t(-len / 2, len / 2, 0.3, g0, 0, frame);
      b.hole(ex, ex + ew, 0.3, 3.2); b.d(ex, 0.3, ex + ew, 3.2, -0.6, 'shop_e', LOBBY_DOOR);
      b.w.wall(ex, 0, ex, -0.6, 0.3, 3.2, b.mat(frame), { uv: [0, 0, 0.15, 0.7], gBase: b.g(0.3), gTop: b.g(3.2) });
      b.w.wall(ex + ew, -0.6, ex + ew, 0, 0.3, 3.2, b.mat(frame), { uv: [0, 0, 0.15, 0.7], gBase: b.g(0.3), gTop: b.g(3.2) });
      b.flat(ex, -0.6, ex + ew, 0, 3.2, { layer: null, col: TRIM_SOFFIT }, true);
      b.d(ex + 0.2, 3.3, ex + ew - 0.2, 3.7, 0.02, 'sign_tenant', tenRect(r.pick([TEN.bldChuo, TEN.bldMatsumoto, TEN.bldMidori, TEN.bldAoi])));
      b.light(ex + ew / 2, 2.8, 0.5, [0.9, 0.95, 1], 3);
      shopfront(b, sx0, sx1, 0.3, 3.3, kind, { band: SHOP_BAND[kind] ?? (kind === 'konbini' ? 'lumi' : null), bandY: 3.38, jamb: frame, awning: kind === 'cafe' || kind === 'bakery' ? r.int(0, 3) : undefined });
      // upper floors: zakkyo bays in a coloured frame
      const fw = 0.45;
      b.t(-len / 2, -len / 2 + fw, g0, top + 1.2, 0, frame);
      b.t(len / 2 - fw, len / 2, g0, top + 1.2, 0, frame);
      b.bays(-len / 2 + fw, len / 2 - fw, g0, top, 0, 'fac_zakkyo', TILE.zakkyo[0], fh, g0, WHITE, 0);
      b.t(-len / 2 + fw, len / 2 - fw, top, top + 1.2, 0, frame);
      // tenant plates in the windows
      const used = new Set<number>();
      for (let f = 0; f < F - 1; f++) {
        if (!r.chance(0.75)) continue;
        let t = r.pick(TENANT_FLOORS); if (used.has(t)) t = r.pick(TENANT_FLOORS); used.add(t);
        const yy = g0 + f * fh + 1.0;
        const x = r.range(-len / 2 + fw + 0.4, len / 2 - fw - 2.0);
        b.d(x, yy, x + 1.5, yy + 0.75, 0.06, 'sign_tenant', tenRect(t));
      }
      // stacked blade signs on one edge
      const bx = bladeSide * (len / 2 - 0.35);
      let yb = g0 + 0.4;
      const keys = Object.keys(BLADE);
      const first = SHOP_BLADE[kind];
      let k = 0;
      while (yb + 4.6 < top + 0.8) {
        const key = k === 0 && first ? first : r.pick(keys);
        blade(b, bx, yb, 4.6, key, 0.72);
        yb += 4.9; k++;
      }
    } else if (s === 'back') plainFace(b, len, 0.3, top + 1.2, side);
    else {
      plainFace(b, len, 0.3, top + 1.2, side);
      // AC units and small windows up the side
      for (let f = 1; f < F; f++) {
        const yy = g0 + (f - 1) * fh;
        if (r.chance(0.6)) hwin(b, 'frosted', r.range(-len / 2 + 1, len / 2 - 1), yy + 1.2);
        if (r.chance(0.5)) acUnit(b, r.range(-len / 2 + 1, len / 2 - 1), yy + 0.2, 0.02);
      }
      graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.6);
    }
  });
  flatRoof(b, -W / 2, W / 2, -D, 0, top, 1.2, side, hexRGB(0xe8e4dc));
  let h = top + 1.2;
  if (r.chance(0.7)) { const bw = Math.min(W - 1, 11); billboard(b, 0, top, -1.6, bw, r.int(0, 5), 2.0); h = top + 2 + bw / 2; }
  else { neonPanel(b, 0, top + 1.2, Math.min(4, W * 0.4), r.pick(['karaoke', 'manga', 'game', 'bar'] as const), -1.5); h = top + 5.5; }
  roofClutter(b, -W / 2 + 0.6, W / 2 - 0.6, -D + 0.6, -3, top, { tank: r.chance(0.6), ac: r.int(1, 3) });
  return h;
}

function pachinkoHall(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = 4.4, H = 4.8 + (F - 1) * fh;
  const wallC = r.col([0xffffff, 0xf4e8ff, 0xffe8f0, 0xe8f0ff]);
  const side: FS = { layer: 'fac_wall_plain', col: wallC, tile: TILE.plain };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x5a4a6a));
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s !== 'front') {
      plainFace(b, len, 0.3, H + 1.2, side);
      if (s !== 'back') { graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.9, 3.4); if (r.chance(0.5)) neonPanel(b, r.range(-len / 4, len / 4), H - 5, 3.5, r.pick(['game', 'manga', 'karaoke'] as const)); }
      return;
    }
    // ground: flash cladding (gold) with the entrance in the middle
    const ew = 7.2;
    for (const [a, c] of [[-len / 2, -ew / 2], [ew / 2, len / 2]] as const) {
      b.q(a, c, 0.3, 4.8, 0, { layer: 'sign_flash' }, [a / 4, 0, c / 4, 0.5]);
    }
    shopfront(b, -ew / 2, ew / 2, 0.3, 4.2, 'pachinko', { recess: 0.6, jamb: { layer: null, col: hexRGB(0xd8a030) } });
    b.q(-ew / 2, ew / 2, 4.2, 4.8, 0, { layer: 'sign_flash' }, [-ew / 8, 0, ew / 8, 0.12]);
    // upper facade: pink chevron LED cladding in bands
    for (let y = 4.8; y < H + 1.2 - 0.01; y += 2.4) b.q(-len / 2, len / 2, y, Math.min(H + 1.2, y + 2.4), 0, { layer: 'sign_flash' }, [-len / 8, 0.5, len / 8, 0.5 + 0.5 * (Math.min(H + 1.2, y + 2.4) - y) / 2.4]);
    // the big name sign and neon panels
    const sw = Math.min(len - 2, 18), sh = sw / 8;
    signBox(b, -sw / 2, sw / 2, H - sh - 0.6, H - 0.6, 0, 0.45, 'sign_band_b', bandRect(0));
    b.light(0, H - sh, 2, [1, 0.4, 0.8], 12);
    if (F >= 3) {
      const ns = Math.min(4.2, (H - sh - 6) * 0.9);
      if (ns > 2) { const k1 = r.pick(['game', 'manga'] as const); neonPanel(b, -len / 4, 5.6, ns, k1); neonPanel(b, len / 4, 5.6, ns, r.pick(k1 === 'game' ? (['karaoke', 'manga'] as const) : (['karaoke', 'game'] as const))); }
    }
    blade(b, (r.chance(0.5) ? -1 : 1) * (len / 2 - 0.5), 5.0, Math.min(H - 5.5, 9), 'pachinko', 1.0);
    b.light(0, 2.5, 2, [1, 0.8, 0.4], 10);
  });
  flatRoof(b, -W / 2, W / 2, -D, 0, H, 1.2, side, hexRGB(0xffe080));
  // chasing light strip along the front parapet
  b.d(-W / 2, H + 1.0, W / 2, H + 1.2, 0.03, 'roof_bits', swatch('amber'));
  // rooftop sign frame with neon
  const ns = Math.min(5, W / 4);
  for (const [x, k] of [[-ns * 0.6, r.pick(['game', 'karaoke'] as const)], [ns * 0.6, r.pick(['manga', 'bar'] as const)]] as const) {
    neonPanel(b, x, H + 2.2, ns, k, -2);
    for (const lx of [x - ns / 2 + 0.3, x + ns / 2 - 0.3]) b.trim(lx - 0.08, H, -2.3, lx + 0.08, H + 2.2, -2.1, TRIM_STEEL, { top: false });
  }
  roofClutter(b, -W / 2 + 1, W / 2 - 1, -D + 1, -4, H, { ac: r.int(3, 6) });
  return H + 2.2 + ns;
}

// ───────────────────────────── Old Town ─────────────────────────────

function machiya(b: B, W: number, D: number) {
  const r = b.r;
  const ken = W / Math.max(3, Math.round(W / 1.82));
  const n = Math.round(W / ken);
  const h1 = 3.0, h2 = 2.35, yE = h1 + h2;
  const bengara = r.chance(0.3);
  const woodT = bengara ? r.col(PAL.bengara) : r.col(PAL.wood);
  const plasterC = r.col(PAL.plaster);
  const plaster: FS = { layer: 'fac_plaster', col: plasterC, tile: TILE.plaster };
  const woodBd: FS = { layer: 'fac_wood', col: mulRGB(woodT, 0.8), tile: TILE.wood };
  const roofC = r.col([0xffffff, 0xd8dcf0, 0xb8bcd0]);
  const kawara: FS = { layer: 'roof_kawara', col: roofC, tile: TILE.kawara };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x8a847c), 0.25);
  const shopMode = r.wpick([['lattice', 5], ['izakaya', 1.5], ['ramen', 0.8], ['shutter', 0.5]] as const);
  const entrance = r.int(0, n - 1);
  const noren = r.pick([NOREN.sake, NOREN.soba, NOREN.tea, NOREN.yu, NOREN.sake]);
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front') {
      if (shopMode === 'lattice') {
        for (let i = 0; i < n; i++) {
          const x0 = -len / 2 + i * ken, x1 = x0 + ken;
          if (i === entrance) {
            // recessed entrance with a lattice door and a noren
            b.q(x0 + 0.1, x1 - 0.1, 0.25, h1, -0.7, { layer: 'fac_koshi', col: mulRGB(woodT, 0.85) }, [i + 50, 0.1, i + 50.94, 1]);
            b.w.wall(x0 + 0.1, 0, x0 + 0.1, -0.7, 0.25, h1, b.mat(woodBd), { uv: [0, 0, 0.35, 1], gBase: b.g(0.25), gTop: b.g(h1) });
            b.w.wall(x1 - 0.1, -0.7, x1 - 0.1, 0, 0.25, h1, b.mat(woodBd), { uv: [0, 0, 0.35, 1], gBase: b.g(0.25), gTop: b.g(h1) });
            b.flat(x0 + 0.1, -0.7, x1 - 0.1, 0, 0.25, { layer: null, col: TRIM_STONE });
            b.t(x0, x0 + 0.1, 0.25, h1, 0, woodBd); b.t(x1 - 0.1, x1, 0.25, h1, 0, woodBd);
            b.d(x0 + 0.15, h1 - 1.25, x1 - 0.15, h1 - 0.05, -0.12, 'sign_awning', NOREN_RECT(noren));
            b.light((x0 + x1) / 2, 1.5, 0.8, [1, 0.62, 0.3], 4);
          } else {
            b.q(x0, x1, 0.25, h1, 0, { layer: 'fac_koshi', col: woodT }, [i, 0.25 / TILE.koshi[1], i + 1, h1 / TILE.koshi[1]]);
            if (r.chance(0.45)) {
              // inu-yarai: curved bamboo screen leaning out at the foot
              const [, ry, , rh] = CUT.inuyarai;
              b.quad([[x0 + 0.05, 0.0, 0.45], [x1 - 0.05, 0.0, 0.45], [x1 - 0.05, 0.95, 0.04], [x0 + 0.05, 0.95, 0.04]], { layer: 'deco_cut', col: WHITE }, [x0 / 1.8, 1 - (ry + rh) / 512, x1 / 1.8, 1 - (ry + rh) / 512, x1 / 1.8, 1 - ry / 512, x0 / 1.8, 1 - ry / 512], 0, b.g(0.95));
            }
          }
        }
      } else {
        b.t(-len / 2, -len / 2 + 0.3, 0.25, h1, 0, woodBd); b.t(len / 2 - 0.3, len / 2, 0.25, h1, 0, woodBd);
        b.t(-len / 2 + 0.3, len / 2 - 0.3, h1 - 0.2, h1, 0, woodBd);
        shopfront(b, -len / 2 + 0.3, len / 2 - 0.3, 0.25, h1 - 0.2, shopMode, { recess: 0.25, jamb: woodBd });
      }
      // upper floor: mushiko bays
      b.q(-len / 2, len / 2, h1, yE, 0, { layer: 'fac_mushiko', col: plasterC }, [0, 0, n, h2 / TILE.mushiko[1]]);
      // pent roof (hisashi) between the floors
      pentRoof(b, -len / 2 - 0.02, len / 2 + 0.02, h1 - 0.1, h1 + 0.32, 1.0, kawara, mulRGB(TRIM_WOOD, bengara ? 1.4 : 1), mulRGB(woodT, 0.4));
      // lantern string under the eave and one big chōchin at the door
      const hasString = r.chance(0.8);
      if (hasString) lanternString(b, -len / 2 + 0.2, len / 2 - 0.2, h1 - 0.32, 0.92, r.chance(0.5) ? [LANT.matsuri, LANT.white] : [LANT.white, LANT.white, LANT.matsuri]);
      const ex = shopMode === 'lattice' ? -len / 2 + (entrance + 0.5) * ken : 0;
      const big = shopMode === 'izakaya' ? r.pick([LANT.sake, LANT.yakitori, LANT.izakaya]) : shopMode === 'ramen' ? LANT.ramen : noren === NOREN.sake ? LANT.sake : r.pick([LANT.oden, LANT.yakitori, LANT.matsuri]);
      // a big red lantern by the door (always, when there is no string of small ones)
      if (shopMode !== 'shutter' && (!hasString || r.chance(0.85))) {
        const lx = ex + (ex > 0 ? -1 : 1) * (ken / 2 + 0.05);
        b.trim(lx - 0.03, h1 - 0.5, 0, lx + 0.03, h1 - 0.15, 0.35, TRIM_DARK);
        lantern(b, lx, h1 - 1.35, 0.35, 0.26, 0.82, big, 8);
        b.light(lx, h1 - 1, 0.6, [1, 0.45, 0.2], 4.5);
      }
      // wooden signboard on the pent roof
      if (r.chance(0.45)) {
        const sw = Math.min(len - 0.6, 4.2), keys = ['wagashi', 'books', 'sake', 'kimono', 'tea', 'tofu', 'hardware'];
        const key = noren === NOREN.yu ? 'sento' : r.pick(keys);
        const [bl, bi] = BAND[key];
        signBox(b, -sw / 2, sw / 2, h1 + 0.36, h1 + 0.36 + sw / 8, 0.25, 0.08, bl, bandRect(bi), TRIM_WOOD);
        b.trim(-sw / 2 + 0.2, h1 + 0.2, 0.25, -sw / 2 + 0.28, h1 + 0.4, 0.33, TRIM_WOOD);
        b.trim(sw / 2 - 0.28, h1 + 0.2, 0.25, sw / 2 - 0.2, h1 + 0.4, 0.33, TRIM_WOOD);
      }
    } else if (s === 'back') {
      plainFace(b, len, 0.25, yE, plaster);
      hwin(b, 'frosted', r.range(-len / 3, len / 3), h1 + 0.8);
    } else {
      b.t(-len / 2, len / 2, 0.25, h1, 0, woodBd);
      plainFace(b, len, h1, yE, plaster);
    }
  });
  const rise = Math.min(3.0, (D / 2) * 0.45);
  gableX(b, -W / 2, W / 2, -D, 0, yE, rise, 0.75, 0.12, kawara, plaster, { fascia: TRIM_WOOD, soffit: mulRGB(woodT, 0.45), ridge: hexRGB(0x5a6070), back: 0.45 });
  // udatsu firewalls at the front corners of the upper floor
  if (r.chance(0.55)) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.18);
    b.box(x - 0.18, h1 + 0.25, -1.8, x + 0.18, yE + 0.55, 0.12, { side: plaster, top: null });
    b.trim(x - 0.3, yE + 0.55, -1.95, x + 0.3, yE + 0.75, 0.3, hexRGB(0x5a6070));
  }
  return yE + rise + 0.2;
}

function kanbanShop(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = 3.0, H = 0.3 + F * fh;
  const front = r.col([0xf4ead8, 0x9ad8c0, 0xd8dce8, 0xf0d8b0, 0xc8e0f0, 0xe8d0d8]);
  const face: FS = { layer: r.chance(0.5) ? 'fac_mortar' : 'fac_plaster', col: front, tile: TILE.mortar };
  const sideF: FS = r.chance(0.55) ? { layer: 'fac_corrugated', col: r.col(PAL.rustRoof), tile: TILE.corrugated } : { layer: 'fac_wood', col: r.col(PAL.wood), tile: TILE.wood };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x8a847c));
  const par = r.range(1.4, 2.4);
  const kind = r.pick<ShopKind>(['bakery', 'cafe', 'ramen', 'izakaya', 'shutter', 'drugstore', 'shutter']);
  const signKey = r.pick(['wagashi', 'books', 'sake', 'kimono', 'tea', 'tofu', 'hardware', 'cleaning', 'realty', 'sushi', 'chinese']);
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front') {
      b.t(-len / 2, -len / 2 + 0.35, 0.3, H + par, 0, face); b.t(len / 2 - 0.35, len / 2, 0.3, H + par, 0, face);
      b.t(-len / 2 + 0.35, len / 2 - 0.35, 3.3, H + par, 0, face);
      shopfront(b, -len / 2 + 0.35, len / 2 - 0.35, 0.3, 3.3, kind, { recess: 0.3, jamb: face, awning: kind !== 'shutter' && r.chance(0.6) ? r.int(0, 3) : undefined });
      for (let f = 1; f < F; f++) {
        const y = 0.3 + f * fh + 0.6;
        const nW = Math.max(1, Math.floor(len / 2.4));
        const kw = r.pick(['tall', 'flower', 'slider'] as const);
        for (let i = 0; i < nW; i++) hwin(b, kw === 'slider' ? 'slider' : kw, -len / 2 + ((i + 0.5) / nW) * len, kw === 'flower' ? y + 0.4 : y, 0.03, kw === 'tall' ? 1.15 : 1);
        b.trim(-len / 2 + 0.2, 0.3 + f * fh - 0.08, 0, len / 2 - 0.2, 0.3 + f * fh + 0.08, 0.12, mulRGB(front, 0.8), { back: false });
      }
      // the signboard across the false front
      const sw = Math.min(len - 0.6, 7.6), sh = sw / 8;
      const [bl, bi] = BAND[signKey];
      signBox(b, -sw / 2, sw / 2, H + par - sh - 0.25, H + par - 0.25, 0, 0.12, bl, bandRect(bi), mulRGB(front, 0.7));
      // stepped top of the false front
      b.box(-len / 4, H + par, -0.25, len / 4, H + par + 0.5, 0, { front: face, left: face, right: face, back: face, top: { layer: null, col: mulRGB(front, 0.75) } });
      b.trim(-len / 2, H + par - 0.05, -0.3, len / 2, H + par + 0.08, 0.1, mulRGB(front, 0.75));
      if (r.chance(0.5)) lanternString(b, -len / 2 + 0.3, len / 2 - 0.3, 3.4, 0.5, [LANT.white, LANT.matsuri]);
      if (kind === 'shutter') graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.25, 2.6);
      if (r.chance(0.35)) vending(b, len / 2 - 0.7, r.int(0, 3), 0.05);
      b.light(0, H + par - sh, 1.2, [1, 0.8, 0.5], 4);
    } else if (s === 'back') plainFace(b, len, 0.3, H, sideF);
    else { plainFace(b, len, 0.3, H, sideF); if (r.chance(0.35)) graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.4); }
  });
  // false front's back face (seen over the roof) and roof
  b.at(0, 0, -0.25, Math.PI, () => b.t(-W / 2, W / 2, H, H + par, 0, { layer: 'fac_wall_plain', col: mulRGB(front, 0.8), tile: TILE.plain }));
  b.flat(-W / 2, -0.25, W / 2, 0, H + par, { layer: null, col: mulRGB(front, 0.75) });
  const roof: FS = r.chance(0.5) ? { layer: 'roof_kawara', col: r.col(PAL.kawara), tile: TILE.kawara } : { layer: 'roof_metal', col: r.col(PAL.rustRoof), tile: TILE.metal };
  // no overhang at the ends: the roof hides behind the false front (its barge boards would cut through it)
  gableZ(b, -W / 2, W / 2, -D, -0.3, H, Math.min(2.6, W * 0.32, par - 0.15), 0.4, 0, roof, sideF, { fascia: TRIM_WOOD, ridge: hexRGB(0x5a5a68) });
  return H + par + 0.5;
}

function kura(b: B, W: number, D: number) {
  const r = b.r;
  const yE = 6.2;
  const plasterC = r.col([0xffffff, 0xfff8ec, 0xf4f0e8]);
  const plaster: FS = { layer: 'fac_plaster', col: plasterC, tile: TILE.plaster };
  const nam: FS = { layer: 'fac_namako', col: WHITE, tile: TILE.namako };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7672), 0.2);
  const nh = 1.5;
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    b.t(-len / 2, len / 2, 0.2, nh, 0, nam);
    b.t(-len / 2, len / 2, nh, yE, 0, plaster);
    // ledge over the namako
    b.trim(-len / 2, nh - 0.02, 0, len / 2, nh + 0.1, 0.1, plasterC, { back: false });
    // hachimaki band under the eaves
    b.box(-len / 2 - 0.15, yE - 0.55, 0, len / 2 + 0.15, yE, 0.15, { front: plaster, left: plaster, right: plaster, top: null, bottom: { layer: null, col: mulRGB(plasterC, 0.85) } });
    const win = (x: number, y: number, sz: number) => {
      b.box(x - sz / 2 - 0.2, y - 0.2, 0, x + sz / 2 + 0.2, y + sz + 0.2, 0.28, { front: plaster, left: plaster, right: plaster, top: { layer: null, col: plasterC }, bottom: { layer: null, col: mulRGB(plasterC, 0.8) } });
      b.q(x - sz / 2, x + sz / 2, y, y + sz, 0.29, { layer: null, col: hexRGB(0x1a1820) }, [0, 0, 1, 1]);
      for (let i = 1; i < 4; i++) b.trim(x - sz / 2 + (i * sz) / 4 - 0.03, y, 0.29, x - sz / 2 + (i * sz) / 4 + 0.03, y + sz, 0.33, hexRGB(0x3a3a44));
      // open shutter leaves
      for (const sx of [-1, 1]) b.box(x + sx * (sz / 2 + 0.2) - (sx > 0 ? 0 : 0.14), y - 0.15, 0.28, x + sx * (sz / 2 + 0.2) + (sx > 0 ? 0.14 : 0), y + sz + 0.15, 0.28 + sz * 0.5, { side: plaster, top: { layer: null, col: plasterC } });
    };
    if (s === 'front') {
      // door with a frame and a small pent roof
      const dw = 1.6;
      b.box(-dw / 2 - 0.35, 0.2, 0, dw / 2 + 0.35, 2.9, 0.35, { front: plaster, left: plaster, right: plaster, top: { layer: null, col: plasterC } });
      b.q(-dw / 2, dw / 2, 0.2, 2.5, 0.36, { layer: 'fac_wood', col: hexRGB(0x5a4a40) }, [0, 0, dw / 2, 2.3 / 3]);
      b.trim(-dw / 2 - 0.05, 2.5, 0.35, dw / 2 + 0.05, 2.6, 0.4, hexRGB(0x2a2228));
      b.at(0, 0, 0.35, 0, () => pentRoof(b, -dw / 2 - 0.6, dw / 2 + 0.6, 2.95, 3.35, 0.7, { layer: 'roof_kawara', col: hexRGB(0x8a90a0), tile: TILE.kawara }, TRIM_DARK, TRIM_WOOD));
      b.light(0, 2.4, 1.0, [1, 0.7, 0.4], 3);
      lantern(b, dw / 2 + 0.55, 1.6, 0.6, 0.2, 0.6, LANT.temple, 8);
      win(W > 6.5 ? -len / 4 : 0, 3.9, 0.85);
      if (W > 6.5) win(len / 4, 3.9, 0.85);
    } else if (s !== 'back' && r.chance(0.6)) win(0, 3.9, 0.75);
  });
  const ridgeX = r.chance(0.7);
  const roof: FS = { layer: 'roof_kawara', col: r.col([0x8a90a0, 0x6a7080, 0xa0a8b8]), tile: TILE.kawara };
  const rise = ridgeX ? D * 0.35 : W * 0.35;
  if (ridgeX) gableX(b, -W / 2, W / 2, -D, 0, yE, rise, 0.45, 0.35, roof, plaster, { fascia: plasterC, soffit: mulRGB(plasterC, 0.85), ridge: hexRGB(0x3a3e48) });
  else gableZ(b, -W / 2, W / 2, -D, 0, yE, rise, 0.45, 0.35, roof, plaster, { fascia: plasterC, soffit: mulRGB(plasterC, 0.85), ridge: hexRGB(0x3a3e48) });
  // onigawara blocks at the ridge ends
  const ry = yE + rise;
  if (ridgeX) for (const x of [-W / 2 - 0.45, W / 2 + 0.2]) b.trim(x, ry - 0.1, -D / 2 - 0.25, x + 0.25, ry + 0.45, -D / 2 + 0.25, hexRGB(0x3a3e48));
  else for (const z of [-D - 0.45, 0.2]) b.trim(-0.25, ry - 0.1, z, 0.25, ry + 0.45, z + 0.25, hexRGB(0x3a3e48));
  return ry + 0.45;
}

function templeGate(b: B, W: number, D: number) {
  const r = b.r;
  const wood = r.chance(0.5) ? hexRGB(0x8a2a1e) : hexRGB(0x5a3a26);
  const roof: FS = { layer: 'roof_kawara', col: hexRGB(0x7a8090), tile: TILE.kawara };
  const ochre: FS = { layer: 'fac_plaster', col: r.col([0xf8d890, 0xffe8b0, 0xf0c878]), tile: TILE.plaster };
  // courtyard ground
  b.box(-W / 2, -4, -D, W / 2, 0.08, -0.7, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a948c), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xfff0d8), tile: [4, 4] } });
  // stone path
  b.flat(-1.0, -D + 4, 1.0, -0.7, 0.1, { layer: 'fac_namako', col: hexRGB(0xd8d8d0), tile: [1.6, 1.6] });
  // gate
  const gw = 4.4, gd = 2.6, gz = -1.6;
  const ph = 4.3;
  for (const [x, z] of [[-gw / 2, gz + gd / 2], [gw / 2, gz + gd / 2], [-gw / 2, gz - gd / 2], [gw / 2, gz - gd / 2]] as const) {
    b.trim(x - 0.4, -4, z - 0.4, x + 0.4, 0.45, z + 0.4, TRIM_STONE);
    b.w.cylinder(x, z, 0.45, ph, 0.24, 0.22, 8, { layer: b.L('fac_wood'), color: wood, tile: [1.5, 3] }, { gBase: 0, gTop: b.g(ph) });
  }
  for (const z of [gz + gd / 2, gz - gd / 2]) { b.trim(-gw / 2 - 0.5, ph - 0.7, z - 0.16, gw / 2 + 0.5, ph - 0.3, z + 0.16, wood, { bottom: true }); b.trim(-gw / 2 - 0.3, 2.9, z - 0.12, gw / 2 + 0.3, 3.15, z + 0.12, wood, { bottom: true }); }
  for (const x of [-gw / 2, gw / 2]) b.trim(x - 0.14, ph - 0.7, gz - gd / 2, x + 0.14, ph - 0.3, gz + gd / 2, wood, { bottom: true });
  b.trim(-gw / 2 - 0.4, ph - 0.3, gz - gd / 2 - 0.3, gw / 2 + 0.4, ph, gz + gd / 2 + 0.3, wood, { bottom: true });
  b.at(0, 0, gz, 0, () => gableX(b, -gw / 2 - 0.2, gw / 2 + 0.2, -gd / 2, gd / 2, ph + 0.25, 1.9, 1.3, 1.0, roof, { layer: 'fac_wood', col: wood, tile: TILE.wood }, { fascia: hexRGB(0x2a2228), soffit: mulRGB(wood, 0.8), ridge: hexRGB(0x3a3e48) }));
  for (const x of [-gw / 2 - 1.25, gw / 2 + 1.0]) b.trim(x, ph + 2.05, gz - 0.3, x + 0.25, ph + 2.6, gz + 0.3, hexRGB(0x3a3e48));
  // name plaque and a big lantern hanging in the gate
  b.d(-0.8, ph - 0.25, 0.8, ph + 0.15, gz + gd / 2 + 0.33, 'sign_band_c', bandRect(5), [0.9, 0.85, 0.8]);
  b.trim(-0.02, 3.15, gz - 0.02, 0.02, ph - 0.7, gz + 0.02, TRIM_DARK);
  lantern(b, 0, 1.9, gz, 0.42, 1.25, LANT.temple, 10);
  b.light(0, 2.5, gz + 0.6, [1, 0.7, 0.4], 5);
  // tsuiji walls either side
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W / 2 : gw / 2 + 0.6, x1 = sx < 0 ? -gw / 2 - 0.6 : W / 2;
    if (x1 - x0 < 0.5) continue;
    const wz0 = -0.65, wz1 = -0.05;
    b.box(x0, -4, wz0, x1, 0.5, wz1, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a948c), tile: TILE.plain }, top: null });
    b.box(x0, 0.5, wz0, x1, 2.5, wz1, { front: ochre, back: ochre, left: ochre, right: ochre, top: null });
    for (let k = 0; k < 5; k++) b.trim(x0, 1.3 + k * 0.22, wz1, x1, 1.36 + k * 0.22, wz1 + 0.025, WHITE, { back: false, top: false });
    b.at((x0 + x1) / 2, 0, (wz0 + wz1) / 2, 0, () => gableX(b, -(x1 - x0) / 2, (x1 - x0) / 2, -0.3, 0.3, 2.5, 0.42, 0.35, 0.05, roof, null, { fascia: hexRGB(0x3a3440), soffit: hexRGB(0x5a5050), ridge: hexRGB(0x3a3e48) }));
  }
  // stone lanterns
  for (const sx of [-1, 1]) {
    const x = sx * 2.4, z = -D * 0.45;
    b.trim(x - 0.35, 0, z - 0.35, x + 0.35, 0.3, z + 0.35, TRIM_STONE);
    b.trim(x - 0.12, 0.3, z - 0.12, x + 0.12, 1.0, z + 0.12, TRIM_STONE);
    b.trim(x - 0.3, 1.0, z - 0.3, x + 0.3, 1.1, z + 0.3, TRIM_STONE);
    b.box(x - 0.22, 1.1, z - 0.22, x + 0.22, 1.5, z + 0.22, { side: { layer: 'roof_bits' }, top: null });
    for (const [face, ry] of [[0, 0], [1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]] as const) { void face; b.at(x, 0, z, ry, () => b.d(-0.14, 1.16, 0.14, 1.42, 0.225, 'roof_bits', swatch('warm'))); }
    b.trim(x - 0.4, 1.5, z - 0.4, x + 0.4, 1.62, z + 0.4, TRIM_STONE);
    b.trim(x - 0.2, 1.62, z - 0.2, x + 0.2, 1.85, z + 0.2, TRIM_STONE);
    b.light(x, 1.3, z, [1, 0.75, 0.4], 3);
  }
  // main hall at the back
  const hw = Math.min(W - 2, 11), hd = Math.min(7, D * 0.42);
  const hz1 = -D + hd + 0.3, hz0 = -D + 0.3;
  b.box(-hw / 2, 0.08, hz0, hw / 2, 0.9, hz1, { side: { layer: 'fac_wall_plain', col: hexRGB(0xa09a90), tile: TILE.plain }, top: { layer: 'fac_wood', col: hexRGB(0x7a5a40), tile: [2, 2] } });
  walls(b, -hw / 2 + 0.6, hw / 2 - 0.6, hz0 + 0.3, hz1 - 1.2, (s, len) => {
    if (s === 'front') { b.q(-len / 2, len / 2, 0.9, 4.2, 0, { layer: 'fac_koshi', col: wood }, [0, 0.12, Math.round(len / 1.82), 1.25]); b.light(0, 2, 1.2, [1, 0.65, 0.35], 6); }
    else plainFace(b, len, 0.9, 4.2, { layer: 'fac_wood', col: mulRGB(wood, 0.9), tile: TILE.wood });
  });
  for (const x of [-hw / 2 + 0.6, hw / 2 - 0.6]) b.w.cylinder(x, hz1 - 0.6, 0.9, 4.3, 0.18, 0.18, 6, { layer: b.L('fac_wood'), color: wood, tile: [1, 3] }, { gBase: 0, gTop: b.g(4.3) });
  hipRoof(b, -hw / 2 + 0.6, hw / 2 - 0.6, hz0 + 0.3, hz1 - 1.2, 4.3, 3.8, 1.5, roof, { fascia: hexRGB(0x2a2228), soffit: mulRGB(wood, 0.8), ridge: hexRGB(0x3a3e48) });
  return 4.3 + 3.8 + 0.2;
}

// ───────────────────────────── Midtown ─────────────────────────────

/** Balconies (slab, parapet, partitions) along a facade frame for floors at ys. */
function balconies(b: B, x0: number, x1: number, ys: number[], depth: number, variant: 0 | 1, wallC: RGB, unit: number, decorate = true) {
  const r = b.r;
  const slabC = mulRGB(wallC, 0.95);
  const v0 = variant ? 0 : 0.5, v1 = variant ? 0.5 : 1;
  const n = Math.max(1, Math.round((x1 - x0) / unit));
  const uw = (x1 - x0) / n;
  const part: FS = { layer: 'fac_wall_plain', col: mulRGB(wallC, 0.92), tile: TILE.plain };
  for (const y of ys) {
    // slab
    b.flat(x0, 0, x1, depth, y, { layer: null, col: mulRGB(slabC, 0.92) });
    b.flat(x0, 0, x1, depth, y - 0.2, { layer: null, col: TRIM_SOFFIT }, true);
    // parapet front + ends
    b.q(x0, x1, y - 0.2, y + 0.95, depth, { layer: 'fac_balcony', col: wallC }, [x0 / 3.6, v0, x1 / 3.6, v1]);
    b.at(0, 0, depth, Math.PI, () => b.q(-x1, -x0, y, y + 0.95, 0.06, { layer: 'fac_wall_plain', col: slabC, tile: TILE.plain }, [0, 0, (x1 - x0) / 4, 0.25]));
    b.flat(x0, depth - 0.06, x1, depth, y + 0.95, { layer: null, col: hexRGB(0xd8dee4) });
    b.w.wall(x0, 0, x0, depth, y - 0.2, y + 0.95, b.mat(part), { uv: [0, 0, depth / 4, 0.3], gBase: b.g(y), gTop: b.g(y + 1) });
    b.w.wall(x1, depth, x1, 0, y - 0.2, y + 0.95, b.mat(part), { uv: [0, 0, depth / 4, 0.3], gBase: b.g(y), gTop: b.g(y + 1) });
    // partitions between units
    for (let i = 1; i < n; i++) {
      const x = x0 + i * uw;
      b.box(x - 0.04, y, 0, x + 0.04, y + 2.3, depth - 0.08, { side: part, top: { layer: null, col: slabC } });
    }
    if (!decorate) continue;
    for (let i = 0; i < n; i++) {
      const ua = x0 + i * uw, ub = ua + uw;
      if (r.chance(0.55)) b.at(ub - 0.6, y, 0, 0, () => acUnit(b, 0, 0, 0.05));
      const k = r.f();
      if (k < 0.22) b.d(ua + 0.4, y + 1.05, ua + 0.4 + 2.0, y + 2.05, depth - 0.25, 'deco_cut', r.chance(0.5) ? CUT.laundry : CUT.laundry2);
      else if (k < 0.3) { const fx = ua + r.range(0.3, Math.max(0.35, uw - 1.5)); b.d(fx, y + 0.35, fx + 1.2, y + 1.55, depth + 0.04, 'deco_cut', CUT.futon); }
      else if (k < 0.42) b.d(ua + 0.3, y + 0.3, ua + 1.3, y + 1.3, depth + 0.03, 'deco_cut', CUT.plants);
    }
  }
}

function mansion(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = TILE.mansion[1], g0 = 3.4;
  const top = g0 + (F - 1) * fh;
  const wallC = r.col([...PAL.wallLight, ...PAL.wallWarm, ...PAL.wallCool]);
  const tileC = mulRGB(r.col(PAL.tile), 0.97);
  const side: FS = { layer: 'fac_wall_tile', col: mulRGB(wallC, 0.97), tile: TILE.tile };
  const bayL = r.chance(0.5) ? 'fac_mansion_a' : 'fac_mansion_b';
  const variant = r.chance(0.6) ? 0 : 1;
  const accent = r.col(PAL.wallVivid);
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7684));
  const bz = -1.25; // facade set back so balconies stay inside the plot
  walls(b, -W / 2, W / 2, -D, bz, (s, len) => {
    if (s === 'front') {
      // ground floor: entrance, pilotis bike park, maybe a shop
      const ew = 3.0;
      const ex = r.range(-len / 2 + 2, len / 2 - 2 - ew);
      b.t(-len / 2, len / 2, 0.3, g0, 0, { layer: 'fac_wall_tile', col: tileC, tile: TILE.tile });
      b.hole(ex, ex + ew, 0.3, 2.9); b.d(ex, 0.3, ex + ew, 2.9, -0.8, 'shop_e', LOBBY_DOOR);
      b.w.wall(ex, 0, ex, -0.8, 0.3, 2.9, b.mat(side), { uv: [0, 0, 0.3, 0.9], gBase: 0.01, gTop: b.g(2.9) });
      b.w.wall(ex + ew, -0.8, ex + ew, 0, 0.3, 2.9, b.mat(side), { uv: [0, 0, 0.3, 0.9], gBase: 0.01, gTop: b.g(2.9) });
      b.flat(ex, -0.8, ex + ew, 0, 2.9, { layer: 'roof_bits', col: WHITE }, true);
      b.d(ex + 0.4, 2.95, ex + ew - 0.4, 3.35, 0.03, 'sign_tenant', tenRect(r.pick([TEN.aptSakura, TEN.aptAoba, TEN.aptWakaba, TEN.aptSun])));
      b.light(ex + ew / 2, 2.6, 0.8, [1, 0.92, 0.8], 4);
      const restL = ex - (-len / 2), restR = len / 2 - (ex + ew);
      const [ra, rb] = restL > restR ? [-len / 2 + 0.4, ex - 0.4] : [ex + ew + 0.4, len / 2 - 0.4];
      if (rb - ra > 6 && r.chance(0.35)) {
        const k = r.pick<ShopKind>(['konbini', 'cafe', 'drugstore', 'bakery', 'salon']);
        shopfront(b, ra, rb, 0.3, 2.9, k, { band: k === 'konbini' ? r.pick(['momo', 'lumi']) : SHOP_BAND[k], bandY: 2.95, jamb: side });
      } else if (rb - ra > 2) {
        // bike parking: dark recess with bikes
        b.hole(ra, rb, 0.3, 2.6); b.d(ra, 0.3, rb, 2.6, -2.5, 'fac_wall_plain', [0, 0, 512, 512], hexRGB(0x4a4658));
        b.flat(ra, -2.5, rb, 0, 2.6, { layer: null, col: TRIM_SOFFIT }, true);
        b.w.wall(ra, 0, ra, -2.5, 0.3, 2.6, b.mat(side), { uv: [0, 0, 0.6, 0.6], gBase: 0, gTop: b.g(2.6) });
        b.w.wall(rb, -2.5, rb, 0, 0.3, 2.6, b.mat(side), { uv: [0, 0, 0.6, 0.6], gBase: 0, gTop: b.g(2.6) });
        b.flat(ra, -2.5, rb, 0, 0.3, { layer: 'roof_flat', col: hexRGB(0xb0b0b0), tile: TILE.flat });
        const nb = Math.floor((rb - ra - 0.4) / 0.75);
        for (let i = 0; i < nb; i++) if (r.chance(0.7)) b.d(ra + 0.3 + i * 0.75 - 0.4, 0.3, ra + 0.3 + i * 0.75 + 0.6, 1.3, -1.2 - (i % 2) * 0.3, 'deco_cut', CUT.bike);
      }
      // upper floors
      b.bays(-len / 2, len / 2, g0, top + 0.4, 0, bayL, TILE.mansion[0], fh, g0, WHITE, 0);
      b.t(-len / 2, len / 2, top + 0.4, top + 1.3, 0, side);
      const ys: number[] = []; for (let f = 0; f < F - 1; f++) ys.push(g0 + f * fh);
      balconies(b, -len / 2, len / 2, ys, -bz, variant as 0 | 1, wallC, TILE.mansion[0] * 2);
      // vertical accent fins at the ends
      for (const sx of [-1, 1]) b.trim(sx * len / 2 - (sx > 0 ? 0.5 : 0), g0 - 0.2, 0, sx * len / 2 + (sx > 0 ? 0 : 0.5), top + 1.3, -bz + 0.1, accent);
      if (r.chance(0.35)) { const name = r.pick([TEN.aptSakura, TEN.aptAoba, TEN.aptWakaba, TEN.aptSun]); b.d(-2.4, top + 0.45, 2.4, top + 1.25, 0.05, 'sign_tenant', tenRect(name)); }
    } else {
      plainFace(b, len, 0.3, top + 1.3, side);
      if (s !== 'back') {
        for (let f = 0; f < F - 1; f++) { const y = g0 + f * fh + 1.0; hwin(b, 'frosted', -len / 4, y); hwin(b, 'tall', len / 4, y - 0.3); }
        graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.25, 2.5);
      } else {
        for (let f = 0; f < F - 1; f++) { const n = Math.max(1, Math.floor(len / 3.6)); for (let i = 0; i < n; i++) hwin(b, 'apt', -len / 2 + (i + 0.5) * (len / n), g0 + f * fh + 0.1); }
      }
    }
  });
  flatRoof(b, -W / 2, W / 2, -D, bz, top + 0.4, 0.9, side, hexRGB(0xe8e4dc));
  { const sx = r.range(-W / 2 + 1, W / 2 - 9); stairHouse(b, sx, sx + 3.6, -D + 1, -D + 4, top + 0.4, 3.0, side); }
  b.box(W / 2 - 4.5, top + 0.4, -D + 1, W / 2 - 1, top + 3.0, -D + 3.5, { side: { layer: 'fac_wall_plain', col: mulRGB(wallC, 0.9), tile: TILE.plain }, top: { layer: 'roof_flat', tile: TILE.flat } });
  roofClutter(b, -W / 2 + 1, W / 2 - 1, -D + 4.5, bz - 1, top + 0.4, { tank: r.chance(0.4), ac: r.int(0, 2), dish: true });
  return top + 3.4;
}

function mixedBlock(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const g0 = 4.0;
  const nCom = Math.min(F - 2, r.int(1, 2));
  const resLayer = r.chance(0.55) ? 'mansion' : 'punch';
  const comFh = TILE.zakkyo[1], resFh = resLayer === 'mansion' ? TILE.mansion[1] : TILE.officePunch[1];
  const yRes = g0 + nCom * comFh;
  const top = yRes + (F - 1 - nCom) * resFh;
  const wallC = r.col([...PAL.wallLight, ...PAL.wallWarm, ...PAL.tile]);
  const wall: FS = { layer: r.chance(0.5) ? 'fac_wall_tile' : 'fac_wall_plain', col: wallC, tile: TILE.tile };
  const band: FS = { layer: 'fac_wall_plain', col: mulRGB(r.col(PAL.wallVivid), 0.95), tile: TILE.plain };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7684));
  const bz = resLayer === 'mansion' ? -1.1 : 0;
  // commercial podium sits at z=0, residential above sets back for balconies
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front') {
      b.t(-len / 2, len / 2, 0.3, g0, 0, band);
      const nS = len > 14 ? 2 : 1;
      const used: ShopKind[] = [];
      for (let i = 0; i < nS; i++) {
        const a = -len / 2 + 0.4 + (i * (len - 0.8)) / nS, c = -len / 2 + 0.4 + ((i + 1) * (len - 0.8)) / nS - (i < nS - 1 ? 0.5 : 0);
        let k = r.pick<ShopKind>(['ramen', 'izakaya', 'cafe', 'drugstore', 'salon', 'bakery', 'konbini', 'shutter']);
        if (used.includes(k)) k = 'shutter';
        used.push(k);
        shopfront(b, a, c, 0.3, 3.3, k, { band: k === 'konbini' ? r.pick(['momo', 'lumi']) : SHOP_BAND[k], bandY: 3.38, jamb: band, awning: (k === 'bakery' || k === 'cafe' || k === 'ramen') && r.chance(0.6) ? r.int(0, 3) : undefined });
        if (k === 'shutter') graffitiRun(b, a + 0.3, c - 0.3, 0.6, 2.6);
      }
      b.bays(-len / 2, len / 2, g0, yRes, 0, 'fac_zakkyo', TILE.zakkyo[0], comFh, g0, WHITE, 0);
      for (let f = 0; f < nCom; f++) if (r.chance(0.7)) { const x = r.range(-len / 2 + 0.5, len / 2 - 2); b.d(x, g0 + f * comFh + 1.0, x + 1.5, g0 + f * comFh + 1.75, 0.06, 'sign_tenant', tenRect(r.pick(TENANT_FLOORS))); }
      if (r.chance(0.6)) blade(b, (r.chance(0.5) ? -1 : 1) * (len / 2 - 0.4), g0 + 0.2, 4.6, r.pick(Object.keys(BLADE)));
    } else { plainFace(b, len, 0.3, yRes, wall); if (s !== 'back') graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.45); }
  });
  // residential volume
  walls(b, -W / 2, W / 2, -D, bz, (s, len) => {
    if (s === 'front') {
      if (resLayer === 'mansion') {
        b.flat(-len / 2, 0, len / 2, -bz, yRes, { layer: 'roof_flat', tile: TILE.flat });
        b.bays(-len / 2, len / 2, yRes, top, 0, r.pick(['fac_mansion_a', 'fac_mansion_b']), TILE.mansion[0], resFh, yRes, WHITE, 3);
        const ys: number[] = []; for (let f = 1; f < F - nCom - 1; f++) ys.push(yRes + f * resFh);
        balconies(b, -len / 2, len / 2, ys, -bz, r.chance(0.5) ? 0 : 1, wallC, TILE.mansion[0] * 2);
        railing(b, -len / 2, -bz - 0.1, len / 2, -bz - 0.1, yRes);
      } else b.bays(-len / 2, len / 2, yRes, top, 0, 'fac_office_punch', TILE.officePunch[0], resFh, yRes, r.col([0xffffff, 0xffe8e0, 0xe8f0ff, 0xfff4d8]), 3);
      b.t(-len / 2, len / 2, top, top + 1, 0, wall);
      b.trim(-len / 2 - 0.1, yRes - 0.12, -0.02, len / 2 + 0.1, yRes + 0.12, 0.15 - bz, mulRGB(wallC, 1.05));
    } else {
      plainFace(b, len, yRes, top + 1, wall);
      if (s !== 'back') for (let f = 0; f < F - nCom - 1; f++) { if (r.chance(0.7)) hwin(b, 'frosted', r.range(-len / 3, len / 3), yRes + f * resFh + 1.1); if (r.chance(0.4)) acUnit(b, r.range(-len / 3, len / 3), yRes + f * resFh + 0.2, 0.02); }
    }
  });
  if (bz < 0) b.trim(-W / 2, yRes - 0.15, bz, W / 2, yRes + 0.15, 0, mulRGB(wallC, 1.02));
  flatRoof(b, -W / 2, W / 2, -D, bz, top, 1, wall, hexRGB(0xe8e4dc));
  roofClutter(b, -W / 2 + 0.6, W / 2 - 0.6, -D + 0.6, bz - 0.6, top, { tank: r.chance(0.6), ac: r.int(1, 3), dish: true });
  let h = top + 1;
  if (r.chance(0.3) && W > 11) { const bw = Math.min(W - 2, 10); billboard(b, 0, top, bz - 1.4, bw, r.int(0, 5), 1.4); h = top + 1.4 + bw / 2; }
  return h + 2.5;
}

function konbini(b: B, W: number, D: number) {
  const r = b.r;
  const brand = r.chance(0.5) ? 'momo' : 'lumi';
  const park = Math.min(9, Math.max(7, D * 0.36));
  const sz1 = -park, sz0 = -D;
  const H = 4.7;
  const panel: FS = { layer: 'fac_sandwich', col: r.col([0xffffff, 0xf4f4f0, 0xf0f4f8]), tile: TILE.sandwich };
  // parking lot slab with stalls
  const lotSide: FS = { layer: 'fac_wall_plain', col: hexRGB(0xa8a49c), tile: TILE.plain };
  b.box(-W / 2, -4, -park, W / 2, 0.06, 0, { side: lotSide, top: null, back: undefined });
  const stall = 2.5, rows = Math.floor((W - 1) / stall);
  const lx0 = -(rows * stall) / 2;
  b.flat(lx0, -park, lx0 + rows * stall, 0, 0.06, { layer: 'ground_lot', tile: [stall, park / 0.7] });
  b.flat(-W / 2, -park, lx0, 0, 0.06, { layer: 'ground_lot', tile: [stall, park / 0.7], uo: 0.4 });
  b.flat(lx0 + rows * stall, -park, W / 2, 0, 0.06, { layer: 'ground_lot', tile: [stall, park / 0.7], uo: 0.4 });
  plinth(b, -W / 2 + 0.3, W / 2 - 0.3, sz0, sz1, hexRGB(0x8a8890));
  const bandRow = BAND[brand][1], stripeRow = BAND[brand === 'momo' ? 'momoStripe' : 'lumiStripe'][1];
  walls(b, -W / 2 + 0.3, W / 2 - 0.3, sz0, sz1, (s, len) => {
    if (s === 'front') {
      // store front: the painted konbini module plus glass extensions (left half of the module)
      const mw = 7.0;
      const extra = len - 0.8 - mw;
      const nE = Math.max(0, Math.round(extra / 3.5));
      const ew = nE ? extra / nE : 0;
      let x = -len / 2 + 0.4;
      b.t(-len / 2, -len / 2 + 0.4, 0.3, H, 0, panel); b.t(len / 2 - 0.4, len / 2, 0.3, H, 0, panel);
      const doorFirst = r.chance(0.5);
      const parts = doorFirst ? ['door', ...Array(nE).fill('ext')] : [...Array(nE).fill('ext'), 'door'];
      for (const p of parts) {
        const w = p === 'door' ? mw : ew;
        if (p === 'door') shopfront(b, x, x + w, 0.3, 3.6, 'konbini', { recess: 0.12, light: false });
        else { b.hole(x, x + w, 0.3, 3.6); b.d(x, 0.3, x + w, 3.6, -0.12, 'shop_a', [0, 2, 256, 250]); }
        x += w;
      }
      b.flat(-len / 2 + 0.4, -0.12, len / 2 - 0.4, 0, 3.6, { layer: null, col: TRIM_SOFFIT }, true);
      // fascia band with the brand
      const bw = Math.min(len * 0.5, 8);
      b.strip(-len / 2, len / 2, 3.6, H, 0.06, 'sign_band_a', bandRect(stripeRow), 5.6);
      b.d(-bw / 2, 3.65, bw / 2, 3.65 + bw / 8, 0.09, 'sign_band_a', bandRect(bandRow));
      b.light(0, 2.5, 3, [0.9, 0.95, 1], 12);
      b.light(-len / 3, 1.5, 4.5, [0.9, 0.95, 1], 8);
      b.light(len / 3, 1.5, 4.5, [0.9, 0.95, 1], 8);
      // vending machines and a bin box by the side
      vending(b, len / 2 - 1.2, r.int(0, 3), 0.02);
      if (r.chance(0.6)) vending(b, len / 2 - 2.3, r.int(0, 3), 0.02);
    } else {
      plainFace(b, len, 0.3, H, panel);
      b.strip(-len / 2, len / 2, 3.6, H, 0.03, 'sign_band_a', bandRect(stripeRow), 5.6);
      if (s !== 'back') { graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.2, 2.5); if (r.chance(0.6)) for (let i = 0; i < 2; i++) acUnit(b, r.range(-len / 3, len / 3), 0.3, 0.02); }
    }
  });
  flatRoof(b, -W / 2 + 0.3, W / 2 - 0.3, sz0, sz1, H, 0.3, panel, hexRGB(0xf0f0f0), 0.15);
  roofClutter(b, -W / 2 + 1, W / 2 - 1, sz0 + 1, sz1 - 1, H, { ac: r.int(2, 4) });
  // pylon sign at the front corner of the lot
  const px = (r.chance(0.5) ? -1 : 1) * (W / 2 - 0.8), pz = -0.6;
  b.trim(px - 0.15, 0, pz - 0.15, px + 0.15, 5.4, pz + 0.15, TRIM_STEEL);
  b.trim(px - 0.3, 0, pz - 0.3, px + 0.3, 0.4, pz + 0.3, TRIM_CONCRETE);
  const logo = brand === 'momo' ? TEN.logoMomo : TEN.logoLumi;
  b.at(px, 0, pz, 0, () => {
    b.box(-1.1, 5.4, -0.25, 1.1, 6.5, 0.25, { side: { layer: null, col: TRIM_STEEL }, top: { layer: null, col: TRIM_STEEL } });
    b.d(-1.05, 5.45, 1.05, 6.45, 0.26, 'sign_tenant', tenRect(logo));
    b.at(0, 0, 0, Math.PI, () => b.d(-1.05, 5.45, 1.05, 6.45, 0.26, 'sign_tenant', tenRect(logo)));
    b.d(-0.8, 4.4, 0.8, 5.2, 0.16, 'sign_tenant', tenRect(TEN.parking));
  });
  b.light(px, 6, pz + 0.5, [0.9, 0.95, 1], 5);
  return 6.6;
}

function smallOffice(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const g0 = 3.8, fh = TILE.officePunch[1];
  const top = g0 + (F - 1) * fh;
  const tint = r.col([0xffffff, 0xffe0d0, 0xe0e8ff, 0xfff0c8, 0xe8ffe8, 0xd8d8e8]);
  const tileWall: FS = { layer: 'fac_wall_tile', col: mulRGB(tint, 0.95), tile: TILE.tile };
  const plain: FS = { layer: 'fac_wall_plain', col: r.col(PAL.wallLight), tile: TILE.plain };
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7684));
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front') {
      b.t(-len / 2, len / 2, 0.3, g0, 0, plain);
      const gar = r.chance(0.45) && len > 9;
      const lw = Math.min(5, len * 0.45);
      const lx = gar ? -len / 2 + 0.5 : -lw / 2;
      shopfront(b, lx, lx + lw, 0.3, 3.3, r.chance(0.7) ? 'lobby' : r.pick<ShopKind>(['cafe', 'drugstore', 'shutter']), { recess: 0.3, jamb: plain });
      if (gar) { const gx0 = lx + lw + 0.6, gx1 = len / 2 - 0.5; b.hole(gx0, gx1, 0.3, 3.2); b.d(gx0, 0.3, gx1, 3.2, -0.15, 'fac_rolldoor', [0, 0, 512, 512]); graffitiRun(b, gx0 + 0.2, gx1 - 0.2, 0.4, 2.6); }
      b.bays(-len / 2, len / 2, g0, top, 0, 'fac_office_punch', TILE.officePunch[0], fh, g0, tint, 0);
      b.t(-len / 2, len / 2, top, top + 1.1, 0, tileWall);
      // shallow floor ledges and an entrance canopy give the front some depth
      const ledge = mulRGB(tint, 0.82);
      for (let f = 0; f <= F - 1; f++) b.trim(-len / 2, g0 + f * fh - 0.1, 0, len / 2, g0 + f * fh + 0.06, 0.16, ledge, { back: false, bottom: true });
      b.trim(lx - 0.3, 3.35, 0, lx + lw + 0.3, 3.5, 1.1, mulRGB(ledge, 0.9), { back: false, bottom: true });
      // company / building name on the parapet
      const k = r.pick([TEN.suzuki, TEN.bldAoi, TEN.bldMidori, TEN.bldMatsumoto, TEN.tax, TEN.juku]);
      b.d(-1.6, top + 0.15, 1.6, top + 0.95, 0.05, 'sign_tenant', tenRect(k));
      if (r.chance(0.4)) blade(b, (r.chance(0.5) ? -1 : 1) * (len / 2 - 0.35), g0 + 0.4, 4.6, r.pick(['english', 'dentist', 'mahjong', 'karaoke', 'pawn']));
    } else {
      plainFace(b, len, 0.3, top + 1.1, s === 'back' ? plain : tileWall);
      if (s !== 'back') {
        for (let f = 0; f < F - 1; f++) { if (r.chance(0.6)) acUnit(b, r.range(-len / 3, len / 3), g0 + f * fh + 0.1, 0.02); if (r.chance(0.5)) hwin(b, 'frosted', r.range(-len / 3, len / 3), g0 + f * fh + 1.3); }
        graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.4);
      }
    }
  });
  flatRoof(b, -W / 2, W / 2, -D, 0, top, 1.1, plain, hexRGB(0xe8e4dc));
  const sh = Math.min(3.2, W * 0.3);
  stairHouse(b, -W / 2 + 0.5, -W / 2 + 0.5 + sh, -D + 0.5, -D + 3.1, top, 2.7, plain);
  roofClutter(b, -W / 2 + 0.6 + sh, W / 2 - 0.6, -D + 0.6, -0.6, top, { tank: r.chance(0.6), ac: r.int(1, 3), dish: true });
  return top + 3;
}

// ───────────────────────────── Docks ─────────────────────────────

function warehouse(b: B, W: number, D: number) {
  const r = b.r;
  const H = r.range(7.5, 10.5);
  const apron = 3;
  const z1 = -apron, z0 = -D;
  const col = r.col(PAL.corrugated);
  const clad: FS = { layer: 'fac_corrugated', col, tile: TILE.corrugated };
  const roof: FS = { layer: 'roof_metal', col: r.col(PAL.rustRoof), tile: TILE.metal };
  const trimC = r.col([0xffffff, 0xf0d040, 0x2a3a6a, 0xd84030]);
  // apron slab and loading dock
  b.box(-W / 2, -4, z1, W / 2, 0.05, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0xa09c94), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xc8c8c4), tile: [5, 5] } });
  plinth(b, -W / 2, W / 2, z0, z1, hexRGB(0x8a8890), 0.4);
  const nDoor = Math.max(2, Math.min(5, Math.floor(W / 7)));
  walls(b, -W / 2, W / 2, z0, z1, (s, len) => {
    plainFace(b, len, 0.4, H, clad);
    b.bays(-len / 2, len / 2, H - 1.8, H - 0.6, 0.01, 'fac_whwin', TILE.whwin[0], TILE.whwin[1], H - 1.8, WHITE, s.length * 17);
    b.trim(-len / 2, H - 0.25, 0, len / 2, H, 0.08, trimC, { back: false });
    if (s === 'front') {
      // dock platform
      b.box(-len / 2 + 0.5, 0.05, 0, len / 2 - 0.5, 1.2, 1.8, { front: { layer: 'fac_wall_plain', col: hexRGB(0xb8b4ac), tile: TILE.plain }, left: { layer: 'fac_wall_plain', col: hexRGB(0xb8b4ac), tile: TILE.plain }, right: { layer: 'fac_wall_plain', col: hexRGB(0xb8b4ac), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xd0d0cc), tile: [5, 5] } });
      b.strip(-len / 2 + 0.5, len / 2 - 0.5, 0.8, 1.2, 1.81, 'roof_bits', BITS.stripes, 0.8);
      const dw = 4.2, gap = len / nDoor;
      for (let i = 0; i < nDoor; i++) {
        const cx = -len / 2 + gap * (i + 0.5);
        b.d(cx - dw / 2, 1.2, cx + dw / 2, 5.6, 0.05, 'fac_rolldoor', [0, 0, 512, 512]);
        b.d(cx - 0.4, 5.75, cx + 0.4, 6.15, 0.06, 'sign_tenant', tenRect([TEN.n1, TEN.n2, TEN.n3, TEN.n4][i % 4]));
        // dock bumpers
        for (const bx of [cx - dw / 2 + 0.3, cx + dw / 2 - 0.5]) b.trim(bx, 0.5, 1.8, bx + 0.2, 1.1, 1.95, TRIM_DARK);
        // lamp over the door
        b.trim(cx - 0.15, 6.3, 0, cx + 0.15, 6.5, 0.45, TRIM_DARK);
        b.d(cx - 0.12, 6.28, cx + 0.12, 6.3, 0.4, 'roof_bits', swatch('warm'));
        b.flat(cx - 0.12, 0.1, cx + 0.12, 0.42, 6.29, { layer: 'roof_bits', col: WHITE }, true);
        b.light(cx, 5, 2.5, [1, 0.85, 0.6], 7);
        if (i < nDoor - 1) graffitiRun(b, cx + dw / 2 + 0.2, cx + gap - dw / 2 - 0.2, 0.9, 4);
      }
      // canopy over the dock
      b.at(0, 0, 0, 0, () => pentRoof(b, -len / 2 + 0.3, len / 2 - 0.3, 6.0, 6.7, 2.6, { layer: 'roof_metal', col: roof.col, tile: TILE.metal }, trimC, hexRGB(0xc8ccd0)));
      // painted company name
      const ci = r.int(0, 3);
      const lw = Math.min(len * 0.6, 16);
      b.d(-lw / 2, H - 1.8 - lw / 4 - 0.2, lw / 2, H - 2.0, 0.04, 'sign_company', companyRect(ci));
    } else if (s !== 'back') {
      graffitiRun(b, -len / 2 + 1, len / 2 - 1, 1.0, 4);
      if (r.chance(0.5)) { b.d(-0.45, 0.4, 0.45, 2.4, 0.03, 'roof_bits', BITS.door); b.light(0, 2.6, 0.8, [1, 0.85, 0.6], 3); }
    }
  });
  const rise = Math.min(3.2, (W / 2) * 0.16);
  gableZ(b, -W / 2, W / 2, z0, z1, H, rise, 0.35, 0.35, roof, clad, { fascia: trimC, soffit: hexRGB(0x8a8e96) });
  return H + rise;
}

function portOffice(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const fh = 3.4, H = 0.3 + F * fh;
  const wallC = r.col([0xffffff, 0xf0f4f8, 0xf8f0e0, 0xe0ecf4]);
  const wall: FS = { layer: 'fac_sandwich', col: wallC, tile: TILE.sandwich };
  const stripe = r.col([0x1e5ad8, 0xd8302a, 0x2a9a5a, 0xf08a1f]);
  plinth(b, -W / 2, W / 2, -D, 0, hexRGB(0x7a7684));
  const stairSide = r.chance(0.5) ? 1 : -1;
  walls(b, -W / 2, W / 2, -D, 0, (s, len) => {
    if (s === 'front' || s === 'back') {
      plainFace(b, len, 0.3, H + 0.9, wall);
      for (let f = 0; f < F; f++) b.bays(-len / 2 + 0.6, len / 2 - 0.6, 0.3 + f * fh + 0.9, 0.3 + f * fh + 2.8, 0.02, 'fac_office_band', TILE.officeBand[0], 3.6, 0.3 + f * fh - 0.1, WHITE, f * 9 + (s === 'back' ? 50 : 0));
      if (s === 'front') {
        b.d(-0.5, 0.3, 0.5, 2.5, 0.04, 'deco_house', HOUSE.apt);
        b.trim(-1.0, 2.6, 0, 1.0, 2.75, 1.0, TRIM_STEEL, { bottom: true });
        b.light(0, 2.5, 0.8, [1, 0.92, 0.8], 4);
        const ci = r.int(0, 3);
        b.d(-Math.min(5, len / 2 - 0.5), H - 0.05, Math.min(5, len / 2 - 0.5), H - 0.05 + Math.min(10, len - 1) / 4, 0.04, 'sign_company', companyRect(ci));
      }
    } else {
      plainFace(b, len, 0.3, H + 0.9, wall);
      if ((s === 'right') === stairSide > 0) {
        // external steel stair to the upper floor door
        for (let f = 1; f < F; f++) {
          const yTop = 0.3 + f * fh;
          b.d(len / 2 - 1.6, yTop, len / 2 - 0.7, yTop + 2.0, 1.25, 'deco_house', HOUSE.apt);
          b.box(len / 2 - 2.0, yTop - 0.15, 0, len / 2 - 0.2, yTop, 1.3, { side: { layer: null, col: TRIM_STEEL }, top: { layer: 'roof_bits', col: hexRGB(0x9aa0aa) }, bottom: { layer: null, col: TRIM_STEEL } });
          const xs = -len / 2 + 1.0, xe = len / 2 - 2.0, ys = yTop - fh;
          b.quad([[xs, ys, 1.25], [xe, yTop, 1.25], [xe, yTop, 0.05], [xs, ys, 0.05]], { layer: 'roof_bits', col: hexRGB(0xa8aeb8) }, [0, 0.75, 1, 0.75, 1, 0.87, 0, 0.87], b.g(ys), b.g(yTop));
          b.quad([[xs, ys - 0.25, 1.3], [xe, yTop - 0.25, 1.3], [xe, yTop, 1.3], [xs, ys, 1.3]], { layer: null, col: stripe }, [0, 0, 1, 0, 1, 1, 0, 1], b.g(ys), b.g(yTop));
          b.quad([[xs, ys, 1.3], [xe, yTop, 1.3], [xe, yTop + 1.0, 1.3], [xs, ys + 1.0, 1.3]], { layer: 'deco_cut' }, [0, 1 - 96 / 512, (xe - xs) / 2, 1 - 96 / 512, (xe - xs) / 2, 1, 0, 1], b.g(ys), b.g(yTop + 1));
          b.light(len / 2 - 1.1, yTop + 2.2, 1.3, [1, 0.9, 0.7], 3);
        }
      } else graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.5);
      for (let f = 0; f < F; f++) if (r.chance(0.5)) acUnit(b, -len / 4, 0.3 + f * fh + 0.2, 0.02);
    }
  });
  floorBands(b, -W / 2, W / 2, -D, 0, [H - 0.2], stripe, 0.06, 0.4);
  flatRoof(b, -W / 2, W / 2, -D, 0, H, 0.9, wall, hexRGB(0xe8ecf0));
  // radio mast and a rooftop tank
  const mx = -stairSide * (W / 2 - 1.5);
  b.trim(mx - 0.08, H, -D / 2 - 0.08, mx + 0.08, H + 9, -D / 2 + 0.08, TRIM_STEEL);
  for (let k = 1; k <= 3; k++) b.trim(mx - 0.5, H + k * 2.5, -D / 2 - 0.03, mx + 0.5, H + k * 2.5 + 0.05, -D / 2 + 0.03, TRIM_STEEL);
  b.at(mx, H + 9, -D / 2 + 0.09, 0, () => b.d(-0.15, 0, 0.15, 0.3, 0, 'roof_bits', swatch('red')));
  b.light(mx, H + 9.1, -D / 2, [1, 0.15, 0.1], 2.5);
  roofClutter(b, -W / 2 + 1, W / 2 - 1, -D + 1, -1, H, { tank: true, ac: 2 });
  return H + 9.3;
}

function coldStorage(b: B, W: number, D: number) {
  const r = b.r;
  const H = r.range(13, 20);
  const apron = 3, z1 = -apron;
  const wallC = r.col([0xffffff, 0xf4f0e8, 0xe8f2f8, 0xf0f0f4]);
  const wall: FS = { layer: 'fac_sandwich', col: wallC, tile: TILE.sandwich };
  const stripe = r.col([0x1e5ad8, 0xd8302a, 0x2aa0c8, 0x2a8a4a]);
  b.box(-W / 2, -4, z1, W / 2, 0.05, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0xa09c94), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xc8c8c4), tile: [5, 5] } });
  plinth(b, -W / 2, W / 2, -D, z1, hexRGB(0x8a8890), 0.4);
  const ci = r.int(0, 3);
  walls(b, -W / 2, W / 2, -D, z1, (s, len) => {
    plainFace(b, len, 0.4, H + 0.6, wall);
    b.trim(-len / 2, H * 0.62, 0, len / 2, H * 0.62 + 0.9, 0.04, stripe, { back: false, top: false });
    if (s === 'front') {
      const nb = Math.max(2, Math.min(5, Math.floor(len / 6.5)));
      const gap = len / nb;
      b.box(-len / 2 + 0.4, 0.05, 0, len / 2 - 0.4, 1.25, 1.9, { side: { layer: 'fac_wall_plain', col: hexRGB(0xb8b4ac), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xd0d0cc), tile: [5, 5] } });
      b.strip(-len / 2 + 0.4, len / 2 - 0.4, 0.85, 1.25, 1.91, 'roof_bits', BITS.stripes, 0.8);
      for (let i = 0; i < nb; i++) {
        const cx = -len / 2 + gap * (i + 0.5);
        // dock shelter: black padded frame proud of the wall, door inside
        b.box(cx - 1.9, 1.25, 0, cx - 1.45, 4.9, 0.6, { side: { layer: null, col: hexRGB(0x24222a) }, top: { layer: null, col: hexRGB(0x24222a) } });
        b.box(cx + 1.45, 1.25, 0, cx + 1.9, 4.9, 0.6, { side: { layer: null, col: hexRGB(0x24222a) }, top: { layer: null, col: hexRGB(0x24222a) } });
        b.box(cx - 1.9, 4.5, 0, cx + 1.9, 5.0, 0.6, { side: { layer: null, col: hexRGB(0x24222a) }, top: { layer: null, col: hexRGB(0x24222a) }, bottom: { layer: null, col: hexRGB(0x24222a) } });
        b.trim(cx - 1.9, 4.85, 0.6, cx + 1.9, 4.95, 0.62, hexRGB(0xffd21a), { back: false });
        b.d(cx - 1.45, 1.25, cx + 1.45, 4.5, 0.03, 'fac_rolldoor', [40, 64, 432, 430]);
        b.d(cx - 0.35, 5.2, cx + 0.35, 5.55, 0.04, 'sign_tenant', tenRect([TEN.n1, TEN.n2, TEN.n3, TEN.n4][i % 4]));
        b.light(cx, 4.6, 2.2, [0.9, 0.95, 1], 6);
        b.d(cx - 0.15, 5.65, cx + 0.15, 5.8, 0.06, 'roof_bits', swatch('white'));
      }
      const lw = Math.min(len * 0.7, 20);
      b.d(-lw / 2, H - lw / 4 - 0.6, lw / 2, H - 0.6, 0.05, 'sign_company', companyRect(ci));
    } else if (s !== 'back') graffitiRun(b, -len / 2 + 1, len / 2 - 1, 0.9, 4);
  });
  flatRoof(b, -W / 2, W / 2, -D, z1, H, 0.6, wall, hexRGB(0xe0e4e8));
  // refrigeration condensers on the roof
  const n = Math.max(2, Math.floor(W / 4));
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 2 + (i * (W - 4)) / Math.max(1, n - 1);
    b.box(x - 1.0, H, -D / 2 - 1.2, x + 1.0, H + 1.4, -D / 2 + 1.2, { side: { layer: 'roof_bits' }, top: { layer: 'roof_bits' } });
    b.d(x - 0.9, H + 0.1, x + 0.9, H + 1.3, -D / 2 + 1.21, 'roof_bits', BITS.acFront);
  }
  // stair tower at a corner
  const sx = r.chance(0.5) ? W / 2 : -W / 2 + 3.2;
  b.box(sx - 3.2, 0.3, z1 - 0.01 - 3.2, sx, H + 3.2, z1 - 0.01, { side: { layer: 'fac_sandwich', col: mulRGB(stripe, 1.2), tile: TILE.sandwich }, top: { layer: 'roof_flat', tile: TILE.flat } });
  b.at(sx - 1.6, 0, z1 + 0.01, 0, () => { for (let f = 0; f < Math.floor(H / 3.6); f++) b.d(-0.4, 1.0 + f * 3.6, 0.4, 2.0 + f * 3.6, 0, 'deco_house', HOUSE.tall, undefined, b.r.int(1, 99)); b.d(-0.45, 0.3, 0.45, 2.4, 0.01, 'roof_bits', BITS.door); });
  return H + 3.2;
}

// ───────────────────────────── Suburbs ─────────────────────────────

function house(b: B, W: number, D: number) {
  const r = b.r;
  const yard = r.range(2.5, Math.min(5, D - 7.5));
  const carport = W > 9.5 && r.chance(0.55);
  const hw = carport ? W - 3.4 : W - r.range(1.0, 1.8);
  const hx = carport ? (r.chance(0.5) ? -1 : 1) * (W - hw) / 2 + 0 : 0;
  const cpSide = Math.sign(-hx) || 1;
  const x0 = hx - hw / 2 + (carport ? 0 : 0), x1 = hx + hw / 2;
  const z1 = -yard, z0 = -D + r.range(0.6, 1.2);
  const h1 = 2.9, h2 = 2.8, yE = 0.45 + h1 + h2;
  const style = r.wpick([['gable', 4], ['hip', 3], ['box', 1.2]] as const);
  const sidingC = r.col(PAL.siding);
  const wallF: FS = r.chance(0.55) ? { layer: 'fac_siding', col: sidingC, tile: TILE.siding } : { layer: 'fac_mortar', col: sidingC, tile: TILE.mortar };
  const wall2: FS = style === 'box' || r.chance(0.3) ? { layer: wallF.layer === 'fac_siding' ? 'fac_mortar' : 'fac_siding', col: r.col(PAL.siding), tile: TILE.siding } : wallF;
  const roof: FS = r.chance(0.5) ? { layer: 'roof_kawara', col: r.col(PAL.kawara), tile: TILE.kawara } : { layer: 'roof_metal', col: r.col(PAL.metalRoof), tile: TILE.metal };
  const trimC = r.col([0xffffff, 0xf4f0e8, 0x5a3a28, 0x3a3a48, 0x8a5a3a]);
  // yard: concrete pad + gravel garden
  b.box(-W / 2, -4, z1, W / 2, 0.08, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a968c), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xe0dcd2), tile: [3, 3] } });
  b.box(-W / 2, -4, -D, W / 2, 0.08, z1, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a968c), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xd8d0c0), tile: [3, 3] }, front: null });
  plinth(b, x0, x1, z0, z1, hexRGB(0x8a8890), 0.45);
  const front2 = r.chance(0.6); // balcony on the front upper floor
  walls(b, x0, x1, z0, z1, (s, len) => {
    plainFace(b, len, 0.45, 0.45 + h1, wallF);
    plainFace(b, len, 0.45 + h1, yE + (style === 'box' ? 0.9 : 0), wall2);
    if (wall2 !== wallF) b.trim(-len / 2, 0.45 + h1 - 0.06, 0, len / 2, 0.45 + h1 + 0.1, 0.06, trimC, { back: false });
    const y1 = 0.45, y2 = 0.45 + h1;
    if (s === 'front') {
      const dx = r.chance(0.5) ? -len / 2 + 1.0 : len / 2 - 1.0;
      hwin(b, 'door', dx, y1);
      // porch canopy and lamp
      b.trim(dx - 0.8, y1 + 2.4, 0, dx + 0.8, y1 + 2.52, 0.9, trimC, { bottom: true });
      b.light(dx, y1 + 2.0, 0.8, [1, 0.8, 0.5], 3.5);
      const wx = dx < 0 ? len / 4 : -len / 4;
      if (len >= 7.5) {
        // two ground-floor openings: a big slider onto the yard and a small window by the door
        hwin(b, r.pick(['slider', 'flower', 'slider'] as const), dx < 0 ? len / 2 - 1.6 : -len / 2 + 1.6, y1 + 0.75);
        hwin(b, r.pick(['frosted', 'kitchen'] as const), dx < 0 ? dx + 1.9 : dx - 1.9, y1 + 1.5);
      } else hwin(b, r.pick(['slider', 'flower', 'slider'] as const), wx, y1 + 0.75);
      // downpipes at the front corners, a meter box, maybe an outdoor AC unit
      for (const sx of [-1, 1]) b.trim(sx * (len / 2 - 0.12) - 0.045, 0.1, 0.02, sx * (len / 2 - 0.12) + 0.045, yE - 0.1, 0.11, mulRGB(trimC, 0.85), { top: false });
      b.trim(dx + (dx < 0 ? -0.75 : 0.45), 1.2, 0, dx + (dx < 0 ? -0.45 : 0.75), 1.65, 0.1, hexRGB(0xc8ccd0));
      if (r.chance(0.45)) acUnit(b, dx < 0 ? dx + 2.4 : dx - 2.4, 0.45, 0.02);
      if (front2) {
        hwin(b, 'balcony', 0, y2 + 0.15);
        b.box(-len / 2 + 0.3, y2 + 0.05, 0, len / 2 - 0.3, y2 + 0.2, 1.0, { side: { layer: null, col: trimC }, top: { layer: null, col: hexRGB(0xc8c4bc) }, bottom: { layer: null, col: TRIM_SOFFIT } });
        b.q(-len / 2 + 0.3, len / 2 - 0.3, y2 + 0.2, y2 + 1.15, 1.0, { layer: 'deco_cut' }, [0, 1 - 96 / 512, (len - 0.6) / 2, 1]);
        b.at(0, 0, 1.0, Math.PI, () => b.q(-len / 2 + 0.3, len / 2 - 0.3, y2 + 0.2, y2 + 1.15, 0.01, { layer: 'deco_cut' }, [0, 1 - 96 / 512, (len - 0.6) / 2, 1]));
        if (r.chance(0.5)) b.d(-1.0, y2 + 1.0, 1.0, y2 + 2.0, 0.7, 'deco_cut', r.chance(0.5) ? CUT.laundry : CUT.laundry2);
        else if (r.chance(0.3)) b.d(-0.6, y2 + 0.3, 0.6, y2 + 1.5, 1.04, 'deco_cut', CUT.futon);
      } else { hwin(b, 'slider', -len / 4, y2 + 0.8); hwin(b, r.pick(['tall', 'slider', 'shut'] as const), len / 4, y2 + 0.8); if (len >= 8.5) hwin(b, 'frosted', 0, y2 + 1.4); }
      if (r.chance(0.6)) b.d(dx + (dx < 0 ? 1.0 : -2.0), 0.08, dx + (dx < 0 ? 2.0 : -1.0), 1.08, 0.5, 'deco_cut', CUT.plants);
      if (r.chance(0.35)) b.d(dx + (dx < 0 ? 0.6 : -1.8), 0.08, dx + (dx < 0 ? 1.8 : -0.6), 1.28, 1.6, 'deco_cut', CUT.bike);
    } else if (s === 'back') {
      hwin(b, 'slider', -len / 4, y1 + 0.75); hwin(b, 'shut', len / 4, y1 + 0.75); hwin(b, 'slider', 0, y2 + 0.8);
    } else {
      hwin(b, 'frosted', -len / 4, y1 + 1.4); hwin(b, 'kitchen', len / 4, y1 + 1.5); hwin(b, 'tall', 0, y2 + 0.7);
      if (r.chance(0.6)) acUnit(b, r.range(-len / 3, len / 3), 0.45, 0.02);
      if (r.chance(0.4)) acUnit(b, r.range(-len / 3, len / 3), y2 + 0.3, 0.02);
    }
  });
  let h = yE;
  if (style === 'gable') {
    const rise = Math.min(2.6, (Math.min(hw, z1 - z0) / 2) * 0.55);
    if (r.chance(0.6)) gableX(b, x0, x1, z0, z1, yE, rise, 0.55, 0.45, roof, wall2, { fascia: trimC, soffit: TRIM_SOFFIT, ridge: mulRGB(roof.col!, 0.6) });
    else gableZ(b, x0, x1, z0, z1, yE, Math.min(2.6, hw * 0.28), 0.5, 0.5, roof, wall2, { fascia: trimC, soffit: TRIM_SOFFIT, ridge: mulRGB(roof.col!, 0.6) });
    h = yE + rise;
  } else if (style === 'hip') {
    const rise = Math.min(2.4, Math.min(hw, z1 - z0) * 0.25);
    hipRoof(b, x0, x1, z0, z1, yE, rise, 0.55, roof, { fascia: trimC, soffit: TRIM_SOFFIT, ridge: mulRGB(roof.col!, 0.6) });
    h = yE + rise;
  } else {
    flatRoof(b, x0, x1, z0, z1, yE, 0.9, wall2, hexRGB(0xd8d8d8), 0.2);
    roofClutter(b, x0 + 0.4, x1 - 0.4, z0 + 0.4, z1 - 0.4, yE, { ac: 1, solar: r.chance(0.5) });
    h = yE + 0.9;
  }
  if (style !== 'box' && r.chance(0.35)) { const dx = r.range(x0 + 1, x1 - 1); b.trim(dx - 0.03, h - 0.4, (z0 + z1) / 2 - 0.03, dx + 0.03, h + 1.6, (z0 + z1) / 2 + 0.03, TRIM_STEEL); b.trim(dx - 0.6, h + 1.2, (z0 + z1) / 2 - 0.02, dx + 0.6, h + 1.24, (z0 + z1) / 2 + 0.02, TRIM_STEEL); b.trim(dx - 0.45, h + 1.45, (z0 + z1) / 2 - 0.02, dx + 0.45, h + 1.49, (z0 + z1) / 2 + 0.02, TRIM_STEEL); }
  // carport: posts and a translucent roof
  if (carport) {
    const cx0 = cpSide > 0 ? x1 + 0.2 : -W / 2 + 0.2, cx1 = cpSide > 0 ? W / 2 - 0.2 : x0 - 0.2;
    for (const z of [z1 - 0.3, -0.6]) b.trim(cx1 * (cpSide > 0 ? 1 : 0) + cx0 * (cpSide > 0 ? 0 : 1) - 0.06, 0.08, z - 0.06, cx1 * (cpSide > 0 ? 1 : 0) + cx0 * (cpSide > 0 ? 0 : 1) + 0.06, 2.4, z + 0.06, hexRGB(0xa8aeb8));
    const yy = 2.4;
    b.box(cx0, yy, z1 - 1.5, cx1, yy + 0.12, -0.3, { side: { layer: null, col: hexRGB(0xa8aeb8) }, top: { layer: 'fac_whwin', col: hexRGB(0xd8e8e4), tile: [3, 3] }, bottom: { layer: 'fac_whwin', col: hexRGB(0xb8c8c4), tile: [3, 3] } });
  }
  return h + 0.2;
}

function apaato(b: B, W: number, D: number) {
  const r = b.r;
  const yard = r.range(1.5, 2.5);
  const z1 = -yard, z0 = -D + 0.5;
  const fh = 2.75, y1 = 0.4, y2 = y1 + fh, yE = y2 + fh;
  const wallC = r.col(PAL.siding);
  const wall: FS = r.chance(0.6) ? { layer: 'fac_siding', col: wallC, tile: TILE.siding } : { layer: 'fac_corrugated', col: r.col([0xf0e8d4, 0xc8d8e8, 0xe8d8c8]), tile: TILE.corrugated };
  const steelC = r.col([0x8a5a3a, 0x3a4a6a, 0x5a6a5a, 0xb0b8c0]);
  const stairX = r.chance(0.5) ? 1 : -1;
  const x0 = -W / 2 + (stairX < 0 ? 2.4 : 0.5), x1 = W / 2 - (stairX > 0 ? 2.4 : 0.5);
  b.box(-W / 2, -4, -D, W / 2, 0.08, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a968c), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xd4d0c4), tile: [3, 3] } });
  plinth(b, x0, x1, z0, z1 - 1.3, hexRGB(0x8a8890), 0.4);
  const units = Math.max(2, Math.floor((x1 - x0) / 3.3));
  const cz = z1 - 1.3; // facade line; corridor in front of it
  walls(b, x0, x1, z0, cz, (s, len) => {
    plainFace(b, len, 0.4, yE + 0.3, wall);
    if (s === 'front') {
      const uw = len / units;
      for (const y of [y1, y2]) for (let i = 0; i < units; i++) {
        const ux = -len / 2 + (i + 0.5) * uw;
        hwin(b, 'apt', ux - uw * 0.22, y, 0.03);
        hwin(b, 'kitchen', ux + uw * 0.2, y + 1.3, 0.03, 0.6);
        b.d(ux - uw * 0.22 - 0.35, y + 2.05, ux - uw * 0.22 + 0.35, y + 2.25, 0.04, 'roof_bits', swatch('warm'));
        if (i % 2 === 0) b.light(ux - uw * 0.22, y + 2.1, 0.8, [1, 0.9, 0.7], 2.5);
        if (y === y2 && r.chance(0.5)) b.trim(ux + uw * 0.05, y, 0.1, ux + uw * 0.05 + 0.6, y + 0.85, 0.7, hexRGB(0xf0f0f4));
      }
      // upper corridor slab + railing
      b.box(-len / 2, y2 - 0.25, 0, len / 2, y2, 1.3, { side: { layer: null, col: steelC }, top: { layer: 'roof_flat', col: hexRGB(0xc8c4bc), tile: [3, 3] }, bottom: { layer: null, col: TRIM_SOFFIT }, back: undefined });
      b.q(-len / 2, len / 2, y2, y2 + 1.05, 1.3, { layer: 'fac_balcony', col: wallC }, [0, 0.5, len / 3.6, 0.73]);
      b.at(0, 0, 1.3, Math.PI, () => b.q(-len / 2, len / 2, y2, y2 + 1.05, 0.05, { layer: 'fac_wall_plain', col: wallC, tile: TILE.plain }, [0, 0, len / 4, 0.26]));
      b.flat(-len / 2, 1.24, len / 2, 1.3, y2 + 1.05, { layer: null, col: steelC });
      for (let i = 0; i <= units; i++) b.trim(-len / 2 + i * uw - 0.05, y1, 1.15, -len / 2 + i * uw + 0.05, y2 - 0.25, 1.25, steelC);
      // name plate
      b.d(-len / 2 + 0.3, y2 + 1.15, -len / 2 + 2.3, y2 + 1.65, 1.31, 'sign_tenant', tenRect(r.pick([TEN.aptSakura, TEN.aptAoba, TEN.aptWakaba, TEN.aptSun])));
    } else if (s === 'back') {
      for (const y of [y1, y2]) for (let i = 0; i < units; i++) hwin(b, r.chance(0.7) ? 'slider' : 'shut', -len / 2 + (i + 0.5) * (len / units), y + 0.6);
      if (r.chance(0.6)) b.d(-1, y2 + 0.9, 1, y2 + 1.9, 0.4, 'deco_cut', CUT.laundry2);
    } else {
      hwin(b, 'frosted', 0, y1 + 1.3); hwin(b, 'frosted', 0, y2 + 1.3);
      if (r.chance(0.4)) graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.35, 2.4);
    }
  });
  // external steel stair at one end
  const stF: FS = { layer: 'roof_bits', col: steelC };
  const st0 = stairX > 0 ? x1 + 0.15 : x0 - 1.95, st1 = st0 + 1.8;
  b.box(st0, y2 - 0.2, cz - 1.0, st1, y2, cz + 1.3, { side: { layer: null, col: steelC }, top: { layer: 'roof_flat', col: hexRGB(0xb8b4ac), tile: [3, 3] }, bottom: { layer: null, col: steelC } });
  b.quad([[st0, y1, z0 + 2.2], [st1, y1, z0 + 2.2], [st1, y2 - 0.1, cz - 1.0], [st0, y2 - 0.1, cz - 1.0]], stF, [0, 0.75, 1, 0.75, 1, 0.87, 0, 0.87], b.g(y1), b.g(y2));
  b.quad([[st1, y1, z0 + 2.2], [st0, y1, z0 + 2.2], [st0, y2 - 0.1, cz - 1.0], [st1, y2 - 0.1, cz - 1.0]], { layer: null, col: mulRGB(steelC, 0.8) }, [0, 0, 1, 0, 1, 1, 0, 1], b.g(y1), b.g(y2));
  const outer = stairX > 0 ? st1 : st0;
  const railF: FS = { layer: 'deco_cut', col: steelC };
  const rl = Math.hypot(cz - 1.0 - (z0 + 2.2), y2 - y1);
  for (const dir of [1, -1]) b.quad(dir > 0 ? [[outer, y1, z0 + 2.2], [outer, y2, cz - 1.0], [outer, y2 + 1.0, cz - 1.0], [outer, y1 + 1.0, z0 + 2.2]] : [[outer, y2, cz - 1.0], [outer, y1, z0 + 2.2], [outer, y1 + 1.0, z0 + 2.2], [outer, y2 + 1.0, cz - 1.0]], railF, dir > 0 ? [0, 1 - 96 / 512, rl / 2, 1 - 96 / 512, rl / 2, 1, 0, 1] : [rl / 2, 1 - 96 / 512, 0, 1 - 96 / 512, 0, 1, rl / 2, 1], b.g(y1), b.g(y2 + 1));
  for (const z of [cz + 1.2, z0 + 2.3]) b.trim(outer - 0.05, 0.08, z - 0.05, outer + 0.05, y2, z + 0.05, steelC);
  // mailboxes and bikes by the stair foot
  b.box(st0 + 0.2, 0.08, cz + 0.2, st0 + 1.4, 1.3, cz + 0.6, { side: { layer: 'roof_bits', col: hexRGB(0xc8ccd4) }, top: { layer: null, col: TRIM_STEEL } });
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) b.d(-W / 2 + 0.6 + i * 0.8, 0.08, -W / 2 + 1.8 + i * 0.8, 1.28, -0.5 - i * 0.3, 'deco_cut', CUT.bike);
  // low-pitch roof
  const roof: FS = { layer: 'roof_metal', col: r.col(PAL.metalRoof), tile: TILE.metal };
  gableX(b, x0, x1, z0, cz, yE + 0.3, Math.min(1.4, (cz - z0) * 0.18), 0.5, 0.4, roof, wall, { fascia: steelC, soffit: TRIM_SOFFIT });
  b.trim(x0 - 0.3, y2 + 2.45, cz + 0.4, x1 + 0.3, y2 + 2.55, cz + 1.4, steelC);
  return yE + 1.8;
}

// ───────────────────────────── Edge of town ─────────────────────────────

function farmShed(b: B, W: number, D: number) {
  const r = b.r;
  const H = r.range(2.8, 3.8);
  const col = r.col([0xa8c4e0, 0xe0704a, 0x78b888, 0xeedcb8, 0x6a9ae0, 0xd8d8d0]);
  const clad: FS = { layer: 'fac_corrugated', col, tile: TILE.corrugated };
  const roof: FS = { layer: 'roof_metal', col: r.col(PAL.rustRoof), tile: TILE.metal };
  const yard = Math.min(2, D * 0.2);
  b.box(-W / 2, -4, -yard, W / 2, 0.05, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a8e7a), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xc8b898), tile: [4, 4] } });
  plinth(b, -W / 2, W / 2, -D, -yard, hexRGB(0x8a8478), 0.25);
  const open = r.chance(0.55);
  walls(b, -W / 2, W / 2, -D, -yard, (s, len) => {
    if (s === 'front' && open) {
      // open bay: posts, dark interior, stacked crates and bags
      const pw = 0.15;
      b.t(-len / 2, -len / 2 + 0.6, 0.25, H, 0, clad);
      b.t(len / 2 - 0.6, len / 2, 0.25, H, 0, clad);
      b.t(-len / 2 + 0.6, len / 2 - 0.6, H - 0.5, H, 0, clad);
      b.q(-len / 2 + 0.6, len / 2 - 0.6, 0.25, H - 0.5, -(D - yard) + 0.6, { layer: 'fac_wood', col: hexRGB(0x5a4a40), tile: TILE.wood }, [0, 0.1, (len - 1.2) / 2, (H - 0.5) / 3]);
      for (const sx of [-1, 1]) b.w.wall(sx * (len / 2 - 0.6), sx > 0 ? -(D - yard) + 0.6 : 0, sx * (len / 2 - 0.6), sx > 0 ? 0 : -(D - yard) + 0.6, 0.25, H - 0.5, b.mat({ layer: 'fac_wood', col: hexRGB(0x6a5a4a) }), { uv: [0, 0, (D - yard) / 2, 1], gBase: 0, gTop: b.g(H) });
      b.flat(-len / 2 + 0.6, -(D - yard) + 0.6, len / 2 - 0.6, 0, 0.25, { layer: 'roof_flat', col: hexRGB(0xa89878), tile: [3, 3] });
      b.flat(-len / 2 + 0.6, -(D - yard) + 0.6, len / 2 - 0.6, 0, H - 0.5, { layer: 'fac_wood', col: hexRGB(0x4a3a30), tile: TILE.wood }, true);
      for (let i = 0; i < r.int(2, 5); i++) {
        const cx = r.range(-len / 2 + 1.2, len / 2 - 1.2), cz = r.range(-(D - yard) + 1.2, -1.0), n = r.int(1, 3);
        for (let k = 0; k < n; k++) b.box(cx - 0.35, 0.25 + k * 0.42, cz - 0.25, cx + 0.35, 0.25 + (k + 1) * 0.42 - 0.02, cz + 0.25, { side: { layer: 'fac_wood', col: hexRGB(0xe8c8a0), tile: [1, 1] }, top: { layer: 'fac_wood', col: hexRGB(0xd8b890), tile: [1, 1] } });
      }
      for (const x of [-len / 2 + 0.6, len / 2 - 0.6]) b.trim(x - pw, 0.25, -0.2, x + pw, H - 0.5, 0.05, hexRGB(0x5a4a3a));
      b.light(0, H - 0.8, 0.5, [1, 0.8, 0.5], 4);
      b.d(-0.2, H - 0.75, 0.2, H - 0.55, 0.06, 'roof_bits', swatch('warm'));
    } else {
      plainFace(b, len, 0.25, H, clad);
      if (s === 'front') {
        // sliding doors
        b.d(-len / 4, 0.25, len / 4, H - 0.4, 0.05, 'fac_rolldoor', [40, 64, 432, 430], mulRGB(col, 1.1));
        b.trim(-len / 4 - 0.3, H - 0.4, 0, len / 4 + 0.3, H - 0.25, 0.12, TRIM_DARK);
      }
      if (s !== 'back' && r.chance(0.3)) graffitiRun(b, -len / 2 + 0.4, len / 2 - 0.4, 0.3, 2.2);
    }
  });
  const rise = Math.min(1.8, W * 0.18);
  if (r.chance(0.6)) gableX(b, -W / 2, W / 2, -D, -yard, H, rise, 0.35, 0.3, roof, clad, { fascia: mulRGB(col, 0.8), soffit: hexRGB(0x7a7068) });
  else gableZ(b, -W / 2, W / 2, -D, -yard, H, rise, 0.35, 0.3, roof, clad, { fascia: mulRGB(col, 0.8), soffit: hexRGB(0x7a7068) });
  return H + rise;
}

function workshop(b: B, W: number, D: number, F: number) {
  const r = b.r;
  const yard = r.range(2, 3);
  const H = F > 1 ? 6.6 : r.range(4.8, 5.8);
  const z1 = -yard;
  const col = r.col([0xe8eef4, 0xf4ecd8, 0xc8d8e8, 0xd8e8d8, 0xf0f0f0]);
  const wall: FS = { layer: r.chance(0.5) ? 'fac_sandwich' : 'fac_corrugated', col, tile: TILE.sandwich };
  const trimC = r.col([0x1e3a8a, 0xd8302a, 0x2a8a4a, 0xf08a1f]);
  b.box(-W / 2, -4, z1, W / 2, 0.06, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0x9a968c), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xc4c0b8), tile: [4, 4] } });
  plinth(b, -W / 2, W / 2, -D, z1, hexRGB(0x8a8890), 0.3);
  const doorW = Math.min(4.2, W * 0.45);
  walls(b, -W / 2, W / 2, -D, z1, (s, len) => {
    plainFace(b, len, 0.3, H, wall);
    b.trim(-len / 2, H - 0.3, 0, len / 2, H, 0.06, trimC, { back: false });
    if (s === 'front') {
      const dx = len / 2 - doorW / 2 - 0.6;
      b.d(dx - doorW / 2, 0.3, dx + doorW / 2, 4.0, 0.03, 'fac_rolldoor', [0, 0, 512, 512]);
      // office part with windows and a door
      const ox = -len / 2 + (len - doorW - 1.2) / 2;
      hwin(b, 'apt', ox - 1.0, 0.3);
      hwin(b, 'slider', ox + 0.8, 1.2);
      if (F > 1) { hwin(b, 'slider', ox - 0.6, 3.9); hwin(b, 'slider', ox + 1.4, 3.9); }
      // sign
      b.d(-len / 2 + 0.4, H - 1.25, -len / 2 + 0.4 + Math.min(4, len * 0.45), H - 0.4, 0.05, 'sign_tenant', tenRect(TEN.suzuki));
      b.trim(dx - 0.15, 4.25, 0, dx + 0.15, 4.45, 0.45, TRIM_DARK);
      b.d(dx - 0.12, 4.23, dx + 0.12, 4.25, 0.4, 'roof_bits', swatch('warm'));
      b.flat(dx - 0.12, 0.05, dx + 0.12, 0.42, 4.24, { layer: 'roof_bits', col: WHITE }, true);
      b.light(dx, 3.8, 2, [1, 0.85, 0.6], 6);
      if (r.chance(0.75)) vending(b, ox - 2.3, r.int(0, 3), 0.02);
    } else if (s !== 'back') { graffitiRun(b, -len / 2 + 0.5, len / 2 - 0.5, 0.45, 2.6); if (r.chance(0.6)) acUnit(b, r.range(-len / 3, len / 3), 0.3, 0.02); }
  });
  const roof: FS = { layer: 'roof_metal', col: r.col(PAL.metalRoof), tile: TILE.metal };
  const rise = Math.min(1.6, W * 0.12);
  gableZ(b, -W / 2, W / 2, -D, z1, H, rise, 0.3, 0.3, roof, wall, { fascia: trimC, soffit: hexRGB(0x9a9ea8) });
  return H + rise;
}

function greenhouse(b: B, W: number, D: number) {
  const r = b.r;
  const H = r.range(3.0, 3.5), wallH = 1.3;
  const z1 = -r.range(0.3, 1), z0 = -D + 0.3;
  b.box(-W / 2, -4, -D, W / 2, 0.05, 0, { side: { layer: 'fac_wall_plain', col: hexRGB(0x8a7e68), tile: TILE.plain }, top: { layer: 'roof_flat', col: hexRGB(0xb8a888), tile: [4, 4] } });
  const film: FS = { layer: 'fac_whwin', col: mulRGB(r.col([0xffffff, 0xf0fff4, 0xf4f8ff]), 1.35) };
  const seg = 6;
  const hw = W / 2 - 0.3;
  const prof: [number, number][] = [];
  prof.push([-hw, 0.05]); prof.push([-hw, wallH]);
  for (let i = 1; i < seg; i++) { const a = Math.PI - (i / seg) * Math.PI; prof.push([Math.cos(a) * hw, wallH + Math.sin(a) * (H - wallH)]); }
  prof.push([hw, wallH]); prof.push([hw, 0.05]);
  // film shell: u along the profile, v along z (ribs every 1.2 m in the texture)
  let u = 0;
  const len = z1 - z0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
    const l = Math.hypot(xb - xa, yb - ya);
    b.quad([[xa, ya, z1], [xb, yb, z1], [xb, yb, z0], [xa, ya, z0]], film, [0, u, 0, u + l / 3, len / 3, u + l / 3, len / 3, u], b.g(ya), b.g(yb));
    u += l / 3;
  }
  // end walls (profile fans) with a door at the front
  for (const [z, front] of [[z1, true], [z0, false]] as const) {
    const cx = 0, cy = wallH * 0.6;
    for (let i = 0; i < prof.length - 1; i++) {
      const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
      // translucent film: bright all over (no dark foot), like the long sides
      if (front) b.tri([cx, cy, z], [xb, yb, z], [xa, ya, z], film, [0.5, cy / 3, 0.5 + xb / 3, yb / 3, 0.5 + xa / 3, ya / 3], 0.75);
      else b.tri([cx, cy, z], [xa, ya, z], [xb, yb, z], film, [0.5, cy / 3, 0.5 - xa / 3, ya / 3, 0.5 - xb / 3, yb / 3], 0.75);
    }
    if (front) {
      b.d(-0.6, 0.05, 0.6, 2.0, z + 0.03, 'fac_rolldoor', [40, 64, 432, 430], hexRGB(0xd8e8e0));
      b.trim(-0.7, 2.0, z, 0.7, 2.1, z + 0.06, TRIM_STEEL);
    }
  }
  // hoops
  for (let z = z1 - 0.01; z > z0; z -= 2.4) for (let i = 0; i < prof.length - 1; i++) {
    const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
    b.quad([[xa, ya, z + 0.03], [xb, yb, z + 0.03], [xb, yb, z - 0.03], [xa, ya, z - 0.03]].map(([x, y, zz]) => [x * 1.006, y + 0.012, zz]) as [number, number, number][], { layer: null, col: hexRGB(0x7a8a90) }, [0, 0, 1, 0, 1, 1, 0, 1], b.g(ya), b.g(yb));
  }
  b.light(0, H * 0.7, z1 - len / 2, [1, 0.92, 0.7], Math.min(12, len * 0.5));
  return H + 0.05;
}

// ───────────────────────────── entry points ─────────────────────────────

/** Integer window seed 0–63 written to aLight.a (the shader rounds it before hashing). */
function seedOf(seed: number) { return ((Math.imul(seed | 0, 2654435761) >>> 0) >>> 7) % 64; }

/**
 * Builds one near building into `world` (inked props into `inked`) in its local frame.
 * `L` maps texture-layer names to indices. Deterministic from spec.seed.
 */
export function buildBuilding(world: WorldGeom, inked: InkedGeom, L: (layer: string) => number, spec: BuildingSpec): BuildingResult {
  const def = TYPE_INDEX.get(spec.type);
  if (!def) throw new Error(`unknown building type ${spec.type}`);
  const r = new Rng(spec.seed * 7919 + spec.type.length * 131);
  const W = Math.max(def.width[0] * 0.8, spec.width), D = Math.max(def.depth[0] * 0.8, spec.depth);
  const F = Math.round(Math.min(def.floors[1], Math.max(def.floors[0], spec.floors ?? r.int(def.floors[0], def.floors[1]))));
  const est = def.height[0] + (def.height[1] - def.height[0]) * ((F - def.floors[0]) / Math.max(1, def.floors[1] - def.floors[0]));
  const b = new B(world, L, r, est, inked);
  const prevSeed = world.seed;
  world.seed = seedOf(spec.seed);
  let h = 0;
  switch (spec.type) {
    case 'glass_tower': h = glassTower(b, W, D, F); break;
    case 'office_setback': h = officeSetback(b, W, D, F); break;
    case 'zakkyo_tower': h = zakkyoTower(b, W, D, F); break;
    case 'pachinko_hall': h = pachinkoHall(b, W, D, F); break;
    case 'machiya': h = machiya(b, W, D); break;
    case 'kanban_shop': h = kanbanShop(b, W, D, F); break;
    case 'kura': h = kura(b, W, D); break;
    case 'temple_gate': h = templeGate(b, W, D); break;
    case 'mixed_block': h = mixedBlock(b, W, D, F); break;
    case 'mansion': h = mansion(b, W, D, F); break;
    case 'konbini': h = konbini(b, W, D); break;
    case 'small_office': h = smallOffice(b, W, D, F); break;
    case 'warehouse': h = warehouse(b, W, D); break;
    case 'port_office': h = portOffice(b, W, D, F); break;
    case 'cold_storage': h = coldStorage(b, W, D); break;
    case 'house': h = house(b, W, D); break;
    case 'apaato': h = apaato(b, W, D); break;
    case 'farm_shed': h = farmShed(b, W, D); break;
    case 'workshop': h = workshop(b, W, D, F); break;
    case 'greenhouse': h = greenhouse(b, W, D); break;
  }
  world.seed = prevSeed;
  return { lights: b.lights, height: h };
}

/**
 * Skyline building for 300 m – 2 km: at most ~80 triangles, same painted layers, windows lit
 * per repeat at night. Local frame as for near buildings.
 */
export function buildFarBuilding(world: WorldGeom, L: (layer: string) => number, spec: FarSpec): void {
  const r = new Rng(spec.seed * 104729 + 17);
  const { width: W, depth: D, height: H, mood } = spec;
  const b = new B(world, L, r, H);
  const prevSeed = world.seed;
  world.seed = seedOf(spec.seed + 7);
  const roofF: FS = { layer: 'roof_flat', tile: [12, 12] };
  const shell = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, f: FS, top: FS | null = roofF) => {
    // 4 walls + top = 10 triangles; windows aligned to whole repeats
    const [tu, tv] = f.tile ?? [4, 4];
    const gg = (ya: number, yb: number) => ({ gBase: b.g(ya), gTop: b.g(yb) });
    const nu = (len: number) => Math.max(1, Math.round(len / tu));
    const v0 = y0 < 0 ? 0 : y0 / tv, v1 = y1 / tv;
    b.w.wall(x0, z1, x1, z1, y0, y1, b.mat(f), { uv: [0, v0, nu(x1 - x0), v1], ...gg(y0, y1) });
    b.w.wall(x1, z0, x0, z0, y0, y1, b.mat(f), { uv: [40, v0, 40 + nu(x1 - x0), v1], ...gg(y0, y1) });
    b.w.wall(x1, z1, x1, z0, y0, y1, b.mat(f), { uv: [80, v0, 80 + nu(z1 - z0), v1], ...gg(y0, y1) });
    b.w.wall(x0, z0, x0, z1, y0, y1, b.mat(f), { uv: [120, v0, 120 + nu(z1 - z0), v1], ...gg(y0, y1) });
    if (top) b.flat(x0, z0, x1, z1, y1, top);
  };
  const base: FS = { layer: 'fac_wall_plain', col: hexRGB(0x6a6878), tile: [8, 4] };
  if (mood === 'downtown' || mood === 'midtown') {
    const glassy = mood === 'downtown' && r.chance(0.6);
    const f: FS = glassy ? { layer: 'far_glass', col: r.pick<RGB>([[1, 1, 1], [0.9, 1, 1.1], [1.05, 0.95, 1.05]]), tile: TILE.farGlass } : { layer: r.chance(mood === 'midtown' ? 0.6 : 0.3) ? 'far_apart' : 'far_office', col: r.col([...PAL.wallLight, ...PAL.wallWarm, ...PAL.wallCool]), tile: TILE.farOffice };
    if (f.layer === 'far_apart') f.tile = TILE.farApart;
    shell(-W / 2, W / 2, -D, 0, -4, 0.01, base, null);
    const crown = mood === 'downtown' && H > 40 && r.chance(0.7);
    const mainH = crown ? H * r.range(0.78, 0.88) : H;
    shell(-W / 2, W / 2, -D, 0, 0, mainH, f);
    if (crown) {
      const ix = W * r.range(0.15, 0.25), iz = D * r.range(0.15, 0.25);
      shell(-W / 2 + ix, W / 2 - ix, -D + iz, -iz, mainH, H, f);
      if (r.chance(0.6)) { const mx = r.range(-W / 4, W / 4); b.trim(mx - 0.4, H, -D / 2 - 0.4, mx + 0.4, H + H * 0.12, -D / 2 + 0.4, hexRGB(0xd04040), { back: true, top: true }); b.at(mx, H + H * 0.12, -D / 2 + 0.41, 0, () => b.d(-0.6, 0, 0.6, 1.2, 0, 'roof_bits', swatch('red'))); }
    } else if (r.chance(0.5)) {
      const tw = Math.min(W * 0.35, 6), td = Math.min(D * 0.35, 5);
      const tx = r.range(-W / 2 + tw, W / 2 - tw);
      b.box(tx - tw / 2, H, -D / 2 - td / 2, tx + tw / 2, H + 3, -D / 2 + td / 2, { side: { layer: 'fac_wall_plain', col: hexRGB(0xd8d4cc), tile: [4, 4] }, top: { layer: null, col: hexRGB(0xc8c4bc) } });
    }
    if (r.chance(mood === 'downtown' ? 0.35 : 0.2) && W > 12) {
      // a lit rooftop billboard or neon panel (2 quads + 2 legs)
      const bw = Math.min(W * 0.7, 14);
      const [layer, half] = r.pick(BILL);
      b.d(-bw / 2, H + 1.5, bw / 2, H + 1.5 + bw / 2, -2, layer, billRect(half));
      b.at(0, 0, -2.3, Math.PI, () => b.q(-bw / 2, bw / 2, H + 1.5, H + 1.5 + bw / 2, 0, { layer: 'roof_bits' }, [0, 1 - 128 / 512, bw / 4, 1 - 64 / 512]));
    }
  } else if (mood === 'oldtown') {
    const f: FS = r.chance(0.6) ? { layer: 'fac_koshi', col: r.col(PAL.wood), tile: [1.82 * 2, Math.max(3, H * 0.55)] } : { layer: 'fac_mushiko', col: r.col(PAL.plaster), tile: [1.82 * 2, Math.max(2.3, H * 0.6)] };
    const yE = Math.max(3, H * 0.62);
    shell(-W / 2, W / 2, -D, 0, -4, yE, f, null);
    const roof: FS = { layer: 'roof_kawara', col: r.col([0xffffff, 0xd8dcf0, 0xb8bcd0]), tile: [3, 2.5] };
    const rise = H - yE;
    const zc = -D / 2;
    b.quad([[-W / 2 - 0.3, yE - 0.3, 0.6], [W / 2 + 0.3, yE - 0.3, 0.6], [W / 2 + 0.3, yE + rise, zc], [-W / 2 - 0.3, yE + rise, zc]], roof, [0, 0, W / 3, 0, W / 3, 2, 0, 2]);
    b.quad([[W / 2 + 0.3, yE - 0.3, -D - 0.6], [-W / 2 - 0.3, yE - 0.3, -D - 0.6], [-W / 2 - 0.3, yE + rise, zc], [W / 2 + 0.3, yE + rise, zc]], roof, [0, 0, W / 3, 0, W / 3, 2, 0, 2]);
    const pl: FS = { layer: 'fac_plaster', col: r.col(PAL.plaster), tile: [3, 3] };
    b.tri([W / 2, yE, 0], [W / 2, yE, -D], [W / 2, yE + rise, zc], pl, [0, 0, 1, 0, 0.5, 1]);
    b.tri([-W / 2, yE, -D], [-W / 2, yE, 0], [-W / 2, yE + rise, zc], pl, [0, 0, 1, 0, 0.5, 1]);
    if (r.chance(0.35)) { b.at(0, 0, 0.62, 0, () => { b.q(-W / 2, -W / 2 + Math.min(W, 6), yE - 1.6, yE - 0.4, 0, { layer: 'sign_lantern' }, [0, 0.76, 0.5, 1]); }); }
  } else if (mood === 'docks') {
    if (H > 30) {
      // crane silhouette: legs, portal, boom (~70 tris)
      const paint = r.pick<RGB>([hexRGB(0xd8302a), hexRGB(0x2a62c8), hexRGB(0xf4f4f0)]);
      const st: FS = { layer: 'roof_bits', col: paint };
      const leg = H * 0.5;
      for (const x of [-W / 3, W / 3]) for (const z of [-D * 0.25, -D * 0.75]) b.box(x - 0.8, 0, z - 0.8, x + 0.8, leg, z + 0.8, { side: { ...st, tile: [512, 1] }, top: null });
      b.box(-W / 3 - 1, leg, -D * 0.75 - 0.8, W / 3 + 1, leg + 2, -D * 0.25 + 0.8, { side: st, top: { layer: null, col: paint } });
      b.box(-W / 6, leg + 2, -D * 0.6, W / 6, leg + 6, -D * 0.4, { side: st, top: { layer: null, col: paint } });
      const by = leg + 6, tipY = H, tipZ = -D * 0.5 - (H - by) * 0.45;
      b.quad([[-1.5, by, -D * 0.5], [1.5, by, -D * 0.5], [1.5, tipY, tipZ], [-1.5, tipY, tipZ]], st, [0, 0.75, 4, 0.75, 4, 0.87, 0, 0.87]);
      b.quad([[1.5, by, -D * 0.5], [-1.5, by, -D * 0.5], [-1.5, tipY, tipZ], [1.5, tipY, tipZ]], st, [0, 0.75, 4, 0.75, 4, 0.87, 0, 0.87]);
      b.at(0, tipY, tipZ + 0.1, 0, () => b.d(-0.8, 0, 0.8, 1.6, 0, 'roof_bits', swatch('red')));
    } else if (r.chance(0.3)) {
      // stacked containers block
      const f: FS = { layer: 'dock_container', col: r.col(PAL.container, 0.1) };
      const rows = Math.max(1, Math.round(H / 2.6));
      for (let i = 0; i < Math.min(3, rows); i++) { const c = r.col(PAL.container, 0.1); b.box(-W / 2 + i * 0.3, i * (H / Math.min(3, rows)), -D, W / 2 - i * 0.2, (i + 1) * (H / Math.min(3, rows)), 0, { side: { ...f, col: c, tile: [12.2, 2.6 * 2] }, top: { layer: null, col: mulRGB(c, 0.9) } }); }
    } else {
      const f: FS = { layer: r.chance(0.6) ? 'fac_corrugated' : 'fac_sandwich', col: r.col(PAL.corrugated), tile: [6, Math.max(4, H)] };
      shell(-W / 2, W / 2, -D, 0, -4, H * 0.82, f, null);
      // a strip of lit clerestory windows
      b.bays(-W / 2, W / 2, H * 0.62, H * 0.72, 0.05, 'fac_whwin', 6, H * 0.1, H * 0.62);
      const roof: FS = { layer: 'roof_metal', col: r.col(PAL.rustRoof), tile: [6, 6] };
      const yE = H * 0.82, xc = 0;
      b.quad([[-W / 2 - 0.3, yE, 0.3], [-W / 2 - 0.3, yE, -D - 0.3], [xc, H, -D - 0.3], [xc, H, 0.3]], roof, [0, 0, 4, 0, 4, 2, 0, 2]);
      b.quad([[W / 2 + 0.3, yE, -D - 0.3], [W / 2 + 0.3, yE, 0.3], [xc, H, 0.3], [xc, H, -D - 0.3]], roof, [0, 0, 4, 0, 4, 2, 0, 2]);
      b.tri([-W / 2, yE, 0], [W / 2, yE, 0], [0, H, 0], f, [0, 0, 1, 0, 0.5, 0.3]);
      b.tri([W / 2, yE, -D], [-W / 2, yE, -D], [0, H, -D], f, [0, 0, 1, 0, 0.5, 0.3]);
    }
  } else if (mood === 'suburbs') {
    const f: FS = { layer: 'far_apart', col: r.col(PAL.siding), tile: [W / Math.max(1, Math.round(W / 3.6)), H * 0.36] };
    const yE = H * 0.72;
    shell(-W / 2, W / 2, -D, 0, -4, yE, f, null);
    const roof: FS = r.chance(0.5) ? { layer: 'roof_kawara', col: r.col(PAL.kawara), tile: [3, 2] } : { layer: 'roof_metal', col: r.col(PAL.metalRoof), tile: [3, 3] };
    const zc = -D / 2;
    b.quad([[-W / 2 - 0.4, yE - 0.2, 0.4], [W / 2 + 0.4, yE - 0.2, 0.4], [W / 2 + 0.4, H, zc], [-W / 2 - 0.4, H, zc]], roof, [0, 0, W / 3, 0, W / 3, 2, 0, 2]);
    b.quad([[W / 2 + 0.4, yE - 0.2, -D - 0.4], [-W / 2 - 0.4, yE - 0.2, -D - 0.4], [-W / 2 - 0.4, H, zc], [W / 2 + 0.4, H, zc]], roof, [0, 0, W / 3, 0, W / 3, 2, 0, 2]);
    b.tri([W / 2, yE, 0], [W / 2, yE, -D], [W / 2, H, zc], { layer: 'fac_siding', col: f.col, tile: [3, 3] }, [0, 0, 2, 0, 1, 1]);
    b.tri([-W / 2, yE, -D], [-W / 2, yE, 0], [-W / 2, H, zc], { layer: 'fac_siding', col: f.col, tile: [3, 3] }, [0, 0, 2, 0, 1, 1]);
  } else {
    // edge: sheds, barns and the odd lit greenhouse
    if (r.chance(0.3) && H < 5) {
      const film: FS = { layer: 'fac_whwin', col: WHITE };
      b.quad([[-W / 2, 0, 0], [0, H, 0], [0, H, -D], [-W / 2, 0, -D]], film, [0, 0.05, 0.6, 0.05, 0.6, D / 3, 0, D / 3]);
      b.quad([[0, H, 0], [W / 2, 0, 0], [W / 2, 0, -D], [0, H, -D]], film, [0.6, 0.05, 1.2, 0.05, 1.2, D / 3, 0.6, D / 3]);
      b.tri([-W / 2, 0, 0], [W / 2, 0, 0], [0, H, 0], film, [0, 0.1, 1, 0.1, 0.5, 0.9]);
      b.tri([W / 2, 0, -D], [-W / 2, 0, -D], [0, H, -D], film, [0, 0.1, 1, 0.1, 0.5, 0.9]);
    } else {
      const f: FS = { layer: 'fac_corrugated', col: r.col([0x8aa0b0, 0xb05a3a, 0x5a8a6a, 0xc8b8a0]), tile: [4, Math.max(3, H)] };
      const yE = H * 0.7;
      shell(-W / 2, W / 2, -D, 0, -4, yE, f, null);
      if (r.chance(0.5)) b.bays(-W / 4, W / 4, yE * 0.45, yE * 0.75, 0.05, 'far_office', W / 2, yE * 0.3, yE * 0.45);
      const roof: FS = { layer: 'roof_metal', col: r.col(PAL.rustRoof), tile: [4, 4] };
      const zc = -D / 2;
      b.quad([[-W / 2 - 0.3, yE - 0.1, 0.3], [W / 2 + 0.3, yE - 0.1, 0.3], [W / 2 + 0.3, H, zc], [-W / 2 - 0.3, H, zc]], roof, [0, 0, 2, 0, 2, 2, 0, 2]);
      b.quad([[W / 2 + 0.3, yE - 0.1, -D - 0.3], [-W / 2 - 0.3, yE - 0.1, -D - 0.3], [-W / 2 - 0.3, H, zc], [W / 2 + 0.3, H, zc]], roof, [0, 0, 2, 0, 2, 2, 0, 2]);
      b.tri([W / 2, yE, 0], [W / 2, yE, -D], [W / 2, H, zc], f, [0, 0, 2, 0, 1, 1]);
      b.tri([-W / 2, yE, -D], [-W / 2, yE, 0], [-W / 2, H, zc], f, [0, 0, 2, 0, 1, 1]);
    }
  }
  world.seed = prevSeed;
}

/** Picks a type for a mood by weight (helper for the world builder; deterministic from u ∈ [0,1)). */
export function pickBuildingType(mood: Mood, u: number): BuildingTypeDef {
  const list = BUILDING_TYPES.filter((t) => (t.weight[mood] ?? 0) > 0);
  let s = 0; for (const t of list) s += t.weight[mood]!;
  let x = u * s;
  for (const t of list) { x -= t.weight[mood]!; if (x <= 0) return t; }
  return list[list.length - 1];
}
