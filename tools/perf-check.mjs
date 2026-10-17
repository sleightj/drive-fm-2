#!/usr/bin/env node
/**
 * Performance check on the benchmark route: the real game, headless, on autopilot, with every
 * frame advancing exactly 1/60 s of game time (so world streaming does the same work per metre
 * as at 60 fps, however slowly SwiftShader draws).
 *   node tools/perf-check.mjs [--gfx high] [--seed 7] [--seconds 60] [--size 960x540] [--out dir] [--url ...]
 * Reports, per frame: JS frame time (sim + world + terrain + render submission), world-build time,
 * draw calls and triangles, plus the cost of each kind of world-building job. Fails when a budget
 * from docs/DESIGN.md §6 is broken:
 *   - no frame over 20 ms of JS time while the world is building
 *   - JS frame time p95 (without the render submission, which blocks on SwiftShader) within the
 *     level's budget (HIGH 7 ms, LOW 6 ms, VERY LOW 5 ms)
 *   - draw calls and triangles within the level's budget at every frame
 * GPU time can't be measured under SwiftShader; calls and triangles stand in for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const gfx = opt('gfx', 'high');
const seed = opt('seed', '7');
const seconds = Number(opt('seconds', '60'));
const [W, H] = opt('size', '960x540').split('x').map(Number);
const outDir = opt('out', '');
const BUDGET = {
  high: { js: 7, calls: 650, tris: 1.2e6 },
  low: { js: 6, calls: 420, tris: 700e3 },
  verylow: { js: 5, calls: 260, tris: 320e3 },
}[gfx];
const SPIKE = 20;

let server = null, base = opt('url', '');
if (!base) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.error('[page]', m.text()); } });
page.on('pageerror', (e) => { errors.push(String(e)); console.error('[pageerror]', e); });
const params = new URLSearchParams({ seed, gfx, time: 'day', auto: '1', fixed: '1', freeze: '1' });
await page.goto(`${base}?${params}`);
await page.waitForFunction(() => window.__DRIVE_FM__ && (window.__DRIVE_FM__.state === 'driving' || window.__DRIVE_FM_ERROR__), null, { timeout: 120000 });
const load = await page.evaluate(() => window.__DRIVE_FM__.info().load);
await page.evaluate(() => window.__DRIVE_FM__.record(true));

const frames = [];
const t0 = Date.now();
let simT = 0;
while (simT < seconds) {
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => ({ f: window.__DRIVE_FM__.takeFrames(), t: window.__DRIVE_FM__.game.simTime }));
  for (let i = 0; i < r.f.length; i += 8) frames.push(r.f.slice(i, i + 8));
  simT = r.t;
}
const timing = await page.evaluate(() => window.__DRIVE_FM__.timing());
const info = await page.evaluate(() => window.__DRIVE_FM__.info());
await browser.close();
if (server) await server.close();

const col = (i) => frames.map((f) => f[i]).sort((a, b) => a - b);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const stat = (i) => { const a = col(i); return { p50: +pct(a, 0.5).toFixed(2), p95: +pct(a, 0.95).toFixed(2), p99: +pct(a, 0.99).toFixed(2), max: +a[a.length - 1].toFixed(2) }; };
// JS time excluding the render submission is what we control on the CPU; frame = everything in tick
const report = {
  gfx, seed, size: `${W}x${H}`, frames: frames.length, simSeconds: +simT.toFixed(1), wallSeconds: Math.round((Date.now() - t0) / 1000),
  km: +(info.car.odometer / 1000).toFixed(2), load,
  frameMs: stat(0), simMs: stat(1), worldMs: stat(2), terrainMs: stat(3), renderSubmitMs: stat(4), calls: stat(5), triangles: stat(6),
  spikes: frames.filter((f) => f[0] > SPIKE).map((f) => ({ frame: +f[0].toFixed(1), world: +f[2].toFixed(1), terrain: +f[3].toFixed(1), render: +f[4].toFixed(1), sim: +f[1].toFixed(1), odo: Math.round(f[7]) })).slice(0, 30),
  jobs: Object.fromEntries(Object.entries(timing.chunks ?? {}).map(([k, v]) => [k, { n: v.n, avg: +(v.ms / v.n).toFixed(2), max: +v.max.toFixed(2) }])),
  chunkStats: timing.stats,
  errors,
};
const fails = [];
const worldFrames = frames.filter((f) => f[2] > 0.5);
const worldSpikes = worldFrames.filter((f) => f[0] - f[4] > SPIKE).length;
if (worldSpikes) fails.push(`${worldSpikes} world-building frames over ${SPIKE} ms of JS time`);
// Under SwiftShader the render call can block on the software GPU, so the JS budget counts
// everything in the frame except the render submission (reported on its own above).
const js95 = pct(frames.map((f) => f[0] - f[4]).sort((a, b) => a - b), 0.95);
report.jsMsP95 = +js95.toFixed(2);
if (js95 > BUDGET.js) fails.push(`JS frame p95 ${js95.toFixed(1)} ms > ${BUDGET.js} ms`);
if (report.calls.max > BUDGET.calls) fails.push(`draw calls ${report.calls.max} > ${BUDGET.calls}`);
if (report.triangles.max > BUDGET.tris) fails.push(`triangles ${report.triangles.max} > ${BUDGET.tris}`);
if (errors.length) fails.push(`${errors.length} page errors`);
report.fails = fails;
console.log(JSON.stringify(report, null, 1));
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `perf_${gfx}_seed${seed}.json`), JSON.stringify({ ...report, raw: frames }, null, 0)); }
process.exit(fails.length ? 1 : 0);
