/**
 * Front-end preview: mounts the real FrontEnd over an animated stand-in road scene.
 * Open /tools/ui-preview/index.html (npx vite) and use the panel (toggle with `), or drive it by URL:
 *   ?state=boot|bootsim|title|drive|pause|controls|touch  &scene=day|dusk|night  &p=0.4&label=city
 *   &sel=0..2 (pause selection)  &tab=0..2 (controls tab)  &gfx=high|low|verylow  &mode=kbd|pad
 *   &boost=0..1&boosting=1  &active=1 (touch: simulate steer + gas + boost held)  &still=1  &shot=1 (no panel, frozen scene)
 * tools/shoot-ui.mjs uses the URL form and waits for window.__ready.
 */
import { FrontEnd, type GraphicsLevel } from '../../src/ui/frontend.ts';

type Scene = 'day' | 'dusk' | 'night';
const qs = new URLSearchParams(location.search);
const shot = qs.has('shot');
let scene: Scene = (qs.get('scene') as Scene) || 'day';
const w = window as unknown as Record<string, unknown>;

// --------------------------------------------------------------------------------------- scene
const cv = document.getElementById('bg') as HTMLCanvasElement;
const g = cv.getContext('2d')!;
const PAL: Record<Scene, { top: string; hor: string; haze: string; sun: string; road: string; roadFar: string; side: string; paint: string; bld: string[]; win: string; lit: number; lamp: string }> = {
  day: { top: '#3d9bff', hor: '#dff4ff', haze: '#fff3dc', sun: '#fffbe8', road: '#9a9bae', roadFar: '#c9cbd8', side: '#d8d2c4', paint: '#ffffff', bld: ['#f3e9d6', '#ffd2b8', '#cfe6ff', '#f6f1ea', '#b9e0d2', '#ffe9a8'], win: '#7fb2e6', lit: 0, lamp: 'rgba(0,0,0,0)' },
  dusk: { top: '#3b3a8f', hor: '#ffb08a', haze: '#ffd2a0', sun: '#ffe2a8', road: '#5d5470', roadFar: '#9c86a0', side: '#8c7a8e', paint: '#ffe9d6', bld: ['#6d5a8a', '#8a5f7e', '#5a5f8f', '#7a6a90', '#9a6b78', '#5d6f8a'], win: '#ffd27a', lit: 0.35, lamp: 'rgba(255,200,120,0.25)' },
  night: { top: '#05061a', hor: '#2a1d55', haze: '#3a2a66', sun: '#e8eeff', road: '#2a2840', roadFar: '#3b3460', side: '#24203a', paint: '#d8d4ff', bld: ['#1e1b38', '#251f45', '#1a2140', '#2b2248', '#1d1a33', '#262a4a'], win: '#ffcf6a', lit: 0.75, lamp: 'rgba(255,190,110,0.32)' },
};
function hash(i: number): number { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function draw(t: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const P = PAL[scene];
  const hy = H * 0.47, vx = W / 2;
  // sky
  let gr = g.createLinearGradient(0, 0, 0, hy);
  gr.addColorStop(0, P.top); gr.addColorStop(0.75, P.hor); gr.addColorStop(1, P.haze);
  g.fillStyle = gr; g.fillRect(0, 0, W, hy + 2);
  // sun / moon + stars
  if (scene === 'night') {
    for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${0.25 + hash(i) * 0.6})`; g.fillRect(hash(i + 7) * W, hash(i + 13) * hy * 0.8, dpr * (hash(i + 3) > 0.9 ? 2 : 1), dpr * (hash(i + 3) > 0.9 ? 2 : 1)); }
    g.fillStyle = P.sun; g.beginPath(); g.arc(W * 0.78, H * 0.16, Math.min(W, H) * 0.035, 0, 7); g.fill();
  } else {
    const sx = W * (scene === 'day' ? 0.7 : 0.32), sy = scene === 'day' ? H * 0.14 : hy - H * 0.05;
    const rg = g.createRadialGradient(sx, sy, 0, sx, sy, Math.min(W, H) * 0.3);
    rg.addColorStop(0, P.sun); rg.addColorStop(0.12, P.sun); rg.addColorStop(0.13, 'rgba(255,250,230,0.5)'); rg.addColorStop(1, 'rgba(255,250,230,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, hy);
  }
  // clouds (day / dusk)
  if (scene !== 'night') {
    g.fillStyle = scene === 'day' ? 'rgba(255,255,255,0.9)' : 'rgba(255,190,170,0.55)';
    for (let i = 0; i < 6; i++) {
      const cx = ((hash(i) * W * 1.4 + t * 6 * dpr * (0.5 + hash(i + 2))) % (W * 1.4)) - W * 0.2, cy = hy * (0.18 + hash(i + 5) * 0.45), r = H * (0.03 + hash(i + 9) * 0.03);
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + k * r * 0.9, cy - (k % 2) * r * 0.35, r * 1.2, r * 0.7, 0, 0, 7); g.fill(); }
    }
  }
  // distant skyline
  for (let i = 0; i < 70; i++) {
    const bw = W * (0.015 + hash(i) * 0.03), bh = H * (0.03 + hash(i + 40) * 0.12), bx = (i / 70) * W * 1.1 - W * 0.05;
    g.fillStyle = scene === 'day' ? `rgba(150,170,205,${0.55 + hash(i + 2) * 0.2})` : scene === 'dusk' ? 'rgba(80,60,110,0.9)' : 'rgba(22,18,48,1)';
    g.fillRect(bx, hy - bh, bw, bh + 1);
    if (P.lit > 0) for (let y = hy - bh + 4 * dpr; y < hy - 3 * dpr; y += 6 * dpr) for (let x = bx + 3 * dpr; x < bx + bw - 3 * dpr; x += 5 * dpr) if (hash(x * 0.37 + y * 1.3) > 1 - P.lit * 0.5) { g.fillStyle = P.win; g.fillRect(x, y, 2 * dpr, 2 * dpr); }
  }
  // ground
  g.fillStyle = P.side; g.fillRect(0, hy, W, H - hy);
  // road (perspective)
  const halfBottom = W * 0.75, camH = H - hy;
  const roadX = (z: number) => halfBottom / z; // half width at depth z (z=1 bottom)
  const yAt = (z: number) => hy + camH / z;
  gr = g.createLinearGradient(0, hy, 0, H); gr.addColorStop(0, P.roadFar); gr.addColorStop(0.25, P.road); gr.addColorStop(1, P.road);
  g.fillStyle = gr; g.beginPath(); g.moveTo(vx - 1, hy); g.lineTo(vx + 1, hy); g.lineTo(vx + halfBottom, H); g.lineTo(vx - halfBottom, H); g.fill();
  // roadside blocks
  const speed = 16, off = (t * speed) % 8;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 60; i >= 0; i--) {
      const z0 = 1 + i * 1.6 - (off / 8) * 1.6; if (z0 < 0.9) continue;
      const z1 = z0 + 1.2;
      const id = i + Math.floor((t * speed) / 8) * 1000 + (side > 0 ? 7 : 0);
      const hgt = (0.5 + hash(id) * 1.7) * camH;
      const x0 = vx + side * roadX(z0) * 1.22, x1 = vx + side * roadX(z1) * 1.22;
      const y0 = yAt(z0), y1 = yAt(z1);
      g.fillStyle = P.bld[Math.floor(hash(id + 3) * P.bld.length)];
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, y1 - hgt / z1); g.lineTo(x0, y0 - hgt / z0); g.fill();
      g.strokeStyle = scene === 'day' ? 'rgba(40,40,70,0.35)' : 'rgba(0,0,0,0.5)'; g.lineWidth = Math.max(1, 2.2 * dpr / z0); g.stroke();
      if (P.lit > 0 && z0 < 30) {
        g.fillStyle = P.win;
        for (let r = 0.12; r < 0.9; r += 0.16) for (let c = 0.2; c < 0.9; c += 0.3) if (hash(id * 3 + r * 7 + c * 13) < P.lit * 0.7) {
          const zz = z0 + (z1 - z0) * c; const xx = vx + side * roadX(zz) * 1.22; const yy = yAt(zz) - (hgt / zz) * (1 - r);
          g.fillRect(xx - 3 * dpr / zz * 4, yy, 6 * dpr / zz * 4, 5 * dpr / zz * 4);
        }
      }
    }
  }
  // lamp pools at night
  if (P.lit > 0) for (let i = 0; i < 12; i++) {
    const z = 1 + i * 4 - ((t * speed) % 4); if (z < 1) continue;
    for (const side of [-1, 1]) { const x = vx + side * roadX(z) * 0.8, y = yAt(z); const r = (W * 0.25) / z; const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, P.lamp); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  }
  // kerbs + markings
  g.strokeStyle = P.paint; g.lineWidth = 3 * dpr;
  for (const s of [-0.93, 0.93]) { g.beginPath(); g.moveTo(vx, hy); g.lineTo(vx + s * halfBottom, H); g.stroke(); }
  g.fillStyle = P.paint;
  for (let i = 0; i < 40; i++) {
    const z0 = 1 + i * 2 - ((t * speed * 0.5) % 2), z1 = z0 + 0.9; if (z0 < 0.95) continue;
    for (const lane of [-0.31, 0.31]) {
      const a = roadX(z0) * lane, b = roadX(z1) * lane, wa = roadX(z0) * 0.012, wb = roadX(z1) * 0.012;
      g.beginPath(); g.moveTo(vx + a - wa, yAt(z0)); g.lineTo(vx + b - wb, yAt(z1)); g.lineTo(vx + b + wb, yAt(z1)); g.lineTo(vx + a + wa, yAt(z0)); g.fill();
    }
  }
  // fog toward the horizon
  gr = g.createLinearGradient(0, hy - H * 0.06, 0, hy + H * 0.12);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.4, P.haze + 'aa'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, hy - H * 0.06, W, H * 0.18);
  // parked car stand-in (rear view)
  const cw = Math.min(W * 0.27, H * 0.46), ch = cw * 0.62, cx = vx, cb = H * 0.93;
  const lw = Math.max(2, cw * 0.016);
  g.lineJoin = 'round'; g.strokeStyle = '#10101e'; g.lineWidth = lw;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(cx, cb, cw * 0.56, ch * 0.08, 0, 0, 7); g.fill();
  g.fillStyle = '#10101e'; g.fillRect(cx - cw * 0.46, cb - ch * 0.2, cw * 0.15, ch * 0.2); g.fillRect(cx + cw * 0.31, cb - ch * 0.2, cw * 0.15, ch * 0.2);
  const body = scene === 'night' ? '#b8325a' : '#ff4f6e';
  g.fillStyle = body; g.beginPath();
  g.moveTo(cx - cw * 0.5, cb - ch * 0.12); g.lineTo(cx - cw * 0.5, cb - ch * 0.5); g.quadraticCurveTo(cx - cw * 0.49, cb - ch * 0.62, cx - cw * 0.38, cb - ch * 0.64);
  g.lineTo(cx - cw * 0.3, cb - ch * 0.95); g.quadraticCurveTo(cx, cb - ch * 1.02, cx + cw * 0.3, cb - ch * 0.95); g.lineTo(cx + cw * 0.38, cb - ch * 0.64);
  g.quadraticCurveTo(cx + cw * 0.49, cb - ch * 0.62, cx + cw * 0.5, cb - ch * 0.5); g.lineTo(cx + cw * 0.5, cb - ch * 0.12); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = scene === 'day' ? '#3a4a7a' : '#141430'; g.beginPath();
  g.moveTo(cx - cw * 0.33, cb - ch * 0.66); g.lineTo(cx - cw * 0.27, cb - ch * 0.9); g.quadraticCurveTo(cx, cb - ch * 0.95, cx + cw * 0.27, cb - ch * 0.9); g.lineTo(cx + cw * 0.33, cb - ch * 0.66); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ff2a3a';
  if (scene !== 'day') { g.shadowColor = '#ff2a3a'; g.shadowBlur = cw * 0.08; }
  g.fillRect(cx - cw * 0.47, cb - ch * 0.5, cw * 0.2, ch * 0.1); g.fillRect(cx + cw * 0.27, cb - ch * 0.5, cw * 0.2, ch * 0.1);
  g.shadowBlur = 0;
  g.fillStyle = '#2a2a3e'; g.fillRect(cx - cw * 0.5, cb - ch * 0.24, cw, ch * 0.12); g.strokeRect(cx - cw * 0.5, cb - ch * 0.24, cw, ch * 0.12);
  g.fillStyle = '#fff'; g.fillRect(cx - cw * 0.09, cb - ch * 0.4, cw * 0.18, ch * 0.08); g.strokeRect(cx - cw * 0.09, cb - ch * 0.4, cw * 0.18, ch * 0.08);
}

let frozenT = shot ? 2.2 : -1;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  draw(frozenT >= 0 ? frozenT : now / 1000);
  tickGame(dt);
  if (!shot) requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------------------- UI
const gfxParam = qs.get('gfx');
if (gfxParam) { try { localStorage.setItem('drivefm.graphics', gfxParam); } catch { /* */ } }
if (qs.has('still')) document.documentElement.classList.add('still');

let mode: 'boot' | 'title' | 'drive' = 'boot';
let boostLevel = Number(qs.get('boost') ?? 0.4);
let boosting = qs.get('boosting') === '1';
let autoBoost = !qs.has('boost');
let shiftHeld = false;
const log = (...a: unknown[]) => console.log('[ui]', ...a);

const app = document.getElementById('app')!;
const fe = new FrontEnd(app, {
  start() { mode = 'drive'; log('start'); },
  resume() { log('resume'); },
  graphics(l: GraphicsLevel) { log('graphics', l); },
});
fe.onTouchPause = () => { if (mode === 'drive') fe.showPause(); };
if (qs.has('still')) (app.firstElementChild as HTMLElement).classList.add('dfm--still');

function tickGame(dt: number): void {
  if (mode !== 'drive' || fe.paused) return;
  if (autoBoost) {
    const want = shiftHeld || fe.touch.boost;
    boosting = want && boostLevel > 0;
    boostLevel = boosting ? Math.max(0, boostLevel - dt / 3.5) : Math.min(1, boostLevel + dt / 10);
  }
  fe.setBoost(boostLevel, boosting);
}

window.addEventListener('keydown', (e) => {
  if (e.key === '`') { panel.classList.toggle('hidden'); return; }
  if (e.key === 'Shift') shiftHeld = true;
  if (mode === 'drive' && !fe.paused && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) fe.showPause();
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftHeld = false; });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

