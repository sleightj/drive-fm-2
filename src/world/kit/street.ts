import { Matrix4, Vector3 } from 'three';
import { WorldGeom, InkedGeom } from './geom';
import { PS } from './propStyle';
import type { Mood } from '../moods';
import { PLACES, Place } from '../places';
import { Rng, hash32 } from '../../core/rng';

/**
 * The street kit: roadside edges (fences, walls, rails, verges), street furniture, trees, road
 * signs, the overhead guide sign, car parks and empty lots, utility wires and the road-mark table.
 *
 * Frames
 *  - Props: local frame, metres, origin on the ground at the piece's foot, street side +Z.
 *    Road SIGNS (sign_*, chevron_*) face +Z: yaw them so +Z points at the oncoming driver.
 *  - Edges: world (chunk) coordinates straight from the polyline you pass.
 *  - Guide sign: origin on the road centre at ground level, the gantry spans X, faces +Z (the
 *    driver approaches from +Z travelling toward -Z).
 *  - Car park / empty lot: x ∈ [-w/2, w/2], z ∈ [-d, 0], street front on z = 0.
 * Textures are painted by assets-src/textures/painters/20_street.mjs, 22_roadmarks.mjs and
 * 24_roadsigns.mjs; the atlas rectangles below must match the painters.
 */

export type LayerFn = (name: string) => number;
export type RGB = [number, number, number];
export interface Light { x: number; y: number; z: number; r: number; g: number; b: number; radius: number }
export interface Anchor { x: number; y: number; z: number }
export interface PropResult { lights: Light[]; wireAnchors?: Anchor[] }
export interface EdgePoint { x: number; y: number; z: number; nx: number; nz: number }
export type EdgeType = 'guardrail' | 'chainlink' | 'hoarding' | 'woodfence' | 'blockwall' | 'verge' | 'railing';
export const EDGE_TYPES: EdgeType[] = ['guardrail', 'chainlink', 'hoarding', 'woodfence', 'blockwall', 'verge', 'railing'];
/** [u0, vBottom, u1, vTop] */
export type UV4 = [number, number, number, number];

// ───────────────────────────────────── atlas tables ─────────────────────────────────────

const PX = 512;
/** Pixel rect (x, y, w, h; y down, as painted) → [u0, vBottom, u1, vTop] (the loader flips layers). */
export function rectUV(r: readonly number[]): UV4 {
  return [r[0] / PX, 1 - (r[1] + r[3]) / PX, (r[0] + r[2]) / PX, 1 - r[1] / PX];
}

type R4 = readonly [number, number, number, number];
/** Fixed cells (match PROPS_A / PROPS_B / docks / cards in 20_street.mjs). */
export const ATLAS = {
  st_props_a: {
    vend_red: [0, 0, 128, 232], vend_blue: [128, 0, 128, 232], vend_coffee: [256, 0, 128, 232], phone: [384, 0, 128, 232],
    bus_disc: [0, 232, 128, 128], timetable: [128, 232, 64, 128], postbox: [192, 232, 64, 128], coinp_sign: [256, 232, 128, 128], coinp_board: [384, 232, 128, 128],
    payment: [0, 360, 64, 128], lens_warm: [64, 360, 64, 64], lens_red: [64, 424, 32, 32], lens_amber: [96, 424, 32, 32],
    ped_red: [128, 360, 64, 128], ped_green: [192, 360, 64, 128], mirror: [256, 360, 128, 128], forsale: [384, 360, 128, 96],
    hydrant: [384, 456, 64, 56], button: [448, 456, 64, 56], lens_cool: [64, 456, 32, 32], lens_white: [96, 456, 32, 32],
    recycle: [0, 488, 64, 24], grey: [64, 488, 64, 24],
  },
  st_props_b: {
    ad_soda: [0, 0, 128, 224], ad_radio: [128, 0, 128, 224], pole_ad_dent: [256, 0, 64, 224], pole_ad_clinic: [320, 0, 64, 224],
    garbage_sign: [384, 0, 128, 96], cone: [384, 96, 64, 128], addr: [448, 96, 64, 32], shrine_paper: [448, 128, 64, 96],
    phone_top: [0, 224, 128, 32], garbage_net: [128, 224, 128, 128], chochin: [256, 224, 64, 96], lantern_win: [320, 224, 64, 64],
    shed_window: [384, 224, 64, 64], shed_door: [448, 224, 64, 128], cabinet: [320, 288, 64, 96], barrier_lamp: [384, 288, 64, 32],
    wood: [0, 256, 128, 64], stone: [0, 320, 128, 64], board_back: [128, 352, 128, 32], pole_band: [256, 320, 64, 64],
    transformer: [0, 384, 128, 128], ad_shelter_roof: [128, 384, 128, 32], bench_seat: [128, 416, 128, 32], works_light: [256, 384, 64, 64],
    rope: [320, 384, 192, 16], rubber: [320, 400, 192, 16], bike_basket: [320, 416, 96, 48], bike_wheel: [416, 416, 96, 96], tarp: [128, 448, 128, 64], plant_pot: [256, 448, 64, 64], sake_crate: [320, 464, 96, 48],
  },
  st_docks: {
    door0: [0, 0, 128, 256], door1: [128, 0, 128, 256], door2: [256, 0, 128, 256], door3: [384, 0, 128, 256],
    cab: [0, 256, 128, 128], tyre: [128, 256, 128, 128], drum: [256, 256, 128, 128], pallet: [384, 256, 128, 64], bollard: [384, 320, 128, 64],
    keepout: [0, 384, 128, 128], terminal: [128, 384, 384, 128],
  },
  st_cards: { leaf: [0, 0, 256, 256], blossom: [256, 0, 256, 256], pine: [0, 256, 256, 256], grass: [256, 256, 256, 256] },
  gs_board: { yarrow: [0, 0, 256, 256], shield: [256, 0, 128, 128], arrow_l: [256, 128, 128, 128], arrow_r: [384, 128, 128, 128], frame: [0, 256, 256, 256], back: [256, 256, 256, 256] },
} as const satisfies Record<string, Record<string, R4>>;

/** Bands: tile along u every `len` metres, fixed v range covering `ht` metres of height. */
export interface Band { layer: string; y: number; h: number; len: number; ht: number }
export const BANDS = {
  hoard_sea: { layer: 'st_hoarding_a', y: 0, h: 256, len: 6, ht: 3 },
  hoard_slogan: { layer: 'st_hoarding_a', y: 256, h: 256, len: 6, ht: 3 },
  hoard_kids: { layer: 'st_hoarding_b', y: 0, h: 256, len: 6, ht: 3 },
  hoard_graffiti: { layer: 'st_hoarding_b', y: 256, h: 256, len: 6, ht: 3 },
  block: { layer: 'st_walls', y: 0, h: 256, len: 3.2, ht: 1.6 },
  block_graf: { layer: 'st_walls', y: 256, h: 256, len: 3.2, ht: 1.6 },
  yakisugi: { layer: 'st_fences', y: 0, h: 144, len: 2, ht: 1.8 },
  louver: { layer: 'st_fences', y: 144, h: 112, len: 2, ht: 1.2 },
  breeze: { layer: 'st_fences', y: 256, h: 64, len: 1.6, ht: 0.4 },
  railpanel: { layer: 'st_fences', y: 320, h: 96, len: 2, ht: 1.0 },
  bamboo: { layer: 'st_fences', y: 416, h: 96, len: 2, ht: 1.2 },
  corrugated: { layer: 'st_metal', y: 0, h: 128, len: 4, ht: 2.4 },
  girder: { layer: 'st_metal', y: 128, h: 128, len: 4, ht: 2 },
  hazard: { layer: 'st_metal', y: 256, h: 64, len: 2, ht: 0.5 },
  plate: { layer: 'st_metal', y: 320, h: 64, len: 2, ht: 0.5 },
  shutter: { layer: 'st_metal', y: 384, h: 128, len: 4, ht: 2.4 },
  cont0: { layer: 'st_containers', y: 0, h: 128, len: 12.2, ht: 2.6 },
  cont1: { layer: 'st_containers', y: 128, h: 128, len: 12.2, ht: 2.6 },
  cont2: { layer: 'st_containers', y: 256, h: 128, len: 12.2, ht: 2.6 },
  cont3: { layer: 'st_containers', y: 384, h: 128, len: 12.2, ht: 2.6 },
} as const satisfies Record<string, Band>;

/** Strips: tile along v every `len` metres (the run direction), fixed u range `width` metres wide. */
export interface Strip { layer: string; x: number; w: number; width: number; len: number }
export const STRIPS = {
  tactile_line: { layer: 'st_strips', x: 0, w: 96, width: 0.3, len: 1.2 },
  tactile_dot: { layer: 'st_strips', x: 96, w: 96, width: 0.3, len: 1.2 },
  kerb: { layer: 'st_strips', x: 192, w: 64, width: 0.2, len: 2 },
  gutter: { layer: 'st_strips', x: 256, w: 128, width: 0.4, len: 2 },
  guardrail: { layer: 'st_strips', x: 384, w: 96, width: 0.35, len: 4 },
  line: { layer: 'st_strips', x: 480, w: 32, width: 0.15, len: 2 },
} as const satisfies Record<string, Strip>;
/** Texels skipped at each side of a strip column so filtering and the first mips do not pull in the neighbouring column. */
const STRIP_INSET = 2;
/** u range of a strip column (inset by STRIP_INSET px each side). */
export function stripU(s: Strip): [number, number] { return [(s.x + STRIP_INSET) / PX, (s.x + s.w - STRIP_INSET) / PX]; }

/** Tileable surfaces with their size in metres per repeat. */
export const SURFACES = {
  pave_grey: { layer: 'st_pave_grey', tile: 2.4 },
  pave_brick: { layer: 'st_pave_brick', tile: 1.6 },
  pave_stone: { layer: 'st_pave_stone', tile: 3.2 },
  concrete: { layer: 'st_concrete', tile: 3 },
  grass: { layer: 'st_grass', tile: 4 },
  scrub: { layer: 'st_scrub', tile: 6 },
  earth: { layer: 'st_earth', tile: 5 },
  gravel: { layer: 'st_gravel', tile: 3 },
  dock: { layer: 'st_dock', tile: 8 },
  asphalt: { layer: 'st_asphalt', tile: 6 },
  chainlink: { layer: 'st_chainlink', tile: 1.2 },
  leaves: { layer: 'st_leaves', tile: 2.2 },
  blossom: { layer: 'st_blossom', tile: 2.2 },
  pine: { layer: 'st_pine', tile: 1.8 },
  bark: { layer: 'st_bark', tile: 1.4 },
} as const;

/** Terrain ground per mood (tile size in SURFACES / GROUND_TILES). */
export const GROUND_LAYERS: Record<Mood, string> = {
  downtown: 'st_pave_grey', oldtown: 'st_earth', midtown: 'st_concrete', docks: 'st_dock', suburbs: 'st_grass', edge: 'st_scrub',
};
export const GROUND_TILES: Record<Mood, number> = { downtown: 2.4, oldtown: 5, midtown: 3, docks: 8, suburbs: 4, edge: 6 };
/** Suggested sidewalk paving per mood (sidewalks are built by the road builder). */
export const SIDEWALK_LAYERS: Record<Mood, string> = {
  downtown: 'st_pave_brick', oldtown: 'st_pave_stone', midtown: 'st_pave_grey', docks: 'st_concrete', suburbs: 'st_concrete', edge: 'st_concrete',
};

/**
 * Painted road marks. width = across the lane, length = along it (metres, real size). uv =
 * [u0, v0, u1, v1] inside `layer`: v0 is the NEAR end, v1 the FAR end (direction of travel); u0 is
 * the driver's left. Japanese text reads far → near, so map v1 to the far end and it reads right.
 */
export interface RoadMark { layer: string; width: number; length: number; uv: UV4 }
const RM: Record<string, [string, R4, number, number]> = {
  tomare: ['rm_text_a', [0, 0, 170, 512], 1.5, 8.1],
  jokou: ['rm_text_a', [171, 0, 170, 512], 1.5, 5.3],
  bus: ['rm_text_a', [342, 0, 170, 512], 1.5, 5.3],
  school_zone: ['rm_text_b', [0, 0, 170, 512], 1.5, 19.3],
  slow_down: ['rm_text_b', [171, 0, 170, 512], 1.5, 13.7],
  bus_only: ['rm_text_b', [342, 0, 170, 512], 1.5, 10.9],
  speed_30: ['rm_speed', [0, 0, 256, 256], 1.4, 3.0],
  speed_40: ['rm_speed', [256, 0, 256, 256], 1.4, 3.0],
  speed_50: ['rm_speed', [0, 256, 256, 256], 1.4, 3.0],
  speed_60: ['rm_speed', [256, 256, 256, 256], 1.4, 3.0],
  arrow_straight: ['rm_arrows', [0, 0, 170, 256], 0.9, 5.0],
  arrow_left: ['rm_arrows', [171, 0, 170, 256], 1.3, 5.0],
  arrow_right: ['rm_arrows', [342, 0, 170, 256], 1.3, 5.0],
  arrow_straight_left: ['rm_arrows', [0, 256, 170, 256], 1.6, 5.0],
  arrow_straight_right: ['rm_arrows', [171, 256, 170, 256], 1.6, 5.0],
  arrow_left_right: ['rm_arrows', [342, 256, 170, 256], 2.2, 5.0],
  diamond: ['rm_symbols', [0, 0, 256, 256], 1.5, 4.0],
  bicycle: ['rm_symbols', [256, 0, 256, 256], 0.9, 1.8],
  zone30: ['rm_symbols', [0, 256, 256, 256], 2.0, 6.0],
  crosswalk_bar: ['rm_symbols', [256, 256, 256, 256], 0.45, 4.0],
};
export const ROAD_MARKS: Record<string, RoadMark> = Object.fromEntries(
  Object.entries(RM).map(([k, [layer, r, width, length]]) => [k, { layer, width, length, uv: rectUV(r) }]),
);

/**
 * Writes a road mark as a flat quad on y = `y`, centred on the origin of the current transform,
 * far end toward +Z (direction of travel), driver's left toward +X.
 */
export function buildRoadMark(world: WorldGeom, L: LayerFn, name: string, y = 0.01) {
  const m = ROAD_MARKS[name];
  if (!m) throw new Error('unknown road mark ' + name);
  const hw = m.width / 2, hl = m.length / 2;
  // near-left, near-right, far-right, far-left (driver's right is -X)
  quad(world, [hw, y, -hl], [-hw, y, -hl], [-hw, y, hl], [hw, y, hl], m.uv, L(m.layer), undefined, -1, -1);
}

/** Road-sign faces: layer + cell (170 px) in the 3×3 grids of 24_roadsigns.mjs. */
const SC = (c: number, r: number): R4 => [c * 171, r * 171, 170, 170];
export const SIGN_CELLS: Record<string, { layer: string; cell: R4 }> = {
  stop: { layer: 'rs_a', cell: SC(0, 0) }, slow: { layer: 'rs_a', cell: SC(1, 0) }, noparking: { layer: 'rs_a', cell: SC(2, 0) },
  nostopping: { layer: 'rs_a', cell: SC(0, 1) }, noentry: { layer: 'rs_a', cell: SC(1, 1) }, oneway: { layer: 'rs_a', cell: SC(2, 1) },
  speed30: { layer: 'rs_a', cell: SC(0, 2) }, speed40: { layer: 'rs_a', cell: SC(1, 2) }, speed50: { layer: 'rs_a', cell: SC(2, 2) },
  speed60: { layer: 'rs_b', cell: SC(0, 0) }, curve_r: { layer: 'rs_b', cell: SC(1, 0) }, curve_l: { layer: 'rs_b', cell: SC(2, 0) },
  hairpin_r: { layer: 'rs_b', cell: SC(0, 1) }, hairpin_l: { layer: 'rs_b', cell: SC(1, 1) }, roadworks: { layer: 'rs_b', cell: SC(2, 1) },
  crossing: { layer: 'rs_b', cell: SC(0, 2) }, children: { layer: 'rs_b', cell: SC(1, 2) }, signal: { layer: 'rs_b', cell: SC(2, 2) },
  chevron_l: { layer: 'rs_c', cell: SC(0, 0) }, chevron_r: { layer: 'rs_c', cell: SC(1, 0) }, chevron_l_y: { layer: 'rs_c', cell: SC(2, 0) },
  chevron_r_y: { layer: 'rs_c', cell: SC(0, 1) }, plate_kyu: { layer: 'rs_c', cell: SC(1, 1) }, plate_kono: { layer: 'rs_c', cell: SC(2, 1) },
  works: { layer: 'rs_c', cell: SC(0, 2) }, back: { layer: 'rs_c', cell: SC(1, 2) }, plate_hairpin: { layer: 'rs_c', cell: SC(2, 2) },
};

/** Guide plate for a place: layer + row (3 plates of 3.2 × 1.6 m per layer, in PLACES order). */
export function guidePlate(p: Place): { layer: string; uv: UV4 } {
  let i = PLACES.findIndex((q) => q.jp === p.jp);
  if (i < 0) i = 0;
  return { layer: `gs_plates_${Math.floor(i / 3)}`, uv: rectUV([0, (i % 3) * 171, 512, 170]) };
}

// ───────────────────────────────────── world helpers ─────────────────────────────────────

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _v = new Vector3(), _n = new Vector3();
type P3 = readonly [number, number, number] | number[];

/** Quad a→b→c→d (counter-clockwise from the front); a,b bottom (u0→u1 at v0), c,d top. */
function quad(w: WorldGeom, a: P3, b: P3, c: P3, d: P3, uv: UV4, layer: number, tint?: RGB, g0 = -1, g1 = -1) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]); _c.set(c[0], c[1], c[2]); _d.set(d[0], d[1], d[2]);
  w.quadUV(_a, _b, _c, _d, [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], { layer, color: tint }, g0, g1);
}
/** Same as quad but with an explicit normal shared by all four corners. */
function quadN(w: WorldGeom, a: P3, b: P3, c: P3, d: P3, n: P3, uv: UV4, layer: number, tint: RGB = [1, 1, 1], g0 = -1, g1 = -1) {
  const P = [a, b, c, a, c, d];
  const U = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
  const G = [g0, g0, g1, g0, g1, g1];
  for (let i = 0; i < 6; i++) w.vert(P[i][0], P[i][1], P[i][2], n[0], n[1], n[2], U[i][0], U[i][1], layer, tint[0], tint[1], tint[2], G[i]);
}
/** Double-sided card (two quads, both lit with normal n). */
function card(w: WorldGeom, a: P3, b: P3, c: P3, d: P3, n: P3, uv: UV4, layer: number, tint?: RGB, g0 = -1, g1 = -1) {
  quadN(w, a, b, c, d, n, uv, layer, tint, g0, g1);
  quadN(w, b, a, d, c, n, [uv[2], uv[1], uv[0], uv[3]], layer, tint, g0, g1);
}

/** Surface spec for boxes and cylinders. */
interface Face { l: number; uv?: UV4; tile?: [number, number]; band?: Band; tint?: RGB; g?: [number, number]; u0?: number }
interface BoxFaces { px?: Face | null; nx?: Face | null; pz?: Face | null; nz?: Face | null; top?: Face | null; bot?: Face | null; all?: Face }

