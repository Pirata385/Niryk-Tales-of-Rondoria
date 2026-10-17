import type { Appearance } from '@shared/appearance';
import { TICK_DT } from '@shared/constants';
import { sanitizeInput, stepPlayer, wrapAngle, type PlayerInput, type PlayerMotion } from '@shared/movement';
import type { ClientMsg, EntityState, Equipment, GameEvent, SelfState, ServerMsg } from '@shared/protocol';
import type { CollisionWorld } from '@shared/world/collision';
import type { Transport } from '../net/Transport';

export interface Intent {
  mx: number;
  mz: number;
  run: boolean;
  attack: boolean;
  aim: number | null;
}

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

interface Sample extends Pose {
  time: number;
}

interface PendingInput extends PlayerInput {
  seq: number;
}

export interface Welcome {
  id: number;
  seed: number;
  time: number;
}

const INTERP_DELAY = 0.1; // s behind the render clock's server time for remote entities
const HISTORY = 12; // snapshots kept per remote entity
/** The render clock moves this fraction of the way to each snapshot's time; a bigger gap jumps. */
const CLOCK_PULL = 0.1;
const CLOCK_SNAP = 0.5;
/** Prediction errors below this (m, rad) are quantization noise: the local prediction is kept. */
const DEADBAND = 0.012;
/** Corrections above this (m) are teleports or respawns and jump instead of blending. */
const SNAP_DISTANCE = 0.5;
/** Decay rate (1/s) of the visual offset that blends a correction in. */
const BLEND_RATE = 15;
const MAX_PENDING = 120;
const IDLE: Intent = { mx: 0, mz: 0, run: false, attack: false, aim: null };

/**
 * Client-side view of the game state: sends one input per server tick, predicts the local player
 * with the server's own step function (shared/movement.ts) and reconciles with acknowledged
 * snapshots; other entities are interpolated on a smooth render clock.
 */
export class GameClient {
  myId = -1;
  /** Server time of the newest snapshot. */
  serverTime = 0;
  equipment: Equipment = { weapon: null, armor: null };
  items: string[] = [];
  /** Entities near the player (the server's interest area), with the appearance/equipment last sent. */
  readonly entities = new Map<number, EntityState>();
  /** Distance between the local prediction and the server's replayed state at the last snapshot (m). */
  lastCorrection = 0;
  onEvent: (e: GameEvent) => void = () => {};
  onInventory: () => void = () => {};
  onError: (m: string) => void = () => {};

  private readonly history = new Map<number, Sample[]>();
  private collision: CollisionWorld | null = null;
  private welcome: Welcome | null = null;
  private failure: string | null = null;
  private seq = 0;
  private pending: PendingInput[] = [];
  private accumulator = 0;
  private attackLatched = false;
  private latchedAim: number | null = null;
  private clock = 0;
  /** Predicted own state and its position one tick earlier (rendering interpolates between them). */
  private readonly motion: PlayerMotion = { x: 0, z: 0, yaw: 0, swing: null, stun: 0, dead: false };
  private readonly prev: Pose = { x: 0, z: 0, yaw: 0 };
  /** Visual offset that blends corrections in (decays to zero). */
  private readonly blend = { x: 0, z: 0 };
  private alpha = 0;
  private readonly selfOut: Pose = { x: 0, z: 0, yaw: 0 };
  private readonly remoteOut: Pose = { x: 0, z: 0, yaw: 0 };
  private readonly seen = new Set<number>();
  private readonly raw: Intent = { ...IDLE };

  constructor(private readonly transport: Transport) {
    transport.onMessage((m) => this.receive(m));
  }

  /**
   * Asks to enter the world; resolves with the welcome (our id and the world seed) and rejects on
   * a server error or after `timeoutMs`.
   */
  async join(appearance: Appearance, timeoutMs = 15_000): Promise<Welcome> {
    this.failure = null;
    this.transport.send({ t: 'join', appearance });
    await this.waitUntil(() => this.welcome !== null, timeoutMs, 'welcome');
    return this.welcome!;
  }

