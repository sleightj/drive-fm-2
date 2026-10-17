import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import type { GraphicsLevel } from '../game';
import { env } from './environment';

/** Per-frame inputs to the screen effects. */
export interface PostFrame {
  dt: number;
  kmh: number;
  boost: number; // 0..1 boost effect strength
  night: number; // 0..1
}

/**
 * Screen effects (docs/DESIGN.md §5, budgets §6).
 *
 * HIGH / LOW:
 *   scene → linear target (HDR RGBA16F at HIGH; RGBA8 sRGB at LOW and wherever float targets
 *          aren't renderable)
 *   bloom: bright-pass with a soft knee + Karis average at half resolution, dual-filter
 *          downsamples, tent upsamples blended back up the chain (HIGH 5 mips, LOW 3 mips)
 *   final (one pass, to the canvas): FXAA on the scene → + bloom → highlight hue-keep (night:
 *          lights past white keep their colour) → sRGB encode → grade
 *          (lift/gamma/gain, S-curve, saturation with a push on greys; per hour, env.uGrade*) →
 *          vignette → speed lines → TPDF dither
 *   LOW's 8-bit scene target halves the frame's bandwidth; bloom then keys on clipped light and
 *   only runs from dusk to dawn. See POST_LEVELS.
 * VERY LOW: the scene straight to the canvas; every material grades and dithers its own output
 *   (the colorspace chunk below), so the look matches the other levels without a post chain.
 *
 * Colour space: three writes linear values when rendering into a render target (the materials'
 * `#include <colorspace_fragment>` resolves to the working space there), so nothing is encoded
 * twice; the final pass applies the sRGB transfer itself (the same function three uses for the
 * canvas) and writes display values to the canvas without further conversion.
 *
 * renderer.info: the post chain issues several renders per frame, so info.autoReset is turned
 * off and the counters are reset once at the start of each frame: calls/triangles then cover
 * the scene plus the post passes (HIGH +10 draws, LOW +6 at night / +1 by day, VERY LOW +0).
 */

// ─────────────────────────────── shared grade (also used in-material on VERY LOW) ───────────────────────────────

const GRADE_PARS = /* glsl */ `
uniform vec3 uGradeLift;
uniform vec3 uGradeGamma;
uniform vec3 uGradeGain;
uniform vec3 uGradeSat;
uniform float uGradeOn;
uniform vec3 uGradeVig;
// linear → sRGB display value (three's sRGBTransferOETF), clipped at white like the canvas
vec3 dfmEncode(vec3 lin) {
  lin = clamp(lin, 0.0, 1.0);
  return mix(pow(lin, vec3(0.41666)) * 1.055 - vec3(0.055), lin * 12.92, vec3(lessThanEqual(lin, vec3(0.0031308))));
}
// the hour's grade, display space in and out
vec3 dfmGrade(vec3 c) {
  c = c * uGradeGain + uGradeLift * (1.0 - c);
  c = pow(max(c, vec3(0.0)), uGradeGamma);
  c = mix(c, c * c * (3.0 - 2.0 * c), uGradeSat.z);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = vec3(l) + (c - vec3(l)) * (uGradeSat.x + uGradeSat.y * (1.0 - chroma));
  return clamp(c, 0.0, 1.0);
}
// VERY LOW, per shaded fragment: gain/lift, S-curve and saturation (vibrance folded into it);
// no per-channel gamma or vignette — about half the cost of dfmGrade
vec3 dfmGradeLite(vec3 c) {
  c = c * uGradeGain + uGradeLift * (1.0 - c);
  c = mix(c, c * c * (3.0 - 2.0 * c), uGradeSat.z);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(l) + (c - vec3(l)) * (uGradeSat.x + uGradeSat.y * 0.6);
  return clamp(c, 0.0, 1.0);
}
// Highlights past white keep their hue (signs and lit windows stay coloured instead of clipping
// to pastel), drawn a little toward white the hotter they are; uGradeVig.x = strength (the
// night share: by day nothing changes)
vec3 dfmHueKeep(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m <= 1.0) return c;
  vec3 k = mix(c / m, vec3(1.0), smoothstep(1.0, 5.0, m) * 0.55);
  return mix(c, k, uGradeVig.x);
}
float dfmIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// triangular-distributed noise in (-1, 1): ±1 LSB before 8-bit quantisation, no banding
float dfmDither(vec2 p) { return dfmIgn(p) + dfmIgn(p + vec2(47.0, 17.0)) - 1.0; }
// gentle vignette: px = fragment position, inv = 1 / buffer size
float dfmVignette(vec2 px, vec2 inv, float strength) {
  vec2 q = px * inv - 0.5;
  return 1.0 - strength * smoothstep(0.3, 1.0, dot(q, q) * 2.0);
}
`;