function bandV(bd: Band, h0: number, h1: number): [number, number] {
  const vb = 1 - (bd.y + bd.h) / PX, vt = 1 - bd.y / PX;
  return [vb + (vt - vb) * (h0 / bd.ht), vb + (vt - vb) * (h1 / bd.ht)];
}
function faceUV(f: Face, width: number, y0: number, y1: number, uOff = 0): UV4 {
  if (f.uv) return f.uv;
  if (f.band) { const [v0, v1] = bandV(f.band, 0, Math.min(f.band.ht, y1 - y0)); const u = (f.u0 ?? 0) + uOff / f.band.len; return [u, v0, u + width / f.band.len, v1]; }
  const [tu, tv] = f.tile ?? [2, 2];
  const u = (f.u0 ?? 0) + uOff / tu;
  return [u, y0 / tv, u + width / tu, y1 / tv];
}
/** A representative uv rect inside a face's own texture region (for caps and small patches). */
function faceRect(f: Face): UV4 {
  if (f.uv) return f.uv;
  if (f.band) { const [v0, v1] = bandV(f.band, 0, f.band.ht); return [0, v0 + (v1 - v0) * 0.1, 0.2, v1 - (v1 - v0) * 0.1]; }
  const [tu, tv] = f.tile ?? [2, 2];
  return [0, 0, 0.5 / tu, 0.5 / tv];
}
function boxW(w: WorldGeom, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: BoxFaces, g: [number, number] = [0.35, 1]) {
  const F = (k: keyof BoxFaces): Face | undefined => (f[k] === null ? undefined : (f[k] as Face | undefined) ?? f.all);
  const gg = (m: Face) => m.g ?? g;
  let m = F('pz'); if (m) quad(w, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], faceUV(m, x1 - x0, y0, y1), m.l, m.tint, ...gg(m));
  m = F('nz'); if (m) quad(w, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], faceUV(m, x1 - x0, y0, y1), m.l, m.tint, ...gg(m));
  m = F('px'); if (m) quad(w, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], faceUV(m, z1 - z0, y0, y1), m.l, m.tint, ...gg(m));
  m = F('nx'); if (m) quad(w, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], faceUV(m, z1 - z0, y0, y1), m.l, m.tint, ...gg(m));
  m = F('top');
  if (m) {
    const [tu, tv] = m.tile ?? [2, 2];
    const uv: UV4 = m.uv ?? (m.band ? faceUV(m, x1 - x0, 0, Math.min(m.band.ht, z1 - z0)) : [x0 / tu, -z1 / tv, x1 / tu, -z0 / tv]);
    quad(w, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uv, m.l, m.tint, -1, -1);
  }
  m = f.bot ?? undefined;
  if (m) quad(w, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], m.uv ?? [0, 0, 1, 1], m.l, m.tint, -1, -1);
}
/** Vertical (optionally tapered) cylinder with smooth sides; u wraps the face rect / tile around. */
function cylW(w: WorldGeom, x: number, z: number, y0: number, y1: number, r0: number, r1: number, seg: number, f: Face, cap: Face | null = null, g: [number, number] = [0.35, 1]) {
  const tint = f.tint ?? [1, 1, 1];
  const circ = Math.PI * 2 * Math.max(r0, r1);
  let u0: number, u1: number, v0: number, v1: number;
  if (f.uv) [u0, v0, u1, v1] = f.uv;
  else if (f.band) { [v0, v1] = bandV(f.band, 0, Math.min(f.band.ht, y1 - y0)); u0 = 0; u1 = circ / f.band.len; }
  else { const [tu, tv] = f.tile ?? [2, 2]; u0 = 0; u1 = circ / tu; v0 = y0 / tv; v1 = y1 / tv; }
  const [g0, g1] = f.g ?? g;
  const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const ua = u0 + ((u1 - u0) * i) / seg, ub = u0 + ((u1 - u0) * (i + 1)) / seg;
    const n0 = _n.set(c0, slope, s0).normalize().toArray(), n1 = _v.set(c1, slope, s1).normalize().toArray();
    const P: [number, number, number, number[], number, number, number][] = [
      [x + c0 * r0, y0, z + s0 * r0, n0, ua, v0, g0], [x + c1 * r1, y1, z + s1 * r1, n1, ub, v1, g1], [x + c1 * r0, y0, z + s1 * r0, n1, ub, v0, g0],
      [x + c0 * r0, y0, z + s0 * r0, n0, ua, v0, g0], [x + c0 * r1, y1, z + s0 * r1, n0, ua, v1, g1], [x + c1 * r1, y1, z + s1 * r1, n1, ub, v1, g1],
    ];
    for (const p of P) w.vert(p[0], p[1], p[2], p[3][0], p[3][1], p[3][2], p[4], p[5], f.l, tint[0], tint[1], tint[2], p[6]);
    if (cap && r1 > 0) {
      const ct = cap.tint ?? [1, 1, 1];
      const cu = faceRect(cap);
      const mu = (cu[0] + cu[2]) / 2, mv = (cu[1] + cu[3]) / 2, hu = (cu[2] - cu[0]) / 2, hv = (cu[3] - cu[1]) / 2;
      w.vert(x, y1, z, 0, 1, 0, mu, mv, cap.l, ct[0], ct[1], ct[2], -1);
      w.vert(x + c1 * r1, y1, z + s1 * r1, 0, 1, 0, mu + c1 * hu, mv - s1 * hv, cap.l, ct[0], ct[1], ct[2], -1);
      w.vert(x + c0 * r1, y1, z + s0 * r1, 0, 1, 0, mu + c0 * hu, mv - s0 * hv, cap.l, ct[0], ct[1], ct[2], -1);
    }
  }
}
/** Tube along a polyline of [x, y, z, r] (painted), u around, v along. */
function tubeW(w: WorldGeom, path: number[][], seg: number, f: Face, capEnd = false, g: [number, number] = [0.3, 1]) {
  const tint = f.tint ?? [1, 1, 1];
  const [tu, tv] = f.tile ?? [1, 1];
  const rings: { p: Vector3; n: Vector3[]; r: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i < path.length; i++) {
    const p = new Vector3(path[i][0], path[i][1], path[i][2]);
    const prev = new Vector3(...(path[Math.max(0, i - 1)] as [number, number, number]));
    const next = new Vector3(...(path[Math.min(path.length - 1, i + 1)] as [number, number, number]));
    const t = next.sub(prev).normalize();
    if (i > 0) s += p.distanceTo(new Vector3(path[i - 1][0], path[i - 1][1], path[i - 1][2]));
    const ref = Math.abs(t.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const a = new Vector3().crossVectors(t, ref).normalize(), b = new Vector3().crossVectors(t, a).normalize();
    const ns: Vector3[] = [];
    for (let j = 0; j <= seg; j++) { const ang = (j / seg) * Math.PI * 2; ns.push(a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang))); }
    rings.push({ p, n: ns, r: path[i][3], s });
  }
  const total = s || 1;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    const gA = g[0] + (g[1] - g[0]) * (A.s / total), gB = g[0] + (g[1] - g[0]) * (B.s / total);
    for (let j = 0; j < seg; j++) {
      const circ = 2 * Math.PI * A.r;
      const corner = (R: typeof A, k: number, gg: number) => {
        const n = R.n[k];
        let u: number, v: number;
        if (f.band) { const [v0, v1] = bandV(f.band, 0, Math.min(f.band.ht, circ)); u = R.s / f.band.len; v = v0 + (v1 - v0) * (k / seg); }
        else if (f.uv) { u = f.uv[0] + (f.uv[2] - f.uv[0]) * (k / seg); v = f.uv[1] + (f.uv[3] - f.uv[1]) * (R.s / total); }
        else { u = (k / seg) * circ / tu; v = R.s / tv; }
        w.vert(R.p.x + n.x * R.r, R.p.y + n.y * R.r, R.p.z + n.z * R.r, n.x, n.y, n.z, u, v, f.l, tint[0], tint[1], tint[2], gg);
      };
      // outward winding: A_j, B_j, B_j+1 / A_j, B_j+1, A_j+1 (checked against the ring orientation)
      corner(A, j, gA); corner(A, j + 1, gA); corner(B, j + 1, gB);
      corner(A, j, gA); corner(B, j + 1, gB); corner(B, j, gB);
    }
  }
  if (capEnd) {
    const E = rings[rings.length - 1];
    const t = E.n[0].clone().cross(E.n[Math.round(seg / 4)]).normalize();
    const fr = faceRect(f), cu = (fr[0] + fr[2]) / 2, cv = (fr[1] + fr[3]) / 2;
    for (let j = 0; j < seg; j++) {
      const n0 = E.n[j], n1 = E.n[j + 1];
      w.vert(E.p.x, E.p.y, E.p.z, t.x, t.y, t.z, cu, cv, f.l, tint[0], tint[1], tint[2], g[1]);
      w.vert(E.p.x + n0.x * E.r, E.p.y + n0.y * E.r, E.p.z + n0.z * E.r, t.x, t.y, t.z, cu, cv, f.l, tint[0], tint[1], tint[2], g[1]);
      w.vert(E.p.x + n1.x * E.r, E.p.y + n1.y * E.r, E.p.z + n1.z * E.r, t.x, t.y, t.z, cu, cv, f.l, tint[0], tint[1], tint[2], g[1]);
    }
  }
}

/**
 * Lumpy ellipsoid (tree canopies, shrubs). Box-projected UVs per triangle, smooth normals, the
 * painted gradient dark at the bottom → light at the top.
 */
function blob(w: WorldGeom, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, f: Face, rng: Rng, o: { lat?: number; lon?: number; jitter?: number; flat?: number; g?: [number, number] } = {}) {
  const lat = o.lat ?? 5, lon = o.lon ?? 8, jit = o.jitter ?? 0.12, flat = o.flat ?? 0;
  const [g0, g1] = o.g ?? f.g ?? [0.1, 1];
  const tint = f.tint ?? [1, 1, 1];
  const t = f.tile?.[0] ?? 2.2;
  // band / rect faces: keep every texel inside the face's own region of the sheet
  const fr = f.band || f.uv ? faceRect(f) : null;
  const ou = rng.next() * 10, ov = rng.next() * 10;
  const V: { p: number[]; n: number[]; g: number }[][] = [];
  const twist = rng.next() * 6;
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI;
    const ring: { p: number[]; n: number[]; g: number }[] = [];
    const cnt = i === 0 || i === lat ? 1 : lon;
    for (let j = 0; j < cnt; j++) {
      const ph = (j / lon) * Math.PI * 2 + i * 0.35 + twist;
      const k = i === 0 || i === lat ? 1 : 1 + (rng.next() - 0.5) * 2 * jit;
      const sy = -Math.cos(th), sr = Math.sin(th);
      let y = sy * ry * k;
      if (flat > 0 && y < 0) y *= 1 - flat;
      const p = [cx + Math.cos(ph) * sr * rx * k, cy + y, cz + Math.sin(ph) * sr * rz * k];
      const n = _n.set((Math.cos(ph) * sr) / rx, sy / ry, (Math.sin(ph) * sr) / rz).normalize().toArray();
      ring.push({ p, n, g: g0 + (g1 - g0) * (i / lat) });
    }
    V.push(ring);
  }
  const at = (i: number, j: number) => V[i][V[i].length === 1 ? 0 : ((j % lon) + lon) % lon];
  // wrapped (cylindrical) mapping: u around with a whole number of repeats so the seam tiles,
  // v down the meridian; continuous everywhere except the poles (texture is an isotropic clump pattern)
  const nu = Math.max(1, Math.round((Math.PI * (rx + rz)) / t)), nv = Math.max(1, Math.round((Math.PI * ry) / t));
  const UV = (i: number, j: number): [number, number] => {
    // poles take the mid-u of the fan triangle so they don't smear across the whole repeat
    if (fr) {
      const uu = ((j / lon) + (i * 0.35 + twist) / (Math.PI * 2)) * nu, vv = (i / lat) * nv;
      return [fr[0] + (fr[2] - fr[0]) * (0.5 + 0.45 * Math.sin(uu * 2.1 + ou)), fr[1] + (fr[3] - fr[1]) * (0.5 + 0.45 * Math.sin(vv * 2.3 + ov))];
    }
    // u follows the ring's real angle (rings are twisted) so the pattern doesn't shear into streaks
    return [((j / lon) + (i * 0.35 + twist) / (Math.PI * 2)) * nu + ou, (i / lat) * nv + ov];
  };
  const tri = (P: [number, number][]) => {
    for (const [i, j] of P) {
      const Q = at(i, j);
      let jj = j;
      if (i === 0 || i === lat) jj = P.filter(([a]) => a !== i).reduce((acc, [, b]) => acc + b, 0) / 2; // pole: centre of the fan edge
      const [u, v] = UV(i, jj);
      w.vert(Q.p[0], Q.p[1], Q.p[2], Q.n[0], Q.n[1], Q.n[2], u, v, f.l, tint[0], tint[1], tint[2], Q.g);
    }
  };
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    if (i !== 0) tri([[i, j], [i + 1, j + 1], [i, j + 1]]);
    if (i !== lat - 1) tri([[i, j], [i + 1, j], [i + 1, j + 1]]);
  }
}

/** Flat polygon facing +Z at depth z (sign faces): pts in metres around (cx, cy); uv maps the cell. */
function facePoly(w: WorldGeom, pts: number[][], cx: number, cy: number, z: number, cell: R4, cellM: number, layer: number, tint?: RGB) {
  const ppm = cell[2] / cellM;
  const ccx = cell[0] + cell[2] / 2, ccy = cell[1] + cell[3] / 2;
  const uv = (p: number[]) => [(ccx + p[0] * ppm) / PX, 1 - (ccy - p[1] * ppm) / PX];
  const T = tint ?? [1, 1, 1];
  for (let i = 1; i < pts.length - 1; i++) {
    for (const p of [pts[0], pts[i], pts[i + 1]]) {
      const [u, v] = uv(p);
      w.vert(cx + p[0], cy + p[1], z, 0, 0, 1, u, v, layer, T[0], T[1], T[2], -1);
    }
  }
}

// ───────────────────────────────────── inked helpers ─────────────────────────────────────

/** Extrudes a convex polygon (XY, counter-clockwise) along Z from z0 to z1 (inked). */
function iprism(ink: InkedGeom, pts: number[][], cx: number, cy: number, z0: number, z1: number, slot: number) {
  const n = pts.length;
  const V = (p: number[], z: number) => new Vector3(cx + p[0], cy + p[1], z);
  for (let i = 1; i < n - 1; i++) {
    ink.tri(V(pts[0], z1), V(pts[i], z1), V(pts[i + 1], z1), slot);
    ink.tri(V(pts[0], z0), V(pts[i + 1], z0), V(pts[i], z0), slot);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    ink.tri(V(a, z0), V(b, z0), V(b, z1), slot);
    ink.tri(V(a, z0), V(b, z1), V(a, z1), slot);
  }
}
/** Inked tube between two points (closed). */
function itube(ink: InkedGeom, a: P3, b: P3, r: number, seg: number, slot: number, r1 = r) {
  const A = new Vector3(a[0], a[1], a[2]), B = new Vector3(b[0], b[1], b[2]);
  const t = B.clone().sub(A).normalize();
  const ref = Math.abs(t.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(t, ref).normalize(), v = new Vector3().crossVectors(t, u).normalize();
  const ring = (C: Vector3, rr: number) => Array.from({ length: seg }, (_, j) => { const ang = (j / seg) * Math.PI * 2; return C.clone().addScaledVector(u, Math.cos(ang) * rr).addScaledVector(v, Math.sin(ang) * rr); });
  const RA = ring(A, r), RB = ring(B, r1);
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg;
    const nA = RA[j].clone().sub(A).normalize(), nB = RA[k].clone().sub(A).normalize();
    // smooth sides
    ink.vert(RA[j].x, RA[j].y, RA[j].z, nA.x, nA.y, nA.z, slot); ink.vert(RB[k].x, RB[k].y, RB[k].z, nB.x, nB.y, nB.z, slot); ink.vert(RB[j].x, RB[j].y, RB[j].z, nA.x, nA.y, nA.z, slot);
    ink.vert(RA[j].x, RA[j].y, RA[j].z, nA.x, nA.y, nA.z, slot); ink.vert(RA[k].x, RA[k].y, RA[k].z, nB.x, nB.y, nB.z, slot); ink.vert(RB[k].x, RB[k].y, RB[k].z, nB.x, nB.y, nB.z, slot);
    ink.tri(A, RA[k], RA[j], slot);
    ink.tri(B, RB[j], RB[k], slot);
  }
}
/** Inked box under an extra local transform. */
function iboxM(ink: InkedGeom, m: Matrix4, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, slot: number) {
  const save = ink.m.clone();
  ink.m.multiply(m);
  ink.box(x0, y0, z0, x1, y1, z1, slot);
  ink.m.copy(save);
}

// ───────────────────────────────────── build context ─────────────────────────────────────

class Ctx {
  lights: Light[] = [];
  anchors: Anchor[] = [];
  loc = new Matrix4();
  private st: { w: Matrix4; i: Matrix4; l: Matrix4 }[] = [];
  constructor(public w: WorldGeom, public ink: InkedGeom, public L: LayerFn, public r: Rng) {}
  push(m: Matrix4) { this.st.push({ w: this.w.m.clone(), i: this.ink.m.clone(), l: this.loc.clone() }); this.w.m.multiply(m); this.ink.m.multiply(m); this.loc.multiply(m); }
  pop() { const s = this.st.pop()!; this.w.m.copy(s.w); this.ink.m.copy(s.i); this.loc.copy(s.l); }
  light(x: number, y: number, z: number, c: RGB, radius: number) {
    const v = new Vector3(x, y, z).applyMatrix4(this.loc);
    this.lights.push({ x: v.x, y: v.y, z: v.z, r: c[0], g: c[1], b: c[2], radius });
  }
  anchor(x: number, y: number, z: number) { const v = new Vector3(x, y, z).applyMatrix4(this.loc); this.anchors.push({ x: v.x, y: v.y, z: v.z }); }
  /** atlas face */
  A(layer: keyof typeof ATLAS, cell: string, tint?: RGB, g?: [number, number]): Face {
    const tbl = ATLAS[layer] as Record<string, R4>;
    return { l: this.L(layer), uv: rectUV(tbl[cell]), tint, g };
  }
  B(name: keyof typeof BANDS, tint?: RGB, g?: [number, number]): Face { const b = BANDS[name]; return { l: this.L(b.layer), band: b, tint, g }; }
  T(name: keyof typeof SURFACES, tint?: RGB, g?: [number, number], scale = 1): Face { const s = SURFACES[name]; return { l: this.L(s.layer), tile: [s.tile * scale, s.tile * scale], tint, g }; }
  result(): PropResult { return this.anchors.length ? { lights: this.lights, wireAnchors: this.anchors } : { lights: this.lights }; }
}

const rotY = (a: number) => new Matrix4().makeRotationY(a);
const rotX = (a: number) => new Matrix4().makeRotationX(a);
const rotZ = (a: number) => new Matrix4().makeRotationZ(a);
const tr = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const mul = (...ms: Matrix4[]) => ms.reduce((a, b) => a.multiply(b), new Matrix4());

// light colours
const SODIUM: RGB = [1.0, 0.62, 0.28];
const WARM: RGB = [1.0, 0.82, 0.58];
const LED: RGB = [0.86, 0.92, 1.0];
const NEUTRAL: RGB = [1.0, 0.93, 0.8];
const RED: RGB = [1.0, 0.18, 0.12];
const AMBER: RGB = [1.0, 0.55, 0.12];
const VEND: RGB = [0.8, 0.92, 1.0];

/** Colour by hex (sRGB) → linear-ish tint multiplier for painted (light) textures. */
function hexTint(h: number): RGB { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }

// ───────────────────────────────────── street lamps ─────────────────────────────────────