  /** The world's colliders (built from the welcome's seed): prediction starts once they are known. */
  setCollision(collision: CollisionWorld): void {
    this.collision = collision;
  }

  /** Resolves once a snapshot has brought our own entity (rejects after `timeoutMs`). */
  waitForSelf(timeoutMs = 15_000): Promise<void> {
    return this.waitUntil(() => this.entities.has(this.myId), timeoutMs, 'first snapshot');
  }

  send(msg: ClientMsg): void {
    this.transport.send(msg);
  }

  /** A one-shot attack press (sent with the next tick's input). */
  pressAttack(): void {
    this.attackLatched = true;
    this.latchedAim = null;
  }

  get me(): EntityState | undefined {
    return this.entities.get(this.myId);
  }

  /**
   * Smooth estimate of the server time for rendering: advances with the frame time and is pulled
   * gently toward each snapshot's time (remote entities are drawn INTERP_DELAY behind it).
   */
  get renderTime(): number {
    return this.clock;
  }

  /** The predicted own state (read-only view, for tests and debugging). */
  get predicted(): Readonly<PlayerMotion> {
    return this.motion;
  }

  update(dt: number, intent: Intent): void {
    // never more than INTERP_DELAY past the newest snapshot: remote entities hold rather than extrapolate
    this.clock = Math.min(this.clock + dt, this.serverTime + INTERP_DELAY);
    // a press in a frame without a tick waits for the next tick instead of being lost
    if (intent.attack) {
      this.attackLatched = true;
      this.latchedAim = intent.aim;
    }
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const raw = this.raw;
      raw.mx = intent.mx;
      raw.mz = intent.mz;
      raw.run = intent.run;
      raw.attack = this.attackLatched;
      raw.aim = this.attackLatched ? this.latchedAim : intent.aim;
      // read exactly as the server will (clamped, normalized, aim wrapped): the prediction must
      // step the same numbers the server simulates
      const input = sanitizeInput<PendingInput>(raw, { seq: ++this.seq, mx: 0, mz: 0, run: false, attack: false, aim: null });
      this.attackLatched = false;
      this.latchedAim = null;
      this.transport.send({ t: 'input', seq: input.seq, mx: input.mx, mz: input.mz, run: input.run, attack: input.attack, aim: input.aim });
      this.pending.push(input);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      this.prev.x = this.motion.x;
      this.prev.z = this.motion.z;
      this.prev.yaw = this.motion.yaw;
      if (this.collision) stepPlayer(this.collision, this.motion, input, TICK_DT);
    }
    this.transport.update(dt);
    this.alpha = this.accumulator / TICK_DT;
    const k = Math.exp(-dt * BLEND_RATE);
    this.blend.x *= k;
    this.blend.z *= k;
  }

  /** Smoothed own pose for rendering. The returned object is reused by the next call. */
  renderedSelf(): Readonly<Pose> {
    const a = this.alpha;
    const p = this.prev;
    const q = this.motion;
    const o = this.selfOut;
    o.x = p.x + (q.x - p.x) * a + this.blend.x;
    o.z = p.z + (q.z - p.z) * a + this.blend.z;
    o.yaw = p.yaw + wrapAngle(q.yaw - p.yaw) * a;
    return o;
  }

  /** Interpolated pose of a remote entity at render time. The returned object is reused by the next call. */
  interpolated(id: number): Readonly<Pose> | null {
    const h = this.history.get(id);
    if (!h || h.length === 0) return null;
    const t = this.clock - INTERP_DELAY;
    let a = h[0];
    let b = h[h.length - 1];
    for (let i = 0; i < h.length - 1; i++) {
      if (h[i].time <= t && h[i + 1].time >= t) {
        a = h[i];
        b = h[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - a.time) / span)) : 1;
    const o = this.remoteOut;
    o.x = a.x + (b.x - a.x) * k;
    o.z = a.z + (b.z - a.z) * k;
    o.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
    return o;
  }

  /** Pumps the connection with idle inputs (the local transport ticks its server) until `done`. */
  private waitUntil(done: () => boolean, timeoutMs: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let last = start;
      const poll = () => {
        if (this.failure) return reject(new Error(this.failure));
        if (done()) return resolve();
        const now = performance.now();
        if (now - start > timeoutMs) return reject(new Error(`no ${what} from the server after ${Math.round(timeoutMs / 1000)} s`));
        this.update((now - last) / 1000, IDLE);
        last = now;
        setTimeout(poll, 16);
      };
      poll();
    });
  }

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.serverTime = m.time;
        this.clock = m.time;
        this.welcome = { id: m.id, seed: m.seed, time: m.time };
        break;
      case 'inventory':
        this.equipment = m.equipment;
        this.items = m.items;
        this.onInventory();
        break;
      case 'error':
        if (!this.welcome) this.failure = m.message;
        this.onError(m.message);
        break;
      case 'snapshot':
        this.snapshot(m);
        break;
    }
  }

  private snapshot(m: Extract<ServerMsg, { t: 'snapshot' }>): void {
    this.serverTime = m.time;
    const gap = m.time - this.clock;
    this.clock += Math.abs(gap) > CLOCK_SNAP ? gap : gap * CLOCK_PULL;
    const seen = this.seen;
    seen.clear();
    for (const e of m.entities) {
      seen.add(e.id);
      // appearance and equipment only come when the entity enters our area or they change
      const known = this.entities.get(e.id);
      if (known) {
        e.appearance ??= known.appearance;
        e.equipment ??= known.equipment;
      }
      this.entities.set(e.id, e);
      let h = this.history.get(e.id);
      if (!h) this.history.set(e.id, (h = []));
      const s = h.length >= HISTORY ? h.shift()! : { time: 0, x: 0, z: 0, yaw: 0 };
      s.time = m.time;
      s.x = e.x;
      s.z = e.z;
      s.yaw = e.yaw;
      h.push(s);
    }
    // missing entities left our area (or the world): a later return arrives as a new entity
    for (const id of this.entities.keys()) {
      if (!seen.has(id)) {
        this.entities.delete(id);
        this.history.delete(id);
      }
    }
    this.reconcile(m.ack, m.you);
    for (const e of m.events) this.onEvent(e);
  }

  /** Re-bases the prediction on the server's state at `ack` and replays the inputs it has not simulated yet. */
  private reconcile(ack: number, you: SelfState): void {
    const me = this.me;
    if (!me) return;
    let settled = 0;
    while (settled < this.pending.length && this.pending[settled].seq <= ack) settled++;
    if (settled) this.pending.splice(0, settled);
    const m = this.motion;
    const bx = m.x;
    const bz = m.z;
    const byaw = m.yaw;
    m.x = me.x;
    m.z = me.z;
    m.yaw = me.yaw;
    m.swing = you.swing;
    m.stun = you.stun;
    m.dead = you.dead;
    if (this.collision) for (const p of this.pending) stepPlayer(this.collision, m, p, TICK_DT);
    const dx = m.x - bx;
    const dz = m.z - bz;
    const err = Math.hypot(dx, dz);
    this.lastCorrection = err;
    if (err < DEADBAND && Math.abs(wrapAngle(m.yaw - byaw)) < DEADBAND) {
      // the server sends positions to the centimeter: within that, keep our own exact prediction
      m.x = bx;
      m.z = bz;
      m.yaw = byaw;
    } else if (err < SNAP_DISTANCE) {
      // a real correction: shift the interpolation and blend the jump out over a few frames
      this.prev.x += dx;
      this.prev.z += dz;
      this.blend.x -= dx;
      this.blend.z -= dz;
    } else {
      // teleport or respawn
      this.prev.x = m.x;
      this.prev.z = m.z;
      this.prev.yaw = m.yaw;
      this.blend.x = this.blend.z = 0;
    }
  }
}
