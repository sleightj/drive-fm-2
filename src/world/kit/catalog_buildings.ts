import { Matrix4 } from 'three';
import type { KitPreviewItem } from './catalog';
import type { Mood } from '../moods';
import { BUILDING_TYPES, buildBuilding, buildFarBuilding, pickBuildingType, type BuildingTypeDef } from './buildings';

/**
 * Preview entries for the buildings kit.
 *  - group `<mood>`: every type whose primary mood is that mood (busy types twice, to show the
 *    seed-driven variety), plus a far-skyline sample of that mood.
 *  - group `<mood>-row`: one street row built the way the world builder would (weighted picks,
 *    side gaps, no gap between terraced types), for the `wide` view.
 */

const MOODS: Mood[] = ['downtown', 'oldtown', 'midtown', 'docks', 'suburbs', 'edge'];

/** Deterministic hash → [0,1). */
function hash01(n: number) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function heightFor(def: BuildingTypeDef, floors: number) {
  const t = (floors - def.floors[0]) / Math.max(1, def.floors[1] - def.floors[0]);
  return def.height[0] + (def.height[1] - def.height[0]) * t;
}

interface Variant { width: number; depth: number; floors: number; seed: number }

/** Preview variants per type: [width, depth, floors, seed]. */
const VARIANTS: Record<string, Variant[]> = {
  glass_tower: [{ width: 22, depth: 22, floors: 22, seed: 3 }, { width: 18, depth: 20, floors: 16, seed: 4 }],
  office_setback: [{ width: 26, depth: 22, floors: 14, seed: 5 }],
  zakkyo_tower: [{ width: 9, depth: 15, floors: 8, seed: 11 }, { width: 11, depth: 16, floors: 10, seed: 12 }],
  pachinko_hall: [{ width: 22, depth: 24, floors: 4, seed: 4 }],
  machiya: [{ width: 7.3, depth: 13, floors: 2, seed: 21 }, { width: 6.4, depth: 12, floors: 2, seed: 22 }],
  kanban_shop: [{ width: 7.5, depth: 12, floors: 3, seed: 31 }, { width: 6.5, depth: 11, floors: 2, seed: 32 }],
  kura: [{ width: 6.5, depth: 9, floors: 2, seed: 41 }],
  temple_gate: [{ width: 14, depth: 16, floors: 1, seed: 51 }],
  mixed_block: [{ width: 15, depth: 16, floors: 6, seed: 61 }, { width: 12, depth: 14, floors: 5, seed: 62 }],
  mansion: [{ width: 22, depth: 13, floors: 8, seed: 71 }],
  konbini: [{ width: 18, depth: 22, floors: 1, seed: 81 }],
  small_office: [{ width: 11, depth: 13, floors: 4, seed: 91 }],
  warehouse: [{ width: 30, depth: 32, floors: 1, seed: 101 }],
  port_office: [{ width: 14, depth: 11, floors: 3, seed: 111 }],
  cold_storage: [{ width: 28, depth: 26, floors: 1, seed: 121 }],
  house: [{ width: 9.5, depth: 13, floors: 2, seed: 150 }, { width: 10, depth: 14, floors: 2, seed: 151 }, { width: 8.5, depth: 12, floors: 2, seed: 155 }],
  apaato: [{ width: 14, depth: 10, floors: 2, seed: 161 }],
  farm_shed: [{ width: 9, depth: 8, floors: 1, seed: 171 }],
  workshop: [{ width: 11, depth: 13, floors: 2, seed: 181 }],
  greenhouse: [{ width: 7.5, depth: 22, floors: 1, seed: 191 }],
};

/** Far-skyline sample: a row of far buildings of one mood, sized as the world builder would. */
const FAR: Record<Mood, { w: [number, number]; d: [number, number]; h: [number, number]; n: number }> = {
  downtown: { w: [18, 34], d: [18, 30], h: [40, 140], n: 6 },
  midtown: { w: [14, 30], d: [12, 24], h: [16, 45], n: 7 },
  oldtown: { w: [6, 12], d: [10, 16], h: [6, 10], n: 9 },
  docks: { w: [24, 44], d: [20, 40], h: [8, 70], n: 6 },
  suburbs: { w: [8, 14], d: [9, 14], h: [6.5, 9], n: 9 },
  edge: { w: [6, 14], d: [6, 12], h: [3, 7], n: 8 },
};