/** A cobra-head LED/sodium luminaire at the end of an arm, lens facing down (inked body + painted lens). */
function luminaire(k: Ctx, x: number, y: number, z: number, dirZ: number, len: number, wid: number, lens: string, slot: number) {
  const m = mul(tr(x, y, z), rotY(dirZ > 0 ? 0 : Math.PI), rotX(0.06));
  k.push(m);
  k.ink.box(-wid / 2, -0.04, -0.15, wid / 2, 0.1, len - 0.15, slot);
  k.ink.box(-wid / 2 + 0.03, 0.1, 0.0, wid / 2 - 0.03, 0.16, len * 0.6, slot);
  // lens under the head (faces down)
  const lw = wid / 2 - 0.035;
  quadN(k.w, [-lw, -0.045, 0.0], [lw, -0.045, 0.0], [lw, -0.045, len - 0.2], [-lw, -0.045, len - 0.2], [0, -1, 0], rectUV(ATLAS.st_props_a[lens as 'lens_warm']), k.L('st_props_a'));
  k.pop();
}
function lampAvenue(k: Ctx) {
  const teal = k.r.chance(0.5);
  const slot = teal ? PS.teal : PS.steel;
  k.ink.cylinder(0, 0, -0.6, 8.4, 0.12, 0.075, 10, slot);
  k.ink.cylinder(0, 0, -0.6, 0.9, 0.16, 0.15, 10, PS.darksteel);
  k.ink.cylinder(0, 0, 0.9, 1.0, 0.15, 0.12, 10, PS.darksteel);
  // swan-neck arm reaching over the street (+Z)
  const P = [[0, 8.2, 0], [0, 8.75, 0.35], [0, 8.95, 1.0], [0, 8.98, 1.9]];
  for (let i = 0; i < P.length - 1; i++) itube(k.ink, P[i], P[i + 1], 0.05, 6, slot);
  luminaire(k, 0, 8.86, 1.75, 1, 0.75, 0.32, 'lens_warm', slot);
  // banner bracket with a shopping-street flag (seeded)
  if (k.r.chance(0.6)) {
    itube(k.ink, [0, 6.4, 0], [0, 6.4, 0.75], 0.025, 5, slot);
    itube(k.ink, [0, 4.6, 0], [0, 4.6, 0.75], 0.025, 5, slot);
    const ad = k.r.chance(0.5) ? 'ad_soda' : 'ad_radio';
    card(k.w, [0.0, 4.62, 0.07], [0.0, 4.62, 0.72], [0.0, 6.38, 0.72], [0.0, 6.38, 0.07], [1, 0, 0], rectUV(ATLAS.st_props_b[ad]), k.L('st_props_b'));
  }
  k.light(0, 8.7, 1.8, NEUTRAL, 16);
}
function lampArterial(k: Ctx) {
  k.ink.cylinder(0, 0, -0.6, 10.6, 0.16, 0.085, 12, PS.steel);
  k.ink.cylinder(0, 0, -0.6, 1.1, 0.21, 0.2, 12, PS.darksteel);
  k.ink.cylinder(0, 0, 1.1, 1.2, 0.2, 0.17, 12, PS.darksteel);
  for (const d of [1, -1]) {
    const P = [[0, 10.2, 0], [0, 10.7, 0.5 * d], [0, 10.95, 1.5 * d], [0, 11.0, 2.7 * d]];
    for (let i = 0; i < P.length - 1; i++) itube(k.ink, P[i], P[i + 1], 0.065, 6, PS.steel);
    luminaire(k, 0, 10.88, 2.5 * d, d, 0.95, 0.42, 'lens_amber', PS.steel); // high-pressure sodium
    k.light(0, 10.7, 2.6 * d, SODIUM, 20);
  }
}
function lampOldtown(k: Ctx) {
  const body = k.r.chance(0.6) ? PS.brown : PS.black;
  // fluted base, slim post, brass collars
  k.ink.cylinder(0, 0, -0.4, 0.55, 0.2, 0.15, 8, body);
  k.ink.cylinder(0, 0, 0.55, 0.65, 0.17, 0.1, 8, PS.brass);
  k.ink.cylinder(0, 0, 0.65, 3.3, 0.065, 0.055, 8, body);
  k.ink.cylinder(0, 0, 1.9, 2.0, 0.085, 0.085, 8, PS.brass);
  k.ink.cylinder(0, 0, 3.3, 3.42, 0.12, 0.16, 8, PS.brass);
  // lantern: tray, corner posts, glowing panes, hipped roof and finial
  const s = 0.2, y0 = 3.42, y1 = 3.95;
  k.ink.box(-s - 0.02, y0, -s - 0.02, s + 0.02, y0 + 0.05, s + 0.02, body);
  for (const [cx, cz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) k.ink.box(cx - 0.022, y0, cz - 0.022, cx + 0.022, y1, cz + 0.022, body);
  const lens = rectUV(ATLAS.st_props_b.lantern_win), LL = k.L('st_props_b');
  const p = s - 0.01;
  quad(k.w, [-p, y0 + 0.05, p], [p, y0 + 0.05, p], [p, y1, p], [-p, y1, p], lens, LL);
  quad(k.w, [p, y0 + 0.05, -p], [-p, y0 + 0.05, -p], [-p, y1, -p], [p, y1, -p], lens, LL);
  quad(k.w, [p, y0 + 0.05, p], [p, y0 + 0.05, -p], [p, y1, -p], [p, y1, p], lens, LL);
  quad(k.w, [-p, y0 + 0.05, -p], [-p, y0 + 0.05, p], [-p, y1, p], [-p, y1, -p], lens, LL);
  const r = 0.33, yr = y1 + 0.02, apex = new Vector3(0, y1 + 0.3, 0);
  const C = [new Vector3(-r, yr, -r), new Vector3(r, yr, -r), new Vector3(r, yr, r), new Vector3(-r, yr, r)];
  for (let i = 0; i < 4; i++) { k.ink.tri(C[i], apex, C[(i + 1) % 4], body); }
  k.ink.tri(C[0], C[1], C[2], body); k.ink.tri(C[0], C[2], C[3], body);
  k.ink.cylinder(0, 0, y1 + 0.26, y1 + 0.42, 0.035, 0.0, 6, PS.brass);
  k.light(0, 3.7, 0, WARM, 11);
}
function lampSuburb(k: Ctx) {
  const slot = k.r.chance(0.5) ? PS.white : PS.steel;
  k.ink.cylinder(0, 0, -0.5, 6.0, 0.075, 0.055, 8, slot);
  const P = [[0, 5.8, 0], [0, 6.25, 0.25], [0, 6.35, 0.75]];
  for (let i = 0; i < P.length - 1; i++) itube(k.ink, P[i], P[i + 1], 0.03, 6, slot);
  // small LED 防犯灯 fixture
  k.push(tr(0, 6.3, 0.85));
  k.ink.box(-0.09, -0.05, -0.18, 0.09, 0.05, 0.2, PS.white);
  quadN(k.w, [-0.07, -0.055, -0.15], [0.07, -0.055, -0.15], [0.07, -0.055, 0.17], [-0.07, -0.055, 0.17], [0, -1, 0], rectUV(ATLAS.st_props_a.lens_cool), k.L('st_props_a'));
  k.pop();
  k.light(0, 6.1, 0.85, LED, 10);
}
function lampDocks(k: Ctx) {
  const H = 18;
  k.ink.cylinder(0, 0, -0.8, H, 0.32, 0.14, 12, PS.steel);
  k.ink.cylinder(0, 0, -0.8, 0.4, 0.45, 0.42, 12, PS.concrete);
  // ring platform with guard rail posts
  k.ink.cylinder(0, 0, H - 0.1, H + 0.05, 1.05, 1.05, 12, PS.darksteel);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.ink.box(Math.cos(a) * 1.0 - 0.025, H + 0.05, Math.sin(a) * 1.0 - 0.025, Math.cos(a) * 1.0 + 0.025, H + 0.65, Math.sin(a) * 1.0 + 0.025, PS.yellow); }
  // six floodlights on a crown, tilted down and outward
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    k.push(mul(tr(0, H + 0.55, 0), rotY(-a + Math.PI / 2), tr(0, 0, 0.75), rotX(0.65)));
    k.ink.box(-0.3, -0.2, -0.14, 0.3, 0.2, 0.12, PS.darksteel);
    quadN(k.w, [-0.26, -0.17, 0.125], [0.26, -0.17, 0.125], [0.26, 0.17, 0.125], [-0.26, 0.17, 0.125], [0, 0, 1], rectUV(ATLAS.st_props_a.lens_white), k.L('st_props_a'));
    k.pop();
  }
  // ladder rails up the mast
  k.ink.box(0.16, 0.6, -0.2, 0.2, H - 0.2, -0.17, PS.steel);
  k.ink.box(0.16, 0.6, 0.17, 0.2, H - 0.2, 0.2, PS.steel);
  k.light(0, H, 0, k.r.chance(0.5) ? LED : SODIUM, 34);
}

// ───────────────────────────────────── utility pole + wires ─────────────────────────────────────

function utilityPole(k: Ctx) {
  const H = 11.5;
  k.ink.cylinder(0, 0, -0.8, H, 0.19, 0.12, 8, PS.concrete);
  // HV crossarm with three insulators (wires run along X)
  k.ink.box(-0.05, H - 0.75, -0.95, 0.05, H - 0.65, 0.95, PS.darksteel);
  itube(k.ink, [0, H - 1.25, 0.14], [0, H - 0.72, 0.7], 0.02, 4, PS.darksteel);
  for (const z of [-0.8, 0, 0.8]) {
    k.ink.cylinder(0, z, H - 0.65, H - 0.5, 0.055, 0.04, 5, PS.white);
    k.anchor(0, H - 0.48, z);
  }
  // pole-mounted transformer(s) on a frame, street side
  const two = k.r.chance(0.5);
  k.ink.box(-0.05, H - 2.75, 0.12, 0.05, H - 2.65, 0.65, PS.darksteel);
  k.ink.box(-0.05, H - 3.85, 0.12, 0.05, H - 3.75, 0.65, PS.darksteel);
  for (const x of two ? [-0.27, 0.27] : [0]) k.ink.cylinder(x, 0.42, H - 3.75, H - 2.85, 0.24, 0.24, 8, PS.steel);
  // low-voltage rack and service drops
  k.ink.box(-0.04, H - 4.4, -0.35, 0.04, H - 4.3, 0.35, PS.darksteel);
  for (const z of [-0.28, 0.28]) { k.ink.cylinder(0, z, H - 4.3, H - 4.18, 0.04, 0.03, 5, PS.white); k.anchor(0, H - 4.16, z); }
  // telecom cable clamp (thick black cable)
  k.ink.box(-0.24, H - 6.05, -0.06, 0.24, H - 5.95, 0.06, PS.darksteel);
  k.anchor(0, H - 6.0, -0.16);
  // step bolts, alternating sides
  for (let i = 0; i < 6; i++) {
    const y = 2.6 + i * 0.75, side = i % 2 ? 1 : -1;
    k.ink.box(side > 0 ? 0.1 : -0.32, y, -0.02, side > 0 ? 0.32 : -0.1, y + 0.035, 0.02, PS.darksteel);
  }
  // pole ad sleeve (電柱広告) on the street face and an address plate
  const ad = k.r.chance(0.5) ? 'pole_ad_dent' : 'pole_ad_clinic';
  const rr = 0.2, y0 = 1.9, y1 = 3.75, seg = 4;
  const uv = rectUV(ATLAS.st_props_b[ad]), LB = k.L('st_props_b');
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI * (0.25 + (0.5 * i) / seg), a1 = Math.PI * (0.25 + (0.5 * (i + 1)) / seg);
    const u0 = uv[0] + ((uv[2] - uv[0]) * (seg - i - 1)) / seg, u1 = uv[0] + ((uv[2] - uv[0]) * (seg - i)) / seg;
    const p0 = [Math.cos(a1) * rr, y0, Math.sin(a1) * rr], p1 = [Math.cos(a0) * rr, y0, Math.sin(a0) * rr];
    quadN(k.w, p0, p1, [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)], [u0, uv[1], u1, uv[3]], LB);
  }
  quad(k.w, [-0.1, 1.5, 0.185], [0.1, 1.5, 0.185], [0.1, 1.6, 0.185], [-0.1, 1.6, 0.185], rectUV(ATLAS.st_props_b.addr), LB);
}

/**
 * A utility wire from a to b (world coordinates) sagging by `sag` metres at mid-span, as a thin
 * closed triangular prism (dark, unlit). `thick` = diameter (stylised: 4 cm reads at distance).
 */
export function buildWires(world: WorldGeom, a: Anchor, b: Anchor, sag: number, thick = 0.04) {
  const n = 10, r = thick / 2;
  const P: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    P.push(new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t), a.z + (b.z - a.z) * t));
  }
  const col: RGB = [0.07, 0.065, 0.09];
  const dir = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const offs = [0, 1, 2].map((j) => { const ang = (j / 3) * Math.PI * 2 + Math.PI / 2; return [Math.cos(ang), Math.sin(ang)]; });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      const o0 = offs[j], o1 = offs[(j + 1) % 3];
      const c = (p: Vector3, o: number[]) => [p.x + side.x * o[0] * r, p.y + o[1] * r, p.z + side.z * o[0] * r];
      const nm = [side.x * (o0[0] + o1[0]), o0[1] + o1[1], side.z * (o0[0] + o1[0])];
      const l = Math.hypot(nm[0], nm[1], nm[2]) || 1;
      const nn = [nm[0] / l, nm[1] / l, nm[2] / l];
      // orientation: emit both windings would double cost; pick the outward one
      _a.set(...(c(P[i], o0) as [number, number, number])); _b.set(...(c(P[i + 1], o0) as [number, number, number]));
      _c.set(...(c(P[i + 1], o1) as [number, number, number]));
      const fn = _d.subVectors(_b, _a).cross(_v.subVectors(_c, _a));
      const ok = fn.x * nn[0] + fn.y * nn[1] + fn.z * nn[2] > 0;
      const q0 = c(P[i], o0), q1 = c(P[i + 1], o0), q2 = c(P[i + 1], o1), q3 = c(P[i], o1);
      if (ok) quadN(world, q0, q1, q2, q3, nn, [0, 0, 1, 1], -1, col);
      else quadN(world, q0, q3, q2, q1, nn, [0, 0, 1, 1], -1, col);
    }
  }
}

// ───────────────────────────────────── trees ─────────────────────────────────────

function leafCards(k: Ctx, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number, cardName: 'leaf' | 'blossom' | 'pine' | 'grass', size: number, tint: RGB, upBias = 0.2) {
  const uv = rectUV(ATLAS.st_cards[cardName]), LC = k.L('st_cards');
  for (let i = 0; i < n; i++) {
    const a = k.r.next() * Math.PI * 2, e = (k.r.next() * 1.2 - 0.35) + upBias;
    const nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e), nz = Math.sin(a) * Math.cos(e);
    // card plane: every other card sticks out radially (breaks the blob's silhouette), the rest lie
    // tangent to the crown, tilted
    const radial = i % 2 === 0;
    const rr = radial ? 1.02 : 0.92;
    const px = cx + nx * rx * rr, py = cy + ny * ry * rr, pz = cz + nz * rz * rr;
    const right = new Vector3(-Math.sin(a), 0, Math.cos(a));
    const up = radial ? new Vector3(nx, ny, nz).normalize() : new Vector3(0, 1, 0).addScaledVector(new Vector3(nx, 0, nz), -0.25 + k.r.next() * 0.2).normalize();
    if (radial) right.applyAxisAngle(up, (k.r.next() - 0.5) * 1.2);
    const s = size * (0.75 + k.r.next() * 0.5) * (radial ? 1.2 : 1);
    const h = s / 2;
    const P = (dx: number, dy: number) => [px + right.x * dx + up.x * dy, py + right.y * dx + up.y * dy, pz + right.z * dx + up.z * dy];
    const g = 0.25 + 0.75 * Math.max(0, Math.min(1, (ny + 0.6) / 1.4));
    card(k.w, P(-h, -h), P(h, -h), P(h, h), P(-h, h), [nx, ny, nz], uv, LC, tint, g, Math.min(1, g + 0.15));
  }
}
function trunkPath(k: Ctx, base: number[], pts: number[][], seg: number, tint: RGB) {
  tubeW(k.w, [base, ...pts], seg, { l: k.L('st_bark'), tile: [1.4, 1.4], tint }, true, [0.2, 0.9]);
}
function treePit(k: Ctx) {
  const s = 0.6, c = k.T('concrete', [0.95, 0.95, 0.95]);
  quad(k.w, [-s, 0.03, s], [s, 0.03, s], [s, 0.03, -s], [-s, 0.03, -s], [0, 0, 1.2 / 5, 1.2 / 5], k.L('st_earth'), [0.85, 0.85, 0.85]);
  for (const [x0, z0, x1, z1] of [[-s - 0.08, s, s + 0.08, s + 0.08], [-s - 0.08, -s - 0.08, s + 0.08, -s], [-s - 0.08, -s, -s, s], [s, -s, s + 0.08, s]]) boxW(k.w, x0, -0.2, z0, x1, 0.07, z1, { all: c, bot: null }, [0.6, 1]);
  // low groundcover tufts
  leafCards(k, 0, 0.12, 0, 0.45, 0.05, 0.45, 3, 'grass', 0.35, [0.9, 1, 0.85], 0.6);
}
function treeStreet(k: Ctx) {
  treePit(k);
  const ginkgo = k.r.chance(0.45);
  if (ginkgo) {
    // ginkgo: straight trunk, columnar canopy in stacked lobes, fresh yellow-green
    const tint: RGB = k.r.chance(0.25) ? [5.2, 1.6, 0.25] : [1.25, 1.22, 0.72];
    trunkPath(k, [0, -0.5, 0, 0.17], [[0, 2.5, 0, 0.14], [0.05, 5.5, 0.02, 0.09], [0.0, 8.0, 0.0, 0.05]], 6, [0.95, 0.9, 0.85]);
    const f: Face = { ...k.T('leaves', tint), g: [0.1, 1] };
    blob(k.w, 0, 3.9, 0, 1.75, 1.3, 1.75, f, k.r, { lat: 4, lon: 8, jitter: 0.12 });
    blob(k.w, 0.1, 5.6, 0.05, 1.55, 1.3, 1.5, f, k.r, { lat: 4, lon: 8, jitter: 0.12 });
    blob(k.w, 0, 7.2, 0, 1.15, 1.25, 1.1, f, k.r, { lat: 4, lon: 7, jitter: 0.1 });
    leafCards(k, 0, 5.5, 0, 1.7, 2.6, 1.7, 14, 'leaf', 1.1, tint, 0.0);
  } else {
    // zelkova: short trunk splitting into upswept limbs under a broad umbrella canopy
    const tint: RGB = [1.0, 1.05, 0.95];
    trunkPath(k, [0, -0.5, 0, 0.22], [[0, 1.6, 0, 0.18], [0, 2.3, 0, 0.16]], 6, [1, 1, 1]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + k.r.next();
      trunkPath(k, [0, 2.2, 0, 0.12], [[Math.cos(a) * 0.6, 3.4, Math.sin(a) * 0.6, 0.08], [Math.cos(a) * 1.3, 4.6, Math.sin(a) * 1.3, 0.05]], 5, [1, 1, 1]);
    }
    const f: Face = { ...k.T('leaves', tint), g: [0.05, 1] };
    blob(k.w, 0, 5.2, 0, 2.9, 1.7, 2.8, f, k.r, { lat: 5, lon: 9, jitter: 0.1, flat: 0.35 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      blob(k.w, Math.cos(a) * 1.4, 5.6 + k.r.next() * 0.6, Math.sin(a) * 1.4, 1.5, 1.15, 1.5, f, k.r, { lat: 4, lon: 7, jitter: 0.12 });
    }
    leafCards(k, 0, 5.3, 0, 3.0, 1.9, 2.9, 18, 'leaf', 1.4, tint, 0.15);
  }
}
function treeCherry(k: Ctx) {
  const bark: RGB = [0.62, 0.48, 0.5];
  trunkPath(k, [0, -0.5, 0, 0.24], [[0.1, 1.2, 0, 0.22], [0.15, 1.8, 0.05, 0.19]], 6, bark);
  const limbs = 4;
  const ends: number[][] = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + k.r.next() * 0.6;
    const r1 = 1.6 + k.r.next() * 0.6, r2 = 2.8 + k.r.next() * 0.7;
    const e = [Math.cos(a) * r2, 3.6 + k.r.next() * 0.6, Math.sin(a) * r2];
    trunkPath(k, [0.15, 1.7, 0.05, 0.13], [[Math.cos(a) * r1, 2.9, Math.sin(a) * r1, 0.09], [e[0], e[1], e[2], 0.05]], 5, bark);
    ends.push(e);
  }
  const pink: RGB = [1, 1, 1];
  const f: Face = { ...k.T('blossom', pink), g: [0.15, 1] };
  blob(k.w, 0, 4.4, 0, 3.1, 1.5, 3.0, f, k.r, { lat: 5, lon: 9, jitter: 0.12, flat: 0.4 });
  for (const e of ends) blob(k.w, e[0] * 0.95, e[1] + 0.3, e[2] * 0.95, 1.5, 1.0, 1.5, f, k.r, { lat: 4, lon: 7, jitter: 0.14 });
  leafCards(k, 0, 4.3, 0, 3.4, 1.6, 3.3, 16, 'blossom', 1.4, pink, 0.0);
  // a few drooping sprays below the crown
  leafCards(k, 0, 3.2, 0, 3.0, 0.4, 2.9, 5, 'blossom', 1.1, [0.95, 0.92, 0.95], -0.5);
}
function treePine(k: Ctx) {
  const bark: RGB = [0.78, 0.55, 0.45];
  // leaning, twisting trunk
  const lean = k.r.range(0.5, 1.1), dirA = k.r.next() * Math.PI * 2;
  const dx = Math.cos(dirA), dz = Math.sin(dirA);
  const T = [[0, -0.5, 0, 0.24], [dx * 0.2, 1.2, dz * 0.2, 0.21], [dx * lean * 0.8, 2.6, dz * lean * 0.8 + 0.15, 0.17], [dx * lean * 1.1, 3.8, dz * lean * 1.1 - 0.1, 0.13], [dx * lean * 0.9, 4.9, dz * lean * 0.9, 0.08]];
  tubeW(k.w, T, 6, { l: k.L('st_bark'), tile: [1.0, 1.0], tint: bark }, true, [0.2, 0.9]);
  const pad: Face = { ...k.T('pine', [1, 1, 1]), g: [0.0, 1] };
  // cloud-pruned pads on short horizontal branches
  const pads = [
    [T[4][0], 5.15, T[4][2], 1.25, 0.45], // crown
    [T[3][0] - dx * 1.6, 4.0, T[3][2] - dz * 1.6 + 0.6, 1.1, 0.38],
    [T[3][0] + dz * 1.5, 3.6, T[3][2] - dx * 1.5, 1.0, 0.36],
    [T[2][0] - dz * 1.7, 2.9, T[2][2] + dx * 1.7, 1.2, 0.4],
    [T[2][0] + dx * 1.9, 2.4, T[2][2] + dz * 1.9, 1.35, 0.42],
    [T[1][0] - dx * 1.6, 1.9, T[1][2] - dz * 1.6, 0.9, 0.32],
  ];
  for (const [x, y, z, r, h] of pads) {
    // branch to the pad
    const from = [x * 0.25 + T[2][0] * 0.75, y - 0.35, z * 0.25 + T[2][2] * 0.75, 0.06];
    tubeW(k.w, [from, [x * 0.8, y - 0.15, z * 0.8, 0.045]], 4, { l: k.L('st_bark'), tile: [1, 1], tint: bark }, false, [0.3, 0.8]);
    blob(k.w, x, y, z, r, h, r * 0.9, pad, k.r, { lat: 4, lon: 7, jitter: 0.1, flat: 0.45 });
    leafCards(k, x, y + 0.05, z, r, h, r * 0.9, 3, 'pine', 0.9, [1, 1, 1], 0.25);
  }
}
function shrub(k: Ctx) {
  const flowering = k.r.chance(0.45);
  const f: Face = flowering ? { ...k.T('blossom', [1.0, 0.55, 0.85]), g: [0.2, 1] } : { ...k.T('leaves', [0.85, 0.95, 0.8], undefined, 0.5), g: [0.2, 1] };
  blob(k.w, 0, 0.45, 0, 0.85, 0.6, 0.8, f, k.r, { lat: 4, lon: 8, jitter: 0.1, flat: 0.6 });
  blob(k.w, 0.45, 0.35, 0.2, 0.55, 0.45, 0.5, f, k.r, { lat: 3, lon: 7, jitter: 0.1, flat: 0.6 });
  blob(k.w, -0.5, 0.32, -0.1, 0.5, 0.4, 0.5, f, k.r, { lat: 3, lon: 7, jitter: 0.1, flat: 0.6 });
  leafCards(k, 0, 0.5, 0, 0.9, 0.55, 0.85, 7, flowering ? 'blossom' : 'leaf', 0.55, flowering ? [1.0, 0.55, 0.85] : [0.85, 0.95, 0.8], 0.4);
}
/** A 2 m clipped hedge segment (chain them along a planting strip). */
function hedge(k: Ctx) {
  const tint: RGB = [0.78, 0.92, 0.72];
  const f: Face = { ...k.T('leaves', tint, undefined, 0.45), g: [0.15, 1] };
  const x0 = -1, x1 = 1, z0 = -0.35, z1 = 0.35, h = 0.95, ch = 0.12;
  // body with chamfered top edges
  boxW(k.w, x0, -0.2, z0, x1, h - ch, z1, { pz: f, nz: f, px: f, nx: f, top: null }, [0.15, 0.85]);
  quad(k.w, [x0, h - ch, z1], [x1, h - ch, z1], [x1, h, z1 - ch], [x0, h, z1 - ch], [x0 / 1, 0.4, x1 / 1, 0.55], f.l, tint, 0.85, 1);
  quad(k.w, [x1, h - ch, z0], [x0, h - ch, z0], [x0, h, z0 + ch], [x1, h, z0 + ch], [0, 0.4, 2, 0.55], f.l, tint, 0.85, 1);
  quad(k.w, [x0, h, z1 - ch], [x1, h, z1 - ch], [x1, h, z0 + ch], [x0, h, z0 + ch], [0, 0, 2, 0.6], f.l, tint, 1, 1);
  // a few sprigs breaking the clipped line
  leafCards(k, 0, h - 0.05, 0, 0.95, 0.1, 0.3, 6, 'leaf', 0.32, tint, 1.0);
}

