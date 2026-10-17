/**
 * Street kit textures: paving, kerbs, ground, fences and walls, hoardings, containers, cranes,
 * trees, small street props. Layers are prefixed `st_`. Painted with canvas-up = wall-up (the
 * loader flips), clean flat colour and soft gradients, no noise speckle.
 *
 * Several layers are atlases or "band"/"strip" sheets; the matching rectangles live in
 * src/world/kit/street.ts (ATLAS / BANDS / STRIPS). Keep the two in sync.
 *
 * Bands  (tile along u, fixed v range): st_hoarding_a/b, st_walls, st_fences, st_metal, st_containers
 * Strips (tile along v, fixed u range): st_strips
 * Cells  (fixed rectangles):           st_props_a/b, st_docks, st_cards
 */
import { FONT, rrect, fitText, emitKind } from '../paintlib.mjs';

// ───────────────────────────── helpers (also used by 22/24) ─────────────────────────────

/** Paint in a local unit space (uw × uh) mapped onto the pixel rect, clipped. */
export function inRect(g, x, y, w, h, uw, uh, fn, clip = true) {
  g.save();
  if (clip) { g.beginPath(); g.rect(x, y, w, h); g.clip(); }
  g.translate(x, y);
  g.scale(w / uw, h / uh);
  fn(g, uw, uh);
  g.restore();
}
/** Calls fn(dx, dy) for the 9 wrap offsets, so shapes crossing an edge tile seamlessly. */
export function wrap9(S, fn) { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); }
export function wrapX(W, fn) { for (const dx of [-W, 0, W]) fn(dx); }
export function wrapY(H, fn) { for (const dy of [-H, 0, H]) fn(dy); }

