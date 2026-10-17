#!/usr/bin/env node
/**
 * Front-end check, headless, driven by real key presses:
 *   node tools/check-frontend.mjs [out dir] [--seed 3] [--size 1280x720] [--url ...]
 * boot card → title (shot) → Enter starts driving → Escape pauses (shot) → menu down to
 * GRAPHICS, right twice (HIGH → LOW → VERY LOW, applied live) → shot of the game at VERY LOW →
 * back up to HIGH → Escape resumes. Fails on page errors, a missed state, a level that does not
 * apply, or a level that is not remembered after a reload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0] && !args[0].startsWith('--') ? args[0] : '';
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const [W, H] = opt('size', '1280x720').split('x').map(Number);
let server = null, base = opt('url', '');
if (!base) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const fails = [];
const shot = async (name) => { if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png') }); };
const state = () => page.evaluate(() => window.__DRIVE_FM__?.state);
const waitState = async (s, what) => {
  try { await page.waitForFunction((x) => window.__DRIVE_FM__?.state === x, s, { timeout: 20000, polling: 100 }); }
  catch { fails.push(`${what}: state stayed ${await state()} (wanted ${s})`); }
};
const gfx = () => page.evaluate(() => window.__DRIVE_FM__.info().level);
const key = async (k, wait = 350) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };

const url = `${base}?seed=${opt('seed', '3')}&time=day`;
await page.goto(url);
// the boot card is up while loading
await page.waitForSelector('.dfm-boot', { timeout: 10000 }).catch(() => fails.push('no boot card'));
await shot('fe_0_boot');
await page.waitForFunction(() => window.__DRIVE_FM__ && (window.__DRIVE_FM__.state === 'title' || window.__DRIVE_FM_ERROR__), null, { timeout: 120000 });
await page.waitForTimeout(1500);
await shot('fe_1_title');
const lvl0 = await gfx();
await key('Enter', 800);
await waitState('driving', 'Enter on title');
await page.waitForTimeout(2500);
await key('Escape', 600);
await waitState('paused', 'Escape while driving');
await shot('fe_2_pause');
// to GRAPHICS, then right: one step lower each press
await key('ArrowDown');
await key('ArrowRight', 1500);
const l1 = await gfx();
await key('ArrowRight', 4000);
const l2 = await gfx();
if (l1 !== 'low' || l2 !== 'verylow') fails.push(`graphics via menu: ${lvl0} → ${l1} → ${l2} (wanted high → low → verylow)`);
await shot('fe_3_pause_verylow');
await key('Escape', 3000);
await waitState('driving', 'Escape in pause menu');
await shot('fe_4_driving_verylow');
const info = await page.evaluate(() => window.__DRIVE_FM__.info());
const stored = await page.evaluate(() => localStorage.getItem('drivefm.graphics'));
if (stored !== 'verylow') fails.push(`graphics level not stored (got ${stored})`);
// reload: the level is remembered
await page.reload();
await page.waitForFunction(() => window.__DRIVE_FM__ && window.__DRIVE_FM__.state === 'title', null, { timeout: 120000 });
const after = await gfx();
if (after !== 'verylow') fails.push(`graphics level after reload: ${after}`);
// back to HIGH through the menu for the next run
await key('Enter', 800);
await key('Escape', 600);
await key('ArrowDown');
await key('ArrowLeft', 1500);
await key('ArrowLeft', 4000);
const back = await gfx();
if (back !== 'high') fails.push(`graphics back to high: ${back}`);
await key('Escape', 1500);
await shot('fe_5_driving_high');
if (errors.length) fails.push(`${errors.length} page errors: ${errors.slice(0, 3).join(' | ')}`);
console.log(JSON.stringify({ levels: [lvl0, l1, l2, after, back], calls: info.calls, tris: info.triangles, fails }, null, 1));
await browser.close();
if (server) await server.close();
process.exit(fails.length ? 1 : 0);
