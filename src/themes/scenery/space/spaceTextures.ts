import * as THREE from 'three';
import { canvas2d, finish } from '../../../engine/render/textures';

/** Small deterministic PRNG so the starfield and planets look the same on every load. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable 2D value noise (wraps every `period` cells in x and y) with fractal octaves. */
function makeNoise(seed: number, period: number): (x: number, y: number, octaves?: number) => number {
  const rnd = mulberry(seed);
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (ix: number, iy: number, p: number): number => grid[(((iy % p) + p) % p) * size + (((ix % p) + p) % p)];
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const value = (x: number, y: number, p: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy, p) + (at(ix + 1, iy, p) - at(ix, iy, p)) * fx;
    const b = at(ix, iy + 1, p) + (at(ix + 1, iy + 1, p) - at(ix, iy + 1, p)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += value(x * f, y * f, Math.min(size, period * f)) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
}

/** Fills an equirectangular planet texture from a per-pixel colour function (u, v in 0..1). */
function planetTexture(
  width: number,
  height: number,
  shade: (u: number, v: number, out: number[]) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const img = ctx.createImageData(width, height);
  const rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      shade(x / width, y / height, rgb);
      const o = (y * width + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function mix3(a: readonly number[], b: readonly number[], t: number, out: number[]): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * Deep-space backdrop tile: near-black blue with faint nebula clouds and a static starfield (no
 * twinkle). Tiles horizontally (RepeatWrapping) without visible seams.
 */
export function createStarfieldTexture(): THREE.CanvasTexture {
  const size = 2048;
  const noise = makeNoise(11, 8);
  const nebula = planetTexture(size / 4, size / 4, (u, v, out) => {
    const n = noise(u * 8, v * 8, 5);
    const m = noise(u * 8 + 3.7, v * 8 + 9.1, 4);
    const cloud = Math.max(0, n - 0.48) * 2.2;
    const tint = Math.max(0, m - 0.5) * 2;
    out[0] = 6 + cloud * 46 + tint * 30;
    out[1] = 9 + cloud * 22 + tint * 8;
    out[2] = 20 + cloud * 70 + tint * 26;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(nebula.image as HTMLCanvasElement, 0, 0, size, size);
  nebula.dispose();
  const rnd = mulberry(29);
  const star = (x: number, y: number, r: number, a: number, warm: number): void => {
    for (const dx of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      const c = warm > 0.5 ? '255,228,200' : warm < 0.2 ? '200,220,255' : '240,244,255';
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 2600; i++) {
    const big = rnd() < 0.04;
    star(rnd() * size, rnd() * size, big ? 2.6 + rnd() * 2 : 0.9 + rnd() * 1.2, big ? 0.8 : 0.25 + rnd() * 0.55, rnd());
  }
  const tex = finish(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Banded gas giant in warm ambers, with soft turbulence along the bands. */
export function createGasGiantTexture(): THREE.CanvasTexture {
  const noise = makeNoise(3, 16);
  const bands: readonly (readonly number[])[] = [
    [196, 118, 64],
    [232, 170, 104],
    [166, 88, 52],
    [240, 202, 150],
    [184, 104, 60],
  ];
  return planetTexture(1024, 512, (u, v, out) => {
    const warp = noise(u * 16, v * 4, 4) * 0.08;
    const t = (v + warp) * 9 + Math.sin(v * 40) * 0.15;
    const i = Math.floor(t);
    const f = t - i;
    mix3(
      bands[((i % bands.length) + bands.length) % bands.length],
      bands[(((i + 1) % bands.length) + bands.length) % bands.length],
      f * f * (3 - 2 * f),
      out,
    );
    const grain = 0.88 + noise(u * 64, v * 32, 3) * 0.24;
    out[0] *= grain;
    out[1] *= grain;
    out[2] *= grain;
  });
}

/** Ocean world: deep blues, green-brown continents and soft white cloud bands. */
export function createOceanPlanetTexture(): THREE.CanvasTexture {
  const land = makeNoise(5, 8);
  const cloud = makeNoise(9, 16);
  const deep = [14, 46, 120];
  const shallow = [34, 96, 176];
  const green = [70, 120, 78];
  const brown = [140, 122, 88];
  const white = [236, 242, 250];
  const tmp = [0, 0, 0];
  return planetTexture(1024, 512, (u, v, out) => {
    const h = land(u * 8, v * 4, 6);
    if (h < 0.52) mix3(deep, shallow, Math.max(0, (h - 0.3) / 0.22), out);
    else mix3(green, brown, Math.min(1, (h - 0.52) / 0.2), out);
    const polar = Math.max(0, Math.abs(v - 0.5) * 2 - 0.82) * 5.5;
    const c = Math.min(1, Math.max(0, cloud(u * 16 + v * 3, v * 8, 5) - 0.5) * 2.6 + polar);
    mix3(out, white, c * 0.85, tmp);
    out[0] = tmp[0];
    out[1] = tmp[1];
    out[2] = tmp[2];
  });
}

/** Grey cratered moon. */
export function createMoonTexture(seed = 17): THREE.CanvasTexture {
  const noise = makeNoise(seed, 16);
  const rnd = mulberry(seed * 7 + 1);
  const craters = Array.from({ length: 70 }, () => ({
    u: rnd(),
    v: 0.15 + rnd() * 0.7,
    r: 0.008 + rnd() * rnd() * 0.06,
  }));
  return planetTexture(1024, 512, (u, v, out) => {
    let g = 150 + (noise(u * 16, v * 8, 6) - 0.5) * 90;
    for (const c of craters) {
      let du = Math.abs(u - c.u);
      if (du > 0.5) du = 1 - du;
      const d = Math.hypot(du * 2, v - c.v) / c.r;
      if (d < 1) g -= 34 * (1 - d * d);
      else if (d < 1.25) g += 20 * (1 - (d - 1) / 0.25);
    }
    out[0] = g;
    out[1] = g * 0.98;
    out[2] = g * 0.96;
  });
}

/** Planar ring texture (for RingGeometry's planar UVs): soft concentric bands with alpha. */
export function createPlanetRingTexture(inner: number, outer: number): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = canvas2d(size);
  const c = size / 2;
  const img = ctx.createImageData(size, size);
  const rnd = mulberry(41);
  const bandNoise = Array.from({ length: 64 }, () => rnd());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c; // 0..1 maps to 0..outer
      const t = (r - inner / outer) / (1 - inner / outer);
      const o = (y * size + x) * 4;
      if (t < 0 || t > 1) {
        img.data[o + 3] = 0;
        continue;
      }
      const band = bandNoise[Math.min(63, Math.floor(t * 64))];
      const edge = Math.min(1, t * 8, (1 - t) * 8);
      img.data[o] = 214;
      img.data[o + 1] = 186;
      img.data[o + 2] = 150;
      img.data[o + 3] = Math.round(255 * edge * (0.25 + band * 0.55));
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(canvas);
}
