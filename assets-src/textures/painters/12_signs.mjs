/**
 * Signage for the city-kit buildings: blade (vertical) signs, shop name bands, billboards, neon
 * panels, tenant plates, awnings + noren, lanterns, painted company lettering, flashy LED facade
 * panels and vending machines. Atlas layouts are mirrored in src/world/kit/buildings.ts (SIGN*).
 *
 * All brands are fictional. Japanese is set one character per cell for vertical text, with the
 * long-vowel mark rotated and small kana shifted as in real vertical typesetting.
 *
 * Night: lightboxes, neon, billboards, lanterns and vending machines are stamped 'always'; old
 * wooden signboards get a dim warm 'always' as if lit by a small spotlight.
 */
import { createCanvas } from '@napi-rs/canvas';
import { FONT, rrect } from '../paintlib.mjs';
import { def, panel, vg, hg, fill, poly, circle, line, vtext, htext, lt, dk, mix, rgba, shadow, streak, blob, SCALE } from './10_facades.mjs';

// ───────────────────────────── blade signs: 8 per layer, 64×512 each (0.6 × 4.8 m) ─────────────────────────────
const BLADES_A = [
  { t: 'カラオケ', sub: 'KARAOKE', bg: '#ff4f9a', fg: '#ffffff', st: '#a01050' },
  { t: '焼肉', sub: 'YAKINIKU', bg: '#d81e1e', fg: '#ffffff', st: '#5a0808', top: '炭火' },
  { t: 'ラーメン', bg: '#ffd21a', fg: '#d81e1e', st: '#ffffff' },
  { t: '居酒屋', sub: 'IZAKAYA', bg: '#1e2a6a', fg: '#ffffff', st: '#0a0f30', ring: '#e8303a' },
  { t: 'さくら歯科', bg: '#ffffff', fg: '#1e5ad8', st: null, flower: true },
  { t: '麻雀', sub: 'MAHJONG', bg: '#1a8a4a', fg: '#ffffff', st: '#0a3a1e' },
  { t: 'スナック夢', bg: '#7a3ac8', fg: '#ffe6ff', st: '#2a0a50' },
  { t: '英会話', sub: 'ENGLISH', bg: '#1e8ad8', fg: '#ffffff', st: '#0a3a6a' },
];
const BLADES_B = [
  { t: 'くすり', bg: '#ffe21a', fg: '#1a8a3a', st: '#ffffff' },
  { t: '寿司', sub: 'SUSHI', bg: '#f4f0e6', fg: '#1a1a20', st: null, dot: '#d81e1e' },
  { t: '喫茶ポプラ', bg: '#6a3a1e', fg: '#ffe8b0', st: '#2a1408' },
  { t: 'パチンコ', bg: '#ff2a2a', fg: '#ffe21a', st: '#7a0000' },
  { t: '質', bg: '#ffffff', fg: '#1a1a1a', st: null, big: true },
  { t: '美容室', sub: 'HAIR', bg: '#ffc8dc', fg: '#c81e6a', st: '#ffffff' },
  { t: '中華料理', bg: '#d81e1e', fg: '#ffd21a', st: '#5a0808' },
  { t: 'ゲーム', sub: 'GAME', bg: '#1a1a3a', fg: '#3ae8ff', st: '#000000' },
];
function blade(g, x, b, night) {
  const w = 64, h = 512;
  const bg = night ? lt(b.bg, 0.12) : b.bg;
  fill(g, night ? '#202028' : '#c8ccd4', x, 0, w, h);
  vg(g, x + 4, 4, w - 8, h - 8, [[0, lt(bg, 0.18)], [0.5, bg], [1, dk(bg, night ? 0 : 0.12)]]);
  if (!night) { fill(g, '#eef0f4', x, 0, 2, h); fill(g, '#7a808c', x + w - 2, 0, 2, h); }
  g.strokeStyle = b.ring ?? rgba(b.fg, 0.6); g.lineWidth = 2; g.strokeRect(x + 7, 7, w - 14, h - 14);
  let y0 = 18, y1 = h - 18;
  if (b.top) { htext(g, b.top, x + w / 2, 34, w - 18, 18, FONT.jpBold, b.fg); y0 = 54; }
  if (b.sub) { g.save(); g.translate(x + w / 2, h - 46); g.rotate(-Math.PI / 2); htext(g, b.sub, 0, 0, 70, 16, FONT.latin, rgba(b.fg, 0.9)); g.restore(); y1 = h - 92; }
  if (b.flower) { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; circle(g, '#ff8ab0', x + w / 2 + Math.cos(a) * 9, 36 + Math.sin(a) * 9, 7); } circle(g, '#ffd21a', x + w / 2, 36, 5); y0 = 60; }
  if (b.dot) { circle(g, b.dot, x + w / 2, h - 40, 16); y1 = h - 70; }
  if (b.big) {
    g.strokeStyle = '#d81e1e'; g.lineWidth = 5; g.beginPath(); g.arc(x + w / 2, h / 2, 27, 0, Math.PI * 2); g.stroke();
    htext(g, b.t, x + w / 2, h / 2 + 2, 44, 44, FONT.jp, b.fg);
    return;
  }
  vtext(g, b.t, x + w / 2, y0, y1, 52, FONT.jp, b.fg, b.st ? { stroke: b.st, strokeWidth: 5 } : {});
}

