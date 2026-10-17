/**
 * Facades, wall surfaces, shopfronts, roofs and rooftop details for the city-kit buildings
 * (src/world/kit/buildings.ts reads these by name; tile sizes in metres per repeat are given
 * per layer and must match the TILE table there).
 *
 * Everything is painted in 512 "design units" per layer (def() scales to the real size), so
 * the 256 px emissive uses the same coordinates as the albedo.
 *
 * Style: flat colour areas, soft painted gradients, painted rims (darker edge, light top edge)
 * so shapes read without ink. Shadows lean toward indigo, never grey.
 *
 * Emissive kinds (paintlib emitKind): window layers are stamped 'window' over the whole layer
 * (one window per texture repeat, lit at random per repeat); shop interiors, signs and lamp
 * swatches are stamped 'always'. Cutout art lives on its own layers (deco_*), opaque layers are
 * fully opaque.
 *
 * Also exports the painting helpers used by 12_signs.mjs and 14_graffiti.mjs.
 */
import { createCanvas } from '@napi-rs/canvas';
import { FONT, rrect, fitText, emitKind, rngFor } from '../paintlib.mjs';

// ───────────────────────────── colour ─────────────────────────────
export function rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
/** lighten toward white */
export const lt = (c, k) => mix(c, '#ffffff', k);
/** darken toward the painted shadow indigo (never plain grey) */
export const dk = (c, k) => mix(c, '#22183c', k);
export const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };
export const POP = ['#ff3b5c', '#ffcf2e', '#2fa8ff', '#3fd17a', '#ff8a1f', '#ff5fb0', '#8c5cff', '#ffffff', '#20c4c0'];

// ───────────────────────────── layer wrapper ─────────────────────────────
/**
 * def(name, albedo(g, rng), emit?(g, rng, K), opts) → painter layer. Both paint in 512 units.
 * K(kind, x, y, w, h) stamps the emissive kind over a region (design units; default whole layer).
 * opts.cutout: dilate edge colours into the transparent margin (alpha 0.14) so filtering never
 * pulls black into the 0.5 alpha contour.
 */
/** device px per design unit for the layer being painted (blur radii ignore the canvas transform) */
export let SCALE = 1;
export function def(name, albedo, emit, opts = {}) {
  return {
    name,
    albedo(g, S, rng) {
      SCALE = S / 512;
      g.save(); g.scale(S / 512, S / 512); albedo(g, rng); g.restore();
      if (opts.cutout) bleed(g, S);
      else opaque(g, S);
    },
    emit: emit && function (g, S, rng) {
      SCALE = S / 512;
      g.save(); g.scale(S / 512, S / 512);
      const stamps = [];
      emit(g, rng, (kind, x = 0, y = 0, w = 512, h = 512) => stamps.push([kind, x, y, w, h]));
      g.restore();
      const k = S / 512;
      for (const [kind, x, y, w, h] of stamps) emitKind(g, S, kind, Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k));
    },
  };
}

/** Forces an opaque layer to full alpha (guards against stray antialiased gaps). */
function opaque(g, S) {
  const img = g.getImageData(0, 0, S, S), d = img.data;
  let fix = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { d[i] = 255; fix = true; }
  if (fix) g.putImageData(img, 0, 0);
}

/** Edge-colour dilation for cutout layers. */
export function bleed(g, S, passes = 8, alpha = 36) {
  const img = g.getImageData(0, 0, S, S), d = img.data, n = S * S;
  let src = new Uint8Array(n);
  for (let i = 0; i < n; i++) src[i] = d[i * 4 + 3] >= 64 ? 1 : 0;
  const touched = new Uint8Array(n);
  for (let p = 0; p < passes; p++) {
    const nx = src.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (src[i]) continue;
      let r = 0, gg = 0, b = 0, c = 0;
      const nb = [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1];
      for (const j of nb) if (j >= 0 && src[j]) { r += d[j * 4]; gg += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      if (c) { d[i * 4] = r / c; d[i * 4 + 1] = gg / c; d[i * 4 + 2] = b / c; nx[i] = 1; touched[i] = 1; }
    }
    src = nx;
  }
  for (let i = 0; i < n; i++) if (touched[i]) d[i * 4 + 3] = Math.max(Math.min(d[i * 4 + 3], 120), alpha);
  g.putImageData(img, 0, 0);
}

