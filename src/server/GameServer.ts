/**
 * Authoritative game simulation (pure TypeScript: no DOM, no three.js). Runs in-process behind
 * LocalTransport today and becomes the Node WebSocket server later without changes.
 */
import { validateAppearance, type Appearance } from '../shared/appearance';
import {
  ATTACKS, ATTACK_MOVE_SPEED, HIT_STUN, OUT_OF_COMBAT, PLAYER_HP, PLAYER_RADIUS, PLAYER_REGEN, RESPAWN_DELAY,
  TICK_DT, TURN_RATE, UNARMED_DAMAGE, WOLF,
} from '../shared/constants';
import { ITEMS, STARTING_EQUIPMENT, STARTING_INVENTORY, type EquipSlot } from '../shared/items';
import { Rng } from '../shared/math/random';
import type { ClientMsg, EntityAnim, EntityState, Equipment, GameEvent, ServerMsg } from '../shared/protocol';
import { CollisionWorld } from '../shared/world/collision';
import { generateWorld, type Den, type WorldData } from '../shared/world/worldgen';
import { stepMovement, turnToward } from '../shared/movement';

type AttackName = keyof typeof ATTACKS;

interface Player {
  id: number;
  client: string;
  appearance: Appearance;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  anim: EntityAnim;
  animStart: number;
  input: { seq: number; mx: number; mz: number; run: boolean; aim: number | null };
  lastSeq: number;
  attack: { name: AttackName; start: number; hit: boolean; queued: boolean } | null;
  stunUntil: number;
  lastCombat: number;
  dead: boolean;
  respawnAt: number;
  equipment: Equipment;
  items: string[];
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

export type Send = (client: string, msg: ServerMsg) => void;

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

  receive(client: string, msg: ClientMsg): void {
    if (msg.t === 'join') return this.join(client, msg.appearance);
    const p = this.players.get(client);
    if (!p) return;
    switch (msg.t) {
      case 'input':
        if (msg.seq <= p.input.seq) return;
        p.input = { seq: msg.seq, mx: clampUnit(msg.mx), mz: clampUnit(msg.mz), run: !!msg.run, aim: msg.aim };
        if (msg.attack) this.pressAttack(p);
        break;
      case 'equip':
        this.equip(p, msg.slot, msg.item);
        break;
      case 'respawn':
        if (p.dead && this.time >= p.respawnAt) this.respawn(p);
        break;
    }
  }

  leave(client: string): void {
    this.players.delete(client);
  }