// ───────────────────────────────────── street furniture ─────────────────────────────────────

const METAL = (k: Ctx, tint: RGB, g?: [number, number]): Face => ({ ...k.B('plate', tint, g) });

function vendingMachine(k: Ctx) {
  const n = k.r.chance(0.55) ? 2 : 1;
  const kinds: [string, number][] = [['vend_red', 0xd8282e], ['vend_blue', 0xf2f4f6], ['vend_coffee', 0x3a2a24]];
  const W = 1.0, D = 0.75, H = 1.83;
  let x = -((n * (W + 0.05)) / 2);
  for (let i = 0; i < n; i++) {
    const [cellName, col] = kinds[(k.r.int(0, 2) + i) % 3];
    const tint = hexTint(col);
    const front = k.A('st_props_a', cellName, undefined, [0.55, 1]);
    const side = METAL(k, tint, [0.4, 1]);
    boxW(k.w, x, 0.06, -D, x + W, H, 0, { pz: front, nz: side, px: side, nx: side, top: METAL(k, [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8]) });
    // plinth and a slight top visor
    boxW(k.w, x + 0.02, -0.3, -D + 0.02, x + W - 0.02, 0.06, -0.02, { all: METAL(k, [0.2, 0.2, 0.24]), top: null });
    boxW(k.w, x - 0.01, H, -D, x + W + 0.01, H + 0.05, 0.04, { all: METAL(k, tint) });
    k.light(x + W / 2, 1.1, 0.5, VEND, 6);
    x += W + 0.05;
  }
  // recycle bin beside
  const bx = x + 0.08;
  boxW(k.w, bx, -0.2, -0.45, bx + 0.42, 0.85, -0.05, { pz: k.A('st_props_a', 'recycle', undefined, [0.4, 1]), nz: METAL(k, [0.25, 0.5, 0.85]), px: METAL(k, [0.25, 0.5, 0.85]), nx: METAL(k, [0.25, 0.5, 0.85]), top: METAL(k, [0.2, 0.42, 0.75]) });
}
function busStop(k: Ctx) {
  const shelter = k.r.chance(0.55);
  // the bus stop pole with its heavy round base and the double-sided sign disc
  const grey = METAL(k, [0.7, 0.72, 0.76]);
  cylW(k.w, 0, 0, -0.1, 0.18, 0.32, 0.3, 10, k.T('concrete', [0.8, 0.8, 0.82]), k.T('concrete', [0.85, 0.85, 0.87]));
  cylW(k.w, 0, 0, 0.18, 2.55, 0.035, 0.035, 6, grey);
  const disc = rectUV(ATLAS.st_props_a.bus_disc), LA = k.L('st_props_a');
  const R = 0.3, cy = 2.25;
  const pts = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return [Math.cos(a) * R, Math.sin(a) * R]; });
  facePoly(k.w, pts, 0, cy, 0.045, ATLAS.st_props_a.bus_disc, 0.62, LA);
  k.push(rotY(Math.PI)); facePoly(k.w, pts, 0, cy, 0.045, ATLAS.st_props_a.bus_disc, 0.62, LA); k.pop();
  cylW(k.w, 0, 0, 2.55, 2.6, 0.04, 0.0, 6, grey);
  // a thin rim around the disc
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2, a1 = ((i + 1) / 14) * Math.PI * 2;
    quadN(k.w, [Math.cos(a0) * R, cy + Math.sin(a0) * R, -0.045], [Math.cos(a1) * R, cy + Math.sin(a1) * R, -0.045], [Math.cos(a1) * R, cy + Math.sin(a1) * R, 0.045], [Math.cos(a0) * R, cy + Math.sin(a0) * R, 0.045], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0], disc, LA, [0.2, 0.35, 0.7]);
  }
  // timetable box on the pole
  boxW(k.w, -0.16, 1.15, 0.04, 0.16, 1.75, 0.09, { pz: k.A('st_props_a', 'timetable'), nz: grey, px: grey, nx: grey, top: grey }, [0.8, 1]);
  void disc;
  if (shelter) {
    const sx = 1.2, x0 = sx - 1.7, x1 = sx + 1.7, zb = -1.4;
    const post = METAL(k, [0.35, 0.38, 0.45]);
    for (const x of [x0 + 0.1, x1 - 0.1]) boxW(k.w, x - 0.05, -0.2, zb, x + 0.05, 2.4, zb + 0.1, { all: post }, [0.4, 1]);
    // roof with the operator's name on its front edge
    boxW(k.w, x0 - 0.1, 2.4, zb - 0.05, x1 + 0.1, 2.52, 0.0, { pz: k.A('st_props_b', 'ad_shelter_roof'), nz: post, px: post, nx: post, top: METAL(k, [0.55, 0.58, 0.64]) }, [0.9, 1]);
    // back panel: back-lit advert + glass
    const ad = k.r.chance(0.5) ? 'ad_soda' : 'ad_radio';
    boxW(k.w, x0 + 0.15, 0.25, zb, x0 + 1.25, 2.25, zb + 0.08, { pz: k.A('st_props_b', ad, undefined, [1, 1]), nz: post, px: post, nx: post, top: post });
    boxW(k.w, x0 + 1.3, 0.25, zb + 0.02, x1 - 0.15, 2.25, zb + 0.06, { all: { l: -1, tint: [0.42, 0.55, 0.68], g: [0.7, 1] } });
    // bench
    const wood = k.A('st_props_b', 'bench_seat');
    boxW(k.w, x0 + 1.4, 0.42, zb + 0.15, x1 - 0.3, 0.48, zb + 0.55, { all: wood });
    for (const x of [x0 + 1.5, x1 - 0.4]) boxW(k.w, x - 0.03, -0.1, zb + 0.2, x + 0.03, 0.42, zb + 0.5, { all: post });
    k.light(x0 + 0.7, 1.3, zb + 0.3, [0.9, 0.95, 1.0], 5);
  }
}
function postBox(k: Ctx) {
  const red = METAL(k, [0.85, 0.12, 0.14], [0.45, 1]);
  if (k.r.chance(0.5)) {
    // classic round 丸ポスト on a short plinth
    cylW(k.w, 0, 0, -0.2, 0.08, 0.27, 0.27, 10, k.T('concrete'), null);
    const uv = rectUV(ATLAS.st_props_a.postbox), LA = k.L('st_props_a');
    cylW(k.w, 0, 0, 0.08, 1.05, 0.22, 0.22, 10, red);
    // the street-facing panel (slot, 〒, collection times) wrapped over the front third
    const rr = 0.224, seg = 3, a0 = Math.PI / 2 - 0.95, a1 = Math.PI / 2 + 0.95;
    for (let i = 0; i < seg; i++) {
      const b0 = a0 + ((a1 - a0) * i) / seg, b1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      const u0 = uv[0] + ((uv[2] - uv[0]) * (seg - i - 1)) / seg, u1 = uv[0] + ((uv[2] - uv[0]) * (seg - i)) / seg;
      const p0 = [Math.cos(b1) * rr, 0.1, Math.sin(b1) * rr], p1 = [Math.cos(b0) * rr, 0.1, Math.sin(b0) * rr];
      quadN(k.w, p0, p1, [p1[0], 1.04, p1[2]], [p0[0], 1.04, p0[2]], [Math.cos((b0 + b1) / 2), 0, Math.sin((b0 + b1) / 2)], [u0, uv[1], u1, uv[3]], LA, [1, 1, 1], 0.5, 1);
    }
    // the rounded cap
    cylW(k.w, 0, 0, 1.05, 1.13, 0.24, 0.24, 10, red);
    cylW(k.w, 0, 0, 1.13, 1.25, 0.24, 0.12, 10, red, red);
    void red;
  } else {
    // modern box on a post
    cylW(k.w, 0, -0.2, -0.2, 0.75, 0.05, 0.05, 6, red);
    boxW(k.w, -0.25, 0.75, -0.42, 0.25, 1.4, 0.02, { pz: k.A('st_props_a', 'postbox', undefined, [0.6, 1]), nz: red, px: red, nx: red, top: red });
    boxW(k.w, -0.27, 1.4, -0.45, 0.27, 1.45, 0.05, { all: red });
  }
}
/** A row of 2–3 parked bicycles (mamachari), wheels as spoked cutout cards. Chain several for a long rack. */
function bicycles(k: Ctx) {
  const n = k.r.int(2, 3);
  const cols: RGB[] = [[0.8, 0.82, 0.86], [0.85, 0.2, 0.22], [0.2, 0.4, 0.8], [0.15, 0.15, 0.18], [0.95, 0.95, 0.92], [0.95, 0.6, 0.7], [0.3, 0.6, 0.45]];
  const wheel = rectUV(ATLAS.st_props_b.bike_wheel), LB = k.L('st_props_b');
  const basket = rectUV(ATLAS.st_props_b.bike_basket);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.62;
    const yaw = (k.r.next() - 0.5) * 0.25;
    const fr = cols[k.r.int(0, cols.length - 1)];
    const frame: Face = METAL(k, fr, [0.5, 1]);
    k.push(mul(tr(x, 0, -0.9), rotY(Math.PI / 2 + yaw)));
    // in this frame the bike runs along X (front wheel at +X), width along Z
    const R = 0.33;
    for (const wx of [-0.52, 0.52]) card(k.w, [wx - R, 0, 0], [wx + R, 0, 0], [wx + R, 2 * R, 0], [wx - R, 2 * R, 0], [0, 0, 1], wheel, LB);
    const bar = (a: number[], b: number[], r = 0.017) => tubeW(k.w, [[...a, r], [...b, r]], 3, frame, false, [0.6, 1]);
    const hub = [0.52, R, 0], rhub = [-0.52, R, 0], crank = [-0.05, 0.3, 0], seat = [-0.22, 0.85, 0], head = [0.38, 0.85, 0];
    bar(rhub, crank); bar(crank, seat); bar(rhub, seat); bar(crank, head, 0.02); bar(head, hub); bar([0.36, 0.95, 0], [0.38, 0.85, 0]);
    // step-through mamachari: low top tube already via crank→head; handlebar, saddle, basket, carrier
    tubeW(k.w, [[0.33, 1.0, -0.26, 0.015], [0.36, 0.98, 0, 0.015], [0.33, 1.0, 0.26, 0.015]], 4, METAL(k, [0.85, 0.86, 0.9]), false);
    boxW(k.w, -0.33, 0.88, -0.08, -0.1, 0.94, 0.08, { all: METAL(k, [0.12, 0.12, 0.14]) }, [0.6, 1]);
    // front basket (wire cutout), double-sided on its four sides
    const bx0 = 0.45, bx1 = 0.78, by0 = 0.78, by1 = 1.0, bz = 0.17;
    card(k.w, [bx0, by0, bz], [bx1, by0, bz], [bx1, by1, bz], [bx0, by1, bz], [0, 0, 1], basket, LB, [0.9, 0.9, 0.95]);
    card(k.w, [bx1, by0, -bz], [bx0, by0, -bz], [bx0, by1, -bz], [bx1, by1, -bz], [0, 0, -1], basket, LB, [0.9, 0.9, 0.95]);
    card(k.w, [bx1, by0, bz], [bx1, by0, -bz], [bx1, by1, -bz], [bx1, by1, bz], [1, 0, 0], basket, LB, [0.9, 0.9, 0.95]);
    card(k.w, [bx0, by0, -bz], [bx0, by0, bz], [bx0, by1, bz], [bx0, by1, -bz], [-1, 0, 0], basket, LB, [0.9, 0.9, 0.95]);
    boxW(k.w, -0.8, 0.7, -0.1, -0.42, 0.73, 0.1, { all: METAL(k, [0.75, 0.76, 0.8]) }, [0.7, 1]);
    // kickstand-ish fender shadows: mudguards
    tubeW(k.w, [[-0.85, 0.42, 0, 0.03], [-0.62, 0.7, 0, 0.03], [-0.3, 0.55, 0, 0.03]], 3, frame, false, [0.5, 1]);
    k.pop();
  }
}
function cone(k: Ctx) {
  const n = k.r.chance(0.5) ? 1 : 3;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 1.2;
    boxW(k.w, x - 0.19, -0.05, -0.19, x + 0.19, 0.04, 0.19, { all: METAL(k, [0.85, 0.3, 0.15]), top: METAL(k, [0.9, 0.35, 0.18]) }, [0.4, 1]);
    cylW(k.w, x, 0, 0.04, 0.7, 0.16, 0.035, 8, { l: k.L('st_props_b'), uv: rectUV(ATLAS.st_props_b.cone), g: [0.55, 1] }, METAL(k, [0.9, 0.3, 0.15]));
  }
  if (n === 3) {
    // a striped bar resting on top of the cones (コーンバー)
    tubeW(k.w, [[-1.2, 0.62, 0, 0.025], [1.2, 0.62, 0, 0.025]], 4, { ...k.B('hazard'), tile: undefined }, false);
  }
}
/** Japanese A-frame barricade with striped boards and an amber blinker on top. */
function barrier(k: Ctx) {
  const W = 1.4, hz = k.B('hazard', [1, 1, 1], [0.7, 1]), leg = METAL(k, [0.92, 0.75, 0.15]);
  for (const x of [-W / 2, W / 2]) {
    for (const s of [-1, 1]) tubeW(k.w, [[x, -0.05, 0.38 * s, 0.025], [x, 1.0, 0.04 * s, 0.025]], 4, leg, false);
  }
  for (const [y0, y1] of [[0.75, 0.95], [0.32, 0.5]]) {
    boxW(k.w, -W / 2 - 0.05, y0, 0.04, W / 2 + 0.05, y1, 0.08, { pz: { ...hz }, nz: { ...hz }, px: leg, nx: leg, top: leg });
  }
  // blinker
  boxW(k.w, -0.09, 0.95, 0.02, 0.09, 1.0, 0.1, { all: METAL(k, [0.15, 0.15, 0.18]) });
  boxW(k.w, -0.07, 1.0, 0.03, 0.07, 1.14, 0.09, { pz: k.A('st_props_a', 'lens_amber', undefined, [1, 1]), nz: k.A('st_props_a', 'lens_amber', undefined, [1, 1]), px: METAL(k, [0.15, 0.15, 0.18]), nx: METAL(k, [0.15, 0.15, 0.18]), top: METAL(k, [0.15, 0.15, 0.18]) });
  k.light(0, 1.07, 0.15, AMBER, 3.5);
}
function planter(k: Ctx) {
  const stone = k.r.chance(0.5);
  const face = stone ? k.T('pave_stone', [1, 1, 1], [0.4, 1], 0.6) : k.T('concrete', [0.95, 0.93, 0.9], [0.4, 1]);
  const W = 1.6, D = 0.6, H = 0.55;
  boxW(k.w, -W / 2, -0.25, -D, W / 2, H, 0, { all: face, top: null });
  // rim and soil
  boxW(k.w, -W / 2 - 0.03, H, -D - 0.03, W / 2 + 0.03, H + 0.05, 0.03, { all: k.T('concrete', [0.9, 0.9, 0.9], [0.9, 1]) });
  quad(k.w, [-W / 2 + 0.05, H + 0.03, -0.05], [W / 2 - 0.05, H + 0.03, -0.05], [W / 2 - 0.05, H + 0.03, -D + 0.05], [-W / 2 + 0.05, H + 0.03, -D + 0.05], [0, 0, 0.3, 0.12], k.L('st_earth'), [0.7, 0.62, 0.55]);
  // seasonal planting: low shrubs and flowers
  const flowers = k.r.chance(0.6);
  const f: Face = flowers ? { ...k.T('blossom', [1.0, 0.7, 0.4]), g: [0.3, 1] } : { ...k.T('leaves', [0.9, 1, 0.85], undefined, 0.5), g: [0.3, 1] };
  for (let i = 0; i < 3; i++) blob(k.w, -0.5 + i * 0.5, H + 0.18, -D / 2, 0.32, 0.25, 0.26, f, k.r, { lat: 3, lon: 6, jitter: 0.15, flat: 0.5 });
  leafCards(k, 0, H + 0.25, -D / 2, 0.75, 0.15, 0.28, 5, flowers ? 'blossom' : 'leaf', 0.32, flowers ? [1.0, 0.7, 0.4] : [0.9, 1, 0.85], 0.8);
}
function bollard(k: Ctx) {
  if (k.r.chance(0.6)) {
    // stainless steel bollard with a reflective band
    const st = METAL(k, [0.82, 0.85, 0.9], [0.5, 1]);
    cylW(k.w, 0, 0, -0.2, 0.8, 0.065, 0.065, 8, st);
    cylW(k.w, 0, 0, 0.62, 0.7, 0.068, 0.068, 8, k.B('hazard'));
    cylW(k.w, 0, 0, 0.8, 0.86, 0.065, 0.0, 8, st, st);
  } else {
    // granite post with a pyramid top (Old Town)
    const s = 0.1, st = k.A('st_props_b', 'stone', undefined, [0.4, 1]);
    boxW(k.w, -s, -0.2, -s, s, 0.62, s, { all: st, top: null });
    const ap = [0, 0.72, 0];
    for (const [a, b] of [[[-s, 0.62, s], [s, 0.62, s]], [[s, 0.62, s], [s, 0.62, -s]], [[s, 0.62, -s], [-s, 0.62, -s]], [[-s, 0.62, -s], [-s, 0.62, s]]]) {
      _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]); _c.set(ap[0], ap[1], ap[2]);
      k.w.tri(_a, _b, _c, { layer: st.l }, [st.uv![0], st.uv![1], st.uv![2], st.uv![1], (st.uv![0] + st.uv![2]) / 2, st.uv![3]], 1);
    }
  }
}
function phoneBox(k: Ctx) {
  const W = 0.8, H = 2.1, frame = METAL(k, [0.86, 0.88, 0.9], [0.5, 1]);
  const panel = k.A('st_props_a', 'phone', undefined, [0.6, 1]);
  boxW(k.w, -W / 2, -0.15, -W, W / 2, 0.08, 0, { all: k.T('concrete') });
  boxW(k.w, -W / 2 + 0.03, 0.08, -W + 0.03, W / 2 - 0.03, H, -0.03, { pz: panel, nz: panel, px: panel, nx: panel, top: null });
  for (const [x, z] of [[-W / 2, -W], [W / 2 - 0.06, -W], [-W / 2, -0.06], [W / 2 - 0.06, -0.06]]) boxW(k.w, x, 0.08, z, x + 0.06, H, z + 0.06, { all: frame });
  // lit top sign band and roof
  const top = k.A('st_props_b', 'phone_top', undefined, [1, 1]);
  boxW(k.w, -W / 2 - 0.02, H, -W - 0.02, W / 2 + 0.02, H + 0.18, 0.02, { pz: top, nz: top, px: top, nx: top, top: frame });
  boxW(k.w, -W / 2 - 0.05, H + 0.18, -W - 0.05, W / 2 + 0.05, H + 0.24, 0.05, { all: METAL(k, [0.2, 0.55, 0.35]) });
  k.light(0, 1.8, -W / 2, [0.75, 1.0, 0.82], 5);
}
/** Pedestrian signal: grey pole, two-lamp head facing across the road (+Z), push-button box. */
function signalPole(k: Ctx) {
  const green = k.r.chance(0.4);
  k.ink.cylinder(0, 0, -0.5, 3.6, 0.07, 0.06, 8, PS.steel);
  k.ink.cylinder(0, 0, 3.6, 3.65, 0.065, 0.0, 8, PS.steel);
  // bracket and head
  k.ink.box(-0.04, 2.55, 0.04, 0.04, 2.62, 0.14, PS.darksteel);
  k.ink.box(-0.04, 3.3, 0.04, 0.04, 3.37, 0.14, PS.darksteel);
  k.ink.box(-0.19, 2.4, 0.12, 0.19, 3.48, 0.34, PS.darksteel);
  // visors over each lamp
  for (const y of [3.42, 2.9]) {
    k.ink.box(-0.17, y, 0.34, 0.17, y + 0.03, 0.55, PS.darksteel);
    k.ink.box(-0.17, y - 0.42, 0.34, -0.15, y, 0.55, PS.darksteel);
    k.ink.box(0.15, y - 0.42, 0.34, 0.17, y, 0.55, PS.darksteel);
  }
  quad(k.w, [-0.16, 2.46, 0.345], [0.16, 2.46, 0.345], [0.16, 3.43, 0.345], [-0.16, 3.43, 0.345], rectUV(ATLAS.st_props_a[green ? 'ped_green' : 'ped_red']), k.L('st_props_a'));
  // push button box facing the sidewalk side (-Z)
  k.ink.box(-0.11, 1.05, -0.2, 0.11, 1.4, -0.06, PS.yellow);
  quad(k.w, [0.1, 1.07, -0.205], [-0.1, 1.07, -0.205], [-0.1, 1.38, -0.205], [0.1, 1.38, -0.205], rectUV(ATLAS.st_props_a.button), k.L('st_props_a'));
  k.light(0, green ? 2.7 : 3.2, 0.6, green ? [0.3, 1.0, 0.75] : RED, 3);
}
/** Curve mirror (カーブミラー): orange pole, one or two round convex mirrors facing +Z. */
function mirror(k: Ctx) {
  const two = k.r.chance(0.4);
  k.ink.cylinder(0, 0, -0.5, 3.0, 0.045, 0.04, 8, PS.orange);
  const heads = two ? [-0.4, 0.4] : [0];
  if (two) k.ink.box(-0.45, 2.9, -0.03, 0.45, 2.96, 0.03, PS.orange);
  for (const hx of heads) {
    const yaw = two ? -hx * 0.9 : 0;
    k.push(mul(tr(hx, 3.0, 0.05), rotY(yaw), rotX(-0.12)));
    const R = 0.4, seg = 14;
    const pts = Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return [Math.cos(a) * (R + 0.04), Math.sin(a) * (R + 0.04)]; });
    iprism(k.ink, pts, 0, 0, 0.02, 0.09, PS.orange);
    const mpts = Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return [Math.cos(a) * R, Math.sin(a) * R]; });
    facePoly(k.w, mpts, 0, 0, 0.095, ATLAS.st_props_a.mirror, 0.87, k.L('st_props_a'));
    // visor
    k.ink.box(-0.3, R + 0.02, 0.06, 0.3, R + 0.05, 0.22, PS.orange);
    k.pop();
  }
}
function hydrantSign(k: Ctx) {
  k.ink.cylinder(0, 0, -0.5, 2.6, 0.035, 0.035, 8, PS.red);
  k.ink.box(-0.22, 2.2, 0.035, 0.22, 2.58, 0.05, PS.red);
  quad(k.w, [-0.2, 2.22, 0.052], [0.2, 2.22, 0.052], [0.2, 2.56, 0.052], [-0.2, 2.56, 0.052], rectUV(ATLAS.st_props_a.hydrant), k.L('st_props_a'));
}
/** 視線誘導標: white post with a round amber reflector. */
function delineator(k: Ctx) {
  cylW(k.w, 0, 0, -0.3, 1.0, 0.04, 0.04, 6, METAL(k, [0.95, 0.95, 0.95], [0.5, 1]), METAL(k, [0.9, 0.9, 0.9]));
  const pts = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return [Math.cos(a) * 0.05, Math.sin(a) * 0.05]; });
  facePoly(k.w, pts, 0, 0.88, 0.045, ATLAS.st_props_a.lens_amber, 0.12, k.L('st_props_a'));
}
function garbageStation(k: Ctx) {
  const bags: RGB[] = [[0.96, 0.96, 0.98], [0.92, 0.95, 1.0], [0.85, 0.9, 0.98], [1.0, 0.95, 0.75]];
  const bag = (x: number, z: number, r: number, c: RGB) => blob(k.w, x, r * 0.75, z, r, r * 0.8, r * 0.95, { l: k.L('st_metal'), band: BANDS.plate, tint: c, g: [0.4, 1] } as Face, k.r, { lat: 3, lon: 6, jitter: 0.18, flat: 0.5 });
  const n = k.r.int(4, 7);
  for (let i = 0; i < n; i++) bag(-0.7 + k.r.next() * 1.4, -0.3 - k.r.next() * 0.6, 0.25 + k.r.next() * 0.12, bags[i % bags.length]);
  // green net draped over the pile
  const net = rectUV(ATLAS.st_props_b.garbage_net), LB = k.L('st_props_b');
  card(k.w, [-1.0, 0.05, -0.05], [1.0, 0.05, -0.05], [1.0, 0.62, -0.45], [-1.0, 0.62, -0.45], [0, 0.7, 0.7], net, LB);
  card(k.w, [-1.0, 0.62, -0.45], [1.0, 0.62, -0.45], [1.0, 0.05, -1.05], [-1.0, 0.05, -1.05], [0, 0.7, -0.7], net, LB);
  // the collection-day sign on a short post
  cylW(k.w, -1.15, -0.6, -0.2, 1.2, 0.03, 0.03, 6, METAL(k, [0.8, 0.8, 0.82]));
  boxW(k.w, -1.45, 0.8, -0.58, -0.85, 1.25, -0.55, { pz: k.A('st_props_b', 'garbage_sign'), nz: METAL(k, [0.8, 0.8, 0.82]), px: METAL(k, [0.8, 0.8, 0.82]), nx: METAL(k, [0.8, 0.8, 0.82]), top: METAL(k, [0.8, 0.8, 0.82]) });
}
/** 石灯籠: granite stone lantern with a glowing paper window. */
function stoneLantern(k: Ctx) {
  const st = k.A('st_props_b', 'stone', undefined, [0.35, 1]);
  // weathered granite: the smooth concrete surface, cooled and darkened
  const gr = { layer: k.L('st_concrete'), tile: [0.8, 0.8] as [number, number], color: [0.8, 0.82, 0.84] as RGB };
  const S6 = (r: number) => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]; });
  k.w.prism(S6(0.36), -0.3, 0.12, gr, gr, { gBase: 0.3, gTop: 0.6 });
  cylW(k.w, 0, 0, 0.12, 0.85, 0.13, 0.11, 8, st);
  k.w.prism(S6(0.3), 0.85, 1.0, gr, gr, { gBase: 0.6, gTop: 0.8 });
  // firebox with lit windows front and back
  const fb = 0.2;
  boxW(k.w, -fb, 1.0, -fb, fb, 1.38, fb, { pz: k.A('st_props_b', 'lantern_win', undefined, [1, 1]), nz: k.A('st_props_b', 'lantern_win', undefined, [1, 1]), px: st, nx: st, top: null });
  // roof: low hexagonal pyramid with upturned corners (simplified) and a jewel finial
  const R = 0.45, yb = 1.38, yt = 1.62;
  const ring = S6(R);
  for (let i = 0; i < 6; i++) {
    const a = ring[i], b = ring[(i + 1) % 6];
    _a.set(a[0], yb + 0.04, a[1]); _b.set(b[0], yb + 0.04, b[1]); _c.set(0, yt, 0);
    k.w.tri(_a, _c, _b, { layer: gr.layer, color: [0.76, 0.78, 0.8] }, [0, 0, 0.3, 0.25, 0.6, 0], 0.9);
    quad(k.w, [b[0], yb, b[1]], [a[0], yb, a[1]], [a[0], yb + 0.04, a[1]], [b[0], yb + 0.04, b[1]], [0, 0, 0.6, 0.05], gr.layer, [0.72, 0.74, 0.76], 0.8, 0.8);
  }
  cylW(k.w, 0, 0, yt - 0.02, yt + 0.1, 0.06, 0.02, 6, st, st);
  k.light(0, 1.2, 0.0, WARM, 4);
}
function bench(k: Ctx) {
  const wood = k.A('st_props_b', 'wood', undefined, [0.6, 1]);
  const leg = k.T('concrete', [0.85, 0.85, 0.87], [0.4, 1]);
  for (const x of [-0.7, 0.7]) boxW(k.w, x - 0.06, -0.2, -0.45, x + 0.06, 0.42, -0.05, { all: leg });
  for (let i = 0; i < 3; i++) boxW(k.w, -0.95, 0.42, -0.44 + i * 0.13, 0.95, 0.47, -0.33 + i * 0.13, { all: wood }, [0.8, 1]);
}
function cabinet(k: Ctx) {
  const c = METAL(k, [0.78, 0.8, 0.76], [0.45, 1]);
  boxW(k.w, -0.35, -0.2, -0.45, 0.35, 0.15, -0.05, { all: k.T('concrete') });
  boxW(k.w, -0.32, 0.15, -0.42, 0.32, 1.45, -0.08, { pz: k.A('st_props_b', 'cabinet', undefined, [0.45, 1]), nz: c, px: c, nx: c, top: c });
  boxW(k.w, -0.34, 1.45, -0.44, 0.34, 1.5, -0.06, { all: c });
}
function quayBollard(k: Ctx) {
  const b = k.A('st_docks', 'bollard', undefined, [0.4, 1]);
  cylW(k.w, 0, 0, -0.2, 0.55, 0.24, 0.2, 10, { ...b }, null);
  cylW(k.w, 0, 0, 0.55, 0.7, 0.32, 0.32, 10, METAL(k, [0.16, 0.16, 0.2]), METAL(k, [0.9, 0.75, 0.1]));
}
function drums(k: Ctx) {
  const n = k.r.int(2, 4);
  const drum = k.A('st_docks', 'drum', undefined, [0.45, 1]);
  const tints: RGB[] = [[1, 1, 1], [1.6, 0.5, 0.45], [1.1, 1.3, 0.6], [1.4, 1.2, 0.4]];
  for (let i = 0; i < n; i++) {
    const x = (i % 2) * 0.62 - 0.3, z = -Math.floor(i / 2) * 0.62 - 0.3;
    const t = tints[k.r.int(0, 3)];
    cylW(k.w, x, z, -0.05, 0.88, 0.29, 0.29, 10, { ...drum, tint: t }, METAL(k, [t[0] * 0.3, t[1] * 0.4, t[2] * 0.6]));
  }
}
function pallets(k: Ctx) {
  const n = k.r.int(3, 7);
  const side = k.A('st_docks', 'pallet', undefined, [0.5, 1]), top = k.A('st_props_b', 'wood');
  for (let i = 0; i < n; i++) {
    const y = i * 0.15, dx = (k.r.next() - 0.5) * 0.1;
    boxW(k.w, -0.55 + dx, y, -1.2, 0.55 + dx, y + 0.15, 0, { pz: side, nz: side, px: side, nx: side, top: i === n - 1 ? top : null });
  }
}
function shed(k: Ctx) {
  // small steel farm shed on a concrete pad, mono-pitch roof, sliding doors, tarp-covered junk
  const W = 3.0, D = 2.2, hf = 2.3, hb = 2.0;
  const wallT: RGB = k.r.pick([[0.92, 0.88, 0.75], [0.62, 0.8, 0.86], [0.85, 0.78, 0.7]] as RGB[]);
  const wall: Face = { ...k.B('corrugated', wallT), g: [0.35, 1] };
  boxW(k.w, -W / 2 - 0.15, -0.6, -D - 0.15, W / 2 + 0.15, 0.08, 0.15, { all: k.T('concrete'), bot: null });
  // walls (front with doors + window side)
  quad(k.w, [-W / 2, 0.08, 0], [W / 2, 0.08, 0], [W / 2, hf, 0], [-W / 2, hf, 0], faceUV(wall, W, 0, hf - 0.08), wall.l, wallT, 0.35, 1);
  quad(k.w, [W / 2, 0.08, -D], [-W / 2, 0.08, -D], [-W / 2, hb, -D], [W / 2, hb, -D], faceUV(wall, W, 0, hb - 0.08), wall.l, wallT, 0.35, 1);
  for (const s of [1, -1]) {
    const x = (s * W) / 2;
    const a = s > 0 ? [x, 0.08, 0] : [x, 0.08, -D], b = s > 0 ? [x, 0.08, -D] : [x, 0.08, 0];
    const ha = s > 0 ? hf : hb, hb2 = s > 0 ? hb : hf;
    const uv = faceUV(wall, D, 0, hf - 0.08);
    k.w.quadUV(new Vector3(...(a as [number, number, number])), new Vector3(...(b as [number, number, number])), new Vector3(b[0], hb2, b[2]), new Vector3(a[0], ha, a[2]), [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3] - (hf - hb2) / 2.4 * 0, uv[0], uv[3]], { layer: wall.l, color: wallT }, 0.35, 1);
  }
  const door = k.A('st_props_b', 'shed_door', undefined, [0.45, 1]);
  quad(k.w, [-1.25, 0.1, 0.02], [-0.05, 0.1, 0.02], [-0.05, 1.95, 0.02], [-1.25, 1.95, 0.02], door.uv!, door.l);
  quad(k.w, [0.0, 0.1, 0.04], [1.2, 0.1, 0.04], [1.2, 1.95, 0.04], [0.0, 1.95, 0.04], door.uv!, door.l);
  quad(k.w, [W / 2 + 0.01, 1.0, -0.6], [W / 2 + 0.01, 1.0, -1.4], [W / 2 + 0.01, 1.6, -1.4], [W / 2 + 0.01, 1.6, -0.6], rectUV(ATLAS.st_props_b.shed_window), k.L('st_props_b'));
  // roof sloping back, rusty corrugated
  const roofT: RGB = [0.75, 0.42, 0.3];
  const ov = 0.25;
  const r0 = [-W / 2 - ov, hf + 0.05, ov], r1 = [W / 2 + ov, hf + 0.05, ov], r2 = [W / 2 + ov, hb - 0.02, -D - ov], r3 = [-W / 2 - ov, hb - 0.02, -D - ov];
  quad(k.w, r0, r1, r2, r3, [0, 0, (W + 2 * ov) / 4, 0.25], k.L('st_metal'), roofT);
  quad(k.w, r1, r0, r3, r2, [0, 0, (W + 2 * ov) / 4, 0.25], k.L('st_metal'), [0.4, 0.3, 0.3]);
  // tarp-covered heap and a drum beside
  blob(k.w, -W / 2 - 0.9, 0.35, -0.9, 0.75, 0.5, 0.9, { l: k.L('st_props_b'), uv: rectUV(ATLAS.st_props_b.tarp), tile: [40, 40], tint: [1, 1, 1] } as Face, k.r, { lat: 3, lon: 7, jitter: 0.12, flat: 0.6 });
  cylW(k.w, W / 2 + 0.55, -0.4, 0.0, 0.88, 0.29, 0.29, 10, k.A('st_docks', 'drum', [0.8, 1.0, 0.6]), METAL(k, [0.3, 0.4, 0.3]));
}

