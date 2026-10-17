import type { SlotStyle } from '../../render/actorMaterial';

/**
 * Palette for inked hero props (lamp posts, signal poles, guide-sign gantries...).
 * Inked props use the actor material with these slots; `slot` attribute = index here.
 */
export const PROP_SLOTS_LIST = ['steel', 'darksteel', 'concrete', 'lampglass', 'signblue', 'signwhite', 'red', 'yellow', 'green', 'wood', 'black', 'white', 'orange', 'chrome', 'brown', 'brass', 'teal'] as const;
export const PS = Object.fromEntries(PROP_SLOTS_LIST.map((n, i) => [n, i])) as Record<(typeof PROP_SLOTS_LIST)[number], number>;
export const PROP_STYLE: Record<string, SlotStyle> = {
  steel: { color: 0x9aa4b4, spec: 0.8, rim: 0.7 },
  darksteel: { color: 0x3c4352, spec: 0.6, rim: 0.6 },
  concrete: { color: 0xb8b2a8, rim: 0.4 },
  lampglass: { color: 0xfff2d0, spec: 1.0, rim: 0.4, emit: 1 },
  signblue: { color: 0x1d4fb8, rim: 0.4 },
  signwhite: { color: 0xf2f2ee, rim: 0.4 },
  red: { color: 0xd9283a, rim: 0.5 },
  yellow: { color: 0xf5c518, rim: 0.5 },
  green: { color: 0x2f9e5a, rim: 0.5 },
  wood: { color: 0x8a5a3a, rim: 0.4 },
  black: { color: 0x1a1a22, rim: 0.5 },
  white: { color: 0xf0f0ea, rim: 0.5 },
  orange: { color: 0xf07a20, rim: 0.5 },
  chrome: { color: 0xd8dee8, spec: 1.2, rim: 0.9 },
  // street kit (appended): 景観 dark brown poles, brass trim on Old Town lamps, teal avenue poles
  brown: { color: 0x4a3429, spec: 0.5, rim: 0.6 },
  brass: { color: 0xc89a48, spec: 1.1, rim: 0.8 },
  teal: { color: 0x2c5f62, spec: 0.7, rim: 0.7 },
};