// ───────────────────────────── shop name bands: 8 per layer, 512×64 (5.6 × 0.7 m) ─────────────────────────────
const stripeBand = (g, y, cols, night) => { const h = 64 / cols.length; cols.forEach((c, i) => fill(g, night ? lt(c, 0.1) : c, 0, y + i * h, 512, h + 0.5)); };
function bandFrame(g, y, bg, night) {
  vg(g, 0, y, 512, 64, [[0, lt(bg, night ? 0.12 : 0.15)], [1, night ? bg : dk(bg, 0.12)]]);
  if (!night) { fill(g, '#e8ecf0', 0, y, 512, 3); fill(g, '#6a707c', 0, y + 61, 512, 3); }
}
const BANDS = {
  a: [
    (g, y, n) => { stripeBand(g, y, ['#ffffff', '#ffffff', '#ffffff', '#ff8aa8', '#3fc26a', '#ffffff'], n); circle(g, '#ff8aa8', 60, y + 26, 20); poly(g, '#3fc26a', [60, y + 6, 76, y + 2, 70, y + 14]); htext(g, 'MOMO MART', 230, y + 26, 250, 34, FONT.latin, '#2a9a4a'); htext(g, 'モモマート', 420, y + 26, 120, 22, FONT.jp, '#ff6a90'); },
    (g, y, n) => stripeBand(g, y, ['#ffffff', '#ffffff', '#ffffff', '#ff8aa8', '#3fc26a', '#ffffff'], n),
    (g, y, n) => { stripeBand(g, y, ['#ffffff', '#ffffff', '#ff8a1f', '#ff8a1f', '#1e5ad8', '#ffffff'], n); rrect(g, 20, y + 6, 150, 40, 8); g.fillStyle = '#1e5ad8'; g.fill(); htext(g, 'Lumi24', 95, y + 26, 130, 30, FONT.latin, '#ffffff'); htext(g, 'ルミ24', 300, y + 22, 160, 30, FONT.jp, '#1e5ad8'); },
    (g, y, n) => stripeBand(g, y, ['#ffffff', '#ffffff', '#ff8a1f', '#ff8a1f', '#1e5ad8', '#ffffff'], n),
    (g, y, n) => { bandFrame(g, y, '#c81e1e', n); htext(g, 'ラーメン', 120, y + 33, 180, 40, FONT.jp, '#ffd21a', { stroke: '#5a0808', strokeWidth: 6 }); htext(g, '龍王', 330, y + 33, 120, 44, FONT.jp, '#ffffff', { stroke: '#5a0808', strokeWidth: 6 }); htext(g, 'RYUO', 460, y + 34, 70, 18, FONT.latin, '#ffd21a'); },
    (g, y, n) => { bandFrame(g, y, '#1e1e2a', n); circle(g, '#e8303a', 50, y + 32, 22); htext(g, '鳥', 50, y + 33, 30, 28, FONT.jp, '#ffffff'); htext(g, '居酒屋', 170, y + 33, 150, 36, FONT.jp, '#ffffff'); htext(g, 'とり吉', 360, y + 33, 180, 44, FONT.jp, '#ffcf2e'); },
    (g, y, n) => { bandFrame(g, y, '#2c7052', n); htext(g, '喫茶', 90, y + 33, 110, 38, FONT.jp, '#f4ecd0'); htext(g, 'みどり', 250, y + 33, 160, 40, FONT.jp, '#ffffff'); htext(g, 'COFFEE & TEA', 420, y + 34, 140, 18, FONT.latinBold, '#f4d070'); },
    (g, y, n) => { bandFrame(g, y, '#ffffff', n); fill(g, '#ec6a9e', 0, y + 54, 512, 6); htext(g, 'HAIR SALON', 140, y + 30, 220, 28, FONT.latin, '#ec6a9e'); htext(g, 'Lily', 330, y + 28, 100, 42, FONT.marker, '#3a2a4a'); htext(g, '美容室', 450, y + 30, 100, 26, FONT.jp, '#ec6a9e'); },
  ],
  b: [
    (g, y, n) => { bandFrame(g, y, '#2a0a5a', n); for (let i = 0; i < 26; i++) circle(g, n ? '#ffffff' : '#ffe080', 10 + i * 19.6, y + 6, 3); for (let i = 0; i < 26; i++) circle(g, n ? '#ffffff' : '#ffe080', 10 + i * 19.6, y + 58, 3); htext(g, 'パーラー', 110, y + 33, 150, 34, FONT.jp, '#ffe21a', { stroke: '#ff2a8a', strokeWidth: 5 }); htext(g, 'GALAXY', 340, y + 33, 260, 44, FONT.bungee, '#ffffff', { stroke: '#ff2a8a', strokeWidth: 6 }); },
    (g, y, n) => { bandFrame(g, y, '#f4e4c4', n); htext(g, 'ベーカリー', 140, y + 33, 210, 34, FONT.jp, '#8a5634'); htext(g, 'こむぎ', 350, y + 33, 150, 42, FONT.pop, '#c8641e'); circle(g, '#d89040', 470, y + 32, 18); },
    (g, y, n) => { bandFrame(g, y, '#2a9a4a', n); htext(g, 'くすりの', 130, y + 33, 170, 34, FONT.jp, '#ffffff'); htext(g, 'アオバ', 330, y + 33, 180, 44, FONT.jp, '#ffe21a', { stroke: '#0a4a1a', strokeWidth: 5 }); htext(g, 'DRUG', 465, y + 33, 70, 22, FONT.latin, '#ffffff'); },
    (g, y, n) => { bandFrame(g, y, '#f4f0e6', n); circle(g, '#d81e1e', 70, y + 32, 24); htext(g, '寿', 70, y + 33, 34, 30, FONT.jp, '#ffffff'); htext(g, '寿司', 210, y + 33, 140, 42, FONT.jp, '#1a1a20'); htext(g, 'まつ', 370, y + 33, 140, 42, FONT.jp, '#d81e1e'); },
    (g, y, n) => { bandFrame(g, y, '#d81e1e', n); htext(g, '中華料理', 170, y + 33, 260, 42, FONT.jp, '#ffd21a', { stroke: '#5a0808', strokeWidth: 5 }); htext(g, '福来', 410, y + 33, 140, 44, FONT.jp, '#ffffff', { stroke: '#5a0808', strokeWidth: 5 }); },
    (g, y, n) => { bandFrame(g, y, '#ffffff', n); fill(g, '#1e5ad8', 0, y, 90, 64); htext(g, '住', 45, y + 33, 50, 40, FONT.jp, '#ffffff'); htext(g, 'みなと不動産', 300, y + 33, 380, 38, FONT.jp, '#1e5ad8'); },
    (g, y, n) => { bandFrame(g, y, '#1a1a3a', n); htext(g, 'カラオケ', 150, y + 33, 230, 40, FONT.jp, '#ff5fb0', { stroke: '#ffffff', strokeWidth: 3 }); htext(g, 'ルナ', 360, y + 33, 120, 44, FONT.jp, '#3ae8ff'); circle(g, '#ffe21a', 470, y + 30, 16); circle(g, '#1a1a3a', 478, y + 26, 13); },
    (g, y, n) => { bandFrame(g, y, '#e8f4ff', n); htext(g, 'クリーニング', 190, y + 33, 320, 36, FONT.jp, '#1e5ad8'); htext(g, 'さくら', 420, y + 33, 140, 36, FONT.jp, '#ff6a90'); },
  ],
  // Old Town wooden kanban: carved/painted lettering on boards
  c: [
    (g, y, n) => woodBoard(g, y, n, '#4a2a18', '和菓子', 'つきみ堂', '#f4d070'),
    (g, y, n) => woodBoard(g, y, n, '#e8d8b8', '古書', 'ひなた書房', '#1a1a1a'),
    (g, y, n) => woodBoard(g, y, n, '#2a3a6a', 'ゆ', '松の湯', '#ffffff', '#c81e1e'),
    (g, y, n) => woodBoard(g, y, n, '#3a2418', '酒', '丸三商店', '#f4d070'),
    (g, y, n) => woodBoard(g, y, n, '#f0e6d0', '呉服', 'いせや', '#1a1a1a', '#7a1e2a'),
    (g, y, n) => woodBoard(g, y, n, '#2a4a2a', '日本茶', 'みどり園', '#f4ecd0'),
    (g, y, n) => woodBoard(g, y, n, '#e8dcc0', '豆腐', 'よしだ', '#1a1a1a'),
    (g, y, n) => woodBoard(g, y, n, '#4a3020', '金物', 'かじや', '#ffffff'),
  ],
};
function woodBoard(g, y, night, c, a, b, ink, accent) {
  if (night) { vg(g, 0, y, 512, 64, [[0, dk(c, 0.2)], [1, dk(c, 0.55)]]); }
  else {
    vg(g, 0, y, 512, 64, [[0, lt(c, 0.12)], [1, dk(c, 0.12)]]);
    for (let i = 0; i < 4; i++) fill(g, rgba(dk(c, 0.4), 0.18), 0, y + 10 + i * 14, 512, 1.5);
    g.strokeStyle = dk(c, 0.45); g.lineWidth = 4; g.strokeRect(2, y + 2, 508, 60);
  }
  const inkC = night ? mix(ink, '#000000', 0.45) : ink;
  if (accent) { circle(g, night ? dk(accent, 0.5) : accent, 64, y + 32, 24); htext(g, a, 64, y + 33, 36, a.length > 1 ? 18 : 32, FONT.jp, '#ffffff'); }
  else htext(g, a, 80, y + 33, 120, 36, FONT.jp, inkC);
  htext(g, b, 320, y + 33, 330, 44, FONT.jp, inkC);
}

