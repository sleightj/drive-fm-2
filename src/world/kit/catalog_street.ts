import { Matrix4, Vector3 } from 'three';
import type { KitPreviewItem } from './catalog';
import type { WorldGeom, InkedGeom } from './geom';
import { PLACES } from '../places';
import {
  buildProp, buildEdge, buildWires, buildGuideSign, buildCarPark, buildEmptyLot, buildRoadMark, guidePlate,
  ROAD_MARKS, SURFACES, STRIPS, stripU, type EdgePoint, type EdgeType,
} from './street';

/**
 * Preview items for the street kit (src/world/kit/street.ts). Groups: edges, props, trees, signs,
 * docks, marks. Seeds below are picked so each variant of a randomised piece shows up once.
 */
type L = (layer: string) => number;

/** Runs `fn` with an extra local transform on both builders. */
function withM(world: WorldGeom, inked: InkedGeom, m: Matrix4, fn: () => void) {
  const sw = world.m.clone(), si = inked.m.clone();
  world.m.multiply(m); inked.m.multiply(m);
  fn();
  world.m.copy(sw); inked.m.copy(si);
}

/** A curving, climbing edge line along +X (road on the +Z side, normals pointing away from it, -Z). */
function edgeLine(len: number, bend: number, rise: number): EdgePoint[] {
  const pts: EdgePoint[] = [];
  const n = Math.ceil(len);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = -len / 2 + len * t;
    const z = -bend * 4 * t * (1 - t), dz = (-bend * 4 * (1 - 2 * t)) / len;
    const l = Math.hypot(dz, 1);
    pts.push({ x, y: rise * t * t * (3 - 2 * t), z, nx: dz / l, nz: -1 / l });
  }
  return pts;
}

/** Ground ribbon alongside an edge line between offsets d0..d1 (along the outward normal). */
function ribbon(world: WorldGeom, pts: EdgePoint[], d0: number, d1: number, layer: number, tile: number, dy = 0) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const sl = Math.hypot(b.x - a.x, b.z - a.z);
    const P = (p: EdgePoint, d: number) => new Vector3(p.x + p.nx * d, p.y + dy, p.z + p.nz * d);
    const q = [P(a, d0), P(b, d0), P(b, d1), P(a, d1)];
    const uv: [number, number, number, number, number, number, number, number] = [s / tile, d0 / tile, (s + sl) / tile, d0 / tile, (s + sl) / tile, d1 / tile, s / tile, d1 / tile];
    const up = new Vector3().subVectors(q[1], q[0]).cross(new Vector3().subVectors(q[3], q[0])).y > 0;
    if (up) world.quadUV(q[0], q[1], q[2], q[3], uv, { layer });
    else world.quadUV(q[1], q[0], q[3], q[2], [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], { layer });
    s += sl;
  }
}
/** Vertical skirt under a ribbon's outer line (hides the sloped pad's underside in previews). */
function skirt(world: WorldGeom, pts: EdgePoint[], d: number, layer: number, towardRoad: boolean) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const A = new Vector3(a.x + a.nx * d, 0, a.z + a.nz * d), B = new Vector3(b.x + b.nx * d, 0, b.z + b.nz * d);
    const A1 = new Vector3(A.x, a.y, A.z), B1 = new Vector3(B.x, b.y, B.z);
    if (a.y < 0.01 && b.y < 0.01) continue;
    if (towardRoad) world.quadUV(B, A, A1, B1, [0, 0, 1, 0, 1, a.y / 3, 0, b.y / 3], { layer });
    else world.quadUV(A, B, B1, A1, [0, 0, 1, 0, 1, b.y / 3, 0, a.y / 3], { layer });
  }
}

function edgeItem(name: string, type: EdgeType, seed: number, h: number): KitPreviewItem {
  return {
    name, size: [12, h, 6], group: 'edges',
    build(world, inked, L) {
      const pts = edgeLine(12, 1.2, 0.8);
      // road in front (asphalt with a kerb line), ground behind
      ribbon(world, pts, -3.6, -0.6, L(SURFACES.asphalt.layer), SURFACES.asphalt.tile);
      ribbon(world, pts, -0.6, 0, L(SURFACES.concrete.layer), SURFACES.concrete.tile, 0.02);
      ribbon(world, pts, 0, 3.0, L(type === 'verge' ? SURFACES.scrub.layer : SURFACES.grass.layer), 4, 0.0);
      skirt(world, pts, -3.6, L(SURFACES.concrete.layer), true);
      const end = pts[pts.length - 1];
      world.quadUV(new Vector3(end.x + end.nx * -3.6, 0, end.z + end.nz * -3.6), new Vector3(end.x + end.nx * 3, 0, end.z + end.nz * 3), new Vector3(end.x + end.nx * 3, end.y, end.z + end.nz * 3), new Vector3(end.x + end.nx * -3.6, end.y, end.z + end.nz * -3.6), [0, 0, 2, 0, 2, 0.3, 0, 0.3], { layer: L(SURFACES.concrete.layer) });
      buildEdge(world, inked, L, type, pts, seed);
    },
  };
}

