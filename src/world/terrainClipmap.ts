import {
  BufferAttribute, BufferGeometry, DataArrayTexture, FloatType, Group, Mesh, NearestFilter, RedFormat,
  RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2, LinearFilter, ClampToEdgeWrapping, Texture,
} from 'three';
import { TerrainField, Rect } from './terrain';
import { env } from '../render/environment';
import { ENV_PARS, FOG_FN, HEADLIGHT_FN } from '../render/glsl';

/**
 * The terrain on screen: a geometry clipmap. Each level is an N×N grid of land heights at
 * spacing 4·2^l m centred on the camera, stored toroidally in a float texture array and
 * updated incrementally on the CPU (rows entering as the camera moves, blocks invalidated
 * when the road network changes). One static grid mesh per level reads its heights in the
 * vertex shader; near its outer edge each level morphs into the next coarser one and the
 * coarser level discards the pixels the finer one covers, so the seams are closed.
 *
 * A level's displayed centre only advances once every texel of the new region is
 * computed, so half-built rows are never shown.
 */

export const CLIP_N = 128;
const B = 8; // block size (texels) for CPU evaluation
const INVALID = 0x7fffffff;

interface Blk { bx: number; bz: number; x0: number; z0: number; x1: number; z1: number }

interface Level {
  l: number;
  sp: number;
  shown: Vector2; // displayed centre (grid units)
  target: Vector2;
  ready: boolean; // every texel of the shown region has been computed at least once
  gx: Int32Array; // grid coords each texel currently holds
  gz: Int32Array;
  h: Float32Array; // this level's layer of the height texture
  ma: Uint8Array; // this level's two layers of the material texture (mood weights 0-3; 4-5, road, variation)
  mb: Uint8Array;
  dirty: boolean;
  /** blocks still to compute for the current target, each with the box of texels it lacks (null: rescan) */
  list: Blk[] | null;
  changed: boolean; // needs upload
}

export interface ClipmapOptions {
  /** levels allocated (the most any graphics level uses) */
  levels: number;
  /** levels drawn and kept current (default: all); changeable with setActiveLevels */
  active?: number;
  /** ground layers per mood (texture array indices) and their tile sizes in metres */
  moodLayers: number[];
  moodTiles: number[];
  slopeLayer: number;
  slopeTile: number;
  albedo: Texture | DataArrayTexture;
}

