/**
 * Road sign faces (道路標識) and the blue guide-sign plates.
 *
 * rs_a / rs_b / rs_c: 3×3 grids of 170 px cells (cell (c, r) at x = c·171, y = r·171). Each sign is
 * painted over a background of its own rim colour so mip bleeding never shows a fringe. Non-square
 * signs use a sub-rectangle of their cell (SIGN_CELLS in src/world/kit/street.ts).
 * gs_plates_0..7: three place plates per layer (512 × 170 px rows), kanji over Hepburn romaji,
 * white on guide-sign blue, plate = 3.2 × 1.6 m, ordered as PLACES in src/world/places.ts.
 * gs_board: Y-fork arrow, route shield, 9-slice board frame, board back.
 * All faces glow faintly at night (retroreflective look); guide plates and the crossing sign glow
 * strongly (lit).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { FONT, rrect, fitText, emitKind } from '../paintlib.mjs';
import { inRect, poly, ellipse, lin } from './20_street.mjs';

const RED = '#d6262e', BLUE = '#1c4ea6', YEL = '#f6c21b', BLK = '#1b1a1f', WHT = '#ffffff', GUIDE = '#1f53ad';

// Place names straight from src/world/places.ts (parsed, so the plates always match the game data).
const here = path.dirname(fileURLToPath(import.meta.url));
const placesSrc = fs.readFileSync(path.resolve(here, '../../../src/world/places.ts'), 'utf8');
export const PLACE_LIST = [...placesSrc.matchAll(/\{\s*jp:\s*'([^']+)',\s*romaji:\s*'([^']+)'/g)].map((m) => ({ jp: m[1], romaji: m[2] }));

const cell = (c, r) => [c * 171, r * 171, 170, 170];

// ───────────────────────────────────── sign painters ─────────────────────────────────────
function bg(g, [x, y, w, h], col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

function invTriangle(g, rc, top, sub) {
  const [x, y, w] = rc; bg(g, rc, WHT);
  const s = w - 8, h = s * 0.866, x0 = x + 4, y0 = y + (w - h) / 2;
  const tri = [[x0, y0], [x0 + s, y0], [x0 + s / 2, y0 + h]];
  poly(g, tri, WHT, WHT, 8);
  const k = 9, t2 = [[x0 + k * 1.73, y0 + k], [x0 + s - k * 1.73, y0 + k], [x0 + s / 2, y0 + h - k * 2]];
  poly(g, t2, RED, RED, 5);
  fitText(g, top, x + w / 2, y0 + h * 0.29, s * (top.length > 2 ? 0.5 : 0.44), 34, FONT.jp, { fill: WHT });
  fitText(g, sub, x + w / 2, y0 + h * 0.56, s * 0.32, 16, FONT.latin, { fill: WHT });
}
function disc(g, rc, fill, ring, rim = WHT) {
  const [x, y, w] = rc; bg(g, rc, rim);
  const cx = x + w / 2, cy = y + w / 2, R = w / 2 - 2;
  ellipse(g, cx, cy, R, R, 0, rim);
  ellipse(g, cx, cy, R - 4, R - 4, 0, ring);
  ellipse(g, cx, cy, R - 4 - (ring === fill ? 0 : 13), R - 4 - (ring === fill ? 0 : 13), 0, fill);
  return [cx, cy, R];
}
function noParking(g, rc, cross) {
  const [cx, cy, R] = disc(g, rc, BLUE, RED);
  g.save(); g.beginPath(); g.arc(cx, cy, R - 10, 0, Math.PI * 2); g.clip();
  g.strokeStyle = RED; g.lineWidth = 14; g.lineCap = 'butt';
  g.beginPath(); g.moveTo(cx - R, cy - R); g.lineTo(cx + R, cy + R); g.stroke();
  if (cross) { g.beginPath(); g.moveTo(cx + R, cy - R); g.lineTo(cx - R, cy + R); g.stroke(); }
  g.restore();
}
function noEntry(g, rc) {
  const [cx, cy, R] = disc(g, rc, RED, RED);
  g.fillStyle = WHT; g.fillRect(cx - R * 0.72, cy - R * 0.14, R * 1.44, R * 0.28);
}
function speed(g, rc, n) {
  const [cx, cy, R] = disc(g, rc, WHT, RED);
  // tall blue numerals (Japanese signs use condensed digits)
  g.save(); g.translate(cx, cy + 3); g.scale(0.78, 1.18);
  fitText(g, String(n), 0, 0, R * 1.6, R * 1.1, FONT.latinBold, { fill: BLUE });
  g.restore();
}
function oneWay(g, rc) {
  const [x, y, w] = rc; bg(g, rc, BLUE);
  const h = w / 2, y0 = y + w / 4;
  g.fillStyle = WHT; rrect(g, x + 3, y0 + 3, w - 6, h - 6, 6); g.fill();
  g.fillStyle = BLUE; rrect(g, x + 6, y0 + 6, w - 12, h - 12, 5); g.fill();
  poly(g, [[x + 14, y0 + h * 0.36], [x + w - 46, y0 + h * 0.36], [x + w - 46, y0 + h * 0.18], [x + w - 12, y0 + h / 2], [x + w - 46, y0 + h * 0.82], [x + w - 46, y0 + h * 0.64], [x + 14, y0 + h * 0.64]], WHT);
  fitText(g, '一方通行', x + w / 2 - 16, y0 + h / 2 + 1, w * 0.6, 16, FONT.jp, { fill: BLUE });
}
function diamond(g, rc) {
  const [x, y, w] = rc; bg(g, rc, YEL);
  const cx = x + w / 2, cy = y + w / 2, R = w / 2 - 1;
  poly(g, [[cx, cy - R], [cx + R, cy], [cx, cy + R], [cx - R, cy]], YEL);
  const k = R - 9;
  poly(g, [[cx, cy - k], [cx + k, cy], [cx, cy + k], [cx - k, cy]], null, BLK, 5);
  return [cx, cy, R];
}
function curve(g, rc, dir) {
  const [cx, cy] = diamond(g, rc);
  g.save(); g.translate(cx, cy); g.scale(dir, 1);
  g.strokeStyle = BLK; g.lineWidth = 13; g.lineCap = 'butt'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-8, 48); g.lineTo(-8, 4); g.quadraticCurveTo(-8, -26, 18, -26); g.stroke();
  poly(g, [[44, -26], [16, -46], [16, -6]], BLK);
  g.restore();
}
function hairpin(g, rc, dir) {
  const [cx, cy] = diamond(g, rc);
  g.save(); g.translate(cx, cy); g.scale(dir, 1);
  g.strokeStyle = BLK; g.lineWidth = 12; g.lineCap = 'butt';
  g.beginPath(); g.moveTo(-20, 50); g.lineTo(-20, -6); g.arc(4, -6, 24, Math.PI, 0); g.lineTo(28, 18); g.stroke();
  poly(g, [[28, 44], [12, 16], [44, 16]], BLK);
  g.restore();
}
function roadworks(g, rc) {
  const [cx, cy] = diamond(g, rc);
  g.save(); g.translate(cx, cy);
  // worker digging: head, body, shovel, mound
  ellipse(g, -6, -30, 8, 8, 0, BLK);
  g.strokeStyle = BLK; g.lineCap = 'round'; g.lineWidth = 9;
  g.beginPath(); g.moveTo(-8, -20); g.lineTo(-14, 6); g.lineTo(-24, 30); g.moveTo(-14, 6); g.lineTo(0, 28); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(-10, -14); g.lineTo(10, -2); g.moveTo(-10, -10); g.lineTo(8, 6); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(-2, -16); g.lineTo(24, 16); g.stroke();
  poly(g, [[18, 14], [32, 18], [28, 26], [16, 22]], BLK);
  g.beginPath(); g.moveTo(10, 36); g.quadraticCurveTo(28, 14, 46, 36); g.closePath(); g.fillStyle = BLK; g.fill();
  g.restore();
}
function children(g, rc) {
  const [cx, cy] = diamond(g, rc);
  g.save(); g.translate(cx, cy);
  const kid = (x, s) => {
    ellipse(g, x, -24 * s, 8 * s, 8 * s, 0, BLK);
    g.strokeStyle = BLK; g.lineCap = 'round'; g.lineWidth = 8 * s;
    g.beginPath(); g.moveTo(x, -14 * s); g.lineTo(x, 8 * s); g.moveTo(x, 8 * s); g.lineTo(x - 8 * s, 30 * s); g.moveTo(x, 8 * s); g.lineTo(x + 9 * s, 30 * s); g.moveTo(x, -10 * s); g.lineTo(x - 10 * s, 4 * s); g.moveTo(x, -10 * s); g.lineTo(x + 11 * s, 2 * s); g.stroke();
  };
  kid(-14, 1.0); kid(16, 0.82);
  g.fillStyle = BLK; g.fillRect(-28, -12, 9, 14);
  g.restore();
}
function signalAhead(g, rc) {
  const [cx, cy] = diamond(g, rc);
  rrect(g, cx - 14, cy - 40, 28, 80, 8); g.fillStyle = BLK; g.fill();
  ellipse(g, cx, cy - 24, 9, 9, 0, RED); ellipse(g, cx, cy, 9, 9, 0, YEL); ellipse(g, cx, cy + 24, 9, 9, 0, '#2aa86a');
}
function crossing(g, rc) {
  const [x, y, w] = rc; bg(g, rc, BLUE);
  g.strokeStyle = WHT; g.lineWidth = 4; rrect(g, x + 6, y + 6, w - 12, w - 12, 8); g.stroke();
  const cx = x + w / 2;
  poly(g, [[cx, y + 18], [x + w - 18, y + w - 24], [x + 18, y + w - 24]], WHT, WHT, 6);
  // zebra stripes
  g.fillStyle = BLK; for (let i = 0; i < 5; i++) g.fillRect(cx - 44 + i * 19, y + w - 46, 11, 16);
  // walking person
  ellipse(g, cx + 4, y + 62, 8, 8, 0, BLK);
  g.strokeStyle = BLK; g.lineCap = 'round'; g.lineWidth = 8;
  g.beginPath(); g.moveTo(cx + 2, y + 72); g.lineTo(cx - 2, y + 96); g.lineTo(cx - 14, y + 116); g.moveTo(cx - 2, y + 96); g.lineTo(cx + 12, y + 114); g.moveTo(cx + 1, y + 76); g.lineTo(cx - 14, y + 90); g.moveTo(cx + 1, y + 76); g.lineTo(cx + 16, y + 88); g.stroke();
}
function chevron(g, rc, dir, style) {
  const [x, y, w] = rc;
  const bgc = style === 'blue' ? BLUE : YEL, fg = style === 'blue' ? WHT : BLK;
  bg(g, rc, bgc);
  // the board is 0.45 × 0.6 m: centred 128 × 170 px region
  const bw = 128, bx = x + (w - bw) / 2;
  if (style === 'blue') { g.strokeStyle = WHT; g.lineWidth = 3; g.strokeRect(bx + 5, y + 5, bw - 10, w - 10); }
  g.save(); g.translate(bx + bw / 2, y + w / 2); g.scale(dir, 1);
  poly(g, [[-36, 0], [8, -54], [38, -54], [-6, 0], [38, 54], [8, 54]], fg);
  g.restore();
}
function plate(g, rc, lines, col = BLK) {
  const [x, y, w] = rc; bg(g, rc, WHT);
  const h = 72, y0 = y + (w - h) / 2;
  g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(x + 5, y0 + 4, w - 10, h - 8);
  if (lines.length === 1) fitText(g, lines[0], x + w / 2, y0 + h / 2 + 1, w - 26, 36, FONT.jp, { fill: col });
  else { fitText(g, lines[0], x + w / 2, y0 + 23, w - 26, 24, FONT.jp, { fill: col }); fitText(g, lines[1], x + w / 2, y0 + 50, w - 26, 22, FONT.jp, { fill: col }); }
}
function worksBoard(g, rc) {
  const [x, y, w] = rc; bg(g, rc, '#f6f4ee');
  const bw = 100, bx = x + (w - bw) / 2;
  g.fillStyle = '#f6f4ee'; g.fillRect(bx, y, bw, w);
  g.fillStyle = '#f07a1c'; g.fillRect(bx, y, bw, 30);
  fitText(g, '工事中', bx + bw / 2, y + 16, bw - 10, 22, FONT.jp, { fill: WHT });
  // bowing worker with a yellow helmet
  g.save(); g.translate(bx + bw / 2, y + 92); g.rotate(0.55);
  ellipse(g, 0, -26, 12, 12, 0, '#f2c8a0');
  g.beginPath(); g.arc(0, -30, 13, Math.PI, 0); g.fillStyle = YEL; g.fill(); g.fillRect(-15, -31, 30, 4);
  g.fillStyle = '#2a5ab0'; rrect(g, -12, -14, 24, 34, 6); g.fill();
  g.restore();
  g.fillStyle = '#2a5ab0'; g.fillRect(bx + bw / 2 - 10, y + 104, 8, 22); g.fillRect(bx + bw / 2 + 2, y + 104, 8, 22);
  fitText(g, 'ご迷惑をおかけします', bx + bw / 2, y + 140, bw - 8, 10, FONT.jpBold, { fill: '#222' });
  fitText(g, '期間 10月〜12月', bx + bw / 2, y + 156, bw - 10, 9, FONT.jpBold, { fill: '#d42a2a' });
  g.strokeStyle = '#2a5ab0'; g.lineWidth = 2; g.strokeRect(bx + 2, y + 2, bw - 4, w - 4);
}
function signBack(g, rc) {
  const [x, y, w] = rc;
  g.fillStyle = lin(g, x, y, x + w, y + w, [[0, '#b4bac2'], [0.5, '#a2a8b1'], [1, '#8d939c']]); g.fillRect(x, y, w, w);
  g.fillStyle = '#7a8089'; g.fillRect(x, y + w / 2 - 14, w, 28); g.fillStyle = '#c8ccd2'; g.fillRect(x, y + w / 2 - 14, w, 3);
  for (const bx of [x + 30, x + w - 30]) { ellipse(g, bx, y + w / 2, 6, 6, 0, '#5a6068'); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, w, 6);
}

const LAYOUT = {
  rs_a: [(g) => invTriangle(g, cell(0, 0), '止まれ', 'STOP'), (g) => invTriangle(g, cell(1, 0), '徐行', 'SLOW'), (g) => noParking(g, cell(2, 0), false),
    (g) => noParking(g, cell(0, 1), true), (g) => noEntry(g, cell(1, 1)), (g) => oneWay(g, cell(2, 1)),
    (g) => speed(g, cell(0, 2), 30), (g) => speed(g, cell(1, 2), 40), (g) => speed(g, cell(2, 2), 50)],
  rs_b: [(g) => speed(g, cell(0, 0), 60), (g) => curve(g, cell(1, 0), 1), (g) => curve(g, cell(2, 0), -1),
    (g) => hairpin(g, cell(0, 1), 1), (g) => hairpin(g, cell(1, 1), -1), (g) => roadworks(g, cell(2, 1)),
    (g) => crossing(g, cell(0, 2)), (g) => children(g, cell(1, 2)), (g) => signalAhead(g, cell(2, 2))],
  rs_c: [(g) => chevron(g, cell(0, 0), 1, 'blue'), (g) => chevron(g, cell(1, 0), -1, 'blue'), (g) => chevron(g, cell(2, 0), 1, 'yellow'),
    (g) => chevron(g, cell(0, 1), -1, 'yellow'), (g) => plate(g, cell(1, 1), ['急カーブ']), (g) => plate(g, cell(2, 1), ['この先', '100m']),
    (g) => worksBoard(g, cell(0, 2)), (g) => signBack(g, cell(1, 2)), (g) => plate(g, cell(2, 2), ['ヘアピン', '減速'], RED)],
};

function paintSigns(name) {
  return (g, S) => {
    g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, S, S);
    for (const f of LAYOUT[name]) f(g);
  };
}
/** Night: a faint copy of the face (retroreflective glow); `bright` cells glow fully (lit signs). */
function emitFrom(paint, k, bright = []) {
  return (g, S) => {
    const c = createCanvas(512, 512), q = c.getContext('2d');
    paint(q, 512, () => 0.5);
    g.drawImage(c, 0, 0, S, S);
    g.fillStyle = `rgba(0,0,0,${1 - k})`; g.fillRect(0, 0, S, S);
    for (const [x, y, w, h] of bright) g.drawImage(c, x, y, w, h, (x * S) / 512, (y * S) / 512, (w * S) / 512, (h * S) / 512);
    emitKind(g, S, 'always');
  };
}

