/**
 * Graffiti for walls, shutters, warehouse sides and rooftop billboard backs, in the spirit of
 * Jet Set Radio Future: one-colour tags with drips, fat bubble throw-ups, wildstyle pieces with
 * 3D blocks, gradient fills, highlights and arrows, and cartoon character stickers. All fictional
 * writers' names. Every layer is a cutout (alpha) overlay; buildings.ts places them as decals a
 * few centimetres proud of a wall. Atlas layouts mirrored in buildings.ts (GRAF).
 */
import { createCanvas } from '@napi-rs/canvas';
import { FONT, rrect } from '../paintlib.mjs';
import { def, fill, poly, circle, line, lt, dk, mix, rgba, SCALE } from './10_facades.mjs';

const INK = '#1a1030';

/** Draws on a temp canvas of the cell size, then onto g. */
function cell(g, x, y, w, h, fn) {
  const c = createCanvas(Math.ceil(w * SCALE), Math.ceil(h * SCALE));
  const t = c.getContext('2d');
  t.scale(SCALE, SCALE);
  fn(t, w, h);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(c, Math.round(x * SCALE), Math.round(y * SCALE)); g.restore();
}

function drips(g, x0, x1, y, color, rng, n = 4, len = 26) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0), l = len * (0.4 + rng());
    fill(g, color, x - 1.5, y, 3, l);
    circle(g, color, x, y + l, 3.2);
  }
}

// ───────────────────────────── tags: 3×4 cells (170×128) ─────────────────────────────
const TAGS = [
  ['REZO', 'tag', '#1a1030', null], ['K-BOMB', 'marker', '#ff2a8a', INK], ['SUZU', 'wet', '#2ae0ff', null],
  ['NEO', 'tag', '#e8eef8', INK], ['GUMI', 'marker', '#1a1030', null], ['ZOOT', 'spray', '#ff3b2a', null],
  ['MIKA', 'tag', '#8a3aff', null], ['TAB!', 'marker', '#ffd21a', INK], ['ONE', 'wet', '#1a1030', null],
  ['HAZE', 'tag', '#3aff7a', INK], ['KOBA', 'spray', '#1e5ad8', null], ['RIZ', 'tag', '#ff8a1a', INK],
];
function tags(g, rng) {
  g.clearRect(0, 0, 512, 512);
  TAGS.forEach(([t, font, c, ol], i) => {
    const x = (i % 3) * 170, y = Math.floor(i / 3) * 128, w = i % 3 === 2 ? 172 : 170;
    cell(g, x, y, w, 128, (t2, W, H) => {
      t2.translate(W / 2, H / 2 - 6); t2.rotate((rng() - 0.5) * 0.35);
      const size = font === 'tag' ? 62 : 46;
      t2.font = `${size}px ${FONT[font]}`; t2.textAlign = 'center'; t2.textBaseline = 'middle';
      const mw = t2.measureText(t).width; const s = Math.min(1, (W - 26) / mw); t2.scale(s, s);
      if (ol) { t2.lineJoin = 'round'; t2.strokeStyle = ol; t2.lineWidth = 9; t2.strokeText(t, 0, 0); }
      t2.fillStyle = c; t2.fillText(t, 0, 0);
      // underline swoosh, star or crown
      t2.lineCap = 'round';
      const k = i % 3;
      if (k === 0) { t2.strokeStyle = c; t2.lineWidth = 4; t2.beginPath(); t2.moveTo(-mw / 2, 30); t2.quadraticCurveTo(0, 46, mw / 2 + 10, 22); t2.stroke(); }
      else if (k === 1) { t2.fillStyle = c; t2.beginPath(); for (let j = 0; j < 10; j++) { const a = -Math.PI / 2 + (j * Math.PI) / 5, r = j % 2 ? 5 : 12; t2.lineTo(mw / 2 + 12 + Math.cos(a) * r, -26 + Math.sin(a) * r); } t2.fill(); }
      else { t2.fillStyle = c; t2.beginPath(); t2.moveTo(-18, -30); t2.lineTo(-12, -46); t2.lineTo(-4, -34); t2.lineTo(0, -50); t2.lineTo(4, -34); t2.lineTo(12, -46); t2.lineTo(18, -30); t2.closePath(); t2.fill(); }
      drips(t2, -mw / 2, mw / 2, 12, c, rng, 3, 18);
    });
  });
}