const VERT = /* glsl */ `
precision highp sampler2DArray;
precision highp int;
uniform highp sampler2DArray uHeight;
uniform highp sampler2DArray uMat;
uniform int uLevel;
uniform int uLevels;
uniform float uSpacing;
uniform ivec2 uC;
uniform vec2 uOrigin; // render origin (world)
varying vec3 vWP;
varying vec3 vN;
varying vec3 vMoodA;
varying vec3 vMoodB;
varying vec2 vExtra;
const int N = ${CLIP_N};

ivec2 wrapT(ivec2 g) { return g & (N - 1); } // two's complement: a true modulo for negatives too
float hAt(ivec2 g, int l) { return texelFetch(uHeight, ivec3(wrapT(g), l), 0).r; }

void main() {
  ivec2 ij = ivec2(position.xz + 0.5);
  ivec2 g = uC - N / 2 + ij;
  float h = hAt(g, uLevel);
  // own normal from neighbours
  float hx0 = hAt(g - ivec2(1, 0), uLevel), hx1 = hAt(g + ivec2(1, 0), uLevel);
  float hz0 = hAt(g - ivec2(0, 1), uLevel), hz1 = hAt(g + ivec2(0, 1), uLevel);
  vec3 n = normalize(vec3(hx0 - hx1, 2.0 * uSpacing, hz0 - hz1));
  // morph toward the coarser level near the outer edge
  ivec2 e0 = g - (uC - N / 2), e1 = (uC + N / 2 - 1) - g;
  int dEdge = min(min(e0.x, e1.x), min(e0.y, e1.y));
  float a = uLevel < uLevels - 1 ? 1.0 - smoothstep(2.0, 16.0, float(dEdge)) : 0.0;
  if (a > 0.0) {
    vec2 gc = vec2(g) * 0.5;
    ivec2 c0 = ivec2(floor(gc));
    vec2 f = gc - vec2(c0);
    int lc = uLevel + 1;
    float c00 = hAt(c0, lc), c10 = hAt(c0 + ivec2(1, 0), lc), c01 = hAt(c0 + ivec2(0, 1), lc), c11 = hAt(c0 + ivec2(1, 1), lc);
    float hc = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    float sc = uSpacing * 2.0;
    vec3 nc = normalize(vec3(-mix(c10 - c00, c11 - c01, f.y), sc, -mix(c01 - c00, c11 - c10, f.x)));
    h = mix(h, hc, a);
    n = normalize(mix(n, nc, a));
  }
  vec4 m0 = texelFetch(uMat, ivec3(wrapT(g), uLevel * 2), 0);
  vec4 m1 = texelFetch(uMat, ivec3(wrapT(g), uLevel * 2 + 1), 0);
  vMoodA = m0.xyz;
  vMoodB = vec3(m0.w, m1.x, m1.y);
  vExtra = m1.zw;
  vec3 wp = vec3(vec2(g).x * uSpacing - uOrigin.x, h, vec2(g).y * uSpacing - uOrigin.y);
  vWP = wp;
  vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp sampler2DArray;
precision highp int;
${ENV_PARS}
${FOG_FN}
${HEADLIGHT_FN}
uniform sampler2DArray uAlbedo;
uniform int uLevel;
uniform float uSpacing;
uniform ivec2 uCF; // centre of the next finer level
uniform float uFineOn; // the finer level is drawn
uniform vec2 uOrigin;
uniform float uLayers[6];
uniform float uTiles[6];
uniform float uSlopeLayer;
uniform float uSlopeTile;
varying vec3 vWP;
varying vec3 vN;
varying vec3 vMoodA;
varying vec3 vMoodB;
varying vec2 vExtra;
const int N = ${CLIP_N};

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 world = vWP.xz + uOrigin;
  if (uLevel > 0 && uFineOn > 0.5) {
    // the finer level draws here (one finer cell of overlap at its rim)
    float sf = uSpacing * 0.5;
    vec2 gf = world / sf;
    vec2 lo = vec2(uCF - N / 2 + 1), hi = vec2(uCF + N / 2 - 2);
    if (all(greaterThan(gf, lo)) && all(lessThan(gf, hi))) discard;
  }
  vec3 N3 = normalize(vN);
  float w[6];
  w[0] = vMoodA.x; w[1] = vMoodA.y; w[2] = vMoodA.z; w[3] = vMoodB.x; w[4] = vMoodB.y; w[5] = vMoodB.z;
  vec3 alb = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 6; i++) {
    if (w[i] > 0.01) {
      alb += w[i] * texture(uAlbedo, vec3(world / uTiles[i], uLayers[i])).rgb;
      ws += w[i];
    }
  }
  alb /= max(ws, 1e-3);
  // steep ground: bare earth
  float steep = smoothstep(0.86, 0.7, N3.y);
  if (steep > 0.0) alb = mix(alb, texture(uAlbedo, vec3(world / uSlopeTile, uSlopeLayer)).rgb, steep);
  // broad painted variation so far ground does not read as a repeated tile
  float v = vnoise(world / 90.0) * 0.6 + vnoise(world / 23.0) * 0.4;
  alb *= 0.84 + 0.3 * v;
  // a darker band hugging the road edges (gutter grime, shade under the kerb)
  alb *= 1.0 - 0.18 * vExtra.x;

  float ndl = dot(N3, uSunDir);
  float sunT = smoothstep(0.2, 0.8, ndl * 0.5 + 0.5);
  vec3 amb = mix(uAmbBottom, uAmbTop, N3.y * 0.5 + 0.5);
  vec3 shadeLight = amb * 0.55 + uShadowTint * 0.55;
  vec3 sunLight = uSunColor * 0.92 + amb * 0.28;
  vec3 col = alb * mix(shadeLight, sunLight, sunT);
  col += alb * headlight(vWP, N3);
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function gridGeometry(n: number, holeHalf: number): BufferGeometry {
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j * n + i) * 3;
    pos[o] = i; pos[o + 1] = 0; pos[o + 2] = j;
  }
  const idx: number[] = [];
  const c = n / 2;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    if (holeHalf > 0 && i >= c - holeHalf && i + 1 <= c + holeHalf && j >= c - holeHalf && j + 1 <= c + holeHalf) continue;
    const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
    // split along (0,0)-(1,1); counter-clockwise from above
    idx.push(a, e, b, a, d, e);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class TerrainClipmap {
  levels: Level[] = [];
  heightTex: DataArrayTexture;
  matTex: DataArrayTexture;
  root = new Group();
  meshes: Mesh[] = [];
  private blockH = new Float32Array(B * B);
  private blockM = new Uint8Array(B * B * 8);
  private origin = new Vector2();
  stats = { blocks: 0, ms: 0, pendingBlocks: 0, lastMaxBlockMs: 0, maxBlockMs: 0 };
  /** levels drawn and kept current; the rest are hidden and skipped */
  active: number;

  constructor(public field: TerrainField, public opt: ClipmapOptions) {
    const L = opt.levels, n = CLIP_N;
    this.active = Math.min(L, opt.active ?? L);
    const H = new Float32Array(n * n * L), M = new Uint8Array(n * n * 4 * L * 2);
    for (let l = 0; l < L; l++) {
      const gx = new Int32Array(n * n).fill(INVALID), gz = new Int32Array(n * n).fill(INVALID);
      this.levels.push({
        l, sp: 4 * 2 ** l, shown: new Vector2(), target: new Vector2(), ready: false, gx, gz,
        h: H.subarray(l * n * n, (l + 1) * n * n),
        ma: M.subarray(2 * l * n * n * 4, (2 * l + 1) * n * n * 4),
        mb: M.subarray((2 * l + 1) * n * n * 4, (2 * l + 2) * n * n * 4),
        dirty: true, list: null, changed: false,
      });
    }
    this.heightTex = new DataArrayTexture(H, n, n, L);
    this.heightTex.format = RedFormat;
    this.heightTex.type = FloatType;
    this.heightTex.minFilter = this.heightTex.magFilter = NearestFilter;
    this.heightTex.generateMipmaps = false;
    this.heightTex.wrapS = this.heightTex.wrapT = ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;
    this.matTex = new DataArrayTexture(M, n, n, L * 2);
    this.matTex.format = RGBAFormat;
    this.matTex.type = UnsignedByteType;
    this.matTex.minFilter = this.matTex.magFilter = LinearFilter;
    this.matTex.generateMipmaps = false;
    this.matTex.needsUpdate = true;

    const full = gridGeometry(n, 0);
    const ring = gridGeometry(n, n / 4 - 4);
    for (let l = 0; l < L; l++) {
      const lv = this.levels[l];
      const mat = new ShaderMaterial({
        uniforms: {
          ...env,
          uHeight: { value: this.heightTex },
          uMat: { value: this.matTex },
          uAlbedo: { value: opt.albedo },
          uLevel: { value: l },
          uLevels: { value: this.active },
          uSpacing: { value: lv.sp },
          uC: { value: lv.shown },
          uFineOn: { value: 0 },
          uCF: { value: l > 0 ? this.levels[l - 1].shown : new Vector2() },
          uOrigin: { value: this.origin },
          uLayers: { value: opt.moodLayers },
          uTiles: { value: opt.moodTiles },
          uSlopeLayer: { value: opt.slopeLayer },
          uSlopeTile: { value: opt.slopeTile },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 2,
      });
      const mesh = new Mesh(l === 0 ? full : ring, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 5; // after the road and buildings (early depth rejects hidden ground)
      mesh.name = `terrain${l}`;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }

  setOrigin(x: number, z: number) { this.origin.set(x, z); }

  /**
   * Draw and maintain only the finest `n` levels (graphics settings). Hidden levels keep
   * tracking invalidations, so when they come back only stale texels are recomputed.
   */
  setActiveLevels(n: number) {
    this.active = Math.max(1, Math.min(this.levels.length, n));
    for (let l = 0; l < this.levels.length; l++) {
      (this.meshes[l].material as ShaderMaterial).uniforms.uLevels.value = this.active;
      if (l >= this.active) this.meshes[l].visible = false;
    }
  }

  /** Swap the ground texture array (graphics settings reload textures at another size). */
  setAlbedo(t: Texture | DataArrayTexture) {
    this.opt.albedo = t;
    for (const m of this.meshes) (m.material as ShaderMaterial).uniforms.uAlbedo.value = t;
  }

  /** Invalidate texels inside world rectangles (the road network changed there). */
  invalidate(rects: Rect[]) {
    const n = CLIP_N;
    for (const lv of this.levels) {
      for (const r of rects) {
        const gx0 = Math.ceil(r.x0 / lv.sp), gx1 = Math.floor(r.x1 / lv.sp);
        const gz0 = Math.ceil(r.z0 / lv.sp), gz1 = Math.floor(r.z1 / lv.sp);
        const tx0 = lv.target.x - n / 2, tz0 = lv.target.y - n / 2;
        const a0 = Math.max(gx0, tx0), a1 = Math.min(gx1, tx0 + n - 1);
        const b0 = Math.max(gz0, tz0), b1 = Math.min(gz1, tz0 + n - 1);
        if (a0 > a1 || b0 > b1) continue;
        for (let gz = b0; gz <= b1; gz++) for (let gx = a0; gx <= a1; gx++) {
          const t = (((gz % n) + n) % n) * n + (((gx % n) + n) % n);
          lv.gx[t] = INVALID;
        }
        lv.dirty = true;
        lv.list = null;
      }
    }
  }

  /**
   * Move the levels toward the camera and compute missing texels, nearest blocks first,
   * within `budgetMs`. `force` computes everything (loading). Returns blocks still pending.
   */
  update(cx: number, cz: number, budgetMs: number, force = false): number {
    const t0 = performance.now();
    const n = CLIP_N;
    let pending = 0;
    const act = this.levels.slice(0, this.active);
    for (const lv of act) {
      const tx = Math.round(cx / lv.sp), tz = Math.round(cz / lv.sp);
      if (tx !== lv.target.x || tz !== lv.target.y) {
        // never jump more than 2 texels ahead of what is shown (the trailing rows that get
        // overwritten are inside the fully-morphed rim); a big jump recomputes everything
        const far = Math.abs(tx - lv.shown.x) > n / 4 || Math.abs(tz - lv.shown.y) > n / 4;
        if (far || !lv.ready) { lv.target.set(tx, tz); lv.ready = false; }
        else lv.target.set(lv.shown.x + Math.sign(tx - lv.shown.x) * Math.min(2, Math.abs(tx - lv.shown.x)), lv.shown.y + Math.sign(tz - lv.shown.y) * Math.min(2, Math.abs(tz - lv.shown.y)));
        lv.dirty = true;
        lv.list = null;
      }
    }
    // blocks that need work (scanned once per change of target or invalidation), nearest to
    // the camera first, finer levels first on ties
    const todo: { lv: Level; b: Blk; d: number }[] = [];
    for (const lv of act) {
      if (!lv.dirty) continue;
      if (!lv.list) lv.list = this.scan(lv);
      if (!lv.list.length) { this.settle(lv); continue; }
      for (const b of lv.list) {
        const d = Math.hypot((b.bx + 0.5) * B * lv.sp - cx, (b.bz + 0.5) * B * lv.sp - cz);
        todo.push({ lv, b, d: d * (1 + lv.l * 0.15) });
      }
    }
    todo.sort((a, b) => a.d - b.d);
    let done = 0;
    const doneSet = new Set<Level>();
    this.stats.lastMaxBlockMs = 0;
    for (const b of todo) {
      if (!force && performance.now() - t0 > budgetMs) break;
      const tb = performance.now();
      this.computeBlock(b.lv, b.b);
      const dt = performance.now() - tb;
      if (dt > this.stats.lastMaxBlockMs) this.stats.lastMaxBlockMs = dt;
      if (!force && dt > this.stats.maxBlockMs) this.stats.maxBlockMs = dt;
      doneSet.add(b.lv);
      done++;
    }
    pending = todo.length - done;
    // drop computed blocks from their level's list; a level with none left is complete
    for (const lv of doneSet) {
      const left = todo.slice(done).filter((b) => b.lv === lv).map((b) => b.b);
      lv.list = left;
      if (!left.length) this.settle(lv);
    }
    this.upload();
    for (let l = 0; l < this.levels.length; l++) {
      this.meshes[l].visible = l < this.active && this.levels[l].ready;
      if (l > 0) (this.meshes[l].material as ShaderMaterial).uniforms.uFineOn.value = this.levels[l - 1].ready ? 1 : 0;
    }
    this.stats.blocks += done;
    this.stats.pendingBlocks = pending;
    this.stats.ms = performance.now() - t0;
    return pending;
  }

  /**
   * Blocks of the level's target window holding texels that are not current, each with the
   * box of those texels (a one-texel move of the window only recomputes the new row).
   */
  private scan(lv: Level): Blk[] {
    const n = CLIP_N, mask = n - 1;
    const gx0 = lv.target.x - n / 2, gz0 = lv.target.y - n / 2;
    const out: Blk[] = [];
    const bx0 = Math.floor(gx0 / B), bx1 = Math.floor((gx0 + n - 1) / B);
    const bz0 = Math.floor(gz0 / B), bz1 = Math.floor((gz0 + n - 1) / B);
    for (let bz = bz0; bz <= bz1; bz++) {
      const za = Math.max(bz * B, gz0), zb = Math.min(bz * B + B - 1, gz0 + n - 1);
      for (let bx = bx0; bx <= bx1; bx++) {
        const xa = Math.max(bx * B, gx0), xb = Math.min(bx * B + B - 1, gx0 + n - 1);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let gz = za; gz <= zb; gz++) {
          const row = (gz & mask) * n;
          for (let gx = xa; gx <= xb; gx++) {
            const t = row + (gx & mask);
            if (lv.gx[t] !== gx || lv.gz[t] !== gz) {
              if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gz < z0) z0 = gz; if (gz > z1) z1 = gz;
            }
          }
        }
        if (x1 >= x0) out.push({ bx, bz, x0, z0, x1, z1 });
      }
    }
    return out;
  }

  private settle(lv: Level) {
    lv.dirty = false;
    lv.shown.copy(lv.target);
    lv.ready = true;
  }

  private computeBlock(lv: Level, b: Blk) {
    const n = CLIP_N, mask = n - 1;
    const nx = b.x1 - b.x0 + 1, nz = b.z1 - b.z0 + 1;
    this.field.fillBlock(b.x0, b.z0, nx, nz, lv.sp, this.blockH, this.blockM);
    const M = this.blockM;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const gx = b.x0 + i, gz = b.z0 + j;
      const t = (gz & mask) * n + (gx & mask);
      const o = j * nx + i, s8 = o * 8, t4 = t * 4;
      lv.h[t] = this.blockH[o];
      lv.ma[t4] = M[s8]; lv.ma[t4 + 1] = M[s8 + 1]; lv.ma[t4 + 2] = M[s8 + 2]; lv.ma[t4 + 3] = M[s8 + 3];
      lv.mb[t4] = M[s8 + 4]; lv.mb[t4 + 1] = M[s8 + 5]; lv.mb[t4 + 2] = M[s8 + 6]; lv.mb[t4 + 3] = M[s8 + 7];
      lv.gx[t] = gx; lv.gz[t] = gz;
    }
    lv.changed = true;
  }

  /** Texel data is written straight into the textures; only the changed layers go up. */
  private upload() {
    for (const lv of this.levels) {
      if (!lv.changed) continue;
      lv.changed = false;
      this.heightTex.addLayerUpdate(lv.l);
      this.heightTex.needsUpdate = true;
      this.matTex.addLayerUpdate(lv.l * 2);
      this.matTex.addLayerUpdate(lv.l * 2 + 1);
      this.matTex.needsUpdate = true;
    }
  }

  /**
   * Terrain height at (x, z) as drawn by the finest level that holds that spot (triangle
   * interpolation on that level's grid), or null when no level has it computed.
   */
  heightAt(x: number, z: number): number | null {
    const n = CLIP_N;
    for (const lv of this.levels) {
      if (lv.l >= this.active) break;
      if (!lv.ready && lv.l > 0) continue;
      const fx = x / lv.sp, fz = z / lv.sp;
      const gx = Math.floor(fx), gz = Math.floor(fz);
      const at = (a: number, b: number) => {
        const t = (((b % n) + n) % n) * n + (((a % n) + n) % n);
        return lv.gx[t] === a && lv.gz[t] === b ? lv.h[t] : NaN;
      };
      const h00 = at(gx, gz), h11 = at(gx + 1, gz + 1);
      const u = fx - gx, v = fz - gz;
      let h: number;
      if (u >= v) { const h10 = at(gx + 1, gz); h = h00 + (h10 - h00) * u + (h11 - h10) * v; }
      else { const h01 = at(gx, gz + 1); h = h00 + (h11 - h01) * u + (h01 - h00) * v; }
      if (!Number.isNaN(h)) return h;
    }
    return null;
  }

  /**
   * The finest computed terrain height at a 4 m grid point, if level 0 holds it (lets the
   * roadside stand things on exactly what is drawn without re-evaluating the field).
   */
  cachedGrid = (gx: number, gz: number): number | undefined => {
    const lv = this.levels[0];
    const n = CLIP_N;
    const t = (((gz % n) + n) % n) * n + (((gx % n) + n) % n);
    return lv.gx[t] === gx && lv.gz[t] === gz ? lv.h[t] : undefined;
  };
}
