import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAppearance, type Appearance } from '../src/shared/appearance';
import {
  EQUIP_BURST, EQUIP_RATE, INPUT_QUEUE_MAX, INTEREST_RADIUS, INTEREST_SLACK, PLAYER_RADIUS, TICK_DT, WALK_SPEED, WOLF,
} from '../src/shared/constants';
import { sanitizeInput, type PlayerInput } from '../src/shared/movement';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { CollisionWorld } from '../src/shared/world/collision';
import { worldForSeed } from '../src/shared/world/worldCache';
import type { WorldData } from '../src/shared/world/worldgen';
import { GameServer } from '../src/server/GameServer';
import { GameClient, type Intent } from '../src/client/game/GameClient';
import { LocalTransport } from '../src/client/net/LocalTransport';
import type { Transport } from '../src/client/net/Transport';

type Snapshot = Extract<ServerMsg, { t: 'snapshot' }>;

let world: WorldData;
beforeAll(() => {
  world = worldForSeed(1);
});

const APPEARANCE: Appearance = { ...defaultAppearance('human', 'm'), name: 'Teste' };

/** A server with players that joined at the spawn; messages are cloned like a network would. */
function setup(...clients: string[]) {
  const inbox = new Map<string, ServerMsg[]>(clients.map((c) => [c, []]));
  const server = new GameServer(1, (c, m) => inbox.get(c)?.push(structuredClone(m)), world);
  for (const c of clients) server.receive(c, { t: 'join', appearance: APPEARANCE });
  const snaps = (c: string) => inbox.get(c)!.filter((m): m is Snapshot => m.t === 'snapshot');
  const last = (c: string) => snaps(c).at(-1)!;
  const player = (c: string) => server.debugPlayer(c)!;
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) server.tick();
  };
  return { server, inbox, snaps, last, player, ticks };
}

function input(seq: number, fields: Partial<Omit<Extract<ClientMsg, { t: 'input' }>, 't' | 'seq'>> = {}): ClientMsg {
  return { t: 'input', seq, mx: 0, mz: 0, run: false, attack: false, aim: null, ...fields };
}

const blank = (): PlayerInput => ({ mx: 0, mz: 0, run: false, attack: false, aim: null });

describe('input queue', () => {
  it('simulates inputs that arrive together one per tick, in order, and acks the last simulated', () => {
    const { server, last, player, ticks } = setup('c1');
    const p = player('c1');
    const x0 = p.x;
    const z0 = p.z;
    server.receive('c1', input(1, { mx: 1 }));
    server.receive('c1', input(2, { mz: 1 }));
    server.receive('c1', input(3, { mx: -1 }));
    const step = WALK_SPEED * TICK_DT;

    ticks(1);
    expect(p.ack).toBe(1);
    expect(last('c1').ack).toBe(1);
    expect(p.x - x0).toBeCloseTo(step, 9);
    expect(p.z - z0).toBeCloseTo(0, 9);

    ticks(1);
    expect(last('c1').ack).toBe(2);
    expect(p.x - x0).toBeCloseTo(step, 9);
    expect(p.z - z0).toBeCloseTo(step, 9);

    ticks(1);
    expect(last('c1').ack).toBe(3);
    expect(p.x - x0).toBeCloseTo(0, 9);
  });

  it('repeats the last movement (without its attack) on a tick with no input, acking nothing new', () => {
    const { server, snaps, last, player, ticks } = setup('c1');
    const p = player('c1');
    server.receive('c1', input(1, { mx: 1 }));
    ticks(1);
    const x1 = p.x;
    ticks(1); // nothing arrived: keep walking
    expect(p.x - x1).toBeCloseTo(WALK_SPEED * TICK_DT, 9);
    expect(last('c1').ack).toBe(1);

    server.receive('c1', input(2, { attack: true, aim: 0 }));
    ticks(1);
    expect(p.anim).toBe('Attack1');
    // a repeated press would chain Attack2 in the combo window: the gap must not
    ticks(Math.round(0.8 / TICK_DT));
    expect(p.anim).toBe('Idle');
    const swings = snaps('c1').flatMap((s) => s.events).filter((e) => e.e === 'swing');
    expect(swings).toHaveLength(1);
    expect(last('c1').ack).toBe(2);
  });

  it('drops the oldest inputs beyond the queue cap', () => {
    const { server, last, ticks } = setup('c1');
    const burst = INPUT_QUEUE_MAX + 5;
    for (let seq = 1; seq <= burst; seq++) server.receive('c1', input(seq, { mx: 1 }));
    ticks(1);
    expect(last('c1').ack).toBe(burst - INPUT_QUEUE_MAX + 1);
    ticks(INPUT_QUEUE_MAX - 1);
    expect(last('c1').ack).toBe(burst);
    ticks(2);
    expect(last('c1').ack).toBe(burst);
  });
});

