import { describe, expect, it } from 'vitest';
import { ValueNoise } from '../src/shared/math/noise';
import { Rng, hashSeed } from '../src/shared/math/random';
import { DiscGrid } from '../src/shared/world/scatter';
import { PLAYER_RADIUS } from '../src/shared/constants';
import { CollisionWorld } from '../src/shared/world/collision';
import { placeNature, solidsOf } from '../src/shared/world/nature';
import { NATURE } from '../src/shared/world/natureCatalog';
import { CLEARING_WORLD, generateWorld } from '../src/shared/world/worldgen';

describe('Rng', () => {
  it('is deterministic for a seed and stays in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('derives different sub-seeds from labels', () => {
    expect(hashSeed(7, 'trees')).not.toBe(hashSeed(7, 'wolves'));
    expect(hashSeed(7, 'trees')).toBe(hashSeed(7, 'trees'));
  });
});

describe('ValueNoise', () => {
  it('is deterministic, smooth and within [0, 1]', () => {
    const n = new ValueNoise(3);
    const m = new ValueNoise(3);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const v = n.fbm(x, -x * 0.5, 10);
      expect(v).toBe(m.fbm(x, -x * 0.5, 10));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(n.get(x, 1) - n.get(x + 0.001, 1))).toBeLessThan(0.01);
    }
  });
});

describe('DiscGrid', () => {
  it('rejects overlapping discs with the spacing factor', () => {
    const g = new DiscGrid(4);
    g.add({ x: 0, z: 0, r: 2 });
    expect(g.free(3, 0, 1, 1)).toBe(true);
    expect(g.free(2.5, 0, 1, 1)).toBe(false);
    expect(g.free(2.5, 0, 1, 0.75)).toBe(true);
  });
});

describe('placeNature', () => {
  const params = {
    seed: 9,
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    height: () => 0,
    forest: (x: number, z: number) => (Math.hypot(x, z) > 20 ? 0.8 : 0),
    blocked: (x: number, z: number, r: number) => Math.hypot(x, z) < 10 + r,
  };

  it('is deterministic and respects blocked areas, open ground and tree spacing', () => {
    const a = placeNature(params);
    const b = placeNature(params);
    expect(a.placements).toEqual(b.placements);
    expect(a.placements.length).toBeGreaterThan(50);
    for (const p of a.placements) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(9.9);
    const trees = a.placements.filter((p) => NATURE[p.asset]?.kind === 'tree');
    expect(trees.length).toBeGreaterThan(20);
    for (const t of trees) expect(Math.hypot(t.x, t.z)).toBeGreaterThan(19.9); // only where it is wooded
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z);
        expect(d).toBeGreaterThan(1.5);
      }
    }
    // every trunk and rock is solid, a fallen log is a row of discs
    expect(a.colliders.length).toBeGreaterThanOrEqual(trees.length);
    const log = a.placements.find((p) => NATURE[p.asset]?.capsule);
    if (log) expect(solidsOf(log).length).toBeGreaterThan(2);
  });
});

describe('the clearing', () => {
  it('opens a meadow with a pond around a free spawn, inside a ring of woods', () => {
    const w = generateWorld(1);
    expect(w.options).toBe(CLEARING_WORLD);
    expect(w.structures).toEqual([]);
    expect(w.dens).toEqual([]);
    const col = new CollisionWorld(w.colliders, w.half);
    expect(col.blocked(w.spawn.x, w.spawn.z, PLAYER_RADIUS + 0.5)).toBe(false);
    // the first steps forward from the spawn are free
    for (let t = 0; t <= 6; t += 0.25) {
      expect(col.blocked(w.spawn.x + Math.sin(w.spawn.yaw) * t, w.spawn.z + Math.cos(w.spawn.yaw) * t, PLAYER_RADIUS)).toBe(false);
    }
    expect(w.ponds).toHaveLength(1);
    for (const p of w.ponds) {
      expect(w.pondDist(p.x, p.z)).toBeLessThan(0);
      expect(w.height(p.x, p.z)).toBeLessThan(p.level); // the water surface covers the bottom
      expect(col.blocked(p.x, p.z, 0.3)).toBe(true);
    }
    const trees = w.nature.filter((p) => NATURE[p.asset].kind === 'tree');
    const near = trees.filter((t) => Math.hypot(t.x - w.clearing.x, t.z - w.clearing.z) < w.clearing.r * 0.6);
    expect(near.length).toBeLessThanOrEqual(1); // the landmark oak at most
    expect(trees.filter((t) => Math.hypot(t.x, t.z) < 60).length).toBeGreaterThan(80);
    // gentle: the clearing is nearly flat, the hills stay walkable
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const h0 = w.height(Math.cos(a) * 5, Math.sin(a) * 5);
      expect(Math.abs(h0 - w.height(0, 0))).toBeLessThan(1);
    }
    expect(w.grass(w.spawn.x + 1, w.spawn.z + 1)).toBeGreaterThan(0.3);
    expect(generateWorld(1).nature).toEqual(w.nature);
  });
});