export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbHex([r, g, b]) { const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); }
/** Multiply brightness (k < 1 darker), nudging hue toward violet in shade and warm in light. */
export function shade(hex, k) {
  const [r, g, b] = hexRgb(hex);
  if (k < 1) return rgbHex([r * k * 0.96, g * k * 0.95, b * Math.min(1, k * 1.08)]);
  const t = Math.min(1, k - 1);
  return rgbHex([r + (255 - r) * t, g + (250 - g) * t, b + (235 - b) * t]);
}
export function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
export function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [t, c] of stops) gr.addColorStop(t, c); return gr; }
export function softBlob(g, x, y, r, hex, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(hex, a)); gr.addColorStop(0.6, rgba(hex, a * 0.55)); gr.addColorStop(1, rgba(hex, 0));
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}
export function ellipse(g, x, y, rx, ry, rot, fill) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); }
export function poly(g, pts, fill, stroke, lw) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
}
/** A painted tile: flat colour, a soft light edge on top/left and a soft dark edge bottom/right. */
export function bevelRect(g, x, y, w, h, base, r = 2, bw = 3, light = 0.16, dark = 0.2) {
  rrect(g, x, y, w, h, r); g.fillStyle = base; g.fill();
  g.save(); rrect(g, x, y, w, h, r); g.clip();
  g.fillStyle = lin(g, x, y, x, y + bw * 2, [[0, `rgba(255,255,250,${light})`], [1, 'rgba(255,255,250,0)']]); g.fillRect(x, y, w, bw * 2);
  g.fillStyle = lin(g, x, y, x + bw * 2, y, [[0, `rgba(255,255,250,${light * 0.6})`], [1, 'rgba(255,255,250,0)']]); g.fillRect(x, y, bw * 2, h);
  g.fillStyle = lin(g, x, y + h - bw * 2, x, y + h, [[0, 'rgba(40,30,60,0)'], [1, `rgba(40,30,60,${dark})`]]); g.fillRect(x, y + h - bw * 2, w, bw * 2);
  g.fillStyle = lin(g, x + w - bw * 2, y, x + w, y, [[0, 'rgba(40,30,60,0)'], [1, `rgba(40,30,60,${dark * 0.7})`]]); g.fillRect(x + w - bw * 2, y, bw * 2, h);
  g.restore();
}
/** Big low-contrast patches for large-scale variation in ground textures (tileable). */
export function patches(g, S, rng, colors, n, rMin, rMax, a) {
  for (let i = 0; i < n; i++) {
    const x = rng() * S, y = rng() * S, r = rMin + rng() * (rMax - rMin), c = colors[Math.floor(rng() * colors.length)];
    const sx = 0.7 + rng() * 0.6;
    wrap9(S, (dx, dy) => { g.save(); g.translate(x + dx, y + dy); g.scale(sx, 1 / sx); softBlob(g, 0, 0, r, c, a); g.restore(); });
  }
}
/** Soft vertical rain streaks running down from the top of a band. */
export function streaks(g, x0, y0, w, h, rng, hex, n, a) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * w, sw = 3 + rng() * 10, len = h * (0.2 + rng() * 0.6);
    g.fillStyle = lin(g, 0, y0, 0, y0 + len, [[0, rgba(hex, a)], [1, rgba(hex, 0)]]);
    g.fillRect(x, y0, sw, len);
  }
}
/** A spray-paint tag: stroked text with an outline, a highlight and a few drips. */
export function tag(g, text, x, y, size, font, fill, outline, rot, rng) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.font = `${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16; g.strokeStyle = outline; g.strokeText(text, 0, 0);
  g.fillStyle = fill; g.fillText(text, 0, 0);
  // drips
  const w = g.measureText(text).width;
  g.fillStyle = fill;
  for (let i = 0; i < 3; i++) {
    const dx = (rng() - 0.5) * w * 0.8, dl = size * (0.25 + rng() * 0.5);
    g.fillRect(dx, size * 0.25, Math.max(1.5, size * 0.04), dl);
    ellipse(g, dx + size * 0.02, size * 0.25 + dl, size * 0.035, size * 0.045, 0, fill);
  }
  g.globalAlpha = 0.5; g.fillStyle = '#ffffff';
  g.font = `${size}px ${font}`; g.fillText(text, -size * 0.03, -size * 0.04);
  g.globalAlpha = 1; g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}
/** Clear a rect to transparent (for cutout cells). */
export function clear(g, x, y, w, h) { g.clearRect(x, y, w, h); }

// ───────────────────────────────────── paving ─────────────────────────────────────

/** Grey 30 cm concrete slabs, 8×8 per repeat (tile 2.4 m). */
function paveGrey(g, S, rng) {
  const n = 8, c = S / n;
  g.fillStyle = '#8f8a86'; g.fillRect(0, 0, S, S);
  const tones = ['#c2bdb4', '#bab5ad', '#c8c3ba', '#b4afa8', '#bfbab2'];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let t = tones[Math.floor(rng() * tones.length)];
    if ((i + j * 3) % 11 === 0) t = '#a9a7a8';
    bevelRect(g, i * c + 1.5, j * c + 1.5, c - 3, c - 3, t, 3, 3, 0.18, 0.18);
  }
  patches(g, S, rng, ['#6d6258', '#ffffff'], 10, 40, 110, 0.06);
  // a few soft stains (gum/oil), round and clean
  for (let i = 0; i < 6; i++) { const x = rng() * S, y = rng() * S; wrap9(S, (dx, dy) => softBlob(g, x + dx, y + dy, 6 + rng() * 10, '#5d5650', 0.18)); }
}

/** Interlocking colour pavers in a basket weave (tile 1.6 m, unit 0.2 m). */
function paveBrick(g, S, rng) {
  const n = 8, c = S / n;
  g.fillStyle = '#7b6a62'; g.fillRect(0, 0, S, S);
  const tones = ['#b5584a', '#a24e45', '#bd6a52', '#c98f5a', '#94493f', '#b97a5e'];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * c, y = j * c;
    const horiz = (i + j) % 2 === 0;
    for (let k = 0; k < 2; k++) {
      let t = tones[Math.floor(rng() * tones.length)];
      if (rng() < 0.08) t = '#d8b48a';
      if (horiz) bevelRect(g, x + 1.5, y + k * c / 2 + 1.5, c - 3, c / 2 - 3, t, 3, 2.5, 0.2, 0.22);
      else bevelRect(g, x + k * c / 2 + 1.5, y + 1.5, c / 2 - 3, c - 3, t, 3, 2.5, 0.2, 0.22);
    }
  }
  patches(g, S, rng, ['#4a3a3a', '#fff0e0'], 8, 60, 130, 0.07);
}

/** Old Town granite: running courses of rectangular stones of varied length (tile 3.2 m). */
function paveStone(g, S, rng) {
  const rows = 8, h = S / rows;
  g.fillStyle = '#6f6a5c'; g.fillRect(0, 0, S, S);
  const tones = ['#b9b1a2', '#aaa293', '#c3bba9', '#a19a90', '#b4ab98', '#9d988c'];
  for (let r = 0; r < rows; r++) {
    let x = rng() * S; const end = x + S;
    while (x < end - 1) {
      let w = h * (1.0 + rng() * 1.6);
      if (end - x - w < h * 0.7) w = end - x;
      const t = tones[Math.floor(rng() * tones.length)];
      for (const dx of [-S, 0]) {
        bevelRect(g, x + dx + 2.5, r * h + 2.5, w - 5, h - 5, t, 7, 4, 0.22, 0.24);
      }
      // soft wear in the middle of each stone
      for (const dx of [-S, 0]) softBlob(g, x + dx + w * (0.3 + rng() * 0.4), r * h + h / 2, h * 0.35, '#ffffff', 0.08);
      x += w;
    }
  }
  // moss in the joints, painted as soft green along a few seams
  for (let i = 0; i < 18; i++) { const x = rng() * S, y = Math.round(rng() * rows) * h; wrap9(S, (dx, dy) => softBlob(g, x + dx, y + dy, 10 + rng() * 14, '#5f7a3a', 0.35)); }
}

/** Plain broom-finished concrete, no joints (tile 3 m). */
function concrete(g, S, rng) {
  g.fillStyle = '#bcb7ae'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#a59f96', '#cfcac1', '#b0a99c'], 26, 50, 140, 0.35);
  g.globalAlpha = 0.05; g.fillStyle = '#5a5048';
  for (let i = 0; i < 70; i++) { const y = rng() * S; g.fillRect(0, y, S, 1); }
  g.globalAlpha = 1;
  // two hairline cracks
  g.strokeStyle = 'rgba(70,62,60,0.35)'; g.lineWidth = 1.4; g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    let x = rng() * S, y = rng() * S, a = rng() * 6.28;
    g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < 9; i++) { a += (rng() - 0.5) * 1.1; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
    g.stroke();
  }
}

/**
 * Strips sheet: columns that tile along v (run direction). u ranges (px):
 *   0–96 tactile line (0.3 m) · 96–192 tactile dots (0.3 m) · 192–256 kerb (0.2 m)
 *   256–384 gutter lids (0.4 m) · 384–480 guard-rail beam (0.35 m) · 480–512 white line (0.15 m)
 * v repeat: tactile 1.2 m (4 blocks), kerb 2 m (2 stones), gutter 2 m (4 lids), beam 4 m, line 2 m.
 */
function strips(g, S, rng) {
  const Y = '#f3c21c';
  // tactile line blocks (bars run along v)
  for (let b = 0; b < 4; b++) {
    const y = b * 128;
    bevelRect(g, 1, y + 1, 94, 126, Y, 3, 3, 0.25, 0.25);
    for (let k = 0; k < 4; k++) {
      const x = 11 + k * 21;
      rrect(g, x, y + 10, 11, 108, 5); g.fillStyle = '#d9a612'; g.fill();
      rrect(g, x + 1, y + 10, 8, 104, 4); g.fillStyle = '#f9d64a'; g.fill();
      g.fillStyle = 'rgba(255,255,230,0.55)'; g.fillRect(x + 2, y + 13, 2.5, 96);
    }
  }
  // tactile dot blocks
  for (let b = 0; b < 4; b++) {
    const y = b * 128;
    bevelRect(g, 97, y + 1, 94, 126, Y, 3, 3, 0.25, 0.25);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
      const x = 97 + 13 + i * 22.5, yy = y + 14 + j * 25;
      ellipse(g, x + 1, yy + 1.5, 7, 7, 0, '#d39d10');
      ellipse(g, x, yy, 6.5, 6.5, 0, '#f9d64a');
      ellipse(g, x - 2, yy - 2, 2.2, 2.2, 0, 'rgba(255,255,235,0.8)');
    }
  }
  // kerb stones: 2 per repeat, chamfer line, joints
  for (let b = 0; b < 2; b++) {
    const y = b * 256;
    bevelRect(g, 192, y + 1.5, 64, 253, b ? '#c7c3bb' : '#bfbbb3', 2, 3, 0.25, 0.22);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(192, y, 6, 256);
    g.fillStyle = 'rgba(60,50,70,0.12)'; g.fillRect(246, y, 10, 256);
    softBlob(g, 224, y + 128, 50, '#8a847c', 0.12);
  }
  // gutter lids: 3 concrete + 1 steel grating per 2 m
  for (let b = 0; b < 4; b++) {
    const y = b * 128, x = 256;
    if (b === 2) {
      g.fillStyle = '#3d3f48'; g.fillRect(x, y, 128, 128);
      bevelRect(g, x + 4, y + 4, 120, 120, '#5c606b', 2, 3, 0.3, 0.3);
      for (let k = 0; k < 9; k++) { g.fillStyle = '#23242c'; g.fillRect(x + 12 + k * 12.5, y + 10, 6, 108); g.fillStyle = 'rgba(200,210,230,0.35)'; g.fillRect(x + 12 + k * 12.5, y + 10, 1.5, 108); }
      g.fillStyle = '#4c505a'; g.fillRect(x + 8, y + 62, 112, 4);
    } else {
      g.fillStyle = '#7f7a74'; g.fillRect(x, y, 128, 128);
      bevelRect(g, x + 2, y + 2, 124, 124, ['#b3aea5', '#aba69e', '#b8b3aa'][b % 3], 3, 4, 0.22, 0.25);
      for (const yy of [y + 30, y + 98]) { rrect(g, x + 54, yy - 5, 20, 10, 4); g.fillStyle = '#56504c'; g.fill(); }
      softBlob(g, x + 64, y + 64, 50, '#7a7064', 0.12);
    }
  }
  // guard-rail beam face: painted W profile highlights across u, bolts at splice (v=0) and centre
  {
    const x = 384, w = 96;
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, '#cfd3d8'], [0.12, '#f4f5f6'], [0.3, '#d9dce0'], [0.42, '#a9afb8'], [0.5, '#c4c8ce'], [0.58, '#a9afb8'], [0.7, '#d9dce0'], [0.88, '#f4f5f6'], [1, '#c5c9cf']]);
    g.fillRect(x, 0, w, S);
    for (const yy of [0, 256, 512]) {
      for (const bx of [x + 22, x + 48, x + 74]) for (const by of [-14, 14]) { ellipse(g, bx, yy + by, 5.5, 5.5, 0, '#8f959e'); ellipse(g, bx - 1, yy + by - 1, 3.5, 3.5, 0, '#dfe2e6'); }
    }
    g.fillStyle = 'rgba(80,70,60,0.10)'; g.fillRect(x, 0, 6, S); g.fillRect(x + w - 6, 0, 6, S);
    streaks(g, x, 0, w, S, rng, '#8a7a6a', 0, 0);
  }
  // worn white line
  {
    const x = 480;
    g.fillStyle = '#f5f5f1'; g.fillRect(x + 2, 0, 28, S);
    g.fillStyle = 'rgba(160,160,170,0.25)';
    for (let i = 0; i < 9; i++) { const y = rng() * S; ellipse(g, x + 6 + rng() * 20, y, 3 + rng() * 5, 6 + rng() * 14, 0, 'rgba(150,150,160,0.25)'); }
    g.clearRect(x, 0, 2, S); g.clearRect(x + 30, 0, 2, S);
  }
}

// ───────────────────────────────────── ground ─────────────────────────────────────

function grassStrokes(g, S, rng, n, cols, len, wid) {
  for (let i = 0; i < n; i++) {
    const cx = rng() * S, cy = rng() * S, k = 4 + Math.floor(rng() * 5), col = cols[Math.floor(rng() * cols.length)];
    wrap9(S, (dx, dy) => {
      for (let j = 0; j < k; j++) {
        const x = cx + dx + (rng() - 0.5) * len * 1.2, y = cy + dy + (rng() - 0.5) * len * 0.6;
        const lean = (rng() - 0.5) * 0.8, l = len * (0.6 + rng() * 0.6);
        g.beginPath(); g.moveTo(x - wid, y); g.quadraticCurveTo(x + lean * l * 0.5, y - l * 0.6, x + lean * l, y - l); g.quadraticCurveTo(x + lean * l * 0.5 + wid * 0.3, y - l * 0.5, x + wid, y); g.closePath();
        g.fillStyle = col; g.fill();
      }
    });
  }
}

/** Mown grass verge / lawn (tile 4 m). */
function grass(g, S, rng) {
  g.fillStyle = '#6aa344'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#4f8a38', '#86b94e', '#5f9a3e', '#9cc45a'], 30, 50, 130, 0.45);
  grassStrokes(g, S, rng, 70, ['#4a8235', '#579640'], 16, 2.2);
  grassStrokes(g, S, rng, 55, ['#8cc152', '#9fcf5c'], 13, 2);
  // a few clover/flower dots in clusters
  for (let i = 0; i < 6; i++) {
    const cx = rng() * S, cy = rng() * S;
    for (let j = 0; j < 5; j++) { const x = cx + (rng() - 0.5) * 30, y = cy + (rng() - 0.5) * 30; wrap9(S, (dx, dy) => { ellipse(g, x + dx, y + dy, 2.6, 2.6, 0, '#f4f1dc'); ellipse(g, x + dx, y + dy, 1, 1, 0, '#f2c94c'); }); }
  }
}

/** Wild grass / scrub for the edge of town (tile 6 m). */
function scrub(g, S, rng) {
  g.fillStyle = '#8a9a48'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#6f8a3c', '#a8a85a', '#b49a5a', '#5f7f38'], 34, 50, 150, 0.5);
  grassStrokes(g, S, rng, 80, ['#5d7a32', '#6b8a36'], 26, 2.6);
  grassStrokes(g, S, rng, 60, ['#b7b866', '#c6bc6e', '#a3b25a'], 22, 2.2);
  for (let i = 0; i < 8; i++) {
    const cx = rng() * S, cy = rng() * S, c = ['#f6f3e6', '#f2d24a', '#c9a8e6'][i % 3];
    for (let j = 0; j < 7; j++) { const x = cx + (rng() - 0.5) * 40, y = cy + (rng() - 0.5) * 30; wrap9(S, (dx, dy) => ellipse(g, x + dx, y + dy, 2.4, 2.4, 0, c)); }
  }
}

/** Packed earth with moss and pebbles (Old Town ground, tile 5 m). */
function earth(g, S, rng) {
  g.fillStyle = '#a88a64'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#8f7252', '#bea07a', '#9a7d5a'], 30, 50, 140, 0.45);
  patches(g, S, rng, ['#6f8040', '#7d8c48'], 9, 40, 90, 0.4);
  for (let i = 0; i < 90; i++) {
    const x = rng() * S, y = rng() * S, r = 2.5 + rng() * 5, t = ['#d2c2a6', '#9d907e', '#bcae96'][Math.floor(rng() * 3)];
    wrap9(S, (dx, dy) => { ellipse(g, x + dx + 1, y + dy + 1.5, r, r * 0.75, 0, 'rgba(70,50,40,0.35)'); ellipse(g, x + dx, y + dy, r, r * 0.72, 0, t); ellipse(g, x + dx - r * 0.3, y + dy - r * 0.3, r * 0.35, r * 0.25, 0, 'rgba(255,250,235,0.6)'); });
  }
}

/** Gravel with weed patches (lots, unpaved car parks; tile 3 m). */
function gravel(g, S, rng) {
  g.fillStyle = '#a49c90'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#8e867c', '#bab2a5', '#9b9184'], 26, 40, 120, 0.45);
  for (let i = 0; i < 230; i++) {
    const x = rng() * S, y = rng() * S, r = 3.2 + rng() * 4.6, t = ['#c4bcb0', '#a39a8e', '#b6aa98', '#8f877e', '#cfc8bd'][Math.floor(rng() * 5)];
    wrap9(S, (dx, dy) => { ellipse(g, x + dx + 0.8, y + dy + 1.2, r, r * 0.8, 0, 'rgba(60,50,50,0.25)'); ellipse(g, x + dx, y + dy, r, r * 0.78, rng() * 3, t); });
  }
  // weeds
  for (let i = 0; i < 9; i++) {
    const cx = rng() * S, cy = rng() * S;
    wrap9(S, (dx, dy) => softBlob(g, cx + dx, cy + dy, 34, '#6f8a3c', 0.45));
    grassStrokesAt(g, S, rng, cx, cy, 12, ['#5f8a38', '#7aa244', '#8db24c'], 14, 2.2, 26);
  }
}
function grassStrokesAt(g, S, rng, cx, cy, n, cols, len, wid, spread) {
  for (let j = 0; j < n; j++) {
    const x = cx + (rng() - 0.5) * spread * 2, y = cy + (rng() - 0.5) * spread, lean = (rng() - 0.5) * 0.9, l = len * (0.6 + rng() * 0.7), col = cols[Math.floor(rng() * cols.length)];
    wrap9(S, (dx, dy) => { g.beginPath(); g.moveTo(x + dx - wid, y + dy); g.quadraticCurveTo(x + dx + lean * l * 0.5, y + dy - l * 0.6, x + dx + lean * l, y + dy - l); g.quadraticCurveTo(x + dx + lean * l * 0.5, y + dy - l * 0.5, x + dx + wid, y + dy); g.closePath(); g.fillStyle = col; g.fill(); });
  }
}

/** Dock concrete: 4 m slabs, expansion joints, rust and oil stains (tile 8 m). */
function dock(g, S, rng) {
  const n = 2, c = S / n;
  g.fillStyle = '#5c5a58'; g.fillRect(0, 0, S, S);
  const tones = ['#a7a49d', '#9e9b94', '#aeaaa1', '#999790'];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) bevelRect(g, i * c + 2, j * c + 2, c - 4, c - 4, tones[(i + j * 2) % 4], 2, 5, 0.12, 0.2);
  patches(g, S, rng, ['#8a8780', '#bdb9b0'], 18, 50, 120, 0.4);
  // rust bleeding from a few bolt points, and oil
  for (let i = 0; i < 7; i++) { const x = rng() * S, y = rng() * S; wrap9(S, (dx, dy) => { softBlob(g, x + dx, y + dy, 18 + rng() * 22, '#a2582c', 0.45); ellipse(g, x + dx, y + dy, 3, 3, 0, '#5a3020'); }); }
  for (let i = 0; i < 5; i++) { const x = rng() * S, y = rng() * S; wrap9(S, (dx, dy) => { g.save(); g.translate(x + dx, y + dy); g.scale(1.6, 1); softBlob(g, 0, 0, 22 + rng() * 26, '#2c2a34', 0.4); g.restore(); }); }
  // patched repair rectangle
  g.fillStyle = 'rgba(70,68,70,0.35)'; g.fillRect(rng() * S * 0.6, rng() * S * 0.6, 90, 50);
}

/** Car-park asphalt: dark blue-grey, soft patches, oil drips (tile 6 m). */
function asphalt(g, S, rng) {
  g.fillStyle = '#4a4b55'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#3d3e48', '#5a5b64', '#54545e'], 30, 50, 150, 0.5);
  for (let i = 0; i < 9; i++) { const x = rng() * S, y = rng() * S; wrap9(S, (dx, dy) => { g.save(); g.translate(x + dx, y + dy); g.scale(1, 1.8); softBlob(g, 0, 0, 14 + rng() * 18, '#24242c', 0.5); g.restore(); }); }
  // a few short sealed cracks (wandering, never full-width so the tile has no seams)
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < 4; i++) {
    let x = rng() * S, y = rng() * S, a = rng() * Math.PI * 2;
    const pts = [[x, y]];
    for (let k = 0; k < 7; k++) { a += (rng() - 0.5) * 1.1; x += Math.cos(a) * 14; y += Math.sin(a) * 14; pts.push([x, y]); }
    wrap9(S, (dx, dy) => { g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.strokeStyle = 'rgba(28,28,36,0.55)'; g.lineWidth = 4; g.stroke(); });
  }
}

// ───────────────────────────────────── fences ─────────────────────────────────────

/** Chain-link mesh, alpha cutout (tile 1.2 m, 15 cm diamonds, stylised heavy wire). */
function chainlink(g, S, rng) {
  // The holes are not fully clear: they carry a light mesh grey at a low alpha, just under
  // the 0.5 cutout threshold (0.4). Up close they are discarded (see-through mesh); in the mip levels the
  // average alpha (~0.6) stays above the threshold, so a distant or grazing fence reads as the grey
  // sheen of a real chain-link run instead of vanishing.
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(176,184,192,0.4)'; g.fillRect(0, 0, S, S);
  const p = 64;
  g.lineCap = 'round';
  const pass = (w, col, off) => {
    g.strokeStyle = col; g.lineWidth = w;
    for (let k = -S; k <= 2 * S; k += p) {
      g.beginPath(); g.moveTo(k + off, -off); g.lineTo(k + S + off, S - off); g.stroke();
      g.beginPath(); g.moveTo(k - off, S + off); g.lineTo(k + S - off, -off); g.stroke();
    }
  };
  pass(7.5, '#4f5966', 0);
  pass(3.6, '#9aa6b0', 0);
  pass(1.6, '#e2e8ec', -0.8);
  // knuckle shading at crossings
  for (let i = 0; i < S / p; i++) for (let j = 0; j < S / p; j++) {
    ellipse(g, i * p + p / 2, j * p, 4, 3, 0, '#5d6874'); ellipse(g, i * p, j * p + p / 2, 4, 3, 0, '#5d6874');
  }
}

/** Hoarding band painter: 6 m × 3 m panel run in a (x, y, 512, 256) band. */
function hoardingPanels(g, y0, base, band, rng) {
  // white steel panels with trapezoid ribs every ~0.18 m and seams every 0.545 m
  const ppm = 512 / 6;
  g.fillStyle = base; g.fillRect(0, y0, 512, 256);
  for (let x = 0; x < 512; x += 0.18 * ppm) {
    g.fillStyle = 'rgba(70,70,110,0.07)'; g.fillRect(x, y0, 4, 256);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 4, y0, 2, 256);
  }
  for (let k = 0; k <= 11; k++) { const x = (k * 512) / 11; g.fillStyle = 'rgba(60,60,90,0.22)'; g.fillRect(x - 1, y0, 2, 256); }
  // top edge cap and bottom band
  g.fillStyle = band; g.fillRect(0, y0, 512, 7);
  g.fillStyle = band; g.fillRect(0, y0 + 256 - 34, 512, 34);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, y0 + 256 - 34, 512, 2);
  // dirt splash at the foot
  for (let i = 0; i < 26; i++) { const x = rng() * 512; softBlob(g, x, y0 + 252, 14 + rng() * 20, '#6a5848', 0.25); }
}
function seaMural(g, y0, rng) {
  const top = y0 + 8, bot = y0 + 256 - 36, H = bot - top;
  g.save(); g.beginPath(); g.rect(0, top, 512, H); g.clip();
  g.fillStyle = lin(g, 0, top, 0, bot, [[0, '#5ec4f0'], [0.55, '#bfe9f7'], [1, '#e8f6f4']]); g.fillRect(0, top, 512, H);
  // sun
  ellipse(g, 400, top + 52, 30, 30, 0, '#ffb43c'); ellipse(g, 400, top + 52, 22, 22, 0, '#ffd45a');
  // clouds
  for (const [cx, cy, s] of [[90, top + 40, 1], [250, top + 28, 0.8], [480, top + 90, 0.7]]) {
    wrapX(512, (dx) => { for (const [ox, oy, r] of [[0, 0, 16], [16, -6, 18], [34, 0, 14], [18, 6, 15]]) ellipse(g, cx + dx + ox * s, cy + oy * s, r * s, r * s * 0.8, 0, '#ffffff'); });
  }
  // mountains (layered)
  const ridge = (yb, amp, col, ph) => { g.beginPath(); g.moveTo(0, bot); for (let x = 0; x <= 512; x += 8) g.lineTo(x, yb - amp * (0.5 + 0.5 * Math.sin((x / 512) * Math.PI * 2 * 2 + ph)) - amp * 0.3 * Math.sin((x / 512) * Math.PI * 2 * 5 + ph * 2)); g.lineTo(512, bot); g.closePath(); g.fillStyle = col; g.fill(); };
  ridge(top + 120, 40, '#7aa7d8', 0.3);
  ridge(top + 135, 26, '#4e8fb8', 1.7);
  // sea
  g.fillStyle = '#1f6fc0'; g.fillRect(0, top + 140, 512, H);
  g.fillStyle = '#2f8ad6'; g.fillRect(0, top + 140, 512, 8);
  // wave curls (Hokusai-ish, flat)
  for (let i = 0; i < 9; i++) {
    const cx = i * 57 + 20, cy = top + 172 + (i % 2) * 12;
    g.beginPath(); g.arc(cx, cy, 16, Math.PI, Math.PI * 2.0); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
    g.beginPath(); g.arc(cx + 6, cy, 8, Math.PI * 1.1, Math.PI * 2.1); g.lineWidth = 4; g.stroke();
  }
  // lighthouse
  g.fillStyle = '#ffffff'; poly(g, [[60, top + 150], [72, top + 150], [69, top + 92], [63, top + 92]], '#ffffff');
  g.fillStyle = '#e8453c'; g.fillRect(63.5, top + 110, 5.6, 8); g.fillRect(62.5, top + 130, 7.5, 8);
  poly(g, [[60, top + 92], [72, top + 92], [66, top + 82]], '#e8453c');
  // boat
  poly(g, [[230, top + 160], [290, top + 160], [282, top + 172], [238, top + 172]], '#e8453c');
  g.fillStyle = '#ffffff'; g.fillRect(250, top + 146, 22, 14); g.fillStyle = '#1f3f7a'; g.fillRect(254, top + 150, 5, 5); g.fillRect(262, top + 150, 5, 5);
  // gulls
  g.strokeStyle = '#2a3550'; g.lineWidth = 2.5; g.lineCap = 'round';
  for (const [x, y] of [[150, top + 60], [175, top + 75], [320, top + 50], [345, top + 64]]) { g.beginPath(); g.moveTo(x - 8, y - 3); g.quadraticCurveTo(x - 4, y - 7, x, y); g.quadraticCurveTo(x + 4, y - 7, x + 8, y - 3); g.stroke(); }
  g.restore();
}

/** st_hoarding_a: band 0 = seaside mural, band 1 = slogan panels with graffiti. */
function hoardingA(g, S, rng) {
  hoardingPanels(g, 0, '#f2f1ec', '#2d8a5a', rng);
  seaMural(g, 0, rng);
  g.fillStyle = '#ffffff'; g.font = `600 15px ${FONT.jpBold}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ご迷惑をおかけしております　みなと未来建設', 256, 256 - 17);
  // band 1: blue band panels with slogans + tags
  hoardingPanels(g, 256, '#f0efe8', '#1f5fae', rng);
  // green cross 安全第一 emblem
  const ex = 70, ey = 256 + 95;
  g.fillStyle = '#ffffff'; g.fillRect(ex - 44, ey - 44, 88, 88); g.strokeStyle = '#1e8a4a'; g.lineWidth = 4; g.strokeRect(ex - 44, ey - 44, 88, 88);
  g.fillStyle = '#1e8a4a'; g.fillRect(ex - 30, ey - 10, 60, 20); g.fillRect(ex - 10, ey - 30, 20, 60);
  fitText(g, '安全第一', 196, 256 + 70, 150, 44, FONT.jp, { fill: '#1e8a4a' });
  fitText(g, '工事中', 196, 256 + 125, 150, 46, FONT.jp, { fill: '#d23a2e' });
  // graffiti tags
  tag(g, 'KOI', 380, 256 + 90, 70, FONT.tag, '#ff3fa4', '#251a3a', -0.12, rng);
  tag(g, 'NEON', 430, 256 + 165, 44, FONT.marker, '#31e0c8', '#162030', 0.05, rng);
  tag(g, 'zk!', 300, 256 + 170, 34, FONT.spray, '#ffd23f', '#251a3a', -0.2, rng);
  g.fillStyle = '#ffffff'; g.font = `600 14px ${FONT.jpBold}`; g.textAlign = 'center';
  g.fillText('SAKURA KENSETSU  ·  さくら建設  ·  TEL 0120-48-3510', 256, 512 - 17);
}

