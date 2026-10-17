// Loads the deployed game in a headless browser and proves it boots to the title
// screen (and on into driving). Used by CI after every Pages deploy; also usable
// locally: node tools/verify-live.mjs <url> [executablePath]
import fs from 'node:fs';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }

const url = process.argv[2];
const exe = process.argv[3];
if (!url) { console.error('usage: verify-live.mjs <url>'); process.exit(2); }
fs.mkdirSync('verify-live', { recursive: true });
const browser = await chromium.launch({
  executablePath: exe || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const t0 = Date.now();
const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
const status = resp ? resp.status() : 0;
let state = 'unknown';
try {
  await page.waitForFunction(() => window.__DRIVE_FM__ && window.__DRIVE_FM__.state === 'title', null, { timeout: 120000 });
  state = 'title';
} catch { state = await page.evaluate(() => (window.__DRIVE_FM__ && window.__DRIVE_FM__.state) || 'no-game-object'); }
const tTitle = Date.now() - t0;
await page.screenshot({ path: 'verify-live/title.png' });
let driving = false;
if (state === 'title') {
  // the title ignores input for its first moments (a held key never skips it)
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  try {
    await page.waitForFunction(() => window.__DRIVE_FM__.state === 'driving', null, { timeout: 30000 });
    driving = true;
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(4000);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: 'verify-live/driving.png' });
  } catch {}
}
const info = await page.evaluate(() => (window.__DRIVE_FM__ && window.__DRIVE_FM__.info ? window.__DRIVE_FM__.info() : null));
const report = { url, httpStatus: status, state, reachedDriving: driving, msToTitle: tTitle, info, errors };
fs.writeFileSync('verify-live/report.json', JSON.stringify(report, null, 2));
console.log('LIVE-VERIFY ' + JSON.stringify(report));
await browser.close();
process.exit(status === 200 && state === 'title' && driving && errors.length === 0 ? 0 : 1);
