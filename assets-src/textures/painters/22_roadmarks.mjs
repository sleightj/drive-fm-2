/**
 * Road marks (道路標示): white paint on a transparent background, alpha = paint coverage.
 * Canvas top = the FAR end of the mark (direction of travel); the loader flips so v runs from the
 * near end (v = 0) to the far end (v = 1). Japanese text is painted elongated along the road and
 * reads from far to near (top to bottom), as on real roads; speed numerals sit side by side.
 *
 * Several marks share a layer; the rectangles and real sizes are in ROAD_MARKS
 * (src/world/kit/street.ts). Keep the two in sync.
 */
import { FONT } from '../paintlib.mjs';
import { inRect, ellipse, poly } from './20_street.mjs';

const PAINT = '#f6f4ec';

/**
 * Paints a column of characters into a rect: the mark is w × l metres, characters are
 * `charLen` long with `gap` between, read from the top (far) to the bottom (near).
 */
function textColumn(g, rect, w, l, chars, charLen, gap, font = FONT.jpBold, inset = 0.06) {
  const [x, y, pw, ph] = rect;
  inRect(g, x, y, pw, ph, w * 100, l * 100, (q) => {
    const total = chars.length * charLen + (chars.length - 1) * gap;
    let top = (l - total) / 2;
    for (const ch of chars) {
      glyphBox(q, ch, inset * 100, top * 100, (w - inset * 2) * 100, charLen * 100, font);
      top += charLen + gap;
    }
  });
}

/** Draws one glyph stretched to fill a box exactly (tight ink bounds). */
function glyphBox(q, ch, bx, by, bw, bh, font, fill = PAINT) {
  q.save();
  q.font = `200px ${font}`;
  q.textAlign = 'left'; q.textBaseline = 'alphabetic';
  const m = q.measureText(ch);
  const l = -m.actualBoundingBoxLeft, r = m.actualBoundingBoxRight, t = -m.actualBoundingBoxAscent, b = m.actualBoundingBoxDescent;
  const gw = r - l, gh = b - t;
  // long-vowel bar in vertical text is vertical: rotate it
  if (ch === 'ー' && bh > bw) {
    q.translate(bx + bw / 2, by + bh / 2);
    q.scale(bw * 0.28 / gh, bh / gw);
    q.rotate(Math.PI / 2);
    q.fillStyle = fill; q.fillText(ch, -(l + gw / 2), -(t + gh / 2));
    q.restore();
    return;
  }
  q.translate(bx, by);
  q.scale(bw / gw, bh / gh);
  q.fillStyle = fill; q.fillText(ch, -l, -t);
  q.restore();
}

/** Two digits side by side, each stretched along the road. */
function numerals(g, rect, w, l, text) {
  const [x, y, pw, ph] = rect;
  inRect(g, x, y, pw, ph, w * 100, l * 100, (q) => {
    const n = text.length, gap = 12, dw = (w * 100 - 16 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) glyphBox(q, text[i], 8 + i * (dw + gap), 10, dw, l * 100 - 20, FONT.latinBold);
  });
}