  private join(client: string, appearance: Appearance): void {
    const errors = validateAppearance(appearance);
    if (errors.length) {
      this.send(client, { t: 'error', message: `aparência inválida: ${errors.join(', ')}` });
      return;
    }
    const { spawn } = this.world;
    const p: Player = {
      id: this.nextId++,
      client,
      appearance,
      x: spawn.x,
      z: spawn.z,
      yaw: Math.PI,
      hp: PLAYER_HP,
      anim: 'Idle',
      animStart: this.time,
      input: { seq: 0, mx: 0, mz: 0, run: false, aim: null },
      lastSeq: 0,
      attack: null,
      stunUntil: 0,
      lastCombat: -99,
      dead: false,
      respawnAt: 0,
      equipment: { ...STARTING_EQUIPMENT },
      items: [...STARTING_INVENTORY],
    };
    this.players.set(client, p);
    this.send(client, { t: 'welcome', id: p.id, seed: this.seed, time: this.time });
    this.sendInventory(p);
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
    const entities = this.snapshot();
    const events = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      this.send(p.client, { t: 'snapshot', time: this.time, ack: p.input.seq, entities, events });
    }
  }

  private setAnim(e: { anim: EntityAnim; animStart: number }, anim: EntityAnim, restart = false): void {
    if (e.anim !== anim || restart) {
      e.anim = anim;
      e.animStart = this.time;
    }
  }

  private pressAttack(p: Player): void {
    if (p.dead || this.time < p.stunUntil) return;
    if (!p.attack) return this.startAttack(p, 'Attack1');
    const a = ATTACKS[p.attack.name];
    const t = this.time - p.attack.start;
    if (p.attack.name === 'Attack1' && t >= a.chainFrom && t <= a.chainTo) p.attack.queued = true;
  }

  private startAttack(p: Player, name: AttackName): void {
    if (p.input.aim !== null) p.yaw = p.input.aim;
    p.attack = { name, start: this.time, hit: false, queued: false };
    this.setAnim(p, name, true);
    this.events.push({ e: 'swing', id: p.id, anim: name });
  }

  private updatePlayer(p: Player, dt: number): void {
    if (p.dead) {
      if (this.time >= p.respawnAt + 6) this.respawn(p); // auto respawn
      return;
    }
    p.lastSeq = p.input.seq;
    if (p.attack) {
      const def = ATTACKS[p.attack.name];
      const t = this.time - p.attack.start;
      if (!p.attack.hit && t >= def.hit) {
        p.attack.hit = true;
        this.resolveSwing(p, def);
      }
      // a slight forward drift while swinging
      const [x, z] = this.collision.move(p.x, p.z, PLAYER_RADIUS, Math.sin(p.yaw) * ATTACK_MOVE_SPEED * dt, Math.cos(p.yaw) * ATTACK_MOVE_SPEED * dt);
      p.x = x;
      p.z = z;
      if (t >= def.duration) {
        const queued = p.attack.queued;
        p.attack = null;
        if (queued) this.startAttack(p, 'Attack2');
      }
      if (p.attack) return;
    }
    if (this.time < p.stunUntil) return;
    const r = stepMovement(this.collision, p, p.input, dt);
    p.x = r.x;
    p.z = r.z;
    p.yaw = r.yaw;
    this.setAnim(p, r.moving ? (p.input.run ? 'Run' : 'Walk') : 'Idle');
    if (this.time - p.lastCombat > OUT_OF_COMBAT) p.hp = Math.min(PLAYER_HP, p.hp + PLAYER_REGEN * dt);
  }

  private resolveSwing(p: Player, def: (typeof ATTACKS)[AttackName]): void {
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
    this.events.push({ e: 'damage', target: w.id, source: from.id, amount, x: w.x, z: w.z, crit });
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
    this.events.push({ e: 'damage', target: p.id, source: from.id, amount: final, x: p.x, z: p.z });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.attack = null;
      p.respawnAt = this.time + RESPAWN_DELAY;
      this.setAnim(p, 'Death', true);
      this.events.push({ e: 'death', id: p.id });
      for (const w of this.wolves) if (w.target === p.id) this.startReturn(w);
      return;
    }
    if (!p.attack) {
      p.stunUntil = this.time + HIT_STUN;
      this.setAnim(p, 'Hit', true);
    }
  }

  private respawn(p: Player): void {
    p.dead = false;
    p.hp = PLAYER_HP;
    p.x = this.world.spawn.x;
    p.z = this.world.spawn.z;
    p.stunUntil = 0;
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
    const t = this.time;
    if (w.state === 'dead') {
      if (t >= w.respawnAt) {
        const idx = this.wolves.indexOf(w);
        this.wolves.splice(idx, 1);
        this.spawnWolf(w.den);
      }
      return;
    }
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
        if (d > WOLF.attackRange * 0.85) this.moveWolf(w, p.x, p.z, WOLF.runSpeed, dt, WOLF.attackRange * 0.8);
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

  // ------------------------------------------------------------------ snapshot

  private snapshot(): EntityState[] {
    const out: EntityState[] = [];
    for (const p of this.players.values()) {
      out.push({
        id: p.id, kind: 'player', x: p.x, z: p.z, yaw: p.yaw, anim: p.anim, animStart: p.animStart, hp: Math.ceil(p.hp),
        maxHp: PLAYER_HP, name: p.appearance.name, appearance: p.appearance, equipment: { ...p.equipment },
      });
    }
    for (const w of this.wolves) {
      const telegraph = w.state === 'attack' && this.time - w.attackStart < WOLF.windup;
      out.push({ id: w.id, kind: 'wolf', x: w.x, z: w.z, yaw: w.yaw, anim: w.anim, animStart: w.animStart, hp: Math.ceil(w.hp), maxHp: WOLF.hp, telegraph });
    }
    return out;
  }

  /** Test/debug helpers. */
  get wolfCount(): number {
    return this.wolves.filter((w) => w.state !== 'dead').length;
  }

  debugPlayer(client: string): Player | undefined {
    return this.players.get(client);
  }

  debugWolves(): readonly Wolf[] {
    return this.wolves;
  }
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