// ───────────────────────────────────── guide plates ─────────────────────────────────────

/** One plate (3.2 × 1.6 m) in a 512 × 170 px row: kanji over romaji. */
function guidePlate(g, rc, p) {
  const [x, y, w, h] = rc;
  g.fillStyle = GUIDE; g.fillRect(x, y, w, h);
  inRect(g, x, y, w, h, 320, 160, (q) => {
    const chars = [...p.jp], n = chars.length;
    const ch = 78, cw = 78, gap = n === 2 ? 30 : n === 3 ? 10 : 4;
    const tw = n * cw + (n - 1) * gap;
    let cx = 160 - tw / 2;
    for (const c of chars) {
      q.save(); q.font = `${ch}px ${FONT.jpBold}`; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillStyle = WHT;
      q.fillText(c, cx + cw / 2, 58); q.restore();
      cx += cw + gap;
    }
    fitText(q, p.romaji, 160, 124, 290, 34, FONT.latinBold, { fill: WHT });
  });
}
function plates(k) {
  return (g, S) => {
    g.fillStyle = GUIDE; g.fillRect(0, 0, S, S);
    for (let r = 0; r < 3; r++) { const p = PLACE_LIST[k * 3 + r]; if (p) guidePlate(g, [0, r * 171, 512, 170], p); }
  };
}