/** Lane arrow in a w × l metre box: shaft from the near end, heads at the far end / to the sides. */
function arrow(g, rect, w, l, kind) {
  const [x, y, pw, ph] = rect;
  inRect(g, x, y, pw, ph, w * 100, l * 100, (q) => {
    const W = w * 100, Lc = l * 100, sw = 16, headL = 150, headW = 42, sideHeadL = 62, sideHeadW = 30;
    q.fillStyle = PAINT; q.strokeStyle = PAINT; q.lineWidth = sw; q.lineCap = 'butt'; q.lineJoin = 'round';
    const hasStraight = kind === 'straight' || kind === 'straight_left' || kind === 'straight_right';
    const left = kind === 'left' || kind === 'straight_left' || kind === 'left_right';
    const right = kind === 'right' || kind === 'straight_right' || kind === 'left_right';
    // shaft position: offset away from the side branch so the head fits
    let cx = W / 2;
    if (kind === 'left' || kind === 'straight_left') cx = W - headW - 4;
    if (kind === 'right' || kind === 'straight_right') cx = headW + 4;
    if (kind === 'straight') cx = W / 2;
    const yJoin = hasStraight ? Lc * 0.6 : Lc * 0.42; // where a side branch leaves the shaft
    const R = 70; // bend radius (cm)
    const shaftTop = hasStraight ? headL - 4 : yJoin;
    q.fillRect(cx - sw / 2, shaftTop, sw, Lc - shaftTop);
    if (hasStraight) poly(q, [[cx, 0], [cx + headW, headL], [cx - headW, headL]], PAINT);
    const branch = (dir) => {
      const yb = yJoin - R - 20, xEnd = dir < 0 ? 2 : W - 2;
      q.beginPath();
      q.moveTo(cx, yJoin + 2);
      q.lineTo(cx, yJoin - 20);
      q.quadraticCurveTo(cx, yb, cx + dir * R, yb);
      q.lineTo(xEnd - dir * (sideHeadL - 4), yb);
      q.stroke();
      poly(q, [[xEnd, yb], [xEnd - dir * sideHeadL, yb - sideHeadW * 3.2], [xEnd - dir * sideHeadL, yb + sideHeadW * 3.2]], PAINT);
    };
    if (left) branch(-1);
    if (right) branch(1);
  });
}

function wear(g, rect, rng, n) {
  const [x, y, w, h] = rect;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w, py = y + rng() * h, r = 3 + rng() * 9;
    const gr = g.createRadialGradient(px, py, 0, px, py, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < n * 0.15; i++) ellipse(g, x + rng() * w, y + rng() * h, 1 + rng() * 1.5, 1 + rng() * 2, rng() * 3, 'rgba(0,0,0,0.6)');
  g.restore();
}

/** Mark table: name → layer, pixel rect (x, y, w, h; y down, top = far end), width × length (m). */
export const MARKS = {
  tomare: { layer: 'rm_text_a', rect: [0, 0, 170, 512], w: 1.5, l: 8.1, text: '止まれ', charLen: 2.5, gap: 0.3 },
  jokou: { layer: 'rm_text_a', rect: [171, 0, 170, 512], w: 1.5, l: 5.3, text: '徐行', charLen: 2.5, gap: 0.3 },
  bus: { layer: 'rm_text_a', rect: [342, 0, 170, 512], w: 1.5, l: 5.3, text: 'バス', charLen: 2.5, gap: 0.3 },
  school_zone: { layer: 'rm_text_b', rect: [0, 0, 170, 512], w: 1.5, l: 19.3, text: 'スクールゾーン', charLen: 2.5, gap: 0.3 },
  slow_down: { layer: 'rm_text_b', rect: [171, 0, 170, 512], w: 1.5, l: 13.7, text: '速度落とせ', charLen: 2.5, gap: 0.3 },
  bus_only: { layer: 'rm_text_b', rect: [342, 0, 170, 512], w: 1.5, l: 10.9, text: 'バス専用', charLen: 2.5, gap: 0.3 },
  speed_30: { layer: 'rm_speed', rect: [0, 0, 256, 256], w: 1.4, l: 3.0, num: '30' },
  speed_40: { layer: 'rm_speed', rect: [256, 0, 256, 256], w: 1.4, l: 3.0, num: '40' },
  speed_50: { layer: 'rm_speed', rect: [0, 256, 256, 256], w: 1.4, l: 3.0, num: '50' },
  speed_60: { layer: 'rm_speed', rect: [256, 256, 256, 256], w: 1.4, l: 3.0, num: '60' },
  arrow_straight: { layer: 'rm_arrows', rect: [0, 0, 170, 256], w: 0.9, l: 5.0, arrow: 'straight' },
  arrow_left: { layer: 'rm_arrows', rect: [171, 0, 170, 256], w: 1.3, l: 5.0, arrow: 'left' },
  arrow_right: { layer: 'rm_arrows', rect: [342, 0, 170, 256], w: 1.3, l: 5.0, arrow: 'right' },
  arrow_straight_left: { layer: 'rm_arrows', rect: [0, 256, 170, 256], w: 1.6, l: 5.0, arrow: 'straight_left' },
  arrow_straight_right: { layer: 'rm_arrows', rect: [171, 256, 170, 256], w: 1.6, l: 5.0, arrow: 'straight_right' },
  arrow_left_right: { layer: 'rm_arrows', rect: [342, 256, 170, 256], w: 2.2, l: 5.0, arrow: 'left_right' },
  diamond: { layer: 'rm_symbols', rect: [0, 0, 256, 256], w: 1.5, l: 4.0 },
  bicycle: { layer: 'rm_symbols', rect: [256, 0, 256, 256], w: 0.9, l: 1.8 },
  zone30: { layer: 'rm_symbols', rect: [0, 256, 256, 256], w: 2.0, l: 6.0 },
  crosswalk_bar: { layer: 'rm_symbols', rect: [256, 256, 256, 256], w: 0.45, l: 4.0 },
};