/** st_hoarding_b: band 0 = kids' town art, band 1 = full graffiti wall. */
function hoardingB(g, S, rng) {
  hoardingPanels(g, 0, '#fbf6e9', '#e8862a', rng);
  {
    const top = 8, bot = 220;
    g.save(); g.beginPath(); g.rect(0, top, 512, bot - top); g.clip();
    g.fillStyle = '#fff6dc'; g.fillRect(0, top, 512, bot - top);
    // rainbow
    const rb = ['#ef5a4a', '#f59a3a', '#f6d04a', '#6cc46a', '#4aa3e0', '#8a6ad0'];
    rb.forEach((c, i) => { g.beginPath(); g.arc(256, 230, 190 - i * 10, Math.PI, 0); g.lineWidth = 10; g.strokeStyle = c; g.stroke(); });
    // hills + houses
    ellipse(g, 120, 245, 180, 70, 0, '#8acb5a'); ellipse(g, 420, 250, 200, 70, 0, '#7abf4e');
    for (const [x, c, r] of [[60, '#ffffff', '#e2483c'], [150, '#ffe08a', '#3d7fd0'], [360, '#bfe3ff', '#e2483c'], [450, '#ffd0e0', '#6a4ab0']]) {
      g.fillStyle = c; g.fillRect(x - 22, 160, 44, 40); poly(g, [[x - 28, 162], [x + 28, 162], [x, 138]], r);
      g.fillStyle = '#5ac0f0'; g.fillRect(x - 12, 172, 10, 10); g.fillStyle = '#8a5a3a'; g.fillRect(x + 4, 178, 10, 22);
    }
    // cat and dog faces
    const face = (x, y, col, ear) => {
      if (ear === 'cat') { poly(g, [[x - 20, y - 10], [x - 8, y - 18], [x - 16, y - 32]], col); poly(g, [[x + 20, y - 10], [x + 8, y - 18], [x + 16, y - 32]], col); }
      else { ellipse(g, x - 20, y - 6, 8, 16, 0.3, '#8a5a3a'); ellipse(g, x + 20, y - 6, 8, 16, -0.3, '#8a5a3a'); }
      ellipse(g, x, y, 22, 19, 0, col);
      ellipse(g, x - 8, y - 3, 3, 4, 0, '#222'); ellipse(g, x + 8, y - 3, 3, 4, 0, '#222'); ellipse(g, x, y + 5, 3, 2.4, 0, '#e2483c');
    };
    face(255, 100, '#ffffff', 'cat'); face(300, 115, '#f2c48a', 'dog');
    // flowers
    for (let i = 0; i < 14; i++) { const x = 15 + i * 37, y = 205 + (i % 3) * 4, c = ['#ef5a4a', '#f6d04a', '#ff8ac0'][i % 3]; g.fillStyle = '#4a9a3a'; g.fillRect(x - 1, y, 2, 14); for (let p = 0; p < 5; p++) ellipse(g, x + Math.cos(p * 1.256) * 5, y + Math.sin(p * 1.256) * 5, 4, 4, 0, c); ellipse(g, x, y, 3, 3, 0, '#fff6a0'); }
    fitText(g, 'みんなのまち', 120, 50, 200, 40, FONT.pop, { fill: '#3d7fd0' });
    g.restore();
  }
  g.fillStyle = '#ffffff'; g.font = `600 15px ${FONT.jpBold}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('新校舎建設工事　発注者：みどり市　施工：北野工務店', 256, 256 - 17);
  // band 1: graffiti wall over purple panels
  hoardingPanels(g, 256, '#5a3f9a', '#2a1f4a', rng);
  {
    const y0 = 256;
    // background drips and fades
    for (let i = 0; i < 6; i++) softBlob(g, rng() * 512, y0 + 60 + rng() * 140, 80, ['#ff5aa0', '#31e0c8', '#ffd23f'][i % 3], 0.25);
    // big piece
    g.save(); g.translate(170, y0 + 128); g.rotate(-0.06);
    g.font = `112px ${FONT.wet}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 22; g.strokeStyle = '#120c22'; g.strokeText('RUDE', 0, 0);
    g.lineWidth = 10; g.strokeStyle = '#ffffff'; g.strokeText('RUDE', 0, 0);
    g.fillStyle = lin(g, 0, -50, 0, 50, [[0, '#ffe23f'], [0.5, '#ff8a2a'], [1, '#ff3f7a']]); g.fillText('RUDE', 0, 0);
    g.restore();
    tag(g, 'GoGo', 410, y0 + 80, 58, FONT.tag, '#31e0c8', '#120c22', 0.1, rng);
    tag(g, '渋', 420, y0 + 170, 70, FONT.reggae, '#ff3f7a', '#120c22', -0.1, rng);
    // a character: a round head with headphones
    ellipse(g, 330, y0 + 165, 30, 30, 0, '#ffd8b0'); ellipse(g, 330, y0 + 140, 32, 16, 0, '#1a1a2a');
    ellipse(g, 300, y0 + 165, 9, 14, 0, '#31e0c8'); ellipse(g, 360, y0 + 165, 9, 14, 0, '#31e0c8');
    ellipse(g, 320, y0 + 168, 4, 6, 0, '#120c22'); ellipse(g, 340, y0 + 168, 4, 6, 0, '#120c22');
    g.beginPath(); g.arc(330, y0 + 180, 9, 0.2, Math.PI - 0.2); g.lineWidth = 3; g.strokeStyle = '#120c22'; g.stroke();
    tag(g, 'fm', 60, y0 + 190, 48, FONT.marker, '#ffffff', '#120c22', -0.2, rng);
  }
}

/** Block wall bands: 0–256 plain grey blocks (3.2 m × 1.6 m), 256–512 same with graffiti and a sign. */
function walls(g, S, rng) {
  for (const y0 of [0, 256]) {
    g.fillStyle = '#9b978f'; g.fillRect(0, y0, 512, 256);
    const bw = 64, bh = 32;
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * bw / 2;
      for (let i = -1; i < 9; i++) {
        const t = ['#b3afa7', '#aba79f', '#b8b4ab', '#a7a39b'][Math.floor(rng() * 4)];
        bevelRect(g, i * bw + off + 1.5, y0 + r * bh + 1.5, bw - 3, bh - 3, t, 1.5, 2.5, 0.22, 0.2);
      }
    }
    streaks(g, 0, y0, 512, 256, rng, '#4e4a52', 14, 0.14);
    // moss and damp at the foot
    g.fillStyle = lin(g, 0, y0 + 200, 0, y0 + 256, [[0, 'rgba(80,110,60,0)'], [1, 'rgba(80,110,60,0.45)']]); g.fillRect(0, y0 + 200, 512, 56);
  }
  // graffiti version
  const y0 = 256;
  tag(g, 'KAZE', 150, y0 + 110, 76, FONT.tag, '#3fa8ff', '#1a1430', -0.08, rng);
  tag(g, 'yo!', 300, y0 + 150, 50, FONT.marker, '#ff4f6a', '#1a1430', 0.1, rng);
  tag(g, '夜', 70, y0 + 170, 56, FONT.reggae, '#ffd23f', '#1a1430', 0.12, rng);
  // "no dumping" sign
  g.fillStyle = '#ffffff'; g.fillRect(400, y0 + 46, 84, 112); g.strokeStyle = '#d42a2a'; g.lineWidth = 4; g.strokeRect(402, y0 + 48, 80, 108);
  fitText(g, 'ゴミを', 442, y0 + 74, 70, 20, FONT.jp, { fill: '#d42a2a' });
  fitText(g, '捨てるな', 442, y0 + 98, 74, 20, FONT.jp, { fill: '#d42a2a' });
  fitText(g, '不法投棄は犯罪です', 442, y0 + 128, 74, 11, FONT.jpBold, { fill: '#222' });
  fitText(g, '栄町町内会', 442, y0 + 146, 70, 10, FONT.jpBold, { fill: '#444' });
}

/**
 * Fence bands (tile along u, 2 m per repeat unless noted):
 *   0–144 yakisugi boards (1.8 m) · 144–256 light wood louvres (1.2 m)
 *   256–320 breeze blocks, cutout (0.4 m, 1.6 m repeat) · 320–416 railing panel, cutout (1.0 m)
 *   416–512 bamboo fence (1.2 m)
 */
