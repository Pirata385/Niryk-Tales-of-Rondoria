import { ValueNoise } from '../math/noise';
import { Rng, hashSeed } from '../math/random';
import { NATURE, assetsOfKind, type NatureAsset } from './natureCatalog';
import { DiscGrid, scatterDiscs, type Disc } from './scatter';

/** One 3D nature asset in the world (trees, bushes, rocks, logs, stumps). */
export interface NaturePlacement {
  asset: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Rotation around Y (radians). */
  rot: number;
  /** Per-instance color multiplier (small value/hue variation). */
  tint: [number, number, number];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NatureParams {
  seed: number;
  /** Where nature grows (may reach past the playable area: the woods beyond the border). */
  bounds: Bounds;
  height: (x: number, z: number) => number;
  /** 0..1: how wooded a spot is (0 = open meadow). */
  forest: (x: number, z: number) => number;
  /** True where nothing may grow (paths, water, structures) for a disc of radius r. */
  blocked: (x: number, z: number, r: number) => boolean;
  /** Hand-placed features (clearing landmarks), placed first; the rest keeps clear of them. */
  fixed?: NaturePlacement[];
  /** Tree attempts per m² (density). */
  density?: number;
}

export interface NatureResult {
  placements: NaturePlacement[];
  /** Solid obstacles for movement (trunks, rocks, bushes, stumps, logs). */
  colliders: Disc[];
}

/** Solid discs of a placed asset: its base cylinder, or a row of discs along a lying capsule (logs). */
export function solidsOf(p: NaturePlacement, a: NatureAsset = NATURE[p.asset]): Disc[] {
  if (a.capsule) {
    const [[ax, , az], [bx, , bz], r] = a.capsule;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const out: Disc[] = [];
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / (r * 1.6)) + 1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const lx = (ax + (bx - ax) * t) * p.scale;
      const lz = (az + (bz - az) * t) * p.scale;
      // three.js rotation.y: local (x, z) -> world (x cos + z sin, -x sin + z cos)
      out.push({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, r: r * p.scale });
    }
    return out;
  }
  return a.collider > 0 ? [{ x: p.x, z: p.z, r: a.collider * p.scale }] : [];
}

/**
 * Deterministic placement of the 3D woods: oaks and pine stands driven by the `forest` density,
 * bushes on the wood edges and under the trees, rock clusters, fallen logs and stumps.
 */
export function placeNature(p: NatureParams): NatureResult {
  const rng = new Rng(hashSeed(p.seed, 'nature'));
  const kind = new ValueNoise(hashSeed(p.seed, 'kind'));
  const out: NaturePlacement[] = [];
  const colliders: Disc[] = [];
  const crowns = new DiscGrid(6);
  const { bounds } = p;
  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const density = p.density ?? 0.05;
  const oaks = assetsOfKind('tree').filter((a) => !a.startsWith('pine'));
  const pines = assetsOfKind('tree').filter((a) => a.startsWith('pine'));
  const bushes = assetsOfKind('bush');
  const rocks = assetsOfKind('rock');
  const small = rocks.filter((r) => NATURE[r].radius < 0.8);
  const big = rocks.filter((r) => NATURE[r].radius >= 0.8);

  const tint = (amount: number): [number, number, number] => {
    const v = rng.range(-amount, amount);
    const h = rng.range(-amount, amount) * 0.8;
    return [1 + v + h, 1 + v, 1 + v - h];
  };
  const add = (pl: NaturePlacement) => {
    out.push(pl);
    colliders.push(...solidsOf(pl));
  };
  const push = (asset: string, x: number, z: number, scale?: number) => {
    const a = NATURE[asset];
    if (!a) return;
    const s = scale ?? rng.range(a.scale[0], a.scale[1]);
    const amount = a.kind === 'tree' || a.kind === 'bush' ? 0.07 : 0.04;
    add({ asset, x, y: p.height(x, z), z, scale: s, rot: rng.range(-Math.PI, Math.PI), tint: tint(amount) });
  };

  for (const f of p.fixed ?? []) {
    add(f);
    crowns.add({ x: f.x, z: f.z, r: NATURE[f.asset].radius * f.scale * 0.8 });
  }

  // 1. trees: pine stands where the "kind" noise is high (and on the higher ground), oaks elsewhere
  const pineAt = (x: number, z: number) => kind.fbm(x + 300, z - 120, 40, 2) + Math.min(8, Math.max(0, p.height(x, z))) * 0.012;
  const choose = (x: number, z: number) => {
    const r = kind.get(x * 0.9, z * 0.9);
    if (pines.length && pineAt(x, z) > 0.56) return pines[Math.floor(r * 97) % pines.length];
    return oaks.length ? oaks[Math.floor(r * 97) % oaks.length] : pines[0];
  };
  const trees = scatterDiscs(
    rng,
    crowns,
    bounds,
    Math.round(area * density),
    (x, z) => NATURE[choose(x, z)].radius * 0.62,
    (x, z) => rng.chance(p.forest(x, z)) && !p.blocked(x, z, 1.2),
    0.8,
  );
  for (const t of trees) push(choose(t.x, t.z), t.x, t.z);

  // 2. bushes: on the wood edges, a few under the trees
  const edge = (x: number, z: number) => {
    const f = p.forest(x, z);
    return f > 0.08 && f < 0.6 ? 0.6 : f >= 0.6 ? 0.12 : 0;
  };
  if (bushes.length) {
    scatterDiscs(rng, crowns, bounds, Math.round(area * 0.012), () => 0.85, (x, z) => rng.chance(edge(x, z)) && !p.blocked(x, z, 1), 0.9).forEach(
      (d) => push(rng.pick(bushes), d.x, d.z),
    );
  }

  // 3. rock clusters: a boulder (sometimes) with smaller stones around it
  if (rocks.length) {
    const clusters = Math.round(area / 700);
    for (let i = 0; i < clusters; i++) {
      const cx = rng.range(bounds.minX, bounds.maxX);
      const cz = rng.range(bounds.minZ, bounds.maxZ);
      if (p.blocked(cx, cz, 2) || !rng.chance(0.25 + p.forest(cx, cz) * 0.75)) continue;
      if (big.length && rng.chance(0.55)) {
        const b = rng.pick(big);
        if (crowns.free(cx, cz, NATURE[b].radius, 0.8)) {
          crowns.add({ x: cx, z: cz, r: NATURE[b].radius });
          push(b, cx, cz);
        }
      }
      for (let k = rng.int(1, 3); k > 0; k--) {
        const x = cx + rng.range(-2.2, 2.2);
        const z = cz + rng.range(-2.2, 2.2);
        const f = rng.pick(small.length ? small : rocks);
        if (!p.blocked(x, z, 0.5) && crowns.free(x, z, NATURE[f].radius, 0.9)) {
          crowns.add({ x, z, r: NATURE[f].radius });
          push(f, x, z);
        }
      }
    }
  }

  // 4. dead wood in the woods
  const dead = [...assetsOfKind('log'), ...assetsOfKind('stump')];
  if (dead.length) {
    scatterDiscs(rng, crowns, bounds, Math.round(area * 0.003), () => 1.0, (x, z) => p.forest(x, z) > 0.4 && !p.blocked(x, z, 1.2)).forEach((d) =>
      push(rng.pick(dead), d.x, d.z),
    );
  }

  return { placements: out, colliders };
}