// ───────────────────────────── painting primitives ─────────────────────────────
export function vg(g, x, y, w, h, stops) {
  const G = g.createLinearGradient(0, y, 0, y + h);
  for (const [t, c] of stops) G.addColorStop(t, c);
  g.fillStyle = G; g.fillRect(x, y, w, h);
}
export function hg(g, x, y, w, h, stops) {
  const G = g.createLinearGradient(x, 0, x + w, 0);
  for (const [t, c] of stops) G.addColorStop(t, c);
  g.fillStyle = G; g.fillRect(x, y, w, h);
}
export function fill(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
export function poly(g, c, pts) { g.fillStyle = c; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); }
export function circle(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
export function line(g, c, w, x0, y0, x1, y1) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

/** Painted panel: light top, darker foot, darker painted rim, light top edge. */
export function panel(g, x, y, w, h, c, o = {}) {
  const k = o.grad ?? 0.12;
  vg(g, x, y, w, h, [[0, lt(c, k)], [0.5, c], [1, dk(c, k * 1.2)]]);
  const e = o.edge ?? 2;
  if (e > 0) { g.strokeStyle = o.rim ?? dk(c, 0.38); g.lineWidth = e; g.strokeRect(x + e / 2, y + e / 2, w - e, h - e); }
  if (o.hi !== false && h > 4 * e) fill(g, lt(c, o.hiK ?? 0.4), x + e, y + e, w - 2 * e, Math.max(1, e * 0.8));
}

/** Soft shadow band fading away from an edge ('down' = darkest at y). */
export function shadow(g, x, y, w, h, a = 0.3, dir = 'down', c = '#1c1236') {
  if (dir === 'down') vg(g, x, y, w, h, [[0, rgba(c, a)], [1, rgba(c, 0)]]);
  else if (dir === 'up') vg(g, x, y, w, h, [[0, rgba(c, 0)], [1, rgba(c, a)]]);
  else if (dir === 'right') hg(g, x, y, w, h, [[0, rgba(c, a)], [1, rgba(c, 0)]]);
  else hg(g, x, y, w, h, [[0, rgba(c, 0)], [1, rgba(c, a)]]);
}

/** Soft vertical streak fading downward (rain grime, rust): blurred, no hard edges. */
export function streak(g, x, y, w, h, c, a) {
  g.save();
  g.filter = `blur(${Math.max(1, w * 0.22 * SCALE).toFixed(1)}px)`;
  vg(g, x + w * 0.22, y, w * 0.56, h, [[0, rgba(c, 0)], [0.1, rgba(c, a)], [0.45, rgba(c, a * 0.6)], [1, rgba(c, 0)]]);
  g.restore();
}
/** Soft blurred blob (painted stains, glow halos). */
export function blob(g, x, y, rx, ry, c, a, blur = 0.5) {
  g.save();
  g.filter = `blur(${Math.max(1, Math.min(rx, ry) * blur * SCALE).toFixed(1)}px)`;
  g.fillStyle = rgba(c, a); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Reflective glass: sky gradient, two soft diagonal glints, shadow under the head. */
export function glass(g, x, y, w, h, o = {}) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  vg(g, x, y, w, h, [[0, o.top ?? '#b4e4ff'], [0.45, o.mid ?? '#5ea8ea'], [1, o.bot ?? '#2a58a6']]);
  if (o.inside) o.inside(g, x, y, w, h);
  const s = o.glint ?? 1;
  if (s > 0) {
    const a = o.at ?? 0.18, sl = h * 0.55;
    poly(g, rgba('#ffffff', 0.13 * s), [x + w * a, y, x + w * (a + 0.32), y, x + w * (a + 0.32) - sl, y + h, x + w * a - sl, y + h]);
    poly(g, rgba('#ffffff', 0.2 * s), [x + w * (a + 0.4), y, x + w * (a + 0.47), y, x + w * (a + 0.47) - sl, y + h, x + w * (a + 0.4) - sl, y + h]);
  }
  shadow(g, x, y, w, Math.min(h * 0.14, 16), 0.38);
  g.restore();
}

/** Window frame drawn inside the opening (x,y,w,h), bar thickness t. */
export function frame(g, x, y, w, h, t, c) {
  panel(g, x, y, w, t, dk(c, 0.12), { edge: 1, grad: 0.08 });
  panel(g, x, y + h - t, w, t, lt(c, 0.12), { edge: 1, grad: 0.08 });
  panel(g, x, y, t, h, c, { edge: 1, grad: 0.05, hi: false });
  panel(g, x + w - t, y, t, h, c, { edge: 1, grad: 0.05, hi: false });
}

/** Horizontal blinds over (x,y,w,h). */
export function blinds(g, x, y, w, h, c, pitch = 7) {
  fill(g, c, x, y, w, h);
  for (let yy = y + pitch - 2; yy < y + h; yy += pitch) fill(g, dk(c, 0.18), x, yy, w, 1.6);
  fill(g, dk(c, 0.3), x, y + h - 3, w, 3);
}

/** Vertical curtain folds. */
export function curtain(g, x, y, w, h, c, folds = 6) {
  const fw = w / folds;
  for (let i = 0; i < folds; i++) hg(g, x + i * fw, y, fw + 0.5, h, [[0, dk(c, 0.1)], [0.45, lt(c, 0.12)], [1, dk(c, 0.14)]]);
  shadow(g, x, y + h - 10, w, 10, 0.15, 'up');
}

/** Lit room seen through glass (emissive): ceiling glow at the top, darker floor. */
export function room(g, x, y, w, h, c, o = {}) {
  vg(g, x, y, w, h, [[0, lt(c, 0.3)], [0.3, c], [1, dk(c, o.floor ?? 0.45)]]);
  if (o.lamps) for (let i = 0; i < o.lamps; i++) fill(g, lt(c, 0.7), x + (w / o.lamps) * (i + 0.2), y + h * 0.06, (w / o.lamps) * 0.6, Math.max(2, h * 0.03));
}

/** Small-kana and rotate-in-vertical sets for vertical Japanese text. */
const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
const ROT = 'ー〜～…‥―-－';
/** Vertical Japanese text, one character per cell top→bottom; long vowel rotated, small kana offset. */
export function vtext(g, text, cx, y0, y1, size, font, fillC, o = {}) {
  const ch = [...text];
  const step = (y1 - y0) / ch.length;
  const s = Math.min(size, step * 0.94);
  g.font = `${s}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  ch.forEach((c, i) => {
    g.save();
    g.translate(cx, y0 + step * (i + 0.5));
    if (ROT.includes(c)) g.rotate(Math.PI / 2);
    if (SMALL.includes(c)) g.translate(s * 0.13, -s * 0.13);
    if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.strokeWidth ?? s * 0.16; g.strokeStyle = o.stroke; g.strokeText(c, 0, s * 0.03); }
    g.fillStyle = fillC; g.fillText(c, 0, s * 0.03);
    g.restore();
  });
  return s;
}
/** Horizontal fitted text (thin wrapper over paintlib.fitText with optional letter spacing). */
export function htext(g, text, cx, cy, maxW, size, font, fillC, o = {}) {
  return fitText(g, text, cx, cy, maxW, size, font, { fill: fillC, stroke: o.stroke, strokeWidth: o.strokeWidth, align: o.align });
}

/** Metric helper for a tile of tw×th metres painted into 512×512. y is measured from the bottom. */
export function metric(tw, th, H = 512) {
  return { x: (m) => (m * 512) / tw, w: (m) => (m * 512) / tw, y: (m) => H - (m * H) / th, h: (m) => (m * H) / th };
}

// ───────────────────────────── window walls ─────────────────────────────

// fac_curtain_a — tile [3.0, 4.0]: blue curtain wall, one vision panel per repeat.
function curtainA(g, night) {
  const M = metric(3, 4);
  const top = M.y(3.75), bot = M.y(0.8);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 8, top, 496, bot - top, '#ffe8c4', { lamps: 3, floor: 0.5 });
    // partition / desk silhouettes
    fill(g, rgba('#40281a', 0.55), 8, bot - 70, 496, 70);
    for (let i = 0; i < 4; i++) fill(g, rgba('#2a1a12', 0.5), 30 + i * 125, bot - 120, 70, 50);
    return;
  }
  fill(g, '#c3d2e4', 0, 0, 512, 512);
  // spandrel (floor slab zone): opaque dark glass, split across the repeat seam
  vg(g, 0, bot, 512, 512 - bot, [[0, '#4a6a9c'], [1, '#2a4474']]);
  vg(g, 0, 0, 512, top, [[0, '#2c4676'], [1, '#3e5c8e']]);
  fill(g, '#9fb6d4', 0, 510, 512, 2);
  line(g, rgba('#ffffff', 0.25), 2, 0, bot + 12, 512, bot + 12);
  glass(g, 8, top + 7, 496, bot - top - 7, { top: '#c0ecff', mid: '#5fb0f0', bot: '#2c62b4', at: 0.12 });
  // mullions (half at each edge) and transoms
  hg(g, 0, 0, 8, 512, [[0, '#8ea4c4'], [1, '#e8f2ff']]);
  hg(g, 504, 0, 8, 512, [[0, '#dce8f6'], [1, '#7f94b4']]);
  panel(g, 0, top, 512, 8, '#d4e2f2', { edge: 1 });
  panel(g, 0, bot - 4, 512, 8, '#e2ecf8', { edge: 1 });
}

// fac_curtain_b — tile [3.0, 3.6]: teal glass with white horizontal bands, two lites per bay.
function curtainB(g, night) {
  const M = metric(3, 3.6);
  const top = M.y(3.42), bot = M.y(0.62);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 4, top, 504, bot - top, '#e6f0ff', { lamps: 2, floor: 0.55 });
    fill(g, rgba('#000', 0.6), 254, top, 4, bot - top);
    fill(g, rgba('#283040', 0.5), 4, bot - 60, 504, 60);
    return;
  }
  // white aluminium band (spandrel)
  vg(g, 0, bot, 512, 512 - bot, [[0, '#f6fafc'], [0.6, '#e2eaf0'], [1, '#c8d4de']]);
  vg(g, 0, 0, 512, top, [[0, '#d0dae4'], [1, '#eef4f8']]);
  line(g, rgba('#7890a8', 0.6), 2, 0, bot + 2, 512, bot + 2);
  line(g, rgba('#ffffff', 0.9), 2, 0, bot + 6, 512, bot + 6);
  shadow(g, 0, bot + 8, 512, 18, 0.12);
  glass(g, 0, top, 512, bot - top, { top: '#a4fff0', mid: '#3cc0bc', bot: '#1a6a84', at: 0.3 });
  for (const x of [0, 254, 508]) panel(g, x - (x === 0 ? 0 : 0), top, 4, bot - top, '#2c4c5c', { edge: 0, hi: false });
  fill(g, '#2c4c5c', 508, top, 4, bot - top);
}

// fac_curtain_c — tile [3.0, 3.8]: gold mirror glass in a dark bronze grid (80s bank tower).
function curtainC(g, night) {
  const M = metric(3, 3.8);
  const top = M.y(3.55), bot = M.y(0.75);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 6, top, 500, bot - top, '#ffe2b0', { lamps: 3, floor: 0.5 });
    fill(g, rgba('#000', 0.65), 168, top, 5, bot - top); fill(g, rgba('#000', 0.65), 339, top, 5, bot - top);
    fill(g, rgba('#3a2010', 0.5), 6, bot - 56, 500, 56);
    return;
  }
  // bronze spandrel with a polished edge
  vg(g, 0, bot, 512, 512 - bot, [[0, '#7a4a2e'], [1, '#4a2a1c']]);
  vg(g, 0, 0, 512, top, [[0, '#4a2a1c'], [1, '#6a4028']]);
  line(g, rgba('#ffd8a0', 0.55), 2, 0, bot + 3, 512, bot + 3);
  line(g, rgba('#ffd8a0', 0.35), 2, 0, top - 3, 512, top - 3);
  glass(g, 0, top, 512, bot - top, { top: '#fff4c8', mid: '#f0b860', bot: '#a8602c', at: 0.08 });
  // a warm sky reflection band and a cloud smear
  blob(g, 150, top + (bot - top) * 0.3, 140, 22, '#fff8e0', 0.35);
  for (const x of [0, 170, 341]) panel(g, x, top, 6, bot - top, '#5a3420', { edge: 0, hi: false });
  fill(g, '#5a3420', 506, top, 6, bot - top);
}

// fac_office_band — tile [3.2, 3.6]: ribbon windows with cream spandrels and half-drawn blinds.
function officeBand(g, night) {
  const M = metric(3.2, 3.6);
  const top = M.y(2.9), bot = M.y(1.0);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 4, top, 504, bot - top, '#fff0d4', { lamps: 2, floor: 0.4 });
    blinds(g, 4, top, 504, (bot - top) * 0.3, '#c8b08a', 8);
    fill(g, '#000', 254, top, 4, bot - top);
    return;
  }
  vg(g, 0, 0, 512, 512, [[0, '#eee4cc'], [1, '#e6dac0']]);
  // floor-line groove and a soft rain streak under each sill
  line(g, rgba('#8a7a60', 0.35), 2, 0, M.y(0.12), 512, M.y(0.12));
  line(g, rgba('#ffffff', 0.5), 1.5, 0, M.y(0.12) + 2.5, 512, M.y(0.12) + 2.5);
  streak(g, 40, bot + 12, 60, 110, '#7a6a58', 0.16);
  streak(g, 330, bot + 12, 90, 90, '#7a6a58', 0.12);
  // head shadow and glass band
  glass(g, 0, top, 512, bot - top, {
    top: '#a6d6f4', mid: '#6aa2d4', bot: '#36629a', at: 0.25,
    inside: (gg, x, y, w, h) => { blinds(gg, x, y, w, h * 0.3, '#e8eef2', 8); },
  });
  for (const x of [0, 256, 508]) fill(g, '#4a5468', x === 256 ? 254 : x, top, 4, bot - top);
  panel(g, 0, top - 6, 512, 6, '#6a6272', { edge: 0, hi: false });
  panel(g, 0, bot, 512, 9, '#faf4e6', { edge: 1, rim: '#a89880' });
  shadow(g, 0, bot + 9, 512, 10, 0.18);
}

// fac_office_punch — tile [2.6, 3.4]: punched aluminium window in a terracotta tile wall.
function officePunch(g, night) {
  const M = metric(2.6, 3.4);
  const x0 = M.x(0.55), x1 = M.x(2.05), top = M.y(2.5), bot = M.y(0.95);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, x0 + 8, top + 8, x1 - x0 - 16, bot - top - 16, '#ffdcaa', { lamps: 1, floor: 0.5 });
    blinds(g, (x0 + x1) / 2, top + 8, (x1 - x0) / 2 - 8, (bot - top) * 0.42, '#b89a70', 8);
    fill(g, '#000', (x0 + x1) / 2 - 3, top, 6, bot - top);
    return;
  }
  vg(g, 0, 0, 512, 512, [[0, '#d0946a'], [1, '#c4865c']]);
  // tile courses (very low contrast)
  for (let y = 4; y < 512; y += 16) fill(g, rgba('#7a4a30', 0.08), 0, y, 512, 1.5);
  for (let r = 0, y = 0; y < 512; y += 16, r++) for (let x = (r % 2) * 24; x < 512; x += 48) fill(g, rgba('#7a4a30', 0.07), x, y, 1.5, 16);
  streak(g, x0 + 20, bot + 14, 80, 120, '#5a3420', 0.14);
  streak(g, x1 - 90, bot + 14, 60, 90, '#5a3420', 0.1);
  // reveal (depth): darker on top and left
  fill(g, '#8a5a40', x0 - 6, top - 6, x1 - x0 + 12, bot - top + 12);
  glass(g, x0 + 8, top + 8, x1 - x0 - 16, bot - top - 16, {
    top: '#b8e0fa', mid: '#6ea8de', bot: '#3a64a4',
    inside: (gg, x, y, w, h) => blinds(gg, x + w / 2, y, w / 2, h * 0.42, '#f0f2ee', 8),
  });
  frame(g, x0, top, x1 - x0, bot - top, 8, '#c4ccd6');
  panel(g, (x0 + x1) / 2 - 4, top + 6, 8, bot - top - 12, '#b4bcc6', { edge: 1, hi: false });
  // concrete sill
  panel(g, x0 - 14, bot, x1 - x0 + 28, 12, '#ece4d8', { edge: 1.5 });
  shadow(g, x0 - 14, bot + 12, x1 - x0 + 28, 12, 0.25);
}

// fac_mansion_a / _b — tile [3.6, 2.95]: apartment bay behind a balcony (sliding door + pipe cover).
function mansionBay(g, night, v) {
  const M = metric(3.6, 2.95);
  const x0 = M.x(0.3), x1 = M.x(2.9), top = M.y(2.08), bot = M.y(0.05);
  const curtainC = v === 'a' ? '#f4b8a0' : '#9cc8e0';
  const mid = (x0 + x1) / 2;
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    if (v === 'a') {
      room(g, x0 + 6, top + 6, mid - x0 - 6, bot - top - 12, '#ffb070');
      room(g, mid, top + 6, x1 - mid - 6, bot - top - 12, '#ffe0b0', { floor: 0.3 });
      for (let i = 0; i < 5; i++) fill(g, rgba('#000', 0.12), x0 + 6 + i * ((mid - x0) / 5), top + 6, 4, bot - top - 12);
    } else {
      room(g, x0 + 6, top + 6, x1 - x0 - 12, bot - top - 12, '#ffd49a', { lamps: 1 });
      fill(g, '#5a3018', x0 + 6, top + 6, 50, bot - top - 12);
      fill(g, '#5a3018', x1 - 56, top + 6, 50, bot - top - 12);
      fill(g, rgba('#3a2010', 0.6), mid - 40, bot - 70, 120, 60);
    }
    return;
  }
  vg(g, 0, 0, 512, 512, [[0, '#f4f0e8'], [1, '#e8e2d6']]);
  // slab soffit shadow at the top and panel joints
  shadow(g, 0, 0, 512, 30, 0.32);
  fill(g, rgba('#9a8e80', 0.25), 0, M.y(1.3), 512, 1.5);
  fill(g, '#c8ced6', x0 - 8, top - 8, x1 - x0 + 16, bot - top + 8);
  glass(g, x0, top, x1 - x0, bot - top, {
    top: '#c4e2f4', mid: '#88b6d8', bot: '#4a74a6', at: 0.5, glint: 0.8,
    inside: (gg, x, y, w, h) => {
      if (v === 'a') { curtain(gg, x, y, w / 2, h, curtainC, 5); fill(gg, rgba('#ffffff', 0.35), x + w / 2, y, w / 2, h); for (let i = 0; i < 8; i++) fill(gg, rgba('#ffffff', 0.25), x + w / 2 + i * (w / 16), y, w / 32, h); }
      else { curtain(gg, x, y, 46, h, curtainC, 2); curtain(gg, x + w - 46, y, 46, h, curtainC, 2); fill(gg, rgba('#3a3050', 0.25), x + 46, y + h * 0.55, w - 92, h * 0.45); }
    },
  });
  frame(g, x0, top, x1 - x0, bot - top, 7, '#c4ccd4');
  panel(g, mid - 4, top + 5, 8, bot - top - 10, '#bcc4cc', { edge: 1, hi: false });
  // AC piping cover running up the wall
  const px = M.x(3.18);
  panel(g, px, 0, 26, 512, '#ece4d4', { edge: 1.5, grad: 0.06, hi: false });
  for (let y = 60; y < 512; y += 170) fill(g, rgba('#7a6e60', 0.35), px, y, 26, 2);
}

// fac_balcony — tile [3.6, 1.15], two variants stacked: top half frosted glass, bottom half solid
// parapet. Map v to [0.5,1] or [0,0.5]; u repeats per bay.
function balcony(g) {
  for (const [oy, kind] of [[0, 'glass'], [256, 'solid']]) {
    const H = 256, slab = 46, rail = 22;
    if (kind === 'glass') {
      fill(g, '#e2ded6', 0, oy, 512, H);
      vg(g, 0, oy + rail, 512, H - rail - slab, [[0, '#e6f2fa'], [0.6, '#c6dcea'], [1, '#a4c0d6']]);
      for (let i = 0; i < 6; i++) fill(g, rgba('#ffffff', 0.14), 30 + i * 84, oy + rail, 30, H - rail - slab);
      // potted-plant and stuff silhouettes behind frosted glass
      fill(g, rgba('#54708a', 0.25), 60, oy + 120, 70, H - slab - 120);
      fill(g, rgba('#54708a', 0.18), 360, oy + 90, 40, H - slab - 90);
      for (const x of [0, 256]) panel(g, x === 0 ? -4 : x - 4, oy + rail, 8, H - rail - slab, '#b8c2cc', { edge: 1, hi: false });
      fill(g, '#b8c2cc', 508, oy + rail, 4, H - rail - slab);
      panel(g, 0, oy, 512, rail, '#d4dce4', { edge: 1.5 });
      shadow(g, 0, oy + rail, 512, 10, 0.2);
    } else {
      vg(g, 0, oy, 512, H - slab, [[0, '#f2eee6'], [1, '#e2dccf']]);
      panel(g, 0, oy, 512, 18, '#f8f6f0', { edge: 1.5 });
      shadow(g, 0, oy + 18, 512, 10, 0.18);
      // decorative inset stripe and drain slots
      fill(g, '#c8a878', 0, oy + 60, 512, 10);
      fill(g, rgba('#ffffff', 0.5), 0, oy + 60, 512, 2);
      for (let x = 40; x < 512; x += 128) { fill(g, '#5a5468', x, oy + H - slab - 22, 40, 10); }
      streak(g, 100, oy + 80, 50, 120, '#7a6c5a', 0.12);
    }
    // slab edge with drip groove
    panel(g, 0, oy + H - slab, 512, slab, '#d8d2c6', { edge: 1.5, grad: 0.15 });
    fill(g, rgba('#4a4058', 0.45), 0, oy + H - 10, 512, 3);
  }
}

// fac_zakkyo — tile [3.0, 3.3]: multi-tenant building bay, bronze frame with transom and blinds.
function zakkyo(g, night) {
  const M = metric(3, 3.3);
  const x0 = M.x(0.28), x1 = M.x(2.72), top = M.y(2.78), bot = M.y(0.85), tr = M.y(2.3);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, x0 + 6, top + 6, x1 - x0 - 12, bot - top - 12, '#ffd2a4', { lamps: 2 });
    for (let i = 0; i < 10; i++) fill(g, rgba('#7a5030', 0.4), x0 + 10 + i * ((x1 - x0) / 10), tr + 4, (x1 - x0) / 22, bot - tr - 10);
    fill(g, '#000', x0, tr - 3, x1 - x0, 6);
    return;
  }
  vg(g, 0, 0, 512, 512, [[0, '#dcd6cc'], [1, '#d0c8bc']]);
  // pilasters at the bay edges
  hg(g, 0, 0, 22, 512, [[0, '#bcb4a6'], [1, '#d6d0c4']]);
  hg(g, 490, 0, 22, 512, [[0, '#d6d0c4'], [1, '#b0a898']]);
  // ledge above window
  panel(g, 0, top - 22, 512, 12, '#ece6dc', { edge: 1.5 });
  shadow(g, 0, top - 10, 512, 10, 0.2);
  fill(g, '#4a3c30', x0 - 6, top - 6, x1 - x0 + 12, bot - top + 12);
  glass(g, x0, top, x1 - x0, bot - top, {
    top: '#a8d0ec', mid: '#5c8cbc', bot: '#2c4a7c', at: 0.2,
    inside: (gg, x, y, w, h) => { for (let i = 0; i < 18; i++) fill(gg, rgba(i % 2 ? '#e8ecee' : '#d4dade', 0.85), x + i * (w / 18), tr + 4, w / 18 - 2, (y + h - tr) * 0.75); },
  });
  frame(g, x0, top, x1 - x0, bot - top, 9, '#6a5444');
  panel(g, x0, tr - 4, x1 - x0, 8, '#6a5444', { edge: 1, hi: false });
  panel(g, (x0 + x1) / 2 - 4, tr, 8, bot - tr, '#6a5444', { edge: 1, hi: false });
  panel(g, x0 - 10, bot, x1 - x0 + 20, 10, '#e8e0d4', { edge: 1.5 });
  streak(g, x0 + 30, bot + 10, 70, 100, '#6a5a48', 0.13);
}

// fac_wall_plain — tile [4, 4]: painted concrete, formwork joints, soft rain streaks. Tintable.
function wallPlain(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#ece8e0'], [1, '#e2ddd2']]);
  for (const y of [0, 256]) { fill(g, rgba('#8a8070', 0.16), 0, y, 512, 2); fill(g, rgba('#ffffff', 0.35), 0, y + 2, 512, 1.5); }
  for (const x of [0, 256]) fill(g, rgba('#8a8070', 0.1), x, 0, 1.5, 512);
  for (let i = 0; i < 7; i++) streak(g, rng() * 480, rng() * 300, 20 + rng() * 50, 120 + rng() * 200, '#6a6050', 0.06 + rng() * 0.05);
}

// fac_wall_tile — tile [3, 3]: small brick-tile cladding, low contrast. Tintable.
function wallTile(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#dccbb2'], [1, '#d2bea2']]);
  const th = 16, tw = 48;
  for (let r = 0; r < 512 / th; r++) {
    for (let c = -1; c < 512 / tw + 1; c++) {
      const x = c * tw + (r % 2) * (tw / 2);
      vg(g, x + 1, r * th + 1, tw - 2, th - 2, [[0, rgba('#ffffff', 0.06)], [1, rgba('#5a3c20', 0.05)]]);
    }
    fill(g, rgba('#f4ece0', 0.35), 0, r * th, 512, 1.5);
  }
  for (let i = 0; i < 5; i++) streak(g, rng() * 480, rng() * 200, 30 + rng() * 40, 150 + rng() * 200, '#5a4630', 0.07);
}

// ───────────────────────────── shopfronts (two per layer, 7 m × 3.5 m each) ─────────────────────────────
// Each painter draws into a 512×256 box at (0, oy). Mapped once across a shopfront (u 0..1,
// v 0.5..1 for the top shop, 0..0.5 for the bottom one). Signs go above, as separate decals.

function shelves(g, x, y, w, h, rng, night, pitch = 22) {
  for (let sy = y; sy < y + h - 4; sy += pitch) {
    let sx = x + 2;
    while (sx < x + w - 6) {
      const pw = 5 + rng() * 10, ph = pitch * (0.45 + rng() * 0.4);
      const c = POP[Math.floor(rng() * POP.length)];
      fill(g, night ? lt(c, 0.2) : c, sx, sy + pitch - 4 - ph, pw, ph);
      fill(g, rgba('#ffffff', 0.3), sx, sy + pitch - 4 - ph, pw, 1.5);
      sx += pw + 1.5;
    }
    fill(g, night ? '#e8eef4' : '#c4ccd6', x, sy + pitch - 4, w, 4);
  }
}

function konbini(g, oy, rng, night) {
  const H = 256;
  fill(g, night ? '#000' : '#f2f4f6', 0, oy, 512, H);
  const bays = [[8, 124], [132, 252], [260, 380], [388, 504]];
  bays.forEach(([a, b], i) => {
    const y0 = oy + 24, y1 = oy + 228;
    // interior
    vg(g, a, y0, b - a, 36, [[0, night ? '#ffffff' : '#e8f2fa'], [1, night ? '#e0f0ff' : '#cfdfee']]);
    for (let k = 0; k < 3; k++) fill(g, night ? '#ffffff' : '#fafcff', a + 8 + k * 38, y0 + 8, 26, 3);
    vg(g, a, y0 + 36, b - a, y1 - y0 - 36, [[0, night ? '#d8e8ff' : '#dfe8f0'], [1, night ? '#9ab0d0' : '#b8c4d2']]);
    if (i !== 2) shelves(g, a, y0 + 44, b - a, 110, rng, night);
    if (i < 2) {
      // magazine rack at the window
      fill(g, night ? '#5a6478' : '#8a94a4', a, y1 - 70, b - a, 70);
      for (let m = 0; m < 7; m++) {
        const c = POP[Math.floor(rng() * POP.length)];
        fill(g, night ? lt(c, 0.3) : c, a + 4 + m * 16, y1 - 64 + (m % 2) * 4, 14, 26);
        fill(g, '#ffffff', a + 4 + m * 16, y1 - 64 + (m % 2) * 4, 14, 5);
      }
    }
    if (i === 2) {
      // automatic sliding doors
      vg(g, a, y0 + 36, b - a, y1 - y0 - 36, [[0, night ? '#f4f8ff' : '#dfe8f2'], [1, night ? '#b4c4dc' : '#aab8c8']]);
      shelves(g, a + 10, y0 + 52, b - a - 20, 66, rng, night);
      for (const dx of [a + (b - a) / 2 - 3]) fill(g, night ? '#000' : '#9aa6b4', dx, y0, 6, y1 - y0);
      fill(g, night ? '#ff5050' : '#e8303a', a + 6, oy + 128, b - a - 12, 7);
      if (!night) { g.save(); htext(g, '自動ドア', (a + b) / 2, oy + 144, (b - a) * 0.7, 13, FONT.jpBold, '#e8303a'); g.restore(); }
    }
    if (!night) {
      g.save(); g.beginPath(); g.rect(a, y0, b - a, y1 - y0); g.clip();
      poly(g, rgba('#ffffff', 0.18), [a + 20, y0, a + 60, y0, a - 40, y1, a - 80, y1]);
      poly(g, rgba('#ffffff', 0.12), [a + 80, y0, a + 92, y0, a - 8, y1, a - 20, y1]);
      g.restore();
    }
  });
  // posters on the glass
  const poster = (x, y, bg, draw) => { fill(g, night ? lt(bg, 0.2) : bg, x, y, 44, 58); if (!night) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, 42, 56); } draw(x, y); };
  poster(20, oy + 46, '#ffffff', (x, y) => { poly(g, '#2a2a30', [x + 22, y + 8, x + 36, y + 32, x + 8, y + 32]); fill(g, '#1e2a20', x + 14, y + 24, 16, 8); htext(g, '100円', x + 22, y + 46, 38, 14, FONT.jp, '#e02030'); });
  poster(400, oy + 46, '#2a7ad8', (x, y) => { rrect(g, x + 14, y + 8, 16, 30, 4); g.fillStyle = '#ffffff'; g.fill(); fill(g, '#ffcf2e', x + 14, y + 18, 16, 8); htext(g, '新発売', x + 22, y + 48, 38, 12, FONT.jp, '#ffffff'); });
  poster(456, oy + 46, '#ffcf2e', (x, y) => { htext(g, 'ATM', x + 22, y + 22, 36, 16, FONT.latin, '#1a3a8a'); htext(g, '24H', x + 22, y + 44, 36, 14, FONT.latin, '#e02030'); });
  // frame: mullions, header, kick plate
  for (const x of [0, 124, 252, 380, 504]) { fill(g, night ? '#000' : '#e4e8ec', x, oy, 8, H); if (!night) fill(g, '#ffffff', x + 1, oy, 2, H); }
  fill(g, night ? '#000' : '#f8fafc', 0, oy, 512, 24);
  if (!night) shadow(g, 0, oy + 24, 512, 8, 0.2);
  if (!night) panel(g, 0, oy + 228, 512, 28, '#8e98a6', { edge: 1.5 }); else fill(g, '#000', 0, oy + 228, 512, 28);
}

function ramen(g, oy, rng, night) {
  const H = 256;
  if (night) fill(g, '#000', 0, oy, 512, H);
  else {
    fill(g, '#5c3a26', 0, oy, 512, H);
    for (let x = 0; x < 512; x += 24) { fill(g, rgba('#2a160c', 0.35), x, oy, 2, H); fill(g, rgba('#ffd8a8', 0.08), x + 3, oy, 6, H); }
    panel(g, 0, oy, 512, 22, '#3e2416', { edge: 1.5 });
    panel(g, 0, oy + 232, 512, 24, '#8c867a', { edge: 1.5 });
  }
  // left window, steamed up
  const wx = 18, wy = oy + 64, ww = 190, wh = 138;
  if (night) {
    room(g, wx, wy, ww, wh, '#ffb460', { floor: 0.2 });
    fill(g, rgba('#3a1a08', 0.7), wx, wy + wh - 34, ww, 34);
    for (const cx of [60, 120, 170]) circle(g, rgba('#3a1a08', 0.7), wx + cx, wy + wh - 48, 15);
  } else {
    vg(g, wx, wy, ww, wh, [[0, '#f6e2c0'], [1, '#d0a678']]);
    for (let i = 0; i < 9; i++) { const G = g.createRadialGradient(wx + rng() * ww, wy + rng() * wh, 2, wx + rng() * ww, wy + rng() * wh, 40); G.addColorStop(0, rgba('#ffffff', 0.3)); G.addColorStop(1, rgba('#ffffff', 0)); g.fillStyle = G; g.fillRect(wx, wy, ww, wh); }
    fill(g, rgba('#5a3018', 0.45), wx, wy + wh - 34, ww, 34);
    for (const cx of [60, 120, 170]) circle(g, rgba('#5a3018', 0.45), wx + cx, wy + wh - 48, 15);
    frame(g, wx - 8, wy - 8, ww + 16, wh + 16, 9, '#3a2214');
    fill(g, '#3a2214', wx + ww / 2 - 3, wy, 6, wh);
  }
  // door with noren
  const dx = 228, dw = 124;
  if (night) {
    room(g, dx + 8, oy + 40, dw - 16, 190, '#ffc880', { floor: 0.3 });
  } else {
    panel(g, dx, oy + 30, dw, 202, '#4a2c1a', { edge: 2 });
    vg(g, dx + 10, oy + 40, dw - 20, 188, [[0, '#efe2c8'], [1, '#d8c4a0']]);
    for (let y = oy + 46; y < oy + 140; y += 14) fill(g, '#4a2c1a', dx + 10, y, dw - 20, 3);
    for (let x = dx + 10; x < dx + dw - 10; x += 20) fill(g, '#4a2c1a', x, oy + 40, 3, 100);
    fill(g, '#4a2c1a', dx + dw / 2 - 2, oy + 40, 4, 188);
  }
  // noren: four panels, らーめん
  fill(g, night ? '#000' : '#2a1a10', dx - 6, oy + 30, dw + 12, 6);
  const pw = (dw + 8) / 4;
  [...'らーめん'].forEach((c, i) => {
    const x = dx - 4 + i * pw;
    if (night) { fill(g, '#141c40', x + 1, oy + 36, pw - 3, 92); return; }
    vg(g, x + 1, oy + 36, pw - 3, 92, [[0, '#2c3c86'], [1, '#1c2860']]);
    fill(g, rgba('#ffffff', 0.12), x + 2, oy + 36, 3, 92);
    htext(g, c, x + pw / 2, oy + 82, pw - 6, 30, FONT.jp, '#ffffff');
  });
  // menu board + ticket machine
  if (!night) {
    panel(g, 372, oy + 44, 124, 96, '#caa070', { edge: 2 });
    ['醤油', '味噌', '塩', '餃子'].forEach((t, i) => { fill(g, '#f4ead4', 380 + i * 29, oy + 52, 24, 80); vtext(g, t, 392 + i * 29, oy + 56, oy + 128, 26, FONT.jp, '#1a1210'); });
    panel(g, 384, oy + 152, 64, 80, '#eef0f2', { edge: 2 });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) fill(g, POP[(r * 4 + c) % 7], 390 + c * 14, oy + 160 + r * 11, 11, 8);
    fill(g, '#2a2a34', 392, oy + 212, 48, 8);
  } else {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) fill(g, lt(POP[(r * 4 + c) % 7], 0.3), 390 + c * 14, oy + 160 + r * 11, 11, 8);
  }
}

function izakaya(g, oy, rng, night) {
  const H = 256;
  if (night) fill(g, '#000', 0, oy, 512, H);
  else {
    fill(g, '#3c2a22', 0, oy, 512, H);
    for (let x = 0; x < 512; x += 18) fill(g, rgba('#000', 0.25), x, oy, 2, H);
    panel(g, 0, oy + 236, 512, 20, '#6e665c', { edge: 1.5 });
  }
  // lattice window
  const wx = 18, wy = oy + 56, ww = 196, wh = 150;
  if (night) room(g, wx, wy, ww, wh, '#ffa648', { floor: 0.3 });
  else vg(g, wx, wy, ww, wh, [[0, '#e8d4a8'], [1, '#c8a878']]);
  for (let x = wx; x < wx + ww; x += 11) fill(g, night ? '#000' : '#5a3a24', x, wy, 5, wh);
  for (const y of [wy + 40, wy + 100]) fill(g, night ? '#000' : '#5a3a24', wx, y, ww, 5);
  if (!night) frame(g, wx - 8, wy - 8, ww + 16, wh + 16, 9, '#2c1c14');
  // sudare over the window top
  if (!night) { vg(g, wx - 6, oy + 26, ww + 12, 46, [[0, '#d8c08a'], [1, '#b89a64']]); for (let y = oy + 28; y < oy + 72; y += 4) fill(g, rgba('#6a5030', 0.4), wx - 6, y, ww + 12, 1.2); }
  // door + red noren 居酒屋
  const dx = 232, dw = 112;
  if (night) room(g, dx + 8, oy + 36, dw - 16, 196, '#ffb868', { floor: 0.3 });
  else { panel(g, dx, oy + 28, dw, 208, '#2c1c14', { edge: 2 }); vg(g, dx + 8, oy + 36, dw - 16, 196, [[0, '#e6d6b4'], [1, '#c4a880']]); fill(g, '#2c1c14', dx + dw / 2 - 2, oy + 36, 4, 196); }
  const pw = (dw + 8) / 3;
  [...'居酒屋'].forEach((c, i) => {
    const x = dx - 4 + i * pw;
    if (night) { fill(g, '#300808', x + 1, oy + 34, pw - 3, 100); return; }
    vg(g, x + 1, oy + 34, pw - 3, 100, [[0, '#cc2c30'], [1, '#9a1a20']]);
    htext(g, c, x + pw / 2, oy + 88, pw - 8, 30, FONT.jp, '#ffffff');
  });
  if (!night) fill(g, '#1a100a', dx - 6, oy + 28, dw + 12, 6);
  // sake barrels (komodaru) and chalkboard
  const labels = ['菊', '鶴', '福', '月'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const bx = 366 + c * 66, by = oy + 236 - (r + 1) * 58;
    if (night) { fill(g, '#000', bx, by, 62, 56); continue; }
    rrect(g, bx, by, 62, 56, 10); g.fillStyle = '#ece0bc'; g.fill();
    vg(g, bx, by + 30, 62, 26, [[0, rgba('#8a7040', 0)], [1, rgba('#8a7040', 0.35)]]);
    for (const y of [by + 8, by + 46]) fill(g, '#6a4a2a', bx + 2, y, 58, 3);
    g.save(); g.translate(bx + 31, by + 27); g.rotate(Math.PI / 4); fill(g, '#ffffff', -12, -12, 24, 24); g.restore();
    htext(g, labels[r * 2 + c], bx + 31, by + 28, 22, 18, FONT.jp, c === r ? '#c41a20' : '#1a1a20');
  }
  if (!night) {
    panel(g, 372, oy + 22, 120, 92, '#6a4a30', { edge: 2 });
    fill(g, '#24302a', 378, oy + 28, 108, 80);
    htext(g, '本日のおすすめ', 432, oy + 40, 100, 13, FONT.jpBold, '#f4f0d8');
    ['刺身', '焼鳥', 'おでん'].forEach((t, i) => htext(g, t, 432, oy + 62 + i * 17, 90, 13, FONT.jpBold, i === 1 ? '#ffd860' : '#e8f0e8'));
  }
}

function cafe(g, oy, rng, night) {
  const H = 256, green = '#2c7052';
  if (night) fill(g, '#000', 0, oy, 512, H);
  else {
    fill(g, green, 0, oy, 512, H);
    panel(g, 0, oy, 512, 30, '#efe4c8', { edge: 2 });
    fill(g, '#c8a040', 0, oy + 30, 512, 3);
    panel(g, 0, oy + 236, 512, 20, '#24583e', { edge: 1.5 });
  }
  const wx = 16, wy = oy + 46, ww = 292, wh = 178;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#ffd890'], [1, '#c0682a']] : [[0, '#8a5a3a'], [1, '#5a3420']]);
    for (const sy of [y + 40, y + 76]) { fill(gg, night ? '#7a3810' : '#3a2010', x + 10, sy, w - 20, 4); for (let i = 0; i < 12; i++) fill(gg, night ? '#fff0d0' : '#f0e8dc', x + 18 + i * 22, sy - 10, 10, 10); }
    for (const lx of [x + 50, x + 146, x + 242]) { line(gg, night ? '#000' : '#2a1a10', 2, lx, y, lx, y + 22); poly(gg, night ? '#ffe2a0' : '#d8a040', [lx - 14, y + 34, lx + 14, y + 34, lx + 8, y + 22, lx - 8, y + 22]); circle(gg, night ? '#ffffff' : '#fff4c8', lx, y + 36, 5); }
    fill(gg, night ? '#5a2808' : '#3a2214', x, y + h - 40, w, 40);
    circle(gg, night ? '#3a6020' : '#3c8a3c', x + 20, y + h - 60, 26);
    fill(gg, night ? '#3a2008' : '#8a5a30', x + 10, y + h - 40, 22, 30);
  };
  if (night) interior(g, wx, wy, ww, wh);
  else { glass(g, wx, wy, ww, wh, { top: '#e8d0a8', mid: '#8a6040', bot: '#4a2c18', glint: 0.7, inside: interior }); frame(g, wx - 6, wy - 6, ww + 12, wh + 12, 7, green); fill(g, green, wx + ww / 2 - 3, wy, 6, wh); htext(g, 'CAFÉ MIDORI', wx + 75, wy + 150, 120, 16, FONT.latinBold, rgba('#ffffff', 0.9)); }
  // door with round window
  const dx = 324, dy = oy + 46;
  if (night) { circle(g, '#ffcc78', dx + 40, dy + 50, 26); }
  else {
    panel(g, dx, dy, 80, 190, '#24603f', { edge: 2 });
    circle(g, '#e6c890', dx + 40, dy + 50, 26); circle(g, '#a87850', dx + 40, dy + 56, 20);
    g.strokeStyle = '#c8a040'; g.lineWidth = 4; g.beginPath(); g.arc(dx + 40, dy + 50, 27, 0, Math.PI * 2); g.stroke();
    fill(g, '#c8a040', dx + 64, dy + 96, 5, 30);
  }
  // small window + A-frame chalkboard
  if (night) room(g, 420, oy + 46, 76, 90, '#ffc070');
  else { glass(g, 420, oy + 46, 76, 90, { top: '#e8d0a8', mid: '#8a6040', bot: '#4a2c18' }); frame(g, 414, oy + 40, 88, 102, 7, green); }
  if (!night) {
    poly(g, '#8a6038', [424, oy + 236, 434, oy + 150, 482, oy + 150, 492, oy + 236]);
    poly(g, '#1e2622', [430, oy + 228, 438, oy + 158, 478, oy + 158, 486, oy + 228]);
    htext(g, 'COFFEE', 458, oy + 174, 40, 12, FONT.latin, '#f4ecd8');
    htext(g, '珈琲', 458, oy + 196, 40, 18, FONT.jp, '#ffd480');
    htext(g, '¥300', 458, oy + 216, 40, 11, FONT.latinBold, '#f4ecd8');
  }
}

function salon(g, oy, rng, night) {
  const H = 256, pink = '#ec6a9e';
  if (night) fill(g, '#000', 0, oy, 512, H);
  else { fill(g, '#f6f2f0', 0, oy, 512, H); fill(g, pink, 0, oy + 26, 512, 6); panel(g, 0, oy + 238, 512, 18, '#d8d0d4', { edge: 1.5 }); }
  const wx = 16, wy = oy + 46, ww = 320, wh = 186;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#ffffff'], [1, '#f0c8d8']] : [[0, '#f4eef0'], [1, '#d8ccd4']]);
    for (let i = 0; i < 3; i++) {
      const mx = x + 30 + i * 100;
      panel(gg, mx, y + 24, 56, 92, night ? '#d0f0ff' : '#c4dcec', { edge: 3, rim: night ? '#000' : '#8a8a96' });
      rrect(gg, mx + 6, y + 110, 44, 46, 12); gg.fillStyle = night ? '#4a2a3a' : '#3a2e3e'; gg.fill();
      fill(gg, night ? '#4a2a3a' : '#3a2e3e', mx + 24, y + 156, 8, h - 156);
    }
    circle(gg, night ? '#2e7a3a' : '#4aa050', x + w - 20, y + 30, 18);
  };
  if (night) interior(g, wx, wy, ww, wh);
  else { glass(g, wx, wy, ww, wh, { top: '#ffffff', mid: '#e8e0e8', bot: '#c4b8c8', glint: 0.9, inside: interior }); frame(g, wx - 6, wy - 6, ww + 12, wh + 12, 7, '#e8e2e6'); htext(g, 'HAIR SALON', wx + 80, wy + 18, 130, 14, FONT.latinBold, pink); }
  // door
  if (night) room(g, 354, oy + 50, 76, 182, '#ffe8f0');
  else { glass(g, 354, oy + 50, 76, 182, { top: '#fff', mid: '#e0d8e0', bot: '#b8acbc' }); frame(g, 348, oy + 44, 88, 194, 7, '#e8e2e6'); rrect(g, 366, oy + 112, 52, 20, 4); g.fillStyle = pink; g.fill(); htext(g, 'OPEN', 392, oy + 122, 44, 13, FONT.latin, '#fff'); }
  // barber pole
  const bx = 456, by = oy + 60;
  if (night) { fill(g, '#fff0f0', bx, by, 28, 120); for (let i = -6; i < 12; i++) poly(g, i % 2 ? '#ff4060' : '#4080ff', [bx, by + i * 20, bx + 28, by + i * 20 - 14, bx + 28, by + i * 20 - 6, bx, by + i * 20 + 8]); return; }
  panel(g, bx - 6, by - 16, 40, 16, '#c8ccd4', { edge: 1.5 });
  panel(g, bx - 6, by + 120, 40, 16, '#c8ccd4', { edge: 1.5 });
  g.save(); g.beginPath(); g.rect(bx, by, 28, 120); g.clip();
  fill(g, '#ffffff', bx, by, 28, 120);
  for (let i = -6; i < 12; i++) poly(g, i % 2 ? '#e8283c' : '#2a5ad8', [bx, by + i * 20, bx + 28, by + i * 20 - 14, bx + 28, by + i * 20 - 6, bx, by + i * 20 + 8]);
  hg(g, bx, by, 28, 120, [[0, rgba('#000', 0.2)], [0.35, rgba('#fff', 0.35)], [1, rgba('#000', 0.25)]]);
  g.restore();
}

function pachinko(g, oy, rng, night) {
  const H = 256;
  if (night) fill(g, '#000', 0, oy, 512, H);
  else { vg(g, 0, oy, 512, H, [[0, '#ffe07a'], [0.5, '#f0b030'], [1, '#c8801a']]); }
  // bulb border
  const bulbs = (x0, y0, x1, y1) => { const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14)); for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; if (night) circle(g, i % 2 ? '#ffffff' : '#ffe080', x, y, 4.5); else { circle(g, '#a0601a', x, y, 5); circle(g, '#fff8e0', x - 1, y - 1, 3.5); } } };
  bulbs(8, oy + 10, 504, oy + 10); bulbs(8, oy + 10, 8, oy + 246); bulbs(504, oy + 10, 504, oy + 246);
  bulbs(140, oy + 40, 372, oy + 40);
  // doors and interior
  const dx = 150, dy = oy + 52, dw = 212, dh = 184;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#ffffff'], [1, '#ffd0d0']] : [[0, '#fff4e8'], [1, '#e8c8c0']]);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) {
      const mx = x + 6 + i * 23, my = y + 30 + r * 60;
      fill(gg, night ? lt(POP[(i + r) % 7], 0.2) : POP[(i + r) % 7], mx, my, 19, 46);
      circle(gg, night ? '#ffffff' : '#f4f4f8', mx + 9.5, my + 18, 7);
    }
    vg(gg, x, y + h - 40, w, 40, [[0, night ? '#ff3040' : '#c8202c'], [1, night ? '#a01020' : '#8a1018']]);
  };
  if (night) interior(g, dx, dy, dw, dh);
  else { glass(g, dx, dy, dw, dh, { inside: interior, glint: 0.8 }); frame(g, dx - 6, dy - 6, dw + 12, dh + 12, 8, '#d8a030'); fill(g, '#d8a030', dx + dw / 2 - 3, dy, 6, dh); }
  // posters: 新台入替 and 777
  const banner = (x, draw) => { if (night) fill(g, '#ffe040', x, oy + 40, 112, 196); else panel(g, x, oy + 40, 112, 196, '#ffe23a', { edge: 3, rim: '#c8201c' }); draw(x); };
  banner(22, (x) => vtext(g, '新台入替', x + 56, oy + 52, oy + 226, 44, FONT.jp, night ? '#ff2020' : '#d81c1c', { stroke: night ? null : '#ffffff', strokeWidth: 6 }));
  banner(378, (x) => {
    htext(g, '777', x + 56, oy + 100, 100, 54, FONT.latin, night ? '#ff2020' : '#e01818', { stroke: '#ffffff', strokeWidth: 6 });
    for (let i = 0; i < 5; i++) { const sx = x + 16 + i * 20, sy = oy + 150 + (i % 2) * 18; poly(g, night ? '#ff60c0' : '#2a7ad8', [sx, sy - 9, sx + 3, sy - 3, sx + 9, sy - 3, sx + 4, sy + 2, sx + 6, sy + 9, sx, sy + 5, sx - 6, sy + 9, sx - 4, sy + 2, sx - 9, sy - 3, sx - 3, sy - 3]); }
    htext(g, '大当り', x + 56, oy + 206, 96, 28, FONT.jp, night ? '#ff2020' : '#d81c1c');
  });
}

function shutter(g, oy, rng, night) {
  const H = 256;
  if (night) { fill(g, '#000', 0, oy, 512, H); return; }
  fill(g, '#d8d0c4', 0, oy, 512, H);
  panel(g, 0, oy, 22, H, '#c8bfb2', { edge: 2 });
  panel(g, 490, oy, 22, H, '#c8bfb2', { edge: 2 });
  panel(g, 22, oy, 468, 28, '#b8bec6', { edge: 2 });
  vg(g, 22, oy + 28, 468, 218, [[0, '#d4dae0'], [1, '#aab2bc']]);
  for (let y = oy + 32; y < oy + 244; y += 9) { fill(g, rgba('#ffffff', 0.45), 22, y, 468, 2); fill(g, rgba('#4a4a5a', 0.22), 22, y + 6, 468, 2); }
  panel(g, 22, oy + 240, 468, 12, '#7a8290', { edge: 1.5 });
  fill(g, '#3a3a44', 250, oy + 243, 12, 5);
  streak(g, 80, oy + 30, 60, 200, '#6a5a48', 0.12);
  streak(g, 380, oy + 30, 40, 160, '#6a5a48', 0.1);
  // a tag on the shutter
  g.save(); g.translate(130, oy + 170); g.rotate(-0.08);
  htext(g, 'SUZU', 0, 0, 150, 58, FONT.tag, '#ff3f9a', { stroke: '#1a1030', strokeWidth: 7 });
  g.restore();
  for (const x of [92, 118, 170]) { fill(g, '#ff3f9a', x, oy + 190, 3, 18 + (x % 13)); circle(g, '#ff3f9a', x + 1.5, oy + 208 + (x % 13), 2.4); }
  // for-rent notice
  panel(g, 318, oy + 76, 92, 72, '#ffffff', { edge: 3, rim: '#d8202c', grad: 0.02 });
  htext(g, '貸店舗', 364, oy + 100, 80, 24, FONT.jp, '#d8202c');
  htext(g, 'テナント募集', 364, oy + 128, 80, 13, FONT.jpBold, '#1a1a2a');
}

function bakery(g, oy, rng, night) {
  const H = 256, brown = '#8a5634';
  if (night) fill(g, '#000', 0, oy, 512, H);
  else { fill(g, '#f4e4c4', 0, oy, 512, H); panel(g, 0, oy, 512, 24, brown, { edge: 2 }); panel(g, 0, oy + 236, 512, 20, '#a87048', { edge: 1.5 }); }
  const wx = 16, wy = oy + 40, ww = 288, wh = 186;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#fff0c8'], [1, '#e09850']] : [[0, '#f8ecd4'], [1, '#d8b88c']]);
    for (let r = 0; r < 3; r++) {
      const sy = y + 48 + r * 52;
      fill(gg, night ? '#a05a20' : '#a87048', x + 6, sy, w - 12, 5);
      for (let i = 0; i < 9; i++) {
        const bx = x + 16 + i * 31, kind = (i + r) % 3;
        const c = ['#d08a40', '#b86a2c', '#e8b060'][kind];
        if (kind === 0) { rrect(gg, bx, sy - 18, 24, 18, 9); gg.fillStyle = night ? lt(c, 0.25) : c; gg.fill(); fill(gg, rgba('#fff4d8', 0.6), bx + 5, sy - 15, 12, 3); }
        else if (kind === 1) { circle(gg, night ? lt(c, 0.25) : c, bx + 12, sy - 10, 10); circle(gg, rgba('#fff4d8', 0.5), bx + 9, sy - 13, 3); }
        else { poly(gg, night ? lt(c, 0.25) : c, [bx, sy - 2, bx + 12, sy - 18, bx + 26, sy - 2, bx + 12, sy - 8]); }
      }
    }
  };
  if (night) interior(g, wx, wy, ww, wh);
  else { glass(g, wx, wy, ww, wh, { top: '#fff8e8', mid: '#e8d0a8', bot: '#b89068', glint: 0.8, inside: interior }); frame(g, wx - 6, wy - 6, ww + 12, wh + 12, 7, brown); htext(g, 'BAKERY パン', wx + 70, wy + 22, 110, 15, FONT.jp, '#ffffff', { stroke: brown, strokeWidth: 4 }); }
  if (night) room(g, 326, oy + 46, 78, 186, '#ffd8a0');
  else { panel(g, 320, oy + 40, 90, 196, brown, { edge: 2 }); glass(g, 330, oy + 52, 70, 110, { top: '#fff8e8', mid: '#e8d0a8', bot: '#b89068' }); fill(g, '#e0b040', 392, oy + 150, 5, 24); }
  if (night) room(g, 424, oy + 46, 74, 120, '#ffe0b0');
  else {
    glass(g, 424, oy + 46, 74, 120, { top: '#fff8e8', mid: '#f0dcc0', bot: '#c8a888', inside: (gg, x, y, w, h) => { for (let i = 0; i < 3; i++) { fill(gg, '#ffffff', x + 6 + i * 22, y + 60, 18, 14); fill(gg, ['#ff8aa8', '#ffd060', '#c88a50'][i], x + 6 + i * 22, y + 54, 18, 8); } } });
    frame(g, 418, oy + 40, 86, 132, 7, brown);
    for (let i = 0; i < 3; i++) { fill(g, '#5a8a3a', 430 + i * 22, oy + 186, 16, 12); fill(g, '#a85a34', 432 + i * 22, oy + 198, 12, 36); }
  }
}

function lobby(g, oy, rng, night) {
  const H = 256;
  if (night) fill(g, '#000', 0, oy, 512, H);
  else {
    vg(g, 0, oy, 512, H, [[0, '#4a4a5c'], [1, '#34343e']]);
    for (let x = 0; x < 512; x += 64) { fill(g, rgba('#000', 0.3), x, oy, 2, H); fill(g, rgba('#ffffff', 0.07), x + 10, oy, 14, H); }
    for (let y = oy + 64; y < oy + H; y += 64) fill(g, rgba('#000', 0.3), 0, y, 512, 2);
  }
  const dx = 150, dy = oy + 40, dw = 212, dh = 196;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#ffffff'], [1, '#c8d8f0']] : [[0, '#e8eef4'], [1, '#b8c4d0']]);
    fill(gg, night ? '#a8b8d0' : '#9aa6b4', x, y + h - 30, w, 30);
    panel(gg, x + 30, y + h - 74, 90, 44, night ? '#5a4030' : '#4a3a30', { edge: 2 });
    panel(gg, x + w - 66, y + 30, 48, h - 60, night ? '#e0e8f4' : '#aab4c0', { edge: 2 });
    fill(gg, night ? '#000' : '#7a8490', x + w - 43, y + 30, 2, h - 60);
    circle(gg, night ? '#2a6030' : '#3a8a44', x + 150, y + h - 60, 20); fill(gg, '#6a4a3a', x + 142, y + h - 44, 16, 14);
  };
  if (night) interior(g, dx, dy, dw, dh);
  else { glass(g, dx, dy, dw, dh, { inside: interior, glint: 1, top: '#e0f0ff', mid: '#a8c4e0', bot: '#6a86a8' }); frame(g, dx - 8, dy - 8, dw + 16, dh + 16, 9, '#a8b0bc'); fill(g, '#a8b0bc', dx + dw / 2 - 3, dy, 6, dh); for (const hx of [dx + dw / 2 - 16, dx + dw / 2 + 10]) fill(g, '#e4e8ee', hx, dy + 80, 6, 50); }
  // canopy shadow and directory plaque
  if (!night) shadow(g, 0, oy, 512, 30, 0.35);
  if (night) { fill(g, '#ffe0a0', 44, oy + 80, 80, 104); }
  else {
    panel(g, 40, oy + 76, 88, 112, '#c8a050', { edge: 3, rim: '#6a4a1a' });
    for (let i = 0; i < 7; i++) { fill(g, '#4a3410', 50, oy + 92 + i * 13, 16, 6); fill(g, rgba('#4a3410', 0.7), 72, oy + 92 + i * 13, 46, 6); }
  }
  if (night) fill(g, '#fff4d0', 400, oy + 100, 70, 24);
  else { panel(g, 396, oy + 96, 78, 32, '#e8e4dc', { edge: 2 }); htext(g, 'ENTRANCE', 435, oy + 112, 68, 12, FONT.latinBold, '#3a3a48'); }
}

function drugstore(g, oy, rng, night) {
  const H = 256;
  if (night) fill(g, '#000', 0, oy, 512, H);
  else { fill(g, '#ffffff', 0, oy, 512, H); fill(g, '#2a9a4a', 0, oy, 512, 18); panel(g, 0, oy + 238, 512, 18, '#c0c8cc', { edge: 1.5 }); }
  const wx = 8, wy = oy + 26, ww = 496, wh = 206;
  const interior = (gg, x, y, w, h) => {
    vg(gg, x, y, w, h, night ? [[0, '#ffffff'], [1, '#d8f0e0']] : [[0, '#f4faf6'], [1, '#d0dcd4']]);
    shelves(gg, x + 4, y + 20, w - 8, 130, rng, night, 20);
  };
  if (night) interior(g, wx, wy, ww, wh);
  else { glass(g, wx, wy, ww, wh, { inside: interior, glint: 0.6, top: '#ffffff', mid: '#eef4f0', bot: '#c8d4cc' }); for (const x of [0, 168, 336, 504]) fill(g, '#dce4e0', x, wy, 8, wh); }
  // bright yellow price posters
  const post = (x, y, w, h, a, b) => { if (night) fill(g, '#fff040', x, y, w, h); else panel(g, x, y, w, h, '#ffe62a', { edge: 2, rim: '#e01818' }); htext(g, a, x + w / 2, y + h * 0.34, w - 10, h * 0.34, FONT.jp, '#e01818'); htext(g, b, x + w / 2, y + h * 0.74, w - 8, h * 0.3, FONT.jp, '#1a1a2a'); };
  post(24, oy + 40, 104, 84, '特価', '198円');
  post(376, oy + 40, 116, 70, 'ポイント', '5倍デー');
  // くすり sign on glass
  if (night) fill(g, '#ffffff', 188, oy + 34, 120, 40);
  else { panel(g, 188, oy + 34, 120, 40, '#ffffff', { edge: 3, rim: '#2a9a4a' }); }
  htext(g, 'くすり', 248, oy + 54, 104, 30, FONT.jp, '#2a9a4a');
  // stacked baskets out front
  for (let i = 0; i < 4; i++) { if (night) continue; panel(g, 400, oy + 226 - i * 9, 80, 12, '#e8303a', { edge: 1.5 }); }
  if (!night) for (let x = 404; x < 476; x += 8) fill(g, rgba('#7a0010', 0.4), x, oy + 200, 3, 34);
}

function shopLayer(name, top, bot) {
  // same random stream for albedo and emissive so lit shelves line up with painted ones
  const r = (k) => rngFor(name + k);
  return def(name, (g) => { top(g, 0, r('t'), false); bot(g, 256, r('b'), false); fill(g, '#5a5060', 0, 254, 512, 4); },
    (g, rng, K) => {
      top(g, 0, r('t'), true); bot(g, 256, r('b'), true); fill(g, '#000', 0, 252, 512, 8);
      K('always', 0, 0, 512, 252); K('always', 0, 260, 512, 252);
    });
}

// ───────────────────────────── Old Town ─────────────────────────────

// fac_koshi — tile [1.82, 2.9]: machiya ground-floor lattice bay (one ken per repeat).
function koshi(g, night) {
  const M = metric(1.82, 2.9);
  const top = M.y(2.55), bot = M.y(0.32);
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 18, top, 476, bot - top, '#ffb058', { floor: 0.35 });
    for (let x = 18; x < 494; x += 13) fill(g, '#000', x, top, 8, bot - top);
    for (const y of [M.y(1.85), M.y(1.0)]) fill(g, '#000', 18, y - 5, 476, 10);
    return;
  }
  // shoji glow behind (pale paper with dark grid) seen between bars
  vg(g, 18, top, 476, bot - top, [[0, '#e8dcc0'], [1, '#c4b08a']]);
  for (let y = top; y < bot; y += 60) fill(g, rgba('#5a4028', 0.35), 18, y, 476, 3);
  // lattice bars (kōshi): wood with lit left edge
  for (let x = 18; x < 494; x += 13) { hg(g, x, top, 8, bot - top, [[0, '#9a6a44'], [0.4, '#7a4e30'], [1, '#4a2c1a']]); }
  for (const y of [M.y(1.85), M.y(1.0)]) panel(g, 18, y - 5, 476, 10, '#6a4228', { edge: 1, grad: 0.15 });
  // posts and beams
  panel(g, 0, 0, 18, 512, '#4a2c1a', { edge: 1.5, hi: false });
  panel(g, 494, 0, 18, 512, '#4a2c1a', { edge: 1.5, hi: false });
  panel(g, 0, 0, 512, top, '#5a3622', { edge: 2 });
  shadow(g, 18, top, 476, 18, 0.4);
  // stone footing
  panel(g, 0, bot, 512, 512 - bot, '#9c968c', { edge: 2, grad: 0.15 });
  fill(g, rgba('#5a5048', 0.3), 0, bot + 30, 512, 2);
}

// fac_mushiko — tile [1.82, 2.3]: machiya upper floor, plaster with a mushiko-mado slatted window.
function mushiko(g, night) {
  const M = metric(1.82, 2.3);
  const x0 = M.x(0.28), x1 = M.x(1.54), top = M.y(1.62), bot = M.y(0.72);
  const slats = () => { const n = 7, sw = (x1 - x0) / n; return Array.from({ length: n }, (_, i) => x0 + i * sw + sw * 0.18).map((x) => [x, sw * 0.64]); };
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, x0, top, x1 - x0, bot - top, '#ffa24a', { floor: 0.2 });
    for (const [x, w] of slats()) fill(g, '#000', x, top, w, bot - top);
    return;
  }
  vg(g, 0, 0, 512, 512, [[0, '#e4d4ae'], [1, '#d6c298']]);
  streak(g, x0 + 40, bot + 10, 120, 140, '#7a6040', 0.12);
  // plaster surround (raised), dark opening, slats
  panel(g, x0 - 22, top - 22, x1 - x0 + 44, bot - top + 44, '#ece0c4', { edge: 2, grad: 0.08 });
  fill(g, '#2a1e18', x0, top, x1 - x0, bot - top);
  for (const [x, w] of slats()) { hg(g, x, top, w, bot - top, [[0, '#fff4dc'], [0.5, '#e8dcc0'], [1, '#b8a888']]); }
  shadow(g, x0, top, x1 - x0, 10, 0.4);
  // posts, sill beam, top beam (under eaves)
  panel(g, 0, 0, 16, 512, '#4a2c1a', { edge: 1.5, hi: false });
  panel(g, 496, 0, 16, 512, '#4a2c1a', { edge: 1.5, hi: false });
  panel(g, 0, 512 - 34, 512, 34, '#4e2e1c', { edge: 2 });
  panel(g, 0, 0, 512, 26, '#4e2e1c', { edge: 2 });
  shadow(g, 16, 26, 480, 36, 0.35);
}

// fac_plaster — tile [3, 3]: white lime plaster with soft trowel strokes. Tintable.
function plaster(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#f6f2ea'], [1, '#ece6da']]);
  for (let i = 0; i < 26; i++) {
    const x = rng() * 512, y = rng() * 512, r = 40 + rng() * 90;
    const G = g.createRadialGradient(x, y, 2, x, y, r);
    G.addColorStop(0, rgba(rng() < 0.5 ? '#ffffff' : '#d8ccb8', 0.18)); G.addColorStop(1, rgba('#ffffff', 0));
    g.fillStyle = G; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 4; i++) streak(g, rng() * 480, rng() * 200, 30 + rng() * 40, 160 + rng() * 140, '#7a6e5a', 0.06);
}

// fac_namako — tile [1, 1]: namako-kabe, slate tiles set diagonally with raised white joints.
function namako(g) {
  fill(g, '#4c5462', 0, 0, 512, 512);
  // diamonds: for each tile centre on a 128 grid (offset), shade top-left light
  const P = 128;
  for (let cy = -P; cy <= 512 + P; cy += P / 2) for (let cx = -P; cx <= 512 + P; cx += P) {
    const ox = ((cy / (P / 2)) % 2 === 0) ? 0 : P / 2;
    const x = cx + ox, y = cy, r = P / 2;
    const G = g.createLinearGradient(x - r, y - r, x + r, y + r);
    G.addColorStop(0, '#6a7486'); G.addColorStop(0.5, '#4c5464'); G.addColorStop(1, '#363c4a');
    g.fillStyle = G; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill();
  }
  // raised plaster joints along both diagonals
  g.lineCap = 'round';
  for (let k = -512; k <= 1024; k += P) {
    for (const [w, c] of [[16, '#c8c2b8'], [11, '#f2eee6'], [4, '#ffffff']]) {
      line(g, c, w, k, 0, k + 512, 512);
      line(g, c, w, k + 512, 0, k, 512);
    }
  }
}

// fac_wood — tile [2, 3]: weathered vertical boards with battens. Tint darker for charred cedar.
function woodBoards(g, rng) {
  fill(g, '#7c5a3c', 0, 0, 512, 512);
  for (let x = 0; x < 512; x += 64) {
    const c = mix('#7c5a3c', rng() < 0.5 ? '#8e6a48' : '#6e4e32', 0.6);
    hg(g, x, 0, 64, 512, [[0, lt(c, 0.08)], [0.5, c], [1, dk(c, 0.1)]]);
    for (let i = 0; i < 3; i++) streak(g, x + 8 + rng() * 40, rng() * 300, 6 + rng() * 10, 200, '#3a2414', 0.12);
  }
  for (let x = 0; x < 512; x += 64) panel(g, x - 7, 0, 14, 512, '#6a4a30', { edge: 1, hi: false, grad: 0.05 });
  for (const y of [120, 380]) panel(g, 0, y, 512, 12, '#5a3e28', { edge: 1, grad: 0.1 });
}

// ───────────────────────────── Docks / industrial ─────────────────────────────

// fac_corrugated — tile [2.4, 3]: corrugated sheet, soft rib shading, rust streaks. Tintable.
function corrugated(g, rng) {
  const P = 32;
  for (let x = 0; x < 512; x += P) hg(g, x, 0, P, 512, [[0, '#c4cad0'], [0.3, '#f2f6f8'], [0.55, '#dce2e6'], [0.8, '#aab2ba'], [1, '#c4cad0']]);
  // overlap seam + fixing line
  fill(g, rgba('#3a3a4a', 0.2), 0, 40, 512, 3); fill(g, rgba('#ffffff', 0.4), 0, 43, 512, 2);
  fill(g, rgba('#3a3a4a', 0.12), 0, 300, 512, 2);
  for (let i = 0; i < 6; i++) streak(g, rng() * 480, 30 + rng() * 60, 10 + rng() * 26, 200 + rng() * 240, '#a0582a', 0.14 + rng() * 0.12);
  for (let i = 0; i < 4; i++) streak(g, rng() * 480, 0, 30 + rng() * 40, 300, '#5a5a6a', 0.06);
}

// fac_sandwich — tile [3, 3]: insulated sandwich panels with horizontal seams. Tintable.
function sandwich(g, rng) {
  const P = 512 / 3;
  for (let i = 0; i < 3; i++) {
    vg(g, 0, i * P, 512, P, [[0, '#f6f8fa'], [0.85, '#e4e8ec'], [1, '#d0d6dc']]);
    fill(g, rgba('#3a4050', 0.3), 0, i * P, 512, 3); fill(g, rgba('#ffffff', 0.8), 0, i * P + 3, 512, 2);
    for (let x = 30; x < 512; x += 64) fill(g, rgba('#aab2bc', 0.25), x, i * P + 6, 2, P - 8);
  }
  for (let i = 0; i < 4; i++) streak(g, rng() * 480, rng() * 300, 30 + rng() * 40, 160, '#6a6a72', 0.06);
}

// fac_rolldoor — mapped once per door (u,v 0..1): steel roller door in a frame with chevrons.
function rollDoor(g, rng) {
  fill(g, '#9aa2ac', 0, 0, 512, 512);
  vg(g, 40, 64, 432, 430, [[0, '#dfe4ea'], [1, '#b4bcc6']]);
  for (let y = 66; y < 490; y += 12) { fill(g, rgba('#ffffff', 0.55), 40, y, 432, 2.5); fill(g, rgba('#3a4050', 0.25), 40, y + 8, 432, 2.5); }
  // roll housing, guide posts with chevrons, bottom bar
  panel(g, 0, 0, 512, 64, '#8a929e', { edge: 2.5 });
  shadow(g, 40, 64, 432, 16, 0.35);
  for (const x of [0, 472]) {
    panel(g, x, 64, 40, 448, '#7a828e', { edge: 2 });
    g.save(); g.beginPath(); g.rect(x + 4, 340, 32, 168); g.clip();
    fill(g, '#ffd21a', x + 4, 340, 32, 168);
    for (let y = 300; y < 520; y += 28) poly(g, '#1e1e28', [x + 4, y, x + 36, y - 20, x + 36, y - 6, x + 4, y + 14]);
    g.restore();
  }
  panel(g, 40, 488, 432, 18, '#5a6270', { edge: 1.5 });
  fill(g, '#2a2a34', 40, 506, 432, 6);
  panel(g, 236, 470, 40, 14, '#c8ccd2', { edge: 1.5 });
  streak(g, 120, 70, 60, 300, '#7a5a3a', 0.12);
  streak(g, 330, 70, 40, 260, '#7a5a3a', 0.1);
  for (let i = 0; i < 3; i++) streak(g, 60 + rng() * 380, 400, 30, 100, '#4a4048', 0.12);
}

// fac_whwin — tile [3, 1.2]: warehouse clerestory strip of ribbed polycarbonate.
function whWindow(g, night) {
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    room(g, 6, 40, 500, 432, '#dcecff', { floor: 0.3 });
    for (let x = 6; x < 506; x += 16) fill(g, rgba('#000', 0.15), x, 40, 4, 432);
    return;
  }
  fill(g, '#8a929c', 0, 0, 512, 512);
  vg(g, 6, 40, 500, 432, [[0, '#f0f8f2'], [0.5, '#c8dcd4'], [1, '#a0b8b4']]);
  for (let x = 6; x < 506; x += 16) hg(g, x, 40, 16, 432, [[0, rgba('#ffffff', 0.25)], [0.5, rgba('#ffffff', 0)], [1, rgba('#4a6a6a', 0.15)]]);
  for (const x of [0, 506]) panel(g, x, 0, 6, 512, '#7a828c', { edge: 0, hi: false });
  panel(g, 0, 0, 512, 40, '#9aa2ac', { edge: 2 });
  panel(g, 0, 472, 512, 40, '#b4bcc4', { edge: 2 });
  shadow(g, 6, 40, 500, 30, 0.3);
}

// ───────────────────────────── Suburbs ─────────────────────────────

// fac_siding — tile [3, 3]: ceramic lap siding, 0.2 m boards. Tintable.
function siding(g, rng) {
  const P = 512 / 15;
  for (let i = 0; i < 15; i++) {
    const y = i * P;
    vg(g, 0, y, 512, P, [[0, '#f6f0e4'], [0.8, '#e8e0d0'], [1, '#c8bca8']]);
    fill(g, rgba('#4a3c30', 0.25), 0, y + P - 2, 512, 2);
    const jx = ((i * 197) % 512);
    fill(g, rgba('#7a6a58', 0.25), jx, y, 2, P);
  }
  for (let i = 0; i < 4; i++) streak(g, rng() * 480, rng() * 300, 30 + rng() * 30, 160, '#6a5a48', 0.06);
}

// fac_mortar — tile [3, 3]: hand-troweled mortar (stucco), soft clouded. Tintable.
function mortar(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#f2ecdf'], [1, '#e8e0d0']]);
  for (let i = 0; i < 60; i++) {
    const x = rng() * 512, y = rng() * 512, r = 18 + rng() * 50;
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
      const G = g.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, r);
      G.addColorStop(0, rgba(rng() < 0.5 ? '#ffffff' : '#c8b8a0', 0.14)); G.addColorStop(1, rgba('#ffffff', 0));
      g.fillStyle = G; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
  for (let i = 0; i < 3; i++) streak(g, rng() * 480, rng() * 300, 40, 180, '#6a5a48', 0.07);
}

// ───────────────────────────── roofs ─────────────────────────────

// roof_kawara — tile [1.2, 1.0]: sangawara (S-tile) rows; u along the eaves, v up the slope. Tintable.
function kawara(g) {
  const CW = 128, RH = 128;
  for (let r = 0; r < 4; r++) {
    const y = r * RH;
    for (let c = 0; c < 4; c++) {
      const x = c * CW;
      hg(g, x, y, CW, RH, [[0, '#5a6272'], [0.18, '#8c96a6'], [0.35, '#b8c2d0'], [0.5, '#9aa4b4'], [0.7, '#6a7484'], [0.88, '#4a5262'], [1, '#5a6272']]);
    }
    // lower edge of the row above: scalloped shadow, lit lip
    for (let c = 0; c < 4; c++) {
      const x = c * CW;
      g.fillStyle = rgba('#1e1830', 0.35);
      g.beginPath(); g.moveTo(x, y + RH - 26); g.quadraticCurveTo(x + CW * 0.3, y + RH - 6, x + CW * 0.55, y + RH - 20); g.quadraticCurveTo(x + CW * 0.8, y + RH - 34, x + CW, y + RH - 26); g.lineTo(x + CW, y + RH); g.lineTo(x, y + RH); g.closePath(); g.fill();
    }
    fill(g, rgba('#dfe6f0', 0.55), 0, y + RH - 3, 512, 3);
    shadow(g, 0, y, 512, 22, 0.28);
  }
}

// roof_metal — tile [2, 2]: standing-seam sheet metal. Tintable.
function metalRoof(g, rng) {
  const P = 512 / 4.5;
  vg(g, 0, 0, 512, 512, [[0, '#e8e8e4'], [1, '#d4d4d0']]);
  for (let i = 0; i < 5; i++) {
    const x = i * P;
    hg(g, x, 0, P, 512, [[0, rgba('#ffffff', 0.1)], [0.5, rgba('#ffffff', 0)], [1, rgba('#3a3a4a', 0.08)]]);
    fill(g, rgba('#ffffff', 0.85), x - 3, 0, 3, 512);
    fill(g, rgba('#2a2a3a', 0.35), x, 0, 3, 512);
  }
  for (let i = 0; i < 5; i++) streak(g, rng() * 480, rng() * 100, 20 + rng() * 30, 300, '#5a4a40', 0.07);
}

// roof_flat — tile [6, 6]: flat roof membrane with seams, a drain and soft ponding stains.
function flatRoof(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#cfd0cc'], [1, '#c2c4c0']]);
  for (let y = 0; y < 512; y += 128) { fill(g, rgba('#7a7a7a', 0.25), 0, y, 512, 3); fill(g, rgba('#ffffff', 0.3), 0, y + 3, 512, 2); }
  for (let i = 0; i < 6; i++) {
    const x = rng() * 512, y = rng() * 512, r = 30 + rng() * 60;
    const G = g.createRadialGradient(x, y, 2, x, y, r); G.addColorStop(0, rgba('#8a8a90', 0.16)); G.addColorStop(1, rgba('#8a8a90', 0));
    g.fillStyle = G; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  circle(g, '#7a7a80', 256, 256, 14); circle(g, '#4a4a54', 256, 256, 9);
}

// ground_lot — parking lot asphalt; v 0..0.7 is one stall (2.5 m × 5 m per repeat in u, line at
// u=0), v 0.7..1 is aisle.
function groundLot(g, rng) {
  vg(g, 0, 0, 512, 512, [[0, '#5a5a64'], [1, '#52525c']]);
  for (let i = 0; i < 8; i++) {
    const x = rng() * 512, y = 160 + rng() * 340, r = 20 + rng() * 40;
    const G = g.createRadialGradient(x, y, 2, x, y, r); G.addColorStop(0, rgba('#2a2a34', 0.25)); G.addColorStop(1, rgba('#2a2a34', 0));
    g.fillStyle = G; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  fill(g, '#f2f2ee', 0, 154, 18, 358);
  fill(g, '#f2f2ee', 494, 154, 18, 358);
  fill(g, '#f2f2ee', 0, 154, 512, 12);
  panel(g, 150, 452, 212, 34, '#c8c4bc', { edge: 2 });
  shadow(g, 150, 486, 212, 10, 0.4);
}

// ───────────────────────────── atlases ─────────────────────────────

/**
 * roof_bits (opaque atlas). Rects [x, y, w, h] in 512 px (y from the top), mirrored in
 * buildings.ts ATLAS.bits:
 *   stripes [0,0,512,64]  (repeat u)   steel [0,64,512,64] (repeat u)
 *   acFront [0,128,256,192]   tank [256,128,256,192]
 *   door [0,320,64,128]  louvre [64,320,128,128]  acSide [192,320,128,128]  solar [320,320,192,128]
 *   glow swatches 8×[64×64] at y 448: white, warm, red, cyan, pink, green, amber, blue
 */
export const BITS = {
  stripes: [0, 0, 512, 64], steel: [0, 64, 512, 64], acFront: [0, 128, 256, 192], tank: [256, 128, 256, 192],
  door: [0, 320, 64, 128], louvre: [64, 320, 128, 128], acSide: [192, 320, 128, 128], solar: [320, 320, 192, 128],
};
export const SWATCH = ['#ffffff', '#ffd08a', '#ff2a2a', '#5ae8ff', '#ff5ac8', '#5aff8a', '#ffb02a', '#5a8aff'];
function roofBits(g, night) {
  if (night) {
    fill(g, '#000', 0, 0, 512, 512);
    SWATCH.forEach((c, i) => { const x = i * 64; const G = g.createRadialGradient(x + 32, 480, 2, x + 32, 480, 40); G.addColorStop(0, lt(c, 0.5)); G.addColorStop(1, c); g.fillStyle = G; g.fillRect(x + 4, 452, 56, 56); });
    return;
  }
  // warning stripes (45°, period 64 → seamless)
  fill(g, '#ffd21a', 0, 0, 512, 64);
  g.save(); g.beginPath(); g.rect(0, 0, 512, 64); g.clip();
  for (let x = -64; x < 576; x += 64) poly(g, '#20202a', [x, 64, x + 32, 64, x + 96, 0, x + 64, 0]);
  g.restore();
  vg(g, 0, 0, 512, 64, [[0, rgba('#fff', 0.2)], [1, rgba('#000', 0.15)]]);
  // painted steel plate
  vg(g, 0, 64, 512, 64, [[0, '#f4f4f2'], [0.15, '#e2e2e0'], [0.85, '#c8c8c8'], [1, '#a8a8b0']]);
  fill(g, rgba('#ffffff', 0.8), 0, 68, 512, 2);
  for (const x of [0, 256]) { fill(g, rgba('#4a4a5a', 0.3), x, 64, 2, 64); for (let y = 74; y < 124; y += 12) circle(g, rgba('#6a6a78', 0.5), x + 10, y, 2.2); }
  // AC outdoor unit front
  {
    const [x, y, w, h] = BITS.acFront;
    panel(g, x, y, w, h, '#e8e4da', { edge: 3, grad: 0.1 });
    const cx = x + w * 0.4, cy = y + h * 0.5, r = h * 0.36;
    circle(g, '#4a4a56', cx, cy, r); circle(g, '#6a6a76', cx, cy, r * 0.82);
    g.strokeStyle = '#d8d4cc'; g.lineWidth = 2.5;
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(cx, cy, (r * k) / 5.2, 0, Math.PI * 2); g.stroke(); }
    line(g, '#d8d4cc', 2.5, cx - r, cy, cx + r, cy); line(g, '#d8d4cc', 2.5, cx, cy - r, cx, cy + r);
    for (let i = 0; i < 9; i++) fill(g, rgba('#7a7468', 0.45), x + w * 0.8, y + 30 + i * 15, w * 0.14, 5);
    htext(g, 'INVERTER', x + w * 0.86, y + h - 20, 40, 9, FONT.latinBold, '#7a8aa0');
  }
  // FRP water tank panels
  {
    const [x, y, w, h] = BITS.tank;
    fill(g, '#c8d8e0', x, y, w, h);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const px = x + c * 128, py = y + r * 96;
      const G = g.createRadialGradient(px + 54, py + 38, 6, px + 64, py + 48, 80); G.addColorStop(0, '#f4fbff'); G.addColorStop(1, '#a8c0cc');
      g.fillStyle = G; rrect(g, px + 4, py + 4, 120, 88, 14); g.fill();
    }
    for (const xx of [x, x + 128, x + 254]) fill(g, '#8aa0ac', xx, y, 3, h);
    fill(g, '#8aa0ac', x, y + 95, w, 3);
  }
  // steel door
  { const [x, y, w, h] = BITS.door; panel(g, x, y, w, h, '#8aa4a0', { edge: 3 }); panel(g, x + 8, y + 10, w - 16, 40, '#9cb6b2', { edge: 1.5 }); fill(g, '#d0d4d8', x + w - 16, y + 66, 8, 14); }
  // louvre
  { const [x, y, w, h] = BITS.louvre; panel(g, x, y, w, h, '#c8ccd0', { edge: 3 }); for (let yy = y + 10; yy < y + h - 10; yy += 12) { vg(g, x + 8, yy, w - 16, 10, [[0, '#f0f2f4'], [1, '#6a7280']]); } }
  // AC side panel
  { const [x, y, w, h] = BITS.acSide; panel(g, x, y, w, h, '#e4e0d6', { edge: 3 }); for (let yy = y + 20; yy < y + h - 20; yy += 10) fill(g, rgba('#7a7468', 0.4), x + 20, yy, w - 40, 4); }
  // solar panel
  {
    const [x, y, w, h] = BITS.solar; fill(g, '#b8c0c8', x, y, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const px = x + 6 + c * 30, py = y + 6 + r * 29.5; vg(g, px, py, 28, 27, [[0, '#4a6ab8'], [1, '#1a2a6a']]); fill(g, rgba('#ffffff', 0.12), px, py, 28, 4); }
  }
  // glow swatches (lamp lenses, beacons, LED strips)
  SWATCH.forEach((c, i) => { const x = i * 64; fill(g, '#3a3a44', x, 448, 64, 64); vg(g, x + 4, 452, 56, 56, [[0, lt(c, 0.6)], [1, lt(c, 0.25)]]); });
}

/**
 * deco_cut (cutout atlas), mirrored in buildings.ts ATLAS.cut:
 *   rail [0,0,512,96] (repeat u, 2 m)  truss [0,96,512,80] (repeat u, 4 m)  inuyarai [0,176,512,80] (repeat u, 1.8 m)
 *   laundry [0,256,256,128]  futon [256,256,128,128]  plants [384,256,128,128]
 *   ladder [0,384,64,128]  bike [64,384,128,128]  dish [192,384,64,64]  laundry2 [256,384,256,128]
 */
export const CUT = {
  rail: [0, 0, 512, 96], truss: [0, 96, 512, 80], inuyarai: [0, 176, 512, 80], laundry: [0, 256, 256, 128], futon: [256, 256, 128, 128],
  plants: [384, 256, 128, 128], ladder: [0, 384, 64, 128], bike: [64, 384, 128, 128], dish: [192, 384, 64, 64], laundry2: [256, 384, 256, 128],
};
function decoCut(g, rng) {
  g.clearRect(0, 0, 512, 512);
  // rooftop / stair railing
  {
    const y = 0, h = 96;
    for (let x = 0; x < 512; x += 128) panel(g, x, y + 6, 10, h - 6, '#c8ced6', { edge: 1.5, hi: false });
    for (let x = 6; x < 512; x += 16) hg(g, x, y + 14, 4, h - 22, [[0, '#e8eef4'], [1, '#8a94a4']]);
    panel(g, 0, y + 4, 512, 12, '#dfe4ea', { edge: 1.5 });
    panel(g, 0, y + h - 12, 512, 8, '#b8c0ca', { edge: 1 });
  }
  // truss (two chords, diagonals; period 128)
  {
    const y = 96, h = 80;
    g.lineCap = 'square';
    for (let x = 0; x < 512; x += 128) { line(g, '#c8ccd2', 9, x, y + h - 10, x + 64, y + 10); line(g, '#c8ccd2', 9, x + 64, y + 10, x + 128, y + h - 10); line(g, '#9aa0aa', 3, x + 2, y + h - 12, x + 64, y + 12); line(g, '#9aa0aa', 7, x + 64, y + 8, x + 64, y + h - 8); }
    panel(g, 0, y + 2, 512, 14, '#e2e4e8', { edge: 1.5 });
    panel(g, 0, y + h - 16, 512, 14, '#c4c8ce', { edge: 1.5 });
  }
  // inu-yarai (curved bamboo fence), front view
  {
    const y = 176, h = 80;
    for (let x = 2; x < 512; x += 10) { hg(g, x, y + 10, 7, h - 12, [[0, '#e0c890'], [0.5, '#c8a868'], [1, '#8a6a3a']]); }
    vg(g, 0, y + 10, 512, h - 12, [[0, rgba('#000', 0)], [0.6, rgba('#3a2410', 0.1)], [1, rgba('#3a2410', 0.45)]]);
    panel(g, 0, y + 6, 512, 10, '#6a4a28', { edge: 1 });
    panel(g, 0, y + 40, 512, 6, '#7a5a30', { edge: 1, hi: false });
  }
  // laundry on a pole (two variants)
  for (const [ox, oy, seed] of [[0, 256, 1], [256, 384, 2]]) {
    line(g, '#b8c0c8', 5, ox + 2, oy + 10, ox + 254, oy + 10);
    let x = ox + 10;
    const cols = seed === 1 ? ['#ffffff', '#4a8ad8', '#ff8aa0', '#ffffff', '#f4d040', '#5ac08a'] : ['#e84a4a', '#ffffff', '#3a4a8a', '#ffd8e8', '#ffffff', '#8ad0f0'];
    cols.forEach((c, i) => {
      const kind = (i + seed) % 3;
      if (kind === 0) { // shirt
        poly(g, c, [x, oy + 18, x + 12, oy + 12, x + 26, oy + 12, x + 38, oy + 18, x + 34, oy + 34, x + 30, oy + 30, x + 30, oy + 78, x + 8, oy + 78, x + 8, oy + 30, x + 4, oy + 34]);
        vg(g, x + 8, oy + 40, 22, 38, [[0, rgba('#000', 0)], [1, rgba('#2a1a40', 0.15)]]);
        x += 42;
      } else if (kind === 1) { // towel
        panel(g, x, oy + 12, 30, 62, c, { edge: 1.5, grad: 0.1 }); fill(g, dk(c, 0.2), x, oy + 64, 30, 4); x += 34;
      } else { // socks / small items on a hanger ring
        line(g, '#9aa2ac', 2, x + 4, oy + 12, x + 40, oy + 12);
        for (let k = 0; k < 3; k++) fill(g, k % 2 ? c : dk(c, 0.1), x + 4 + k * 12, oy + 14, 9, 26);
        x += 44;
      }
    });
    line(g, '#9aa2ac', 2, ox + 2, oy + 4, ox + 2, oy + 16);
  }
  // futon draped over a rail
  {
    const [x, y, w, h] = CUT.futon;
    rrect(g, x + 8, y + 8, w - 16, h - 20, 12); g.fillStyle = '#f4e8d8'; g.fill();
    g.save(); rrect(g, x + 8, y + 8, w - 16, h - 20, 12); g.clip();
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) circle(g, (i + j) % 2 ? '#e86a7a' : '#5a8ad8', x + 18 + i * 20, y + 20 + j * 22, 5);
    vg(g, x, y + 8, w, 26, [[0, rgba('#fff', 0.3)], [1, rgba('#fff', 0)]]);
    vg(g, x, y + h - 50, w, 40, [[0, rgba('#2a1a40', 0)], [1, rgba('#2a1a40', 0.2)]]);
    g.restore();
    fill(g, '#d8d0c4', x + 8, y + 32, w - 16, 3);
  }
  // potted plants
  {
    const [x, y] = CUT.plants;
    for (let i = 0; i < 3; i++) {
      const px = x + 14 + i * 38, py = y + 128;
      for (let k = 0; k < 6; k++) circle(g, ['#3a8a3a', '#4aa84a', '#2a6a34'][k % 3], px + 16 + (rng() - 0.5) * 24, py - 50 - rng() * 40, 10 + rng() * 6);
      poly(g, '#c8643a', [px, py - 40, px + 32, py - 40, px + 28, py - 2, px + 4, py - 2]);
      fill(g, '#e08050', px, py - 42, 32, 5);
    }
  }
  // ladder
  { const [x, y, w, h] = CUT.ladder; for (const lx of [x + 6, x + w - 14]) panel(g, lx, y, 8, h, '#c4cad2', { edge: 1, hi: false }); for (let yy = y + 8; yy < y + h; yy += 18) panel(g, x + 6, yy, w - 12, 6, '#d8dce2', { edge: 1, hi: false }); }
  // bicycle (mamachari, side view)
  {
    const [x, y] = CUT.bike, c = '#d84a5a';
    g.lineWidth = 5; g.strokeStyle = '#2a2a34';
    for (const wx of [x + 30, x + 98]) { g.beginPath(); g.arc(wx, y + 92, 26, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 1.5; g.strokeStyle = '#9aa2ac';
    for (const wx of [x + 30, x + 98]) for (let a = 0; a < 6; a++) { g.beginPath(); g.moveTo(wx, y + 92); g.lineTo(wx + Math.cos(a) * 24, y + 92 + Math.sin(a) * 24); g.stroke(); }
    g.lineCap = 'round';
    line(g, c, 6, x + 30, y + 92, x + 58, y + 92); line(g, c, 6, x + 58, y + 92, x + 50, y + 56); line(g, c, 6, x + 50, y + 60, x + 88, y + 62); line(g, c, 6, x + 88, y + 58, x + 98, y + 92);
    line(g, '#2a2a34', 7, x + 42, y + 52, x + 58, y + 52);
    line(g, '#9aa2ac', 4, x + 88, y + 60, x + 92, y + 40); line(g, '#9aa2ac', 4, x + 84, y + 40, x + 100, y + 40);
    panel(g, x + 98, y + 34, 26, 18, '#c8ccd2', { edge: 1.5 });
  }
  // satellite dish
  { const [x, y] = CUT.dish; circle(g, '#e8eaee', x + 30, y + 28, 24); circle(g, '#c8ccd4', x + 34, y + 30, 17); line(g, '#8a8e98', 3, x + 30, y + 28, x + 50, y + 12); fill(g, '#8a8e98', x + 26, y + 50, 6, 14); }
}

/**
 * deco_house (cutout atlas of windows and doors), mirrored in buildings.ts ATLAS.house:
 *   slider [0,0,192,192] 1.65×1.65 m (window + shutter box)   frosted [192,0,128,128] 0.75×0.75
 *   shut [320,0,192,192] 1.65×1.65 (storm shutters closed)
 *   door [0,192,128,256] 1.0×2.2 (front door, porch lamp)   balcony [128,192,192,256] 1.7×2.25
 *   tall [320,192,96,192] 0.6×1.4   apt [416,192,96,192] 0.85×2.0 (apartment steel door)
 *   kitchen [0,448,192,64] 1.6×0.55   flower [320,384,192,128] 1.5×1.0 (window with flower box)
 * Emissive: window glass stamped 'window', porch lamp stamped 'always'.
 */
export const HOUSE = {
  slider: [0, 0, 192, 192], frosted: [192, 0, 128, 128], shut: [320, 0, 192, 192], door: [0, 192, 128, 256], balcony: [128, 192, 192, 256],
  tall: [320, 192, 96, 192], apt: [416, 192, 96, 192], kitchen: [0, 448, 192, 64], flower: [320, 384, 192, 128],
};
function houseWin(g, rng, night) {
  if (!night) g.clearRect(0, 0, 512, 512); else fill(g, '#000', 0, 0, 512, 512);
  const glassIn = (x, y, w, h, kind) => {
    if (night) { room(g, x, y, w, h, kind === 'cool' ? '#e8f0ff' : '#ffc070'); return; }
    glass(g, x, y, w, h, {
      top: '#d4ecfa', mid: '#90bce0', bot: '#5a80b0', glint: 0.8,
      inside: kind === 'lace' ? (gg, X, Y, W, H) => { fill(gg, rgba('#ffffff', 0.45), X, Y, W, H); for (let i = 0; i < W; i += 10) fill(gg, rgba('#ffffff', 0.25), X + i, Y, 4, H); }
        : kind === 'curtain' ? (gg, X, Y, W, H) => { curtain(gg, X, Y, W * 0.3, H, '#e8c890', 3); curtain(gg, X + W * 0.7, Y, W * 0.3, H, '#e8c890', 3); } : null,
    });
  };
  // slider with shutter box
  {
    const [x, y, w, h] = HOUSE.slider;
    if (!night) { panel(g, x + 4, y, w - 8, 34, '#c8ccd2', { edge: 2 }); fill(g, rgba('#000', 0.2), x + 8, y + 30, w - 16, 3); }
    if (!night) fill(g, '#b8c0c8', x + 10, y + 36, w - 20, h - 46);
    glassIn(x + 18, y + 44, (w - 36) / 2, h - 66, 'lace');
    glassIn(x + 18 + (w - 36) / 2, y + 44, (w - 36) / 2, h - 66, 'lace');
    if (!night) { frame(g, x + 10, y + 36, w - 20, h - 50, 8, '#c4cad2'); panel(g, x + w / 2 - 3, y + 40, 6, h - 58, '#b4bcc6', { edge: 1, hi: false }); panel(g, x + 4, y + h - 16, w - 8, 12, '#d8d4cc', { edge: 1.5 }); }
  }
  // frosted bathroom window with grille
  {
    const [x, y, w, h] = HOUSE.frosted;
    if (night) room(g, x + 18, y + 18, w - 36, h - 40, '#f0f4ff');
    else {
      panel(g, x + 8, y + 8, w - 16, h - 24, '#c4cad2', { edge: 2 });
      vg(g, x + 18, y + 18, w - 36, h - 44, [[0, '#f4f8fa'], [1, '#c8d4dc']]);
      for (let k = x + 26; k < x + w - 18; k += 14) panel(g, k, y + 12, 5, h - 34, '#9aa4b0', { edge: 0, hi: false });
      panel(g, x + 6, y + h - 20, w - 12, 10, '#d8d4cc', { edge: 1.5 });
    }
  }
  // storm shutters closed (amado)
  {
    const [x, y, w, h] = HOUSE.shut;
    if (!night) {
      panel(g, x + 4, y, w - 8, 34, '#c8ccd2', { edge: 2 });
      vg(g, x + 10, y + 34, w - 20, h - 50, [[0, '#d4dae0'], [1, '#aab2bc']]);
      for (let yy = y + 40; yy < y + h - 18; yy += 10) { fill(g, rgba('#ffffff', 0.5), x + 10, yy, w - 20, 2); fill(g, rgba('#3a4050', 0.22), x + 10, yy + 7, w - 20, 2); }
      for (const xx of [x + 10, x + w - 18]) panel(g, xx, y + 34, 8, h - 50, '#9aa2ac', { edge: 1, hi: false });
      panel(g, x + 4, y + h - 16, w - 8, 12, '#d8d4cc', { edge: 1.5 });
    }
  }
  // front door with sidelight and porch lamp
  {
    const [x, y, w, h] = HOUSE.door;
    if (night) {
      room(g, x + 92, y + 70, 22, 140, '#ffb860');
      const G = g.createRadialGradient(x + 104, y + 40, 2, x + 104, y + 40, 20); G.addColorStop(0, '#fff8e0'); G.addColorStop(1, '#ffb040');
      g.fillStyle = G; g.fillRect(x + 92, y + 26, 24, 28);
    } else {
      panel(g, x + 6, y + 60, w - 12, h - 62, '#5a3a28', { edge: 2 });
      panel(g, x + 14, y + 70, 70, h - 76, '#8a5a38', { edge: 2 });
      for (const yy of [y + 90, y + 150]) panel(g, x + 24, yy, 50, 46, '#9a6a44', { edge: 1.5 });
      fill(g, '#d8c070', x + 72, y + 160, 6, 30);
      vg(g, x + 92, y + 70, 22, 140, [[0, '#f0e8d8'], [1, '#c8b898']]);
      panel(g, x + 92, y + 26, 24, 28, '#fff4d0', { edge: 2, rim: '#3a3a44' });
      panel(g, x + 4, y + h - 8, w - 8, 8, '#a8a4a0', { edge: 1 });
    }
  }
  // tall balcony door (two sashes)
  {
    const [x, y, w, h] = HOUSE.balcony;
    if (!night) fill(g, '#b8c0c8', x + 10, y + 10, w - 20, h - 18);
    glassIn(x + 18, y + 18, (w - 36) / 2, h - 34, 'curtain');
    glassIn(x + 18 + (w - 36) / 2, y + 18, (w - 36) / 2, h - 34, 'curtain');
    if (!night) { frame(g, x + 10, y + 10, w - 20, h - 18, 8, '#c4cad2'); panel(g, x + w / 2 - 3, y + 14, 6, h - 26, '#b4bcc6', { edge: 1, hi: false }); }
  }
  // tall narrow window
  { const [x, y, w, h] = HOUSE.tall; if (!night) fill(g, '#c0c6ce', x + 8, y + 6, w - 16, h - 20); glassIn(x + 16, y + 14, w - 32, h - 36, 'lace'); if (!night) { frame(g, x + 8, y + 6, w - 16, h - 20, 7, '#c4cad2'); panel(g, x + 4, y + h - 16, w - 8, 10, '#d8d4cc', { edge: 1.5 }); } }
  // apartment steel door
  {
    const [x, y, w, h] = HOUSE.apt;
    if (!night) {
      panel(g, x + 6, y + 4, w - 12, h - 6, '#9a8a78', { edge: 2 });
      panel(g, x + 12, y + 10, w - 24, h - 16, '#d8c8b0', { edge: 2 });
      fill(g, '#3a3a44', x + w / 2 - 2, y + 56, 4, 4);
      panel(g, x + 26, y + 120, w - 52, 8, '#8a8a90', { edge: 1 });
      fill(g, '#c8ccd4', x + w - 30, y + 96, 12, 6);
      panel(g, x + 24, y + 30, w - 48, 14, '#ffffff', { edge: 1 });
    }
  }
  // kitchen window
  { const [x, y, w, h] = HOUSE.kitchen; if (!night) fill(g, '#c0c6ce', x + 8, y + 6, w - 16, h - 14); glassIn(x + 16, y + 12, w - 32, h - 26, 'cool'); if (!night) { frame(g, x + 8, y + 6, w - 16, h - 14, 6, '#c4cad2'); for (let k = x + 30; k < x + w - 20; k += 18) fill(g, '#9aa4b0', k, y + 10, 4, h - 22); } }
  // window with flower box
  {
    const [x, y, w, h] = HOUSE.flower;
    if (!night) fill(g, '#c0c6ce', x + 14, y + 6, w - 28, h - 40);
    glassIn(x + 22, y + 14, w - 44, h - 56, 'curtain');
    if (!night) {
      frame(g, x + 14, y + 6, w - 28, h - 40, 7, '#e8e4dc');
      panel(g, x + 6, y + h - 34, w - 12, 26, '#a8643a', { edge: 2 });
      for (let i = 0; i < 9; i++) { circle(g, '#3a8a3a', x + 20 + i * 19, y + h - 38, 9); circle(g, ['#ff5a7a', '#ffd040', '#ffffff'][i % 3], x + 22 + i * 19, y + h - 42, 4); }
    }
  }
}
function houseKinds(K) {
  for (const k of ['slider', 'frosted', 'balcony', 'tall', 'kitchen', 'flower']) { const [x, y, w, h] = HOUSE[k]; K('window', x, y, w, h); }
  const [x, y] = HOUSE.door; K('window', x + 88, y + 66, 30, 148); K('always', x + 88, y + 20, 32, 40);
}

/**
 * dock_container (opaque atlas): side40 [0,0,512,256] 12.2×2.6 m, door [0,256,256,256] 2.44×2.6,
 * roof [256,256,256,128], side20 [256,384,256,128] 6.1×2.6. Neutral; tinted per box.
 */
export const BOX = { side40: [0, 0, 512, 256], door: [0, 256, 256, 256], roof: [256, 256, 256, 128], side20: [256, 384, 256, 128] };
function container(g) {
  const ribs = (x, y, w, h, P) => { for (let xx = x; xx < x + w; xx += P) hg(g, xx, y, P, h, [[0, '#b8b8b4'], [0.2, '#ececea'], [0.5, '#e0e0dc'], [0.7, '#a8a8a6'], [1, '#c4c4c0']]); };
  const side = (x, y, w, h, text, code) => {
    fill(g, '#d8d8d4', x, y, w, h);
    ribs(x + 10, y + 16, w - 20, h - 32, w > 300 ? 20 : 18);
    panel(g, x, y, w, 16, '#c8c8c4', { edge: 1.5 }); panel(g, x, y + h - 16, w, 16, '#a8a8a6', { edge: 1.5 });
    panel(g, x, y, 10, h, '#b0b0ac', { edge: 1, hi: false }); panel(g, x + w - 10, y, 10, h, '#b0b0ac', { edge: 1, hi: false });
    if (text) { htext(g, text, x + w * 0.3, y + h * 0.34, w * 0.4, h * 0.2, FONT.latin, '#2a2a3a'); htext(g, code, x + w * 0.82, y + 34, w * 0.25, 13, FONT.latinBold, '#2a2a3a'); }
    streak(g, x + w * 0.6, y + 16, 40, h * 0.7, '#7a4a2a', 0.18);
    streak(g, x + w * 0.15, y + 16, 30, h * 0.5, '#7a4a2a', 0.14);
  };
  side(0, 0, 512, 256, 'KAIRYU', 'KRYU 401552 2');
  side(256, 384, 256, 128, 'SEIRAN', 'SRNU 220871 4');
  // door end
  { const x = 0, y = 256, w = 256, h = 256;
    fill(g, '#d0d0cc', x, y, w, h);
    for (const dx of [x + 10, x + 130]) { fill(g, '#dcdcd8', dx, y + 14, 116, h - 28); ribs(dx + 6, y + 30, 104, h - 60, 26); }
    for (const bx of [x + 40, x + 90, x + 160, x + 210]) { panel(g, bx, y + 14, 7, h - 28, '#9a9a98', { edge: 1, hi: false }); panel(g, bx - 6, y + 140, 18, 10, '#7a7a78', { edge: 1 }); }
    panel(g, x, y, w, 14, '#b8b8b4', { edge: 1.5 }); panel(g, x, y + h - 14, w, 14, '#9a9a98', { edge: 1.5 });
    fill(g, '#ececea', x + 20, y + 40, 40, 26); htext(g, 'CSC', x + 40, y + 53, 34, 12, FONT.latinBold, '#3a3a48');
    streak(g, x + 160, y + 20, 30, 140, '#7a4a2a', 0.18);
  }
  // roof
  { const x = 256, y = 256, w = 256, h = 128; fill(g, '#cacac6', x, y, w, h); for (let xx = x; xx < x + w; xx += 16) vg(g, xx, y, 10, h, [[0, '#e0e0dc'], [1, '#b0b0ac']]); for (let i = 0; i < 4; i++) streak(g, x + 20 + i * 60, y, 40, h, '#7a4a2a', 0.15); }
}

// ───────────────────────────── far skyline ─────────────────────────────
// One window per repeat, glass filling most of the cell so lit windows still read at 2 km.

function farLayer(g, night, o) {
  const { wall, glassC, lit, gx0, gx1, gy0, gy1, band } = o;
  if (night) { fill(g, '#000', 0, 0, 512, 512); room(g, gx0, gy0, gx1 - gx0, gy1 - gy0, lit, { floor: 0.25 }); return; }
  vg(g, 0, 0, 512, 512, [[0, lt(wall, 0.06)], [1, dk(wall, 0.06)]]);
  if (band) panel(g, 0, gy1 + 10, 512, 512 - gy1 - 10, band, { edge: 3 });
  vg(g, gx0, gy0, gx1 - gx0, gy1 - gy0, [[0, lt(glassC, 0.35)], [1, dk(glassC, 0.25)]]);
  poly(g, rgba('#ffffff', 0.16), [gx0 + 40, gy0, gx0 + 140, gy0, gx0 + 60, gy1, gx0 - 40, gy1]);
  fill(g, rgba('#1a1430', 0.3), gx0, gy0, gx1 - gx0, 12);
}

// ───────────────────────────── export ─────────────────────────────

/** Scales the colour of already-painted emissive art (night windows must not blow out to white
 *  under the shader's emit gain). Rect in 512 design units; alpha untouched. */
export function dimEmit(g, f, x = 0, y = 0, w = 512, h = 512, sat = 1.5, tint = [1, 1, 1]) {
  const k = g.canvas.width / 512;
  const X = Math.round(x * k), Y = Math.round(y * k), Wd = Math.round(w * k), Hd = Math.round(h * k);
  const d = g.getImageData(X, Y, Wd, Hd);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
    for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, (l + (p[i + c] - l) * sat) * f * tint[c]));
  }
  g.putImageData(d, X, Y);
}
const win = (fn, ...a) => [(g) => fn(g, false, ...a), (g, rng, K) => { fn(g, true, ...a); dimEmit(g, 0.74); K('window'); }];
const winFar = (fn, ...a) => [(g) => fn(g, false, ...a), (g, rng, K) => { fn(g, true, ...a); dimEmit(g, 0.8); K('window'); }];

export const layers = [
  def('fac_curtain_a', ...win(curtainA)),
  def('fac_curtain_b', ...win(curtainB)),
  def('fac_curtain_c', ...win(curtainC)),
  def('fac_office_band', ...win(officeBand)),
  def('fac_office_punch', ...win(officePunch)),
  def('fac_mansion_a', ...win(mansionBay, 'a')),
  def('fac_mansion_b', ...win(mansionBay, 'b')),
  def('fac_balcony', balcony),
  def('fac_zakkyo', ...win(zakkyo)),
  def('fac_wall_plain', wallPlain),
  def('fac_wall_tile', wallTile),
  shopLayer('shop_a', konbini, ramen),
  shopLayer('shop_b', izakaya, cafe),
  shopLayer('shop_c', salon, pachinko),
  shopLayer('shop_d', shutter, bakery),
  shopLayer('shop_e', lobby, drugstore),
  def('fac_koshi', ...win(koshi)),
  def('fac_mushiko', ...win(mushiko)),
  def('fac_plaster', plaster),
  def('fac_namako', namako),
  def('fac_wood', woodBoards),
  def('fac_corrugated', corrugated),
  def('fac_sandwich', sandwich),
  def('fac_rolldoor', rollDoor),
  def('fac_whwin', ...win(whWindow)),
  def('fac_siding', siding),
  def('fac_mortar', mortar),
  def('deco_house', (g, rng) => houseWin(g, rng, false), (g, rng, K) => { houseWin(g, rng, true); for (const k of ['slider', 'frosted', 'balcony', 'tall', 'kitchen', 'flower']) dimEmit(g, 0.74, ...HOUSE[k], 1.5, [1, 0.84, 0.62]); dimEmit(g, 0.74, HOUSE.door[0] + 88, HOUSE.door[1] + 66, 30, 148, 1.5, [1, 0.84, 0.62]); houseKinds(K); }, { cutout: true }),
  def('roof_kawara', kawara),
  def('roof_metal', metalRoof),
  def('roof_flat', flatRoof),
  def('roof_bits', (g) => roofBits(g, false), (g, rng, K) => { roofBits(g, true); K('always', 0, 448, 512, 64); }),
  def('deco_cut', decoCut, null, { cutout: true }),
  def('dock_container', container),
  def('ground_lot', groundLot),
  // far skyline: [3.5, 3.8] office, [3.4, 3.0] apartment, [3, 3.6] glass tower
  def('far_office', ...winFar(farLayer, { wall: '#d8d2c8', glassC: '#6a9ac8', lit: '#ffe6bc', gx0: 70, gx1: 442, gy0: 90, gy1: 400 })),
  def('far_apart', ...winFar(farLayer, { wall: '#ece6dc', glassC: '#7aa4c8', lit: '#ffbe70', gx0: 50, gx1: 462, gy0: 60, gy1: 300, band: '#f4f0e8' })),
  def('far_glass', ...winFar(farLayer, { wall: '#2c4a78', glassC: '#5aa8e8', lit: '#e8f0ff', gx0: 12, gx1: 500, gy0: 40, gy1: 440 })),
];