// ───────────────────────────────────── road signs ─────────────────────────────────────

type SignShape = 'tri' | 'disc' | 'diamond' | 'square' | 'rect_wide' | 'chevron' | 'plate' | 'board';
const SHAPES: Record<SignShape, { pts: number[][]; cellM: number }> = {
  tri: { pts: [[-0.4, 0.3464], [0, -0.3464], [0.4, 0.3464]], cellM: 0.8 * 170 / 162 },
  disc: { pts: Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return [Math.cos(a) * 0.3, Math.sin(a) * 0.3]; }), cellM: 0.6 * 170 / 166 },
  diamond: { pts: [[0, -0.33], [0.33, 0], [0, 0.33], [-0.33, 0]], cellM: 0.66 * 170 / 168 },
  square: { pts: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], cellM: 0.6 },
  rect_wide: { pts: [[-0.3, -0.15], [0.3, -0.15], [0.3, 0.15], [-0.3, 0.15]], cellM: 0.6 },
  chevron: { pts: [[-0.225, -0.3], [0.225, -0.3], [0.225, 0.3], [-0.225, 0.3]], cellM: 0.6 },
  plate: { pts: [[-0.3, -0.127], [0.3, -0.127], [0.3, 0.127], [-0.3, 0.127]], cellM: 0.6 },
  board: { pts: [[-0.275, -0.467], [0.275, -0.467], [0.275, 0.467], [-0.275, 0.467]], cellM: 0.935 },
};
/** One sign face on the post at height cy (centre), inked backing plate + painted face at +Z. */
function signFace(k: Ctx, name: string, shape: SignShape, cy: number, cx = 0, backSlot: number = PS.steel) {
  const sh = SHAPES[shape];
  const sc = SIGN_CELLS[name];
  // backing slightly larger than the face, so its ink outlines the sign
  const grow = (p: number[]) => { const l = Math.hypot(p[0], p[1]) || 1; return [p[0] + (p[0] / l) * 0.008, p[1] + (p[1] / l) * 0.008]; };
  iprism(k.ink, sh.pts.map(grow), cx, cy, 0.04, 0.055, backSlot);
  facePoly(k.w, sh.pts, cx, cy, 0.058, sc.cell, sh.cellM, k.L(sc.layer), [1.15, 1.15, 1.15]);
  // clamp bands around the post
  k.ink.box(cx - 0.05, cy - 0.04, -0.045, cx + 0.05, cy + 0.04, 0.042, PS.darksteel);
}
function signPost(k: Ctx, h: number, x = 0) {
  k.ink.cylinder(x, 0, -0.5, h, 0.0305, 0.0305, 8, PS.steel);
  k.ink.cylinder(x, 0, h, h + 0.03, 0.033, 0.0, 8, PS.steel);
}
function speedOf(type: string, k: Ctx): string {
  const m = type.match(/(\d\d)$/);
  return 'speed' + (m ? m[1] : k.r.pick(['30', '40', '50', '60']));
}

// ───────────────────────────────────── prop dispatcher ─────────────────────────────────────

/** Every prop type buildProp understands. */
export const PROP_TYPES = [
  'lamp_arterial', 'lamp_avenue', 'lamp_oldtown', 'lamp_suburb', 'lamp_docks', 'utility_pole',
  'tree_street', 'tree_cherry', 'tree_pine', 'shrub', 'hedge',
  'vending_machine', 'bus_stop', 'post_box', 'bicycles', 'cone', 'barrier', 'planter', 'bollard', 'phone_box',
  'signal_pole', 'mirror', 'hydrant', 'delineator', 'garbage_station', 'stone_lantern', 'bench', 'cabinet',
  'container_stack', 'gantry_crane', 'quay_crane', 'quay_bollard', 'drums', 'pallets', 'shed',
  'sign_stop', 'sign_slow', 'sign_speed', 'sign_speed_30', 'sign_speed_40', 'sign_speed_50', 'sign_speed_60',
  'sign_curve_l', 'sign_curve_r', 'sign_hairpin', 'sign_hairpin_l', 'sign_hairpin_r', 'chevron_l', 'chevron_r', 'chevron_l_y', 'chevron_r_y',
  'sign_crossing', 'sign_noparking', 'sign_nostopping', 'sign_noentry', 'sign_oneway', 'sign_roadworks', 'sign_children', 'sign_signal', 'works_board',
] as const;
export type PropType = (typeof PROP_TYPES)[number];

/**
 * Builds a street prop in its local frame (origin on the ground, street side +Z; signs face +Z).
 * Lamp posts, poles, sign posts and the mirror are inked; everything else is painted.
 */
