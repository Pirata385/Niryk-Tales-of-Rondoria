import { Rng } from '../math/random';

/** A circle that blocks placement (tree crowns, rocks, houses, roads...). */
export interface Disc {
  x: number;
  z: number;
  r: number;
}

/** Uniform grid of discs for fast "is this spot free?" queries. */
export class DiscGrid {
  private cells = new Map<number, Disc[]>();

  constructor(private readonly cell = 4) {}

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  add(d: Disc): void {
    const r = Math.ceil(d.r / this.cell);
    const ix = Math.floor(d.x / this.cell);
    const iz = Math.floor(d.z / this.cell);
    for (let i = ix - r; i <= ix + r; i++) {
      for (let j = iz - r; j <= iz + r; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(d);
      }
    }
  }

  /** True when a disc (x, z, r) keeps `factor * (r + other.r)` distance from every disc. */
  free(x: number, z: number, r: number, factor = 1): boolean {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return true;
    for (const d of list) {
      const min = factor * (r + d.r);
      const dx = d.x - x;
      const dz = d.z - z;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  nearest(x: number, z: number, maxDist: number): number {
    let best = Infinity;
    const r = Math.ceil(maxDist / this.cell);
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    for (let i = ix - r; i <= ix + r; i++) {
      for (let j = iz - r; j <= iz + r; j++) {
        for (const d of this.cells.get(this.key(i, j)) ?? []) {
          best = Math.min(best, Math.hypot(d.x - x, d.z - z) - d.r);
        }
      }
    }
    return best;
  }
}

/**
 * Dart throwing with variable radii (Poisson-disc-like): tries `attempts` random points in the
 * rectangle, keeps those where `accept` passes and the disc is free (spacing factor applied
 * to the sum of radii). Returns the accepted discs (also added to `grid`).
 */
export function scatterDiscs(
  rng: Rng,
  grid: DiscGrid,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  attempts: number,
  radius: (x: number, z: number) => number,
  accept: (x: number, z: number) => boolean,
  spacing = 0.75,
): Disc[] {
  const out: Disc[] = [];
  for (let i = 0; i < attempts; i++) {
    const x = rng.range(bounds.minX, bounds.maxX);
    const z = rng.range(bounds.minZ, bounds.maxZ);
    if (!accept(x, z)) continue;
    const r = radius(x, z);
    if (!grid.free(x, z, r, spacing)) continue;
    const d = { x, z, r };
    grid.add(d);
    out.push(d);
  }
  return out;
}