// ───────────────────────────── billboards: 2 per layer, 512×256 (2:1) ─────────────────────────────
function billFrame(g, oy, night) {
  if (night) return;
  g.strokeStyle = '#d4d8e0'; g.lineWidth = 8; g.strokeRect(4, oy + 4, 504, 248);
  g.strokeStyle = '#6a7080'; g.lineWidth = 2; g.strokeRect(9, oy + 9, 494, 238);
}
const BILLS = [
  // DRIVE FM — the radio you are listening to
  (g, oy, n) => {
    vg(g, 0, oy, 512, 256, [[0, '#2a62e0'], [0.65, '#5ac8ff'], [1, '#ffe08a']]);
    for (let i = 0; i < 5; i++) { g.strokeStyle = rgba('#ffffff', 0.5 - i * 0.08); g.lineWidth = 6; g.beginPath(); g.arc(420, oy + 120, 30 + i * 22, -0.9, 0.9); g.stroke(); }
    poly(g, '#ff3b8a', [0, oy + 256, 0, oy + 200, 512, oy + 150, 512, oy + 256]);
    poly(g, '#ffffff', [0, oy + 256, 0, oy + 224, 512, oy + 182, 512, oy + 194, 512, oy + 256]);
    // car silhouette
    const cx = 300, cy = oy + 196;
    poly(g, '#1a1030', [cx - 90, cy, cx - 84, cy - 22, cx - 40, cy - 30, cx - 10, cy - 52, cx + 50, cy - 52, cx + 80, cy - 28, cx + 96, cy - 22, cx + 96, cy]);
    circle(g, '#1a1030', cx - 52, cy + 2, 16); circle(g, '#1a1030', cx + 58, cy + 2, 16); circle(g, '#9aa4b4', cx - 52, cy + 2, 7); circle(g, '#9aa4b4', cx + 58, cy + 2, 7);
    poly(g, '#5ac8ff', [cx - 4, cy - 30, cx + 12, cy - 48, cx + 46, cy - 48, cx + 66, cy - 30]);
    htext(g, 'DRIVE FM', 170, oy + 64, 300, 64, FONT.bungee, '#ffffff', { stroke: '#1a1030', strokeWidth: 8 });
    htext(g, '88.3', 170, oy + 122, 140, 44, FONT.latin, '#ffe21a', { stroke: '#1a1030', strokeWidth: 6 });
    htext(g, 'ドライブFM 夜も走ろう', 160, oy + 160, 280, 22, FONT.jp, '#ffffff', { stroke: '#1a1030', strokeWidth: 4 });
    billFrame(g, oy, n);
  },
  // AQUA BLAST sports drink
  (g, oy, n) => {
    vg(g, 0, oy, 512, 256, [[0, '#ffffff'], [1, '#bfe8ff']]);
    for (let i = 0; i < 8; i++) poly(g, rgba('#2fa8ff', 0.18), [256, oy + 128, 256 + Math.cos(i * 0.8) * 400, oy + 128 + Math.sin(i * 0.8) * 400, 256 + Math.cos(i * 0.8 + 0.3) * 400, oy + 128 + Math.sin(i * 0.8 + 0.3) * 400]);
    // can
    rrect(g, 330, oy + 40, 90, 180, 16); g.fillStyle = '#1e6ad8'; g.fill();
    hg(g, 334, oy + 44, 82, 172, [[0, rgba('#000', 0.2)], [0.3, rgba('#fff', 0.35)], [0.5, rgba('#fff', 0)], [1, rgba('#000', 0.25)]]);
    fill(g, '#ffffff', 330, oy + 100, 90, 40);
    htext(g, 'AQUA', 375, oy + 120, 80, 26, FONT.latin, '#1e6ad8');
    fill(g, '#c8d0dc', 340, oy + 36, 70, 8);
    for (let i = 0; i < 6; i++) circle(g, rgba('#ffffff', 0.85), 450 + (i % 2) * 18, oy + 60 + i * 26, 6 + (i % 3) * 3);
    htext(g, 'AQUA', 160, oy + 70, 260, 70, FONT.latin, '#1e6ad8', { stroke: '#ffffff', strokeWidth: 6 });
    htext(g, 'BLAST!', 170, oy + 136, 270, 60, FONT.latin, '#ff3b5c', { stroke: '#ffffff', strokeWidth: 6 });
    htext(g, 'カラダに、イオン。', 160, oy + 196, 260, 28, FONT.jp, '#1a2a5a');
    billFrame(g, oy, n);
  },
  // cup noodles
  (g, oy, n) => {
    fill(g, '#ffcf2e', 0, oy, 512, 256);
    for (let i = 0; i < 12; i++) fill(g, rgba('#ff8a1f', 0.35), i * 46, oy, 22, 256);
    // cup
    poly(g, '#ffffff', [60, oy + 60, 200, oy + 60, 186, oy + 230, 74, oy + 230]);
    fill(g, '#e8303a', 66, oy + 100, 128, 46);
    htext(g, '麺', 130, oy + 124, 60, 40, FONT.jp, '#ffffff');
    rrect(g, 52, oy + 44, 156, 22, 6); g.fillStyle = '#c8ccd4'; g.fill();
    for (let i = 0; i < 3; i++) { g.strokeStyle = rgba('#ffffff', 0.9); g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(100 + i * 30, oy + 36); g.bezierCurveTo(85 + i * 30, oy + 20, 115 + i * 30, oy + 10, 100 + i * 30, oy - 6); g.stroke(); }
    htext(g, 'ズルズル', 350, oy + 76, 280, 64, FONT.pop, '#e8303a', { stroke: '#ffffff', strokeWidth: 8 });
    htext(g, 'ヌードル', 350, oy + 142, 250, 52, FONT.pop, '#1a1a2a', { stroke: '#ffffff', strokeWidth: 6 });
    rrect(g, 268, oy + 182, 170, 44, 10); g.fillStyle = '#e8303a'; g.fill();
    htext(g, '3分で、うまい！', 353, oy + 204, 150, 24, FONT.jp, '#ffffff');
    billFrame(g, oy, n);
  },
  // HIKARI film
  (g, oy, n) => {
    vg(g, 0, oy, 512, 256, [[0, '#1a1a2a'], [1, '#3a2a5a']]);
    fill(g, '#2fa83a', 0, oy, 512, 40);
    htext(g, 'HIKARI FILM', 256, oy + 21, 300, 26, FONT.latin, '#ffffff');
    // film box
    poly(g, '#2fa83a', [60, oy + 80, 200, oy + 70, 220, oy + 210, 70, oy + 220]);
    poly(g, '#ffd21a', [70, oy + 130, 205, oy + 122, 210, oy + 160, 76, oy + 168]);
    htext(g, '36', 140, oy + 146, 60, 32, FONT.latin, '#1a1a2a');
    for (let i = 0; i < 4; i++) { panel(g, 250 + i * 62, oy + 70, 56, 70, ['#ff8aa8', '#5ac8ff', '#ffd21a', '#8aff8a'][i], { edge: 3, rim: '#ffffff' }); }
    htext(g, '思い出、くっきり。', 380, oy + 178, 240, 28, FONT.jp, '#ffffff');
    htext(g, 'ISO 400', 380, oy + 214, 120, 22, FONT.latinBold, '#ffd21a');
    billFrame(g, oy, n);
  },
  // P-201 NEO phone
  (g, oy, n) => {
    vg(g, 0, oy, 512, 256, [[0, '#ff6ac0'], [1, '#8a3aff']]);
    for (let i = 0; i < 20; i++) circle(g, rgba('#ffffff', 0.2), (i * 97) % 512, oy + ((i * 53) % 256), 4 + (i % 4) * 3);
    // flip phone
    g.save(); g.translate(380, oy + 130); g.rotate(0.18);
    rrect(g, -40, -100, 80, 96, 16); g.fillStyle = '#e8eef4'; g.fill();
    rrect(g, -32, -90, 64, 60, 6); g.fillStyle = '#5ae8ff'; g.fill();
    htext(g, 'i', 0, -60, 30, 36, FONT.latin, '#ffffff');
    rrect(g, -40, 2, 80, 100, 16); g.fillStyle = '#c8d0dc'; g.fill();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { rrect(g, -28 + c * 20, 16 + r * 20, 16, 14, 4); g.fillStyle = '#ffffff'; g.fill(); }
    g.restore();
    htext(g, 'P-201', 160, oy + 70, 240, 64, FONT.latin, '#ffffff', { stroke: '#4a1a8a', strokeWidth: 6 });
    htext(g, 'NEO', 160, oy + 130, 160, 50, FONT.bungee, '#ffe21a', { stroke: '#4a1a8a', strokeWidth: 6 });
    htext(g, 'カメラ付きケータイ 新発売', 170, oy + 190, 290, 24, FONT.jp, '#ffffff');
    billFrame(g, oy, n);
  },
  // idol concert
  (g, oy, n) => {
    vg(g, 0, oy, 512, 256, [[0, '#1a2a8a'], [1, '#ff4f9a']]);
    for (let i = 0; i < 9; i++) poly(g, rgba('#ffffff', 0.12), [256, oy + 256, 256 + (i - 4) * 80 - 30, oy, 256 + (i - 4) * 80 + 30, oy]);
    for (let i = 0; i < 3; i++) {
      const x = 330 + i * 56, y = oy + 120;
      circle(g, ['#ffd8c0', '#ffe0c8', '#ffd0b8'][i], x, y - 40, 20);
      g.fillStyle = ['#3a1a10', '#ffd040', '#1a1a2a'][i]; g.beginPath(); g.arc(x, y - 46, 23, Math.PI, 0); g.fill();
      poly(g, ['#ff5fb0', '#5ac8ff', '#ffe21a'][i], [x - 26, y + 110, x - 16, y - 16, x + 16, y - 16, x + 26, y + 110]);
    }
    htext(g, 'STAR☆LINE', 150, oy + 70, 260, 50, FONT.jp, '#ffffff', { stroke: '#ff2a8a', strokeWidth: 6 });
    htext(g, 'LIVE TOUR', 150, oy + 120, 220, 36, FONT.bungee, '#ffe21a');
    htext(g, '港アリーナ 8.24 SAT', 150, oy + 170, 250, 24, FONT.jp, '#ffffff');
    billFrame(g, oy, n);
  },
];

