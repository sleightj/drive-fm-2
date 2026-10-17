import { Group, PerspectiveCamera } from 'three';
import type { ChunkManager } from '../world/chunks';
import type { Roadside } from '../world/roadside';
import type { LevelSpec } from '../game';
import type { Car } from '../vehicle/car';

export interface PeopleDeps {
  chunks: ChunkManager;
  roadside: Roadside;
  level: LevelSpec;
  seed: number;
}

/**
 * Pedestrians on the sidewalks (placeholder: the people system is being built).
 * The game calls load() once and update() every frame.
 */
export class People {
  root = new Group();
  stats = { people: 0 };
  constructor(public d: PeopleDeps) { this.root.name = 'people'; }
  async load(): Promise<void> {}
  update(_dt: number, _camera: PerspectiveCamera, _originX: number, _originZ: number, _car: Car): void {}
}