function fences(g, S, rng) {
  // yakisugi: charred vertical cedar boards with a sheen
  {
    const y0 = 0, h = 144, bw = 512 / 13;
    for (let i = 0; i < 13; i++) {
      const x = i * bw;
      const base = ['#2c2628', '#332b2b', '#29242a'][i % 3];
      g.fillStyle = base; g.fillRect(x, y0, bw, h);
      g.fillStyle = lin(g, x, 0, x + bw, 0, [[0, 'rgba(255,240,230,0.03)'], [0.35, 'rgba(255,240,230,0.13)'], [0.7, 'rgba(255,240,230,0.03)'], [1, 'rgba(0,0,0,0.25)']]); g.fillRect(x, y0, bw, h);
      // charred alligator texture: soft horizontal ticks
      for (let k = 0; k < 9; k++) { const yy = y0 + rng() * h; g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 4, yy, bw - 8, 1.5); g.fillStyle = 'rgba(255,230,210,0.07)'; g.fillRect(x + 4, yy + 1.5, bw - 8, 1); }
      g.fillStyle = '#151216'; g.fillRect(x + bw - 1.5, y0, 1.5, h);
    }
    // battens
    for (const yy of [16, 120]) { g.fillStyle = '#1e1a1e'; g.fillRect(0, yy, 512, 9); g.fillStyle = 'rgba(255,230,210,0.12)'; g.fillRect(0, yy, 512, 2); }
  }
  // light wood louvres
  {
    const y0 = 144, h = 112, n = 11, sh = h / n;
    g.fillStyle = '#4b3628'; g.fillRect(0, y0, 512, h);
    for (let i = 0; i < n; i++) {
      const y = y0 + i * sh;
      g.fillStyle = lin(g, 0, y, 0, y + sh, [[0, '#d7a878'], [0.55, '#c4915f'], [1, '#9b6c45']]); g.fillRect(0, y + 1, 512, sh - 2.5);
      for (let k = 0; k < 6; k++) { const x = rng() * 512; g.fillStyle = 'rgba(120,70,40,0.25)'; g.fillRect(x, y + 3, 30 + rng() * 60, 1); }
    }
    for (const x of [0, 256]) { g.fillStyle = '#7d5638'; g.fillRect(x, y0, 10, h); g.fillStyle = 'rgba(255,230,200,0.2)'; g.fillRect(x, y0, 2, h); }
  }
  // breeze blocks: 4 blocks of 0.4 × 0.2 per 1.6 m, two courses; quatrefoil-in-circle openings
  {
    const y0 = 256, h = 64, bw = 128, bh = 32;
    g.clearRect(0, y0, 512, h);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
      const x = i * bw, y = y0 + r * bh;
      bevelRect(g, x + 1, y + 1, bw - 2, bh - 2, '#d8d2c6', 1.5, 2, 0.25, 0.25);
      for (const cx of [x + bw * 0.25, x + bw * 0.75]) {
        const cy = y + bh / 2;
        g.save(); g.globalCompositeOperation = 'destination-out';
        for (let p = 0; p < 4; p++) ellipse(g, cx + Math.cos(p * Math.PI / 2) * 6.5, cy + Math.sin(p * Math.PI / 2) * 6.5, 6.2, 6.2, 0, '#000');
        g.restore();
        g.beginPath(); g.arc(cx, cy, 13.5, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = 'rgba(80,70,70,0.4)'; g.stroke();
      }
    }
  }
  // railing panel: top & bottom rails, vertical bars, a ring band (white; tint per use)
  {
    const y0 = 320, h = 96;
    g.clearRect(0, y0, 512, h);
    const rail = (y, t) => { g.fillStyle = '#c9ccd2'; g.fillRect(0, y, 512, t); g.fillStyle = '#f6f7f8'; g.fillRect(0, y + 1, 512, t * 0.4); };
    for (let x = 6; x < 512; x += 512 / 16) { g.fillStyle = '#c4c7cd'; g.fillRect(x, y0 + 8, 6, h - 16); g.fillStyle = '#f4f5f7'; g.fillRect(x + 1, y0 + 8, 2, h - 16); }
    for (let k = 0; k < 4; k++) { const cx = k * 128 + 64, cy = y0 + 48; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = '#c9ccd2'; g.stroke(); g.lineWidth = 2; g.strokeStyle = '#f6f7f8'; g.stroke(); }
    rail(y0 + 2, 10); rail(y0 + h - 12, 10);
  }
  // bamboo fence (kenninji-gaki): split bamboo verticals, horizontal ties with rope knots
  {
    const y0 = 416, h = 96, n = 22, bw = 512 / n;
    g.fillStyle = '#6a5a3a'; g.fillRect(0, y0, 512, h);
    for (let i = 0; i < n; i++) {
      const x = i * bw;
      g.fillStyle = lin(g, x, 0, x + bw, 0, [[0, '#a8935a'], [0.4, '#d2c088'], [1, '#8f7a48']]); g.fillRect(x + 0.5, y0, bw - 1, h);
      for (let k = 0; k < 3; k++) { const yy = y0 + 10 + ((i * 7 + k * 31) % 80); g.fillStyle = 'rgba(90,70,40,0.45)'; g.fillRect(x + 1, yy, bw - 2, 1.5); }
    }
    for (const yy of [y0 + 18, y0 + 52, y0 + 82]) {
      g.fillStyle = lin(g, 0, yy - 5, 0, yy + 5, [[0, '#c2ad70'], [0.5, '#e0cf92'], [1, '#8a7444']]); g.fillRect(0, yy - 5, 512, 10);
      for (let x = 12; x < 512; x += 64) { g.fillStyle = '#1e1a1a'; g.fillRect(x, yy - 6, 8, 12); g.fillRect(x - 3, yy - 2, 14, 4); }
    }
  }
}

/**
 * Metal bands: 0–128 corrugated sheet (2.4 m tall, 4 m repeat) · 128–256 crane girder plate (2 m, 4 m)
 * 256–320 hazard stripes (0.5 m, 2 m) · 320–384 painted steel plate (0.5 m, 2 m) · 384–512 roller shutter (2.4 m, 4 m)
 * All painted light so vertex tints set the colour.
 */
function metal(g, S, rng) {
  // corrugated
  {
    const y0 = 0, h = 128, p = 512 / 52;
    for (let x = 0; x < 512; x += p) {
      g.fillStyle = lin(g, x, 0, x + p, 0, [[0, '#d5d8dc'], [0.25, '#f2f4f5'], [0.5, '#c9cdd2'], [0.75, '#a9aeb6'], [1, '#d5d8dc']]); g.fillRect(x, y0, p + 0.5, h);
    }
    streaks(g, 0, y0, 512, h, rng, '#8a5a3a', 10, 0.18);
    g.fillStyle = lin(g, 0, y0 + 96, 0, y0 + 128, [[0, 'rgba(120,70,40,0)'], [1, 'rgba(120,70,40,0.3)']]); g.fillRect(0, y0 + 96, 512, 32);
  }
  // crane girder plate: stiffener ribs every 1 m, bolt rows, grime
  {
    const y0 = 128, h = 128;
    g.fillStyle = '#eceae6'; g.fillRect(0, y0, 512, h);
    for (let x = 0; x < 512; x += 128) { g.fillStyle = 'rgba(70,70,100,0.18)'; g.fillRect(x, y0, 5, h); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x + 5, y0, 2, h); }
    for (const yy of [y0 + 6, y0 + h - 8]) { g.fillStyle = 'rgba(80,80,110,0.25)'; g.fillRect(0, yy, 512, 3); for (let x = 4; x < 512; x += 16) ellipse(g, x, yy + 6, 2, 2, 0, 'rgba(90,90,110,0.5)'); }
    streaks(g, 0, y0, 512, h, rng, '#7a6050', 9, 0.14);
  }
  // hazard stripes
  {
    const y0 = 256, h = 64;
    g.save(); g.beginPath(); g.rect(0, y0, 512, h); g.clip();
    g.fillStyle = '#f5c518'; g.fillRect(0, y0, 512, h);
    g.fillStyle = '#1d1b22';
    for (let x = -128; x < 640; x += 64) poly(g, [[x, y0 + h], [x + 32, y0 + h], [x + 32 + h, y0], [x + h, y0]], '#1d1b22');
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y0, 512, 6);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, y0 + h - 6, 512, 6);
    g.restore();
  }
  // painted steel plate
  {
    const y0 = 320, h = 64;
    g.fillStyle = lin(g, 0, y0, 0, y0 + h, [[0, '#f4f4f2'], [0.2, '#e4e5e6'], [0.85, '#d6d8dc'], [1, '#a8acb4']]); g.fillRect(0, y0, 512, h);
    for (let i = 0; i < 10; i++) { const x = rng() * 512, y = y0 + 8 + rng() * 48; g.fillStyle = 'rgba(90,80,90,0.18)'; g.fillRect(x, y, 10 + rng() * 30, 1.2); }
  }
  // roller shutter
  {
    const y0 = 384, h = 128, n = 20, sh = h / n;
    for (let i = 0; i < n; i++) {
      const y = y0 + i * sh;
      g.fillStyle = lin(g, 0, y, 0, y + sh, [[0, '#f0f1f2'], [0.5, '#d4d7db'], [0.85, '#b8bcc3'], [1, '#8f949d']]); g.fillRect(0, y, 512, sh);
    }
    streaks(g, 0, y0, 512, h, rng, '#6a6070', 8, 0.12);
    g.fillStyle = '#7f848d'; g.fillRect(0, y0 + h - 8, 512, 8);
  }
}

// ───────────────────────────────────── docks ─────────────────────────────────────

const LIVERIES = [
  { body: '#9a3328', dark: '#6e2019', text: 'KUROSHIO', sub: 'LINES', logo: 'wave', id: 'KRLU 412883 2', ink: '#ffffff' },
  { body: '#1f5aa8', dark: '#153f78', text: 'NAMIKAZE', sub: '波風海運', logo: 'circle', id: 'NMZU 270154 6', ink: '#ffffff' },
  { body: '#2f8a5a', dark: '#1f6040', text: 'HOKUSEI', sub: 'SHIPPING', logo: 'star', id: 'HKSU 905517 1', ink: '#ffffff' },
  { body: '#e2741f', dark: '#a85214', text: 'TSUBAME', sub: 'EXPRESS', logo: 'bird', id: 'TSBU 663201 9', ink: '#ffffff' },
];
function corrSide(g, x0, y0, w, h, body, dark, ppm, rng) {
  g.fillStyle = body; g.fillRect(x0, y0, w, h);
  const p = 0.28 * ppm;
  for (let x = x0; x < x0 + w; x += p) {
    g.fillStyle = lin(g, x, 0, x + p, 0, [[0, 'rgba(255,255,255,0.10)'], [0.2, 'rgba(255,255,255,0.18)'], [0.45, 'rgba(0,0,0,0)'], [0.6, 'rgba(20,10,40,0.18)'], [0.9, 'rgba(20,10,40,0.06)'], [1, 'rgba(255,255,255,0.10)']]);
    g.fillRect(x, y0, p, h);
  }
  // top and bottom rails
  g.fillStyle = dark; g.fillRect(x0, y0, w, h * 0.06); g.fillRect(x0, y0 + h * 0.93, w, h * 0.07);
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x0, y0 + h * 0.06, w, 1.5);
  streaks(g, x0, y0 + h * 0.06, w, h * 0.8, rng, '#6a3a20', Math.round(w / 40), 0.16);
}
function liveryLogo(g, kind, x, y, r, col) {
  if (kind === 'wave') { g.beginPath(); g.arc(x, y, r, Math.PI * 0.9, Math.PI * 2.1); g.lineWidth = r * 0.35; g.strokeStyle = col; g.stroke(); ellipse(g, x + r * 0.3, y - r * 0.1, r * 0.25, r * 0.25, 0, col); }
  else if (kind === 'circle') { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.lineWidth = r * 0.25; g.strokeStyle = col; g.stroke(); fitText(g, '波', x, y, r * 1.4, r * 1.2, FONT.jp, { fill: col }); }
  else if (kind === 'star') { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } poly(g, pts, col); }
  else { poly(g, [[x - r, y - r * 0.2], [x, y + r * 0.1], [x + r * 1.1, y - r * 0.7], [x + r * 0.2, y + r * 0.5], [x - r * 0.4, y + r * 0.4]], col); }
}
/** Four container liveries, one 12.2 m × 2.6 m side per 128 px band. */
function containers(g, S, rng) {
  LIVERIES.forEach((L, i) => {
    const y0 = i * 128, ppm = 512 / 12.2;
    corrSide(g, 0, y0, 512, 128, L.body, L.dark, ppm, rng);
    // logo text: drawn squashed horizontally (the band is 42 px/m wide, 49 px/m tall)
    inRect(g, 0, y0, 512, 128, 1220, 260, (q) => {
      liveryLogo(q, L.logo, 250, 130, 52, L.ink);
      q.font = `118px ${FONT.latin}`; q.textAlign = 'left'; q.textBaseline = 'middle'; q.fillStyle = L.ink;
      q.fillText(L.text, 330, 120);
      q.font = `600 46px ${i === 1 ? FONT.jpBold : FONT.latinBold}`; q.fillText(L.sub, 336, 200);
      q.font = `600 26px ${FONT.latinBold}`; q.textAlign = 'right'; q.fillText(L.id, 1180, 40); q.fillText('22G1', 1180, 72);
    }, true);
  });
}

/**
 * st_docks cells: doors of the 4 liveries (0..512 × 0..256, 128 px each, 2.44 × 2.6 m),
 * crane cab front (0,256,128,128), tyre side (128,256,128,128), drum side (256,256,128,128),
 * pallet side (384,256,128,64), quay bollard band (384,320,128,64),
 * keep-out sign (0,384,128,128), terminal name board (128,384,384,128).
 */
