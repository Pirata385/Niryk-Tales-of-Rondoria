import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAppearance, validateAppearance, HARPIN_COLORS } from '../src/shared/appearance';
import { ATTACKS, BACKPEDAL_FACTOR, PLAYER_HP, RUN_SPEED, TICK_DT, WALK_SPEED, WOLF } from '../src/shared/constants';
import type { ServerMsg } from '../src/shared/protocol';
import { VILLAGE_WORLD, generateWorld, type WorldData } from '../src/shared/world/worldgen';
import { GameServer } from '../src/server/GameServer';

let world: WorldData;
beforeAll(() => {
  // prototype 1's world (village and wolves): keeps those code paths tested while the clearing has neither
  world = generateWorld(1, VILLAGE_WORLD);
});

function makeServer() {
  const inbox: ServerMsg[] = [];
  const server = new GameServer(1, (_c, m) => inbox.push(m), world);
  const app = { ...defaultAppearance('human', 'm'), name: 'Teste' };
  server.receive('c1', { t: 'join', appearance: app });
  return { server, inbox };
}

function ticks(server: GameServer, seconds: number) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) server.tick();
}

describe('appearance validation', () => {
  it('accepts the defaults with a name and restricts harpin colors', () => {
    expect(validateAppearance({ ...defaultAppearance('human', 'f'), name: 'Ana' })).toEqual([]);
    const h = { ...defaultAppearance('harpin', 'm'), name: 'Argnardo' };
    expect(validateAppearance(h)).toEqual([]);
    expect(validateAppearance({ ...h, hairColor: '#ff00ff' })).toContain('hairColor');
    expect(validateAppearance({ ...h, plumeColor: HARPIN_COLORS.azul })).toEqual([]);
    expect(validateAppearance({ ...h, hairStyle: 'curto' })).toContain('hairStyle');
    expect(validateAppearance({ ...h, clothColor: '#00ff00' })).toContain('clothColor');
    expect(validateAppearance({ ...h, name: 'x' })).toContain('name');
  });
});

describe('world generation', () => {
  it('is deterministic and builds a village with dens away from it', () => {
    const again = generateWorld(1, VILLAGE_WORLD);
    expect(again.structures).toEqual(world.structures);
    expect(world.structures.filter((s) => s.type.startsWith('house')).length).toBe(6);
    expect(world.dens.length).toBeGreaterThanOrEqual(3);
    for (const d of world.dens) expect(Math.hypot(d.x, d.z)).toBeGreaterThan(40);
  });
});

describe('GameServer', () => {
  it('rejects an invalid appearance', () => {
    const inbox: ServerMsg[] = [];
    const s = new GameServer(1, (_c, m) => inbox.push(m), world);
    s.receive('x', { t: 'join', appearance: { ...defaultAppearance(), name: '' } });
    expect(inbox[0]).toMatchObject({ t: 'error' });
  });

  it('moves a player at walk speed and acknowledges inputs', () => {
    const { server, inbox } = makeServer();
    const p = server.debugPlayer('c1')!;
    const x0 = p.x;
    server.receive('c1', { t: 'input', seq: 1, mx: 1, mz: 0, run: false, attack: false, aim: null });
    ticks(server, 1);
    expect(p.x - x0).toBeGreaterThan(WALK_SPEED * 0.8);
    expect(p.anim).toBe('Walk');
    const snap = inbox.filter((m) => m.t === 'snapshot').at(-1);
    expect(snap && snap.t === 'snapshot' && snap.ack).toBe(1);
  });

  it('chains Attack1 into Attack2 when pressed in the window', () => {
    const { server } = makeServer();
    const p = server.debugPlayer('c1')!;
    server.receive('c1', { t: 'input', seq: 1, mx: 0, mz: 0, run: false, attack: true, aim: 0 });
    server.tick(); // inputs are queued and simulated one per tick
    expect(p.anim).toBe('Attack1');
    ticks(server, ATTACKS.Attack1.chainFrom + 0.05);
    server.receive('c1', { t: 'input', seq: 2, mx: 0, mz: 0, run: false, attack: true, aim: 0 });
    ticks(server, ATTACKS.Attack1.duration);
    expect(p.anim).toBe('Attack2');
  });

  it('wolves aggro, bite (armor reduces damage) and die to the sword', () => {
    const { server } = makeServer();
    const p = server.debugPlayer('c1')!;
    const den = world.dens[0];
    const wolf = server.debugWolves().find((w) => w.den === den)!;
    // teleport the player next to the wolf
    p.x = wolf.x + 1.2;
    p.z = wolf.z;
    ticks(server, 2.5);
    expect(p.hp).toBeLessThan(PLAYER_HP);
    const hpWithoutArmor = PLAYER_HP - p.hp;
    expect(hpWithoutArmor).toBeGreaterThanOrEqual(WOLF.damage[0]);

    // kill it: swing until dead
    let seq = 10;
    for (let i = 0; i < 40 && wolf.state !== 'dead'; i++) {
      p.hp = PLAYER_HP;
      p.x = wolf.x;
      p.z = wolf.z - 1.0;
      server.receive('c1', { t: 'input', seq: seq++, mx: 0, mz: 0, run: false, attack: true, aim: 0 });
      ticks(server, 0.6);
    }
    expect(wolf.state).toBe('dead');
  });

  it('equips armor from the inventory and returns the old item', () => {
    const { server } = makeServer();
    const p = server.debugPlayer('c1')!;
    expect(p.items).toContain('armor_guard');
    server.receive('c1', { t: 'equip', slot: 'armor', item: 'armor_guard' });
    expect(p.equipment.armor).toBe('armor_guard');
    expect(p.items).not.toContain('armor_guard');
    server.receive('c1', { t: 'equip', slot: 'armor', item: null });
    expect(p.items).toContain('armor_guard');
    server.receive('c1', { t: 'equip', slot: 'weapon', item: 'armor_guard' }); // wrong slot: ignored
    expect(p.equipment.weapon).toBe('sword_iron');
  });

  it('respawns a dead player at the plaza', () => {
    const { server } = makeServer();
    const p = server.debugPlayer('c1')!;
    p.x = 30;
    p.hp = 1;
    p.dead = true;
    p.respawnAt = server.time;
    server.receive('c1', { t: 'respawn' });
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(PLAYER_HP);
    expect(Math.hypot(p.x - world.spawn.x, p.z - world.spawn.z)).toBeLessThan(0.01);
  });
});

