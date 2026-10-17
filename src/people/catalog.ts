import type { LevelSpec } from '../game';
import { CrowdOptions, CLIP_NAMES } from './crowd';

/** public/assets/people/people.json */
export interface PeopleMeta {
  atlas: string;
  fps: number;
  clips: Record<string, { seconds: number; speed: number; stride?: number }>;
  slots: string[];
  variants: { name: string; file: string; skates: boolean; triangles: number; height: number; palettes: Record<string, string>[] }[];
}

/**
 * People per graphics level (DESIGN.md §6: 40 / 22 / 10), how far they live from the camera,
 * and the far ring beyond which they may appear and vanish in view: at 150 m a 1.8 m person
 * is ~8 px tall at 1080p with the chase camera's 74–88° field of view.
 */
export function crowdLimits(level: LevelSpec): { cap: number; liveR: number; farR: number } {
  if (level.scale >= 1) return { cap: 40, liveR: 185, farR: 150 };
  if (level.scale >= 0.8) return { cap: 22, liveR: 175, farR: 145 };
  return { cap: 10, liveR: 165, farR: 140 };
}

export function crowdOptions(meta: PeopleMeta, level: LevelSpec, seed: number): CrowdOptions {
  const lim = crowdLimits(level);
  const clips = CLIP_NAMES.map((n) => ({ speed: meta.clips[n]?.speed ?? 0, seconds: meta.clips[n]?.seconds ?? 1 }));
  return {
    ...lim,
    seed,
    clips,
    variants: meta.variants.map((v) => ({ name: v.name, skates: v.skates, palettes: v.palettes.length, height: v.height })),
  };
}
