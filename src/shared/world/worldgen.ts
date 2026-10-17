import natureAtlas from '../../../assets/sprites/nature.json';
import { VILLAGE_RADIUS, WOLF_MIN_VILLAGE_DIST, WORLD_SIZE } from '../constants';
import { ValueNoise } from '../math/noise';
import { Rng, hashSeed } from '../math/random';
import type { Collider } from './collision';
import { placeNature, type NatureFrameInfo, type NatureResult } from './nature';

/**
 * Structures of the village (models: assets/models/<type>.glb, front faces +Z), with the collider
 * footprint in meters. `painted` ones have no model: a flower bed is a gap in the plaza's paving
 * (see `splat`) planted with nature sprites.
 */
export const STRUCTURES: Record<string, { w: number; d: number; round?: boolean; painted?: boolean }> = {
  house_a: { w: 6.2, d: 5.2 },
  house_b: { w: 7.6, d: 6.2 },
  house_c: { w: 5.2, d: 4.6 },
  well: { w: 2.4, d: 2.4, round: true },
  stall: { w: 3.1, d: 1.9 },
  notice: { w: 1.6, d: 0.45 },
  lamp: { w: 0.4, d: 0.4, round: true },
  crates: { w: 1.6, d: 0.9 },
  barrels: { w: 1.45, d: 0.9 },
  fence: { w: 3.0, d: 0.25 },
  bench: { w: 1.6, d: 0.55 },
  flower_bed: { w: 1.5, d: 1.5, round: true, painted: true },
};

/** Radius of a flower bed's planted soil; the curb ring of the paving runs just outside it. */
const BED_RADIUS = 0.85;

export interface Structure {
  type: string;
  x: number;
  z: number;
  /** Rotation around Y (radians). */
  rot: number;
}

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

export interface WorldData {
  seed: number;
  size: number;
  half: number;
  plaza: { x: number; z: number; r: number };
  roads: [number, number][][];
  structures: Structure[];
  nature: NatureResult;
  colliders: Collider[];
  dens: Den[];
  ponds: Pond[];
  /** Signed distance (m) to the nearest pond shore: < 0 in the water. */
  pondDist: (x: number, z: number) => number;
  spawn: { x: number; z: number };
  height: (x: number, z: number) => number;
  /** Ground splat weights: r grass B, g dirt road, b cobble plaza, a cool wood shade. */
  splat: (x: number, z: number) => [number, number, number, number];
}

