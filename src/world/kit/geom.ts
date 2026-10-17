import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';

/**
 * Geometry builder for the painted world (see src/render/worldMaterial.ts for what each
 * attribute means). Everything in the city kit is written through this, so a whole chunk
 * merges into one geometry and one draw call.
 *
 * Conventions: metres, +Y up. Texture repeats are in world metres: `tile` gives the size in
 * metres of one repeat of a texture-array layer (u across, v up).
 */

export class F32 {
  a: Float32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Float32Array(cap);
  }
  push(...v: number[]) {
    this.ensure(v.length);
    for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i];
  }
  push3(x: number, y: number, z: number) {
    this.ensure(3);
    const a = this.a;
    a[this.n++] = x;
    a[this.n++] = y;
    a[this.n++] = z;
  }
  push4(x: number, y: number, z: number, w: number) {
    this.ensure(4);
    const a = this.a;
    a[this.n++] = x;
    a[this.n++] = y;
    a[this.n++] = z;
    a[this.n++] = w;
  }
  push1(x: number) {
    this.ensure(1);
    this.a[this.n++] = x;
  }
  ensure(k: number) {
    if (this.n + k > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
  }
  view() {
    return this.a.slice(0, this.n);
  }
  reset() {
    this.n = 0;
  }
}

export interface Mat {
  layer: number; // texture-array layer, -1 = untextured
  tile?: [number, number]; // metres per texture repeat (u, v); default [4, 4]
  color?: [number, number, number]; // linear tint
  seed?: number; // per-building window seed
}

const _v = new Vector3();
const _n = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();
const _e1 = new Vector3(), _e2 = new Vector3();

export class WorldGeom {
  pos = new F32(4096);
  nor = new F32(4096);
  uvl = new F32(4096);
  col = new F32(4096);
  grad = new F32(1400);
  light = new F32(5600);
  /** current transform applied to everything written */
  m = new Matrix4();
  private nm = new Matrix4();
  private stack: Matrix4[] = [];
  /** current per-vertex night-light/seed (a = window seed) */
  seed = 0;

  get vertexCount() {
    return this.pos.n / 3;
  }
  get triangleCount() {
    return this.pos.n / 9;
  }

  push(mat: Matrix4) {
    this.stack.push(this.m.clone());
    this.m.multiply(mat);
  }
  pop() {
    this.m.copy(this.stack.pop()!);
  }
  setTransform(mat: Matrix4) {
    this.m.copy(mat);
  }

