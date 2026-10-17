/**
 * CPU-profiles the game while it drives itself (fixed 1/60 s steps) and prints the functions
 * with the most self time and total time.
 *   node tools/profile-game.mjs [game seconds = 15] [seed = 7]
 */
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secs = Number(process.argv[2] || 15);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', watch: null, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.error('[pageerror]', e));
await page.goto(`${base}?seed=${process.argv[3]||7}&gfx=high&time=day&auto=1&fixed=1&freeze=1`);
await page.waitForFunction(() => window.__DRIVE_FM__ && window.__DRIVE_FM__.state === 'driving', null, { timeout: 120000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.waitForFunction((s) => window.__DRIVE_FM__.game.simTime >= s, secs, { timeout: 900000, polling: 500 });
const { profile } = await cdp.send('Profiler.stop');
await browser.close(); await server.close();
const self = new Map(), total = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url.split('?')[0])}:${n.callFrame.lineNumber + 1}`;
for (const n of profile.nodes) {
  const t = (dt.get(n.id) || 0) / 1000;
  if (!t) continue;
  const k = key(n);
  self.set(k, (self.get(k) || 0) + t);
  const seen = new Set();
  let id = n.id;
  while (id !== undefined) { const kk = key(byId.get(id)); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) || 0) + t); } id = parent.get(id); }
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`).join('\n');
console.log('== self'); console.log(top(self, 45));
console.log('== total'); console.log(top(total, 60));
