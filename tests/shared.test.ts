import { describe, expect, it } from 'vitest';
import { ValueNoise } from '../src/shared/math/noise';
import { Rng, hashSeed } from '../src/shared/math/random';
import { DiscGrid } from '../src/shared/world/scatter';
import { placeNature } from '../src/shared/world/nature';

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
  const frames = {
    oak_round_1: { kind: 'tree', radius: 2.5, collider: 0.35 },
    oak_hero_1: { kind: 'tree', radius: 3.8, collider: 0.6 },
    pine_1: { kind: 'tree', radius: 1.6, collider: 0.3 },
    bush_1: { kind: 'bush', radius: 0.9, collider: 0.5 },
    rock_m1: { kind: 'rock', radius: 0.55, collider: 0.45 },
    grass_1: { kind: 'grass' },
    decal_flowers_1: { kind: 'decal' },
  };
  const params = {
    seed: 9,
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    frames,
    height: () => 0,
    blocked: (x: number, z: number, r: number) => Math.hypot(x, z) < 10 + r,
  };

  it('is deterministic and respects blocked areas and tree spacing', () => {
    const a = placeNature(params);
    const b = placeNature(params);
    expect(a.placements).toEqual(b.placements);
    expect(a.placements.length).toBeGreaterThan(50);
    for (const p of a.placements) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(9.9);
    const trees = a.placements.filter((p) => frames[p.frame as keyof typeof frames]?.kind === 'tree');
    expect(trees.length).toBeGreaterThan(5);
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z);
        expect(d).toBeGreaterThan(1.2);
      }
    }
  });
});

describe('ponds', () => {
  it('sit in open meadows away from the village, sunk below the bank, and block walking', async () => {
    const { generateWorld } = await import('../src/shared/world/worldgen');
    const { CollisionWorld } = await import('../src/shared/world/collision');
    const w = generateWorld(1);
    expect(w.ponds.length).toBeGreaterThan(0);
    const col = new CollisionWorld(w.colliders, w.half);
    for (const p of w.ponds) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(40);
      expect(w.pondDist(p.x, p.z)).toBeLessThan(0);
      expect(w.height(p.x, p.z)).toBeLessThan(p.level); // the water surface covers the bottom
      expect(w.height(p.x + p.r + 3, p.z)).toBeGreaterThan(p.level); // the bank stays dry
      expect(col.blocked(p.x, p.z, 0.3)).toBe(true);
    }
    expect(col.blocked(w.spawn.x, w.spawn.z, 0.3)).toBe(false);
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
