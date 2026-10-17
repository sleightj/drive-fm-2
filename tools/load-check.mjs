#!/usr/bin/env node
/**
 * Load time on the production build, by phase:
 *   node tools/load-check.mjs [--runs 3] [--gfx high] [--size 1280x720] [--no-build] [--url https://...]
 * Builds (vite build), serves dist/ with vite preview (or loads --url, e.g. the live site), and
 * loads the game in fresh browser contexts (cold cache). Reports, per run, the time from
 * navigation to each loading phase and to the title screen (ready to drive), and the median.
 * Target (docs/DESIGN.md): under ~4 s to the title. Under SwiftShader on a shared machine the
 * numbers are pessimistic (the first frame's shader compile runs in software).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const runs = Number(opt('runs', '3'));
const [W, H] = opt('size', '1280x720').split('x').map(Number);
let base = opt('url', ''), server = null;
if (!base) {
  if (!args.includes('--no-build')) await build({ root, logLevel: 'warn' });
  server = await preview({ root, logLevel: 'warn', preview: { port: 0, host: '127.0.0.1' } });
  base = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?gfx=${opt('gfx', 'high')}&seed=${11 + i}`);
  await page.waitForFunction(() => window.__DRIVE_FM__?.state === 'title' || window.__DRIVE_FM_ERROR__, null, { timeout: 120000 });
  const r = await page.evaluate(() => ({ phases: window.__DRIVE_FM_PHASES__, load: window.__DRIVE_FM_LOAD__, nav: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd }));
  const title = r.phases.find((p) => p.label === 'title')?.t ?? NaN;
  out.push({ run: i + 1, titleMs: Math.round(title), gameLoadMs: Math.round(r.load?.ms ?? NaN), domReadyMs: Math.round(r.nav ?? NaN), phases: r.phases.map((p) => `${p.label} ${Math.round(p.t)}`).join(' · '), errors });
  await ctx.close();
}
await browser.close();
if (server) await new Promise((res) => server.httpServer.close(res));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const report = { base, runs: out, medianTitleMs: med(out.map((o) => o.titleMs)), medianGameLoadMs: med(out.map((o) => o.gameLoadMs)) };
console.log(JSON.stringify(report, null, 1));
process.exit(out.some((o) => o.errors.length) ? 1 : 0);