// ───────────────────────────── neon panels: 4 per layer, 256×256 ─────────────────────────────
/** Draws neon tubes: path builder `p(g)` stroked as a tube; albedo = pale tube on dark backing,
 *  night = blurred halo + bright core. */
function tube(g, night, color, width, p) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (night) {
    g.filter = `blur(${(width * 1.6 * SCALE).toFixed(1)}px)`; g.strokeStyle = color; g.lineWidth = width * 3.2; g.beginPath(); p(g); g.stroke();
    g.filter = 'none'; g.strokeStyle = lt(color, 0.25); g.lineWidth = width * 1.2; g.beginPath(); p(g); g.stroke();
    g.strokeStyle = lt(color, 0.75); g.lineWidth = width * 0.45; g.beginPath(); p(g); g.stroke();
  } else {
    g.strokeStyle = dk(color, 0.55); g.lineWidth = width + 3; g.beginPath(); p(g); g.stroke();
    g.strokeStyle = mix(color, '#ffffff', 0.55); g.lineWidth = width; g.beginPath(); p(g); g.stroke();
    g.strokeStyle = rgba('#ffffff', 0.7); g.lineWidth = width * 0.3; g.beginPath(); p(g); g.stroke();
  }
  g.restore();
}
/** Neon lettering: text outline traced as tubes. */
function neonText(g, night, text, x, y, size, font, color, w = 5) {
  g.save(); g.font = `${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if (night) {
    g.filter = `blur(${(w * 1.8 * SCALE).toFixed(1)}px)`; g.strokeStyle = color; g.lineWidth = w * 3; g.strokeText(text, x, y);
    g.filter = 'none'; g.strokeStyle = lt(color, 0.3); g.lineWidth = w * 1.1; g.strokeText(text, x, y);
    g.strokeStyle = lt(color, 0.8); g.lineWidth = w * 0.4; g.strokeText(text, x, y);
  } else {
    g.strokeStyle = dk(color, 0.55); g.lineWidth = w + 3; g.strokeText(text, x, y);
    g.strokeStyle = mix(color, '#ffffff', 0.55); g.lineWidth = w; g.strokeText(text, x, y);
  }
  g.restore();
}
function neonBack(g, x, y, night) {
  if (night) { fill(g, '#06040c', x, y, 256, 256); return; }
  vg(g, x, y, 256, 256, [[0, '#2a2448'], [1, '#14102a']]);
  g.strokeStyle = '#4a4470'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, 250, 250);
  for (const [a, b] of [[14, 14], [242, 14], [14, 242], [242, 242]]) circle(g, '#7a74a0', x + a, y + b, 4);
}
const NEONS = [
  (g, x, y, n) => { neonText(g, n, 'Bar', x + 120, y + 150, 110, FONT.marker, '#ff4fb0', 6); tube(g, n, '#3ae8ff', 5, (c) => { c.moveTo(x + 168, y + 44); c.lineTo(x + 228, y + 44); c.lineTo(x + 198, y + 84); c.closePath(); c.moveTo(x + 198, y + 84); c.lineTo(x + 198, y + 112); c.moveTo(x + 184, y + 114); c.lineTo(x + 212, y + 114); }); tube(g, n, '#ffe21a', 4, (c) => c.arc(x + 214, y + 40, 8, 0, Math.PI * 2)); },
  (g, x, y, n) => { tube(g, n, '#ff4f6a', 6, (c) => { c.moveTo(x + 128, y + 120); c.bezierCurveTo(x + 60, y + 70, x + 90, y + 20, x + 128, y + 60); c.bezierCurveTo(x + 166, y + 20, x + 196, y + 70, x + 128, y + 120); }); neonText(g, n, 'スナック', x + 128, y + 180, 50, FONT.jp, '#c46aff', 4); neonText(g, n, '夢', x + 128, y + 72, 40, FONT.jp, '#ffffff', 3); },
  (g, x, y, n) => { tube(g, n, '#ff3030', 6, (c) => c.arc(x + 128, y + 110, 78, 0, Math.PI * 2)); neonText(g, n, '酒', x + 128, y + 112, 104, FONT.jp, '#ff5050', 5); neonText(g, n, 'OPEN', x + 128, y + 218, 46, FONT.latin, '#3aff7a', 4); },
  (g, x, y, n) => { tube(g, n, '#ffb02a', 6, (c) => { c.moveTo(x + 40, y + 110); c.lineTo(x + 216, y + 110); c.moveTo(x + 50, y + 110); c.quadraticCurveTo(x + 60, y + 190, x + 128, y + 190); c.quadraticCurveTo(x + 196, y + 190, x + 206, y + 110); }); tube(g, n, '#ffe21a', 4, (c) => { c.moveTo(x + 150, y + 30); c.lineTo(x + 100, y + 118); c.moveTo(x + 176, y + 34); c.lineTo(x + 116, y + 120); }); tube(g, n, '#ffffff', 3, (c) => { for (let i = 0; i < 3; i++) { c.moveTo(x + 70 + i * 28, y + 90); c.quadraticCurveTo(x + 60 + i * 28, y + 70, x + 72 + i * 28, y + 52); } }); neonText(g, n, 'らーめん', x + 128, y + 228, 44, FONT.jp, '#ff6a2a', 4); },
  (g, x, y, n) => { tube(g, n, '#3ae8ff', 6, (c) => { c.moveTo(x + 40, y + 100); c.quadraticCurveTo(x + 110, y + 40, x + 180, y + 100); c.quadraticCurveTo(x + 110, y + 160, x + 40, y + 100); c.moveTo(x + 180, y + 100); c.lineTo(x + 220, y + 70); c.lineTo(x + 220, y + 130); c.closePath(); }); tube(g, n, '#ffffff', 4, (c) => c.arc(x + 70, y + 92, 6, 0, Math.PI * 2)); neonText(g, n, '寿司', x + 128, y + 200, 70, FONT.jp, '#ffffff', 4); },
  (g, x, y, n) => { tube(g, n, '#ff5fd0', 6, (c) => { c.arc(x + 70, y + 70, 30, 0, Math.PI * 2); c.moveTo(x + 92, y + 92); c.lineTo(x + 130, y + 140); }); neonText(g, n, 'カラオケ', x + 140, y + 190, 54, FONT.jp, '#3ae8ff', 4); tube(g, n, '#ffe21a', 4, (c) => { for (let i = 0; i < 3; i++) { c.moveTo(x + 140 + i * 26, y + 50 - i * 6); c.lineTo(x + 150 + i * 26, y + 90 - i * 6); } }); },
  (g, x, y, n) => { tube(g, n, '#ffe21a', 6, (c) => { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 30 : 70; i ? c.lineTo(x + 128 + Math.cos(a) * r, y + 100 + Math.sin(a) * r) : c.moveTo(x + 128 + Math.cos(a) * r, y + 100 + Math.sin(a) * r); } c.closePath(); }); neonText(g, n, 'GAME', x + 128, y + 210, 64, FONT.bungee, '#3a8aff', 5); },
  (g, x, y, n) => { neonText(g, n, 'まんが喫茶', x + 128, y + 80, 44, FONT.jp, '#3aff8a', 4); neonText(g, n, '24H', x + 128, y + 170, 96, FONT.bungee, '#ff8a2a', 6); },
];

// ───────────────────────────── tenant plates: 4×8 cells of 128×64 ─────────────────────────────
const TENANTS = [
  ['2F', 'カラオケ', '#ff4f9a'], ['3F', '麻雀', '#1a8a4a'], ['4F', '英会話', '#1e8ad8'], ['5F', '歯科', '#2ab0c8'],
  ['', 'BAR 月', '#7a3ac8'], ['', 'スナック蘭', '#c81e6a'], ['', 'ネイル', '#ff8ab0'], ['', '整体院', '#2a9a4a'],
  ['', '学習塾', '#ff8a1f'], ['', '税理士', '#1e3a8a'], ['', 'マッサージ', '#c8641e'], ['', '写真館', '#4a4a5a'],
  ['', 'ダンス教室', '#ff3b5c'], ['', 'まんが喫茶', '#3ab04a'], ['', '囲碁クラブ', '#2a2a2a'], ['2F', 'カフェ', '#6a3a1e'],
  ['plate', '松本ビル'], ['plate', '中央ビル'], ['plate', 'みどりビル'], ['plate', 'アオイビル'],
  ['apt', 'メゾン桜'], ['apt', 'コーポ青葉'], ['apt', 'ハイツ若葉'], ['apt', 'サンハイツ'],
  ['logo', 'MOMO'], ['logo', 'Lumi'], ['park', 'P'], ['works', '鈴木鉄工所'],
  ['num', '1'], ['num', '2'], ['num', '3'], ['num', '4'],
];
function tenant(g, i, night) {
  const x = (i % 4) * 128, y = Math.floor(i / 4) * 64;
  const [k, t, c] = TENANTS[i];
  if (k === 'plate') { // bronze building-name plate (not lit)
    if (night) { fill(g, '#000', x, y, 128, 64); return; }
    panel(g, x, y, 128, 64, '#b8964a', { edge: 3, rim: '#5a4218' }); htext(g, t, x + 64, y + 33, 112, 30, FONT.jp, '#3a2a10'); return;
  }
  if (k === 'apt') {
    if (night) { fill(g, '#000', x, y, 128, 64); return; }
    panel(g, x, y, 128, 64, '#f4f0e8', { edge: 2 }); htext(g, t, x + 64, y + 33, 116, 30, FONT.jpBold, '#3a3a5a'); return;
  }
  if (k === 'num') {
    if (night) { fill(g, '#000', x, y, 128, 64); return; }
    fill(g, '#ffd21a', x, y, 128, 64); htext(g, t, x + 64, y + 34, 60, 56, FONT.latin, '#1a1a2a'); return;
  }
  const bg = k === 'logo' ? (t === 'MOMO' ? '#ffffff' : '#1e5ad8') : k === 'park' ? '#1e5ad8' : k === 'works' ? '#ffffff' : '#ffffff';
  vg(g, x, y, 128, 64, [[0, lt(bg, 0.1)], [1, night ? bg : dk(bg, 0.06)]]);
  if (!night) { g.strokeStyle = '#8a909c'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, 125, 61); }
  if (k === 'logo') {
    if (t === 'MOMO') { circle(g, '#ff8aa8', x + 30, y + 30, 18); poly(g, '#3fc26a', [x + 30, y + 12, x + 44, y + 6, x + 40, y + 18]); htext(g, 'MOMO', x + 86, y + 24, 70, 24, FONT.latin, '#2a9a4a'); htext(g, 'MART', x + 86, y + 46, 70, 16, FONT.latin, '#ff6a90'); }
    else { htext(g, 'Lumi24', x + 64, y + 28, 110, 32, FONT.latin, '#ffffff'); fill(g, '#ff8a1f', x + 6, y + 48, 116, 8); }
    return;
  }
  if (k === 'park') { htext(g, 'P', x + 36, y + 33, 50, 50, FONT.latin, '#ffffff'); htext(g, '駐車場', x + 92, y + 33, 64, 22, FONT.jp, '#ffffff'); return; }
  if (k === 'works') { fill(g, '#1e3a8a', x, y + 50, 128, 14); htext(g, t, x + 64, y + 27, 118, 26, FONT.jp, '#1e3a8a'); return; }
  fill(g, c, x + 3, y + 3, k ? 36 : 6, 58);
  if (k) htext(g, k, x + 21, y + 33, 30, 24, FONT.latin, '#ffffff');
  htext(g, t, x + (k ? 82 : 68), y + 33, k ? 84 : 112, 30, FONT.jp, c);
}

// ───────────────────────────── awnings, valances, noren (cutout) ─────────────────────────────
const AWN = [['#e8303a', '#ffffff'], ['#2a9a5a', '#ffffff'], ['#1e2a6a', '#e8eef8'], ['#ff8a1f', '#fff4dc']];
const NOREN = [['#22306e', 'ゆ', '#ffffff'], ['#b8262a', '酒', '#ffffff'], ['#1c2440', 'そば', '#ffffff'], ['#f2ece0', '茶', '#2a6a3a']];
function awnings(g) {
  g.clearRect(0, 0, 512, 512);
  AWN.forEach(([a, b], i) => {
    const y = i * 64;
    for (let x = 0; x < 512; x += 64) { fill(g, a, x, y, 32, 64); fill(g, b, x + 32, y, 32, 64); }
    vg(g, 0, y, 512, 64, [[0, rgba('#ffffff', 0.12)], [1, rgba('#2a1840', 0.22)]]);
    for (let x = 0; x < 512; x += 32) fill(g, rgba('#2a1840', 0.12), x, y, 2, 64);
    // valance with scalloped bottom
    const vy = 256 + i * 32;
    g.save(); g.beginPath(); g.moveTo(0, vy); g.lineTo(512, vy); g.lineTo(512, vy + 18);
    for (let x = 512; x > 0; x -= 32) g.arc(x - 16, vy + 18, 16, 0, Math.PI, false);
    g.closePath(); g.clip();
    for (let x = 0; x < 512; x += 64) { fill(g, a, x, vy, 32, 32); fill(g, b, x + 32, vy, 32, 32); }
    vg(g, 0, vy, 512, 34, [[0, rgba('#2a1840', 0.25)], [0.3, rgba('#2a1840', 0)], [1, rgba('#2a1840', 0.15)]]);
    g.restore();
  });
  NOREN.forEach(([c, t, ink], i) => {
    const x = i * 128, y = 384;
    const pw = 128 / 3;
    for (let k = 0; k < 3; k++) {
      vg(g, x + k * pw + 2, y + 10, pw - 4, 112, [[0, lt(c, 0.06)], [1, dk(c, 0.18)]]);
      fill(g, rgba('#ffffff', 0.12), x + k * pw + 3, y + 10, 3, 112);
    }
    fill(g, dk(c, 0.3), x, y + 4, 128, 10);
    g.save(); g.beginPath(); for (let k = 0; k < 3; k++) g.rect(x + k * pw + 2, y + 10, pw - 4, 112); g.clip();
    if (t.length === 1) htext(g, t, x + 64, y + 70, 100, 78, FONT.jp, ink);
    else vtext(g, t, x + 64, y + 26, y + 116, 46, FONT.jp, ink);
    g.restore();
    fill(g, '#5a4028', x, y, 128, 5);
  });
}

// ───────────────────────────── lanterns: 2×4 cells of 256×128 (unrolled, front at centre) ─────────────────────────────
const LANTERNS = [
  ['#e8302a', '祭', '#1a1010'], ['#e8302a', '酒', '#1a1010'], ['#e8302a', '焼鳥', '#1a1010'], ['#e8302a', 'おでん', '#1a1010'],
  ['#fff4e0', '祭', '#d81e1e', '#d81e1e'], ['#fff4e0', '寺', '#1a1a1a', '#1a1a1a'], ['#ffd21a', '居酒屋', '#c81e1e'], ['#e8302a', 'らーめん', '#ffffff'],
];
function lanterns(g, night) {
  LANTERNS.forEach(([c, t, ink, band], i) => {
    const x = (i % 2) * 256, y = Math.floor(i / 2) * 128;
    if (night) {
      vg(g, x, y, 256, 128, [[0, mix(c, '#ff8a2a', 0.4)], [0.5, lt(mix(c, '#ffb050', 0.3), 0.35)], [1, mix(c, '#ff6a1a', 0.4)]]);
      for (let yy = y + 6; yy < y + 128; yy += 9) fill(g, rgba('#7a2008', 0.35), x, yy, 256, 1.5);
    } else {
      vg(g, x, y, 256, 128, [[0, dk(c, 0.15)], [0.45, lt(c, 0.15)], [1, dk(c, 0.2)]]);
      for (let yy = y + 6; yy < y + 128; yy += 9) fill(g, rgba(dk(c, 0.5), 0.35), x, yy, 256, 1.5);
    }
    if (band) { fill(g, night ? dk(band, 0.2) : band, x, y + 6, 256, 12); fill(g, night ? dk(band, 0.2) : band, x, y + 110, 256, 12); }
    const inkC = night ? mix(ink, '#000000', ink === '#ffffff' ? 0.2 : 0.3) : ink;
    if ([...t].length === 1) htext(g, t, x + 128, y + 66, 90, 84, FONT.jp, inkC);
    else vtext(g, t, x + 128, y + 14, y + 116, 44, FONT.jp, inkC);
    // back of the lantern (the u seam): a small family crest split across the cell edges
    g.save(); g.beginPath(); g.rect(x, y, 256, 128); g.clip();
    for (const cx of [x, x + 256]) { g.strokeStyle = inkC; g.lineWidth = 4; g.beginPath(); g.arc(cx, y + 64, 18, 0, Math.PI * 2); g.stroke(); circle(g, inkC, cx, y + 64, 7); }
    g.restore();
  });
}

// ───────────────────────────── painted company lettering (cutout): 4 rows of 512×128 ─────────────────────────────
function company(g) {
  g.clearRect(0, 0, 512, 512);
  const rows = [
    ['港湾倉庫', 'MINATO WAREHOUSE', '#1e4ab8', (x, y) => { circle(g, '#1e4ab8', x, y, 40); poly(g, '#ffffff', [x - 26, y + 14, x, y - 26, x + 26, y + 14]); fill(g, '#ffffff', x - 30, y + 16, 60, 8); }],
    ['北斗冷蔵', 'HOKUTO COLD STORAGE', '#d8202c', (x, y) => { for (let i = 0; i < 7; i++) circle(g, '#d8202c', x - 34 + i * 11, y + Math.sin(i * 1.3) * 18, 7); }],
    ['丸八運輸', 'MARUHACHI EXPRESS', '#1a6a3a', (x, y) => { g.strokeStyle = '#1a6a3a'; g.lineWidth = 9; g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.stroke(); htext(g, '八', x, y + 2, 50, 50, FONT.jp, '#1a6a3a'); }],
    ['海鳥物流', 'UMIDORI LOGISTICS', '#ff6a1a', (x, y) => { g.strokeStyle = '#ff6a1a'; g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 40, y); g.quadraticCurveTo(x - 20, y - 30, x, y); g.quadraticCurveTo(x + 20, y - 30, x + 40, y); g.stroke(); }],
  ];
  rows.forEach(([jp, en, c, logo], i) => {
    const y = i * 128;
    logo(56, y + 60);
    htext(g, jp, 290, y + 50, 380, 62, FONT.jp, c);
    htext(g, en, 290, y + 104, 380, 24, FONT.latin, c);
  });
}

// ───────────────────────────── flashy LED facade panels: two u-repeating halves ─────────────────────────────
function flash(g, night) {
  // top half: hot pink / violet chevrons with LED strips (period 128)
  if (night) fill(g, '#000', 0, 0, 512, 512);
  else vg(g, 0, 0, 512, 256, [[0, '#ff4fb0'], [1, '#8a2ad8']]);
  for (let x = -128; x < 640; x += 128) {
    if (!night) poly(g, rgba('#ffffff', 0.18), [x, 256, x + 64, 128, x + 128, 256, x + 104, 256, x + 64, 176, x + 24, 256]);
    if (!night) poly(g, rgba('#2a0a5a', 0.25), [x, 128, x + 64, 0, x + 128, 128, x + 104, 128, x + 64, 48, x + 24, 128]);
  }
  for (const y of [20, 120, 236]) {
    fill(g, night ? '#ff8ae0' : '#ffe0f4', 0, y, 512, 6);
    if (night) { g.save(); g.filter = `blur(${(6 * SCALE).toFixed(1)}px)`; fill(g, '#ff3ab0', 0, y - 4, 512, 14); g.restore(); fill(g, '#ffffff', 0, y + 1, 512, 3); }
  }
  // bottom half: gold with stars and bulb rows (period 128)
  if (!night) vg(g, 0, 256, 512, 256, [[0, '#ffe07a'], [1, '#e89a1a']]);
  for (let x = 0; x < 512; x += 128) {
    const cx = x + 64, cy = 384;
    const star = (r1, r2) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r2 : r1; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return p; };
    if (night) { poly(g, '#ff5a2a', star(46, 20)); poly(g, '#ffe8a0', star(30, 13)); }
    else { poly(g, '#e8302a', star(50, 22)); poly(g, '#ffffff', star(34, 15)); poly(g, '#ffd21a', star(24, 10)); }
  }
  for (const y of [272, 496]) for (let x = 8; x < 512; x += 16) { if (night) circle(g, '#fff4c0', x, y, 5); else { circle(g, '#a0601a', x, y, 6); circle(g, '#fff8e0', x - 1, y - 1, 4); } }
}

// ───────────────────────────── vending machines: 4 fronts 128×256, 4 sides below ─────────────────────────────
const VEND = [['#1e6ad8', 'AQUA', '#ffffff'], ['#d8202c', 'COLA', '#ffffff'], ['#f4f4f0', 'お茶', '#2a8a3a'], ['#2a8a4a', 'COFFEE', '#ffe8b0']];
function vending(g, night) {
  VEND.forEach(([c, name, ink], i) => {
    const x = i * 128;
    if (night) {
      fill(g, '#000', x, 0, 128, 256);
      vg(g, x + 8, 10, 112, 120, [[0, '#ffffff'], [1, '#e0f0ff']]);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const pc = ['#ff4040', '#40a0ff', '#40d060', '#ffd040', '#ff80c0', '#ffffff'][(k + r + i) % 6]; rrect(g, x + 14 + k * 17, 18 + r * 36, 12, 24, 3); g.fillStyle = pc; g.fill(); fill(g, '#40ff60', x + 15 + k * 17, 44 + r * 36, 10, 4); }
      fill(g, lt(c, 0.2), x + 8, 136, 112, 36);
      htext(g, name, x + 64, 154, 100, 24, name === 'お茶' ? FONT.jp : FONT.latin, name === 'お茶' ? '#2a8a3a' : '#ffffff');
      return;
    }
    panel(g, x, 0, 128, 256, c, { edge: 3, grad: 0.08 });
    vg(g, x + 8, 10, 112, 120, [[0, '#e8f4ff'], [1, '#b8d0e8']]);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const pc = ['#e8303a', '#2a7ad8', '#2aa84a', '#f4c020', '#ff6aa8', '#f4f4f4'][(k + r + i) % 6]; rrect(g, x + 14 + k * 17, 18 + r * 36, 12, 24, 3); g.fillStyle = pc; g.fill(); fill(g, rgba('#ffffff', 0.5), x + 15 + k * 17, 20 + r * 36, 3, 18); fill(g, '#3a3a44', x + 15 + k * 17, 44 + r * 36, 10, 4); }
    poly(g, rgba('#ffffff', 0.25), [x + 30, 10, x + 60, 10, x + 30, 130, x + 8, 130, x + 8, 100]);
    panel(g, x + 8, 136, 112, 36, lt(c, 0.15), { edge: 2 });
    htext(g, name, x + 64, 154, 100, 24, name === 'お茶' ? FONT.jp : FONT.latin, ink);
    panel(g, x + 84, 180, 28, 30, '#c8ccd4', { edge: 2 });
    fill(g, '#2a2a34', x + 94, 186, 8, 14);
    panel(g, x + 14, 214, 100, 30, '#2a2a34', { edge: 2, rim: '#8a8e98' });
    fill(g, '#4a4a54', x + 18, 218, 92, 8);
  });
  // side panels
  VEND.forEach(([c], i) => {
    const x = i * 128;
    if (night) { fill(g, '#000', x, 256, 128, 256); return; }
    panel(g, x, 256, 128, 256, c, { edge: 3, grad: 0.12 });
    fill(g, rgba('#ffffff', 0.3), x + 10, 300, 108, 20);
    fill(g, rgba('#000000', 0.15), x + 10, 330, 108, 6);
  });
}

// ───────────────────────────── export ─────────────────────────────
const always = (K) => K('always');
export const layers = [
  def('sign_blade_a', (g) => BLADES_A.forEach((b, i) => blade(g, i * 64, b, false)), (g, r, K) => { BLADES_A.forEach((b, i) => blade(g, i * 64, b, true)); always(K); }),
  def('sign_blade_b', (g) => BLADES_B.forEach((b, i) => blade(g, i * 64, b, false)), (g, r, K) => { BLADES_B.forEach((b, i) => blade(g, i * 64, b, true)); always(K); }),
  def('sign_band_a', (g) => BANDS.a.forEach((f, i) => f(g, i * 64, false)), (g, r, K) => { BANDS.a.forEach((f, i) => f(g, i * 64, true)); always(K); }),
  def('sign_band_b', (g) => BANDS.b.forEach((f, i) => f(g, i * 64, false)), (g, r, K) => { BANDS.b.forEach((f, i) => f(g, i * 64, true)); always(K); }),
  def('sign_band_c', (g) => BANDS.c.forEach((f, i) => f(g, i * 64, false)), (g, r, K) => { BANDS.c.forEach((f, i) => f(g, i * 64, true)); always(K); }),
  def('sign_bill_a', (g) => { BILLS[0](g, 0, false); BILLS[1](g, 256, false); }, (g, r, K) => { BILLS[0](g, 0, true); BILLS[1](g, 256, true); always(K); }),
  def('sign_bill_b', (g) => { BILLS[2](g, 0, false); BILLS[3](g, 256, false); }, (g, r, K) => { BILLS[2](g, 0, true); BILLS[3](g, 256, true); always(K); }),
  def('sign_bill_c', (g) => { BILLS[4](g, 0, false); BILLS[5](g, 256, false); }, (g, r, K) => { BILLS[4](g, 0, true); BILLS[5](g, 256, true); always(K); }),
  def('sign_neon_a', (g) => NEONS.slice(0, 4).forEach((f, i) => { neonBack(g, (i % 2) * 256, Math.floor(i / 2) * 256, false); f(g, (i % 2) * 256, Math.floor(i / 2) * 256, false); }),
    (g, r, K) => { NEONS.slice(0, 4).forEach((f, i) => { neonBack(g, (i % 2) * 256, Math.floor(i / 2) * 256, true); f(g, (i % 2) * 256, Math.floor(i / 2) * 256, true); }); always(K); }),
  def('sign_neon_b', (g) => NEONS.slice(4).forEach((f, i) => { neonBack(g, (i % 2) * 256, Math.floor(i / 2) * 256, false); f(g, (i % 2) * 256, Math.floor(i / 2) * 256, false); }),
    (g, r, K) => { NEONS.slice(4).forEach((f, i) => { neonBack(g, (i % 2) * 256, Math.floor(i / 2) * 256, true); f(g, (i % 2) * 256, Math.floor(i / 2) * 256, true); }); always(K); }),
  def('sign_tenant', (g) => TENANTS.forEach((_, i) => tenant(g, i, false)), (g, r, K) => { TENANTS.forEach((_, i) => tenant(g, i, true)); always(K); }),
  def('sign_awning', awnings, null, { cutout: true }),
  def('sign_lantern', (g) => lanterns(g, false), (g, r, K) => { lanterns(g, true); always(K); }),
  def('sign_company', company, null, { cutout: true }),
  def('sign_flash', (g) => flash(g, false), (g, r, K) => { flash(g, true); always(K); }),
  def('sign_vending', (g) => vending(g, false), (g, r, K) => { vending(g, true); always(K); }),
];