// ───────────────────────────── throw-ups: 2×2 cells (256×256) ─────────────────────────────
const THROWS = [
  ['BOB', '#e8eef8', '#ff2a8a', '#1a1030'], ['OK!', '#ffe21a', '#ff3b2a', '#1a1030'],
  ['RUSH', '#7affd8', '#8a3aff', '#1a1030'], ['POP', '#ffffff', '#1e8aff', '#1a1030'],
];
function bubble(t, text, size, fillC, block, ink, extra = {}) {
  t.font = `${size}px ${FONT.bungee}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.lineJoin = 'round';
  // 3D block / drop
  for (let k = 10; k >= 1; k--) { t.strokeStyle = k === 10 ? ink : block; t.lineWidth = 30; t.strokeText(text, k * 1.2, k * 1.2); }
  t.strokeStyle = ink; t.lineWidth = 34; t.strokeText(text, 0, 0);
  t.strokeStyle = fillC; t.lineWidth = 22; t.strokeText(text, 0, 0);
  t.fillStyle = fillC; t.fillText(text, 0, 0);
  // shine
  t.strokeStyle = rgba('#ffffff', 0.85); t.lineWidth = 4; t.strokeText(text, -3, -4);
  t.fillStyle = fillC; t.fillText(text, 0, 0);
  if (extra.inner) { t.strokeStyle = extra.inner; t.lineWidth = 2.5; t.strokeText(text, 0, 0); }
}
function throws(g, rng) {
  g.clearRect(0, 0, 512, 512);
  THROWS.forEach(([t, c, block, ink], i) => {
    const x = (i % 2) * 256, y = Math.floor(i / 2) * 256;
    cell(g, x, y, 256, 256, (t2, W, H) => {
      t2.translate(W / 2 - 6, H / 2 - 6); t2.rotate((rng() - 0.5) * 0.2);
      t2.font = `90px ${FONT.bungee}`;
      const mw = t2.measureText(t).width; const s = Math.min(1.2, (W - 70) / mw); t2.scale(s, s * 1.15);
      bubble(t2, t, 90, c, block, ink, { inner: i === 0 ? '#9aa4c8' : null });
      drips(t2, -mw / 3, mw / 3, 44, ink, rng, 3, 20);
      // sparkle
      const sp = (sx, sy, r) => { t2.fillStyle = '#ffffff'; t2.strokeStyle = ink; t2.lineWidth = 3; t2.beginPath(); t2.moveTo(sx, sy - r); t2.lineTo(sx + r * 0.25, sy - r * 0.25); t2.lineTo(sx + r, sy); t2.lineTo(sx + r * 0.25, sy + r * 0.25); t2.lineTo(sx, sy + r); t2.lineTo(sx - r * 0.25, sy + r * 0.25); t2.lineTo(sx - r, sy); t2.lineTo(sx - r * 0.25, sy - r * 0.25); t2.closePath(); t2.stroke(); t2.fill(); };
      sp(mw / 2 + 8, -48, 14); sp(-mw / 2 - 4, 40, 9);
    });
  });
}

// ───────────────────────────── wildstyle pieces: 2 per layer (512×256) ─────────────────────────────
/**
 * Piece: per-letter rotated/scaled glyphs merged into one shape; background element; 3D block
 * extrusion; black outline; gradient + pattern fill; highlights; arrows; optional character.
 */
function piece(g, oy, rng, o) {
  cell(g, 0, oy, 512, 256, (t, W, H) => {
    const chars = [...o.text];
    const n = chars.length;
    const size = o.size ?? 120;
    t.font = `${size}px ${o.font}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.lineJoin = 'round'; t.lineCap = 'round';
    const widths = chars.map((c) => t.measureText(c).width * 0.84);
    const total = widths.reduce((a, b) => a + b, 0);
    const sc = Math.min(1, (W - 120) / total);
    let cx = W / 2 - (total * sc) / 2;
    const L = chars.map((c, i) => {
      const w = widths[i] * sc;
      const l = { c, x: cx + w / 2, y: H / 2 + 6 + (rng() - 0.5) * 22, r: (rng() - 0.5) * 0.36, s: sc * (0.9 + rng() * 0.25) };
      cx += w; return l;
    });
    const each = (fn) => L.forEach((l) => { t.save(); t.translate(l.x, l.y); t.rotate(l.r); t.scale(l.s, l.s * 1.08); fn(l); t.restore(); });
    // background element
    if (o.bg === 'cloud') {
      const pts = Array.from({ length: 11 }, (_, i) => [W * 0.12 + (i / 10) * W * 0.76, H / 2 + (i % 2 ? -50 : 46) + (rng() - 0.5) * 20, 40 + rng() * 26]);
      t.fillStyle = INK; for (const [x, y, r] of pts) { t.beginPath(); t.arc(x, y, r + 6, 0, Math.PI * 2); t.fill(); }
      t.fillStyle = o.bgc; for (const [x, y, r] of pts) { t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill(); }
      t.fillStyle = rgba('#ffffff', 0.35); for (const [x, y, r] of pts) { t.beginPath(); t.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); t.fill(); }
    } else if (o.bg === 'burst') {
      const p = []; for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, r = i % 2 ? 90 : 128; p.push(W / 2 + Math.cos(a) * r * 1.9, H / 2 + Math.sin(a) * r * 0.9); }
      t.beginPath(); for (let i = 0; i < p.length; i += 2) t.lineTo(p[i], p[i + 1]); t.closePath(); t.lineWidth = 12; t.strokeStyle = INK; t.stroke(); t.fillStyle = o.bgc; t.fill();
    }
    // arrows behind the letters
    const arrow = (x0, y0, x1, y1, cx1, cy1, col) => {
      for (const [lw, c] of [[22, INK], [12, col]]) { t.strokeStyle = c; t.lineWidth = lw; t.beginPath(); t.moveTo(x0, y0); t.quadraticCurveTo(cx1, cy1, x1, y1); t.stroke(); }
      const a = Math.atan2(y1 - cy1, x1 - cx1);
      const tri = [[x1 + Math.cos(a) * 22, y1 + Math.sin(a) * 22], [x1 + Math.cos(a + 2.2) * 20, y1 + Math.sin(a + 2.2) * 20], [x1 + Math.cos(a - 2.2) * 20, y1 + Math.sin(a - 2.2) * 20]];
      t.fillStyle = INK; t.beginPath(); tri.forEach(([x, y]) => t.lineTo(x, y)); t.closePath(); t.lineWidth = 8; t.strokeStyle = INK; t.stroke(); t.fill();
      t.fillStyle = col; t.beginPath(); tri.forEach(([x, y]) => t.lineTo(x, y)); t.closePath(); t.fill();
    };
    arrow(W * 0.18, H * 0.78, W * 0.06, H * 0.2, W * 0.02, H * 0.7, o.arrow);
    arrow(W * 0.8, H * 0.2, W * 0.95, H * 0.74, W * 1.0, H * 0.25, o.arrow);
    // 3D block extrusion
    for (let k = 14; k >= 1; k--) each((l) => { t.strokeStyle = k === 14 ? INK : o.block; t.lineWidth = 16; t.strokeText(l.c, k * 1.1, k * 1.3); t.fillStyle = o.block; t.fillText(l.c, k * 1.1, k * 1.3); });
    each((l) => { t.strokeStyle = INK; t.lineWidth = 22; t.strokeText(l.c, 0, 0); });
    each((l) => { t.strokeStyle = o.outline; t.lineWidth = 11; t.strokeText(l.c, 0, 0); });
    // fill: gradient + pattern, clipped to the glyphs via a temp canvas
    const fc = createCanvas(Math.ceil(W * SCALE), Math.ceil(H * SCALE)); const f = fc.getContext('2d'); f.scale(SCALE, SCALE);
    f.font = t.font; f.textAlign = 'center'; f.textBaseline = 'middle';
    L.forEach((l) => { f.save(); f.translate(l.x, l.y); f.rotate(l.r); f.scale(l.s, l.s * 1.08); f.fillStyle = '#fff'; f.fillText(l.c, 0, 0); f.restore(); });
    f.globalCompositeOperation = 'source-atop';
    const G = f.createLinearGradient(0, H * 0.2, 0, H * 0.82); o.fill.forEach((c, i) => G.addColorStop(i / (o.fill.length - 1), c));
    f.fillStyle = G; f.fillRect(0, 0, W, H);
    if (o.pattern === 'stripes') { f.fillStyle = rgba('#ffffff', 0.22); for (let x = -H; x < W; x += 28) { f.beginPath(); f.moveTo(x, H); f.lineTo(x + 12, H); f.lineTo(x + 12 + H, 0); f.lineTo(x + H, 0); f.fill(); } }
    if (o.pattern === 'bubbles') for (let i = 0; i < 40; i++) { f.fillStyle = rgba('#ffffff', 0.25 + rng() * 0.2); f.beginPath(); f.arc(rng() * W, rng() * H, 3 + rng() * 9, 0, Math.PI * 2); f.fill(); }
    if (o.pattern === 'split') { f.fillStyle = rgba(o.fill2, 0.9); f.fillRect(0, H * 0.56, W, H); f.fillStyle = rgba('#ffffff', 0.9); f.fillRect(0, H * 0.555, W, 3); }
    // highlights: shine on the upper left of each glyph
    L.forEach((l) => { f.save(); f.translate(l.x, l.y); f.rotate(l.r); f.fillStyle = rgba('#ffffff', 0.7); f.beginPath(); f.ellipse(-size * 0.16 * l.s, -size * 0.24 * l.s, size * 0.12 * l.s, size * 0.05 * l.s, -0.5, 0, Math.PI * 2); f.fill(); f.restore(); });
    t.save(); t.setTransform(1, 0, 0, 1, 0, 0); t.drawImage(fc, 0, 0); t.restore();
    // sparkles + character
    const spark = (x, y, r) => { t.fillStyle = '#ffffff'; t.strokeStyle = INK; t.lineWidth = 4; t.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, rr = i % 2 ? r * 0.28 : r; t.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } t.closePath(); t.stroke(); t.fill(); };
    spark(W * 0.3, H * 0.16, 16); spark(W * 0.72, H * 0.86, 12); spark(W * 0.9, H * 0.14, 10);
    if (o.char) character(t, o.char[0], o.char[1], 44, o.char[2]);
  });
}

