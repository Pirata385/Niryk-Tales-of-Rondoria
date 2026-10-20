/**
 * Authoritative game simulation (pure TypeScript: no DOM, no three.js). Runs in-process behind
 * LocalTransport today and becomes the Node WebSocket server later without changes.
 */
import { validateAppearance, type Appearance } from '../shared/appearance';
import {
  ATTACKS, EQUIP_BURST, EQUIP_RATE, HIT_STUN, INPUT_QUEUE_MAX, INTEREST_RADIUS, INTEREST_SLACK, OUT_OF_COMBAT,
  PLAYER_HP, PLAYER_RADIUS, PLAYER_REGEN, RESPAWN_DELAY, TICK_DT, TURN_RATE, UNARMED_DAMAGE, WOLF,
} from '../shared/constants';
import { ITEMS, STARTING_EQUIPMENT, STARTING_INVENTORY, type EquipSlot } from '../shared/items';
import { Rng } from '../shared/math/random';
import {
  sanitizeInput, stepPlayer, turnToward, wrapAngle, type AttackName, type PlayerInput, type PlayerMotion,
} from '../shared/movement';
import {
  quantize, quantizeAngle, type ClientMsg, type EntityAnim, type EntityState, type Equipment, type GameEvent, type SelfState,
  type ServerMsg,
} from '../shared/protocol';
import { CollisionWorld } from '../shared/world/collision';
import { generateWorld, type Den, type WorldData } from '../shared/world/worldgen';

interface QueuedInput extends PlayerInput {
  seq: number;
}

interface Player extends PlayerMotion {
  id: number;
  client: string;
  appearance: Appearance;
  hp: number;
  anim: EntityAnim;
  animStart: number;
  /** Inputs received and not simulated yet: one is consumed per tick. */
  inputs: QueuedInput[];
  /** The last simulated input (its movement is repeated while the queue is empty). */
  last: QueuedInput;
  /** Highest seq received: anything not newer is stale or a duplicate. */
  received: number;
  /** Seq of the last simulated input (the snapshot's ack). */
  ack: number;
  lastCombat: number;
  respawnAt: number;
  equipment: Equipment;
  /** Bumped on every equipment change, so clients get the equipment only when it changes. */
  equipVersion: number;
  /** Equip rate limit (token bucket). */
  equipTokens: number;
  equipRefill: number;
  items: string[];
  /** Entities this client was sent, with the equipment version it has (interest management). */
  known: Map<number, number>;
}

type WolfState = 'idle' | 'wander' | 'chase' | 'attack' | 'return' | 'dead';

interface Wolf {
  id: number;
  den: Den;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  state: WolfState;
  anim: EntityAnim;
  animStart: number;
  target: number | null;
  stateUntil: number;
  wander: { x: number; z: number } | null;
  attackStart: number;
  bitten: boolean;
  cooldownUntil: number;
  hitUntil: number;
  respawnAt: number;
}

/** An entity's per-tick wire state, built once and shared by every client that sees it. */
interface Visible {
  state: EntityState;
  x: number;
  z: number;
  player: Player | null;
}

export type Send = (client: string, msg: ServerMsg) => void;

/** A chasing wolf stops this far from its target (never inside the bite range's inner part). */
const CHASE_STOP = WOLF.attackRange * 0.8;

export class GameServer {
  readonly world: WorldData;
  readonly collision: CollisionWorld;
  time = 0;
  private nextId = 1;
  private readonly players = new Map<string, Player>();
  private readonly wolves: Wolf[] = [];
  private events: GameEvent[] = [];
  private readonly rng: Rng;

  constructor(
    readonly seed: number,
    private readonly send: Send,
    world?: WorldData,
  ) {
    this.world = world ?? generateWorld(seed);
    this.collision = new CollisionWorld(this.world.colliders, this.world.half);
    this.rng = new Rng(seed ^ 0x5eed);
    for (const den of this.world.dens) {
      for (let i = 0; i < 3 && this.wolves.length < WOLF.maxAlive; i++) this.spawnWolf(den);
    }
  }

  // ------------------------------------------------------------------ connection

