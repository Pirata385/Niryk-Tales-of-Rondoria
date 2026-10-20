import type { ValueNoise } from '../math/noise';
import type { Rng } from '../math/random';

/**
 * The starter village of prototype 1 (cobbled plaza with a well, houses facing it, a market
 * corner, benches, lamps, fences and three roads). Prototype 2's style slice is a forest clearing
 * without it (`WorldOptions.village` off); the layout code stays so the village returns with the
 * new 3D houses. Models: assets/models/<type>.glb, front faces +Z; collider footprint in meters.
 * `painted` ones have no model: a flower bed is planted with nature assets.
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

export const ROAD_HALF = 1.5;

export interface Structure {
  type: string;
  x: number;
  z: number;
  /** Rotation around Y (radians). */
  rot: number;
}

export type Pt = [number, number];

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function distToPolyline(px: number, pz: number, line: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distToSegment(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}

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

export interface VillageLayout {
  plaza: { x: number; z: number; r: number };
  roads: Pt[][];
  structures: Structure[];
  spawn: { x: number; z: number };
}

/**
 * Prototype 1's village around a plaza at the origin: roads from the plaza to the world border,
 * houses facing the plaza, a furnished plaza that keeps the lanes people walk clear, lamps and
 * fences. Deterministic for the rng/noise it is given.
 */
export function layoutVillage(rng: Rng, relief: ValueNoise, half: number): VillageLayout {
  const plaza = { x: 0, z: 0, r: 8.5 };
  const roadAngles = [-1.65, 0.35, 2.45].map((a) => a + rng.range(-0.15, 0.15));
  const roads: Pt[][] = roadAngles.map((a) => {
    const pts: Pt[] = [];
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

  // the plaza: a market corner, two benches facing the well with a flower bed at one end, beds
  // flanking the road mouths; all of it off the road mouths, a ring around the well and the spawn
  const spawn = { x: plaza.x, z: plaza.z + plaza.r - 3 };
  const lanes: [Pt, Pt, number][] = roads.map((r): [Pt, Pt, number] => [[plaza.x, plaza.z], r[0], ROAD_HALF]);
  lanes.push([[spawn.x, spawn.z], [spawn.x - 6, spawn.z - 6], 1.5]);
  const plazaProps: Structure[] = [];
  const fits = (s: Structure, gap: number, group: Structure[] = []) => {
    const fp = footprint(s);
    if (fp.some(([x, z]) => Math.hypot(x - plaza.x, z - plaza.z) > plaza.r - 0.4)) return false;
    if (outlineGap(fp, footprint(well)) < 1.5 || Math.hypot(s.x - spawn.x, s.z - spawn.z) < 2.6) return false;
    if (lanes.some(([a, b, h]) => outlineGap(fp, [a, b]) < h)) return false;
    if (roads.some((r) => r.slice(0, 3).some((p, i) => i > 0 && outlineGap(fp, [r[i - 1], p]) < ROAD_HALF + 0.3))) return false;
    return plazaProps.every((o) => outlineGap(fp, footprint(o)) >= (group.includes(o) ? 0.25 : gap));
  };
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
  const spot = (a: number, r: number, turn = 0): [number, number, number] => {
    const x = plaza.x + Math.cos(a) * r;
    const z = plaza.z + Math.sin(a) * r;
    return [x, z, facing(x, z) + turn];
  };
  const ring = (ang: number, r: number, turn = 0) => Array.from({ length: 31 }, (_, k) => spot(ang + Math.ceil(k / 2) * 0.06 * (k % 2 ? 1 : -1), r, turn));
  const local = (base: Structure, lx: number, lz: number, turn = 0): [number, number, number] => {
    const c = Math.cos(base.rot);
    const n = Math.sin(base.rot);
    return [base.x + lx * c + lz * n, base.z - lx * n + lz * c, base.rot + turn];
  };
  const sector = (i: number, f: number) => {
    const span = (((roadAngles[(i + 1) % 3] - roadAngles[i]) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return roadAngles[i] + span * f;
  };
  const stall = place('stall', 0.9, [4.8, 5.2, 4.5].flatMap((r) => ring(sector(0, 0.42), r, 0.6)));
  if (stall) {
    const market = [stall];
    const crates = place('crates', 0.9, [local(stall, 2.75, -0.35, 0.25), local(stall, -2.75, -0.35, -0.25), local(stall, 0.4, -1.8, 0.15)], market);
    if (crates) market.push(crates);
    place('barrels', 0.9, [local(stall, 2.6, 1.7, 0.85), local(stall, -2.6, 1.7, -0.85), local(stall, -0.6, -1.8, -0.2)], market);
  }
  for (const [i, f, r] of [[2, 0.64, 5.6], [1, 0.3, 4.0]]) {
    const bench = place('bench', 0.9, [r, r + 0.4, r - 0.4].flatMap((rr) => ring(sector(i, f), rr)));
    if (bench) place('flower_bed', 0.9, [local(bench, 1.75, -0.1), local(bench, -1.75, -0.1), local(bench, 0, -1.4)], [bench]);
  }
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
  for (const a of roadAngles) {
    const x = Math.cos(a) * (plaza.r + 1.2) + Math.cos(a + Math.PI / 2) * (ROAD_HALF + 0.7);
    const z = Math.sin(a) * (plaza.r + 1.2) + Math.sin(a + Math.PI / 2) * (ROAD_HALF + 0.7);
    structures.push({ type: 'lamp', x, z, rot: 0 });
  }
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
  return { plaza, roads, structures, spawn };
}
