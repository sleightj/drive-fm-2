#!/usr/bin/env node
/**
 * Mood/time contact sheets (docs/DESIGN.md §8 "look"): the real game, headless, on autopilot.
 * For each mood the game starts in that mood's district (?mood=), drives a few seconds, then
 * holds the frame (simulation paused, camera and lights live) and shoots it at dawn, day, dusk,
 * evening, twilight and night. Same frame at every hour, so the sheet compares the light.
 *
 *   node tools/shoot-moods.mjs [out dir = docs/renders/moods] [--seed 1] [--moods all|downtown,docks]
 *        [--times dawn,day,dusk,evening,twilight,night] [--drive 8] [--size 1280x720]
 *        [--levels downtown,docks | --levels none] [--keep] [--url http://...]
 *
 * Writes (JPEG q85):
 *   <out>/<mood>.jpg            3×2 sheet, one cell per hour (HIGH)
 *   <out>/overview.jpg          every mood (rows) × every hour (columns)
 *   <out>/levels_<mood>.jpg     HIGH / LOW / VERY LOW (rows) × day / night, for the --levels moods
 *   <out>/frames/…              full-size frames, only with --keep
 * Prints a table of mean colours per mood and hour, and how far apart the moods sit (ΔE in
 * Lab, mean over the frame) so two moods that read alike show up as a small distance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const outDir = path.resolve(root, args[0] && !args[0].startsWith('--') ? args[0] : 'docs/renders/moods');
const ALL_MOODS = ['downtown', 'oldtown', 'midtown', 'docks', 'suburbs', 'edge'];
const moods = opt('moods', 'all') === 'all' ? ALL_MOODS : opt('moods').split(',');
const times = opt('times', 'dawn,day,dusk,evening,twilight,night').split(',');
const levelMoods = opt('levels', 'downtown,docks') === 'none' ? [] : opt('levels', 'downtown,docks').split(',');
const seed = opt('seed', '1');
const drive = Number(opt('drive', '8'));
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const keep = flag('keep');
fs.mkdirSync(outDir, { recursive: true });
if (keep) fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });

const fontPath = path.join(root, 'assets-src/fonts/NotoSans-700.ttf');
if (fs.existsSync(fontPath)) GlobalFonts.registerFromPath(fontPath, 'SheetSans');
const FONT = fs.existsSync(fontPath) ? 'SheetSans' : 'sans-serif';

let server = null, base = opt('url', '');
if (!base) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

/** Boot the game in a mood at a level, drive, hold the frame; returns the page. */
async function boot(mood, gfx) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(`${mood}/${gfx}: ${m.text()}`); console.error('[page]', m.text()); } });
  page.on('pageerror', (e) => { errors.push(`${mood}/${gfx}: ${e}`); console.error('[pageerror]', e); });
  const params = new URLSearchParams({ seed, gfx, time: 'day', auto: '1', freeze: '1', mood });
  await page.goto(`${base}?${params}`);
  await page.waitForFunction(() => window.__DRIVE_FM__ && (window.__DRIVE_FM__.state === 'driving' || window.__DRIVE_FM_ERROR__), null, { timeout: 180000 });
  const bootErr = await page.evaluate(() => window.__DRIVE_FM_ERROR__);
  if (bootErr) throw new Error(bootErr);
  await page.waitForFunction((s) => window.__DRIVE_FM__.game.simTime >= s, drive, { timeout: 600000, polling: 200 });
  // hold: no more simulation steps; the camera, lights and streaming keep running
  await page.evaluate(() => { window.__DRIVE_FM__.game.opt.simRate = 0; });
  await frames(page, 6);
  return page;
}
async function frames(page, n) {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
async function shoot(page, time) {
  await page.evaluate((t) => window.__DRIVE_FM__.setHour(t), time);
  await frames(page, 6);
  const buf = await page.screenshot({ type: 'png' });
  const info = await page.evaluate(() => { const i = window.__DRIVE_FM__.info(); return { hour: i.hour, kmh: i.car.kmh, calls: i.calls, odo: i.car.odometer }; });
  return { buf, info };
}

// ---- colour statistics (mean Lab of the frame) for the distinctness table
function srgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
async function stats(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(64, 36);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data;
  // three bands: sky/upper (top third), middle, road (bottom third) — fog and haze live in the upper two
  const bands = [[0, 12], [12, 24], [24, 36]].map(([y0, y1]) => {
    let L = 0, A = 0, Bb = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const [l, a, b] = srgbToLab(d[i], d[i + 1], d[i + 2]);
      L += l; A += a; Bb += b; n++;
    }
    return [L / n, A / n, Bb / n];
  });
  return bands;
}
const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// ---- sheet drawing
function label(g, x, y, text, size, color = '#fff') {
  g.font = `${size}px ${FONT}`;
  g.lineWidth = Math.max(2, size / 6);
  g.strokeStyle = 'rgba(8,6,20,0.85)';
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}
async function sheet(file, title, rows, cols, cells, cw, ch, opts = {}) {
  const head = opts.head ?? 44, rowLab = opts.rowLabels ? 150 : 0, gap = 4;
  const Wd = rowLab + cols * cw + (cols + 1) * gap, Hd = head + rows * ch + (rows + 1) * gap;
  const c = createCanvas(Wd, Hd);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b1a';
  g.fillRect(0, 0, Wd, Hd);
  label(g, 12, 31, title, 24);
  for (const cell of cells) {
    const x = rowLab + gap + cell.col * (cw + gap), y = head + gap + cell.row * (ch + gap);
    g.drawImage(await loadImage(cell.buf), x, y, cw, ch);
    if (cell.label) label(g, x + 8, y + Math.round(ch * 0.1) + 6, cell.label, Math.max(13, Math.round(ch * 0.075)));
  }
  if (opts.rowLabels) opts.rowLabels.forEach((t, r) => label(g, 10, head + gap + r * (ch + gap) + ch / 2 + 8, t, 20));
  fs.writeFileSync(file, c.toBuffer('image/jpeg', 85));
  console.log('wrote', path.relative(root, file), `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---- HIGH: every mood at every hour
const shots = {}; // mood → time → {buf, info, lab}
const t0 = Date.now();
for (const mood of moods) {
  const page = await boot(mood, 'high');
  shots[mood] = {};
  for (const t of times) {
    const s = await shoot(page, t);
    s.lab = await stats(s.buf);
    shots[mood][t] = s;
    if (keep) fs.writeFileSync(path.join(outDir, 'frames', `${mood}_${t}.jpg`), (await (async () => { const im = await loadImage(s.buf); const c = createCanvas(W, H); c.getContext('2d').drawImage(im, 0, 0); return c.toBuffer('image/jpeg', 88); })()));
    console.log(mood, t, JSON.stringify({ hour: s.info.hour.toFixed(2), kmh: s.info.kmh.toFixed(0), calls: s.info.calls, odo: s.info.odo.toFixed(0) }));
  }
  await page.close();
  const cells = times.map((t, i) => ({ row: Math.floor(i / 3), col: i % 3, buf: shots[mood][t].buf, label: `${t}  ${hh(shots[mood][t].info.hour)}` }));
  await sheet(path.join(outDir, `${mood}.jpg`), `DRIVE FM — ${mood.toUpperCase()} — seed ${seed}, HIGH, ${W}×${H}`, Math.ceil(times.length / 3), 3, cells, 480, 270);
}
if (moods.length > 1) {
  const cells = [];
  moods.forEach((m, r) => times.forEach((t, c) => cells.push({ row: r, col: c, buf: shots[m][t].buf, label: r === 0 ? t : null })));
  await sheet(path.join(outDir, 'overview.jpg'), `DRIVE FM — six moods × six hours — seed ${seed}, HIGH`, moods.length, times.length, cells, 256, 144, { rowLabels: moods });
}

// ---- LOW / VERY LOW next to HIGH, day and night
for (const mood of levelMoods) {
  const cells = [];
  const levels = ['high', 'low', 'verylow'];
  for (let r = 0; r < levels.length; r++) {
    const page = await boot(mood, levels[r]);
    for (const [c, t] of ['day', 'night'].entries()) {
      const s = await shoot(page, t);
      cells.push({ row: r, col: c, buf: s.buf, label: `${t}` });
      console.log(mood, levels[r], t, JSON.stringify({ calls: s.info.calls }));
    }
    await page.close();
  }
  await sheet(path.join(outDir, `levels_${mood}.jpg`), `DRIVE FM — ${mood.toUpperCase()} — HIGH / LOW / VERY LOW — seed ${seed}`, 3, 2, cells, 480, 270, { rowLabels: ['HIGH', 'LOW', 'VERY LOW'] });
}

// ---- how distinct the moods are, per hour (mean ΔE between the upper two bands of the frame)
if (moods.length > 1) {
  console.log('\nmood distinctness: nearest other mood by ΔE (sky+haze bands, mean Lab) per hour');
  for (const t of times) {
    const row = moods.map((m) => {
      let best = Infinity, who = '';
      for (const o of moods) {
        if (o === m) continue;
        const a = shots[m][t].lab, b = shots[o][t].lab;
        const d = (dE(a[0], b[0]) + dE(a[1], b[1])) / 2;
        if (d < best) { best = d; who = o; }
      }
      return `${m}→${who} ${best.toFixed(1)}`;
    });
    console.log(t.padEnd(9), row.join('  '));
  }
  console.log('\nmean Lab (sky band / middle band / road band)');
  for (const m of moods) for (const t of times) console.log(m.padEnd(9), t.padEnd(9), shots[m][t].lab.map((v) => v.map((x) => x.toFixed(0)).join(',')).join('  '));
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s, ${errors.length} page errors`);
await browser.close();
if (server) await server.close();
process.exit(errors.length ? 1 : 0);