describe('over-the-shoulder movement (aim)', () => {
  /** A player alone in the clearing, facing the aim, after `seconds` of the same input. */
  function walk(fields: { mx: number; mz: number; run: boolean; aim: number | null }, seconds = 1) {
    const clearing = generateWorld(1);
    const server = new GameServer(1, () => {}, clearing);
    server.receive('c1', { t: 'join', appearance: { ...defaultAppearance('human', 'm'), name: 'Teste' } });
    const p = server.debugPlayer('c1')!;
    // face the aim first, standing still
    server.receive('c1', { t: 'input', seq: 1, mx: 0, mz: 0, run: false, attack: false, aim: fields.aim });
    ticks(server, 0.5);
    const x0 = p.x;
    const z0 = p.z;
    const n = Math.round(seconds / TICK_DT);
    for (let i = 0; i < n; i++) {
      server.receive('c1', { t: 'input', seq: 2 + i, attack: false, ...fields });
      server.tick();
    }
    return { p, speed: Math.hypot(p.x - x0, p.z - z0) / seconds };
  }

  it('turns the body to the aim even standing still', () => {
    const { p } = walk({ mx: 0, mz: 0, run: false, aim: 2.2 }, 0.3);
    expect(p.yaw).toBeCloseTo(2.2, 6);
  });

  it('strafes at walking pace, back-pedals slower and runs only forward', () => {
    const aim = 0.3; // facing (sin 0.3, cos 0.3)
    const fwd = [Math.sin(aim), Math.cos(aim)];
    const left = [Math.cos(aim), -Math.sin(aim)];
    const forward = walk({ mx: fwd[0], mz: fwd[1], run: false, aim });
    expect(forward.speed).toBeCloseTo(WALK_SPEED, 1);
    expect(forward.p.yaw).toBeCloseTo(aim, 6);
    const run = walk({ mx: fwd[0], mz: fwd[1], run: true, aim });
    expect(run.speed).toBeCloseTo(RUN_SPEED, 1);
    const strafe = walk({ mx: left[0], mz: left[1], run: true, aim });
    expect(strafe.speed).toBeCloseTo(WALK_SPEED, 1); // no running sideways
    expect(strafe.p.yaw).toBeCloseTo(aim, 6); // still facing the aim
    const back = walk({ mx: -fwd[0], mz: -fwd[1], run: true, aim });
    expect(back.speed).toBeCloseTo(WALK_SPEED * BACKPEDAL_FACTOR, 1);
    expect(back.p.yaw).toBeCloseTo(aim, 6);
    expect(back.p.anim).toBe('Walk');
  });

  it('swings toward the aim', () => {
    const clearing = generateWorld(1);
    const server = new GameServer(1, () => {}, clearing);
    server.receive('c1', { t: 'join', appearance: { ...defaultAppearance('human', 'm'), name: 'Teste' } });
    const p = server.debugPlayer('c1')!;
    server.receive('c1', { t: 'input', seq: 1, mx: 0, mz: 0, run: false, attack: true, aim: -1.2 });
    server.tick();
    expect(p.anim).toBe('Attack1');
    expect(p.yaw).toBeCloseTo(-1.2, 6);
  });
});
