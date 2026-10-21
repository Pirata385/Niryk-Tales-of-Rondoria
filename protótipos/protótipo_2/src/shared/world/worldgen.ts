import { VILLAGE_RADIUS, WOLF_MIN_VILLAGE_DIST } from '../constants';
import { ValueNoise } from '../math/noise';
import { Rng, hashSeed } from '../math/random';
import type { Collider } from './collision';
import { NATURE } from './natureCatalog';
import { placeNature, type NaturePlacement } from './nature';
import { ROAD_HALF, STRUCTURES, distToPolyline, layoutVillage, type Pt, type Structure } from './village';

export { STRUCTURES, footprint, outlineGap, type Structure } from './village';
export type { NaturePlacement } from './nature';

/** What a world has. Prototype 2's style slice is a forest clearing without the village or wolves. */
export interface WorldOptions {
  /** Playable square (m); the land and the woods continue past it as scenery. */
  size: number;
  /** Prototype 1's starter village at the center (structures, plaza, roads). */
  village: boolean;
  /** Wolf dens in the woods (the server spawns wolves at them). */
  wolves: boolean;
}

export const CLEARING_WORLD: WorldOptions = { size: 180, village: false, wolves: false };
export const VILLAGE_WORLD: WorldOptions = { size: 200, village: true, wolves: true };

/** A pond: water surface at `level`, irregular shore of mean radius `r` (see WorldData.pondDist). */
export interface Pond {
  x: number;
  z: number;
  r: number;
  level: number;
}

export interface Den {
  x: number;
  z: number;
  r: number;
}

/** Something the camera must not pass through: a vertical cylinder from the ground to `top` (m, world y). */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number;
}

/** How the ground looks at a point (the client paints the terrain from it). */
export interface GroundSample {
  /** 0..1 bare dirt (trail, roads). */
  dirt: number;
  /** 0..1 wet mud (pond banks). */
  mud: number;
  /** 0..1 under the woods (darker, cooler). */
  forest: number;
  /** 0..1 large-scale variation of the grass tone. */
  tone: number;
}

export interface WorldData {
  seed: number;
  options: WorldOptions;
  size: number;
  half: number;
  /** How far the scenery reaches from the center (terrain, woods), past the playable `half`. */
  extent: number;
  /** The open meadow around the spawn (center and mean radius). */
  clearing: { x: number; z: number; r: number };
  /** Village only. */
  plaza: { x: number; z: number; r: number } | null;
  roads: Pt[][];
  /** A dirt trail from the clearing into the woods. */
  trail: Pt[];
  structures: Structure[];
  nature: NaturePlacement[];
  colliders: Collider[];
  obstacles: Obstacle[];
  dens: Den[];
  ponds: Pond[];
  /** Signed distance (m) to the nearest pond shore: < 0 in the water. */
  pondDist: (x: number, z: number) => number;
  /** Where players enter, and the yaw they face. */
  spawn: { x: number; z: number; yaw: number };
  height: (x: number, z: number) => number;
  ground: (x: number, z: number) => GroundSample;
  /** 0..1 density of grass tufts (the client scatters them near the player). */
  grass: (x: number, z: number) => number;
  /** 0..1 density of flower clumps. */
  flowers: (x: number, z: number) => number;
}

const TRAIL_HALF = 0.9;
/** How far past a pond's shore its bank reaches (m). */
const BANK = 3.2;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Deterministic world for a seed: a meadow clearing with a pond, a landmark oak and a boulder
 * group, gentle hills, oak woods and pine stands all around, a dirt trail into the woods, and
 * (with the options) prototype 1's village and wolf dens. Client and server both call this, so
 * they agree on every collider.
 */
