import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { GraphicsLevel } from '../game';

/** Per-frame inputs to the screen effects. */
export interface PostFrame {
  dt: number;
  kmh: number;
  boost: number; // 0..1 boost effect strength
  night: number; // 0..1
}

/**
 * Screen effects after the scene (placeholder: draws the scene directly while the effects
 * chain is being built).
 */
export class Post {
  constructor(public renderer: WebGLRenderer, public level: GraphicsLevel) {}
  setLevel(level: GraphicsLevel) { this.level = level; }
  setSize(_w: number, _h: number) {}
  render(scene: Scene, camera: PerspectiveCamera, _f: PostFrame) {
    this.renderer.render(scene, camera);
  }
}