describe('tunic color', () => {
  it('steps away from green plumes and migrates old saves', async () => {
    const { tunicFor, migrateAppearance, validateAppearance, CLOTH_COLORS, HARPIN_COLORS } = await import('../src/shared/appearance');
    expect(tunicFor([HARPIN_COLORS.verde], CLOTH_COLORS[0])).not.toBe(CLOTH_COLORS[0]);
    expect(tunicFor([HARPIN_COLORS.branco], CLOTH_COLORS[0])).toBe(CLOTH_COLORS[0]);
    const old = { name: 'Sylwe', race: 'harpin', gender: 'f', skin: '#f3d2b8', hairStyle: 'plumado', hairColor: HARPIN_COLORS.verde, plumeColor: HARPIN_COLORS.verde, eyeColor: '#8a7a3a' } as const;
    const a = migrateAppearance(old);
    expect(validateAppearance(a)).toEqual([]);
    expect(a.clothColor).not.toBe(CLOTH_COLORS[0]);
  });
});

describe('village square', () => {
  it('(village option) is furnished without overlaps, keeping the roads, the well, the doors and the first steps clear', async () => {
    const { footprint, outlineGap, STRUCTURES, VILLAGE_WORLD } = await import('../src/shared/world/worldgen');
    for (const seed of [1, 2, 7, 19]) {
      const w = generateWorld(seed, VILLAGE_WORLD);
      const plaza = w.plaza!;
      const col = new CollisionWorld(w.colliders, w.half);
      const inPlaza = w.structures.filter((s) => Math.hypot(s.x - plaza.x, s.z - plaza.z) < plaza.r);
      const count = (type: string) => inPlaza.filter((s) => s.type === type).length;
      expect([count('well'), count('stall'), count('crates'), count('barrels'), count('bench')]).toEqual([1, 1, 1, 1, 2]);
      expect(count('flower_bed')).toBeGreaterThan(0);

      // no two structures of the village overlap, and each one blocks walking where it stands
      for (let i = 0; i < w.structures.length; i++) {
        const a = w.structures[i];
        expect(col.blocked(a.x, a.z, 0.05)).toBe(true);
        for (let j = i + 1; j < w.structures.length; j++) expect(outlineGap(footprint(a), footprint(w.structures[j]))).toBeGreaterThan(0.2);
      }
      // plaza props stay inside the paving and off the roads
      for (const s of inPlaza) {
        for (const [x, z] of footprint(s)) expect(Math.hypot(x - plaza.x, z - plaza.z)).toBeLessThan(plaza.r);
        for (const road of w.roads) {
          for (let i = 1; i < road.length; i++) expect(outlineGap(footprint(s), [road[i - 1], road[i]])).toBeGreaterThan(1.5);
        }
      }
      // a path all around the well, and a new player's first 8 m (screen-up is world -X-Z)
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        expect(col.blocked(plaza.x + Math.cos(a) * 2.2, plaza.z + Math.sin(a) * 2.2, PLAYER_RADIUS)).toBe(false);
      }
      for (let t = 0; t <= 8; t += 0.25) expect(col.blocked(w.spawn.x - t * Math.SQRT1_2, w.spawn.z - t * Math.SQRT1_2, PLAYER_RADIUS + 0.4)).toBe(false);
      // the house doors (front, facing the plaza) open onto free ground
      for (const h of w.structures.filter((s) => s.type.startsWith('house'))) {
        const out = STRUCTURES[h.type].d / 2 + 1;
        expect(col.blocked(h.x + Math.sin(h.rot) * out, h.z + Math.cos(h.rot) * out, PLAYER_RADIUS + 0.3)).toBe(false);
      }
    }
  });
});