describe('input validation', () => {
  it('keeps non-finite and malformed values out of the state and clamps the movement', () => {
    const { server, last, player, ticks } = setup('c1');
    const p = player('c1');
    server.receive('c1', input(1, { mx: NaN, mz: Infinity, aim: NaN, attack: true }));
    expect(p.inputs[0]).toMatchObject({ mx: 0, mz: 0, aim: null, attack: true });
    server.receive('c1', { t: 'input', seq: 2, mx: '1', mz: -Infinity, run: 'yes', attack: 1, aim: 1e300 } as unknown as ClientMsg);
    expect(p.inputs[1]).toMatchObject({ mx: 0, mz: 0, run: false, attack: false });
    expect(Math.abs(p.inputs[1].aim!)).toBeLessThanOrEqual(Math.PI);
    server.receive('c1', input(3, { mx: 5, mz: -3, attack: true, aim: -1e12 }));
    const q = p.inputs[2];
    expect(q.mx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(q.mz).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(Math.abs(q.aim!)).toBeLessThanOrEqual(Math.PI);
    ticks(30);
    for (const v of [p.x, p.z, p.yaw]) expect(Number.isFinite(v)).toBe(true);
    const me = last('c1').entities.find((e) => e.id === p.id)!;
    for (const v of [me.x, me.z, me.yaw]) expect(Number.isFinite(v)).toBe(true);
  });

  it('reads an input the same on both sides, and reading it twice changes nothing', () => {
    const raws = [
      { mx: 0.6, mz: 0.8, run: true, attack: false, aim: null },
      { mx: 0.75, mz: 0.75, run: false, attack: true, aim: 3 },
      { mx: 3, mz: -1, run: false, attack: true, aim: 7 },
      { mx: -0.2, mz: NaN, run: 1, attack: 'x', aim: -Infinity },
      { mx: 1, mz: 1, aim: Math.PI },
      {},
    ];
    for (const raw of raws) {
      const once = sanitizeInput(raw, blank());
      expect(Math.hypot(once.mx, once.mz)).toBeLessThanOrEqual(1 + 1e-9);
      expect(sanitizeInput(once, blank())).toEqual(once);
    }
  });

  it('ignores stale, duplicate and malformed seqs', () => {
    const { server, player } = setup('c1');
    const p = player('c1');
    for (const seq of [5, 5, 3, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2, 6]) server.receive('c1', input(seq, { mx: 1 }));
    expect(p.inputs.map((i) => i.seq)).toEqual([5, 6]);
  });

  it('rate-limits equip requests', () => {
    const { server, inbox, player, ticks } = setup('c1');
    const p = player('c1');
    const inventories = () => inbox.get('c1')!.filter((m) => m.t === 'inventory').length;
    const before = inventories();
    for (let i = 0; i < EQUIP_BURST + 2; i++) server.receive('c1', { t: 'equip', slot: 'armor', item: i % 2 === 0 ? 'armor_guard' : null });
    expect(inventories() - before).toBe(EQUIP_BURST);
    expect(p.equipment.armor).toBe(null); // an even burst of toggles: on, off, on, off
    ticks(Math.ceil(1 / EQUIP_RATE / TICK_DT)); // one token back
    server.receive('c1', { t: 'equip', slot: 'armor', item: 'armor_guard' });
    server.receive('c1', { t: 'equip', slot: 'armor', item: null });
    expect(p.equipment.armor).toBe('armor_guard');
    expect(inventories() - before).toBe(EQUIP_BURST + 1);
  });
});

describe('interest management', () => {
  const find = (s: Snapshot, id: number) => s.entities.find((e) => e.id === id);

  it('sends only nearby entities, with the appearance on first sight and again after a return', () => {
    const { server, last, player, ticks } = setup('c1', 'c2');
    const p1 = player('c1');
    const p2 = player('c2');
    ticks(1);
    const first = last('c1');
    const seen = find(first, p2.id)!;
    expect(seen.appearance).toEqual(APPEARANCE);
    expect(seen.equipment).toEqual(p2.equipment);
    for (const e of first.entities) expect(Math.hypot(e.x - p1.x, e.z - p1.z)).toBeLessThanOrEqual(INTEREST_RADIUS + 0.01);
    const far = server.debugWolves().filter((w) => Math.hypot(w.x - p1.x, w.z - p1.z) > INTEREST_RADIUS + INTEREST_SLACK);
    expect(far.length).toBeGreaterThan(0);
    for (const w of far) expect(find(first, w.id)).toBeUndefined();

    ticks(1);
    const again = find(last('c1'), p2.id)!;
    expect(again.appearance).toBeUndefined();
    expect(again.equipment).toBeUndefined();

    // inside the hysteresis band a known entity stays; beyond it, it is dropped
    server.debugTeleport('c2', p1.x + INTEREST_RADIUS + INTEREST_SLACK / 2, p1.z);
    ticks(1);
    expect(find(last('c1'), p2.id)).toBeDefined();
    server.debugTeleport('c2', p1.x + INTEREST_RADIUS + INTEREST_SLACK + 5, p1.z);
    ticks(1);
    expect(find(last('c1'), p2.id)).toBeUndefined();
    expect(find(last('c2'), p1.id)).toBeUndefined();

    server.debugTeleport('c2', p1.x + 2, p1.z);
    ticks(1);
    expect(find(last('c1'), p2.id)?.appearance).toEqual(APPEARANCE);
    expect(find(last('c2'), p1.id)?.appearance).toEqual(APPEARANCE);
  });

  it('re-sends the equipment only when it changes', () => {
    const { server, last, player, ticks } = setup('c1', 'c2');
    const p2 = player('c2');
    ticks(2);
    server.receive('c2', { t: 'equip', slot: 'armor', item: 'armor_guard' });
    ticks(1);
    expect(find(last('c1'), p2.id)?.equipment).toEqual({ weapon: p2.equipment.weapon, armor: 'armor_guard' });
    expect(find(last('c2'), p2.id)?.equipment?.armor).toBe('armor_guard'); // its own entity too
    ticks(1);
    expect(find(last('c1'), p2.id)?.equipment).toBeUndefined();
  });

  it('sends positions, angles and event positions quantized to 0.01', () => {
    const { server, snaps, player, ticks } = setup('c1', 'c2');
    const p1 = player('c1');
    // next to a wolf (it bites: damage events carry positions too), with c2 in view
    const wolf = server.debugWolves()[0];
    server.debugTeleport('c1', wolf.x + 1.2, wolf.z);
    server.debugTeleport('c2', wolf.x + 2, wolf.z + 1);
    for (let seq = 1; seq <= 12; seq++) server.receive('c1', input(seq, { mx: 0.31, mz: 0.77 }));
    ticks(Math.round(2.5 / TICK_DT));
    const quantized = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
    let entities = 0;
    let damages = 0;
    for (const s of snaps('c1')) {
      for (const e of s.entities) {
        expect(quantized(e.x) && quantized(e.z) && quantized(e.yaw)).toBe(true);
        entities++;
      }
      for (const e of s.events) {
        if (e.e !== 'damage') continue;
        expect(quantized(e.x) && quantized(e.z)).toBe(true);
        damages++;
      }
    }
    expect(entities).toBeGreaterThan(100);
    expect(damages).toBeGreaterThan(0);
    expect(quantized(p1.x) && quantized(p1.z)).toBe(false); // the server itself keeps full precision
  });
});

describe('wolves', () => {
  it('a wolf respawning does not skip the next wolf in the same tick', () => {
    const { server, ticks } = setup('c1');
    ticks(1);
    const wolves = server.debugWolves();
    const count = wolves.length;
    const [a, b] = wolves;
    a.state = 'dead';
    a.hp = 0;
    a.respawnAt = server.time; // due on the next tick
    // b is due to leave idle on its next think: a skipped tick would leave it idle
    b.state = 'idle';
    b.stateUntil = server.time;
    b.hitUntil = 0;
    ticks(1);
    expect(b.state).toBe('wander');
    expect(server.debugWolves()).not.toContain(a);
    expect(server.debugWolves()).toHaveLength(count);
  });

  it('pushes wolves out of the player they chase', () => {
    const { server, player, ticks } = setup('c1');
    const p = player('c1');
    const wolf = server.debugWolves()[0];
    p.x = wolf.x + 0.1;
    p.z = wolf.z;
    for (let i = 0; i < 20; i++) {
      ticks(1);
      expect(Math.hypot(wolf.x - p.x, wolf.z - p.z)).toBeGreaterThanOrEqual(WOLF.radius + PLAYER_RADIUS - 1e-6);
    }
    expect(['chase', 'attack']).toContain(wolf.state);
  });
});

/**
 * Network stand-in between a GameClient and a GameServer: messages travel as JSON (as over a
 * WebSocket) with `down` ticks of latency to the client and `up(i)` ticks for the client's i-th
 * message, never reordered. The join is delivered at once.
 */
class LaggyTransport implements Transport {
  readonly server: GameServer;
  private listeners: ((m: ServerMsg) => void)[] = [];
  private toServer: { at: number; json: string }[] = [];
  private toClient: { at: number; json: string }[] = [];
  private tickNo = 0;
  private accumulator = 0;
  private sent = 0;
  private lastAt = 0;

  constructor(
    world: WorldData,
    private readonly up: (i: number) => number,
    private readonly down: number,
  ) {
    this.server = new GameServer(1, (_c, m) => this.toClient.push({ at: this.tickNo + this.down, json: JSON.stringify(m) }), world);
  }

  send(msg: ClientMsg): void {
    if (msg.t === 'join') return this.server.receive('c', JSON.parse(JSON.stringify(msg)));
    this.lastAt = Math.max(this.lastAt, this.tickNo + this.up(this.sent++));
    this.toServer.push({ at: this.lastAt, json: JSON.stringify(msg) });
  }

  onMessage(cb: (m: ServerMsg) => void): void {
    this.listeners.push(cb);
  }

  update(dt: number): void {
    this.accumulator += dt;
    while (this.accumulator >= TICK_DT - 1e-9) {
      this.accumulator -= TICK_DT;
      this.tickNo++;
      while (this.toServer.length && this.toServer[0].at <= this.tickNo) this.server.receive('c', JSON.parse(this.toServer.shift()!.json));
      this.server.tick(TICK_DT);
      while (this.toClient.length && this.toClient[0].at <= this.tickNo) {
        const m = JSON.parse(this.toClient.shift()!.json) as ServerMsg;
        for (const l of this.listeners) l(m);
      }
    }
  }

  close(): void {}
}

describe('client prediction', () => {
  const idle: Intent = { mx: 0, mz: 0, run: false, attack: false, aim: null };

  it('matches the server step for step (latency, bunched inputs, odd intents, combos, walls)', () => {
    // inputs arrive in pairs 3-4 ticks late (never starving the server), snapshots 2 ticks late
    const transport = new LaggyTransport(world, (i) => (i % 2 === 0 ? 4 : 3), 2);
    const client = new GameClient(transport);
    client.send({ t: 'join', appearance: APPEARANCE });
    for (let i = 0; i < 10 && !client.me; i++) client.update(TICK_DT, idle);
    expect(client.me).toBeDefined();
    client.setCollision(new CollisionWorld(world.colliders, world.half));
    const p = transport.server.debugPlayer('c')!;

    let worst = 0;
    let corrections = 0;
    const run = (ticks: number, intent: Partial<Intent>) => {
      for (let i = 0; i < ticks; i++) {
        client.update(TICK_DT, { ...idle, ...intent });
        worst = Math.max(worst, client.lastCorrection);
        corrections++;
      }
    };
    run(10, {});
    run(20, { mx: 1 }); // walk
    run(20, { mx: 1, mz: 1, run: true }); // run diagonally
    run(20, { mx: -1, mz: 0.3, run: true }); // turn around
    run(10, { mx: 3, mz: -1 }); // out of range: clamped then normalized
    run(5, { mx: 1, mz: NaN }); // garbage: zeroed
    run(5, {});
    run(1, { attack: true, aim: 1 }); // Attack1...
    run(6, {});
    run(1, { attack: true, aim: -2 }); // ...chained into Attack2 in the window
    run(20, { mx: -1 }); // swinging blocks walking, then it resumes
    run(1, { mx: -1, attack: true, aim: NaN });
    run(12, { mx: -1 });
    run(1, { attack: true, aim: 1e300 });
    run(15, {});
    // walk into the nearest scenery collider, a little off-center, and slide along it
    const near = world.colliders.reduce((a, c) => (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? c : a));
    const reach = (near.kind === 'circle' ? near.r : Math.min(near.hw, near.hd)) + PLAYER_RADIUS;
    const d = Math.hypot(near.x - p.x, near.z - p.z);
    const dir = Math.atan2(near.x - p.x, near.z - p.z) + Math.asin(Math.min(1, (0.4 * reach) / d)); // passes 40% off-center
    const walk = Math.ceil((d / WALK_SPEED + 1.5) / TICK_DT);
    const free = walk * TICK_DT * WALK_SPEED;
    const freeX = p.x + Math.sin(dir) * free;
    const freeZ = p.z + Math.cos(dir) * free;
    run(walk, { mx: Math.sin(dir), mz: Math.cos(dir) });
    run(20, {}); // let every input be acknowledged
    expect(Math.hypot(p.x - freeX, p.z - freeZ)).toBeGreaterThan(0.2); // it really met the collider

    expect(corrections).toBeGreaterThan(200);
    expect(worst).toBeLessThan(0.02); // only the snapshots' centimeter rounding
    // the client kept its own exact prediction: identical to the server's state
    expect(client.predicted.x).toBeCloseTo(p.x, 9);
    expect(client.predicted.z).toBeCloseTo(p.z, 9);
    expect(client.predicted.yaw).toBeCloseTo(p.yaw, 9);
  });

  it('joins through LocalTransport, and a refused join rejects', async () => {
    const client = new GameClient(new LocalTransport(1, world));
    const welcome = await client.join(APPEARANCE);
    expect(welcome.seed).toBe(1);
    client.setCollision(new CollisionWorld(world.colliders, world.half));
    await client.waitForSelf(5000);
    expect(client.me?.hp).toBeGreaterThan(0);

    const refused = new GameClient(new LocalTransport(1, world));
    await expect(refused.join({ ...APPEARANCE, name: '' }, 1000)).rejects.toThrow();
  });
});
