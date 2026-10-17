#!/usr/bin/env node
/**
 * Screenshots every front-end state through the UI preview (tools/ui-preview) in headless Chromium.
 * Usage: node tools/shoot-ui.mjs [out dir = docs/renders/ui] [--sizes desktop,portrait,landscape] [--only name,name] [--dpr 1] [--png]
 * Writes <out>/<size>/<state>.jpg (q90; --png for lossless) plus a contact sheet per size (<out>/sheet_<size>.jpg),
 * prints layout issues (offscreen, overflow, touch targets < 44 px) and runs input behaviour checks.
 * Sizes: desktop 1920x1080, portrait phone 390x844, landscape phone 844x390 (phones emulate touch).
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
const outDir = path.resolve(root, args[0] && !args[0].startsWith('--') ? args[0] : 'docs/renders/ui');
const dpr = Number(opt('dpr', '1'));
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const ext = args.includes('--png') ? 'png' : 'jpg';
const shotOpts = ext === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 90 };

const SIZES = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true },
};
const sizes = opt('sizes', 'desktop,portrait,landscape').split(',');
const PHONE = ['portrait', 'landscape'];
const ALL = ['desktop', ...PHONE];

// [name, url params, sizes it applies to, extra]
const STATES = [
  ['boot-05', { state: 'boot', p: 0.05, label: 'road' }, ALL],
  ['boot-45', { state: 'boot', p: 0.45, label: 'city' }, ALL],
  ['boot-90', { state: 'boot', p: 0.9, label: 'cars' }, ALL],
  ['title-day', { state: 'title', scene: 'day' }, ALL],
  ['title-dusk', { state: 'title', scene: 'dusk' }, ['desktop']],
  ['title-night', { state: 'title', scene: 'night' }, ALL],
  ['title-reduced-motion', { state: 'title', scene: 'day' }, ['desktop'], { reducedMotion: 'reduce' }],
  ['pause-day', { state: 'pause', scene: 'day', gfx: 'high' }, ['desktop']],
  ['pause-graphics-night', { state: 'pause', scene: 'night', sel: 1, gfx: 'low' }, ['desktop']],
  ['pause-gamepad-dusk', { state: 'pause', scene: 'dusk', sel: 2, mode: 'pad', gfx: 'verylow' }, ['desktop']],
  ['pause-touch-day', { state: 'pause', scene: 'day', touch: 1, gfx: 'high' }, PHONE],
  ['pause-graphics-touch-night', { state: 'pause', scene: 'night', touch: 1, sel: 1, gfx: 'verylow' }, PHONE],
  ['controls', { state: 'controls', scene: 'day' }, ['desktop']],
  ['controls-keyboard', { state: 'controls', scene: 'day', tab: 0 }, PHONE],
  ['controls-gamepad', { state: 'controls', scene: 'night', tab: 1, mode: 'pad' }, PHONE],
  ['controls-touch', { state: 'controls', scene: 'dusk', tab: 2, touch: 1 }, PHONE],
  ['drive-boost-day', { state: 'drive', scene: 'day', boost: 0.55 }, ALL],
  ['drive-boosting-night', { state: 'drive', scene: 'night', boost: 0.8, boosting: 1 }, ALL],
  ['drive-full-dusk', { state: 'drive', scene: 'dusk', boost: 1 }, ['desktop']],
  ['touch-day', { state: 'touch', scene: 'day', boost: 0.35 }, PHONE],
  ['touch-active-night', { state: 'touch', scene: 'night', boost: 0.7, active: 1 }, PHONE],
];

fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const report = {};
let failures = 0;
for (const size of sizes) {
  const ctxOpts = SIZES[size];
  if (!ctxOpts) { console.error('unknown size', size); continue; }
  const dir = path.join(outDir, size);
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const [name, params, applies, extra = {}] of STATES) {
    if (!applies.includes(size) || (only && !only.has(name))) continue;
    const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: extra.reducedMotion || 'no-preference' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[${size}/${name}]`, m.text()); });
    page.on('pageerror', (e) => { failures++; console.error(`[${size}/${name}] pageerror`, e); });
    const q = new URLSearchParams({ shot: '1', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    await page.goto(`http://127.0.0.1:${port}/tools/ui-preview/index.html?${q}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    // layout sanity: anything of ours poking outside the viewport, or text overflowing its box
    const issues = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth, vh = innerHeight;
      for (const el of document.querySelectorAll('.dfm *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.is-gone') || el.closest('svg') || el.closest('.dfm-boost')) continue;
        let hidden = false;
        for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).opacity === '0') { hidden = true; break; }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cls = typeof el.className === 'string' ? el.className : '';
        if (/dfm-boost|dfm-steer|dfm-tuner-needle/.test(cls)) continue;
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`offscreen ${cls} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' && el.clientWidth > 0) out.push(`overflow-x ${cls}`);
      }
      // touch targets
      for (const el of document.querySelectorAll('.dfm button, .dfm [data-ctl], .dfm .dfm-item')) {
        if (el.closest('.is-gone') || getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.width < 44 || r.height < 44) && !el.classList.contains('dfm-arrow')) out.push(`small-target ${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    const touch = await page.evaluate(() => (window.__touch ? window.__touch() : null));
    const file = path.join(dir, `${name}.${ext}`);
    await page.screenshot({ path: file, animations: 'disabled', ...shotOpts });
    shots.push({ name, file });
    report[`${size}/${name}`] = { issues, ...(params.active ? { touch } : {}) };
    if (issues.length) console.error(`[${size}/${name}]`, issues.join(' | '));
    await ctx.close();
  }
  if (shots.length) {
    const imgs = await Promise.all(shots.map((s) => loadImage(fs.readFileSync(s.file))));
    const cols = size === 'portrait' ? 6 : 3;
    const scale = size === 'portrait' ? 0.42 : size === 'landscape' ? 0.48 : 0.3;
    const w = Math.round(imgs[0].width * scale), h = Math.round(imgs[0].height * scale);
    const rows = Math.ceil(imgs.length / cols);
    const c = createCanvas(cols * w + (cols + 1) * 6, rows * (h + 22) + 6);
    const g = c.getContext('2d');
    g.fillStyle = '#16151f'; g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => {
      const x = 6 + (i % cols) * (w + 6), y = 6 + Math.floor(i / cols) * (h + 22);
      g.drawImage(im, x, y, w, h);
      g.fillStyle = '#ddd'; g.font = '13px sans-serif'; g.fillText(shots[i].name, x + 2, y + h + 15);
    });
    fs.writeFileSync(path.join(outDir, `sheet_${size}.${ext}`), ext === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 88));
  }
}
// behaviour checks through the real input paths (keyboard, pointer), desktop size
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures++; console.error('[behaviour] pageerror', e); });
  const checks = [];
  const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); if (!ok) failures++; };
  await page.goto(`http://127.0.0.1:${port}/tools/ui-preview/index.html?shot=1&state=title&gfx=high`);
  await page.waitForFunction(() => window.__ready === true);
  const fe = (expr) => page.evaluate(`(() => { const fe = window.__ui.fe; return ${expr}; })()`);
  check('title is up', await fe("document.querySelector('.dfm-title').classList.contains('is-on')"));
  await page.keyboard.press('Shift');
  check('modifier-only key still starts (Shift = boost)', !(await fe("document.querySelector('.dfm-title').classList.contains('is-on')")));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc while driving opens pause (preview game logic)', await fe('fe.paused'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  check('graphics cycles with arrows', (await fe('fe.graphics')) === 'low', await fe('fe.graphics'));
  check('graphics persisted', (await page.evaluate(() => localStorage.getItem('drivefm.graphics'))) === 'low');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  check('graphics wraps HIGH -> VERY LOW', (await fe('fe.graphics')) === 'verylow', await fe('fe.graphics'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('CONTROLS opens the card', await fe("document.querySelector('.dfm-ctl').classList.contains('is-on')"));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc closes the card, stays paused', !(await fe("document.querySelector('.dfm-ctl').classList.contains('is-on')")) && (await fe('fe.paused')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc resumes', !(await fe('fe.paused')));
  await page.mouse.click(5, 5);
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  const r = await page.locator('.dfm-item[data-i="0"]').boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await page.waitForTimeout(100);
  check('mouse click RESUME resumes', !(await fe('fe.paused')));
  check('focus never lands on our buttons', await page.evaluate(() => !document.activeElement || !document.activeElement.closest('.dfm')));
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await fe("fe.menu('down')");
  await fe("fe.menu('confirm')");
  check('gamepad confirm on GRAPHICS cycles', (await fe('fe.graphics')) === 'high', await fe('fe.graphics'));
  await fe("fe.menu('back')");
  check('gamepad back resumes', !(await fe('fe.paused')));
  const t0 = Date.now();
  await page.evaluate(() => { const fe = window.__ui.fe; for (let i = 0; i < 100000; i++) fe.setBoost((i % 1000) / 1000, (i & 64) === 0); });
  check('setBoost x100k', true, `${Date.now() - t0} ms`);
  await ctx.close();
  report.behaviour = checks;
  for (const c of checks) console.error(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ' (' + c.detail + ')' : ''}`);
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
