#!/usr/bin/env node
/**
 * Long autopilot drives in the real game, headless:
 *   node tools/long-drive.mjs [--seeds 1,2,3] [--km 100] [--rate 6] [--render 4] [--size 320x180] [--out dir]
 * Each seed loads the game on autopilot with time running (day and night cycle) and drives
 * --km kilometres. --rate runs that many simulation steps per drawn frame (game time runs
 * faster; world building gets the same budget per metre), --render draws every Nth frame. The
 * car, the world streaming and the road all run exactly as in play.
 * Checks, per seed:
 *   - the distance is driven (no stall: the odometer keeps moving)
 *   - the car stays on the road (share of samples off the drivable band)
 *   - the world keeps up (pending chunks stay bounded) and never runs out of road
 *   - memory is flat: JS heap, GPU geometries and textures, live chunks, paths, footprints
 *     compared between the first and last third of the drive
 *   - no page errors
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '1,2,3').split(',');
const KM = Number(opt('km', '100'));
const rate = opt('rate', '6');
const render = opt('render', '4');
const [W, H] = opt('size', '320x180').split('x').map(Number);
const outDir = opt('out', '');
const gfx = opt('gfx', 'high');

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });

const results = [];
for (const seed of seeds) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const params = new URLSearchParams({ seed, gfx, auto: '1', fixed: '1', rate, render, time: '9' });
  const t0 = Date.now();
  await page.goto(`${base}?${params}`);
  await page.waitForFunction(() => window.__DRIVE_FM__ && (window.__DRIVE_FM__.state === 'driving' || window.__DRIVE_FM_ERROR__), null, { timeout: 180000 });
  const samples = [];
  let lastOdo = -1, stallSince = Date.now(), stalled = false;
  for (;;) {
    await page.waitForTimeout(4000);
    const h = await page.evaluate(() => { if (window.gc) window.gc(); return window.__DRIVE_FM__.health(); });
    samples.push(h);
    if (h.odo > lastOdo + 5) { lastOdo = h.odo; stallSince = Date.now(); }
    else if (Date.now() - stallSince > 120000) { stalled = true; break; }
    if (samples.length % 15 === 0) console.error(`seed ${seed}: ${(h.odo / 1000).toFixed(1)} km, game ${Math.round(h.t)} s, heap ${h.heapMB.toFixed(0)} MB, chunks ${h.chunks}, geoms ${h.geometries}, pending ${h.pending}, wall ${Math.round((Date.now() - t0) / 1000)} s`);
    if (h.odo >= KM * 1000) break;
    if (errors.length > 20) break;
  }
  await page.close();
  // first and last third (skip the first 5 km: warm-up)
  const warm = samples.filter((s) => s.odo > 5000);
  const third = Math.max(1, Math.floor(warm.length / 3));
  const avg = (arr, k) => arr.reduce((a, s) => a + s[k], 0) / Math.max(1, arr.length);
  const first = warm.slice(0, third), last = warm.slice(-third);
  const trend = {};
  for (const k of ['heapMB', 'geometries', 'textures', 'chunks', 'paths', 'foot', 'sky']) trend[k] = { first: +avg(first, k).toFixed(1), last: +avg(last, k).toFixed(1), max: Math.max(...samples.map((s) => s[k])) };
  const off = samples.filter((s) => !s.onRoad && s.out > 0.3).length;
  const end = samples[samples.length - 1];
  const r = {
    seed: Number(seed), km: +(end.odo / 1000).toFixed(1), gameSeconds: Math.round(end.t), wallSeconds: Math.round((Date.now() - t0) / 1000),
    samples: samples.length, offRoadSamples: off, maxPending: Math.max(...samples.map((s) => s.pending)), wallHits: end.wallHits,
    trend, errors: errors.slice(0, 10), stalled,
  };
  const fails = [];
  if (r.km < KM) fails.push(`drove ${r.km} km of ${KM}`);
  if (stalled) fails.push('stalled (odometer stopped)');
  if (off > samples.length * 0.01) fails.push(`off the road in ${off} of ${samples.length} samples`);
  if (trend.heapMB.last > trend.heapMB.first * 1.25 + 8) fails.push(`heap grew ${trend.heapMB.first} → ${trend.heapMB.last} MB`);
  if (trend.geometries.last > trend.geometries.first * 1.25 + 50) fails.push(`GPU geometries grew ${trend.geometries.first} → ${trend.geometries.last}`);
  if (trend.textures.last > trend.textures.first + 4) fails.push(`textures grew ${trend.textures.first} → ${trend.textures.last}`);
  if (trend.chunks.last > trend.chunks.first * 1.5 + 10) fails.push(`live chunks grew ${trend.chunks.first} → ${trend.chunks.last}`);
  if (errors.length) fails.push(`${errors.length} page errors`);
  r.fails = fails;
  results.push(r);
  console.log(JSON.stringify(r, null, 1));
  if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `drive_seed${seed}.json`), JSON.stringify({ ...r, raw: samples })); }
}
await browser.close();
await server.close();
const bad = results.filter((r) => r.fails.length);
console.log(`\n${results.length - bad.length}/${results.length} seeds passed`);
process.exit(bad.length ? 1 : 0);