const ROAD_HALF = 1.5;

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function distToPolyline(px: number, pz: number, line: [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distToSegment(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}

type Pt = [number, number];

/** Collider outline of a structure on the ground (x, z): a box's corners, a 12-gon around a circle. */
export function footprint(s: Structure): Pt[] {
  const def = STRUCTURES[s.type];
  if (def.round) {
    const r = def.w / 2 / Math.cos(Math.PI / 12);
    return Array.from({ length: 12 }, (_, k): Pt => [s.x + Math.cos((k * Math.PI) / 6) * r, s.z + Math.sin((k * Math.PI) / 6) * r]);
  }
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  // same convention as three.js rotation.y (and the box colliders)
  return corners.map(([sx, sz]): Pt => [s.x + (sx * def.w * c + sz * def.d * n) / 2, s.z + (-sx * def.w * n + sz * def.d * c) / 2]);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function insideConvex(poly: Pt[], p: Pt): boolean {
  if (poly.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], p);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function segmentsDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    distToSegment(a[0], a[1], c[0], c[1], d[0], d[1]),
    distToSegment(b[0], b[1], c[0], c[1], d[0], d[1]),
    distToSegment(c[0], c[1], a[0], a[1], b[0], b[1]),
    distToSegment(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

/** Gap (m) between two convex outlines (a 2-point outline is a segment); 0 when they overlap. */
export function outlineGap(a: Pt[], b: Pt[]): number {
  if (insideConvex(a, b[0]) || insideConvex(b, a[0])) return 0;
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) d = Math.min(d, segmentsDist(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
  }
  return d;
}

/**
 * Deterministic world for a seed: rolling meadows, the starter village at the center (cobbled
 * plaza with a well, houses facing the plaza, market stall, notice board, lamps, fences), three
 * dirt roads leaving the village, woods and meadows of painted nature, and wolf dens in the woods.
 * Client and server both call this, so they agree on every collider.
 */
export function generateWorld(seed: number): WorldData {
  const size = WORLD_SIZE;
  const half = size / 2;
  const rng = new Rng(hashSeed(seed, 'world'));
  const relief = new ValueNoise(hashSeed(seed, 'relief'));
  const plaza = { x: 0, z: 0, r: 8.5 };

  const baseHeight = (x: number, z: number) => {
    const h = (relief.fbm(x, z, 40, 3) - 0.5) * 2.2;
    const v = Math.hypot(x, z);
    const flat = Math.min(1, Math.max(0, (v - VILLAGE_RADIUS * 0.7) / (VILLAGE_RADIUS * 0.6)));
    return h * flat * flat;
  };
  // ponds (filled in once the roads are known): a bowl dug into the meadow with a muddy bank
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
      if (d > 2.2) continue;
      // smooth bowl: the bank slopes down to just under the water at the shore, then deepens
      const t = Math.min(1, Math.max(0, (2.2 - d) / 2.2));
      const bowl = p.level - 0.2 - Math.max(0, -d) * 0.12;
      return h + (bowl - h) * (t * t * (3 - 2 * t));
    }
    return h;
  };

  // roads: from the plaza edge to the world border, gently wandering
  const roadAngles = [-1.65, 0.35, 2.45].map((a) => a + rng.range(-0.15, 0.15));
  const roads: [number, number][][] = roadAngles.map((a) => {
    const pts: [number, number][] = [];
    let x = Math.cos(a) * (plaza.r - 1);
    let z = Math.sin(a) * (plaza.r - 1);
    let dir = a;
    while (Math.abs(x) < half - 2 && Math.abs(z) < half - 2) {
      pts.push([x, z]);
      dir += (relief.get(x * 0.05 + 7, z * 0.05) - 0.5) * 0.5;
      dir = a + Math.max(-0.5, Math.min(0.5, dir - a));
      x += Math.cos(dir) * 4;
      z += Math.sin(dir) * 4;
    }
    pts.push([x, z]);
    return pts;
  });
  const roadDist = (x: number, z: number) => Math.min(...roads.map((r) => distToPolyline(x, z, r)));

  // two ponds in open meadows, away from the village, the roads and the woods
  const forest = new ValueNoise(hashSeed(seed, 'forest'));
  for (let i = 0; i < 300 && ponds.length < 2; i++) {
    const x = rng.range(-half + 16, half - 16);
    const z = rng.range(-half + 16, half - 16);
    const r = rng.range(4.5, 6.5);
    if (Math.hypot(x, z) < VILLAGE_RADIUS + 10 || roadDist(x, z) < r + 7) continue;
    if (forest.fbm(x, z, 34, 3) > 0.42) continue;
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 50)) continue;
    ponds.push({ x, z, r, level: baseHeight(x, z) - 0.35 });
  }

  // village structures (layout around the plaza, avoiding the roads)
  const structures: Structure[] = [];
  const facing = (x: number, z: number) => Math.atan2(plaza.x - x, plaza.z - z); // +Z of the model faces the plaza
  const houseTypes = ['house_a', 'house_b', 'house_c', 'house_a', 'house_c', 'house_b'];
  const slots = [0.0, 0.33, 0.66].flatMap((f) => roadAngles.map((a, i) => a + ((roadAngles[(i + 1) % 3] - a + Math.PI * 4) % (Math.PI * 2)) * (0.3 + f * 0.6)));
  let hi = 0;
  for (const ang of slots) {
    if (hi >= houseTypes.length) break;
    const type = houseTypes[hi];
    const r = 16 + rng.range(0, 3) + (type === 'house_b' ? 1.5 : 0);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const s = STRUCTURES[type];
    if (roadDist(x, z) < Math.max(s.w, s.d) / 2 + ROAD_HALF + 1.2) continue;
    if (structures.some((o) => Math.hypot(o.x - x, o.z - z) < 8.5)) continue;
    structures.push({ type, x, z, rot: facing(x, z) + rng.range(-0.12, 0.12) });
    hi++;
  }
  const well: Structure = { type: 'well', x: plaza.x, z: plaza.z, rot: 0.3 };
  structures.push(well);
  const free = (x: number, z: number, r: number) =>
    roadDist(x, z) > ROAD_HALF + r && structures.every((o) => Math.hypot(o.x - x, o.z - z) > r + Math.max(STRUCTURES[o.type].w, STRUCTURES[o.type].d) / 2);
  const around = (type: string, ang: number, r: number, rotOffset = 0) => {
    for (let k = 0; k < 12; k++) {
      const a = ang + k * 0.21 * (k % 2 ? 1 : -1);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (free(x, z, Math.max(STRUCTURES[type].w, STRUCTURES[type].d) / 2 + 0.3)) {
        structures.push({ type, x, z, rot: facing(x, z) + rotOffset });
        return;
      }
    }
  };
  around('notice', roadAngles[1] + 0.35, plaza.r + 1.2);

  // the plaza: a market corner (stall with crates and barrels), two benches facing the well, each
  // with a flower bed at one end, and beds flanking the road mouths. All of it stays off the lanes people
  // walk: the road mouths to the well, a ring around the well, the spawn and a new player's first
  // steps (screen-up of the fixed isometric camera is world -X-Z, the way tools/e2e.mjs walks).
  const spawn = { x: plaza.x, z: plaza.z + plaza.r - 3 };
  const lanes: [Pt, Pt, number][] = roads.map((r): [Pt, Pt, number] => [[plaza.x, plaza.z], r[0], ROAD_HALF]);
  lanes.push([[spawn.x, spawn.z], [spawn.x - 6, spawn.z - 6], 1.5]);
  const plazaProps: Structure[] = [];
  const fits = (s: Structure, gap: number, group: Structure[] = []) => {
    const fp = footprint(s);
    if (fp.some(([x, z]) => Math.hypot(x - plaza.x, z - plaza.z) > plaza.r - 0.4)) return false;
    if (outlineGap(fp, footprint(well)) < 1.5 || Math.hypot(s.x - spawn.x, s.z - spawn.z) < 2.6) return false;
    if (lanes.some(([a, b, half]) => outlineGap(fp, [a, b]) < half)) return false;
    if (roads.some((r) => r.slice(0, 3).some((p, i) => i > 0 && outlineGap(fp, [r[i - 1], p]) < ROAD_HALF + 0.3))) return false;
    return plazaProps.every((o) => outlineGap(fp, footprint(o)) >= (group.includes(o) ? 0.25 : gap));
  };
  /**
   * Places `type` at the first candidate spot (x, z, rot) that fits, `gap` m from other props
   * (0.25 m from the members of its group).
   */
  const place = (type: string, gap: number, spots: [number, number, number][], group: Structure[] = []) => {
    for (const [x, z, rot] of spots) {
      const s = { type, x, z, rot };
      if (!fits(s, gap, group)) continue;
      structures.push(s);
      plazaProps.push(s);
      return s;
    }
    return undefined;
  };
  /** A spot at angle `a`, `r` m from the well, facing it (+ turn). */
  const spot = (a: number, r: number, turn = 0): [number, number, number] => {
    const x = plaza.x + Math.cos(a) * r;
    const z = plaza.z + Math.sin(a) * r;
    return [x, z, facing(x, z) + turn];
  };
  /** Spots on a circle around the well, nearest to angle `ang` first. */
  const ring = (ang: number, r: number, turn = 0) => Array.from({ length: 31 }, (_, k) => spot(ang + Math.ceil(k / 2) * 0.06 * (k % 2 ? 1 : -1), r, turn));
  /** A spot in the local frame of `base` (lx to its left, lz to its front). */
  const local = (base: Structure, lx: number, lz: number, turn = 0): [number, number, number] => {
    const c = Math.cos(base.rot);
    const n = Math.sin(base.rot);
    return [base.x + lx * c + lz * n, base.z - lx * n + lz * c, base.rot + turn];
  };
  /** Angle at fraction f of the way from road i to the next one (by increasing angle). */
  const sector = (i: number, f: number) => {
    const span = (((roadAngles[(i + 1) % 3] - roadAngles[i]) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return roadAngles[i] + span * f;
  };
  // market corner between the north and east roads, the counter turned toward the open side of
  // the plaza (and the camera) rather than squarely at the well
  const stall = place('stall', 0.9, [4.8, 5.2, 4.5].flatMap((r) => ring(sector(0, 0.42), r, 0.6)));
  if (stall) {
    const market = [stall];
    const crates = place('crates', 0.9, [local(stall, 2.75, -0.35, 0.25), local(stall, -2.75, -0.35, -0.25), local(stall, 0.4, -1.8, 0.15)], market);
    if (crates) market.push(crates);
    place('barrels', 0.9, [local(stall, 2.6, 1.7, 0.85), local(stall, -2.6, 1.7, -0.85), local(stall, -0.6, -1.8, -0.2)], market);
  }
  // two benches facing the well from opposite sides, a bed at one end of each
  for (const [i, f, r] of [[2, 0.64, 5.6], [1, 0.3, 4.0]]) {
    const bench = place('bench', 0.9, [r, r + 0.4, r - 0.4].flatMap((rr) => ring(sector(i, f), rr)));
    if (bench) place('flower_bed', 0.9, [local(bench, 1.75, -0.1), local(bench, -1.75, -0.1), local(bench, 0, -1.4)], [bench]);
  }
  // a pair of beds framing each road mouth, just inside the curb (both or none, for symmetry)
  const mouth = Math.asin((ROAD_HALF + 1.4) / (plaza.r - 1.3)) + 0.05;
  for (const a of roadAngles) {
    for (let k = 0; k < 4; k++) {
      const pair = [-1, 1].map((side): Structure => {
        const [x, z] = spot(a + side * (mouth + k * 0.06), plaza.r - 1.3);
        return { type: 'flower_bed', x, z, rot: 0 };
      });
      if (!pair.every((s) => fits(s, 0.9))) continue;
      structures.push(...pair);
      plazaProps.push(...pair);
      break;
    }
  }
  // lamps at the three road entrances
  for (const a of roadAngles) {
    for (const side of [-1, 1]) {
      const x = Math.cos(a) * (plaza.r + 1.2) + Math.cos(a + Math.PI / 2) * side * (ROAD_HALF + 0.7);
      const z = Math.sin(a) * (plaza.r + 1.2) + Math.sin(a + Math.PI / 2) * side * (ROAD_HALF + 0.7);
      if (side === 1) structures.push({ type: 'lamp', x, z, rot: 0 });
    }
  }
  // fences along the roads just outside the village
  for (const road of roads) {
    for (let i = 4; i < 9 && i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const dir = Math.atan2(bx - ax, bz - az);
      for (const side of [-1, 1]) {
        if ((i + (side > 0 ? 1 : 0)) % 3 === 0) continue; // gaps
        const ox = Math.cos(dir) * side * (ROAD_HALF + 0.6);
        const oz = -Math.sin(dir) * side * (ROAD_HALF + 0.6);
        structures.push({ type: 'fence', x: (ax + bx) / 2 + ox, z: (az + bz) / 2 + oz, rot: dir + Math.PI / 2 });
      }
    }
  }

  // colliders of structures
  const colliders: Collider[] = structures.map((s) => {
    const def = STRUCTURES[s.type];
    return def.round
      ? { kind: 'circle', x: s.x, z: s.z, r: def.w / 2 }
      : { kind: 'box', x: s.x, z: s.z, hw: def.w / 2, hd: def.d / 2, rot: s.rot };
  });
  // water: a ring of circles along the shore keeps walkers on the bank
  for (const p of ponds) {
    colliders.push({ kind: 'circle', x: p.x, z: p.z, r: p.r * 0.7 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let rr = p.r;
      while (rr > 0.5 && pondDistTo(p, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr) > -0.4) rr -= 0.1;
      colliders.push({ kind: 'circle', x: p.x + Math.cos(a) * (rr - 0.6), z: p.z + Math.sin(a) * (rr - 0.6), r: 1.0 });
    }
  }

  const blocked = (x: number, z: number, r: number) => {
    if (Math.hypot(x - plaza.x, z - plaza.z) < plaza.r + 1 + r) return true;
    if (pondDist(x, z) < 1.2 + r) return true;
    if (roadDist(x, z) < ROAD_HALF + 0.2 + r) return true;
    for (const s of structures) {
      const def = STRUCTURES[s.type];
      if (Math.hypot(x - s.x, z - s.z) < Math.max(def.w, def.d) / 2 + 1.5 + r) return true;
    }
    return false;
  };

  const nature = placeNature({
    seed,
    bounds: { minX: -half + 1, maxX: half - 1, minZ: -half + 1, maxZ: half - 1 },
    frames: (natureAtlas as { frames: Record<string, NatureFrameInfo> }).frames,
    height,
    blocked: (x, z, r) => blocked(x, z, r) || (Math.hypot(x, z) < VILLAGE_RADIUS * 0.75 && r > 1.5),
  });
  colliders.push(...nature.colliders.map((c) => ({ kind: 'circle' as const, ...c })));
  // reeds and a few stones on the banks
  const reedRng = new Rng(hashSeed(seed, 'reeds'));
  for (const p of ponds) {
    for (let k = 0; k < 26; k++) {
      const a = reedRng.range(0, Math.PI * 2);
      let rr = p.r * 1.5;
      while (rr > 0.5 && pondDistTo(p, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr) > 0.15) rr -= 0.1;
      const x = p.x + Math.cos(a) * (rr + reedRng.range(0, 0.9));
      const z = p.z + Math.sin(a) * (rr + reedRng.range(0, 0.9));
      const frame = reedRng.chance(0.82) ? (reedRng.chance(0.5) ? 'tall_grass_1' : 'tall_grass_2') : 'rock_s1';
      nature.placements.push({ frame, x, y: height(x, z), z, scale: reedRng.range(0.85, 1.2), flip: reedRng.chance(0.5), tint: [1, 1, 1] });
    }
  }

  // flower beds: a flowering shrub toward the back, a carpet of blooms and a few tufts in front
  // (the camera looks from +X+Z)
  const beds = structures.filter((s) => s.type === 'flower_bed');
  const bedRng = new Rng(hashSeed(seed, 'beds'));
  for (const b of beds) {
    const plant = (frame: string, a: number, r: number, scale: number) => {
      const x = b.x + Math.cos(a) * r;
      const z = b.z + Math.sin(a) * r;
      // never mirrored: Billboards mirrors with a negative scale, which culls the quad
      nature.placements.push({ frame, x, y: height(x, z), z, scale, flip: false, tint: [1, 1, 1] });
    };
    const front = Math.PI / 4;
    const [carpet, size] = bedRng.pick([['decal_flowers_5', 0.8], ['decal_flowers_6', 0.68], ['decal_flowers_4', 1.0], ['decal_flowers_2', 0.62]] as const);
    plant(carpet, 0, 0, size);
    // no shrub in a bed between the camera and a bench: it would hide the seat
    const hidesBench = structures.some((o) => o.type === 'bench' && Math.hypot(o.x - b.x, o.z - b.z) < 2.2 && b.x - o.x + (b.z - o.z) > 0.8);
    if (hidesBench) for (const k of [-1, 1]) plant(bedRng.pick(['tall_flowers_l', 'tall_flowers_y']), front + Math.PI + k * 0.7, 0.3, bedRng.range(0.9, 1.05));
    else plant(bedRng.chance(0.5) ? 'bush_2' : 'bush_3', front + Math.PI, 0.18, bedRng.range(0.78, 0.86));
    for (let k = 0; k < 3; k++) plant(bedRng.pick(['grass_flower_y', 'grass_flower_w', 'grass_flower_l']), front + (k - 1) * 0.8, 0.55, bedRng.range(0.9, 1.1));
  }

  // wolf dens deep in the woods, away from the village
  const dens: Den[] = [];
  for (let i = 0; i < 400 && dens.length < 5; i++) {
    const x = rng.range(-half + 12, half - 12);
    const z = rng.range(-half + 12, half - 12);
    if (Math.hypot(x, z) < WOLF_MIN_VILLAGE_DIST + 6) continue;
    if (forest.fbm(x, z, 34, 3) < 0.5) continue;
    if (dens.some((d) => Math.hypot(d.x - x, d.z - z) < 38)) continue;
    if (roadDist(x, z) < 6) continue;
    dens.push({ x, z, r: 7 });
  }

  const splatNoise = new ValueNoise(hashSeed(seed, 'splat'));
  const splat = (x: number, z: number): [number, number, number, number] => {
    const r = splatNoise.fbm(x + 100, z, 9, 3);
    const road = Math.max(0, Math.min(1, 1.2 - roadDist(x, z) / (ROAD_HALF + 0.6)));
    const pd = Math.hypot(x - plaza.x, z - plaza.z);
    let cob = Math.max(0, Math.min(1, (plaza.r - pd) / 1.5 + 0.5));
    // flower beds: grass in a gap of the paving, ringed by the same curb as the plaza's edge
    if (pd < plaza.r) for (const b of beds) cob = Math.min(cob, Math.max(0, 0.31 + (Math.hypot(x - b.x, z - b.z) - BED_RADIUS) * 0.6));
    const bank = Math.max(0, Math.min(1, (1.1 - pondDist(x, z)) / 0.8)); // muddy shore along the water edge
    return [r, Math.max(pd > plaza.r - 0.5 ? road : 0, bank), cob, nature.shade(x, z)];
  };

  return { seed, size, half, plaza, roads, structures, nature, colliders, dens, ponds, pondDist, spawn, height, splat };
}