/** gs_board: Y arrow (0,0,256,256 = 2 × 2 m), route shield (256,0,128,128), small arrows (256,128 / 384,128), frame (0,256,256,256), back (256,256,256,256). */
function board(g, S) {
  g.fillStyle = GUIDE; g.fillRect(0, 0, S, S);
  // Y-fork arrow: a stem from the bottom splitting into two arrows up-left and up-right
  inRect(g, 0, 0, 256, 256, 200, 200, (q) => {
    q.strokeStyle = WHT; q.lineWidth = 22; q.lineCap = 'butt'; q.lineJoin = 'round';
    q.beginPath(); q.moveTo(100, 200); q.lineTo(100, 120); q.quadraticCurveTo(100, 96, 80, 80); q.lineTo(52, 56); q.stroke();
    q.beginPath(); q.moveTo(100, 122); q.quadraticCurveTo(100, 96, 120, 80); q.lineTo(148, 56); q.stroke();
    poly(q, [[22, 26], [70, 36], [40, 72]], WHT);
    poly(q, [[178, 26], [130, 36], [160, 72]], WHT);
  });
  // national route shield (おにぎり)
  {
    const x = 256, y = 0;
    q2(g, x, y);
  }
  // small diagonal arrows
  inRect(g, 256, 128, 128, 128, 100, 100, (q) => { q.save(); q.translate(50, 50); q.rotate(-Math.PI / 4); poly(q, [[0, -40], [24, -10], [8, -10], [8, 40], [-8, 40], [-8, -10], [-24, -10]], WHT); q.restore(); });
  inRect(g, 384, 128, 128, 128, 100, 100, (q) => { q.save(); q.translate(50, 50); q.rotate(Math.PI / 4); poly(q, [[0, -40], [24, -10], [8, -10], [8, 40], [-8, 40], [-8, -10], [-24, -10]], WHT); q.restore(); });
  // 9-slice frame: white rounded border inset 14 px, 8 px wide, corner radius 26 px
  g.fillStyle = GUIDE; g.fillRect(0, 256, 256, 256);
  g.strokeStyle = WHT; g.lineWidth = 8; rrect(g, 14, 256 + 14, 228, 228, 26); g.stroke();
  // board back: grey with horizontal stiffeners
  {
    const x = 256, y = 256;
    g.fillStyle = '#a3a9b1'; g.fillRect(x, y, 256, 256);
    for (let k = 0; k < 4; k++) { g.fillStyle = '#7d838c'; g.fillRect(x, y + 30 + k * 60, 256, 14); g.fillStyle = '#c4c9cf'; g.fillRect(x, y + 30 + k * 60, 256, 3); }
  }
}
function q2(g, x, y) {
  g.fillStyle = GUIDE; g.fillRect(x, y, 128, 128);
  inRect(g, x, y, 128, 128, 100, 100, (q) => {
    const sh = (inset, col) => { q.beginPath(); q.moveTo(50, 96 - inset); q.bezierCurveTo(20, 80, 6 + inset, 40, 10 + inset, 18 + inset * 0.5); q.quadraticCurveTo(50, 4 + inset, 90 - inset, 18 + inset * 0.5); q.bezierCurveTo(94 - inset, 40, 80, 80, 50, 96 - inset); q.closePath(); q.fillStyle = col; q.fill(); };
    sh(0, WHT); sh(5, BLUE);
    fitText(q, '国道', 50, 26, 40, 13, FONT.jp, { fill: WHT });
    fitText(q, '134', 50, 54, 62, 34, FONT.latinBold, { fill: WHT });
  });
}

export const layers = [
  ...['rs_a', 'rs_b', 'rs_c'].map((name) => ({ name, albedo: paintSigns(name), emit: emitFrom(paintSigns(name), 0.2, name === 'rs_b' ? [cell(0, 2)] : []) })),
  ...Array.from({ length: Math.ceil(PLACE_LIST.length / 3) }, (_, k) => ({ name: `gs_plates_${k}`, albedo: plates(k), emit: emitFrom(plates(k), 0.62) })),
  { name: 'gs_board', albedo: board, emit: emitFrom(board, 0.62) },
];
