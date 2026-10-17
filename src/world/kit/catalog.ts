import type { WorldGeom, InkedGeom } from './geom';

/**
 * Kit preview catalogue. Each kit module registers preview entries in a file named
 * src/world/kit/catalog_<area>.ts exporting `items: KitPreviewItem[]`; the kit previewer
 * (tools/kit-preview) picks them all up and renders them with the real world shader.
 */
export interface KitPreviewItem {
  name: string;
  /** rough footprint (m) so the previewer can frame and lay out items */
  size: [number, number, number];
  /** which mood(s) it belongs to, for grouping */
  group: string;
  build(world: WorldGeom, inked: InkedGeom, L: (layer: string) => number, seed: number): void;
}