export function buildProp(world: WorldGeom, inked: InkedGeom, L: LayerFn, type: string, seed: number): PropResult {
  const k = new Ctx(world, inked, L, new Rng(hash32(seed, 0x57ee7)));
  switch (type) {
    case 'lamp_arterial': lampArterial(k); break;
    case 'lamp_avenue': lampAvenue(k); break;
    case 'lamp_oldtown': lampOldtown(k); break;
    case 'lamp_suburb': lampSuburb(k); break;
    case 'lamp_docks': lampDocks(k); break;
    case 'utility_pole': utilityPole(k); break;
    case 'tree_street': treeStreet(k); break;
    case 'tree_cherry': treeCherry(k); break;
    case 'tree_pine': treePine(k); break;
    case 'shrub': shrub(k); break;
    case 'hedge': hedge(k); break;
    case 'vending_machine': vendingMachine(k); break;
    case 'bus_stop': busStop(k); break;
    case 'post_box': postBox(k); break;
    case 'bicycles': bicycles(k); break;
    case 'cone': cone(k); break;
    case 'barrier': barrier(k); break;
    case 'planter': planter(k); break;
    case 'bollard': bollard(k); break;
    case 'phone_box': phoneBox(k); break;
    case 'signal_pole': signalPole(k); break;
    case 'mirror': mirror(k); break;
    case 'hydrant': hydrantSign(k); break;
    case 'delineator': delineator(k); break;
    case 'garbage_station': garbageStation(k); break;
    case 'stone_lantern': stoneLantern(k); break;
    case 'bench': bench(k); break;
    case 'cabinet': cabinet(k); break;
    case 'container_stack': containerStack(k); break;
    case 'gantry_crane': gantryCrane(k); break;
    case 'quay_crane': quayCrane(k); break;
    case 'quay_bollard': quayBollard(k); break;
    case 'drums': drums(k); break;
    case 'pallets': pallets(k); break;
    case 'shed': shed(k); break;
    case 'sign_stop': signPost(k, 2.5); signFace(k, 'stop', 'tri', 2.1); break;
    case 'sign_slow': signPost(k, 2.5); signFace(k, 'slow', 'tri', 2.1); break;
    case 'sign_speed': case 'sign_speed_30': case 'sign_speed_40': case 'sign_speed_50': case 'sign_speed_60':
      signPost(k, 2.6); signFace(k, speedOf(type, k), 'disc', 2.25); break;
    case 'sign_noparking': signPost(k, 2.6); signFace(k, 'noparking', 'disc', 2.25); break;
    case 'sign_nostopping': signPost(k, 2.6); signFace(k, 'nostopping', 'disc', 2.25); break;
    case 'sign_noentry': signPost(k, 2.6); signFace(k, 'noentry', 'disc', 2.25); break;
    case 'sign_oneway': signPost(k, 2.6); signFace(k, 'oneway', 'rect_wide', 2.35); break;
    case 'sign_curve_l': case 'sign_curve_r':
      signPost(k, 2.6); signFace(k, type === 'sign_curve_l' ? 'curve_l' : 'curve_r', 'diamond', 2.2);
      signFace(k, k.r.chance(0.5) ? 'plate_kono' : 'plate_kyu', 'plate', 1.68); break;
    case 'sign_hairpin': case 'sign_hairpin_l': case 'sign_hairpin_r': {
      const d = type === 'sign_hairpin' ? (k.r.chance(0.5) ? 'l' : 'r') : type.slice(-1);
      signPost(k, 2.6); signFace(k, 'hairpin_' + d, 'diamond', 2.2); signFace(k, 'plate_hairpin', 'plate', 1.68); break;
    }
    case 'chevron_l': case 'chevron_r': case 'chevron_l_y': case 'chevron_r_y':
      signPost(k, 1.75); signFace(k, type, 'chevron', 1.35, 0, PS.white); break;
    case 'sign_crossing': {
      // internally lit box sign, double-sided, on a post
      signPost(k, 3.1);
      k.ink.box(-0.33, 2.32, -0.09, 0.33, 2.98, 0.09, PS.white);
      const sc = SIGN_CELLS.crossing;
      facePoly(k.w, SHAPES.square.pts, 0, 2.65, 0.095, sc.cell, 0.6, L(sc.layer));
      k.push(rotY(Math.PI)); facePoly(k.w, SHAPES.square.pts, 0, 2.65, 0.095, sc.cell, 0.6, L(sc.layer)); k.pop();
      k.light(0, 2.65, 0.3, [0.85, 0.92, 1.0], 5);
      break;
    }
    case 'sign_roadworks': signPost(k, 2.4); signFace(k, 'roadworks', 'diamond', 2.0); break;
    case 'sign_children': signPost(k, 2.6); signFace(k, 'children', 'diamond', 2.2); break;
    case 'sign_signal': signPost(k, 2.6); signFace(k, 'signal', 'diamond', 2.2); break;
    case 'works_board': {
      // free-standing 工事看板 on a folding steel stand
      const leg = METAL(k, [0.85, 0.86, 0.88]);
      for (const x of [-0.24, 0.24]) tubeW(k.w, [[x, -0.05, -0.35, 0.02], [x, 1.25, 0.0, 0.02]], 4, leg, false);
      k.ink.box(-0.3, 0.32, -0.02, 0.3, 1.32, 0.0, PS.white);
      facePoly(k.w, SHAPES.board.pts, 0, 0.82, 0.004, SIGN_CELLS.works.cell, 0.935, L('rs_c'));
      break;
    }
    default:
      throw new Error('unknown street prop ' + type);
  }
  return k.result();
}

// ───────────────────────────────────── docks ─────────────────────────────────────

/** One container lying along X: length 12.2 (40 ft) or 6.06 (20 ft), 2.44 wide, 2.59 tall. */
function container(k: Ctx, x0: number, y0: number, z0: number, len: number, livery: number, plainTint: RGB) {
  const W = 2.44, H = 2.59;
  const x1 = x0 + len, z1 = z0 + W;
  const branded = livery >= 0 && len > 10;
  // 20 ft boxes of a line wear its colour without the full-length logo
  if (!branded && livery >= 0) plainTint = LIVERY_TINT[livery];
  const side: Face = branded ? { ...k.B(('cont' + livery) as 'cont0'), g: [0.55, 1] } : { ...k.B('corrugated', plainTint), g: [0.55, 1] };
  const door: Face = livery >= 0 ? k.A('st_docks', 'door' + livery, undefined, [0.55, 1]) : { ...k.A('st_docks', 'door0'), tint: [plainTint[0] * 1.6, plainTint[1] * 1.6, plainTint[2] * 1.6], g: [0.55, 1] };
  const end: Face = branded ? { ...k.B('corrugated', LIVERY_TINT[livery]), g: [0.55, 1] } : { ...k.B('corrugated', plainTint), g: [0.55, 1] };
  const top: Face = { ...k.B('corrugated', branded ? LIVERY_TINT[livery] : plainTint), tint: (branded ? LIVERY_TINT[livery] : plainTint).map((v) => v * 0.85) as RGB };
  boxW(k.w, x0, y0, z0, x1, y0 + H, z1, { pz: side, nz: side, px: door, nx: end, top });
}
const LIVERY_TINT: RGB[] = [[0.62, 0.22, 0.18], [0.14, 0.36, 0.7], [0.2, 0.56, 0.36], [0.92, 0.48, 0.15]];
// common box colours: maroon, navy, deep green, orange, grey, off-white, sky blue, mustard
const PLAIN_TINTS: RGB[] = [[0.56, 0.17, 0.14], [0.13, 0.22, 0.5], [0.16, 0.42, 0.28], [0.9, 0.42, 0.12], [0.58, 0.6, 0.64], [0.9, 0.9, 0.87], [0.22, 0.45, 0.75], [0.78, 0.56, 0.18]];
/** Stacked containers: two rows deep, 1–4 high per column, seeded liveries. Footprint 12.6 × 5.4 m. */
function containerStack(k: Ctx) {
  // dock pad under the stack
  boxW(k.w, -6.4, -1.5, -5.6, 6.4, 0.02, 0.1, { all: k.T('dock', [0.92, 0.92, 0.92]), top: k.T('dock'), bot: null }, [0.3, 0.6]);
  for (let row = 0; row < 2; row++) {
    const z0 = -2.5 - row * 2.6;
    const h = k.r.int(row === 0 ? 1 : 2, 4);
    const forty = k.r.chance(0.65);
    for (let t = 0; t < h; t++) {
      const y0 = 0.02 + t * 2.6;
      if (forty) {
        const liv = k.r.chance(0.7) ? k.r.int(0, 3) : -1;
        container(k, -6.1, y0, z0, 12.2, liv, k.r.pick(PLAIN_TINTS));
      } else {
        for (const x0 of [-6.1, 0.04]) container(k, x0, y0, z0, 6.06, k.r.chance(0.4) ? k.r.int(0, 3) : -1, k.r.pick(PLAIN_TINTS));
      }
    }
  }
}
/** Rubber-tyred gantry crane (RTG) straddling a container block. Span 23.5 m, height ~21 m. */
function gantryCrane(k: Ctx) {
  const X = 11.6, Z0 = -1.0, Z1 = -8.0, H = 19.5;
  const legT: RGB = [0.95, 0.95, 0.95], beamT: RGB = [0.92, 0.25, 0.2];
  const leg: Face = { ...k.B('girder', legT), g: [0.3, 1] };
  const beam: Face = { ...k.B('girder', beamT), g: [0.6, 1] };
  const hz: Face = { ...k.B('hazard'), g: [0.5, 1] };
  for (const sx of [-1, 1]) {
    // sill beam with tyres
    boxW(k.w, sx * X - 0.6, 0.9, Z1 - 1.0, sx * X + 0.6, 1.6, Z0 + 1.0, { all: { ...k.B('girder', [0.3, 0.32, 0.38]) } });
    for (const z of [Z0 + 0.4, Z1 - 0.4]) {
      const tyre = k.A('st_docks', 'tyre', undefined, [0.6, 1]);
      boxW(k.w, sx * X - 0.55, -0.05, z - 0.8, sx * X + 0.55, 1.55, z + 0.8, { px: tyre, nx: tyre, pz: METAL(k, [0.14, 0.14, 0.17]), nz: METAL(k, [0.14, 0.14, 0.17]), top: METAL(k, [0.14, 0.14, 0.17]) });
    }
    // legs (slightly splayed outward)
    for (const z of [Z0, Z1]) {
      boxW(k.w, sx * X - 0.4, 1.6, z - 0.4, sx * X + 0.4, H, z + 0.4, { all: leg, top: null });
      boxW(k.w, sx * X - 0.42, 1.6, z - 0.42, sx * X + 0.42, 2.4, z + 0.42, { all: hz, top: null });
    }
    // portal tie between the legs near the top
    boxW(k.w, sx * X - 0.35, H - 2.2, Z1, sx * X + 0.35, H - 1.4, Z0, { all: leg });
  }
  // main girders (red), name board on the street-facing girder
  for (const z of [Z0, Z1]) boxW(k.w, -X - 0.8, H, z - 0.5, X + 0.8, H + 1.6, z + 0.5, { all: beam });
  const nb = k.A('st_docks', 'terminal', undefined, [1, 1]);
  quad(k.w, [-6, H + 0.1, Z0 + 0.52], [6, H + 0.1, Z0 + 0.52], [6, H + 1.5, Z0 + 0.52], [-6, H + 1.5, Z0 + 0.52], nb.uv!, nb.l);
  // trolley and operator cab
  const tx = k.r.range(-5, 5);
  boxW(k.w, tx - 2.0, H + 1.6, Z1 - 0.6, tx + 2.0, H + 3.0, Z0 + 0.6, { all: METAL(k, [0.92, 0.93, 0.95]), top: METAL(k, [0.8, 0.8, 0.85]) });
  const cab = k.A('st_docks', 'cab', undefined, [0.8, 1]);
  boxW(k.w, tx + 0.5, H - 2.2, Z0 - 0.2, tx + 2.3, H, Z0 + 1.4, { pz: cab, nz: METAL(k, [0.95, 0.95, 0.95]), px: cab, nx: METAL(k, [0.95, 0.95, 0.95]), top: null });
  // spreader hanging on cables
  const sy = k.r.range(6, 13);
  boxW(k.w, tx - 3.0, sy, -5.4, tx + 3.0, sy + 0.5, -3.6, { all: { ...k.B('hazard'), g: [0.7, 1] } });
  for (const [cx, cz] of [[-1.8, -4.0], [1.8, -4.0], [-1.8, -5.0], [1.8, -5.0]]) boxW(k.w, tx + cx - 0.03, sy + 0.5, cz - 0.03, tx + cx + 0.03, H + 1.6, cz + 0.03, { all: { l: -1, tint: [0.12, 0.12, 0.15] } });
  // electrical house on one sill
  boxW(k.w, X - 0.9, 1.6, Z1 + 1.0, X + 0.9, 4.0, Z1 + 3.2, { all: METAL(k, [0.93, 0.93, 0.95]), top: METAL(k, [0.75, 0.75, 0.8]) });
  // floodlights under the girders, shining down into the block
  for (const fx of [-6, 6]) for (const z of [Z0, Z1]) {
    boxW(k.w, fx - 0.4, H - 0.25, z - 0.3, fx + 0.4, H, z + 0.3, { all: METAL(k, [0.25, 0.25, 0.3]) });
    quadN(k.w, [fx - 0.34, H - 0.26, z - 0.24], [fx + 0.34, H - 0.26, z - 0.24], [fx + 0.34, H - 0.26, z + 0.24], [fx - 0.34, H - 0.26, z + 0.24], [0, -1, 0], rectUV(ATLAS.st_props_a.lens_white), k.L('st_props_a'));
  }
  k.light(-6, H - 0.3, (Z0 + Z1) / 2, NEUTRAL, 22);
  k.light(6, H - 0.3, (Z0 + Z1) / 2, NEUTRAL, 22);
}
/** Ship-to-shore quay crane: an A-frame landmark for the docks skyline (~48 m to the apex). */
function quayCrane(k: Ctx) {
  const legT: RGB = [0.95, 0.4, 0.22];
  const leg: Face = { ...k.B('girder', legT), g: [0.25, 1] };
  const white: Face = { ...k.B('girder', [0.95, 0.95, 0.95]), g: [0.5, 1] };
  const gauge = 15, X = 9, H = 38;
  // four legs on rails, portal beams
  for (const sx of [-1, 1]) for (const z of [0, -gauge]) {
    boxW(k.w, sx * X - 0.7, -0.2, z - 0.7, sx * X + 0.7, H, z + 0.7, { all: leg, top: null });
    boxW(k.w, sx * X - 1.0, -0.2, z - 1.6, sx * X + 1.0, 1.4, z + 1.6, { all: METAL(k, [0.2, 0.2, 0.24]) });
  }
  for (const z of [0, -gauge]) boxW(k.w, -X - 0.7, H - 2.5, z - 0.6, X + 0.7, H, z + 0.6, { all: leg });
  for (const sx of [-1, 1]) boxW(k.w, sx * X - 0.6, H - 2.0, -gauge, sx * X + 0.6, H - 0.8, 0, { all: leg });
  // boom over the water (+Z) and back-reach, white with the name board
  const by = H + 2;
  for (const sx of [-1, 1]) boxW(k.w, sx * 4.0 - 0.6, by, -gauge - 14, sx * 4.0 + 0.6, by + 2.2, 34, { all: white });
  boxW(k.w, -4.6, by + 2.2, -gauge - 2, 4.6, by + 2.6, -gauge + 2, { all: white });
  // A-frame apex with forestays
  const ax = [0, H + 11, -gauge * 0.5];
  for (const sx of [-1, 1]) for (const z of [0, -gauge]) tubeW(k.w, [[sx * X * 0.5, H, z, 0.45], [ax[0] + sx * 1.2, ax[1], ax[2], 0.4]], 6, leg, false, [0.4, 1]);
  for (const sx of [-1, 1]) {
    tubeW(k.w, [[sx * 1.2, ax[1], ax[2], 0.1], [sx * 4.0, by + 2.2, 30, 0.1]], 4, METAL(k, [0.2, 0.2, 0.25]), false);
    tubeW(k.w, [[sx * 1.2, ax[1], ax[2], 0.1], [sx * 4.0, by + 2.2, -gauge - 13, 0.1]], 4, METAL(k, [0.2, 0.2, 0.25]), false);
  }
  // machinery house on the back-reach, trolley + cab on the boom
  boxW(k.w, -4.5, by + 2.2, -gauge - 13, 4.5, by + 6.5, -gauge - 6, { all: METAL(k, [0.95, 0.95, 0.96]), top: METAL(k, [0.8, 0.8, 0.85]) });
  const nb = k.A('st_docks', 'terminal', undefined, [1, 1]);
  quad(k.w, [4.51, by + 2.6, -gauge - 6.5], [4.51, by + 2.6, -gauge - 12.5], [4.51, by + 6.2, -gauge - 12.5], [4.51, by + 6.2, -gauge - 6.5], nb.uv!, nb.l);
  const cab = k.A('st_docks', 'cab', undefined, [0.8, 1]);
  const cz = k.r.range(4, 22);
  boxW(k.w, -3.0, by + 2.2, cz - 2, 3.0, by + 3.4, cz + 2, { all: METAL(k, [0.92, 0.93, 0.95]) });
  boxW(k.w, 1.0, by - 2.6, cz - 1.0, 3.2, by, cz + 1.2, { pz: cab, px: cab, nx: METAL(k, [0.95, 0.95, 0.95]), nz: METAL(k, [0.95, 0.95, 0.95]), top: null });
  // boom floodlights over the berth and the backreach
  for (const fz of [8, 20, -gauge - 4]) for (const sx of [-1, 1]) {
    boxW(k.w, sx * 4.0 - 0.45, by - 0.3, fz - 0.35, sx * 4.0 + 0.45, by, fz + 0.35, { all: METAL(k, [0.25, 0.25, 0.3]) });
    quadN(k.w, [sx * 4.0 - 0.38, by - 0.31, fz - 0.28], [sx * 4.0 + 0.38, by - 0.31, fz - 0.28], [sx * 4.0 + 0.38, by - 0.31, fz + 0.28], [sx * 4.0 - 0.38, by - 0.31, fz + 0.28], [0, -1, 0], rectUV(ATLAS.st_props_a.lens_white), k.L('st_props_a'));
  }
  k.light(0, by - 1, 10, NEUTRAL, 30);
  k.light(0, H - 3, -gauge / 2, NEUTRAL, 26);
}

// ───────────────────────────────────── edges ─────────────────────────────────────

interface Sample { x: number; y: number; z: number; nx: number; nz: number; tx: number; tz: number; s: number }
/** Arc-length sampler over the edge polyline (linear between points, normals interpolated). */
function sampler(pts: EdgePoint[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const at = (s: number): Sample => {
    s = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i];
    const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
    const t = (s - cum[i - 1]) / seg;
    let nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    let tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, nx, nz, tx, tz, s };
  };
  /** samples every ≤ step metres, always including both ends and any multiples of `align` */
  const run = (step: number, align = 0): Sample[] => {
    const n = Math.max(1, Math.ceil(total / step - 1e-6));
    const ss = new Set<number>();
    for (let i = 0; i <= n; i++) ss.add((total * i) / n);
    if (align > 0) for (let s = align; s < total - 0.05; s += align) ss.add(s);
    // keep the polyline's own vertices only where it bends (in plan or in grade) enough to matter
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const l0 = cum[i] - cum[i - 1], l1 = cum[i + 1] - cum[i];
      if (l0 < 1e-6 || l1 < 1e-6) continue;
      const h0 = Math.atan2(p1.z - p0.z, p1.x - p0.x), h1 = Math.atan2(p2.z - p1.z, p2.x - p1.x);
      let dh = Math.abs(h1 - h0); if (dh > Math.PI) dh = 2 * Math.PI - dh;
      const dg = Math.abs((p2.y - p1.y) / l1 - (p1.y - p0.y) / l0);
      if (dh * Math.min(step, l0 + l1) > 0.06 || dg * step > 0.04) ss.add(cum[i]);
    }
    const arr = [...ss].sort((p, q) => p - q).filter((s, i, A) => i === 0 || s - A[i - 1] > 0.05);
    return arr.map(at);
  };
  return { at, run, total };
}
/** Right-handed local frame with +Y up and +Z along the horizontal (zx, zz), origin at (x, y, z). */
function basisZ(zx: number, zz: number, x: number, y: number, z: number): Matrix4 {
  const l = Math.hypot(zx, zz) || 1; zx /= l; zz /= l;
  // x = up × z
  return new Matrix4().makeBasis(new Vector3(zz, 0, -zx), new Vector3(0, 1, 0), new Vector3(zx, 0, zz)).setPosition(x, y, z);
}
const off = (p: Sample, d: number, dy = 0): [number, number, number] => [p.x + p.nx * d, p.y + dy, p.z + p.nz * d];
/** True at the run's ends and at multiples of `step` metres (where posts go; other samples only follow the curve). */
const aligned = (p: Sample, S: { total: number }, step: number) => p.s < 0.02 || p.s > S.total - 0.02 || Math.abs(p.s / step - Math.round(p.s / step)) * step < 0.03;

/**
 * Vertical strip between samples a and b, offset `d` along the outward normal, from height h0 to
 * h1 above the local ground. `toward` = -1 faces the road, +1 faces away. u runs with arc length.
 */
