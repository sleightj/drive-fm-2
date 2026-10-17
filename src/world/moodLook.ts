import { Color } from 'three';
import type { Mood } from './moods';
import type { RoadClass } from '../road/types';

/** Per-mood look: fog/haze tint and the asphalt each area's roads are paved with. */
export const MOOD_FOG: Record<Mood, { tint: Color; amount: number }> = {
  downtown: { tint: new Color(0x6f74ff), amount: 0.34 },
  oldtown: { tint: new Color(0xffa860), amount: 0.36 },
  midtown: { tint: new Color(0x5fd0c0), amount: 0.3 },
  docks: { tint: new Color(0x8fb0a0), amount: 0.4 },
  suburbs: { tint: new Color(0xff9cc8), amount: 0.3 },
  edge: { tint: new Color(0xd6e070), amount: 0.36 },
};

const ASPHALT: Record<RoadClass, Color> = {
  back: new Color(0x8a8796),
  avenue: new Color(0x7a7a8c),
  arterial: new Color(0x6c6d80),
};
const MOOD_ASPHALT: Record<Mood, Color> = {
  downtown: new Color(0x7c7e94),
  oldtown: new Color(0x948a88),
  midtown: new Color(0x868896),
  docks: new Color(0x8e9294),
  suburbs: new Color(0x8c8a98),
  edge: new Color(0x8a8a84),
};

const _c = new Color();
export function asphaltTone(cls: RoadClass, mood: Mood, age: number): [number, number, number] {
  _c.copy(ASPHALT[cls]).lerp(MOOD_ASPHALT[mood], 0.5);
  // older surfaces are lighter and greyer
  _c.multiplyScalar(0.92 + age * 0.16);
  return [_c.r, _c.g, _c.b];
}