function paintLayer(name) {
  return (g, S, rng) => {
    g.clearRect(0, 0, S, S);
    for (const [k, m] of Object.entries(MARKS)) {
      if (m.layer !== name) continue;
      if (m.text) textColumn(g, m.rect, m.w, m.l, [...m.text], m.charLen, m.gap);
      else if (m.num) numerals(g, m.rect, m.w, m.l, m.num);
      else if (m.arrow) arrow(g, m.rect, m.w, m.l, m.arrow);
      else if (k === 'diamond') {
        inRect(g, ...m.rect, 150, 400, (q) => {
          poly(q, [[75, 8], [142, 200], [75, 392], [8, 200]], null, PAINT, 16);
        });
      } else if (k === 'bicycle') {
        // bicycle navi mark: forward chevron (far) over a side-view bicycle, stretched along the road
        inRect(g, ...m.rect, 90, 180, (q) => {
          q.strokeStyle = PAINT; q.fillStyle = PAINT; q.lineCap = 'round'; q.lineJoin = 'round';
          poly(q, [[45, 4], [86, 40], [70, 46], [45, 24], [20, 46], [4, 40]], PAINT);
          q.lineWidth = 5;
          q.beginPath(); q.ellipse(22, 132, 17, 30, 0, 0, Math.PI * 2); q.stroke();
          q.beginPath(); q.ellipse(68, 132, 17, 30, 0, 0, Math.PI * 2); q.stroke();
          q.lineWidth = 5.5;
          q.beginPath(); q.moveTo(22, 132); q.lineTo(38, 96); q.lineTo(60, 96); q.lineTo(45, 134); q.closePath(); q.stroke();
          q.beginPath(); q.moveTo(45, 134); q.lineTo(36, 88); q.moveTo(60, 96); q.lineTo(68, 132); q.moveTo(58, 82); q.lineTo(62, 96); q.stroke();
          q.lineWidth = 6; q.beginPath(); q.moveTo(29, 86); q.lineTo(43, 86); q.moveTo(53, 80); q.lineTo(66, 82); q.stroke();
        });
      } else if (k === 'zone30') {
        inRect(g, ...m.rect, 200, 600, (q) => {
          // "ゾーン" across the lane (stretched along the road), then 30 in an elongated ring
          glyphBox(q, 'ゾ', 8, 20, 58, 170, FONT.jpBold); glyphBox(q, 'ー', 74, 90, 52, 22, FONT.jpBold); glyphBox(q, 'ン', 134, 20, 58, 170, FONT.jpBold);
          q.beginPath(); q.ellipse(100, 410, 90, 178, 0, 0, Math.PI * 2); q.lineWidth = 14; q.strokeStyle = PAINT; q.stroke();
          glyphBox(q, '3', 42, 300, 54, 220, FONT.latinBold); glyphBox(q, '0', 104, 300, 54, 220, FONT.latinBold);
        });
      } else if (k === 'crosswalk_bar') {
        inRect(g, ...m.rect, 45, 400, (q) => { q.fillStyle = PAINT; q.fillRect(1, 2, 43, 396); });
      }
      wear(g, m.rect, rng, Math.round((m.rect[2] * m.rect[3]) / 2600));
    }
  };
}

export const layers = ['rm_text_a', 'rm_text_b', 'rm_speed', 'rm_arrows', 'rm_symbols'].map((name) => ({ name, albedo: paintLayer(name) }));
