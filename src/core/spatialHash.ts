/** Uniform-grid spatial hash over XZ for items with an AABB. */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  constructor(public cell: number) {}
  private key(ix: number, iz: number) { return (ix + 32768) * 65536 + (iz + 32768); }
  insert(item: T, x0: number, z0: number, x1: number, z1: number) {
    const c = this.cell;
    const ax = Math.floor(x0 / c), bx = Math.floor(x1 / c), az = Math.floor(z0 / c), bz = Math.floor(z1 / c);
    for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
      const k = this.key(ix, iz);
      let l = this.cells.get(k);
      if (!l) { l = []; this.cells.set(k, l); }
      l.push(item);
    }
  }
  remove(item: T, x0: number, z0: number, x1: number, z1: number) {
    const c = this.cell;
    const ax = Math.floor(x0 / c), bx = Math.floor(x1 / c), az = Math.floor(z0 / c), bz = Math.floor(z1 / c);
    for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
      const k = this.key(ix, iz);
      const l = this.cells.get(k);
      if (!l) continue;
      const i = l.indexOf(item);
      if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
      if (!l.length) this.cells.delete(k);
    }
  }
  /** Calls fn for each item in cells overlapping the box (items may repeat across cells). */
  query(x0: number, z0: number, x1: number, z1: number, fn: (item: T) => void | boolean) {
    const c = this.cell;
    const ax = Math.floor(x0 / c), bx = Math.floor(x1 / c), az = Math.floor(z0 / c), bz = Math.floor(z1 / c);
    for (let ix = ax; ix <= bx; ix++) for (let iz = az; iz <= bz; iz++) {
      const l = this.cells.get(this.key(ix, iz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) if (fn(l[i]) === true) return;
    }
  }
  get size() { return this.cells.size; }
  clear() { this.cells.clear(); }
}