function docks(g, S, rng) {
  LIVERIES.forEach((L, i) => {
    const x0 = i * 128, ppm = 128 / 2.44;
    g.fillStyle = L.body; g.fillRect(x0, 0, 128, 256);
    // two doors with vertical corrugation panels
    for (const dx of [0, 64]) {
      bevelRect(g, x0 + dx + 4, 10, 58, 232, L.body, 2, 3, 0.18, 0.3);
      for (let k = 0; k < 4; k++) { const y = 20 + k * 56; g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x0 + dx + 8, y, 50, 46); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x0 + dx + 8, y, 50, 3); }
      // locking bars
      for (const bx of [x0 + dx + 18, x0 + dx + 46]) { g.fillStyle = '#c8ccd2'; g.fillRect(bx - 2, 8, 4, 238); g.fillStyle = '#5a5e66'; g.fillRect(bx + 2, 8, 1.5, 238); g.fillStyle = '#9aa0a8'; g.fillRect(bx - 5, 120, 10, 20); }
    }
    g.fillStyle = L.dark; g.fillRect(x0, 0, 128, 8); g.fillRect(x0, 246, 128, 10); g.fillRect(x0, 0, 5, 256); g.fillRect(x0 + 123, 0, 5, 256);
    g.fillStyle = L.ink; g.font = `600 9px ${FONT.latinBold}`; g.textAlign = 'center'; g.fillText(L.id, x0 + 96, 26);
    liveryLogo(g, L.logo, x0 + 32, 40, 10, L.ink);
    g.fillStyle = '#e8e4d8'; g.fillRect(x0 + 72, 200, 22, 14);
    streaks(g, x0, 8, 128, 230, rng, '#6a3a20', 5, 0.16);
  });
  // crane cab front: windows with an operator silhouette
  {
    const x = 0, y = 256;
    g.fillStyle = '#f0eee8'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#26334a'; g.fillRect(x + 10, y + 14, 108, 64);
    g.fillStyle = lin(g, x, y + 14, x + 60, y + 78, [[0, 'rgba(160,210,255,0.55)'], [0.5, 'rgba(160,210,255,0.1)'], [1, 'rgba(160,210,255,0.3)']]); g.fillRect(x + 10, y + 14, 108, 64);
    ellipse(g, x + 64, y + 56, 10, 11, 0, '#1a2030'); g.fillStyle = '#1a2030'; g.fillRect(x + 50, y + 64, 28, 14);
    g.fillStyle = '#d8d6d0'; g.fillRect(x + 62, y + 14, 4, 64);
    g.fillStyle = '#e2483c'; g.fillRect(x, y + 92, 128, 10);
    fitText(g, 'RTG-07', x + 64, y + 116, 100, 16, FONT.latin, { fill: '#2a2a35' });
  }
  // tyre side (alpha outside the circle)
  {
    const x = 128, y = 256;
    g.clearRect(x, y, 128, 128);
    ellipse(g, x + 64, y + 64, 62, 62, 0, '#24242c');
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; g.save(); g.translate(x + 64 + Math.cos(a) * 56, y + 64 + Math.sin(a) * 56); g.rotate(a); g.fillStyle = '#34343e'; g.fillRect(-3, -6, 6, 12); g.restore(); }
    ellipse(g, x + 64, y + 64, 36, 36, 0, '#3a3a44');
    ellipse(g, x + 64, y + 64, 30, 30, 0, '#d9b23a');
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ellipse(g, x + 64 + Math.cos(a) * 20, y + 64 + Math.sin(a) * 20, 3, 3, 0, '#7a6420'); }
    ellipse(g, x + 64, y + 64, 9, 9, 0, '#8a7428');
    g.beginPath(); g.arc(x + 64, y + 64, 50, Math.PI * 1.1, Math.PI * 1.5); g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
  }
  // oil drum side: blue with rolling hoops (tile around)
  {
    const x = 256, y = 256;
    g.fillStyle = lin(g, x, 0, x + 128, 0, [[0, '#1f4f9a'], [0.3, '#3a74c8'], [0.6, '#2a5fb0'], [1, '#1a447f']]); g.fillRect(x, y, 128, 128);
    for (const yy of [y + 6, y + 44, y + 84, y + 120]) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, yy, 128, 5); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, yy - 2, 128, 2); }
    streaks(g, x, y, 128, 128, rng, '#8a4a20', 6, 0.25);
    fitText(g, 'LUBE OIL', x + 64, y + 64, 90, 16, FONT.latin, { fill: '#ffffff' });
  }
  // pallet side
  {
    const x = 384, y = 256;
    g.clearRect(x, y, 128, 64);
    g.fillStyle = '#c99a5e'; g.fillRect(x, y, 128, 14); g.fillRect(x, y + 50, 128, 14);
    for (const bx of [x, x + 54, x + 108]) { g.fillStyle = '#a77a44'; g.fillRect(bx, y + 14, 20, 36); }
    g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(x, y, 128, 3); g.fillRect(x, y + 50, 128, 3);
  }
  // quay bollard band: black paint with yellow top ring
  {
    const x = 384, y = 320;
    g.fillStyle = '#2a2a32'; g.fillRect(x, y, 128, 64);
    g.fillStyle = '#f5c518'; g.fillRect(x, y, 128, 14);
    streaks(g, x, y + 14, 128, 50, rng, '#9a5a2a', 6, 0.3);
  }
  // keep-out sign
  {
    const x = 0, y = 384;
    g.fillStyle = '#ffffff'; g.fillRect(x + 2, y + 2, 124, 124);
    g.fillStyle = '#d42a2a'; g.fillRect(x + 2, y + 2, 124, 38);
    fitText(g, '立入禁止', x + 64, y + 21, 110, 26, FONT.jp, { fill: '#ffffff' });
    fitText(g, '関係者以外の', x + 64, y + 60, 112, 17, FONT.jp, { fill: '#222' });
    fitText(g, '立入りを禁ず', x + 64, y + 82, 112, 17, FONT.jp, { fill: '#222' });
    fitText(g, 'NO ENTRY', x + 64, y + 108, 100, 15, FONT.latin, { fill: '#d42a2a' });
    g.strokeStyle = '#333'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, 124, 124);
  }
  // terminal name board for crane girders
  {
    const x = 128, y = 384;
    g.fillStyle = '#eceae6'; g.fillRect(x, y, 384, 128);
    g.fillStyle = '#1f5aa8'; g.fillRect(x, y + 100, 384, 28);
    fitText(g, 'KAIGAN', x + 192, y + 36, 360, 52, FONT.latin, { fill: '#1f5aa8' });
    fitText(g, '海岸コンテナターミナル', x + 192, y + 80, 360, 26, FONT.jp, { fill: '#1f5aa8' });
    fitText(g, 'CONTAINER TERMINAL', x + 192, y + 114, 360, 16, FONT.latinBold, { fill: '#ffffff' });
  }
}

// ───────────────────────────────────── trees ─────────────────────────────────────

/** A scalloped "cloud" shape: an ellipse body with bumps around its rim (painted foliage clump). */
export function cloud(g, cx, cy, r, fill, n = 8, sq = 0.82, rng = Math.random) {
  g.beginPath();
  g.ellipse(cx, cy, r * 0.78, r * 0.78 * sq, 0, 0, Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng() * 0.4, rr = r * (0.3 + rng() * 0.16);
    const x = cx + Math.cos(a) * (r - rr) * 1.02, y = cy + Math.sin(a) * (r - rr) * sq;
    g.moveTo(x + rr, y); g.ellipse(x, y, rr, rr * 0.92, 0, 0, Math.PI * 2);
  }
  g.fillStyle = fill; g.fill();
}
/** Painted foliage: overlapping scalloped clumps, each with a shaded underside and a lit crown. */
function foliage(g, S, rng, pal, nClumps, rMin, rMax, extra) {
  g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
  patches(g, S, rng, [pal[0], pal[1]], 14, 60, 140, 0.5);
  const list = [];
  for (let i = 0; i < nClumps; i++) list.push([rng() * S, rng() * S, rMin + rng() * (rMax - rMin), rng() * 1e9]);
  list.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r, sd] of list) {
    wrap9(S, (dx, dy) => {
      const cx = x + dx, cy = y + dy;
      if (cx < -r * 1.5 || cy < -r * 1.5 || cx > S + r * 1.5 || cy > S + r * 1.5) return;
      let a = sd; const rr = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
      cloud(g, cx + r * 0.1, cy + r * 0.16, r * 1.04, pal[0], 9, 0.84, rr);
      cloud(g, cx, cy, r * 0.94, pal[1], 9, 0.82, rr);
      cloud(g, cx - r * 0.2, cy - r * 0.24, r * 0.62, pal[2], 7, 0.8, rr);
      cloud(g, cx - r * 0.34, cy - r * 0.4, r * 0.3, pal[3], 5, 0.75, rr);
      if (extra) extra(g, cx, cy, r, rr);
    });
  }
}
function leaves(g, S, rng) {
  const pal = ['#2c5a2e', '#3f7a35', '#5f9a3e', '#9ccb5a'];
  foliage(g, S, rng, pal, 170, 16, 32, (q, cx, cy, r, rr) => {
    // a few pointed leaves breaking the crown edge
    for (let k = 0; k < 4; k++) { const a = Math.PI * (1.1 + rr() * 0.8), lx = cx + Math.cos(a) * r * 0.9, ly = cy + Math.sin(a) * r * 0.75; ellipse(q, lx, ly, r * 0.17, r * 0.07, a + 1.3, k % 2 ? pal[3] : pal[2]); }
  });
}
function blossom(g, S, rng) {
  const pal = ['#a8628e', '#dc8db0', '#f5bfd3', '#fff1f5'];
  foliage(g, S, rng, pal, 170, 15, 30, (q, cx, cy, r, rr) => {
    // loose petals on the lit side: tiny pale ovals, no dark centres
    for (let k = 0; k < 5; k++) { const px = cx - r * 0.55 + rr() * r * 0.8, py = cy - r * 0.6 + rr() * r * 0.6; ellipse(q, px, py, 2.6, 1.8, rr() * 3, '#ffffff'); }
  });
  // dark twig glimpses between clumps
  g.strokeStyle = 'rgba(80,45,60,0.55)'; g.lineWidth = 2.2; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) { const x = rng() * S, y = rng() * S, a = rng() * 6.28; wrap9(S, (dx, dy) => { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * 22, y + dy + Math.sin(a) * 10); g.stroke(); }); }
}
function needles(g, S, rng) {
  const pal = ['#1b3b34', '#25503f', '#3a6e4c', '#6a9a5a'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
  patches(g, S, rng, [pal[1]], 10, 60, 120, 0.6);
  for (let i = 0; i < 120; i++) {
    const x = rng() * S, y = rng() * S, r = 20 + rng() * 18;
    wrap9(S, (dx, dy) => {
      const cx = x + dx, cy = y + dy;
      if (cx < -r * 2 || cy < -r * 2 || cx > S + r * 2 || cy > S + r * 2) return;
      ellipse(g, cx, cy + r * 0.15, r, r * 0.6, 0, pal[1]);
      g.lineCap = 'round';
      for (let k = 0; k < 22; k++) {
        const a = Math.PI * (1.05 + (k / 21) * 0.9), l = r * (0.8 + rng() * 0.4);
        g.strokeStyle = k % 3 === 0 ? pal[3] : pal[2]; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy + r * 0.2); g.lineTo(cx + Math.cos(a) * l, cy + r * 0.2 + Math.sin(a) * l * 0.7); g.stroke();
      }
    });
  }
}
function bark(g, S, rng) {
  g.fillStyle = '#6f625a'; g.fillRect(0, 0, S, S);
  patches(g, S, rng, ['#5a4e48', '#857668'], 16, 40, 100, 0.5);
  for (let i = 0; i < 70; i++) {
    const x = rng() * S, y = rng() * S, l = 40 + rng() * 120, w = 4 + rng() * 8;
    wrap9(S, (dx, dy) => {
      g.fillStyle = lin(g, x + dx, 0, x + dx + w, 0, [[0, 'rgba(50,40,40,0.5)'], [0.5, 'rgba(50,40,40,0.15)'], [1, 'rgba(160,150,140,0.25)']]);
      rrect(g, x + dx, y + dy, w, l, w / 2); g.fill();
    });
  }
  // lenticel bands (cherry-like) faintly
  for (let i = 0; i < 14; i++) { const y = rng() * S, x = rng() * S; wrap9(S, (dx, dy) => { g.fillStyle = 'rgba(200,190,170,0.18)'; rrect(g, x + dx, y + dy, 30 + rng() * 40, 3, 1.5); g.fill(); }); }
}

/**
 * st_cards: alpha-cutout cards, 256 px quadrants: leaf cluster (0,0), blossom cluster (256,0),
 * pine tuft (0,256), grass/weed tuft (256,256).
 */
function cards(g, S, rng) {
  g.clearRect(0, 0, S, S);
  const cluster = (x0, y0, pal, flowers) => {
    g.save(); g.beginPath(); g.rect(x0, y0, 256, 256); g.clip();
    const pts = [];
    for (let i = 0; i < 24; i++) { const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 78; pts.push([x0 + 128 + Math.cos(a) * d, y0 + 128 + Math.sin(a) * d * 0.85, 22 + rng() * 18]); }
    pts.sort((a, b) => a[1] - b[1]);
    for (const [x, y, r] of pts) {
      cloud(g, x + 3, y + 5, r, pal[0], 9, 0.84, rng);
      cloud(g, x, y, r * 0.92, pal[1], 9, 0.82, rng);
      cloud(g, x - r * 0.2, y - r * 0.24, r * 0.6, pal[2], 7, 0.8, rng);
      cloud(g, x - r * 0.34, y - r * 0.4, r * 0.28, pal[3], 5, 0.75, rng);
      if (flowers) for (let k = 0; k < 5; k++) ellipse(g, x - r * 0.5 + rng() * r * 0.8, y - r * 0.6 + rng() * r * 0.6, 3, 2.1, rng() * 3, '#ffffff');
      else for (let k = 0; k < 3; k++) { const b = Math.PI * (1.1 + rng() * 0.8); ellipse(g, x + Math.cos(b) * r * 0.9, y + Math.sin(b) * r * 0.75, r * 0.18, r * 0.07, b + 1.3, pal[3]); }
    }
    g.restore();
  };
  cluster(0, 0, ['#2c5a2e', '#3f7a35', '#5f9a3e', '#9ccb5a'], false);
  cluster(256, 0, ['#a8628e', '#dc8db0', '#f5bfd3', '#fff1f5'], true);
  // pine tuft: radial needle bursts
  {
    const x0 = 0, y0 = 256;
    g.save(); g.beginPath(); g.rect(x0, y0, 256, 256); g.clip();
    for (let i = 0; i < 9; i++) {
      const cx = x0 + 60 + rng() * 136, cy = y0 + 80 + rng() * 100, r = 40 + rng() * 26;
      ellipse(g, cx, cy + 8, r * 0.75, r * 0.38, 0, '#1b3b34');
      g.lineCap = 'round';
      for (let k = 0; k < 40; k++) {
        const a = Math.PI * (0.98 + (k / 39) * 1.04), l = r * (0.7 + rng() * 0.35);
        g.strokeStyle = k % 4 === 0 ? '#6a9a5a' : (k % 2 ? '#3a6e4c' : '#25503f'); g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx, cy + 10); g.lineTo(cx + Math.cos(a) * l, cy + 10 + Math.sin(a) * l * 0.6); g.stroke();
      }
    }
    g.restore();
  }
  // grass / weed tuft rising from the bottom edge
  {
    const x0 = 256, y0 = 256;
    g.save(); g.beginPath(); g.rect(x0, y0, 256, 256); g.clip();
    const cols = ['#4f7a30', '#6a9a3a', '#86b24a', '#a3c45a', '#b8b866'];
    for (let i = 0; i < 46; i++) {
      const bx = x0 + 30 + rng() * 196, l = 90 + rng() * 140, lean = (rng() - 0.5) * 120, w = 5 + rng() * 4;
      g.beginPath(); g.moveTo(bx - w, y0 + 256); g.quadraticCurveTo(bx + lean * 0.3, y0 + 256 - l * 0.6, bx + lean, y0 + 256 - l); g.quadraticCurveTo(bx + lean * 0.3 + w * 0.3, y0 + 256 - l * 0.5, bx + w, y0 + 256); g.closePath();
      g.fillStyle = cols[i % cols.length]; g.fill();
    }
    for (let i = 0; i < 4; i++) { const fx = x0 + 60 + rng() * 140, fy = y0 + 70 + rng() * 60; for (let p = 0; p < 5; p++) ellipse(g, fx + Math.cos(p * 1.2566) * 6, fy + Math.sin(p * 1.2566) * 6, 5, 5, 0, i % 2 ? '#f6f3e6' : '#f2d24a'); ellipse(g, fx, fy, 3, 3, 0, '#e8a020'); }
    g.restore();
  }
}