/** A JSRF-ish cartoon head: big eyes, cap, grin. */
function character(t, x, y, r, c) {
  t.save(); t.translate(x, y);
  t.fillStyle = INK; t.beginPath(); t.arc(0, 0, r + 6, 0, Math.PI * 2); t.fill();
  t.fillStyle = '#ffd8b0'; t.beginPath(); t.arc(0, 0, r, 0, Math.PI * 2); t.fill();
  t.fillStyle = c; t.beginPath(); t.arc(0, -r * 0.2, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); t.closePath(); t.fill();
  t.fillRect(-r * 0.2, -r * 0.42, r * 1.5, r * 0.2);
  t.lineWidth = 5; t.strokeStyle = INK; t.beginPath(); t.arc(0, -r * 0.2, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); t.stroke();
  for (const ex of [-r * 0.36, r * 0.3]) { t.fillStyle = '#ffffff'; t.beginPath(); t.ellipse(ex, r * 0.08, r * 0.22, r * 0.28, 0, 0, Math.PI * 2); t.fill(); t.lineWidth = 3; t.stroke(); t.fillStyle = INK; t.beginPath(); t.arc(ex + r * 0.06, r * 0.12, r * 0.1, 0, Math.PI * 2); t.fill(); }
  t.lineWidth = 5; t.beginPath(); t.arc(0, r * 0.42, r * 0.34, 0.15, Math.PI - 0.15); t.stroke();
  t.restore();
}

