#!/usr/bin/env node
/**
 * Runs the real game headless and takes screenshots.
 *   node tools/shoot-game.mjs <out dir> [--seed 1] [--time day] [--gfx high] [--size 1280x720] [--mood docks]
 *        [--drive 20] [--shots 4] [--every 5] [--rate 1] [--title] [--url http://...]
 * --drive N   drive N seconds of game time on autopilot before the first shot
 * --shots/--every  further shots every K seconds of game time
 * --title     also shoot the title screen first
 * Prints the game's info() after each shot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const outDir = args[0];
if (!outDir || outDir.startsWith('--')) { console.error('usage: shoot-game.mjs <outdir> [options]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const [W, H] = opt('size', '1280x720').split('x').map(Number);
let server = null, base = opt('url', '');
if (!base) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.text()); console.error('[page]', m.text()); } });
page.on('pageerror', (e) => { errors.push(String(e)); console.error('[pageerror]', e); });
const params = new URLSearchParams({ seed: opt('seed', '1'), time: opt('time', 'day'), gfx: opt('gfx', 'high'), rate: opt('rate', '1') });
if (!flag('title')) params.set('auto', '1');
if (opt('mood', '')) params.set('mood', opt('mood', ''));
if (flag('freeze')) params.set('freeze', '1');
const t0 = Date.now();
await page.goto(`${base}?${params}`);
await page.waitForFunction(() => window.__DRIVE_FM__ && (window.__DRIVE_FM__.state === 'title' || window.__DRIVE_FM__.state === 'driving' || window.__DRIVE_FM_ERROR__), null, { timeout: 120000 });
const bootErr = await page.evaluate(() => window.__DRIVE_FM_ERROR__);
if (bootErr) { console.error(bootErr); process.exit(1); }
console.log('load ms', Date.now() - t0, await page.evaluate(() => window.__DRIVE_FM_LOAD__));
const info = async () => page.evaluate(() => window.__DRIVE_FM__.info());
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name + '.png') });
  const i = await info();
  console.log(name, JSON.stringify({ kmh: i.car.kmh.toFixed(0), onRoad: i.car.onRoad, odo: i.car.odometer.toFixed(0), calls: i.calls, tris: i.triangles, chunks: i.chunks, frameMs: i.metrics.frameMs.toFixed(1), worldMs: i.metrics.worldMs.toFixed(1), hour: i.hour.toFixed(2) }));
};
const waitGame = async (sec) => {
  const start = await page.evaluate(() => window.__DRIVE_FM__.game.simTime);
  await page.waitForFunction((s) => window.__DRIVE_FM__.game.simTime >= s, start + sec, { timeout: 600000, polling: 200 });
};
if (flag('title')) {
  await page.waitForTimeout(1500);
  await shot('title');
  await page.evaluate(() => { window.__DRIVE_FM__.game.opt.autopilot = true; window.__DRIVE_FM__.start(); });
}
const drive = Number(opt('drive', '3'));
if (drive > 0) await waitGame(drive);
const n = Number(opt('shots', '1')), every = Number(opt('every', '5'));
for (let k = 0; k < n; k++) {
  await shot(`shot_${String(k).padStart(2, '0')}`);
  if (k < n - 1) await waitGame(every);
}
fs.writeFileSync(path.join(outDir, 'errors.json'), JSON.stringify(errors, null, 1));
await browser.close();
if (server) await server.close();
process.exit(errors.length ? 1 : 0);
