import { ValueNoise } from '../math/noise';
import { Rng, hashSeed } from '../math/random';
import { DiscGrid, scatterDiscs, type Disc } from './scatter';

/** What the placer needs to know about each painted sprite (from the atlas manifest). */
export interface NatureFrameInfo {
  kind?: string;
  /** Crown/footprint radius in meters (spacing). */
  radius?: number;
  /** Collision radius in meters (0 = walk through). */
  collider?: number;
}

export interface NaturePlacement {
  frame: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  flip: boolean;
  /** Per-instance color multiplier (±4% value/hue variation). */
  tint: [number, number, number];
}

export interface NatureParams {
  seed: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  frames: Record<string, NatureFrameInfo>;
  height: (x: number, z: number) => number;
  /** True where nothing may grow (roads, plaza, buildings) for a disc of radius r. */
  blocked: (x: number, z: number, r: number) => boolean;
  /** Extra trees per m² multiplier (1 = default). */
  density?: number;
}

export interface NatureResult {
  placements: NaturePlacement[];
  /** Solid obstacles for movement (trunks, rocks, bushes...). */
  colliders: Disc[];
  /** 0..1 shade of the woods at a point (for the ground's cool tint). */
  shade: (x: number, z: number) => number;
}

const OAKS = ['oak_round_1', 'oak_round_2', 'oak_wide_1', 'oak_tall_1', 'oak_lean_1', 'oak_twin_1'];
const PINES = ['pine_s_1', 'pine_1', 'pine_2', 'pine_t_1'];
const BUSHES = ['bush_1', 'bush_2', 'bush_3', 'bush_4'];
const ROCKS = ['rock_s1', 'rock_s2', 'rock_m1', 'rock_m2', 'rock_buried_1'];
const GRASS = ['grass_1', 'grass_2', 'grass_3', 'grass_4'];
const GRASS_FLOWERS = ['grass_flower_y', 'grass_flower_w', 'grass_flower_l'];
const FLOWER_DECALS = ['decal_flowers_1', 'decal_flowers_2', 'decal_flowers_3', 'decal_flowers_4', 'decal_flowers_5', 'decal_flowers_6'];

/**
 * Deterministic placement of the 2D nature of the Campos de Rondoria biome: woods driven by noise
 * (oak woods and pine stands), bushes on the wood edges, rock clusters, undergrowth, grass tufts
 * clustered at bases and path edges, flower patches in the meadows and leaf litter under oaks.
 */