function propItem(name: string, type: string, seed: number, size: [number, number, number], group = 'props'): KitPreviewItem {
  return { name, size, group, build(world, inked, L) { buildProp(world, inked, L, type, seed); } };
}

/** A small paved pad under a prop group (concrete or the mood's paving). */
function pad(world: WorldGeom, L: L, x0: number, z0: number, x1: number, z1: number, layer: string = SURFACES.pave_grey.layer, tile = 2.4) {
  world.flat(x0, z0, x1, z1, 0.005, { layer: L(layer), tile: [tile, tile] });
}

const edges: KitPreviewItem[] = [
  edgeItem('guardrail', 'guardrail', 3, 3),
  edgeItem('chainlink_low', 'chainlink', 2, 3),
  edgeItem('chainlink_dock', 'chainlink', 1, 3.5),
  edgeItem('hoarding_mural', 'hoarding', 1, 4.5),
  edgeItem('hoarding_kids', 'hoarding', 2, 4.5),
  edgeItem('woodfence_yakisugi', 'woodfence', 1, 3),
  edgeItem('woodfence_louver', 'woodfence', 3, 3),
  edgeItem('woodfence_bamboo', 'woodfence', 2, 3),
  edgeItem('blockwall', 'blockwall', 3, 3),
  edgeItem('blockwall_breeze', 'blockwall', 4, 3),
  edgeItem('verge', 'verge', 5, 3),
  edgeItem('railing_pipe', 'railing', 2, 3),
  edgeItem('railing_panel', 'railing', 4, 3),
];

const props: KitPreviewItem[] = [
  propItem('lamp_arterial', 'lamp_arterial', 1, [7, 11.5, 2]),
  propItem('lamp_avenue', 'lamp_avenue', 3, [4, 9.5, 2]),
  propItem('lamp_oldtown', 'lamp_oldtown', 1, [2, 4.6, 1]),
  propItem('lamp_suburb', 'lamp_suburb', 1, [2.5, 6.6, 1]),
  propItem('utility_pole', 'utility_pole', 1, [3, 12, 2]),
  {
    name: 'utility_poles_wired', size: [22, 12.5, 3], group: 'props',
    build(world, inked, L) {
      const xs = [-9, 9];
      const anchors = xs.map((x, i) => {
        const r = { a: [] as { x: number; y: number; z: number }[] };
        withM(world, inked, new Matrix4().makeTranslation(x, 0, 0), () => { r.a = buildProp(world, inked, L, 'utility_pole', 1 + i).wireAnchors ?? []; });
        return r.a.map((p) => ({ x: p.x + x, y: p.y, z: p.z }));
      });
      for (let j = 0; j < Math.min(anchors[0].length, anchors[1].length); j++) buildWires(world, anchors[0][j], anchors[1][j], j >= 5 ? 0.55 : 0.35, j >= 5 ? 0.07 : 0.04);
      // the wires carry on out of frame
      for (const p of anchors[0]) buildWires(world, p, { x: p.x - 4, y: p.y - 0.15, z: p.z + 0.4 }, 0.03);
      for (const p of anchors[1]) buildWires(world, p, { x: p.x + 4, y: p.y - 0.15, z: p.z - 0.4 }, 0.03);
    },
  },
  propItem('vending_machine', 'vending_machine', 1, [2.8, 2, 1]),
  propItem('vending_machine_b', 'vending_machine', 3, [2.8, 2, 1]),
  propItem('bus_stop', 'bus_stop', 1, [2, 2.7, 1.5]),
  propItem('bus_stop_shelter', 'bus_stop', 2, [4, 2.7, 2]),
  propItem('post_box_round', 'post_box', 2, [1, 1.5, 1]),
  propItem('post_box_modern', 'post_box', 1, [1, 1.5, 1]),
  propItem('bicycles', 'bicycles', 1, [2.4, 1.1, 2]),
  propItem('cone', 'cone', 2, [1, 0.8, 1]),
  propItem('cones_bar', 'cone', 1, [3, 0.8, 1]),
  propItem('barrier', 'barrier', 1, [1.8, 1.2, 1]),
  propItem('planter', 'planter', 1, [1.8, 1.2, 1]),
  propItem('planter_flowers', 'planter', 3, [1.8, 1.2, 1]),
  {
    name: 'bollards', size: [3, 0.9, 1], group: 'props',
    build(world, inked, L) {
      for (const [i, s] of [[-1, 2], [0, 1], [1, 3]]) withM(world, inked, new Matrix4().makeTranslation(i * 1.0, 0, 0), () => buildProp(world, inked, L, 'bollard', s));
    },
  },
  propItem('phone_box', 'phone_box', 1, [1.2, 2.4, 1.2]),
  propItem('signal_pole', 'signal_pole', 1, [1, 3.7, 1]),
  propItem('mirror', 'mirror', 1, [1.2, 3.5, 1]),
  propItem('mirror_double', 'mirror', 2, [2, 3.5, 1]),
  propItem('hydrant', 'hydrant', 1, [1, 2.7, 1]),
  {
    name: 'delineators', size: [3, 1.1, 1], group: 'props',
    build(world, inked, L) { for (let i = -1; i <= 1; i++) withM(world, inked, new Matrix4().makeTranslation(i * 1.2, 0, 0), () => buildProp(world, inked, L, 'delineator', i + 2)); },
  },
  propItem('garbage_station', 'garbage_station', 1, [2.6, 1.3, 1.2]),
  propItem('stone_lantern', 'stone_lantern', 1, [1, 1.8, 1]),
  propItem('bench', 'bench', 1, [2, 0.6, 1]),
  propItem('cabinet', 'cabinet', 1, [1, 1.6, 1]),
  {
    name: 'car_park', size: [16, 6.5, 12], group: 'props',
    build(world, inked, L) { buildCarPark(world, inked, L, 16, 12, 3); },
  },
  {
    name: 'empty_lot', size: [14, 2, 10], group: 'props',
    build(world, inked, L) { buildEmptyLot(world, inked, L, 14, 10, 4); },
  },
];