  /** Raw vertex in local (pre-transform) coordinates. */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, layer: number, cr: number, cg: number, cb: number, g: number) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).transformDirection(this.m);
    this.pos.push3(_v.x, _v.y, _v.z);
    this.nor.push3(_n.x, _n.y, _n.z);
    this.uvl.push3(u, v, layer);
    this.col.push3(cr, cg, cb);
    this.grad.push1(g);
    this.light.push4(0, 0, 0, this.seed);
  }

  /**
   * A quad p0→p1→p2→p3 (counter-clockwise seen from the front). uv per corner given
   * explicitly. g0/g1 = gradient value at the bottom (p0,p1) and top (p2,p3).
   */
  quadUV(
    p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3,
    uv: [number, number, number, number, number, number, number, number],
    mat: Mat, g0 = -1, g1 = -1,
  ) {
    _e1.subVectors(p1, p0);
    _e2.subVectors(p3, p0);
    _n.crossVectors(_e1, _e2).normalize();
    const nx = _n.x, ny = _n.y, nz = _n.z;
    const [r, gg, b] = mat.color ?? [1, 1, 1];
    const L = mat.layer;
    const pts = [p0, p1, p2, p0, p2, p3];
    const uvs = [0, 1, 2, 0, 2, 3];
    const gs = [g0, g0, g1, g0, g1, g1];
    for (let i = 0; i < 6; i++) {
      const p = pts[i];
      const k = uvs[i];
      this.vert(p.x, p.y, p.z, nx, ny, nz, uv[k * 2], uv[k * 2 + 1], L, r, gg, b, gs[i]);
    }
  }

  /**
   * Vertical wall from (x0,z0) to (x1,z1) between heights y0..y1. The front faces (-dz, 0, dx):
   * walking from a to b (+Y up), the front is on your right. `flip` swaps it.
   * Texture repeats per `mat.tile` metres; u0/v0 offset the pattern.
   * gBase/gTop: gradient at y0 and y1 (default 0 → 1).
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: Mat, opts: { u0?: number; v0?: number; gBase?: number; gTop?: number; flip?: boolean; uv?: [number, number, number, number] } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const [tu, tv] = mat.tile ?? [4, 4];
    const u0 = opts.u0 ?? 0, v0 = opts.v0 ?? 0;
    const ua = opts.uv ? opts.uv[0] : u0, ub = opts.uv ? opts.uv[2] : u0 + len / tu;
    const va = opts.uv ? opts.uv[1] : v0 + y0 / tv, vb = opts.uv ? opts.uv[3] : v0 + y1 / tv;
    const gB = opts.gBase ?? 0, gT = opts.gTop ?? 1;
    if (opts.flip) {
      _a.set(x1, y0, z1); _b.set(x0, y0, z0); _c.set(x0, y1, z0); _d.set(x1, y1, z1);
      this.quadUV(_a, _b, _c, _d, [ua, va, ub, va, ub, vb, ua, vb], mat, gB, gT);
    } else {
      _a.set(x0, y0, z0); _b.set(x1, y0, z1); _c.set(x1, y1, z1); _d.set(x0, y1, z0);
      this.quadUV(_a, _b, _c, _d, [ua, va, ub, va, ub, vb, ua, vb], mat, gB, gT);
    }
  }

  /** Horizontal quad (roof, slab, ground patch) facing up (or down with flip). */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, mat: Mat, opts: { flip?: boolean; g?: number; uv?: [number, number, number, number] } = {}) {
    const [tu, tv] = mat.tile ?? [4, 4];
    const uv = opts.uv ?? [x0 / tu, z0 / tv, x1 / tu, z1 / tv];
    const g = opts.g ?? -1;
    if (!opts.flip) {
      _a.set(x0, y, z1); _b.set(x1, y, z1); _c.set(x1, y, z0); _d.set(x0, y, z0);
      this.quadUV(_a, _b, _c, _d, [uv[0], uv[3], uv[2], uv[3], uv[2], uv[1], uv[0], uv[1]], mat, g, g);
    } else {
      _a.set(x0, y, z0); _b.set(x1, y, z0); _c.set(x1, y, z1); _d.set(x0, y, z1);
      this.quadUV(_a, _b, _c, _d, [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], mat, g, g);
    }
  }

  /**
   * Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1] in the current transform. `faces` picks a
   * material per face (+x,-x,+z,-z,top,bottom); missing faces are skipped.
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: { px?: Mat; nx?: Mat; pz?: Mat; nz?: Mat; top?: Mat; bottom?: Mat; all?: Mat }, opts: { gBase?: number; gTop?: number } = {}) {
    const f = (k: keyof typeof faces) => faces[k] ?? faces.all;
    const gB = opts.gBase ?? 0, gT = opts.gTop ?? 1;
    const m = f('pz'); if (m) this.wall(x0, z1, x1, z1, y0, y1, m, { gBase: gB, gTop: gT });
    const m2 = f('nz'); if (m2) this.wall(x0, z0, x1, z0, y0, y1, m2, { gBase: gB, gTop: gT, flip: true });
    const m3 = f('px'); if (m3) this.wall(x1, z0, x1, z1, y0, y1, m3, { gBase: gB, gTop: gT, flip: true });
    const m4 = f('nx'); if (m4) this.wall(x0, z0, x0, z1, y0, y1, m4, { gBase: gB, gTop: gT });
    const t = f('top'); if (t) this.flat(x0, z0, x1, z1, y1, t);
    const b = f('bottom'); if (b) this.flat(x0, z0, x1, z1, y0, b, { flip: true });
  }

  /** Extrude a simple polygon footprint (either winding; walls face outward) from y0 to y1. */
  prism(pts: [number, number][], y0: number, y1: number, side: Mat, top: Mat | null, opts: { gBase?: number; gTop?: number } = {}) {
    let u = 0;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      area += ax * bz - bx * az;
    }
    const flip = area > 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      this.wall(ax, az, bx, bz, y0, y1, side, { u0: u, gBase: opts.gBase ?? 0, gTop: opts.gTop ?? 1, flip });
      u += Math.hypot(bx - ax, bz - az) / (side.tile?.[0] ?? 4);
    }
    if (top) this.capPolygon(pts, y1, top);
  }

  /** Triangle-fan cap (polygon must be convex or star-shaped from its first vertex). */
  capPolygon(pts: [number, number][], y: number, mat: Mat, down = false) {
    const [tu, tv] = mat.tile ?? [4, 4];
    const [r, g, b] = mat.color ?? [1, 1, 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const tri = down ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
      // CCW from above → normal +y requires (x,z) order clockwise in right-handed XZ; compute.
      const [p, q, s] = tri;
      const cross = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
      const order = (cross < 0) !== down ? [p, q, s] : [p, s, q];
      for (const v of order) this.vert(v[0], y, v[1], 0, down ? -1 : 1, 0, v[0] / tu, v[1] / tv, mat.layer, r, g, b, -1);
    }
  }

  /** Open or capped cylinder along +Y. */
  cylinder(x: number, z: number, y0: number, y1: number, r0: number, r1: number, seg: number, mat: Mat, opts: { capTop?: boolean; capBottom?: boolean; gBase?: number; gTop?: number } = {}) {
    const [cr, cg, cb] = mat.color ?? [1, 1, 1];
    const [tu, tv] = mat.tile ?? [4, 4];
    const circ = Math.PI * 2 * Math.max(r0, r1);
    const gB = opts.gBase ?? 0, gT = opts.gTop ?? 1;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const u0 = (i / seg) * circ / tu, u1 = ((i + 1) / seg) * circ / tu;
      const v0 = y0 / tv, v1 = y1 / tv;
      const n0 = new Vector3(c0, slope, s0).normalize(), n1 = new Vector3(c1, slope, s1).normalize();
      const P = [
        [x + c0 * r0, y0, z + s0 * r0, n0, u0, v0, gB], [x + c1 * r1, y1, z + s1 * r1, n1, u1, v1, gT], [x + c1 * r0, y0, z + s1 * r0, n1, u1, v0, gB],
        [x + c0 * r0, y0, z + s0 * r0, n0, u0, v0, gB], [x + c0 * r1, y1, z + s0 * r1, n0, u0, v1, gT], [x + c1 * r1, y1, z + s1 * r1, n1, u1, v1, gT],
      ] as const;
      for (const p of P) this.vert(p[0], p[1], p[2], p[3].x, p[3].y, p[3].z, p[4], p[5], mat.layer, cr, cg, cb, p[6]);
      if (opts.capTop && r1 > 0) {
        this.vert(x, y1, z, 0, 1, 0, 0.5, 0.5, mat.layer, cr, cg, cb, gT);
        this.vert(x + c1 * r1, y1, z + s1 * r1, 0, 1, 0, 0.5 + c1 * 0.5, 0.5 + s1 * 0.5, mat.layer, cr, cg, cb, gT);
        this.vert(x + c0 * r1, y1, z + s0 * r1, 0, 1, 0, 0.5 + c0 * 0.5, 0.5 + s0 * 0.5, mat.layer, cr, cg, cb, gT);
      }
      if (opts.capBottom && r0 > 0) {
        this.vert(x, y0, z, 0, -1, 0, 0.5, 0.5, mat.layer, cr, cg, cb, gB);
        this.vert(x + c0 * r0, y0, z + s0 * r0, 0, -1, 0, 0.5 + c0 * 0.5, 0.5 + s0 * 0.5, mat.layer, cr, cg, cb, gB);
        this.vert(x + c1 * r0, y0, z + s1 * r0, 0, -1, 0, 0.5 + c1 * 0.5, 0.5 + s1 * 0.5, mat.layer, cr, cg, cb, gB);
      }
    }
  }

  /** Raw triangle with explicit normal computed from winding (CCW = front). */
  tri(a: Vector3, b: Vector3, c: Vector3, mat: Mat, uv?: [number, number, number, number, number, number], g = -1) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _n.crossVectors(_e1, _e2).normalize();
    const [r, gg, bb] = mat.color ?? [1, 1, 1];
    const u = uv ?? [0, 0, 1, 0, 0, 1];
    this.vert(a.x, a.y, a.z, _n.x, _n.y, _n.z, u[0], u[1], mat.layer, r, gg, bb, g);
    this.vert(b.x, b.y, b.z, _n.x, _n.y, _n.z, u[2], u[3], mat.layer, r, gg, bb, g);
    this.vert(c.x, c.y, c.z, _n.x, _n.y, _n.z, u[4], u[5], mat.layer, r, gg, bb, g);
  }

  /** Append another builder's vertices transformed by `mat` (world placement of a kit piece). */
  append(o: WorldGeom, mat?: Matrix4) {
    const n = o.vertexCount;
    if (!n) return;
    const M = mat ? new Matrix4().multiplyMatrices(this.m, mat) : this.m;
    const p = o.pos.a, nr = o.nor.a;
    this.pos.ensure(n * 3); this.nor.ensure(n * 3); this.uvl.ensure(n * 3); this.col.ensure(n * 3); this.grad.ensure(n); this.light.ensure(n * 4);
    const e = M.elements;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      this.pos.a[this.pos.n++] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos.a[this.pos.n++] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos.a[this.pos.n++] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = nr[i * 3], ny = nr[i * 3 + 1], nz = nr[i * 3 + 2];
      let ax = e[0] * nx + e[4] * ny + e[8] * nz;
      let ay = e[1] * nx + e[5] * ny + e[9] * nz;
      let az = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      this.nor.a[this.nor.n++] = ax / l;
      this.nor.a[this.nor.n++] = ay / l;
      this.nor.a[this.nor.n++] = az / l;
    }
    this.uvl.a.set(o.uvl.a.subarray(0, n * 3), this.uvl.n); this.uvl.n += n * 3;
    this.col.a.set(o.col.a.subarray(0, n * 3), this.col.n); this.col.n += n * 3;
    this.grad.a.set(o.grad.a.subarray(0, n), this.grad.n); this.grad.n += n;
    this.light.a.set(o.light.a.subarray(0, n * 4), this.light.n); this.light.n += n * 4;
  }

  /** Sets the window seed on vertices [from, vertexCount). */
  setSeed(from: number, seed: number) {
    for (let i = from; i < this.vertexCount; i++) this.light.a[i * 4 + 3] = seed;
  }

  /** Multiplies the tint of vertices [from, vertexCount) by rgb. */
  tint(from: number, r: number, g: number, b: number) {
    for (let i = from; i < this.vertexCount; i++) {
      this.col.a[i * 3] *= r;
      this.col.a[i * 3 + 1] *= g;
      this.col.a[i * 3 + 2] *= b;
    }
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new BufferAttribute(this.nor.view(), 3));
    g.setAttribute('uvl', new BufferAttribute(this.uvl.view(), 3));
    g.setAttribute('color', new BufferAttribute(this.col.view(), 3));
    g.setAttribute('aGrad', new BufferAttribute(this.grad.view(), 1));
    g.setAttribute('aLight', new BufferAttribute(this.light.view(), 4));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  reset() {
    this.pos.reset(); this.nor.reset(); this.uvl.reset(); this.col.reset(); this.grad.reset(); this.light.reset();
    this.m.identity();
    this.stack.length = 0;
  }
}

