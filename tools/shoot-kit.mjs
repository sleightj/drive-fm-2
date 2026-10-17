#!/usr/bin/env node
/**
 * Renders city-kit pieces with the real world shader.
 * Usage: node tools/shoot-kit.mjs <out dir> [--group downtown] [--items a,b] [--times day,night] [--views front,three,street,wide] [--size 900x560] [--seed 1]
 * Writes one PNG per shot + contact sheets per time, prints info JSON (triangle counts).
 * Repaint textures first if painters changed: node assets-src/textures/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0];
if (!outDir || outDir.startsWith('--')) { console.error('usage: shoot-kit.mjs <outdir> [--group g] [--items a,b] [--times ..] [--views ..]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e));
const params = new URLSearchParams({ times: opt('times', 'day,night'), views: opt('views', 'front,three'), size: opt('size', '900x560'), seed: opt('seed', '1') });
for (const k of ['group', 'items']) if (opt(k)) params.set(k, opt(k));
await page.goto(`http://127.0.0.1:${port}/tools/kit-preview/index.html?${params}`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 900000 });
const err = await page.evaluate(() => window.__error);
if (err) console.error(err);
const shots = await page.evaluate(() => window.__shots);
const info = await page.evaluate(() => window.__info);
for (const s of shots) fs.writeFileSync(path.join(outDir, s.name + '.png'), Buffer.from(s.data.split(',')[1], 'base64'));
const byTime = {};
for (const s of shots) { const t = s.name.split('_')[0]; (byTime[t] ||= []).push(s); }
for (const [t, list] of Object.entries(byTime)) {
  const imgs = await Promise.all(list.map((s) => loadImage(Buffer.from(s.data.split(',')[1], 'base64'))));
  const cols = Math.min(4, imgs.length), rows = Math.ceil(imgs.length / cols);
  const w = Math.round(imgs[0].width / 2), h = Math.round(imgs[0].height / 2);
  const c = createCanvas(cols * w, rows * h); const g = c.getContext('2d');
  imgs.forEach((im, i) => { g.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h, w, h); g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.fillText(list[i].name, (i % cols) * w + 5, Math.floor(i / cols) * h + 15); });
  fs.writeFileSync(path.join(outDir, `sheet_${t}.png`), c.toBuffer('image/png'));
}
console.log(JSON.stringify({ info, shots: shots.map((s) => s.name) }, null, 1));
await browser.close();
await server.close();