const trees: KitPreviewItem[] = [
  propItem('zelkova', 'tree_street', 1, [6, 7.6, 6], 'trees'),
  propItem('ginkgo', 'tree_street', 5, [4, 8.5, 4], 'trees'),
  propItem('ginkgo_autumn', 'tree_street', 11, [4, 8.5, 4], 'trees'),
  propItem('cherry', 'tree_cherry', 1, [8, 6.2, 8], 'trees'),
  propItem('cherry_b', 'tree_cherry', 2, [8, 6.2, 8], 'trees'),
  propItem('pine', 'tree_pine', 1, [6, 6.1, 5], 'trees'),
  propItem('pine_b', 'tree_pine', 9, [6, 6.1, 5], 'trees'),
  propItem('shrub', 'shrub', 1, [2, 1.3, 2], 'trees'),
  propItem('shrub_azalea', 'shrub', 2, [2, 1.3, 2], 'trees'),
  {
    name: 'hedge_row', size: [6, 1.2, 1], group: 'trees',
    build(world, inked, L) {
      pad(world, L, -3.1, -0.5, 3.1, 0.5, SURFACES.earth.layer, 5);
      for (let i = -1; i <= 1; i++) withM(world, inked, new Matrix4().makeTranslation(i * 2, 0, 0), () => buildProp(world, inked, L, 'hedge', i + 5));
    },
  },
];

const SIGNS = [
  'sign_stop', 'sign_slow', 'sign_speed_30', 'sign_speed_40', 'sign_speed_50', 'sign_speed_60',
  'sign_noparking', 'sign_nostopping', 'sign_noentry', 'sign_oneway', 'sign_crossing', 'sign_children', 'sign_signal',
  'sign_curve_l', 'sign_curve_r', 'sign_hairpin_l', 'sign_hairpin_r', 'chevron_l', 'chevron_r', 'chevron_l_y', 'chevron_r_y',
  'sign_roadworks', 'works_board',
];
const signs: KitPreviewItem[] = [
  ...SIGNS.map((t) => propItem(t, t, 1, [1.1, 2.7, 1], 'signs')),
  {
    name: 'guide_back', size: [10, 8.6, 2], group: 'signs',
    build(world, inked, L) { buildGuideSign(world, inked, L, { left: PLACES[0], right: PLACES[7], span: 7 }); },
  },
  {
    name: 'guide_avenue', size: [17, 8.9, 2], group: 'signs',
    build(world, inked, L) { buildGuideSign(world, inked, L, { left: PLACES[12], right: PLACES[18], span: 14 }); },
  },
  {
    name: 'guide_arterial', size: [28, 8.9, 2], group: 'signs',
    build(world, inked, L) { buildGuideSign(world, inked, L, { left: PLACES[4], right: PLACES[21], span: 25 }); },
  },
  {
    // every place's guide plate (3.2 × 1.6 m) laid out as a wall for checking the lettering
    name: 'guide_plates_all', size: [20.4, 8, 1], group: 'signs',
    build(world, _inked, L) {
      const cols = 6;
      PLACES.forEach((p, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x0 = -10.2 + c * 3.4, y0 = 7.0 - r * 1.75;
        const g = guidePlate(p);
        world.quadUV(new Vector3(x0, y0, 0), new Vector3(x0 + 3.2, y0, 0), new Vector3(x0 + 3.2, y0 + 1.6, 0), new Vector3(x0, y0 + 1.6, 0),
          [g.uv[0], g.uv[1], g.uv[2], g.uv[1], g.uv[2], g.uv[3], g.uv[0], g.uv[3]], { layer: L(g.layer) });
      });
    },
  },
];

