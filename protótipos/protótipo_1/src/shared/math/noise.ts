import { hashSeed } from './random';

/** 2D value noise in [0, 1] with smooth interpolation; deterministic for a seed. */
export class ValueNoise {
  private readonly perm: Uint8Array;
  private readonly values: Float32Array;

  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    let s = hashSeed(seed, 'noise');
    const rnd = () => {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      return s / 4294967296;
    };
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.values[i] = rnd();
  }

  private v(ix: number, iy: number): number {
    return this.values[this.perm[(this.perm[ix & 255] + iy) & 511]];
  }

  get(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let tx = x - x0;
    let ty = y - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = this.v(x0, y0) * (1 - tx) + this.v(x0 + 1, y0) * tx;
    const b = this.v(x0, y0 + 1) * (1 - tx) + this.v(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  }

  /** Fractal sum, result in [0, 1]. `scale` is the feature size in world units. */
  fbm(x: number, y: number, scale: number, octaves = 4): number {
    let amp = 1;
    let total = 0;
    let sum = 0;
    let f = 1 / scale;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.get(x * f + o * 17.3, y * f - o * 9.1);
      total += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / total;
  }
}