async function bootSim(): Promise<void> {
  const labels = ['road', 'city', 'cars', 'people'];
  const t0 = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - t0) / 3400);
    fe.boot(p, labels[Math.min(labels.length - 1, Math.floor(p * labels.length))]);
    if (p >= 1) break;
    await wait(60);
  }
  await wait(250);
  fe.bootDone(); fe.showTitle(); mode = 'title';
}

function simTouch(): void {
  const pe = (type: string, id: number, x: number, y: number) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 11, button: 0, buttons: 1 });
  const ring = document.querySelector('.dfm-ring')!.getBoundingClientRect();
  const steer = document.querySelector('.dfm-steer')!;
  const x0 = ring.left + ring.width / 2 + 24, y0 = ring.top + ring.height / 2 - 30;
  steer.dispatchEvent(pe('pointerdown', 11, x0, y0));
  steer.dispatchEvent(pe('pointermove', 11, x0 + ring.width * 0.32, y0 + 4));
  const pedals = document.querySelector('.dfm-pedals')!;
  for (const [id, sel] of [[12, '[data-ctl=gas]'], [13, '[data-ctl=boost]']] as const) {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    pedals.dispatchEvent(pe('pointerdown', id, r.left + r.width / 2, r.top + r.height / 2));
  }
}

async function apply(): Promise<void> {
  const state = qs.get('state') || 'bootsim';
  const sel = Number(qs.get('sel') || 0), tab = Number(qs.get('tab') || 0);
  const padMode = qs.get('mode') === 'pad';
  const nav = (a: 'up' | 'down' | 'left' | 'right' | 'confirm') => padMode ? fe.menu(a) : key({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', confirm: 'Enter' }[a]);
  if (state === 'bootsim') { await bootSim(); return; }
  if (state === 'boot') { fe.boot(Number(qs.get('p') || 0), qs.get('label') || 'road'); return; }
  fe.boot(1, 'people');
  fe.bootDone();
  if (state === 'title') { fe.showTitle(); mode = 'title'; return; }
  mode = 'drive';
  fe.setBoost(boostLevel, boosting);
  if (state === 'drive') return;
  if (state === 'touch') {
    fe.setTouchVisible(true);
    if (qs.get('active') === '1') { await wait(50); simTouch(); boosting = true; fe.setBoost(boostLevel, true); }
    return;
  }
  const touchMode = qs.get('touch') === '1';
  if (touchMode) fe.setTouchVisible(true);
  fe.showPause();
  await wait(160);
  if (touchMode) {
    // touch has no selection cursor: tap the control instead, as a player would
    const tap = (sel: string) => (document.querySelector(sel) as HTMLElement).click();
    if (state === 'controls') tap('.dfm-item[data-i="2"]');
    else if (sel === 1) tap(`.dfm-chip[data-level="${qs.get('gfx') || 'high'}"]`);
    await wait(30);
    if (state === 'controls') tap(`.dfm-tab[data-tab="${tab}"]`);
    return;
  }
  if (padMode) { fe.menu('down'); fe.menu('up'); }
  const target = state === 'controls' ? 2 : sel;
  for (let i = 0; i < target; i++) nav('down');
  if (state === 'controls') {
    nav('confirm');
    await wait(30);
    const opened = padMode ? 1 : 0;
    for (let i = 0; i < (tab - opened + 3) % 3; i++) nav('right');
  }
}

// --------------------------------------------------------------------------------------- panel
const panel = document.getElementById('panel')!;
if (shot) panel.classList.add('hidden');
const go = (params: Record<string, string | number>) => { const u = new URLSearchParams({ scene, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }); location.search = u.toString(); };
const section = (name: string) => { const b = document.createElement('b'); b.textContent = name; panel.appendChild(b); };
const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = (e) => { e.stopPropagation(); fn(); }; panel.appendChild(b); };
section('Flow');
btn('Replay boot → title', () => go({ state: 'bootsim' }));
btn('Boot 5%', () => go({ state: 'boot', p: 0.05, label: 'road' }));
btn('Boot 45%', () => go({ state: 'boot', p: 0.45, label: 'city' }));
btn('Boot 90%', () => go({ state: 'boot', p: 0.9, label: 'cars' }));
btn('Title', () => go({ state: 'title' }));
btn('Drive', () => go({ state: 'drive' }));
section('Menus (live)');
btn('Pause', () => { mode = 'drive'; fe.hideTitle(); fe.showPause(); });
btn('Pause → graphics', () => go({ state: 'pause', sel: 1 }));
btn('Controls', () => go({ state: 'controls' }));
btn('Gamepad nav ↓', () => fe.menu('down'));
btn('Gamepad →', () => fe.menu('right'));
btn('Gamepad A', () => fe.menu('confirm'));
btn('Gamepad B', () => fe.menu('back'));
section('Boost (hold Shift to spend)');
const lab = document.createElement('label');
lab.innerHTML = 'level <input type="range" min="0" max="1" step="0.01">';
const range = lab.querySelector('input')!;
range.value = String(boostLevel);
range.oninput = () => { autoBoost = false; boostLevel = Number(range.value); fe.setBoost(boostLevel, boosting); };
panel.appendChild(lab);
btn('Boosting on/off', () => { autoBoost = false; boosting = !boosting; fe.setBoost(boostLevel, boosting); });
btn('Auto', () => { autoBoost = true; });
section('Touch / scene');
btn('Touch on', () => fe.setTouchVisible(true));
btn('Touch off', () => fe.setTouchVisible(false));
for (const s of ['day', 'dusk', 'night'] as const) btn(s, () => { scene = s; if (shot) draw(frozenT); });
const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = '` hides this panel · Esc/P pauses while driving'; panel.appendChild(hint);

w.__ui = { fe, scene: (s: Scene) => { scene = s; draw(frozenT >= 0 ? frozenT : performance.now() / 1000); } };
requestAnimationFrame(frame);
(async () => {
  await apply();
  try { await document.fonts.ready; } catch { /* */ }
  await wait(shot ? 1300 : 0);
  w.__touch = () => ({ ...fe.touch });
  w.__ready = true;
})();
