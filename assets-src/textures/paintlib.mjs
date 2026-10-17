/** Shared painting helpers for texture painters (Node, @napi-rs/canvas). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.resolve(here, '../fonts');
const FONTS = {
  jp: 'NotoSansJP-900.ttf', jpBold: 'NotoSansJP-700.ttf', latin: 'NotoSans-900.ttf', latinBold: 'NotoSans-700.ttf',
  tag: 'SedgwickAveDisplay-400.ttf', marker: 'PermanentMarker-400.ttf', spray: 'RubikSprayPaint-400.ttf', bungee: 'Bungee-400.ttf',
  pop: 'MochiyPopOne-400.ttf', dela: 'DelaGothicOne-400.ttf', rocknroll: 'RocknRollOne-400.ttf', rampart: 'RampartOne-400.ttf',
  reggae: 'ReggaeOne-400.ttf', dot: 'DotGothic16-400.ttf', wet: 'RubikWetPaint-400.ttf', monoton: 'Monoton-400.ttf',
};
for (const [fam, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(path.join(fontDir, file), fam);
export const FONT = Object.fromEntries(Object.keys(FONTS).map((k) => [k, k]));

/** Deterministic random() from a string seed (mulberry32 over an FNV hash). */
export function rngFor(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vertical gradient fill of a rect. stops: [[t, css], ...] */
export function vgrad(g, x, y, w, h, stops) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

/** Soft painted streaks: low-contrast, filtered, never speckled. */
export function softStreaks(g, S, rng, color, count = 12, alpha = 0.06) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rng() * S, w = S * (0.05 + rng() * 0.2);
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.5, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, w, S);
  }
  g.restore();
}

/** Rounded rectangle path. */
export function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Text fitted into a box (scales the font down to fit width). */
export function fitText(g, text, cx, cy, maxW, size, font, opts = {}) {
  let s = size;
  g.font = `${opts.weight || ''} ${s}px ${font}`.trim();
  const w = g.measureText(text).width;
  if (w > maxW) { s = (s * maxW) / w; g.font = `${opts.weight || ''} ${s}px ${font}`.trim(); }
  g.textAlign = opts.align || 'center';
  g.textBaseline = 'middle';
  if (opts.stroke) { g.lineJoin = 'round'; g.lineWidth = opts.strokeWidth || s * 0.12; g.strokeStyle = opts.stroke; g.strokeText(text, cx, cy); }
  g.fillStyle = opts.fill || '#fff';
  g.fillText(text, cx, cy);
  return s;
}

/**
 * Stamps the emissive "kind" into alpha over a region (default: the whole layer), keeping the
 * colour: 'window' → alpha 1 (random per-window lighting), 'always' → alpha 0.4 (always lit at
 * night). Call after painting the emissive art; black areas stay non-emissive either way.
 */
export function emitKind(g, S, kind, x = 0, y = 0, w = S, h = S) {
  const a = kind === 'window' ? 255 : 102;
  const img = g.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i + 3] / 255;
    // flatten onto black first so partially covered pixels keep their visible colour
    d[i] = Math.round(d[i] * k); d[i + 1] = Math.round(d[i + 1] * k); d[i + 2] = Math.round(d[i + 2] * k);
    d[i + 3] = a;
  }
  g.putImageData(img, x, y);
}
