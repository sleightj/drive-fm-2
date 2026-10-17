import { Group, PerspectiveCamera } from 'three';
import type { RoadGenerator } from '../road/generator';
import type { RoadStream } from '../road/stream';
import type { RoadSurface } from '../road/surface';
import type { Car } from '../vehicle/car';
import type { LevelSpec } from '../game';

/** What the traffic system can see of the world. */
export interface TrafficDeps {
  gen: RoadGenerator;
  stream: RoadStream;
  surface: RoadSurface;
  level: LevelSpec;
  seed: number;
}

/**
 * Two-way traffic on every live road (placeholder: the traffic system is being built).
 * The game calls load() once, step() every fixed simulation step, update() every frame.
 */
export class Traffic {
  root = new Group();
  stats = { cars: 0 };
  constructor(public d: TrafficDeps) { this.root.name = 'traffic'; }
  async load(): Promise<void> {}
  /** Fixed-step simulation (1/120 s), including contacts with the player's car. */
  step(_dt: number, _car: Car): void {}
  /** Per frame: spawning out of view, despawning, instance matrices relative to the render origin. */
  update(_dt: number, _camera: PerspectiveCamera, _originX: number, _originZ: number, _car: Car): void {}
  /** Paths removed from the network (trimmed behind or the untaken fork branch). */
  pathsRemoved(_ids: number[]): void {}
}