// ──────────────────────────────────── prop atlases ───────────────────────────────────

function vendFront(g, x, y, w, h, body, accent, brand, brandFont, rng, emit) {
  // body
  if (!emit) {
    g.fillStyle = body; g.fillRect(x, y, w, h);
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, 'rgba(0,0,0,0.1)'], [0.1, 'rgba(255,255,255,0.15)'], [0.9, 'rgba(255,255,255,0.05)'], [1, 'rgba(0,0,0,0.15)']]); g.fillRect(x, y, w, h);
  } else { g.fillStyle = '#000'; g.fillRect(x, y, w, h); }
  // display window with 3 rows of drinks
  const dx = x + 8, dy = y + 22, dw = w - 16, dh = h * 0.46;
  g.fillStyle = emit ? '#cfe6ff' : '#e9f2f6'; g.fillRect(dx, dy, dw, dh);
  const cols = ['#e2483c', '#2e7fd0', '#f2c230', '#2fa86a', '#f08a2a', '#ffffff', '#6a4ab0', '#1a1a2a'];
  for (let r = 0; r < 3; r++) {
    const ry = dy + 6 + r * (dh - 8) / 3;
    for (let k = 0; k < 7; k++) {
      const cx = dx + 6 + k * (dw - 12) / 6.5, c = cols[Math.floor(rng() * cols.length)];
      const ch = (dh - 8) / 3 - 14;
      g.fillStyle = emit ? mix(c, '#ffffff', 0.4) : c; rrect(g, cx, ry, 9.5, ch, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(cx + 2, ry + 3, 2, ch - 6);
      // price button
      g.fillStyle = emit ? '#7fe0ff' : '#2a2a35'; g.fillRect(cx, ry + ch + 2, 9.5, 4);
    }
  }
  if (emit) return;
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(dx, dy, dw, 3);
  // brand header
  g.fillStyle = accent; g.fillRect(x + 4, y + 4, w - 8, 16);
  fitText(g, brand, x + w / 2, y + 12.5, w - 14, 13, brandFont, { fill: '#ffffff' });
  // coin slot panel + bill, dispenser
  const py = dy + dh + 8;
  g.fillStyle = shade(body, 0.85); g.fillRect(x + w - 34, py, 26, 44);
  g.fillStyle = '#1a1a22'; g.fillRect(x + w - 26, py + 6, 10, 3); g.fillRect(x + w - 30, py + 16, 18, 4);
  g.fillStyle = '#4ee08a'; g.fillRect(x + w - 30, py + 26, 18, 7);
  g.fillStyle = '#20202a'; g.fillRect(x + 12, y + h - 46, w - 24, 26);
  g.fillStyle = shade(body, 0.75); g.fillRect(x + 14, y + h - 44, w - 28, 10);
  // advert graphic on the lower panel
  ellipse(g, x + 36, py + 22, 18, 18, 0, accent);
  fitText(g, 'つめた〜い', x + 40, py + 22, 34, 9, FONT.jpBold, { fill: '#ffffff' });
  g.fillStyle = '#1a1a22'; g.fillRect(x, y + h - 8, w, 8);
}

/**
 * st_props_a cells (x, y, w, h) — see ATLAS in street.ts.
 */
export const PROPS_A = {
  vend_red: [0, 0, 128, 232], vend_blue: [128, 0, 128, 232], vend_coffee: [256, 0, 128, 232], phone: [384, 0, 128, 232],
  bus_disc: [0, 232, 128, 128], timetable: [128, 232, 64, 128], postbox: [192, 232, 64, 128], coinp_sign: [256, 232, 128, 128], coinp_board: [384, 232, 128, 128],
  payment: [0, 360, 64, 128], lens_warm: [64, 360, 64, 64], lens_red: [64, 424, 32, 32], lens_amber: [96, 424, 32, 32],
  ped_red: [128, 360, 64, 128], ped_green: [192, 360, 64, 128], mirror: [256, 360, 128, 128], forsale: [384, 360, 128, 96],
  hydrant: [384, 456, 64, 56], button: [448, 456, 64, 56], lens_cool: [64, 456, 32, 32], lens_white: [96, 456, 32, 32],
  recycle: [0, 488, 64, 24], grey: [64, 488, 64, 24],
};