export function placeNature(p: NatureParams): NatureResult {
  const rng = new Rng(hashSeed(p.seed, 'nature'));
  const forest = new ValueNoise(hashSeed(p.seed, 'forest'));
  const kind = new ValueNoise(hashSeed(p.seed, 'kind'));
  const meadow = new ValueNoise(hashSeed(p.seed, 'meadow'));
  const out: NaturePlacement[] = [];
  const colliders: Disc[] = [];
  const crowns = new DiscGrid(6);
  const smalls = new DiscGrid(3);
  const decals = new DiscGrid(4);
  const { bounds } = p;
  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const density = p.density ?? 1;
  const has = (f: string) => f in p.frames;
  const radius = (f: string) => p.frames[f]?.radius ?? 0.5;

  const tint = (amount = 0.04): [number, number, number] => {
    const v = rng.range(-amount, amount);
    const h = rng.range(-amount, amount) * 0.8;
    return [1 + v + h, 1 + v, 1 + v - h];
  };
  const push = (frame: string, x: number, z: number, scale = 1, extra: Partial<NaturePlacement> = {}) => {
    if (!has(frame)) return;
    const kindOf = p.frames[frame].kind;
    out.push({ frame, x, y: p.height(x, z), z, scale, flip: rng.chance(0.5), tint: tint(kindOf === 'tree' || kindOf === 'bush' ? 0.08 : 0.04), ...extra });
    const col = (p.frames[frame].collider ?? 0) * scale;
    if (col > 0) colliders.push({ x, z, r: col });
  };
  const forestAt = (x: number, z: number) => forest.fbm(x, z, 34, 3);
  const pineAt = (x: number, z: number) => kind.fbm(x + 300, z - 120, 46, 2);
  const meadowAt = (x: number, z: number) => meadow.fbm(x, z, 16, 3);

  // 1. a few old "hero" oaks in clearings, then the woods
  for (let i = 0; i < Math.max(1, Math.round(area / 9000)); i++) {
    for (let t = 0; t < 40; t++) {
      const x = rng.range(bounds.minX + 10, bounds.maxX - 10);
      const z = rng.range(bounds.minZ + 10, bounds.maxZ - 10);
      const f = forestAt(x, z);
      if (f < 0.42 || f > 0.55 || p.blocked(x, z, 5) || !crowns.free(x, z, 4.2, 1)) continue;
      crowns.add({ x, z, r: 3.8 });
      push('oak_hero_1', x, z, 1);
      break;
    }
  }
  const trees = scatterDiscs(
    rng,
    crowns,
    bounds,
    Math.round(area * 0.12 * density),
    (x, z) => {
      const f = choose(x, z);
      return radius(f) * 0.95;
    },
    (x, z) => {
      const f = forestAt(x, z);
      const pr = f > 0.55 ? Math.min(1, (f - 0.5) * 3.2) : f > 0.45 ? 0.04 : 0.006;
      return rng.chance(pr) && !p.blocked(x, z, 2.5);
    },
    0.75,
  );
  function choose(x: number, z: number): string {
    const k = pineAt(x, z);
    const r = kind.get(x * 0.9, z * 0.9);
    if (k > 0.58) return PINES[Math.floor(r * 4) % 4];
    if (k < 0.33 && r > 0.55) return r > 0.8 ? 'birch_2' : 'birch_1';
    if (r < 0.04) return 'dead_1';
    if (r > 0.93) return 'oak_autumn_1';
    if (r > 0.88) return 'oak_blossom_1';
    return OAKS[Math.floor(r * 97) % OAKS.length];
  }
  for (const t of trees) {
    const frame = choose(t.x, t.z);
    const scale = frame.startsWith('pine') ? rng.range(0.85, 1.2) : rng.range(0.8, 1.25);
    push(frame, t.x, t.z, scale);
    // leaf litter under broadleaf trees
    if (frame.startsWith('oak') && rng.chance(0.7)) {
      push(frame === 'oak_autumn_1' ? 'decal_leaves_autumn' : 'decal_leaves_dry', t.x + rng.range(-0.3, 0.3), t.z + rng.range(-0.3, 0.3));
    }
  }

  // 2. bushes and hedges on the wood edges
  scatterDiscs(rng, crowns, bounds, Math.round(area * 0.02 * density), () => 0.9, (x, z) => {
    const f = forestAt(x, z);
    return f > 0.44 && f < 0.6 && rng.chance(0.55) && !p.blocked(x, z, 1);
  }).forEach((d) => push(rng.chance(0.06) ? 'hedge_1' : rng.pick(BUSHES), d.x, d.z, rng.range(0.85, 1.15)));

  // 3. rock clusters
  const nClusters = Math.round(area / 1100);
  for (let i = 0; i < nClusters; i++) {
    const cx = rng.range(bounds.minX, bounds.maxX);
    const cz = rng.range(bounds.minZ, bounds.maxZ);
    if (p.blocked(cx, cz, 2)) continue;
    const big = rng.chance(0.35) ? rng.pick(['boulder_1', 'rock_group_1']) : rng.pick(['rock_m1', 'rock_m2']);
    if (crowns.free(cx, cz, radius(big), 0.8)) {
      crowns.add({ x: cx, z: cz, r: radius(big) });
      push(big, cx, cz, rng.range(0.9, 1.15));
    }
    for (let k = rng.int(1, 4); k > 0; k--) {
      const x = cx + rng.range(-2.5, 2.5);
      const z = cz + rng.range(-2.5, 2.5);
      const f = rng.pick(ROCKS);
      if (!p.blocked(x, z, 0.5) && crowns.free(x, z, radius(f), 0.9)) {
        crowns.add({ x, z, r: radius(f) });
        push(f, x, z, rng.range(0.85, 1.15));
      }
    }
  }

  // 4. dead wood and undergrowth in the woods, tall grass/flowers in the meadows
  scatterDiscs(rng, crowns, bounds, Math.round(area * 0.004), () => 0.8, (x, z) => forestAt(x, z) > 0.55 && !p.blocked(x, z, 1)).forEach(
    (d) => {
      const f = rng.chance(0.5) ? 'log_1' : 'stump_1';
      push(f, d.x, d.z);
      if (rng.chance(0.5)) push('mushrooms_1', d.x + rng.range(-0.8, 0.8), d.z + rng.range(0.3, 0.9));
    },
  );
  scatterDiscs(rng, smalls, bounds, Math.round(area * 0.05), () => 0.5, (x, z) => {
    const f = forestAt(x, z);
    const m = meadowAt(x, z);
    if (p.blocked(x, z, 0.4) || !crowns.free(x, z, 0.3, 0.5)) return false;
    return (f > 0.5 && rng.chance(0.35)) || (m > 0.6 && rng.chance(0.25));
  }).forEach((d) => {
    const f = forestAt(d.x, d.z);
    const frame = f > 0.5 ? rng.pick(['fern_1', 'fern_2', 'fern_1', 'tall_grass_2']) : rng.pick(['tall_grass_1', 'tall_grass_2', 'tall_flowers_l', 'tall_flowers_y']);
    push(frame, d.x, d.z, rng.range(0.85, 1.15));
  });

  // 5. grass tufts in clumps: at the base of trees and rocks, along the paths, plus noise clumps
  const tufts = Math.round(area * 0.55);
  for (let i = 0; i < tufts; i++) {
    const x = rng.range(bounds.minX, bounds.maxX);
    const z = rng.range(bounds.minZ, bounds.maxZ);
    if (p.blocked(x, z, 0.2)) continue;
    const nearSolid = crowns.nearest(x, z, 3);
    const nearPath = p.blocked(x, z, 1.4);
    const clump = meadowAt(x * 1.7, z * 1.7);
    const pr = (nearSolid < 1.2 ? 0.45 : 0) + (nearPath ? 0.3 : 0) + (clump > 0.6 ? 0.3 : 0.06);
    if (!rng.chance(Math.min(0.9, pr))) continue;
    const flower = (meadowAt(x, z) > 0.5 && rng.chance(0.25)) || rng.chance(0.04);
    push(flower ? rng.pick(GRASS_FLOWERS) : rng.pick(GRASS), x, z, rng.range(0.85, 1.15));
  }

  // 6. flower patches (flat decals) in the meadows, clover and pebbles here and there
  scatterDiscs(rng, decals, bounds, Math.round(area * 0.05), () => 1.4, (x, z) => meadowAt(x, z) > 0.46 && forestAt(x, z) < 0.52 && !p.blocked(x, z, 1)).forEach(
    (d) => push(rng.pick(FLOWER_DECALS), d.x, d.z, rng.range(0.85, 1.2)),
  );
  scatterDiscs(rng, decals, bounds, Math.round(area * 0.003), () => 1, (x, z) => !p.blocked(x, z, 0.6)).forEach((d) =>
    push(rng.chance(0.6) ? 'decal_clover_1' : 'decal_pebbles_1', d.x, d.z),
  );

  const shade = (x: number, z: number) => {
    const d = crowns.nearest(x, z, 4);
    return d < 0 ? 1 : Math.max(0, 1 - d / 3);
  };
  return { placements: out, colliders, shade };
}
