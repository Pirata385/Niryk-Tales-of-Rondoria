import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAppearance } from '../src/shared/appearance';
import { PLAYER_HP, RESPAWN_DELAY, TICK_DT, WOLF } from '../src/shared/constants';
import type { ServerMsg } from '../src/shared/protocol';
import { GAME_WORLD, STRUCTURES, VILLAGE_WORLD, footprint, generateWorld, type WorldData } from '../src/shared/world/worldgen';
import { worldForSeed } from '../src/shared/world/worldCache';
import { GameServer } from '../src/server/GameServer';

let world: WorldData;
beforeAll(() => {
  world = generateWorld(1, GAME_WORLD);
});

function ticks(server: GameServer, seconds: number) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) server.tick();
}

describe('the game world', () => {
  it('is the village with wolf dens, for the server and the client cache alike', () => {
    expect(GAME_WORLD).toBe(VILLAGE_WORLD);
    expect(worldForSeed(1).options).toBe(GAME_WORLD);
    const server = new GameServer(1, () => {});
    expect(server.world.options).toBe(GAME_WORLD);
    expect(server.world.dens.length).toBeGreaterThanOrEqual(3);
    expect(server.wolfCount).toBe(Math.min(WOLF.maxAlive, server.world.dens.length * 3));
    // the spawn is on the plaza
    expect(Math.hypot(world.spawn.x - world.plaza!.x, world.spawn.z - world.plaza!.z)).toBeLessThan(world.plaza!.r);
  });

  it('gives every standing structure a camera blocker of its footprint and height', () => {
    for (const s of world.structures) {
      const def = STRUCTURES[s.type];
      expect(def.h).toBeGreaterThan(0);
      const o = world.obstacles.find((b) => b.x === s.x && b.z === s.z);
      if (def.painted) {
        expect(o).toBeUndefined();
        continue;
      }
      expect(o).toBeDefined();
      expect(o!.top).toBeCloseTo(world.height(s.x, s.z) + def.h, 6);
      if (def.round) expect(o!.r).toBeCloseTo(def.w / 2, 6);
      else {
        expect(o!.box).toEqual({ hw: def.w / 2, hd: def.d / 2, rot: s.rot });
        // the bounding radius covers the box's corners
        for (const [x, z] of footprint(s)) expect(Math.hypot(x - s.x, z - s.z)).toBeLessThanOrEqual(o!.r + 1e-9);
      }
    }
    // houses stand taller than a person and the camera's pivot
    for (const t of ['house_a', 'house_b', 'house_c']) expect(STRUCTURES[t].h).toBeGreaterThan(4);
  });
});

describe('death and respawn', () => {
  it('a fallen player stays down, cannot move or swing, and comes back whole at the plaza', () => {
    const inbox: ServerMsg[] = [];
    const server = new GameServer(1, (_c, m) => inbox.push(m), world);
    server.receive('c1', { t: 'join', appearance: { ...defaultAppearance('human', 'f'), name: 'Teste' } });
    const p = server.debugPlayer('c1')!;
    server.debugTeleport('c1', world.spawn.x + 2, world.spawn.z);
    server.debugKill('c1');
    server.tick();
    expect(p.dead).toBe(true);
    expect(p.hp).toBe(0);
    expect(p.anim).toBe('Death');
    const snap = inbox.filter((m) => m.t === 'snapshot').at(-1);
    expect(snap?.t === 'snapshot' && snap.events.some((e) => e.e === 'death' && e.id === p.id)).toBe(true);
    const x0 = p.x;
    server.receive('c1', { t: 'input', seq: 1, mx: 1, mz: 0, run: true, attack: true, aim: 0 });
    ticks(server, 0.5);
    expect(p.x).toBe(x0);
    expect(p.swing).toBeNull();
    // too early: the respawn button is ignored
    server.receive('c1', { t: 'respawn' });
    expect(p.dead).toBe(true);
    ticks(server, RESPAWN_DELAY);
    server.receive('c1', { t: 'respawn' });
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(PLAYER_HP);
    expect(Math.hypot(p.x - world.spawn.x, p.z - world.spawn.z)).toBeLessThan(1e-6);
  });

  it('wolves chasing a player who falls give up and go home', () => {
    const server = new GameServer(1, () => {}, world);
    server.receive('c1', { t: 'join', appearance: { ...defaultAppearance('human', 'm'), name: 'Teste' } });
    const p = server.debugPlayer('c1')!;
    const den = world.dens[0];
    p.x = den.x + 3;
    p.z = den.z;
    ticks(server, 1.5);
    const chasing = server.debugWolves().filter((w) => w.target === p.id);
    expect(chasing.length).toBeGreaterThan(0);
    server.debugKill('c1');
    server.tick();
    for (const w of chasing) expect(['return', 'idle', 'wander', 'dead']).toContain(w.state);
  });
});