  /** Handles a message from a client. Everything in it is untrusted: shapes and values are checked. */
  receive(client: string, msg: ClientMsg): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') return this.join(client, msg.appearance);
    const p = this.players.get(client);
    if (!p) return;
    switch (msg.t) {
      case 'input':
        this.queueInput(p, msg);
        break;
      case 'equip':
        this.requestEquip(p, msg.slot, msg.item);
        break;
      case 'respawn':
        if (p.dead && this.time >= p.respawnAt) this.respawn(p);
        break;
    }
  }

  leave(client: string): void {
    this.players.delete(client);
  }

  private join(client: string, appearance: unknown): void {
    const a = readAppearance(appearance);
    const errors = a ? validateAppearance(a) : ['appearance'];
    if (!a || errors.length) {
      this.send(client, { t: 'error', message: `aparência inválida: ${errors.join(', ')}` });
      return;
    }
    const { spawn } = this.world;
    const idle: QueuedInput = { seq: 0, mx: 0, mz: 0, run: false, attack: false, aim: null };
    const p: Player = {
      id: this.nextId++,
      client,
      appearance: a,
      x: spawn.x,
      z: spawn.z,
      yaw: spawn.yaw,
      swing: null,
      stun: 0,
      dead: false,
      hp: PLAYER_HP,
      anim: 'Idle',
      animStart: this.time,
      inputs: [],
      last: idle,
      received: 0,
      ack: 0,
      lastCombat: -99,
      respawnAt: 0,
      equipment: { ...STARTING_EQUIPMENT },
      equipVersion: 0,
      equipTokens: EQUIP_BURST,
      equipRefill: this.time,
      items: [...STARTING_INVENTORY],
      known: new Map(),
    };
    this.players.set(client, p);
    this.send(client, { t: 'welcome', id: p.id, seed: this.seed, time: this.time });
    this.sendInventory(p);
  }

  /** Validates an input and queues it; the simulation consumes one per tick (see updatePlayer). */
  private queueInput(p: Player, msg: Extract<ClientMsg, { t: 'input' }>): void {
    const seq = msg.seq;
    if (!Number.isSafeInteger(seq) || seq <= p.received) return; // stale, duplicate or malformed
    p.received = seq;
    // the same reading the client predicts with (shared/movement.ts)
    p.inputs.push(sanitizeInput<QueuedInput>(msg, { seq, mx: 0, mz: 0, run: false, attack: false, aim: null }));
    if (p.inputs.length > INPUT_QUEUE_MAX) p.inputs.shift(); // a burst beyond the cap drops the oldest
  }

  private requestEquip(p: Player, slot: unknown, item: unknown): void {
    if (slot !== 'weapon' && slot !== 'armor') return;
    if (item !== null && (typeof item !== 'string' || !Object.hasOwn(ITEMS, item))) return;
    p.equipTokens = Math.min(EQUIP_BURST, p.equipTokens + (this.time - p.equipRefill) * EQUIP_RATE);
    p.equipRefill = this.time;
    if (p.equipTokens < 1) return; // spam: ignored
    p.equipTokens -= 1;
    this.equip(p, slot, item);
  }

  private equip(p: Player, slot: EquipSlot, item: string | null): void {
    const current = p.equipment[slot];
    if (item !== null) {
      const def = ITEMS[item];
      if (!def || def.slot !== slot || !p.items.includes(item)) return;
      p.items = p.items.filter((i) => i !== item);
    }
    if (current) p.items.push(current);
    p.equipment[slot] = item;
    p.equipVersion++;
    this.sendInventory(p);
  }

  private sendInventory(p: Player): void {
    this.send(p.client, { t: 'inventory', equipment: { ...p.equipment }, items: [...p.items] });
  }

  // ------------------------------------------------------------------ simulation

  tick(dt = TICK_DT): void {
    this.time += dt;
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    for (const w of this.wolves) this.updateWolf(w, dt);
    // respawns after the loop: removing wolves while iterating would skip the next one's tick
    const due = this.wolves.filter((w) => w.state === 'dead' && this.time >= w.respawnAt);
    for (const w of due) {
      this.wolves.splice(this.wolves.indexOf(w), 1);
      this.spawnWolf(w.den);
    }
    this.broadcast();
    this.events = [];
  }

  private setAnim(e: { anim: EntityAnim; animStart: number }, anim: EntityAnim, restart = false): void {
    if (e.anim !== anim || restart) {
      e.anim = anim;
      e.animStart = this.time;
    }
  }

  private updatePlayer(p: Player, dt: number): void {
    // exactly one input per tick, in order; if none arrived in time keep the last movement intent
    // (without its attack) and acknowledge nothing new
    const next = p.inputs.shift();
    let input: PlayerInput;
    if (next) {
      p.last = next;
      p.ack = next.seq;
      input = next;
    } else {
      input = { ...p.last, attack: false };
    }
    if (p.dead) {
      if (this.time >= p.respawnAt + 6) this.respawn(p); // auto respawn
      return;
    }
    // the same step the client predicts with (shared/movement.ts)
    const r = stepPlayer(this.collision, p, input, dt);
    if (r.hit) this.resolveSwing(p, r.hit);
    if (r.started) {
      this.setAnim(p, r.started, true);
      this.events.push({ e: 'swing', id: p.id, anim: r.started });
    }
    if (p.swing || p.stun > 0) return; // the swing or Hit clip keeps playing
    this.setAnim(p, r.moving ? (r.running ? 'Run' : 'Walk') : 'Idle');
    if (this.time - p.lastCombat > OUT_OF_COMBAT) p.hp = Math.min(PLAYER_HP, p.hp + PLAYER_REGEN * dt);
  }

  private resolveSwing(p: Player, name: AttackName): void {
    const def = ATTACKS[name];
    const weapon = p.equipment.weapon ? ITEMS[p.equipment.weapon] : null;
    const [lo, hi] = weapon?.damage ?? UNARMED_DAMAGE;
    const half = (def.arc / 2) * (Math.PI / 180);
    for (const w of this.wolves) {
      if (w.state === 'dead') continue;
      const dx = w.x - p.x;
      const dz = w.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > def.range + WOLF.radius) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), p.yaw));
      if (d > 0.6 && ang > half) continue;
      const crit = this.rng.chance(0.1);
      const amount = Math.round(this.rng.range(lo, hi) * def.mult * (crit ? 1.6 : 1));
      this.damageWolf(w, amount, p, crit);
    }
  }

  private damageWolf(w: Wolf, amount: number, from: Player, crit: boolean): void {
    w.hp -= amount;
    from.lastCombat = this.time;
    this.events.push({ e: 'damage', target: w.id, source: from.id, amount, x: quantize(w.x), z: quantize(w.z), crit });
    if (w.hp <= 0) {
      w.hp = 0;
      w.state = 'dead';
      w.respawnAt = this.time + WOLF.respawn;
      this.setAnim(w, 'Death', true);
      this.events.push({ e: 'death', id: w.id });
      return;
    }
    w.target = from.id;
    if (w.state !== 'attack') {
      w.state = 'chase';
      w.hitUntil = this.time + HIT_STUN;
      this.setAnim(w, 'Hit', true);
    }
  }

  private damagePlayer(p: Player, amount: number, from: Wolf): void {
    const armor = p.equipment.armor ? ITEMS[p.equipment.armor] : null;
    const final = Math.max(1, Math.round(amount * (1 - (armor?.defense ?? 0))));
    p.hp -= final;
    p.lastCombat = this.time;
    this.events.push({ e: 'damage', target: p.id, source: from.id, amount: final, x: quantize(p.x), z: quantize(p.z) });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.swing = null;
      p.stun = 0;
      p.respawnAt = this.time + RESPAWN_DELAY;
      this.setAnim(p, 'Death', true);
      this.events.push({ e: 'death', id: p.id });
      for (const w of this.wolves) if (w.target === p.id) this.startReturn(w);
      return;
    }
    if (!p.swing) {
      p.stun = HIT_STUN;
      this.setAnim(p, 'Hit', true);
    }
  }

  private respawn(p: Player): void {
    p.dead = false;
    p.hp = PLAYER_HP;
    p.x = this.world.spawn.x;
    p.z = this.world.spawn.z;
    p.yaw = this.world.spawn.yaw;
    p.swing = null;
    p.stun = 0;
    this.setAnim(p, 'Idle', true);
    this.events.push({ e: 'respawn', id: p.id });
  }

  // ------------------------------------------------------------------ wolves

  private spawnWolf(den: Den): Wolf {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(0, den.r);
    const [x, z] = this.collision.resolve(den.x + Math.cos(a) * r, den.z + Math.sin(a) * r, WOLF.radius);
    const w: Wolf = {
      id: this.nextId++, den, x, z, yaw: this.rng.range(-Math.PI, Math.PI), hp: WOLF.hp, state: 'idle', anim: 'Idle',
      animStart: this.time, target: null, stateUntil: this.time + this.rng.range(1, 4), wander: null, attackStart: 0,
      bitten: false, cooldownUntil: 0, hitUntil: 0, respawnAt: 0,
    };
    this.wolves.push(w);
    return w;
  }

  private startReturn(w: Wolf): void {
    w.state = 'return';
    w.target = null;
  }

  private nearestPlayer(w: Wolf, range: number): Player | null {
    let best: Player | null = null;
    let bd = range;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private playerById(id: number | null): Player | null {
    if (id === null) return null;
    for (const p of this.players.values()) if (p.id === id && !p.dead) return p;
    return null;
  }

  private moveWolf(w: Wolf, tx: number, tz: number, speed: number, dt: number, stopAt = 0): boolean {
    const dx = tx - w.x;
    const dz = tz - w.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopAt + 0.05) return true;
    const step = Math.min(speed * dt, d - stopAt);
    w.yaw = turnToward(w.yaw, Math.atan2(dx, dz), TURN_RATE * 0.7 * dt);
    const [x, z] = this.collision.move(w.x, w.z, WOLF.radius, (dx / d) * step, (dz / d) * step);
    w.x = x;
    w.z = z;
    return false;
  }

  private updateWolf(w: Wolf, dt: number): void {
    if (w.state === 'dead') return; // respawned by tick() once w.respawnAt passes
    this.thinkWolf(w, dt);
    this.separate(w);
  }

  private thinkWolf(w: Wolf, dt: number): void {
    const t = this.time;
    if (t < w.hitUntil) return;
    const fromDen = Math.hypot(w.x - w.den.x, w.z - w.den.z);
    if (w.state !== 'return' && fromDen > WOLF.leashRange) this.startReturn(w);

    switch (w.state) {
      case 'idle':
      case 'wander': {
        const seen = this.nearestPlayer(w, WOLF.aggroRange);
        if (seen) {
          w.state = 'chase';
          w.target = seen.id;
          break;
        }
        if (w.state === 'idle') {
          this.setAnim(w, 'Idle');
          if (t > w.stateUntil) {
            const a = this.rng.range(0, Math.PI * 2);
            const r = this.rng.range(1, WOLF.wanderRadius);
            w.wander = { x: w.den.x + Math.cos(a) * r, z: w.den.z + Math.sin(a) * r };
            w.state = 'wander';
            w.stateUntil = t + 8;
          }
        } else {
          this.setAnim(w, 'Walk');
          const arrived = this.moveWolf(w, w.wander!.x, w.wander!.z, WOLF.walkSpeed, dt);
          if (arrived || t > w.stateUntil) {
            w.state = 'idle';
            w.stateUntil = t + this.rng.range(2, 5);
          }
        }
        break;
      }
      case 'chase': {
        const p = this.playerById(w.target);
        if (!p) {
          this.startReturn(w);
          break;
        }
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        if (d <= WOLF.attackRange && t >= w.cooldownUntil) {
          w.state = 'attack';
          w.attackStart = t;
          w.bitten = false;
          w.yaw = Math.atan2(p.x - w.x, p.z - w.z);
          this.setAnim(w, 'Attack', true);
          break;
        }
        this.setAnim(w, d > WOLF.attackRange + 0.3 ? 'Run' : 'Idle');
        if (d > WOLF.attackRange * 0.85) this.moveWolf(w, p.x, p.z, WOLF.runSpeed, dt, CHASE_STOP);
        else w.yaw = turnToward(w.yaw, Math.atan2(p.x - w.x, p.z - w.z), TURN_RATE * dt);
        break;
      }
      case 'attack': {
        const at = t - w.attackStart;
        if (!w.bitten && at >= WOLF.windup) {
          w.bitten = true;
          const p = this.playerById(w.target);
          if (p) {
            const dx = p.x - w.x;
            const dz = p.z - w.z;
            const d = Math.hypot(dx, dz);
            const ang = Math.abs(angleDiff(Math.atan2(dx, dz), w.yaw));
            if (d <= WOLF.attackRange + 0.7 && ang < Math.PI / 2.5) {
              this.damagePlayer(p, Math.round(this.rng.range(WOLF.damage[0], WOLF.damage[1])), w);
            }
          }
        }
        if (at >= WOLF.attackDuration) {
          w.state = 'chase';
          w.cooldownUntil = t + WOLF.attackCooldown;
        }
        break;
      }
      case 'return': {
        this.setAnim(w, 'Run');
        w.hp = Math.min(WOLF.hp, w.hp + 20 * dt);
        if (this.moveWolf(w, w.den.x, w.den.z, WOLF.runSpeed * 0.8, dt, 1.5)) {
          w.state = 'idle';
          w.stateUntil = t + 2;
          w.hp = WOLF.hp;
        }
        break;
      }
    }
  }

  /**
   * Keeps a wolf out of every living player and other wolf. Only the wolf moves (players stay
   * exactly where their client predicted them), sliding along scenery like any movement; between
   * two wolves each takes half the overlap on its own update.
   */
  private separate(w: Wolf): void {
    let px = 0;
    let pz = 0;
    const push = (ox: number, oz: number, min: number, share: number) => {
      const dx = w.x - ox;
      const dz = w.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        // exactly on top: back off along the wolf's facing
        px -= Math.sin(w.yaw) * min * share;
        pz -= Math.cos(w.yaw) * min * share;
        return;
      }
      const k = ((min - d) / d) * share;
      px += dx * k;
      pz += dz * k;
    };
    for (const p of this.players.values()) if (!p.dead) push(p.x, p.z, WOLF.radius + PLAYER_RADIUS, 1);
    for (const o of this.wolves) if (o !== w && o.state !== 'dead') push(o.x, o.z, WOLF.radius * 2, 0.5);
    if (px === 0 && pz === 0) return;
    [w.x, w.z] = this.collision.move(w.x, w.z, WOLF.radius, px, pz);
  }

  // ------------------------------------------------------------------ snapshots

  /**
   * Sends each player the entities within its interest radius (always itself), quantized, plus the
   * events about them. Appearance goes only with an entity's first appearance to that client and
   * equipment only when it changed since the client last got it.
   */
  private broadcast(): void {
    const all: Visible[] = [];
    for (const p of this.players.values()) {
      all.push({ state: entityState(p, 'player', PLAYER_HP), x: p.x, z: p.z, player: p });
    }
    for (const w of this.wolves) {
      const s = entityState(w, 'wolf', WOLF.hp);
      if (w.state === 'attack' && this.time - w.attackStart < WOLF.windup) s.telegraph = true;
      all.push({ state: s, x: w.x, z: w.z, player: null });
    }
    for (const viewer of this.players.values()) {
      const known = new Map<number, number>();
      const entities: EntityState[] = [];
      for (const v of all) {
        const id = v.state.id;
        const had = viewer.known.get(id);
        if (v.player !== viewer) {
          const r = had === undefined ? INTEREST_RADIUS : INTEREST_RADIUS + INTEREST_SLACK;
          const dx = v.x - viewer.x;
          const dz = v.z - viewer.z;
          if (dx * dx + dz * dz > r * r) continue;
        }
        let state = v.state;
        if (v.player) {
          const version = v.player.equipVersion;
          if (had === undefined) state = { ...state, appearance: v.player.appearance, equipment: { ...v.player.equipment } };
          else if (had !== version) state = { ...state, equipment: { ...v.player.equipment } };
          known.set(id, version);
        } else {
          known.set(id, 0);
        }
        entities.push(state);
      }
      viewer.known = known;
      const events = this.events.filter((e) => (e.e === 'damage' ? known.has(e.target) || known.has(e.source) : known.has(e.id)));
      this.send(viewer.client, { t: 'snapshot', time: this.time, ack: viewer.ack, entities, events, you: selfState(viewer) });
    }
  }

  /** Test/debug helpers (LocalTransport's debug interface, unit tests). */
  get wolfCount(): number {
    return this.wolves.filter((w) => w.state !== 'dead').length;
  }

  debugPlayer(client: string): Player | undefined {
    return this.players.get(client);
  }

  debugWolves(): readonly Wolf[] {
    return this.wolves;
  }

  debugTeleport(client: string, x: number, z: number): void {
    const p = this.players.get(client);
    if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return;
    [p.x, p.z] = this.collision.resolve(x, z, PLAYER_RADIUS);
  }
}

function entityState(e: { id: number; x: number; z: number; yaw: number; anim: EntityAnim; animStart: number; hp: number }, kind: EntityState['kind'], maxHp: number): EntityState {
  return {
    id: e.id, kind, x: quantize(e.x), z: quantize(e.z), yaw: quantizeAngle(e.yaw), anim: e.anim, animStart: e.animStart,
    hp: Math.ceil(e.hp), maxHp,
  };
}

function selfState(p: Player): SelfState {
  return { swing: p.swing && { ...p.swing }, stun: p.stun, dead: p.dead };
}

const APPEARANCE_KEYS = ['name', 'race', 'gender', 'skin', 'hairStyle', 'hairColor', 'plumeColor', 'eyeColor', 'clothColor'] as const;

/** Copies the known appearance fields (all strings) or returns null: nothing else reaches other players. */
function readAppearance(v: unknown): Appearance | null {
  if (!v || typeof v !== 'object') return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of APPEARANCE_KEYS) {
    const value = src[k];
    if (typeof value !== 'string') return null;
    out[k] = value;
  }
  return out as unknown as Appearance;
}

export function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}