let chunksPatched = false;
/** VERY LOW: a lite grade + dither at the end of every material that carries env's uniforms. */
function patchChunks() {
  if (chunksPatched) return;
  chunksPatched = true;
  ShaderChunk.colorspace_pars_fragment = ShaderChunk.colorspace_pars_fragment + GRADE_PARS;
  // uGradeOn: 1 while VERY LOW draws straight to the canvas (lite grade + dither here), 0.5 while
  // LOW draws into its 8-bit scene target (only the highlight hue-keep, before the target clips),
  // 0 into HDR (untouched). Materials without the uniform (three's built-ins) read 0 and convert
  // as before.
  ShaderChunk.colorspace_fragment = /* glsl */ `
if (uGradeOn > 0.75) {
  gl_FragColor.rgb = dfmGradeLite(dfmEncode(dfmHueKeep(gl_FragColor.rgb))) + (dfmIgn(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
} else {
  if (uGradeOn > 0.25) gl_FragColor.rgb = dfmHueKeep(gl_FragColor.rgb);
  gl_FragColor = linearToOutputTexel( gl_FragColor );
}
`;
}
patchChunks();

// ─────────────────────────────── passes ───────────────────────────────

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;   // source texel
uniform vec3 uThr;     // threshold, knee, clamp
varying vec2 vUv;
float bri(vec3 c) { return max(max(c.r, c.g), c.b); }
void main() {
  // 4 bilinear taps = a 4×4 box; Karis-weighted so a single bright texel can't flicker
  vec3 a = texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  float wa = 1.0 / (1.0 + bri(a)), wb = 1.0 / (1.0 + bri(b)), wc = 1.0 / (1.0 + bri(c)), wd = 1.0 / (1.0 + bri(d));
  vec3 col = min((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), vec3(uThr.z));
  float br = bri(col);
  float soft = clamp(br - uThr.x + uThr.y, 0.0, 2.0 * uThr.y);
  soft = soft * soft / (4.0 * uThr.y + 1e-4);
  float k = max(soft, br - uThr.x) / max(br, 1e-4);
  gl_FragColor = vec4(col * k, 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture(tSrc, vUv).rgb * 4.0;
  s += texture(tSrc, vUv - uTexel).rgb;
  s += texture(tSrc, vUv + uTexel).rgb;
  s += texture(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  s += texture(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s * 0.125, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;   // the coarser level (already blended up from below)
uniform sampler2D tHigh;  // this level's downsample
uniform vec2 uTexel;      // tLow texel
uniform float uScatter;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 s = texture(tLow, vUv).rgb * 4.0;
  s += (texture(tLow, vUv + vec2(t.x, 0.0)).rgb + texture(tLow, vUv - vec2(t.x, 0.0)).rgb
      + texture(tLow, vUv + vec2(0.0, t.y)).rgb + texture(tLow, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(tLow, vUv + t).rgb + texture(tLow, vUv - t).rgb
     + texture(tLow, vUv + vec2(t.x, -t.y)).rgb + texture(tLow, vUv - vec2(t.x, -t.y)).rgb;
  gl_FragColor = vec4(mix(texture(tHigh, vUv).rgb, s * 0.0625, uScatter), 1.0);
}
`;

// The final pass: FXAA on the HDR scene (luma from the clamped linear colour, square-rooted to
// a perceptual scale), then at the anti-aliased position: + bloom → hue-keep → sRGB → grade → vignette →
// speed lines → dither. Folding FXAA in here saves a full-screen 8-bit target (a write and a
// read of the whole frame) and a pass. FXAA after Lottes' FXAA 3.11 / the Catlike Coding port
// in three's examples: early exit on 5 taps, edge walk of up to 6 steps each way.
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;      // 0 = no bloom texture bound
uniform vec2 uRes;         // buffer size, px
uniform float uLines;      // speed-line strength 0..1
uniform float uLinePhase;  // streak travel (advances with speed)
uniform vec2 uCenter;      // where the streaks radiate from (uv)
uniform vec3 uLineColor;
uniform float uPlain;      // tests: 1 = sRGB encode only (no AA, bloom, grade, vignette, lines, dither)
varying vec2 vUv;

float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

// Radial streaks out at the screen edges, flying outward.
float speedLines(vec2 px) {
  vec2 p = (px - uCenter * uRes) / uRes.y;   // in screen heights from the centre
  float r = length(p);
  float edge = smoothstep(0.34, 0.8, r);
  if (edge <= 0.0) return 0.0;
  const float N = 150.0;                     // angular cells
  float x = (atan(p.y, p.x) * 0.15915494 + 0.5) * N;
  float cell = floor(x);
  float ha = h1(cell), hb = h1(cell + 41.7);
  float present = step(0.52, ha);
  float px1 = N / (6.2831853 * max(r, 1e-3) * uRes.y);   // cells per pixel at this radius
  float w = 0.05 + 0.1 * hb;                              // half-width, cells
  float across = 1.0 - smoothstep(w - px1, w + px1, abs(fract(x) - 0.5));
  float along = fract(r * (1.3 + hb) - uLinePhase * (0.7 + 0.9 * ha) + hb * 9.0);
  float seg = smoothstep(0.0, 0.2, along) * (1.0 - smoothstep(0.32, 0.5, along));
  return present * across * seg * edge;
}

#ifdef FXAA
#define CONTRAST_T 0.0312
#define RELATIVE_T 0.063
#define SUBPIX 0.75
float L(vec2 uv) { return sqrt(dot(min(texture(tScene, uv).rgb, vec3(1.0)), vec3(0.299, 0.587, 0.114))); }
vec2 fxaa(vec2 uv0) {
  vec2 tx = 1.0 / uRes;
  float m = L(uv0);
  float n = L(uv0 + vec2(0.0, tx.y)), s = L(uv0 - vec2(0.0, tx.y));
  float e = L(uv0 + vec2(tx.x, 0.0)), w = L(uv0 - vec2(tx.x, 0.0));
  float hi = max(max(max(n, s), max(e, w)), m);
  float lo = min(min(min(n, s), min(e, w)), m);
  float contrast = hi - lo;
  if (contrast < max(CONTRAST_T, RELATIVE_T * hi)) return uv0;
  float ne = L(uv0 + tx), sw = L(uv0 - tx);
  float nw = L(uv0 + vec2(-tx.x, tx.y)), se = L(uv0 + vec2(tx.x, -tx.y));
  // sub-pixel blend
  float f = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
  f = clamp(abs(f - m) / contrast, 0.0, 1.0);
  f = smoothstep(0.0, 1.0, f);
  f = f * f * SUBPIX;
  // edge orientation and side
  float horz = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
  float vert = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
  bool isH = horz >= vert;
  float pL = isH ? n : e, nL = isH ? s : w;
  float pG = abs(pL - m), nG = abs(nL - m);
  float stepLen = isH ? tx.y : tx.x;
  float opp = pL, grad = pG;
  if (pG < nG) { stepLen = -stepLen; opp = nL; grad = nG; }
  vec2 uvE = uv0;
  vec2 eStep = isH ? vec2(tx.x, 0.0) : vec2(0.0, tx.y);
  if (isH) uvE.y += stepLen * 0.5; else uvE.x += stepLen * 0.5;
  float edgeL = (m + opp) * 0.5;
  float gT = grad * 0.25;
  float steps[6] = float[6](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
  vec2 puv = uvE + eStep * steps[0];
  float pD = L(puv) - edgeL;
  bool pEnd = abs(pD) >= gT;
  for (int i = 1; i < 6 && !pEnd; i++) { puv += eStep * steps[i]; pD = L(puv) - edgeL; pEnd = abs(pD) >= gT; }
  if (!pEnd) puv += eStep * 8.0;
  vec2 nuv = uvE - eStep * steps[0];
  float nD = L(nuv) - edgeL;
  bool nEnd = abs(nD) >= gT;
  for (int i = 1; i < 6 && !nEnd; i++) { nuv -= eStep * steps[i]; nD = L(nuv) - edgeL; nEnd = abs(nD) >= gT; }
  if (!nEnd) nuv -= eStep * 8.0;
  float pDist = isH ? puv.x - uv0.x : puv.y - uv0.y;
  float nDist = isH ? uv0.x - nuv.x : uv0.y - nuv.y;
  float shortest = min(pDist, nDist);
  bool dSign = pDist <= nDist ? pD >= 0.0 : nD >= 0.0;
  float edgeBlend = dSign == (m - edgeL >= 0.0) ? 0.0 : 0.5 - shortest / (pDist + nDist);
  float fin = max(f, edgeBlend);
  vec2 uv = uv0;
  if (isH) uv.y += stepLen * fin; else uv.x += stepLen * fin;
  return uv;
}
#endif

void main() {
  if (uPlain > 0.5) { gl_FragColor = vec4(dfmEncode(texture(tScene, vUv).rgb), 1.0); return; }
  #ifdef FXAA
  vec3 hdr = texture(tScene, fxaa(vUv)).rgb;
  #else
  vec3 hdr = texture(tScene, vUv).rgb;
  #endif
  if (uBloom > 0.0) hdr += texture(tBloom, vUv).rgb * uBloom;
  vec3 c = dfmGrade(dfmEncode(dfmHueKeep(hdr)));
  c *= dfmVignette(gl_FragCoord.xy, 1.0 / uRes, uGradeVig.z);
  if (uLines > 0.002) c = mix(c, uLineColor, speedLines(gl_FragCoord.xy) * uLines);
  c += dfmDither(gl_FragCoord.xy) * (1.0 / 255.0);
  gl_FragColor = vec4(c, 1.0); // the canvas has alpha: always opaque
}
`;

// ─────────────────────────────── levels ───────────────────────────────

interface PostSpec {
  chain: boolean; // false = straight to the canvas (in-material grade)
  bloomMips: number; // levels below the scene, the first at half resolution
  fxaa: boolean;
  /**
   * Scene target: true = RGBA16F (linear HDR: bloom tells a lit window at 1.6 from a sunlit
   * wall at 1.2); false = RGBA8 sRGB (half the bandwidth; light clips at 1 — at night after
   * each material's hue-keep, so lights still keep their colour — so bloom keys on clipped
   * light and stays off by day).
   */
  hdrScene: boolean;
}
export const POST_LEVELS: Record<GraphicsLevel, PostSpec> = {
  high: { chain: true, bloomMips: 5, fxaa: true, hdrScene: true },
  low: { chain: true, bloomMips: 3, fxaa: true, hdrScene: false },
  verylow: { chain: false, bloomMips: 0, fxaa: false, hdrScene: false },
};

/** Look constants (bloom works on linear light; daytime sunlit white walls reach about 1.2). */
export const POST_LOOK = {
  thresholdDay: 1.5,
  thresholdNight: 0.95,
  knee: 0.45, // × threshold
  bloomDay: 0.45,
  bloomNight: 0.9,
  // 8-bit scene target (LOW, or no float targets): light clips at 1
  ldrThresholdNight: 0.72,
  ldrBloomNight: 1.5,
  scatter: 0.62,
  vignette: 0.16,
  linesFrom: 78, // km/h where speed lines begin
  linesFull: 125,
  linesSpeed: 0.4, // strength from speed alone
  linesBoost: 0.85, // strength while boosting
  linesNight: 0.6, // × strength at night (white streaks read much harder on a dark frame)
};

function makePass(frag: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, string> = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    defines,
    vertexShader: FS_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
  });
}

function makeTarget(w: number, h: number, hdr: boolean, depth: boolean): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(w, h, {
    type: hdr ? HalfFloatType : UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  // 8-bit targets store linear light as sRGB8 (hardware encode/decode), so darks don't band
  if (!hdr) rt.texture.colorSpace = SRGBColorSpace;
  return rt;
}

export class Post {
  private spec: PostSpec;
  private fsScene = new Scene();
  private fsCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private sceneRT: WebGLRenderTarget | null = null;
  private sceneHdr = false;
  private down: WebGLRenderTarget[] = [];
  private up: WebGLRenderTarget[] = [];
  private w = 0;
  private h = 0;
  /** half-float targets render here (else every target is the 8-bit sRGB fallback) */
  floatOk: boolean;
  private floatChecked = false;
  private matPre: ShaderMaterial;
  private matDown: ShaderMaterial;
  private matUp: ShaderMaterial;
  private matFinal: ShaderMaterial;
  private matFinalAA: ShaderMaterial;
  private lines = 0;
  private boost = 0;
  private phase = 0;
  private tmp = new Vector2();
  /**
   * Test views (tools only): 'direct' = the scene straight to the canvas with no grade at all (the
   * look before the post chain); 'plain' = through the scene target and the final pass with only
   * the sRGB encode (must match 'direct' pixel for pixel); 'normal' = everything.
   */
  mode: 'normal' | 'direct' | 'plain' = 'normal';

  constructor(public renderer: WebGLRenderer, public level: GraphicsLevel) {
    this.spec = POST_LEVELS[level];
    renderer.info.autoReset = false;
    const ext = renderer.extensions;
    this.floatOk = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new Mesh(g);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
    this.matPre = makePass(PREFILTER_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThr: { value: [1, 0.5, 64] } });
    this.matDown = makePass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() } });
    this.matUp = makePass(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new Vector2() }, uScatter: { value: POST_LOOK.scatter } });
    // one uniform set shared by both variants of the final pass
    const fin = {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uRes: { value: new Vector2(1, 1) },
      uLines: { value: 0 }, uLinePhase: { value: 0 }, uCenter: { value: new Vector2(0.5, 0.56) }, uLineColor: { value: [1, 0.99, 0.96] },
      uPlain: { value: 0 },
      uGradeLift: env.uGradeLift, uGradeGamma: env.uGradeGamma, uGradeGain: env.uGradeGain, uGradeSat: env.uGradeSat,
      uGradeOn: { value: 0 }, uGradeVig: env.uGradeVig,
    };
    this.matFinal = makePass(FINAL_FRAG, fin);
    this.matFinalAA = makePass(FINAL_FRAG, fin, { FXAA: '' });
    env.uGradeVig.value.z = POST_LOOK.vignette;
  }

  setLevel(level: GraphicsLevel) {
    if (level === this.level) return;
    this.level = level;
    this.spec = POST_LEVELS[level];
    this.disposeTargets();
  }

  /** Drawing-buffer size in pixels (render() also follows the renderer's buffer by itself). */
  setSize(w: number, h: number) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w !== this.w || h !== this.h) this.disposeTargets();
    this.w = w;
    this.h = h;
  }

  /** Draws the post chain adds per frame at the current level (HIGH 10, LOW 6, VERY LOW 0). */
  get passes(): number {
    if (!this.spec.chain) return 0;
    const n = this.spec.bloomMips;
    return (n > 0 ? 1 + (n - 1) * 2 : 0) + 1;
  }

  private disposeTargets() {
    this.sceneRT?.dispose();
    for (const t of this.down) t.dispose();
    for (const t of this.up) t.dispose();
    this.sceneRT = null;
    this.down = [];
    this.up = [];
  }

  /** True when a half-float target is complete on this driver (checked once, on the first frame). */
  private checkFloat(): boolean {
    if (this.floatChecked) return this.floatOk;
    this.floatChecked = true;
    if (!this.floatOk) {
      console.warn('DRIVE FM: no float colour buffers; the post chain uses 8-bit sRGB targets');
      return false;
    }
    const r = this.renderer;
    const probe = makeTarget(4, 4, true, false);
    r.setRenderTarget(probe);
    const gl = r.getContext();
    this.floatOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    r.setRenderTarget(null);
    probe.dispose();
    if (!this.floatOk) console.warn('DRIVE FM: half-float render targets incomplete; the post chain uses 8-bit sRGB targets');
    return this.floatOk;
  }

  private ensureTargets() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.tmp);
    if (this.tmp.x !== this.w || this.tmp.y !== this.h) this.setSize(this.tmp.x, this.tmp.y);
    if (this.sceneRT) return;
    const { w, h } = this;
    const float = this.checkFloat();
    this.sceneHdr = float && this.spec.hdrScene;
    this.sceneRT = makeTarget(w, h, this.sceneHdr, true);
    let bw = w, bh = h;
    for (let i = 0; i < this.spec.bloomMips; i++) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      // bloom levels stay half-float whenever possible: soft halos band badly in 8 bits
      this.down.push(makeTarget(bw, bh, float, false));
      if (i < this.spec.bloomMips - 1) this.up.push(makeTarget(bw, bh, float, false));
    }
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(scene: Scene, camera: PerspectiveCamera, f: PostFrame) {
    const r = this.renderer;
    r.info.reset();
    const L = POST_LOOK;
    const night = Math.min(1, Math.max(0, f.night));
    // speed lines: ease in and out so they never pop
    const sp = Math.min(1, Math.max(0, (f.kmh - L.linesFrom) / (L.linesFull - L.linesFrom)));
    this.boost += (f.boost - this.boost) * Math.min(1, f.dt * (f.boost > this.boost ? 8 : 3));
    const want = Math.min(1, sp * sp * (3 - 2 * sp) * L.linesSpeed + this.boost * L.linesBoost) * (1 - (1 - L.linesNight) * night);
    this.lines += (want - this.lines) * Math.min(1, f.dt * 4);
    this.phase = (this.phase + f.dt * (0.5 + Math.max(0, f.kmh) / 90 + this.boost * 1.2)) % 1000;

    if (this.mode === 'direct') {
      env.uGradeOn.value = 0;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (!this.spec.chain) {
      env.uGradeOn.value = 1;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    this.ensureTargets();
    env.uGradeOn.value = this.sceneHdr ? 0 : 0.5;
    const sceneRT = this.sceneRT!;
    r.setRenderTarget(sceneRT);
    r.render(scene, camera);

    const autoClear = r.autoClear;
    r.autoClear = false;
    const fin = this.matFinal.uniforms;
    // ---- bloom
    const n = this.down.length;
    const plain = this.mode === 'plain';
    fin.uBloom.value = 0;
    fin.tBloom.value = null;
    if (n > 0 && !plain) {
      const hdr = this.sceneHdr;
      const thr = hdr ? L.thresholdDay + (L.thresholdNight - L.thresholdDay) * night : L.ldrThresholdNight;
      const strength = hdr ? L.bloomDay + (L.bloomNight - L.bloomDay) * night : L.ldrBloomNight * Math.max(0, night - 0.3) / 0.7;
      if (strength > 0.001) {
        const pre = this.matPre.uniforms;
        pre.tSrc.value = sceneRT.texture;
        (pre.uTexel.value as Vector2).set(1 / this.w, 1 / this.h);
        pre.uThr.value = [thr, thr * L.knee, 64];
        this.pass(this.matPre, this.down[0]);
        for (let i = 1; i < n; i++) {
          const src = this.down[i - 1];
          this.matDown.uniforms.tSrc.value = src.texture;
          (this.matDown.uniforms.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
          this.pass(this.matDown, this.down[i]);
        }
        let low = this.down[n - 1];
        for (let i = n - 2; i >= 0; i--) {
          const u = this.matUp.uniforms;
          u.tLow.value = low.texture;
          u.tHigh.value = this.down[i].texture;
          (u.uTexel.value as Vector2).set(1 / low.width, 1 / low.height);
          this.pass(this.matUp, this.up[i]);
          low = this.up[i];
        }
        fin.tBloom.value = low.texture;
        // fewer levels = a tighter halo carrying the same light: lift it a touch
        fin.uBloom.value = strength * (n < 5 ? 1.1 : 1);
      }
    }

    // ---- final: FXAA, bloom, grade, vignette, speed lines, dither → canvas
    fin.tScene.value = sceneRT.texture;
    (fin.uRes.value as Vector2).set(this.w, this.h);
    fin.uLines.value = this.lines;
    fin.uLinePhase.value = this.phase;
    fin.uPlain.value = plain ? 1 : 0;
    this.pass(this.spec.fxaa && !plain ? this.matFinalAA : this.matFinal, null);
    r.autoClear = autoClear;
  }

  dispose() {
    this.disposeTargets();
    for (const m of [this.matPre, this.matDown, this.matUp, this.matFinal, this.matFinalAA]) m.dispose();
    this.quad.geometry.dispose();
  }
}