const docks: KitPreviewItem[] = [
  propItem('lamp_docks', 'lamp_docks', 1, [3, 19, 2], 'docks'),
  propItem('container_stack', 'container_stack', 1, [13, 10.5, 6], 'docks'),
  propItem('container_stack_low', 'container_stack', 3, [13, 8, 6], 'docks'),
  propItem('container_stack_mixed', 'container_stack', 9, [13, 10.5, 6], 'docks'),
  propItem('gantry_crane', 'gantry_crane', 1, [25, 22.5, 10], 'docks'),
  propItem('quay_crane', 'quay_crane', 1, [22, 49, 30], 'docks'),
  {
    name: 'quay_edge', size: [6, 1.2, 2], group: 'docks',
    build(world, inked, L) {
      pad(world, L, -3, -1, 3, 1, SURFACES.dock.layer, 8);
      withM(world, inked, new Matrix4().makeTranslation(-1.5, 0, 0), () => buildProp(world, inked, L, 'quay_bollard', 1));
      withM(world, inked, new Matrix4().makeTranslation(0.8, 0, 0.6), () => buildProp(world, inked, L, 'drums', 1));
      withM(world, inked, new Matrix4().makeTranslation(2.2, 0, 0.6), () => buildProp(world, inked, L, 'pallets', 1));
    },
  },
  propItem('shed', 'shed', 1, [6, 2.5, 5], 'docks'),
];

/** Road marks on an asphalt pad, near end toward the camera (+Z), as a driver approaches them. */
const MARK_NAMES = Object.keys(ROAD_MARKS);
const marks: KitPreviewItem[] = [
  ...MARK_NAMES.map((name): KitPreviewItem => {
    const m = ROAD_MARKS[name];
    const w = Math.max(3.5, m.width + 1.5), l = m.length + 3;
    return {
      name: `mark_${name}`, size: [w, 2, l], group: 'marks',
      build(world, inked, L) {
        pad(world, L, -w / 2, -l / 2, w / 2, l / 2, SURFACES.asphalt.layer, SURFACES.asphalt.tile);
        withM(world, inked, new Matrix4().makeRotationY(Math.PI), () => buildRoadMark(world, L, name, 0.012));
      },
    };
  }),
  {
    // a 3.5 m lane approaching a junction: speed 40, 止まれ, stop line, crosswalk
    name: 'mark_approach', size: [7, 2, 30], group: 'marks',
    build(world, inked, L) {
      pad(world, L, -3.5, -15, 3.5, 15, SURFACES.asphalt.layer, SURFACES.asphalt.tile);
      withM(world, inked, new Matrix4().makeRotationY(Math.PI), () => {
        // left-hand traffic: the lane is on the driver's left (+X in this frame) of the centre line
        const line = L('st_strips');
        const lu = stripU(STRIPS.line);
        for (const x of [-0.07, 3.43]) {
          world.quadUV(new Vector3(x + 0.075, 0.011, -15), new Vector3(x - 0.075, 0.011, -15), new Vector3(x - 0.075, 0.011, 4), new Vector3(x + 0.075, 0.011, 4), [lu[0], 0, lu[1], 0, lu[1], 19 / 2, lu[0], 19 / 2], { layer: line });
        }
        const at = (z: number, nm: string) => withM(world, inked, new Matrix4().makeTranslation(1.75, 0, z), () => buildRoadMark(world, L, nm, 0.012));
        at(-12.3, 'speed_40');
        at(-7.0, 'diamond');
        at(-0.5, 'tomare');
        // stop line 0.45 m deep across the lane
        world.quadUV(new Vector3(3.5, 0.012, 4.2), new Vector3(0, 0.012, 4.2), new Vector3(0, 0.012, 4.65), new Vector3(3.5, 0.012, 4.65), [lu[0], 0, lu[1], 0, lu[1], 1.75, lu[0], 1.75], { layer: line });
        // zebra crossing beyond it: 0.45 m bars along the road, 0.45 m gaps, 4 m wide crossing
        for (let i = 0; i < 8; i++) withM(world, inked, new Matrix4().makeTranslation(3.05 - i * 0.9, 0, 7.6), () => buildRoadMark(world, L, 'crosswalk_bar', 0.012));
      });
    },
  },
];

export const items: KitPreviewItem[] = [...edges, ...props, ...trees, ...signs, ...docks, ...marks];
