import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';

export interface WorldLayers {
  albedo: DataArrayTexture;
  emit: DataArrayTexture;
  layers: Record<string, number>;
  /** layer index by name; throws on a missing name so typos surface immediately */
  L: (name: string) => number;
  bytes: number;
}

interface Manifest { size: number; emitSize: number; perSheet: number; grid: number; sheets: number; count: number; layers: Record<string, number> }

async function sheetPixels(url: string, tile: number, grid: number, out: Uint8Array, firstLayer: number, count: number, outSize: number) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(outSize, outSize);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  for (let i = 0; i < count; i++) {
    const sx = (i % grid) * tile, sy = Math.floor(i / grid) * tile;
    g.clearRect(0, 0, outSize, outSize);
    g.drawImage(bmp, sx, sy, tile, tile, 0, 0, outSize, outSize);
    const d = g.getImageData(0, 0, outSize, outSize).data;
    out.set(d, (firstLayer + i) * outSize * outSize * 4);
  }
  bmp.close();
}

/** Loads the painted world texture arrays. `scale` 1 = full size, 0.5 = half (LOW / VERY LOW). */
export async function loadWorldLayers(base: string, scale = 1): Promise<WorldLayers> {
  const m: Manifest = await (await fetch(`${base}/world_layers.json`)).json();
  const S = Math.max(64, Math.round(m.size * scale));
  const E = Math.max(32, Math.round(m.emitSize * scale));
  const n = Math.max(1, m.count);
  const A = new Uint8Array(S * S * 4 * n);
  const M = new Uint8Array(E * E * 4 * n);
  const jobs: Promise<void>[] = [];
  for (let k = 0; k < m.sheets; k++) {
    const count = Math.min(m.perSheet, n - k * m.perSheet);
    jobs.push(sheetPixels(`${base}/world_albedo_${k}.webp`, m.size, m.grid, A, k * m.perSheet, count, S));
    jobs.push(sheetPixels(`${base}/world_emit_${k}.webp`, m.emitSize, m.grid, M, k * m.perSheet, count, E));
  }
  await Promise.all(jobs);
  const mk = (data: Uint8Array, s: number) => {
    const t = new DataArrayTexture(data, s, s, n);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const albedo = mk(A, S);
  const emit = mk(M, E);
  const L = (name: string) => {
    const i = m.layers[name];
    if (i === undefined) throw new Error(`unknown texture layer ${name}`);
    return i;
  };
  return { albedo, emit, layers: m.layers, L, bytes: Math.round((A.byteLength + M.byteLength) * 1.333) };
}