// ───────────────────────────── stickers: 4×4 cells (128×128) ─────────────────────────────
function stickers(g, rng) {
  g.clearRect(0, 0, 512, 512);
  const S = [
    (t) => { circle(t, INK, 64, 64, 54); circle(t, '#ffd21a', 64, 64, 48); circle(t, INK, 46, 54, 8); circle(t, INK, 82, 54, 8); t.lineWidth = 7; t.strokeStyle = INK; t.beginPath(); t.arc(64, 70, 26, 0.25, Math.PI - 0.25); t.stroke(); },
    (t) => { poly(t, INK, [14, 40, 30, 4, 54, 30, 74, 30, 98, 4, 114, 40, 114, 104, 14, 104]); poly(t, '#ffffff', [22, 44, 34, 16, 54, 38, 74, 38, 94, 16, 106, 44, 106, 96, 22, 96]); circle(t, INK, 46, 62, 8); circle(t, INK, 82, 62, 8); poly(t, '#ff6a9a', [58, 74, 70, 74, 64, 82]); line(t, INK, 3, 20, 76, 44, 80); line(t, INK, 3, 108, 76, 84, 80); },
    (t) => { rrect(t, 16, 20, 96, 84, 14); t.fillStyle = INK; t.fill(); rrect(t, 22, 26, 84, 72, 10); t.fillStyle = '#9adfff'; t.fill(); fill(t, INK, 60, 4, 8, 18); circle(t, '#ff3b2a', 64, 6, 7); rrect(t, 32, 44, 26, 20, 4); t.fillStyle = '#ffffff'; t.fill(); rrect(t, 70, 44, 26, 20, 4); t.fill(); circle(t, INK, 46, 54, 5); circle(t, INK, 82, 54, 5); fill(t, INK, 40, 76, 48, 8); for (let i = 0; i < 4; i++) fill(t, '#ffffff', 44 + i * 11, 77, 6, 6); },
    (t) => { circle(t, INK, 64, 62, 46); circle(t, '#f4f4f0', 64, 62, 40); fill(t, INK, 44, 90, 40, 26); fill(t, '#f4f4f0', 48, 92, 32, 20); circle(t, INK, 48, 60, 12); circle(t, INK, 80, 60, 12); poly(t, INK, [60, 78, 68, 78, 64, 70]); poly(t, INK, [30, 30, 40, 6, 52, 24, 64, 2, 76, 24, 88, 6, 98, 30]); poly(t, '#ffd21a', [36, 28, 42, 14, 52, 28, 64, 10, 76, 28, 86, 14, 92, 28]); },
    (t) => { t.fillStyle = INK; t.beginPath(); t.moveTo(22, 116); t.lineTo(22, 56); t.arc(64, 56, 42, Math.PI, 0); t.lineTo(106, 116); t.lineTo(92, 104); t.lineTo(78, 116); t.lineTo(64, 104); t.lineTo(50, 116); t.lineTo(36, 104); t.closePath(); t.fill(); t.fillStyle = '#d8f0ff'; t.beginPath(); t.moveTo(28, 106); t.lineTo(28, 56); t.arc(64, 56, 36, Math.PI, 0); t.lineTo(100, 106); t.lineTo(92, 98); t.lineTo(78, 108); t.lineTo(64, 98); t.lineTo(50, 108); t.lineTo(36, 98); t.closePath(); t.fill(); circle(t, INK, 50, 56, 8); circle(t, INK, 78, 56, 8); circle(t, '#ff8ab0', 40, 72, 6); circle(t, '#ff8ab0', 88, 72, 6); },
    (t) => { const st = (r1, r2, c) => { t.fillStyle = c; t.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r2 : r1; t.lineTo(64 + Math.cos(a) * r, 68 + Math.sin(a) * r); } t.closePath(); t.fill(); }; st(62, 30, INK); st(54, 24, '#ff5fb0'); circle(t, '#ffffff', 54, 62, 7); circle(t, '#ffffff', 74, 62, 7); circle(t, INK, 55, 63, 3.5); circle(t, INK, 75, 63, 3.5); },
    (t) => { poly(t, INK, [64, 6, 122, 112, 6, 112]); poly(t, '#ffffff', [64, 18, 110, 104, 18, 104]); fill(t, INK, 34, 78, 60, 26); fill(t, '#2a3a2a', 38, 80, 52, 22); circle(t, INK, 52, 62, 5); circle(t, INK, 76, 62, 5); t.lineWidth = 3; t.strokeStyle = INK; t.beginPath(); t.arc(64, 66, 8, 0.3, Math.PI - 0.3); t.stroke(); },
    (t) => { circle(t, INK, 64, 64, 56); circle(t, '#ffffff', 64, 64, 50); circle(t, '#2aa8ff', 64, 64, 28); circle(t, INK, 64, 64, 14); circle(t, '#ffffff', 56, 54, 6); for (let i = 0; i < 6; i++) line(t, '#ff3b5c', 2, 14 + i * 4, 40 + i * 9, 30 + i * 3, 50 + i * 5); },
    (t) => { rrect(t, 6, 26, 116, 76, 10); t.fillStyle = INK; t.fill(); rrect(t, 12, 32, 104, 64, 6); t.fillStyle = '#ff3b2a'; t.fill(); t.save(); t.translate(64, 64); t.rotate(-0.06); t.font = `40px ${FONT.bungee}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#ffe21a'; t.strokeStyle = INK; t.lineWidth = 6; t.strokeText('BOMB', 0, 0); t.fillText('BOMB', 0, 0); t.restore(); },
    (t) => { rrect(t, 6, 22, 116, 84, 8); t.fillStyle = '#e8303a'; t.fill(); fill(t, '#ffffff', 12, 58, 104, 42); t.font = `16px ${FONT.jpBold}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#ffffff'; t.fillText('こんにちは', 64, 40); t.save(); t.translate(64, 80); t.rotate(-0.08); t.font = `30px ${FONT.tag}`; t.fillStyle = INK; t.fillText('ZOOT', 0, 0); t.restore(); },
    (t) => { poly(t, INK, [8, 48, 72, 48, 72, 20, 122, 64, 72, 108, 72, 80, 8, 80]); poly(t, '#3aff7a', [16, 56, 80, 56, 80, 38, 110, 64, 80, 90, 80, 72, 16, 72]); },
    (t) => { rrect(t, 10, 30, 108, 70, 8); t.fillStyle = INK; t.fill(); rrect(t, 16, 36, 96, 58, 6); t.fillStyle = '#ff8a1f'; t.fill(); rrect(t, 28, 46, 72, 26, 6); t.fillStyle = '#f4f0e8'; t.fill(); circle(t, INK, 46, 59, 8); circle(t, INK, 82, 59, 8); circle(t, '#f4f0e8', 46, 59, 3); circle(t, '#f4f0e8', 82, 59, 3); fill(t, INK, 40, 80, 48, 8); },
    (t) => { poly(t, INK, [70, 2, 26, 70, 58, 70, 44, 126, 104, 50, 70, 50, 92, 2]); poly(t, '#ffe21a', [72, 10, 36, 64, 66, 64, 54, 110, 94, 56, 62, 56, 82, 10]); },
    (t) => { t.fillStyle = INK; t.beginPath(); t.moveTo(64, 112); t.bezierCurveTo(-4, 64, 22, 8, 64, 40); t.bezierCurveTo(106, 8, 132, 64, 64, 112); t.fill(); t.fillStyle = '#ff3b6a'; t.beginPath(); t.moveTo(64, 102); t.bezierCurveTo(8, 62, 30, 18, 64, 48); t.bezierCurveTo(98, 18, 120, 62, 64, 102); t.fill(); circle(t, '#ffffff', 46, 46, 7); poly(t, '#ffffff', [6, 40, 26, 30, 22, 50]); poly(t, '#ffffff', [122, 40, 102, 30, 106, 50]); },
    (t) => { circle(t, INK, 64, 64, 56); circle(t, '#2a62e0', 64, 64, 50); t.font = `22px ${FONT.bungee}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#ffffff'; t.fillText('DRIVE', 64, 52); t.fillStyle = '#ffe21a'; t.fillText('FM', 64, 78); },
    (t) => { circle(t, INK, 64, 64, 56); circle(t, '#ffffff', 64, 64, 50); circle(t, '#e8303a', 64, 64, 44); t.font = `62px ${FONT.jp}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#ffffff'; t.fillText('走', 64, 68); },
  ];
  S.forEach((f, i) => cell(g, (i % 4) * 128, Math.floor(i / 4) * 128, 128, 128, (t) => { t.save(); t.translate(64, 64); t.rotate((rng() - 0.5) * 0.3); t.translate(-64, -64); t.translate(6, 6); t.scale(0.9, 0.9); f(t); t.restore(); }));
}

export const layers = [
  def('graf_tags', tags, null, { cutout: true }),
  def('graf_throws', throws, null, { cutout: true }),
  def('graf_piece_a', (g, rng) => {
    g.clearRect(0, 0, 512, 512);
    piece(g, 0, rng, { text: 'DRIVE', font: FONT.bungee, size: 120, fill: ['#ffe21a', '#ff8a1a', '#ff2a6a'], block: '#5a1a8a', outline: '#ffffff', arrow: '#3ae8ff', bg: 'cloud', bgc: '#8ad8ff', pattern: 'stripes', char: [452, 196, '#ff2a6a'] });
    piece(g, 256, rng, { text: 'FUNKY', font: FONT.spray, size: 120, fill: ['#7affd8', '#2ab0ff', '#3a3aff'], block: '#1a1030', outline: '#ff5fb0', arrow: '#ffe21a', bg: 'burst', bgc: '#ff5fb0', pattern: 'bubbles' });
  }, null, { cutout: true }),
  def('graf_piece_b', (g, rng) => {
    g.clearRect(0, 0, 512, 512);
    piece(g, 0, rng, { text: 'BEAT', font: FONT.bungee, size: 130, fill: ['#e8f4ff', '#9aa8c8', '#e8f4ff'], fill2: '#ff3b5c', block: '#ff3b5c', outline: '#1a1030', arrow: '#3aff7a', bg: 'burst', bgc: '#ffe21a', pattern: 'split' });
    piece(g, 256, rng, { text: 'ネオン', font: FONT.dela, size: 120, fill: ['#ff5fb0', '#ff8a1a', '#ffe21a'], block: '#1a5a8a', outline: '#ffffff', arrow: '#ff3b2a', bg: 'cloud', bgc: '#3aff9a', pattern: 'stripes', char: [60, 190, '#2a62e0'] });
  }, null, { cutout: true }),
  def('graf_stickers', stickers, null, { cutout: true }),
];