function propsA(g, S, rng) {
  const P = PROPS_A;
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  vendFront(g, ...P.vend_red, '#d8282e', '#ffffff', 'KOOL!', FONT.bungee, rngClone(rng, 1), false);
  // fix brand text colour on white accent
  { const [x, y, w] = P.vend_red; g.fillStyle = '#ffffff'; g.fillRect(x + 4, y + 4, w - 8, 16); fitText(g, 'KOOL!', x + w / 2, y + 12.5, w - 14, 13, FONT.bungee, { fill: '#d8282e' }); }
  vendFront(g, ...P.vend_blue, '#f2f4f6', '#1f6fd0', 'AQUA 水', FONT.jp, rngClone(rng, 2), false);
  vendFront(g, ...P.vend_coffee, '#3a2a24', '#c8962e', 'BOSSA COFFEE', FONT.latin, rngClone(rng, 3), false);
  // phone booth panel: glass with the green phone, top sign
  {
    const [x, y, w, h] = P.phone;
    g.fillStyle = '#e8ecef'; g.fillRect(x, y, w, h);
    g.fillStyle = '#2f9a5a'; g.fillRect(x, y, w, 34);
    fitText(g, '公衆電話', x + w / 2, y + 17, w - 16, 22, FONT.jp, { fill: '#ffffff' });
    g.fillStyle = '#9fc4d8'; g.fillRect(x + 8, y + 40, w - 16, h - 56);
    g.fillStyle = lin(g, x, y + 40, x + w, y + h, [[0, 'rgba(255,255,255,0.45)'], [0.35, 'rgba(255,255,255,0.05)'], [0.6, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(x + 8, y + 40, w - 16, h - 56);
    // the phone
    g.fillStyle = '#3aa86a'; g.fillRect(x + 38, y + 92, 52, 56); g.fillStyle = '#2a7a4a'; g.fillRect(x + 38, y + 140, 52, 8);
    g.fillStyle = '#1e5a36'; rrect(g, x + 42, y + 84, 44, 12, 5); g.fill();
    g.fillStyle = '#e8f0e8'; g.fillRect(x + 46, y + 102, 20, 12);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { g.fillStyle = '#ffffff'; g.fillRect(x + 70 + i * 6, y + 100 + j * 9, 4, 6); }
    g.fillStyle = '#c4c8cc'; g.fillRect(x + 32, y + 150, 64, 8);
    g.fillStyle = '#b8bec4'; g.fillRect(x, y + h - 16, w, 16);
    g.fillStyle = '#9aa0a6'; g.fillRect(x + w / 2 - 2, y + 40, 4, h - 56);
  }
  // bus stop disc
  {
    const [x, y] = P.bus_disc;
    g.fillStyle = '#ffffff'; g.fillRect(x, y, 128, 128);
    ellipse(g, x + 64, y + 64, 62, 62, 0, '#1f5aa8'); ellipse(g, x + 64, y + 64, 55, 55, 0, '#ffffff');
    g.fillStyle = '#1f5aa8'; g.fillRect(x + 12, y + 48, 104, 32);
    fitText(g, '港町二丁目', x + 64, y + 64, 96, 20, FONT.jp, { fill: '#ffffff' });
    fitText(g, '市営バス', x + 64, y + 30, 70, 15, FONT.jp, { fill: '#1f5aa8' });
    fitText(g, 'BUS STOP', x + 64, y + 96, 70, 12, FONT.latin, { fill: '#1f5aa8' });
  }
  // timetable
  {
    const [x, y, w, h] = P.timetable;
    g.fillStyle = '#f6f6f2'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1f5aa8'; g.fillRect(x, y, w, 16); fitText(g, '時刻表', x + w / 2, y + 8, w - 8, 11, FONT.jp, { fill: '#fff' });
    for (let r = 0; r < 12; r++) { g.fillStyle = r % 2 ? '#e4e8f0' : '#f6f6f2'; g.fillRect(x + 2, y + 18 + r * 9, w - 4, 9); g.fillStyle = '#2a2a35'; g.font = `600 7px ${FONT.latinBold}`; g.textAlign = 'left'; g.fillText(String(6 + r), x + 4, y + 25 + r * 9); for (let k = 0; k < 4; k++) g.fillRect(x + 18 + k * 10, y + 21 + r * 9, 6, 3); }
  }
  // post box front (red, 〒 and slot)
  {
    const [x, y, w, h] = P.postbox;
    g.fillStyle = '#d8282e'; g.fillRect(x, y, w, h);
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, 'rgba(0,0,0,0.15)'], [0.3, 'rgba(255,255,255,0.18)'], [1, 'rgba(0,0,0,0.2)']]); g.fillRect(x, y, w, h);
    g.fillStyle = '#1a1a1e'; g.fillRect(x + 8, y + 22, w - 16, 7);
    g.fillStyle = '#ffffff'; g.fillRect(x + 10, y + 40, w - 20, 30);
    fitText(g, '〒', x + w / 2, y + 55, 30, 26, FONT.jp, { fill: '#d8282e' });
    fitText(g, '郵便', x + w / 2, y + 86, w - 14, 14, FONT.jp, { fill: '#ffffff' });
    fitText(g, 'POST', x + w / 2, y + 102, w - 14, 10, FONT.latin, { fill: '#ffffff' });
    g.fillStyle = '#b01e24'; g.fillRect(x + 6, y + 110, w - 12, 12);
  }
  // coin parking sign (square: big P, brand)
  {
    const [x, y] = P.coinp_sign;
    g.fillStyle = '#f5c518'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#1f3f8a'; rrect(g, x + 14, y + 10, 100, 82, 12); g.fill();
    fitText(g, 'P', x + 64, y + 53, 70, 78, FONT.latin, { fill: '#ffffff' });
    fitText(g, 'ハッピーパーク', x + 64, y + 104, 116, 15, FONT.jp, { fill: '#1f3f8a' });
    fitText(g, '24H', x + 64, y + 120, 60, 10, FONT.latin, { fill: '#1f3f8a' });
  }
  // coin parking board: 空 / 満 lit panel + price
  {
    const [x, y] = P.coinp_board;
    g.fillStyle = '#1f3f8a'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#0c1430'; g.fillRect(x + 10, y + 10, 50, 50); fitText(g, '空', x + 35, y + 36, 44, 40, FONT.jp, { fill: '#38e070' });
    g.fillStyle = '#0c1430'; g.fillRect(x + 68, y + 10, 50, 50); fitText(g, '満', x + 93, y + 36, 44, 40, FONT.jp, { fill: '#4a2a2e' });
    g.fillStyle = '#ffffff'; g.fillRect(x + 8, y + 68, 112, 52);
    fitText(g, '30分 ¥200', x + 64, y + 84, 104, 18, FONT.jp, { fill: '#1f3f8a' });
    fitText(g, '最大料金 ¥1,200', x + 64, y + 106, 104, 13, FONT.jp, { fill: '#d42a2a' });
  }
  // payment machine
  {
    const [x, y, w, h] = P.payment;
    g.fillStyle = '#e8eaee'; g.fillRect(x, y, w, h);
    g.fillStyle = '#f5c518'; g.fillRect(x, y, w, 16); fitText(g, '精算機', x + w / 2, y + 8, w - 8, 11, FONT.jp, { fill: '#1f3f8a' });
    g.fillStyle = '#16303a'; g.fillRect(x + 8, y + 22, w - 16, 26); g.fillStyle = '#5ae0c0'; g.font = `600 9px ${FONT.latinBold}`; g.textAlign = 'center'; g.fillText('No. 3   ¥400', x + w / 2, y + 38);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { g.fillStyle = '#c8ccd4'; g.fillRect(x + 12 + i * 14, y + 54 + j * 10, 10, 7); }
    g.fillStyle = '#2a2a35'; g.fillRect(x + 12, y + 90, 40, 5); g.fillRect(x + 16, y + 104, 32, 10);
  }
  // lenses: warm, red, amber, cool, white — soft radial glows
  const lens = (r, c0, c1) => { const [x, y, w, h] = r; g.fillStyle = c1; g.fillRect(x, y, w, h); const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.7); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  lens(P.lens_warm, '#ffe2a0', '#f0b860'); lens(P.lens_red, '#ff6a5a', '#c8202a'); lens(P.lens_amber, '#ffc04a', '#e08a1a'); lens(P.lens_cool, '#e4f0ff', '#a8c8f0'); lens(P.lens_white, '#ffffff', '#e8eef4');
  // pedestrian signal faces: two lamps; red-lit and green-lit versions
  const ped = (r, redOn) => {
    const [x, y, w, h] = r;
    g.fillStyle = '#2a2c34'; g.fillRect(x, y, w, h);
    for (const [cy, on, col] of [[y + 32, redOn, '#ff3a3a'], [y + 96, !redOn, '#3affb0']]) {
      ellipse(g, x + 32, cy, 27, 27, 0, '#14151a');
      if (on) { const gr = g.createRadialGradient(x + 32, cy, 0, x + 32, cy, 27); gr.addColorStop(0, mix(col, '#ffffff', 0.25)); gr.addColorStop(1, col); g.fillStyle = gr; g.beginPath(); g.arc(x + 32, cy, 25, 0, Math.PI * 2); g.fill(); }
      const fig = on ? '#ffffff' : '#3a3c44';
      // figure: standing (red) or walking (green)
      ellipse(g, x + 32, cy - 13, 4.5, 4.5, 0, on ? mix(col, '#ffffff', 0.7) : fig);
      g.strokeStyle = on ? mix(col, '#ffffff', 0.7) : fig; g.lineWidth = 6; g.lineCap = 'round';
      if (col === '#ff3a3a') { g.beginPath(); g.moveTo(x + 32, cy - 6); g.lineTo(x + 32, cy + 6); g.moveTo(x + 29, cy + 6); g.lineTo(x + 29, cy + 17); g.moveTo(x + 35, cy + 6); g.lineTo(x + 35, cy + 17); g.moveTo(x + 26, cy - 4); g.lineTo(x + 25, cy + 7); g.moveTo(x + 38, cy - 4); g.lineTo(x + 39, cy + 7); g.stroke(); }
      else { g.beginPath(); g.moveTo(x + 32, cy - 6); g.lineTo(x + 31, cy + 5); g.lineTo(x + 25, cy + 16); g.moveTo(x + 31, cy + 5); g.lineTo(x + 38, cy + 16); g.moveTo(x + 32, cy - 4); g.lineTo(x + 24, cy + 3); g.moveTo(x + 32, cy - 4); g.lineTo(x + 39, cy + 2); g.stroke(); }
    }
  };
  ped(P.ped_red, true); ped(P.ped_green, false);
  // curve mirror face: convex mirror with a painted reflected street and orange rim
  {
    const [x, y] = P.mirror, cx = x + 64, cy = y + 64;
    g.fillStyle = '#f07a20'; g.fillRect(x, y, 128, 128);
    ellipse(g, cx, cy, 62, 62, 0, '#f07a20');
    g.save(); g.beginPath(); g.arc(cx, cy, 54, 0, Math.PI * 2); g.clip();
    g.fillStyle = lin(g, 0, y, 0, y + 128, [[0, '#9fd0f0'], [0.45, '#d8eef8'], [0.5, '#8a8c96'], [1, '#5a5c66']]); g.fillRect(x, y, 128, 128);
    // reflected road curving away, a wall and a pole (barrel distorted)
    poly(g, [[cx - 54, cy + 54], [cx + 54, cy + 54], [cx + 14, cy + 4], [cx - 6, cy + 4]], '#4a4b55');
    g.strokeStyle = '#f2f2ea'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 40, cy + 54); g.quadraticCurveTo(cx - 8, cy + 20, cx - 4, cy + 5); g.stroke();
    poly(g, [[cx - 64, cy + 30], [cx - 18, cy + 4], [cx - 18, cy - 14], [cx - 64, cy - 30]], '#c9a87a');
    poly(g, [[cx + 64, cy + 20], [cx + 26, cy + 4], [cx + 26, cy - 22], [cx + 64, cy - 40]], '#e8e2d4');
    g.fillStyle = '#2a2c34'; g.fillRect(cx + 34, cy - 50, 4, 60);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(cx - 22, cy - 26, 26, 12, -0.6, 0, Math.PI * 2); g.fill();
    g.restore();
    g.beginPath(); g.arc(cx, cy, 55, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#a84a10'; g.stroke();
  }
  // for-sale board 売地
  {
    const [x, y, w, h] = P.forsale;
    g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h);
    g.fillStyle = '#d42a2a'; g.fillRect(x, y, 46, h);
    fitText(g, '売', x + 23, y + 26, 40, 36, FONT.jp, { fill: '#ffffff' });
    fitText(g, '地', x + 23, y + 68, 40, 36, FONT.jp, { fill: '#ffffff' });
    fitText(g, '142.5㎡', x + 87, y + 18, 74, 16, FONT.jp, { fill: '#222' });
    fitText(g, '建築条件なし', x + 87, y + 40, 76, 12, FONT.jpBold, { fill: '#d42a2a' });
    g.fillStyle = '#1f5aa8'; g.fillRect(x + 50, y + 54, 74, 38);
    fitText(g, '若葉不動産', x + 87, y + 66, 70, 12, FONT.jp, { fill: '#ffffff' });
    fitText(g, '0120-71-8800', x + 87, y + 82, 70, 11, FONT.latin, { fill: '#ffffff' });
  }
  // hydrant sign 消火栓
  {
    const [x, y, w, h] = P.hydrant;
    g.fillStyle = '#d42a2a'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    fitText(g, '消火栓', x + w / 2, y + h * 0.42, w - 12, 20, FONT.jp, { fill: '#ffffff' });
    fitText(g, 'HYDRANT', x + w / 2, y + h * 0.78, w - 14, 9, FONT.latin, { fill: '#ffffff' });
  }
  // push-button box face
  {
    const [x, y, w, h] = P.button;
    g.fillStyle = '#f5c518'; g.fillRect(x, y, w, h);
    fitText(g, '押ボタン式', x + w / 2, y + 10, w - 8, 10, FONT.jp, { fill: '#222' });
    ellipse(g, x + w / 2, y + 30, 11, 11, 0, '#d42a2a'); ellipse(g, x + w / 2 - 2, y + 28, 5, 4, 0, '#ff8a80');
    fitText(g, 'おしてください', x + w / 2, y + 48, w - 8, 8, FONT.jpBold, { fill: '#222' });
  }
  // recycle bin front (two round holes)
  { const [x, y, w, h] = P.recycle; g.fillStyle = '#2e7fd0'; g.fillRect(x, y, w, h); ellipse(g, x + 18, y + 10, 7, 7, 0, '#101420'); ellipse(g, x + 46, y + 10, 7, 7, 0, '#101420'); fitText(g, 'あきかん', x + w / 2, y + 20, w - 6, 6, FONT.jpBold, { fill: '#fff' }); }
  { const [x, y, w, h] = P.grey; g.fillStyle = '#9da2aa'; g.fillRect(x, y, w, h); }
}
export function propsAEmit(g, S) {
  const P = PROPS_A, k = S / 512;
  g.save(); g.scale(k, k);
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  const r = rngFor0();
  vendFront(g, ...P.vend_red, '#000', '#000', '', FONT.latin, r, true);
  vendFront(g, ...P.vend_blue, '#000', '#000', '', FONT.latin, r, true);
  vendFront(g, ...P.vend_coffee, '#000', '#000', '', FONT.latin, r, true);
  { const [x, y, w, h] = P.vend_red; g.fillStyle = '#ffffff'; g.fillRect(x + 4, y + 4, w - 8, 16); }
  { const [x, y, w] = P.vend_blue; g.fillStyle = '#5aa0ff'; g.fillRect(x + 4, y + 4, w - 8, 16); }
  { const [x, y, w] = P.vend_coffee; g.fillStyle = '#ffc860'; g.fillRect(x + 4, y + 4, w - 8, 16); }
  { const [x, y, w, h] = P.phone; g.fillStyle = '#8ad8aa'; g.fillRect(x + 8, y + 40, w - 16, h - 56); g.fillStyle = '#5aff9a'; g.fillRect(x, y, w, 34); }
  { const [x, y] = P.coinp_sign; g.fillStyle = '#ffd84a'; g.fillRect(x, y, 128, 128); g.fillStyle = '#3a6aff'; rrect(g, x + 14, y + 10, 100, 82, 12); g.fill(); fitText(g, 'P', x + 64, y + 53, 70, 78, FONT.latin, { fill: '#ffffff' }); }
  { const [x, y] = P.coinp_board; fitText(g, '空', x + 35, y + 36, 44, 40, FONT.jp, { fill: '#38ff70' }); g.fillStyle = '#ffffff'; g.fillRect(x + 8, y + 68, 112, 52); }
  { const [x, y, w] = P.payment; g.fillStyle = '#5ae0c0'; g.fillRect(x + 8, y + 22, w - 16, 26); }
  for (const [n, c] of [['lens_warm', '#ffe2a8'], ['lens_red', '#ff4a3a'], ['lens_amber', '#ffb030'], ['lens_cool', '#e8f2ff'], ['lens_white', '#ffffff']]) { const [x, y, w, h] = P[n]; g.fillStyle = c; g.fillRect(x, y, w, h); }
  { const [x, y] = P.ped_red; ellipse(g, x + 32, y + 32, 25, 25, 0, '#ff3a3a'); }
  { const [x, y] = P.ped_green; ellipse(g, x + 32, y + 96, 25, 25, 0, '#3affb0'); }
  g.restore();
}
function rngFor0() { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
function rngClone(rng, k) { let a = Math.floor(rng() * 1e9) + k; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

/** st_props_b cells — see ATLAS in street.ts. */
export const PROPS_B = {
  ad_soda: [0, 0, 128, 224], ad_radio: [128, 0, 128, 224], pole_ad_dent: [256, 0, 64, 224], pole_ad_clinic: [320, 0, 64, 224],
  garbage_sign: [384, 0, 128, 96], cone: [384, 96, 64, 128], addr: [448, 96, 64, 32], shrine_paper: [448, 128, 64, 96],
  phone_top: [0, 224, 128, 32], garbage_net: [128, 224, 128, 128], chochin: [256, 224, 64, 96], lantern_win: [320, 224, 64, 64],
  shed_window: [384, 224, 64, 64], shed_door: [448, 224, 64, 128], cabinet: [320, 288, 64, 96], barrier_lamp: [384, 288, 64, 32],
  wood: [0, 256, 128, 64], stone: [0, 320, 128, 64], board_back: [128, 352, 128, 32], pole_band: [256, 320, 64, 64],
  transformer: [0, 384, 128, 128], ad_shelter_roof: [128, 384, 128, 32], bench_seat: [128, 416, 128, 32], works_light: [256, 384, 64, 64],
  rope: [320, 384, 192, 16], rubber: [320, 400, 192, 16], bike_basket: [320, 416, 96, 48], bike_wheel: [416, 416, 96, 96], tarp: [128, 448, 128, 64], plant_pot: [256, 448, 64, 64], sake_crate: [320, 464, 96, 48],
};
/** The two back-lit ads (albedo and, dimmed, emissive use the same art). */
function adArt(g, P, rng) {
  // back-lit ad: fictional soda
  {
    const [x, y, w, h] = P.ad_soda;
    g.fillStyle = lin(g, x, y, x, y + h, [[0, '#2fc8ff'], [1, '#1a5ad8']]); g.fillRect(x, y, w, h);
    for (let i = 0; i < 12; i++) ellipse(g, x + rng() * w, y + rng() * h, 3 + rng() * 6, 3 + rng() * 6, 0, 'rgba(255,255,255,0.35)');
    rrect(g, x + 38, y + 60, 52, 100, 10); g.fillStyle = '#f4f6f8'; g.fill();
    g.fillStyle = '#1a8ae8'; g.fillRect(x + 38, y + 90, 52, 36); fitText(g, 'NAMI', x + 64, y + 108, 46, 18, FONT.bungee, { fill: '#fff' });
    fitText(g, '波ソーダ', x + 64, y + 34, 110, 30, FONT.pop, { fill: '#ffffff', stroke: '#0a3a8a', strokeWidth: 5 });
    fitText(g, 'しゅわっと、夏。', x + 64, y + 190, 110, 16, FONT.jp, { fill: '#ffffff' });
  }
  // back-lit ad: DRIVE FM 88.5
  {
    const [x, y, w, h] = P.ad_radio;
    g.fillStyle = lin(g, x, y, x, y + h, [[0, '#2a1a5a'], [0.6, '#e2487a'], [1, '#ffb05a']]); g.fillRect(x, y, w, h);
    ellipse(g, x + 64, y + 150, 44, 44, 0, '#ffd45a');
    g.fillStyle = '#2a1a5a'; for (let i = 0; i < 5; i++) g.fillRect(x + 20, y + 150 + i * 9, 88, 4);
    fitText(g, 'DRIVE', x + 64, y + 46, 112, 34, FONT.bungee, { fill: '#ffffff' });
    tag(g, 'FM', x + 64, y + 90, 52, FONT.tag, '#31e0c8', '#1a0a2a', -0.1, rng);
    fitText(g, '88.5 MHz', x + 64, y + 206, 100, 16, FONT.latin, { fill: '#ffffff' });
  }
}
const seeded = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
function propsB(g, S, rng) {
  const P = PROPS_B;
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  adArt(g, P, seeded(0xad5));
  // pole ads (電柱広告): yellow dentist, blue clinic — vertical text
  const vtext = (x, y, w, h, bg, fg, lines, arrow) => {
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = fg; g.fillRect(x + 3, y + 3, w - 6, 2); g.fillRect(x + 3, y + h - 5, w - 6, 2);
    let yy = y + 20;
    for (const ch of lines[0]) { fitText(g, ch, x + w / 2, yy, w - 14, 24, FONT.jp, { fill: fg }); yy += 25; }
    yy += 4;
    fitText(g, lines[1], x + w / 2, yy, w - 8, 10, FONT.jpBold, { fill: fg });
    if (arrow) { poly(g, [[x + w / 2 - 14, y + h - 30], [x + w / 2 + 6, y + h - 30], [x + w / 2 + 6, y + h - 38], [x + w / 2 + 18, y + h - 24], [x + w / 2 + 6, y + h - 10], [x + w / 2 + 6, y + h - 18], [x + w / 2 - 14, y + h - 18]], fg); }
  };
  vtext(...P.pole_ad_dent, '#f5d21a', '#1a1a22', ['さくら歯科', 'この先50m'], true);
  vtext(...P.pole_ad_clinic, '#1f5aa8', '#ffffff', ['みなと内科', '駐車場有'], true);
  // garbage station sign
  {
    const [x, y, w, h] = P.garbage_sign;
    g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h);
    g.fillStyle = '#2f8a5a'; g.fillRect(x, y, w, 26); fitText(g, 'ゴミ集積所', x + w / 2, y + 13, w - 12, 18, FONT.jp, { fill: '#fff' });
    const rows = [['燃えるゴミ', '月・木'], ['資源ゴミ', '水'], ['不燃ゴミ', '第2金']];
    rows.forEach(([a, b], i) => { fitText(g, a, x + 36, y + 40 + i * 19, 64, 12, FONT.jpBold, { fill: '#222' }); fitText(g, b, x + 96, y + 40 + i * 19, 50, 12, FONT.jpBold, { fill: '#d42a2a' }); });
  }
  // traffic cone surface: orange-red with two white reflective bands (v along the cone)
  { const [x, y, w, h] = P.cone; g.fillStyle = '#f0522a'; g.fillRect(x, y, w, h); g.fillStyle = '#f4f4f0'; g.fillRect(x, y + 24, w, 22); g.fillRect(x, y + 66, w, 18); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x, y, 10, h); }
  // address plate
  { const [x, y, w, h] = P.addr; g.fillStyle = '#1f5aa8'; g.fillRect(x, y, w, h); fitText(g, '栄町2丁目', x + w / 2, y + h / 2, w - 6, 13, FONT.jp, { fill: '#fff' }); }
  // shrine paper streamers (shide) on white
  { const [x, y, w, h] = P.shrine_paper; g.fillStyle = '#f6f2e8'; g.fillRect(x, y, w, h); for (let k = 0; k < 4; k++) { g.strokeStyle = '#c8c0b0'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 8 + k * 14, y + 8); g.lineTo(x + 18 + k * 14, y + 30); g.lineTo(x + 8 + k * 14, y + 52); g.lineTo(x + 18 + k * 14, y + 74); g.stroke(); } }
  // phone booth top sign strip
  { const [x, y, w, h] = P.phone_top; g.fillStyle = '#2f9a5a'; g.fillRect(x, y, w, h); fitText(g, '公衆電話', x + w / 2, y + h / 2, w - 10, 22, FONT.jp, { fill: '#fff' }); }
  // green garbage net (cutout)
  {
    const [x, y, w, h] = P.garbage_net;
    g.clearRect(x, y, w, h);
    g.strokeStyle = '#2f8a3a'; g.lineWidth = 3;
    for (let k = -w; k < w * 2; k += 14) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + h, y + h); g.stroke(); g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); g.stroke(); }
    g.strokeStyle = '#4fc85a'; g.lineWidth = 1.2;
    for (let k = -w; k < w * 2; k += 14) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + h, y + h); g.stroke(); }
    g.fillStyle = '#1f5a2a'; g.fillRect(x, y + h - 10, w, 10);
  }
  // red paper lantern 祭
  {
    const [x, y, w, h] = P.chochin;
    g.fillStyle = '#d8282e'; g.fillRect(x, y, w, h);
    for (let k = 0; k < 9; k++) { g.fillStyle = 'rgba(80,0,10,0.25)'; g.fillRect(x, y + 6 + k * 10, w, 2); }
    g.fillStyle = '#1a1a1e'; g.fillRect(x, y, w, 8); g.fillRect(x, y + h - 8, w, 8);
    fitText(g, '祭', x + w / 2, y + h / 2, w - 10, 40, FONT.jp, { fill: '#1a1a1e' });
  }
  // stone lantern window (paper glow)
  { const [x, y, w, h] = P.lantern_win; g.fillStyle = '#5a5248'; g.fillRect(x, y, w, h); g.fillStyle = '#f2e6c8'; g.fillRect(x + 12, y + 12, w - 24, h - 24); g.fillStyle = '#7a6a58'; g.fillRect(x + w / 2 - 1.5, y + 12, 3, h - 24); g.fillRect(x + 12, y + h / 2 - 1.5, w - 24, 3); }
  // shed window
  { const [x, y, w, h] = P.shed_window; g.fillStyle = '#e8e6e0'; g.fillRect(x, y, w, h); g.fillStyle = '#3a4a5a'; g.fillRect(x + 6, y + 6, w - 12, h - 12); g.fillStyle = 'rgba(180,220,255,0.35)'; poly(g, [[x + 6, y + 30], [x + 30, y + 6], [x + 44, y + 6], [x + 6, y + 44]], 'rgba(180,220,255,0.35)'); g.fillStyle = '#e8e6e0'; g.fillRect(x + w / 2 - 2, y + 6, 4, h - 12); }
  // shed sliding door (beige steel shed)
  { const [x, y, w, h] = P.shed_door; g.fillStyle = '#e8dcc0'; g.fillRect(x, y, w, h); for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(120,100,70,0.2)'; g.fillRect(x, y + 10 + k * 20, w, 2); } g.fillStyle = '#8a7a5a'; g.fillRect(x + w - 12, y + h / 2 - 12, 5, 24); g.fillStyle = '#6a8a5a'; g.fillRect(x, y, w, 8); g.fillStyle = 'rgba(80,60,40,0.3)'; g.fillRect(x, y + h - 10, w, 10); }
  // signal cabinet door
  { const [x, y, w, h] = P.cabinet; g.fillStyle = '#c8ccc4'; g.fillRect(x, y, w, h); g.strokeStyle = '#8a8e88'; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, w - 12, h - 12); g.fillStyle = '#6a6e68'; g.fillRect(x + w - 16, y + h / 2 - 8, 4, 16); for (let k = 0; k < 5; k++) { g.fillStyle = '#9a9e98'; g.fillRect(x + 14, y + 16 + k * 6, 30, 3); } g.fillStyle = '#f5c518'; g.fillRect(x + 12, y + 60, 26, 16); fitText(g, '危険', x + 25, y + 68, 22, 10, FONT.jp, { fill: '#222' }); }
  // barrier blinker housing
  { const [x, y, w, h] = P.barrier_lamp; g.fillStyle = '#1a1a1e'; g.fillRect(x, y, w, h); g.fillStyle = '#f5c518'; g.fillRect(x + 4, y + 4, w - 8, h - 8); }
  // wood (plank grain) for benches, crates
  { const [x, y, w, h] = P.wood; g.fillStyle = '#b98a58'; g.fillRect(x, y, w, h); for (let k = 0; k < 12; k++) { g.fillStyle = 'rgba(110,70,40,0.3)'; g.fillRect(x, y + rng() * h, w, 1.2); } g.fillStyle = 'rgba(255,240,210,0.25)'; g.fillRect(x, y, w, 3); }
  // weathered stone (lanterns, bollards)
  { const [x, y, w, h] = P.stone; g.fillStyle = '#9d988c'; g.fillRect(x, y, w, h); for (let i = 0; i < 10; i++) softBlob(g, x + rng() * w, y + rng() * h, 16, i % 3 ? '#b8b3a6' : '#6f8040', 0.4); }
  // board back (grey aluminium with ribs)
  { const [x, y, w, h] = P.board_back; g.fillStyle = '#a4aab2'; g.fillRect(x, y, w, h); for (let k = 0; k < 4; k++) { g.fillStyle = '#7a8088'; g.fillRect(x + 10 + k * 32, y, 4, h); } }
  // yellow/black pole guard band
  { const [x, y, w, h] = P.pole_band; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#f5c518'; g.fillRect(x, y, w, h); for (let k = -h; k < w + h; k += 16) poly(g, [[x + k, y + h], [x + k + 8, y + h], [x + k + 8 + h, y], [x + k + h, y]], '#1d1b22'); g.restore(); }
  // pole transformer can (grey with ribs and a label)
  { const [x, y, w, h] = P.transformer; g.fillStyle = lin(g, x, 0, x + w, 0, [[0, '#8f959e'], [0.35, '#c9ced6'], [0.7, '#a6acb5'], [1, '#7a8089']]); g.fillRect(x, y, w, h); for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(40,40,60,0.2)'; g.fillRect(x, y + 16 + k * 18, w, 4); } g.fillStyle = '#f2f2ee'; g.fillRect(x + 40, y + 40, 48, 22); fitText(g, '6600V', x + 64, y + 51, 40, 11, FONT.latin, { fill: '#d42a2a' }); }
  // bus shelter roof edge / bench seat
  { const [x, y, w, h] = P.ad_shelter_roof; g.fillStyle = '#1f5aa8'; g.fillRect(x, y, w, h); fitText(g, '市営バス  CITY BUS', x + w / 2, y + h / 2, w - 10, 14, FONT.jp, { fill: '#fff' }); }
  { const [x, y, w, h] = P.bench_seat; g.fillStyle = '#d8d4cc'; g.fillRect(x, y, w, h); for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(80,80,100,0.25)'; g.fillRect(x, y + 6 + k * 7, w, 2); } }
  // works light (amber LED)
  { const [x, y, w, h] = P.works_light; g.fillStyle = '#1a1a1e'; g.fillRect(x, y, w, h); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ellipse(g, x + 16 + i * 16, y + 16 + j * 16, 6, 6, 0, '#ff9a2a'); }
  // rope (yellow/black twisted) and rubber (black)
  { const [x, y, w, h] = P.rope; for (let k = 0; k < w; k += 12) { g.fillStyle = (k / 12) % 2 ? '#1d1b22' : '#f5c518'; g.fillRect(x + k, y, 12, h); } }
  { const [x, y, w, h] = P.rubber; g.fillStyle = '#2a2a30'; g.fillRect(x, y, w, h); g.fillStyle = '#f5c518'; for (let k = 0; k < w; k += 48) g.fillRect(x + k, y, 20, h); }
  // bicycle basket (wire mesh, cutout)
  { const [x, y, w, h] = P.bike_basket; g.clearRect(x, y, w, h); g.strokeStyle = '#c8ccd2'; g.lineWidth = 2.5; for (let k = 2; k < w; k += 8) { g.beginPath(); g.moveTo(x + k, y + 2); g.lineTo(x + k, y + h - 2); g.stroke(); } for (let k = 2; k < h; k += 8) { g.beginPath(); g.moveTo(x + 2, y + k); g.lineTo(x + w - 2, y + k); g.stroke(); } g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4); }
  // bicycle wheel (tyre, rim, spokes, cutout)
  {
    const [x, y, w] = P.bike_wheel, cx = x + w / 2, cy = y + w / 2;
    g.clearRect(x, y, w, w);
    g.beginPath(); g.arc(cx, cy, 45, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = '#1e1e24'; g.stroke();
    g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#c8ccd2'; g.stroke();
    g.strokeStyle = '#b8bcc2'; g.lineWidth = 1.3; for (let k = 0; k < 18; k++) { const a = k * Math.PI / 9; g.beginPath(); g.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4); g.lineTo(cx + Math.cos(a + 0.4) * 39, cy + Math.sin(a + 0.4) * 39); g.stroke(); }
    ellipse(g, cx, cy, 5, 5, 0, '#8a8e96');
  }
  // blue tarp
  { const [x, y, w, h] = P.tarp; g.fillStyle = '#2f7fd8'; g.fillRect(x, y, w, h); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(10,30,90,0.25)'; g.beginPath(); g.moveTo(x + rng() * w, y); g.lineTo(x + rng() * w, y + h); g.lineWidth = 6; g.strokeStyle = 'rgba(10,30,90,0.2)'; g.stroke(); } g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x, y, w, 6); }
  // terracotta pot
  { const [x, y, w, h] = P.plant_pot; g.fillStyle = lin(g, x, 0, x + w, 0, [[0, '#9a4a2a'], [0.4, '#d07a4a'], [1, '#8a3a20']]); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 12, w, 4); }
  // beer crate (yellow plastic)
  { const [x, y, w, h] = P.sake_crate; g.fillStyle = '#f2c230'; g.fillRect(x, y, w, h); for (let k = 0; k < 4; k++) { g.fillStyle = '#c89a18'; g.fillRect(x + 6 + k * 22, y + 8, 14, 18); } fitText(g, 'KIRAI', x + w / 2, y + 38, w - 20, 11, FONT.latin, { fill: '#c82a2a' }); }
}
export function propsBEmit(g, S) {
  const P = PROPS_B, k = S / 512;
  g.save(); g.scale(k, k);
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  // light boxes glow with their own art, a little dimmed
  adArt(g, P, seeded(0xad5));
  for (const r of [P.ad_soda, P.ad_radio]) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(r[0], r[1], r[2], r[3]); }
  { const [x, y, w, h] = P.phone_top; g.fillStyle = '#4aff8a'; g.fillRect(x, y, w, h); }
  { const [x, y, w, h] = P.chochin; g.fillStyle = '#ff6a3a'; g.fillRect(x, y + 8, w, h - 16); }
  { const [x, y, w, h] = P.lantern_win; g.fillStyle = '#ffd890'; g.fillRect(x + 12, y + 12, w - 24, h - 24); }
  { const [x, y, w, h] = P.barrier_lamp; g.fillStyle = '#ffb030'; g.fillRect(x + 4, y + 4, w - 8, h - 8); }
  { const [x, y, w, h] = P.works_light; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ellipse(g, x + 16 + i * 16, y + 16 + j * 16, 7, 7, 0, '#ffa030'); }
  g.restore();
}