export function generateWorld(seed: number, options: WorldOptions = CLEARING_WORLD): WorldData {
  const size = options.size;
  const half = size / 2;
  const extent = half + 40;
  const rng = new Rng(hashSeed(seed, 'world'));
  const relief = new ValueNoise(hashSeed(seed, 'relief'));
  const edgeNoise = new ValueNoise(hashSeed(seed, 'edge'));
  const forestNoise = new ValueNoise(hashSeed(seed, 'forest'));
  const village = options.village ? layoutVillage(rng, relief, half) : null;
  const clearing = village ? { x: 0, z: 0, r: VILLAGE_RADIUS * 0.8 } : { x: 0, z: 0, r: 17 };

  /** Distance past the clearing's wobbly edge (negative inside). */
  const clearingDist = (x: number, z: number) => {
    const a = Math.atan2(z - clearing.z, x - clearing.x);
    const wobble = (edgeNoise.get(Math.cos(a) * 1.4 + 5, Math.sin(a) * 1.4 + 5) - 0.5) * 0.55;
    return Math.hypot(x - clearing.x, z - clearing.z) - clearing.r * (1 + wobble);
  };
  const baseHeight = (x: number, z: number) => {
    const open = smooth(-6, 16, clearingDist(x, z));
    const hills = (relief.fbm(x, z, 38, 3) - 0.5) * 7;
    const swell = (relief.fbm(x + 61, z - 17, 18, 2) - 0.5) * 0.9;
    // the land rises toward the border and beyond it: a bowl of wooded hills closes the view
    const r = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
    return swell * (1 - open) + hills * open + smooth(half - 24, half + 34, r) * 14;
  };

  // the pond: a bowl dug into the meadow near the clearing's edge, with a muddy bank
  const ponds: Pond[] = [];
  const shoreNoise = new ValueNoise(hashSeed(seed, 'shore'));
  const pondDistTo = (p: Pond, x: number, z: number) => {
    const a = Math.atan2(z - p.z, x - p.x);
    const wobble = (shoreNoise.get(Math.cos(a) * 1.6 + p.x, Math.sin(a) * 1.6 + p.z) - 0.5) * 0.45;
    return Math.hypot(x - p.x, z - p.z) - p.r * (1 + wobble);
  };
  const pondDist = (x: number, z: number) => {
    let d = Infinity;
    for (const p of ponds) d = Math.min(d, pondDistTo(p, x, z));
    return d;
  };
  const height = (x: number, z: number) => {
    const h = baseHeight(x, z);
    for (const p of ponds) {
      const d = pondDistTo(p, x, z);
      if (d > BANK) continue;
      // the bank: one steady slope through the water line (the shore is exactly where pondDist
      // is 0), deepening inside and dry above the water outside, melting into the meadow by
      // BANK m out. The floor keeps the low side of a slope from dipping under the water.
      const bank = p.level + d * (d < 0 ? 0.16 : 0.12);
      const out = bank + (h - bank) * smooth(0.4, BANK, d);
      if (d <= 0.15) return out;
      const floor = p.level + 0.04 - smooth(BANK - 1.2, BANK, d) * Math.max(0, p.level + 0.04 - h);
      return Math.max(out, floor);
    }
    return h;
  };

  const pondAngle = rng.range(-Math.PI, Math.PI);
  if (!village) {
    const d = clearing.r * 0.72;
    const x = clearing.x + Math.cos(pondAngle) * d;
    const z = clearing.z + Math.sin(pondAngle) * d;
    ponds.push({ x, z, r: 4.6, level: baseHeight(x, z) - 0.3 });
  } else {
    // prototype 1: two ponds in open meadows away from the village and the roads
    const roads = village.roads;
    for (let i = 0; i < 300 && ponds.length < 2; i++) {
      const x = rng.range(-half + 16, half - 16);
      const z = rng.range(-half + 16, half - 16);
      const r = rng.range(4.5, 6.5);
      if (Math.hypot(x, z) < VILLAGE_RADIUS + 10 || Math.min(...roads.map((l) => distToPolyline(x, z, l))) < r + 7) continue;
      if (forestNoise.fbm(x, z, 34, 3) > 0.42) continue;
      if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 50)) continue;
      ponds.push({ x, z, r, level: baseHeight(x, z) - 0.35 });
    }
  }

  // a dirt trail from the clearing into the woods, on the side away from the pond
  const trailAngle = pondAngle + Math.PI + rng.range(-0.5, 0.5);
  const trail: Pt[] = [];
  if (!village) {
    let x = clearing.x + Math.cos(trailAngle) * clearing.r * 0.35;
    let z = clearing.z + Math.sin(trailAngle) * clearing.r * 0.35;
    let dir = trailAngle;
    while (Math.abs(x) < extent && Math.abs(z) < extent) {
      trail.push([x, z]);
      dir += (relief.get(x * 0.06 + 11, z * 0.06) - 0.5) * 0.7;
      dir = trailAngle + Math.max(-0.7, Math.min(0.7, dir - trailAngle));
      x += Math.cos(dir) * 3;
      z += Math.sin(dir) * 3;
    }
    trail.push([x, z]);
  }
  const roads = village?.roads ?? [];
  const trailDist = (x: number, z: number) => (trail.length ? distToPolyline(x, z, trail) : Infinity);
  const roadDist = (x: number, z: number) => (roads.length ? Math.min(...roads.map((r) => distToPolyline(x, z, r))) : Infinity);

  const structures = village?.structures ?? [];
  const plaza = village?.plaza ?? null;
  // spawn: in the clearing, the pond ahead and to the left, the landmark oak beyond it
  let spawn = { x: clearing.x - Math.cos(pondAngle) * 3, z: clearing.z - Math.sin(pondAngle) * 3, yaw: 0 };
  const view = pondAngle + 0.45; // where the camera looks at the start (world angle in XZ)
  spawn.yaw = Math.atan2(Math.cos(view), Math.sin(view));
  if (village) spawn = { ...village.spawn, yaw: Math.PI };

  const blocked = (x: number, z: number, r: number) => {
    if (plaza && Math.hypot(x - plaza.x, z - plaza.z) < plaza.r + 1 + r) return true;
    if (pondDist(x, z) < 1.2 + r) return true;
    if (roadDist(x, z) < ROAD_HALF + 0.2 + r) return true;
    if (trailDist(x, z) < TRAIL_HALF + 0.3 + r) return true;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 2.5 + r) return true;
    for (const s of structures) {
      const def = STRUCTURES[s.type];
      if (Math.hypot(x - s.x, z - s.z) < Math.max(def.w, def.d) / 2 + 1.5 + r) return true;
    }
    return false;
  };

  // how wooded each spot is: nothing in the clearing, thickening past its edge, a few glades, and
  // a dense wall past the playable border
  const forest = (x: number, z: number) => {
    const cd = clearingDist(x, z);
    const n = forestNoise.fbm(x, z, 30, 3);
    const r = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
    const wall = smooth(half - 12, half + 4, r);
    return clamp01(smooth(1, 12, cd) * (0.25 + (n - 0.3) * 2.2) + wall * 0.9);
  };

  // clearing landmarks: a big old oak at the edge, a boulder group, a fallen log by them
  const fixed: NaturePlacement[] = [];
  if (!village) {
    const at = (angle: number, inside: number): Pt => {
      // walk out from the center until `inside` m before the clearing edge
      let d = 0;
      while (d < clearing.r * 2 && clearingDist(clearing.x + Math.cos(angle) * d, clearing.z + Math.sin(angle) * d) < -inside) d += 0.25;
      return [clearing.x + Math.cos(angle) * d, clearing.z + Math.sin(angle) * d];
    };
    const put = (asset: string, [x, z]: Pt, scale: number, rot: number) => {
      if (NATURE[asset]) fixed.push({ asset, x, y: height(x, z), z, scale, rot, tint: [1, 1, 1] });
    };
    put('oak_1', at(pondAngle + 1.15, 2.5), 1.35, rng.range(-Math.PI, Math.PI));
    const rocksAt = at(pondAngle - 1.35, 3);
    put('rock_2', rocksAt, 1.15, rng.range(-Math.PI, Math.PI));
    put('rock_1', [rocksAt[0] + 1.7, rocksAt[1] + 0.9], 1.2, rng.range(-Math.PI, Math.PI));
    put('rock_1', [rocksAt[0] - 0.9, rocksAt[1] + 1.6], 0.85, rng.range(-Math.PI, Math.PI));
    const logAt = at(pondAngle - 1.9, 2.2);
    put('log_1', logAt, 1.1, pondAngle - 1.9);
    put('stump_1', at(pondAngle + 1.75, 1.2), 1.1, 0);
  }

  const reach = extent - 4;
  const nature = placeNature({
    seed,
    bounds: { minX: -reach, maxX: reach, minZ: -reach, maxZ: reach },
    height,
    forest,
    blocked,
    fixed,
    density: 0.055,
  });

  // colliders: structures, the water (a ring of circles along the shore keeps walkers on the bank),
  // and the solid nature inside the playable area
  const colliders: Collider[] = structures.map((s) => {
    const def = STRUCTURES[s.type];
    return def.round
      ? { kind: 'circle', x: s.x, z: s.z, r: def.w / 2 }
      : { kind: 'box', x: s.x, z: s.z, hw: def.w / 2, hd: def.d / 2, rot: s.rot };
  });
  for (const p of ponds) {
    colliders.push({ kind: 'circle', x: p.x, z: p.z, r: p.r * 0.7 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let rr = p.r;
      while (rr > 0.5 && pondDistTo(p, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr) > -0.4) rr -= 0.1;
      colliders.push({ kind: 'circle', x: p.x + Math.cos(a) * (rr - 0.6), z: p.z + Math.sin(a) * (rr - 0.6), r: 1.0 });
    }
  }
  const inside = (c: { x: number; z: number; r: number }) => Math.abs(c.x) < half + c.r && Math.abs(c.z) < half + c.r;
  colliders.push(...nature.colliders.filter(inside).map((c) => ({ kind: 'circle' as const, ...c })));

  // camera blockers: trunks (with their crowns) and rocks, near the playable area
  const obstacles: Obstacle[] = [];
  for (const p of nature.placements) {
    const a = NATURE[p.asset];
    if (!a || Math.abs(p.x) > half + 10 || Math.abs(p.z) > half + 10) continue;
    if (a.kind === 'tree') obstacles.push({ x: p.x, z: p.z, r: a.collider * p.scale + 0.12, top: p.y + a.height * p.scale });
    else if (a.collider > 0) obstacles.push({ x: p.x, z: p.z, r: a.collider * p.scale + 0.05, top: p.y + a.height * p.scale });
  }
  for (const s of structures) {
    const def = STRUCTURES[s.type];
    if (!def.painted) obstacles.push({ x: s.x, z: s.z, r: Math.min(def.w, def.d) / 2, top: height(s.x, s.z) + 3 });
  }

  // wolf dens deep in the woods, away from the center
  const dens: Den[] = [];
  if (options.wolves) {
    for (let i = 0; i < 400 && dens.length < 5; i++) {
      const x = rng.range(-half + 12, half - 12);
      const z = rng.range(-half + 12, half - 12);
      if (Math.hypot(x, z) < WOLF_MIN_VILLAGE_DIST + 6) continue;
      if (forestNoise.fbm(x, z, 30, 3) < 0.5) continue;
      if (dens.some((d) => Math.hypot(d.x - x, d.z - z) < 38)) continue;
      if (roadDist(x, z) < 6 || trailDist(x, z) < 4) continue;
      dens.push({ x, z, r: 7 });
    }
  }

  const toneNoise = new ValueNoise(hashSeed(seed, 'tone'));
  const ground = (x: number, z: number): GroundSample => {
    const track = Math.min(trailDist(x, z) / (TRAIL_HALF + 0.5), roadDist(x, z) / (ROAD_HALF + 0.6));
    const plazaDirt = plaza ? clamp01((plaza.r - Math.hypot(x - plaza.x, z - plaza.z)) / 1.5 + 0.5) : 0;
    const dirt = Math.max(clamp01(1.25 - track), plazaDirt);
    const mud = clamp01((1.3 - pondDist(x, z)) / 1.0);
    return { dirt, mud, forest: forest(x, z), tone: toneNoise.fbm(x, z, 14, 3) };
  };
  const tuftNoise = new ValueNoise(hashSeed(seed, 'tufts'));
  const grass = (x: number, z: number) => {
    const g = ground(x, z);
    if (g.dirt > 0.55 || pondDist(x, z) < 0.4) return 0;
    const patch = tuftNoise.fbm(x, z, 7, 2);
    const open = 0.55 + patch * 0.6;
    const wood = 0.12 + Math.max(0, patch - 0.45) * 1.2;
    return clamp01((open + (wood - open) * g.forest) * (1 - g.dirt * 1.4) * (1 - g.mud * 0.5));
  };
  const flowerNoise = new ValueNoise(hashSeed(seed, 'flowers'));
  const flowers = (x: number, z: number) => {
    const g = ground(x, z);
    if (g.dirt > 0.3 || g.mud > 0.3) return 0;
    const n = flowerNoise.fbm(x, z, 9, 2);
    return clamp01((n - 0.52) * 4) * (1 - g.forest * 0.85);
  };

  return {
    seed, options, size, half, extent, clearing, plaza, roads, trail, structures, nature: nature.placements, colliders, obstacles, dens,
    ponds, pondDist, spawn, height, ground, grass, flowers,
  };
}
