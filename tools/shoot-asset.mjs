#!/usr/bin/env node
/**
 * Renders an actor asset with the game's own cel shader + ink at chosen hours.
 *
 * Usage:
 *   node tools/shoot-asset.mjs <glb path under public/, e.g. public/assets/cars/hero.glb> <out dir>
 *        [--times day,night,dawn,dusk,evening,twilight|<hour>] [--views turntable8,chase,side,front,top,title,close]
 *        [--size 800x500] [--kind vehicle|person] [--anim walk --frames 8] [--variant name] [--paint #ff3355] [--brake 1]
 * Writes one PNG per shot plus a contact sheet `<out>/sheet_<times>.png`, and prints the
 * asset info (triangles, size, wheel radius...) as JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [glb, outDir] = pos;
if (!glb || !outDir) { console.error('usage: shoot-asset.mjs <public/...glb> <outdir> [--times ..] [--views ..]'); process.exit(2); }
const url = '/' + path.relative(path.join(root, 'public'), path.resolve(glb)).split(path.sep).join('/');
fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e));
const params = new URLSearchParams({ file: url, times: opt('times', 'day,night'), views: opt('views', 'turntable8,chase,side'), size: opt('size', '800x500') });
for (const k of ['kind', 'anim', 'frames', 'variant', 'paint', 'brake', 'detail']) if (opt(k)) params.set(k, opt(k));
await page.goto(`http://127.0.0.1:${port}/tools/preview/index.html?${params}`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
const err = await page.evaluate(() => window.__error);
if (err) { console.error(err); }
const shots = await page.evaluate(() => window.__shots);
const info = await page.evaluate(() => window.__info);
for (const s of shots) fs.writeFileSync(path.join(outDir, s.name + '.png'), Buffer.from(s.data.split(',')[1], 'base64'));
// contact sheet per time
const byTime = {};
for (const s of shots) { const t = s.name.split('_')[0]; (byTime[t] ||= []).push(s); }
for (const [t, list] of Object.entries(byTime)) {
  const imgs = await Promise.all(list.map((s) => loadImage(Buffer.from(s.data.split(',')[1], 'base64'))));
  const cols = Math.min(4, imgs.length), rows = Math.ceil(imgs.length / cols);
  const w = imgs[0].width / 2, h = imgs[0].height / 2;
  const c = createCanvas(cols * w, rows * h + 0); const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => { g.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h, w, h); g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.fillText(list[i].name, (i % cols) * w + 6, Math.floor(i / cols) * h + 16); });
  fs.writeFileSync(path.join(outDir, `sheet_${t}.png`), c.toBuffer('image/png'));
}
console.log(JSON.stringify({ info, shots: shots.map((s) => s.name) }, null, 1));
await browser.close();
await server.close();
