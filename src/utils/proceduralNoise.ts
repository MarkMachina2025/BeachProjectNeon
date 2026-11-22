import * as THREE from 'three';

/** Deterministic PRNG (Mulberry32) so coastal foliage, shells, and sand grain never flicker across loads. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic C2 value noise, optionally tileable via positive lattice period. */
export function vnoise(x: number, y: number, seed = 0, period = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = (i: number) => (period > 0 ? ((i % period) + period) % period : i);
  const a = hash2(w(x0), w(y0), seed);
  const b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed);
  const d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Seamless multi-octave FBM noise. */
export function fbm(x: number, y: number, oct = 4, seed = 0, period = 0): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, seed + i * 17, period > 0 ? period * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/**
 * 256x256 tileable RGBA FBM noise texture:
 *  - R, G: 5-octave organic FBM fields (uncorrelated seeds)
 *  - B: high-frequency granular murmur
 *  - A: low-frequency macro coastal patchiness
 */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(u, v, 5, 1, 8) * 255);
      data[i + 1] = Math.round(fbm(u + 3.3, v + 1.7, 5, 9, 8) * 255);
      data[i + 2] = Math.round(fbm(u * 4, v * 4, 3, 23, 32) * 255);
      data[i + 3] = Math.round(fbm(u * 0.5, v * 0.5, 3, 41, 4) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Tileable fine-grain silica sand normal & mineral map:
 *  - R, G: micro-slope normal offsets
 *  - B: clumpy natural sand height variation
 *  - A: crisp white-noise facet hash for sunlit quartz micro-glints & tiny shell flecks
 */
export function makeGrainTexture(size = 256): THREE.DataTexture {
  const h = new Float32Array(size * size);
  const rnd = mulberry(77);
  for (let i = 0; i < h.length; i++) h[i] = rnd();

  const g = new Float32Array(size * size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = (at(x, y) * 2 + at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1)) / 6;
      const coarse = fbm((x / size) * 32, (y / size) * 32, 2, 5, 32);
      g[y * size + x] = fine * 0.65 + coarse * 0.35;
    }
  }
  const gat = (x: number, y: number) => g[((y + size) % size) * size + ((x + size) % size)];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = gat(x + 1, y) - gat(x - 1, y);
      const dy = gat(x, y + 1) - gat(x, y - 1);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(127.5 + dx * 420)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(127.5 + dy * 420)));
      data[i + 2] = Math.round(gat(x, y) * 255);
      data[i + 3] = Math.round(h[y * size + x] * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