function strip(w: WorldGeom, a: Sample, b: Sample, d: number, h0: number, h1: number, toward: 1 | -1, f: Face, uScale: number, g: [number, number] = [0, 1], vOverride?: [number, number]) {
  const A0 = off(a, d, h0), B0 = off(b, d, h0), B1 = off(b, d, h1), A1 = off(a, d, h1);
  let v0: number, v1: number;
  if (vOverride) [v0, v1] = vOverride;
  else if (f.band) [v0, v1] = bandV(f.band, 0, Math.min(f.band.ht, h1 - h0));
  else { const tv = f.tile?.[1] ?? 2; v0 = h0 / tv; v1 = h1 / tv; }
  const ua = a.s / uScale, ub = b.s / uScale;
  // natural normal of A0→B0→B1→A1
  const ex = B0[0] - A0[0], ez = B0[2] - A0[2];
  const nx = -ez, nz = ex; // (B-A) × up
  const facesOut = nx * (a.nx + b.nx) + nz * (a.nz + b.nz) > 0;
  const tint = f.tint;
  if ((facesOut ? 1 : -1) === toward) quad(w, A0, B0, B1, A1, [ua, v0, ub, v1], f.l, tint, g[0], g[1]);
  else w.quadUV(new Vector3(...B0), new Vector3(...A0), new Vector3(...A1), new Vector3(...B1), [ub, v0, ua, v0, ua, v1, ub, v1], { layer: f.l, color: tint }, g[0], g[1]);
}
/** Horizontal strip (cap / ground) between offsets d0..d1 at heights hy0/hy1 (relative to ground), facing up. */
function hstrip(w: WorldGeom, a: Sample, b: Sample, d0: number, d1: number, hy0: number, hy1: number, f: Face, uv?: (s: number, d: number) => [number, number]) {
  const P = [off(a, d0, hy0), off(b, d0, hy0), off(b, d1, hy1), off(a, d1, hy1)];
  const tile = f.tile ?? [2, 2];
  const bv = f.band ? bandV(f.band, 0, f.band.ht) : null;
  const U = (s: number, d: number): [number, number] => {
    if (uv) return uv(s, d);
    // band faces: u along the run, the band's height stretched across the strip's width
    if (bv && f.band) return [s / f.band.len, bv[0] + (bv[1] - bv[0]) * (0.15 + 0.7 * ((d - d0) / ((d1 - d0) || 1)))];
    return [s / tile[0], d / tile[1]];
  };
  const [u0, v0] = U(a.s, d0), [u1, v1] = U(b.s, d0), [u2, v2] = U(b.s, d1), [u3, v3] = U(a.s, d1);
  // upward normal check
  const e1 = [P[1][0] - P[0][0], P[1][2] - P[0][2]], e2 = [P[3][0] - P[0][0], P[3][2] - P[0][2]];
  const up = e1[1] * e2[0] - e1[0] * e2[1] > 0; // y of (e1 × e2)
  const V3 = (p: number[]) => new Vector3(p[0], p[1], p[2]);
  if (up) w.quadUV(V3(P[0]), V3(P[1]), V3(P[2]), V3(P[3]), [u0, v0, u1, v1, u2, v2, u3, v3], { layer: f.l, color: f.tint }, -1, -1);
  else w.quadUV(V3(P[1]), V3(P[0]), V3(P[3]), V3(P[2]), [u1, v1, u0, v0, u3, v3, u2, v2], { layer: f.l, color: f.tint }, -1, -1);
}
/** Vertical cylinder post at a sample. */
function post(w: WorldGeom, p: Sample, d: number, y0: number, y1: number, r: number, seg: number, f: Face, cap: Face | null) {
  const [x, , z] = off(p, d);
  cylW(w, x, z, p.y + y0, p.y + y1, r, r, seg, f, cap, [0.4, 1]);
}
/** Box post aligned with the run at a sample. */
function boxPost(w: WorldGeom, p: Sample, d: number, y0: number, y1: number, hw: number, hd: number, f: Face) {
  const m = basisZ(p.nx, p.nz, p.x + p.nx * d, p.y, p.z + p.nz * d);
  const save = w.m.clone();
  w.m.multiply(m);
  boxW(w, -hw, y0, -hd, hw, y1, hd, { all: f }, [0.3, 1]);
  w.m.copy(save);
}

/**
 * Builds a run of edge (fence, wall, rail or verge) along a polyline at the road edge. pts carry
 * the ground height and the unit normal pointing AWAY from the road. Posts follow the curve and
 * the ground; everything reaches below the ground so slopes never show a gap.
 */
export function buildEdge(world: WorldGeom, inked: InkedGeom, L: LayerFn, type: EdgeType, pts: EdgePoint[], seed: number): { lights: Light[] } {
  const k = new Ctx(world, inked, L, new Rng(hash32(seed, 0xed6e)));
  if (pts.length < 2) return { lights: [] };
  const S = sampler(pts);
  if (S.total < 0.2) return { lights: [] };
  switch (type) {
    case 'guardrail': edgeGuardrail(k, S); break;
    case 'chainlink': edgeChainlink(k, S); break;
    case 'hoarding': edgeHoarding(k, S); break;
    case 'woodfence': edgeWoodfence(k, S); break;
    case 'blockwall': edgeBlockwall(k, S); break;
    case 'verge': edgeVerge(k, S); break;
    case 'railing': edgeRailing(k, S); break;
  }
  return { lights: k.lights };
}
type Smp = ReturnType<typeof sampler>;

function edgeGuardrail(k: Ctx, S: Smp) {
  const w = k.w;
  const col = STRIPS.guardrail, [cu0, cu1] = stripU(col), Lr = k.L(col.layer);
  // W-beam profile (offset toward the road is negative), heights above ground
  const prof: [number, number][] = [[-0.01, 0.78], [-0.075, 0.735], [-0.085, 0.67], [-0.03, 0.605], [-0.085, 0.54], [-0.075, 0.475], [-0.01, 0.43]];
  const runS = S.run(2.0, 4.0);
  // flared ends: extend the run by two samples curling away from the road
  const ext = (p: Sample, dir: number, dist: number, curl: number): Sample => ({ ...p, x: p.x + p.tx * dir * dist + p.nx * curl, z: p.z + p.tz * dir * dist + p.nz * curl, s: p.s + dir * dist });
  const first = runS[0], last = runS[runS.length - 1];
  const all = [ext(first, -1, 1.1, 0.5), ext(first, -1, 0.55, 0.14), ...runS, ext(last, 1, 0.55, 0.14), ext(last, 1, 1.1, 0.5)];
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1];
    for (let j = 0; j < prof.length - 1; j++) {
      const [d0, h0] = prof[j + 1], [d1, h1] = prof[j];
      const P = [off(a, d0, h0), off(b, d0, h0), off(b, d1, h1), off(a, d1, h1)];
      const u0 = cu0 + ((cu1 - cu0) * (prof.length - 2 - j)) / (prof.length - 1), u1 = cu0 + ((cu1 - cu0) * (prof.length - 1 - j)) / (prof.length - 1);
      // the strip texture runs along v: map v to arc length
      const va = a.s / col.len, vb = b.s / col.len;
      const nrm = new Vector3().subVectors(new Vector3(...P[1]), new Vector3(...P[0])).cross(new Vector3().subVectors(new Vector3(...P[3]), new Vector3(...P[0])));
      const towardRoad = nrm.x * a.nx + nrm.z * a.nz < 0;
      const V = (p: number[]) => new Vector3(p[0], p[1], p[2]);
      if (towardRoad) w.quadUV(V(P[0]), V(P[1]), V(P[2]), V(P[3]), [u0, va, u0, vb, u1, vb, u1, va], { layer: Lr }, 0.7, 0.95);
      else w.quadUV(V(P[1]), V(P[0]), V(P[3]), V(P[2]), [u0, vb, u0, va, u1, va, u1, vb], { layer: Lr }, 0.7, 0.95);
    }
    // back face and top lip
    const back: Face = { ...k.B('plate', [0.78, 0.8, 0.84]), tile: [2, 0.5] };
    strip(w, a, b, -0.005, 0.43, 0.78, 1, back, 2, [0.6, 0.85]);
  }
  // posts every 4 m on the far side of the beam, with a spacer block; amber reflectors every 5th post
  const plate = METAL(k, [0.92, 0.93, 0.95]);
  let pi = 0;
  for (const p of runS) {
    if (Math.abs((p.s / 4) - Math.round(p.s / 4)) > 0.01 && p !== runS[0] && p !== runS[runS.length - 1]) continue;
    post(k.w, p, 0.07, -0.9, 0.88, 0.07, 8, plate, plate);
    boxPost(k.w, p, 0.0, 0.5, 0.71, 0.06, 0.03, METAL(k, [0.7, 0.72, 0.76]));
    if (pi % 5 === 2) {
      // reflector on a bracket above the beam, facing along the road both ways
      const [x, y, z] = off(p, -0.02, 0.86);
      const pts = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return [Math.cos(a) * 0.05, Math.sin(a) * 0.05]; });
      for (const dir of [1, -1]) {
        const m = basisZ(-p.tx * dir, -p.tz * dir, x, y, z);
        const save = k.w.m.clone(); k.w.m.multiply(m);
        facePoly(k.w, pts, 0, 0, 0.012, ATLAS.st_props_a.lens_amber, 0.12, k.L('st_props_a'));
        k.w.m.copy(save);
      }
      boxPost(k.w, p, -0.02, 0.78, 0.86, 0.008, 0.008, plate);
    }
    pi++;
  }
}
function edgeChainlink(k: Ctx, S: Smp) {
  const tall = k.r.chance(0.5);
  const H = tall ? 2.4 : 1.8;
  const mesh: Face = { l: k.L('st_chainlink'), tile: [1.2, 1.2], tint: [1, 1, 1] };
  const galv = METAL(k, [0.72, 0.76, 0.78]);
  const runS = S.run(2.5, 2.5);
  for (let i = 0; i < runS.length - 1; i++) {
    const a = runS[i], b = runS[i + 1];
    // double-sided mesh
    strip(k.w, a, b, 0, -0.08, H - 0.06, -1, mesh, 1.2, [0.55, 1], [-0.08 / 1.2, (H - 0.06) / 1.2]);
    strip(k.w, a, b, 0, -0.08, H - 0.06, 1, mesh, 1.2, [0.55, 1], [-0.08 / 1.2, (H - 0.06) / 1.2]);
    // top rail
    const A = off(a, 0, H), B = off(b, 0, H);
    tubeW(k.w, [[...A, 0.022], [...B, 0.022]], 5, galv, false, [0.85, 1]);
    // tension wire at the bottom
    tubeW(k.w, [[...off(a, 0, 0.12), 0.008], [...off(b, 0, 0.12), 0.008]], 3, galv, false, [0.6, 0.7]);
    if (tall) {
      // three strands of barbed wire on outriggers leaning away from the road
      for (const [d, h] of [[0.12, H + 0.15], [0.24, H + 0.3], [0.36, H + 0.45]]) tubeW(k.w, [[...off(a, d, h), 0.007], [...off(b, d, h), 0.007]], 3, METAL(k, [0.45, 0.48, 0.5]), false, [0.8, 0.9]);
    }
  }
  for (const p of runS) {
    if (!aligned(p, S, 2.5)) continue;
    post(k.w, p, 0, -0.6, H + 0.05, 0.032, 6, galv, galv);
    if (tall) tubeW(k.w, [[...off(p, 0, H), 0.018], [...off(p, 0.42, H + 0.5), 0.018]], 4, galv, false, [0.9, 1]);
  }
  // concrete footing kerb under the mesh on dock fences
  if (tall) {
    const runC = S.run(4);
    for (let i = 0; i < runC.length - 1; i++) {
      const a = runC[i], b = runC[i + 1], c = k.T('concrete', [0.9, 0.9, 0.9]);
      strip(k.w, a, b, -0.08, -0.5, 0.15, -1, c, 3, [0.3, 0.6]);
      strip(k.w, a, b, 0.08, -0.5, 0.15, 1, c, 3, [0.3, 0.6]);
      hstrip(k.w, a, b, -0.08, 0.08, 0.15, 0.15, c);
    }
  }
}
function edgeHoarding(k: Ctx, S: Smp) {
  const H = 3.0;
  const lay = k.r.chance(0.5) ? ['hoard_sea', 'hoard_slogan'] : ['hoard_kids', 'hoard_graffiti'];
  const mix2 = k.r.chance(0.5);
  const runS = S.run(2.0, 6.0);
  const back = METAL(k, [0.66, 0.68, 0.72]);
  for (let i = 0; i < runS.length - 1; i++) {
    const a = runS[i], b = runS[i + 1];
    const panel = Math.floor((a.s + 0.01) / 6);
    const which = mix2 ? lay[(hash32(panel, 77) % 3) === 0 ? 1 : 0] : lay[panel % 3 === 2 ? 1 : 0];
    const f: Face = { ...k.B(which as 'hoard_sea'), g: [0.55, 1] };
    strip(k.w, a, b, 0, 0, H, -1, f, 6, [0.5, 1]);
    // foot below the ground line: a sliver of the panel's bottom edge stretched down (hidden on flat ground, closes slopes)
    strip(k.w, a, b, 0, -0.4, 0, -1, f, 6, [0.45, 0.5], bandV(BANDS[which as 'hoard_sea'], 0.01, 0.03));
    strip(k.w, a, b, 0.05, -0.4, H, 1, back, 2, [0.4, 0.9]);
    hstrip(k.w, a, b, -0.02, 0.07, H, H, METAL(k, [0.2, 0.42, 0.3]));
  }
  // warning lamps (保安灯) every ~6 m on top, alternating red/amber
  let li = 0;
  for (let s = 3; s < S.total - 0.5; s += 6) {
    const p = S.at(s);
    const red = li++ % 2 === 0;
    const [x, y, z] = off(p, -0.04, H + 0.02);
    const m = basisZ(-p.nx, -p.nz, x, y, z);
    const save = k.w.m.clone(); k.w.m.multiply(m);
    boxW(k.w, -0.07, 0, -0.05, 0.07, 0.04, 0.05, { all: METAL(k, [0.15, 0.15, 0.18]) });
    boxW(k.w, -0.05, 0.04, -0.035, 0.05, 0.16, 0.035, { all: k.A('st_props_a', red ? 'lens_red' : 'lens_amber', undefined, [1, 1]) });
    k.w.m.copy(save);
    k.lights.push({ x, y: y + 0.1, z, r: red ? RED[0] : AMBER[0], g: red ? RED[1] : AMBER[1], b: red ? RED[2] : AMBER[2], radius: 3.5 });
  }
}
function edgeWoodfence(k: Ctx, S: Smp) {
  const style = k.r.pick(['yakisugi', 'louver', 'bamboo'] as const);
  if (style === 'yakisugi') {
    const H = 1.8, f: Face = { ...k.B('yakisugi'), g: [0.4, 1] };
    const runS = S.run(2.0, 2.0);
    for (let i = 0; i < runS.length - 1; i++) {
      const a = runS[i], b = runS[i + 1];
      strip(k.w, a, b, 0, -0.3, H, -1, f, 2, [0.4, 1], bandV(BANDS.yakisugi, 0, H));
      strip(k.w, a, b, 0.04, -0.3, H, 1, f, 2, [0.4, 1], bandV(BANDS.yakisugi, 0, H));
      // cap board with a little overhang
      // galvanised sheet capping, dark brown
      const cap = METAL(k, [0.32, 0.27, 0.25]);
      hstrip(k.w, a, b, -0.05, 0.09, H + 0.04, H + 0.04, cap);
      strip(k.w, a, b, -0.05, H, H + 0.04, -1, cap, 2, [0.9, 1]);
    }
    for (const p of runS) if (aligned(p, S, 2.0)) boxPost(k.w, p, 0.08, -0.5, H, 0.045, 0.045, k.A('st_props_b', 'wood', [0.3, 0.25, 0.22]));
  } else if (style === 'louver') {
    const base = 0.4, H = 1.2;
    const blk: Face = { ...k.B('block'), g: [0.2, 0.5] }, lv: Face = { ...k.B('louver'), g: [0.55, 1] };
    const runS = S.run(2.0, 2.0);
    for (let i = 0; i < runS.length - 1; i++) {
      const a = runS[i], b = runS[i + 1];
      // block base (two courses) with a coping
      strip(k.w, a, b, 0, -0.4, base, -1, blk, 3.2, [0.15, 0.5], bandV(BANDS.block, 0, base + 0.4));
      strip(k.w, a, b, 0.12, -0.4, base, 1, blk, 3.2, [0.15, 0.5], bandV(BANDS.block, 0, base + 0.4));
      hstrip(k.w, a, b, -0.01, 0.13, base + 0.03, base + 0.03, k.T('concrete'));
      strip(k.w, a, b, -0.01, base, base + 0.03, -1, k.T('concrete'), 3, [0.6, 0.6]);
      // louvre panel above
      strip(k.w, a, b, 0.05, base + 0.03, base + 0.03 + H, -1, lv, 2, [0.55, 1], bandV(BANDS.louver, 0, H));
      strip(k.w, a, b, 0.07, base + 0.03, base + 0.03 + H, 1, lv, 2, [0.55, 1], bandV(BANDS.louver, 0, H));
      hstrip(k.w, a, b, 0.045, 0.075, base + 0.03 + H, base + 0.03 + H, METAL(k, [0.35, 0.3, 0.28]));
    }
    for (const p of runS) if (aligned(p, S, 2.0)) boxPost(k.w, p, 0.06, base, base + H + 0.06, 0.035, 0.035, METAL(k, [0.35, 0.3, 0.28]));
  } else {
    const H = 1.2, f: Face = { ...k.B('bamboo'), g: [0.4, 1] };
    const runS = S.run(1.8, 1.8);
    for (let i = 0; i < runS.length - 1; i++) {
      const a = runS[i], b = runS[i + 1];
      strip(k.w, a, b, 0, -0.2, H, -1, f, 2, [0.4, 1], bandV(BANDS.bamboo, 0, H));
      strip(k.w, a, b, 0.03, -0.2, H, 1, f, 2, [0.4, 1], bandV(BANDS.bamboo, 0, H));
      tubeW(k.w, [[...off(a, 0.015, H + 0.03), 0.035], [...off(b, 0.015, H + 0.03), 0.035]], 5, { ...k.B('bamboo'), tile: [1, 1] }, false, [0.9, 1]);
    }
    for (const p of runS) if (aligned(p, S, 1.8)) post(k.w, p, 0.015, -0.4, H + 0.12, 0.045, 6, { l: k.L('st_fences'), uv: [0.1, bandV(BANDS.bamboo, 0, 0.2)[0], 0.14, bandV(BANDS.bamboo, 0, 1.0)[1]] }, null);
  }
}
function edgeBlockwall(k: Ctx, S: Smp) {
  const courses = k.r.int(6, 8), H = courses * 0.2;
  const breeze = k.r.chance(0.4);
  const painted = k.r.chance(0.35);
  const tint: RGB = painted ? k.r.pick([[1.08, 1.03, 0.9], [1.0, 0.95, 0.98], [0.95, 1.02, 1.05]] as RGB[]) : [1, 1, 1];
  const T = 0.12;
  const runS = S.run(3.2, 3.2);
  const solidTop = breeze ? H - 0.4 : H;
  for (let i = 0; i < runS.length - 1; i++) {
    const a = runS[i], b = runS[i + 1];
    const seg = Math.floor((a.s + 0.01) / 3.2);
    const graf = (hash32(seg, k.r.int(0, 1e6)) % 5) === 0;
    const front: Face = { ...k.B(graf ? 'block_graf' : 'block', tint), g: [0.1, 1] };
    const backF: Face = { ...k.B('block', tint), g: [0.1, 1] };
    strip(k.w, a, b, 0, 0, solidTop, -1, front, 3.2, [0.05, solidTop / 1.6], bandV(BANDS.block, 0, solidTop));
    strip(k.w, a, b, T, 0, solidTop, 1, backF, 3.2, [0.05, solidTop / 1.6], bandV(BANDS.block, 0, solidTop));
    // foundation below ground
    const fnd = k.T('concrete', [0.8, 0.8, 0.8]);
    strip(k.w, a, b, -0.02, -0.7, 0.02, -1, fnd, 3, [0, 0.1]);
    strip(k.w, a, b, T + 0.02, -0.7, 0.02, 1, fnd, 3, [0, 0.1]);
    if (breeze) {
      const bz: Face = { ...k.B('breeze', tint), g: [0.8, 1] };
      strip(k.w, a, b, 0.01, solidTop, H, -1, bz, 1.6, [0.85, 1], bandV(BANDS.breeze, 0, 0.4));
      strip(k.w, a, b, T - 0.01, solidTop, H, 1, bz, 1.6, [0.85, 1], bandV(BANDS.breeze, 0, 0.4));
    }
    // coping
    const cp = k.T('concrete', [tint[0] * 0.95, tint[1] * 0.95, tint[2] * 0.95]);
    hstrip(k.w, a, b, -0.03, T + 0.03, H + 0.06, H + 0.06, cp);
    strip(k.w, a, b, -0.03, H - 0.01, H + 0.06, -1, cp, 3, [0.9, 1]);
    strip(k.w, a, b, T + 0.03, H - 0.01, H + 0.06, 1, cp, 3, [0.9, 1]);
    if (!breeze && solidTop < H) hstrip(k.w, a, b, 0, T, solidTop, solidTop, cp);
  }
  // pilasters on the back side every 3.2 m (control joints / 控え壁)
  for (const p of runS) if (aligned(p, S, 3.2)) boxPost(k.w, p, T + 0.12, -0.5, H - 0.2, 0.1, 0.12, { ...k.B('block', tint), g: [0.1, 0.9] });
  // shrubs peeking over in front gardens
  if (k.r.chance(0.5)) {
    for (let s = 1.5; s < S.total - 1; s += k.r.range(3, 7)) {
      const p = S.at(s);
      const f: Face = { ...k.T('leaves', [0.9, 1, 0.85]), g: [0.3, 1] };
      const [x, y, z] = off(p, 0.9, H + 0.1);
      blob(k.w, x, y, z, 0.8, 0.6, 0.8, f, k.r, { lat: 4, lon: 7, jitter: 0.12 });
    }
  }
}
function edgeVerge(k: Ctx, S: Smp) {
  const W = k.r.range(2.2, 3.5);
  const grass: Face = { l: k.L('st_grass'), tile: [4, 4], tint: [1, 1, 1] };
  const runS = S.run(3.0);
  for (let i = 0; i < runS.length - 1; i++) {
    const a = runS[i], b = runS[i + 1];
    hstrip(k.w, a, b, -0.05, W * 0.7, 0.01, -0.03, grass, (s, d) => [s / 4, d / 4]);
    hstrip(k.w, a, b, W * 0.7, W, -0.03, -0.25, grass, (s, d) => [s / 4, d / 4]);
    // skirt down to hide any gap against the terrain
    strip(k.w, a, b, W, -1.5, -0.25, 1, grass, 4, [0.3, 0.5], [0, 0.3]);
    strip(k.w, a, b, -0.05, -0.6, 0.01, -1, grass, 4, [0.3, 0.5], [0, 0.15]);
  }
  // tufts and wildflowers
  const uv = rectUV(ATLAS.st_cards.grass), LC = k.L('st_cards');
  for (let s = k.r.range(0.3, 1.5); s < S.total - 0.2; s += k.r.range(0.9, 2.4)) {
    const p = S.at(s);
    const d = k.r.range(0.25, W * 0.95);
    const [x, y, z] = off(p, d, d > W * 0.7 ? -0.1 : 0);
    const h = k.r.range(0.35, 0.75), hw = h * 0.6;
    const a0 = k.r.next() * Math.PI;
    for (const a of [a0, a0 + Math.PI / 2]) {
      const cx = Math.cos(a) * hw, cz = Math.sin(a) * hw;
      card(k.w, [x - cx, y - 0.05, z - cz], [x + cx, y - 0.05, z + cz], [x + cx, y + h, z + cz], [x - cx, y + h, z - cz], [0, 1, 0], uv, LC, [1, 1, 1], 0.4, 1);
    }
  }
  // white delineator posts with amber reflectors every ~20 m
  if (k.r.chance(0.7)) {
    for (let s = 2; s < S.total - 0.5; s += 20) {
      const p = S.at(s);
      const [x, y, z] = off(p, 0.35);
      const save = k.w.m.clone();
      const ang = Math.atan2(-p.tx, -p.tz);
      k.w.m.multiply(new Matrix4().makeTranslation(x, y, z).multiply(rotY(ang)));
      const kk = new Ctx(k.w, k.ink, k.L, k.r);
      delineator(kk);
      k.w.m.copy(save);
    }
  }
}
function edgeRailing(k: Ctx, S: Smp) {
  const panel = k.r.chance(0.45);
  if (!panel) {
    // ガードパイプ: white posts every 2 m, three horizontal pipes
    const white = METAL(k, [0.95, 0.95, 0.96], [0.6, 1]);
    const runS = S.run(2.0, 2.0);
    for (let i = 0; i < runS.length - 1; i++) {
      const a = runS[i], b = runS[i + 1];
      for (const h of [0.38, 0.6, 0.82]) tubeW(k.w, [[...off(a, 0, h), 0.024], [...off(b, 0, h), 0.024]], 4, white, false, [0.75, 0.95]);
    }
    for (const p of runS) if (aligned(p, S, 2.0)) post(k.w, p, 0.03, -0.5, 0.9, 0.035, 6, white, white);
  } else {
    // pedestrian fence panels with vertical bars (景観 brown or white)
    const tint: RGB = k.r.chance(0.6) ? [0.42, 0.32, 0.27] : [1, 1, 1];
    const f: Face = { ...k.B('railpanel', tint), g: [0.6, 1] };
    const runS = S.run(2.0, 2.0);
    for (let i = 0; i < runS.length - 1; i++) {
      const a = runS[i], b = runS[i + 1];
      strip(k.w, a, b, 0, 0.05, 1.05, -1, f, 2, [0.6, 1], bandV(BANDS.railpanel, 0, 1.0));
      strip(k.w, a, b, 0, 0.05, 1.05, 1, f, 2, [0.6, 1], bandV(BANDS.railpanel, 0, 1.0));
      hstrip(k.w, a, b, -0.025, 0.025, 1.07, 1.07, METAL(k, tint));
    }
    for (const p of runS) if (aligned(p, S, 2.0)) boxPost(k.w, p, 0, -0.4, 1.1, 0.03, 0.03, METAL(k, tint, [0.5, 1]));
  }
}

