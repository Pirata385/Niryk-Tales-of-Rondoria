import type { Appearance } from '@shared/appearance';
import { TICK_DT } from '@shared/constants';
import { stepMovement } from '@shared/movement';
import type { ClientMsg, EntityState, Equipment, GameEvent, ServerMsg } from '@shared/protocol';
import type { CollisionWorld } from '@shared/world/collision';
import type { Transport } from '../net/Transport';

export interface Intent {
  mx: number;
  mz: number;
  run: boolean;
  attack: boolean;
  aim: number | null;
}

interface Sample {
  time: number;
  state: EntityState;
}

const INTERP_DELAY = 0.1; // s behind the newest snapshot for remote entities

/**
 * Client-side view of the game state: sends inputs at the server tick rate, predicts the local
 * player's movement (same code as the server) and reconciles with acknowledged snapshots;
 * other entities are interpolated between snapshots.
 */
export class GameClient {
  myId = -1;
  serverTime = 0;
  equipment: Equipment = { weapon: null, armor: null };
  items: string[] = [];
  readonly entities = new Map<number, EntityState>();
  private readonly history = new Map<number, Sample[]>();
  private seq = 0;
  private pending: (Intent & { seq: number })[] = [];
  private accumulator = 0;
  private attackQueued = false;
  /** Predicted own position (and the previous tick, for render interpolation). */
  predicted = { x: 0, z: 0, yaw: 0 };
  private prevPredicted = { x: 0, z: 0, yaw: 0 };
  private alpha = 0;
  onEvent: (e: GameEvent) => void = () => {};
  onInventory: () => void = () => {};
  onError: (m: string) => void = () => {};

  constructor(
    private readonly transport: Transport,
    private readonly collision: CollisionWorld,
  ) {
    transport.onMessage((m) => this.receive(m));
  }

  join(appearance: Appearance): void {
    this.transport.send({ t: 'join', appearance });
  }

  send(msg: ClientMsg): void {
    this.transport.send(msg);
  }

  /** A one-shot attack press (kept until the next input message). */
  pressAttack(): void {
    this.attackQueued = true;
  }

  get me(): EntityState | undefined {
    return this.entities.get(this.myId);
  }

  update(dt: number, intent: Intent): void {
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const msg = { ...intent, attack: intent.attack || this.attackQueued, seq: ++this.seq };
      this.attackQueued = false;
      this.transport.send({ t: 'input', seq: msg.seq, mx: msg.mx, mz: msg.mz, run: msg.run, attack: msg.attack, aim: msg.aim });
      this.pending.push(msg);
      this.prevPredicted = { ...this.predicted };
      this.predictStep(msg);
    }
    this.transport.update(dt);
    this.alpha = this.accumulator / TICK_DT;
  }

  /** Smoothed own position for rendering. */
  renderedSelf(): { x: number; z: number; yaw: number } {
    const a = this.alpha;
    const p = this.prevPredicted;
    const q = this.predicted;
    let dy = q.yaw - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return { x: p.x + (q.x - p.x) * a, z: p.z + (q.z - p.z) * a, yaw: p.yaw + dy * a };
  }

  private canPredictMove(): boolean {
    const me = this.me;
    if (!me) return false;
    return me.anim === 'Idle' || me.anim === 'Walk' || me.anim === 'Run';
  }

  private predictStep(input: Intent): void {
    if (!this.canPredictMove()) return;
    const r = stepMovement(this.collision, this.predicted, input, TICK_DT);
    this.predicted = { x: r.x, z: r.z, yaw: r.yaw };
  }

  /** Interpolated state of a remote entity at render time. */
  interpolated(id: number): { x: number; z: number; yaw: number } | null {
    const h = this.history.get(id);
    if (!h || h.length === 0) return null;
    const t = this.serverTime - INTERP_DELAY;
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
    let dy = b.state.yaw - a.state.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return { x: a.state.x + (b.state.x - a.state.x) * k, z: a.state.z + (b.state.z - a.state.z) * k, yaw: a.state.yaw + dy * k };
  }

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.serverTime = m.time;
        break;
      case 'inventory':
        this.equipment = m.equipment;
        this.items = m.items;
        this.onInventory();
        break;
      case 'error':
        this.onError(m.message);
        break;
      case 'snapshot': {
        this.serverTime = m.time;
        const seen = new Set<number>();
        for (const e of m.entities) {
          seen.add(e.id);
          this.entities.set(e.id, e);
          const h = this.history.get(e.id) ?? [];
          h.push({ time: m.time, state: e });
          while (h.length > 12) h.shift();
          this.history.set(e.id, h);
        }
        for (const id of [...this.entities.keys()]) {
          if (!seen.has(id)) {
            this.entities.delete(id);
            this.history.delete(id);
          }
        }
        this.reconcile(m.ack);
        for (const e of m.events) this.onEvent(e);
        break;
      }
    }
  }

  private reconcile(ack: number): void {
    const me = this.me;
    if (!me) return;
    this.pending = this.pending.filter((p) => p.seq > ack);
    const before = { ...this.predicted };
    this.predicted = { x: me.x, z: me.z, yaw: me.yaw };
    for (const p of this.pending) this.predictStep(p);
    // tiny corrections are smoothed by moving the previous frame too (no visible snap)
    const dx = this.predicted.x - before.x;
    const dz = this.predicted.z - before.z;
    if (Math.hypot(dx, dz) < 0.5) {
      this.prevPredicted.x += dx;
      this.prevPredicted.z += dz;
    } else {
      this.prevPredicted = { ...this.predicted };
    }
  }
}