// ──────────────────────────────────────── layers ────────────────────────────────────────

export const layers = [
  { name: 'st_pave_grey', albedo: paveGrey },
  { name: 'st_pave_brick', albedo: paveBrick },
  { name: 'st_pave_stone', albedo: paveStone },
  { name: 'st_concrete', albedo: concrete },
  { name: 'st_strips', albedo: strips },
  { name: 'st_grass', albedo: grass },
  { name: 'st_scrub', albedo: scrub },
  { name: 'st_earth', albedo: earth },
  { name: 'st_gravel', albedo: gravel },
  { name: 'st_dock', albedo: dock },
  { name: 'st_asphalt', albedo: asphalt },
  { name: 'st_chainlink', albedo: chainlink },
  { name: 'st_hoarding_a', albedo: hoardingA },
  { name: 'st_hoarding_b', albedo: hoardingB },
  { name: 'st_walls', albedo: walls },
  { name: 'st_fences', albedo: fences },
  { name: 'st_metal', albedo: metal },
  { name: 'st_containers', albedo: containers },
  { name: 'st_docks', albedo: docks },
  { name: 'st_leaves', albedo: leaves },
  { name: 'st_blossom', albedo: blossom },
  { name: 'st_pine', albedo: needles },
  { name: 'st_bark', albedo: bark },
  { name: 'st_cards', albedo: cards },
  { name: 'st_props_a', albedo: propsA, emit(g, S) { propsAEmit(g, S); emitKind(g, S, 'always'); } },
  { name: 'st_props_b', albedo: propsB, emit(g, S) { propsBEmit(g, S); emitKind(g, S, 'always'); } },
];