// ───────────────────────────────────── car park / empty lot ─────────────────────────────────────

/**
 * Coin car park (コインパーキング): asphalt pad, bay lines, wheel stops and lock plates, the
 * yellow P sign with its lit 空/満 board and a pay machine. Returns parking slots (car origin at the
 * bay centre on the ground, yaw = heading of the car's +Z forward axis) and night lights.
 */
export function buildCarPark(world: WorldGeom, inked: InkedGeom, L: LayerFn, w: number, d: number, seed: number): { slots: { x: number; z: number; yaw: number }[]; lights: Light[] } {
  const k = new Ctx(world, inked, L, new Rng(hash32(seed, 0xca7)));
  const slots: { x: number; z: number; yaw: number }[] = [];
  const asph = k.T('asphalt');
  boxW(k.w, -w / 2, -2.0, -d, w / 2, 0.03, 0, { pz: k.T('concrete', [0.8, 0.8, 0.8], [0.2, 0.3]), nz: k.T('concrete', [0.8, 0.8, 0.8], [0.2, 0.3]), px: k.T('concrete', [0.8, 0.8, 0.8], [0.2, 0.3]), nx: k.T('concrete', [0.8, 0.8, 0.8], [0.2, 0.3]), top: asph });
  // low kerb on the back and sides
  const kc = k.T('concrete', [0.92, 0.92, 0.92]);
  boxW(k.w, -w / 2, 0.03, -d, w / 2, 0.15, -d + 0.15, { all: kc }, [0.6, 1]);
  for (const s of [-1, 1]) boxW(k.w, s > 0 ? w / 2 - 0.15 : -w / 2, 0.03, -d, s > 0 ? w / 2 : -w / 2 + 0.15, 0.15, -0.3, { all: kc }, [0.6, 1]);
  const lineF = STRIPS.line, [lu0, lu1] = stripU(lineF), LS = k.L(lineF.layer);
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    // a painted line from (x0,z0) to (x1,z1), 0.12 wide
    const len = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / len, tz = (z1 - z0) / len, hw = 0.06;
    const px = -tz * hw, pz = tx * hw, y = 0.036;
    const A = [x0 + px, y, z0 + pz], B = [x0 - px, y, z0 - pz], C = [x1 - px, y, z1 - pz], D = [x1 + px, y, z1 + pz];
    const nrm = (B[0] - A[0]) * (D[2] - A[2]) - (B[2] - A[2]) * (D[0] - A[0]);
    if (nrm < 0) quad(k.w, A, B, C, D, [lu0, 0, lu1, len / 2], LS);
    else quad(k.w, B, A, D, C, [lu1, 0, lu0, len / 2], LS);
  };
  const bayW = 2.5, bayL = 5.0, aisle = 6.0;
  const nb = Math.max(0, Math.floor((w - 0.6) / bayW));
  const rows: { z0: number; z1: number; nose: 1 | -1 }[] = [];
  if (d >= bayL + 2) rows.push({ z0: -d + 0.2, z1: -d + 0.2 + bayL, nose: 1 });
  if (d >= 2 * bayL + aisle + 0.4) rows.push({ z0: -d + 0.2 + bayL + aisle, z1: -d + 0.2 + 2 * bayL + aisle, nose: -1 });
  const xs0 = -(nb * bayW) / 2;
  const rubber = k.A('st_props_b', 'rubber', undefined, [0.6, 1]);
  for (const r of rows) {
    for (let i = 0; i <= nb; i++) line(xs0 + i * bayW, r.z0, xs0 + i * bayW, r.z1);
    line(xs0, r.nose > 0 ? r.z0 : r.z1, xs0 + nb * bayW, r.nose > 0 ? r.z0 : r.z1);
    for (let i = 0; i < nb; i++) {
      const cx = xs0 + (i + 0.5) * bayW, cz = (r.z0 + r.z1) / 2;
      // cars back in: wheel stop at the closed end, nose toward the aisle
      const ws = r.nose > 0 ? r.z0 + 0.9 : r.z1 - 0.9;
      boxW(k.w, cx - 0.75, 0.03, ws - 0.07, cx + 0.75, 0.15, ws + 0.07, { all: rubber });
      // lock plate (ロック板) mid-bay
      boxW(k.w, cx - 0.22, 0.03, cz - 0.3, cx + 0.22, 0.09, cz + 0.3, { all: METAL(k, [0.55, 0.57, 0.6]), top: k.B('hazard', [1, 1, 1]) }, [0.6, 1]);
      slots.push({ x: cx, z: cz, yaw: r.nose > 0 ? 0 : Math.PI });
    }
  }
  // the P sign: inked pole at the front corner, lit box faces both ways
  const sx = w / 2 - 0.6, sz = -0.6;
  k.ink.cylinder(sx, sz, -0.5, 3.6, 0.06, 0.06, 8, PS.steel);
  const sign = k.A('st_props_a', 'coinp_sign', undefined, [1, 1]), board = k.A('st_props_a', 'coinp_board', undefined, [1, 1]);
  k.ink.box(sx - 0.5, 3.55, sz - 0.12, sx + 0.5, 4.55, sz + 0.12, PS.yellow);
  quad(k.w, [sx - 0.48, 3.57, sz + 0.125], [sx + 0.48, 3.57, sz + 0.125], [sx + 0.48, 4.53, sz + 0.125], [sx - 0.48, 4.53, sz + 0.125], sign.uv!, sign.l);
  quad(k.w, [sx + 0.48, 3.57, sz - 0.125], [sx - 0.48, 3.57, sz - 0.125], [sx - 0.48, 4.53, sz - 0.125], [sx + 0.48, 4.53, sz - 0.125], sign.uv!, sign.l);
  k.ink.box(sx - 0.4, 2.5, sz - 0.06, sx + 0.4, 3.3, sz + 0.06, PS.signblue);
  quad(k.w, [sx - 0.38, 2.52, sz + 0.065], [sx + 0.38, 2.52, sz + 0.065], [sx + 0.38, 3.28, sz + 0.065], [sx - 0.38, 3.28, sz + 0.065], board.uv!, board.l);
  k.light(sx, 3.8, sz + 0.5, [1.0, 0.9, 0.45], 7);
  // pay machine near the entrance
  const px = -w / 2 + 0.8, pz = -1.0;
  const body = METAL(k, [0.9, 0.91, 0.93]);
  boxW(k.w, px - 0.3, 0.03, pz - 0.25, px + 0.3, 1.45, pz + 0.2, { pz: k.A('st_props_a', 'payment', undefined, [0.6, 1]), nz: body, px: body, nx: body, top: body });
  boxW(k.w, px - 0.38, 1.45, pz - 0.32, px + 0.38, 1.52, pz + 0.32, { all: METAL(k, [0.95, 0.75, 0.15]) });
  k.light(px, 1.1, pz + 0.5, [0.6, 1.0, 0.9], 3);
  // a floodlight on bigger lots
  if (w * d > 300) {
    k.push(tr(-w / 2 + 0.4, 0.03, -d + 0.4));
    lampSuburb(k);
    k.pop();
  }
  return { slots, lights: k.lights };
}

/** Empty lot (空き地): gravel and weeds, a rope fence, a 売地 sign, sometimes a vending machine. */
export function buildEmptyLot(world: WorldGeom, inked: InkedGeom, L: LayerFn, w: number, d: number, seed: number): { lights: Light[] } {
  const k = new Ctx(world, inked, L, new Rng(hash32(seed, 0x107)));
  const gr = k.T('gravel');
  boxW(k.w, -w / 2, -2.0, -d, w / 2, 0.04, 0, { pz: k.T('earth', [0.85, 0.85, 0.85], [0.2, 0.3]), nz: k.T('earth', [0.85, 0.85, 0.85], [0.2, 0.3]), px: k.T('earth', [0.85, 0.85, 0.85], [0.2, 0.3]), nx: k.T('earth', [0.85, 0.85, 0.85], [0.2, 0.3]), top: gr });
  // weeds: denser along the edges, tall clumps here and there
  const uv = rectUV(ATLAS.st_cards.grass), LC = k.L('st_cards');
  const n = Math.round((w * d) / 5);
  for (let i = 0; i < n; i++) {
    let x = (k.r.next() - 0.5) * w * 0.96, z = -k.r.next() * d * 0.98;
    if (k.r.chance(0.5)) { if (k.r.chance(0.5)) x = (k.r.chance(0.5) ? 1 : -1) * (w / 2 - k.r.range(0.2, 1.0)); else z = -d + k.r.range(0.2, 1.0); }
    const h = k.r.range(0.25, k.r.chance(0.2) ? 1.0 : 0.55), hw = h * 0.65, a0 = k.r.next() * Math.PI;
    for (const a of [a0, a0 + Math.PI / 2]) {
      const cx = Math.cos(a) * hw, cz = Math.sin(a) * hw;
      card(k.w, [x - cx, 0.0, z - cz], [x + cx, 0.0, z + cz], [x + cx, h, z + cz], [x - cx, h, z - cz], [0, 1, 0], uv, LC, [1, 1, 1], 0.4, 1);
    }
  }
  // a couple of scrubby bushes at the back
  for (let i = 0; i < 2; i++) blob(k.w, (k.r.next() - 0.5) * w * 0.8, 0.45, -d + 1.2, 0.9, 0.6, 0.8, { ...k.T('leaves', [0.85, 0.95, 0.75]), g: [0.2, 1] }, k.r, { lat: 4, lon: 7, jitter: 0.15, flat: 0.5 });
  // rope fence on short posts along the front
  const posts = Math.max(2, Math.round(w / 2.5) + 1);
  const ropeUV = rectUV(ATLAS.st_props_b.rope), LB = k.L('st_props_b');
  const pf = k.T('concrete', [0.95, 0.95, 0.95], [0.4, 1]);
  let prev: number[] | null = null;
  for (let i = 0; i < posts; i++) {
    const x = -w / 2 + 0.2 + ((w - 0.4) * i) / (posts - 1);
    boxW(k.w, x - 0.05, -0.3, -0.35, x + 0.05, 0.65, -0.25, { all: pf });
    const top = [x, 0.58, -0.3];
    if (prev) {
      const mid = [(prev[0] + top[0]) / 2, 0.42, -0.3];
      tubeW(k.w, [[...prev, 0.012], [...mid, 0.012], [...top, 0.012]], 4, { l: LB, uv: ropeUV, tile: [0.3, 0.3] }, false, [0.8, 0.9]);
    }
    prev = top;
  }
  // 売地 sign on two wooden posts
  const sx = k.r.range(-w / 4, w / 4);
  const wood = k.A('st_props_b', 'wood', [0.8, 0.75, 0.7]);
  for (const x of [sx - 0.75, sx + 0.75]) boxW(k.w, x - 0.04, -0.3, -1.2, x + 0.04, 1.6, -1.12, { all: wood });
  boxW(k.w, sx - 0.95, 0.65, -1.12, sx + 0.95, 1.55, -1.08, { pz: k.A('st_props_a', 'forsale', undefined, [0.8, 1]), nz: METAL(k, [0.85, 0.85, 0.85]), px: METAL(k, [0.85, 0.85, 0.85]), nx: METAL(k, [0.85, 0.85, 0.85]), top: METAL(k, [0.85, 0.85, 0.85]) });
  // sometimes a vending machine at the front corner
  if (k.r.chance(0.4) && w > 6) {
    k.push(tr(w / 2 - 1.6, 0.04, -0.45));
    vendingMachine(k);
    k.pop();
  }
  return { lights: k.lights };
}

// ───────────────────────────────────── guide sign ─────────────────────────────────────

/**
 * Blue overhead guide sign on a truss gantry before a Y fork. The gantry spans `span` metres of
 * road (columns just outside), the board faces +Z and names each branch's district (kanji over
 * romaji) either side of a Y-fork arrow. Gantry inked, faces lit at night.
 */
export function buildGuideSign(world: WorldGeom, inked: InkedGeom, L: LayerFn, opts: { left: Place; right: Place; span: number }): { lights: Light[] } {
  const k = new Ctx(world, inked, L, new Rng(hash32(opts.span * 100, 0x9a1de)));
  const span = Math.max(5, opts.span);
  const cx = span / 2 + 0.9;
  // board size: plates of up to 3.2 × 1.6 m beside a Y arrow
  const BW = Math.min(12, Math.max(6.6, span - 0.6));
  const AW = Math.min(2.0, BW * 0.24);
  const PW = Math.min(3.2, (BW - AW - 0.8) / 2), PH = PW / 2;
  const BH = Math.max(PH, AW) + 0.6;
  // retroreflective sheeting: faces read a touch brighter than painted metal in shade
  const RR: RGB = [1.22, 1.22, 1.22];
  const yb = 5.2, yt = yb + BH, yc = (yb + yt) / 2, zf = 0.32;
  // columns + footings
  // (budget: ≤ 400 triangles at every span — 6-sided columns, a Warren truss of 3-sided members)
  for (const s of [-1, 1]) {
    k.ink.cylinder(s * cx, 0, -0.2, yt + 0.4, 0.21, 0.17, 6, PS.steel);
    k.ink.cylinder(s * cx, 0, yt + 0.4, yt + 0.48, 0.17, 0.0, 6, PS.steel, false);
    boxW(k.w, s * cx - 0.5, -1.2, -0.5, s * cx + 0.5, 0.25, 0.5, { all: k.T('concrete', [0.9, 0.9, 0.9], [0.3, 0.6]), bot: null });
  }
  // truss: two chords, verticals and diagonals in the plane behind the board
  const c0 = yb + 0.5, c1 = yt - 0.4, zt = -0.05;
  itube(k.ink, [-cx, c0, zt], [cx, c0, zt], 0.085, 5, PS.steel);
  itube(k.ink, [-cx, c1, zt], [cx, c1, zt], 0.085, 5, PS.steel);
  const bays = Math.max(3, Math.round((2 * cx) / 3.0));
  for (let i = 0; i < bays; i++) {
    const x = -cx + (2 * cx * i) / bays, x2 = -cx + (2 * cx * (i + 1)) / bays;
    itube(k.ink, i % 2 ? [x, c0, zt] : [x, c1, zt], i % 2 ? [x2, c1, zt] : [x2, c0, zt], 0.04, 3, PS.steel);
  }
  // board: inked aluminium back (outline), painted faces
  k.ink.box(-BW / 2, yb, zf - 0.12, BW / 2, yt, zf, PS.steel);
  for (const x of [-BW / 4, BW / 4]) k.ink.box(x - 0.06, c0 - 0.05, zt, x + 0.06, c1 + 0.05, zf - 0.12, PS.darksteel);
  // frame as a 9-slice (corners 0.42 m ↔ 64 px)
  const fr = ATLAS.gs_board.frame, LG = k.L('gs_board');
  const cM = 0.42, cP = 64;
  const xs = [-BW / 2, -BW / 2 + cM, BW / 2 - cM, BW / 2], ys = [yb, yb + cM, yt - cM, yt];
  const us = [fr[0], fr[0] + cP, fr[0] + fr[2] - cP, fr[0] + fr[2]].map((v) => v / PX);
  const vs = [fr[1] + fr[3], fr[1] + fr[3] - cP, fr[1] + cP, fr[1]].map((v) => 1 - v / PX);
  const zF = zf + 0.003;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    quad(k.w, [xs[i], ys[j], zF], [xs[i + 1], ys[j], zF], [xs[i + 1], ys[j + 1], zF], [xs[i], ys[j + 1], zF], [us[i], vs[j], us[i + 1], vs[j + 1]], LG, RR);
  }
  // plates and the Y arrow
  const zP = zf + 0.008;
  const gap = (BW - 2 * PW - AW) / 4;
  const lx0 = -BW / 2 + gap, rx0 = BW / 2 - gap - PW;
  for (const [x0, place] of [[lx0, opts.left], [rx0, opts.right]] as [number, Place][]) {
    const gp = guidePlate(place);
    quad(k.w, [x0, yc - PH / 2, zP], [x0 + PW, yc - PH / 2, zP], [x0 + PW, yc + PH / 2, zP], [x0, yc + PH / 2, zP], gp.uv, k.L(gp.layer), RR);
  }
  const ar = rectUV(ATLAS.gs_board.yarrow);
  quad(k.w, [-AW / 2, yc - AW / 2, zP], [AW / 2, yc - AW / 2, zP], [AW / 2, yc + AW / 2, zP], [-AW / 2, yc + AW / 2, zP], ar, LG, RR);
  // sign lights on brackets under the board, shining up at it
  for (const x of [-BW / 3, 0, BW / 3]) {
    // a housing on a short hanger under the board's lower edge, tilted to wash the face
    k.push(mul(tr(x, yb - 0.17, zf + 0.22), rotX(-0.9)));
    k.ink.box(-0.25, -0.08, -0.3, 0.25, 0.08, 0.12, PS.darksteel);
    quadN(k.w, [-0.22, 0.081, 0.1], [0.22, 0.081, 0.1], [0.22, 0.081, -0.1], [-0.22, 0.081, -0.1], [0, 1, 0], rectUV(ATLAS.st_props_a.lens_white), k.L('st_props_a'));
    k.pop();
    k.light(x, yb + 0.2, zf + 1.0, [0.85, 0.92, 1.0], 9);
  }
  return { lights: k.lights };
}