function farItem(mood: Mood): KitPreviewItem {
  const f = FAR[mood];
  const specs: { x: number; w: number; d: number; h: number; s: number }[] = [];
  let x = 0, hMax = 0, dMax = 0;
  for (let i = 0; i < f.n; i++) {
    const s = 9000 + MOODS.indexOf(mood) * 100 + i;
    const w = f.w[0] + (f.w[1] - f.w[0]) * hash01(s);
    const d = f.d[0] + (f.d[1] - f.d[0]) * hash01(s + 0.5);
    // docks: one tall crane silhouette in the row
    const h = mood === 'docks' && i === 2 ? 66 : f.h[0] + (f.h[1] - f.h[0]) * (mood === 'docks' ? Math.min(0.35, hash01(s + 0.25)) : hash01(s + 0.25));
    specs.push({ x: x + w / 2, w, d, h, s });
    x += w + 3;
    hMax = Math.max(hMax, h); dMax = Math.max(dMax, d);
  }
  const total = x - 3;
  return {
    name: `${mood}_far_skyline`,
    size: [total, hMax, dMax],
    group: mood,
    build(world, _inked, L) {
      for (const p of specs) {
        world.push(new Matrix4().makeTranslation(p.x - total / 2, 0, 0));
        buildFarBuilding(world, L, { mood, width: p.w, depth: p.d, height: p.h, seed: p.s });
        world.pop();
      }
    },
  };
}

/** A street row of one mood: weighted picks with their side gaps, about `len` metres long. */
function rowItem(mood: Mood, len: number): KitPreviewItem {
  const plan: { type: string; x: number; w: number; d: number; floors: number; seed: number }[] = [];
  let x = 0, i = 0, run = 0, last = '', hMax = 0, dMax = 0;
  while (x < len && i < 40) {
    const s = 5000 + MOODS.indexOf(mood) * 1000 + i * 7;
    let def = pickBuildingType(mood, hash01(s));
    if (def.type === last && run >= def.maxRun) def = pickBuildingType(mood, hash01(s + 3.3));
    if (def.accent && plan.some((p) => p.type === def.type)) def = pickBuildingType(mood, hash01(s + 5.1));
    run = def.type === last ? run + 1 : 1; last = def.type;
    const w = def.width[0] + (def.width[1] - def.width[0]) * hash01(s + 1);
    const d = def.depth[0] + (def.depth[1] - def.depth[0]) * hash01(s + 2);
    const floors = Math.round(def.floors[0] + (def.floors[1] - def.floors[0]) * hash01(s + 4));
    const gap = def.sideGap[0] + (def.sideGap[1] - def.sideGap[0]) * hash01(s + 6);
    plan.push({ type: def.type, x: x + w / 2, w, d, floors, seed: s });
    x += w + gap;
    hMax = Math.max(hMax, heightFor(def, floors)); dMax = Math.max(dMax, d);
    i++;
  }
  const total = x;
  return {
    name: `${mood}_street_row`,
    size: [total, Math.min(hMax, 40), dMax],
    group: `${mood}-row`,
    build(world, inked, L) {
      for (const p of plan) {
        const m = new Matrix4().makeTranslation(p.x - total / 2, 0, 0);
        const im = inked.m.clone();
        world.push(m); inked.m.multiply(m);
        buildBuilding(world, inked, L, { type: p.type, width: p.w, depth: p.d, floors: p.floors, seed: p.seed });
        world.pop(); inked.m.copy(im);
      }
    },
  };
}

function typeItems(): KitPreviewItem[] {
  const out: KitPreviewItem[] = [];
  for (const def of BUILDING_TYPES) {
    const vs = VARIANTS[def.type] ?? [{ width: (def.width[0] + def.width[1]) / 2, depth: (def.depth[0] + def.depth[1]) / 2, floors: def.floors[0], seed: 1 }];
    vs.forEach((v, k) => {
      out.push({
        name: vs.length > 1 ? `${def.type}_${k + 1}` : def.type,
        size: [v.width, Math.min(heightFor(def, v.floors), 70), v.depth],
        group: def.moods[0],
        build(world, inked, L, seed) {
          buildBuilding(world, inked, L, { type: def.type, width: v.width, depth: v.depth, floors: v.floors, seed: v.seed + (seed - 1) * 1000 });
        },
      });
    });
  }
  return out;
}

export const items: KitPreviewItem[] = [
  ...typeItems(),
  ...MOODS.map(farItem),
  ...MOODS.map((m) => rowItem(m, m === 'downtown' ? 90 : m === 'docks' ? 110 : 64)),
];