/**
 * Builder for inked hero props (lamp posts and the like) shaded with the actor material.
 * Attributes: position, normal, slot (palette index into PROP style). Ink smooth normals are
 * added when the chunk geometry is finalised.
 */
export class InkedGeom {
  pos = new F32(2048);
  nor = new F32(2048);
  slot = new F32(700);
  m = new Matrix4();
  get vertexCount() {
    return this.pos.n / 3;
  }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).transformDirection(this.m);
    this.pos.push3(_v.x, _v.y, _v.z);
    this.nor.push3(_n.x, _n.y, _n.z);
    this.slot.push1(s);
  }
  tri(a: Vector3, b: Vector3, c: Vector3, s: number) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _n.crossVectors(_e1, _e2).normalize();
    const nx = _n.x, ny = _n.y, nz = _n.z;
    this.vert(a.x, a.y, a.z, nx, ny, nz, s);
    this.vert(b.x, b.y, b.z, nx, ny, nz, s);
    this.vert(c.x, c.y, c.z, nx, ny, nz, s);
  }
  /** Closed cylinder (smooth sides) along +Y. */
  cylinder(x: number, z: number, y0: number, y1: number, r0: number, r1: number, seg: number, s: number, caps = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const P0 = [x + c0 * r0, y0, z + s0 * r0], P1 = [x + c1 * r0, y0, z + s1 * r0];
      const P2 = [x + c1 * r1, y1, z + s1 * r1], P3 = [x + c0 * r1, y1, z + s0 * r1];
      this.vert(P0[0], P0[1], P0[2], c0, 0, s0, s); this.vert(P2[0], P2[1], P2[2], c1, 0, s1, s); this.vert(P1[0], P1[1], P1[2], c1, 0, s1, s);
      this.vert(P0[0], P0[1], P0[2], c0, 0, s0, s); this.vert(P3[0], P3[1], P3[2], c0, 0, s0, s); this.vert(P2[0], P2[1], P2[2], c1, 0, s1, s);
      if (caps) {
        this.vert(x, y1, z, 0, 1, 0, s); this.vert(P2[0], P2[1], P2[2], 0, 1, 0, s); this.vert(P3[0], P3[1], P3[2], 0, 1, 0, s);
        this.vert(x, y0, z, 0, -1, 0, s); this.vert(P0[0], P0[1], P0[2], 0, -1, 0, s); this.vert(P1[0], P1[1], P1[2], 0, -1, 0, s);
      }
    }
  }
  /** Closed box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: number) {
    const c = [
      new Vector3(x0, y0, z0), new Vector3(x1, y0, z0), new Vector3(x1, y1, z0), new Vector3(x0, y1, z0),
      new Vector3(x0, y0, z1), new Vector3(x1, y0, z1), new Vector3(x1, y1, z1), new Vector3(x0, y1, z1),
    ];
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
    for (const q of f) {
      this.tri(c[q[0]], c[q[1]], c[q[2]], s);
      this.tri(c[q[0]], c[q[2]], c[q[3]], s);
    }
  }
  append(o: InkedGeom, mat: Matrix4) {
    const save = this.m.clone();
    this.m.multiply(mat);
    const n = o.vertexCount;
    for (let i = 0; i < n; i++) {
      this.vert(o.pos.a[i * 3], o.pos.a[i * 3 + 1], o.pos.a[i * 3 + 2], o.nor.a[i * 3], o.nor.a[i * 3 + 1], o.nor.a[i * 3 + 2], o.slot.a[i]);
    }
    this.m.copy(save);
  }
  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new BufferAttribute(this.nor.view(), 3));
    g.setAttribute('slot', new BufferAttribute(this.slot.view(), 1));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.vertexCount * 2), 2));
    return g;
  }
  reset() {
    this.pos.reset(); this.nor.reset(); this.slot.reset(); this.m.identity();
  }
}
