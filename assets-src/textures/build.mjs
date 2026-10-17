#!/usr/bin/env node
/**
 * Paints every texture-array layer for the world material and writes:
 *   public/assets/tex/world_albedo_<k>.webp  (4x4 grid of 512x512 layers per sheet)
 *   public/assets/tex/world_emit_<k>.webp    (4x4 grid of 256x256 layers per sheet)
 *   public/assets/tex/world_layers.json      ({ size, emitSize, perSheet, sheets, layers: {name: index} })
 *
 * Painters live in assets-src/textures/painters/*.mjs and export
 *   export const layers = [{ name, albedo(ctx, S, rng), emit?(ctx, S, rng) }, ...]
 * `ctx` is a @napi-rs/canvas 2D context of size S x S (512 for albedo, 256 for emissive; paint in
 * a resolution-independent way using S). Layers are sorted by painter file name then order, so
 * indices are stable as long as painters only append. `rng` is a seeded random() per layer.
 *
 * Also exports helpers in ./paintlib.mjs (fonts, brushes, gradients).
 * Run: node assets-src/textures/build.mjs [--only name-substring] [--preview out.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { rngFor } from './paintlib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'public/assets/tex');
fs.mkdirSync(outDir, { recursive: true });
const S = 512, E = 256, PER = 16, GRID = 4;

const files = fs.readdirSync(path.join(here, 'painters')).filter((f) => f.endsWith('.mjs')).sort();
const all = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(here, 'painters', f)).href);
  for (const l of mod.layers || []) all.push({ ...l, file: f });
}
const names = new Set();
for (const l of all) { if (names.has(l.name)) throw new Error('duplicate layer ' + l.name); names.add(l.name); }
const sheets = Math.max(1, Math.ceil(all.length / PER));
const manifest = { size: S, emitSize: E, perSheet: PER, grid: GRID, sheets, count: all.length, layers: {} };
const t0 = Date.now();
for (let k = 0; k < sheets; k++) {
  const A = createCanvas(S * GRID, S * GRID), Ag = A.getContext('2d');
  const M = createCanvas(E * GRID, E * GRID), Mg = M.getContext('2d');
  Ag.fillStyle = '#ff00ff'; Ag.fillRect(0, 0, A.width, A.height);
  Mg.fillStyle = '#000'; Mg.fillRect(0, 0, M.width, M.height);
  for (let i = 0; i < PER; i++) {
    const idx = k * PER + i;
    const l = all[idx];
    if (!l) break;
    manifest.layers[l.name] = idx;
    const c = createCanvas(S, S), g = c.getContext('2d');
    l.albedo(g, S, rngFor(l.name));
    Ag.drawImage(c, (i % GRID) * S, Math.floor(i / GRID) * S);
    if (l.emit) {
      const e = createCanvas(E, E), eg = e.getContext('2d');
      eg.fillStyle = 'rgba(0,0,0,0)'; eg.clearRect(0, 0, E, E);
      l.emit(eg, E, rngFor(l.name + ':emit'));
      Mg.drawImage(e, (i % GRID) * E, Math.floor(i / GRID) * E);
    }
  }
  fs.writeFileSync(path.join(outDir, `world_albedo_${k}.webp`), A.toBuffer('image/webp', 92));
  fs.writeFileSync(path.join(outDir, `world_emit_${k}.webp`), M.toBuffer('image/webp', 92));
  // A lossless PNG of the albedo sheet for review only (not loaded by the game).
}
fs.writeFileSync(path.join(outDir, 'world_layers.json'), JSON.stringify(manifest, null, 1));
console.log(`painted ${all.length} layers into ${sheets} sheet(s) in ${Date.now() - t0} ms`);
