/**
 * Messages between client and server. Today they travel through LocalTransport (in-process,
 * cloned like a network would); later the same objects go over a WebSocket as JSON.
 */
import type { Appearance } from './appearance';
import { NET_PRECISION } from './constants';
import type { EquipSlot } from './items';
import { wrapAngle, type Swing } from './movement';

export type EntityKind = 'player' | 'wolf';
export type EntityAnim = 'Idle' | 'Walk' | 'Run' | 'Attack1' | 'Attack2' | 'Attack' | 'Hit' | 'Death';

export interface Equipment {
  weapon: string | null;
  armor: string | null;
}

/** Client → server. */
export type ClientMsg =
  | { t: 'join'; appearance: Appearance }
  /**
   * One per client tick (20 Hz), seq strictly increasing: movement intent (world XZ, length ≤ 1),
   * run modifier, attack press and its aim (radians).
   */
  | { t: 'input'; seq: number; mx: number; mz: number; run: boolean; attack: boolean; aim: number | null }
  | { t: 'equip'; slot: EquipSlot; item: string | null }
  | { t: 'respawn' };

/**
 * An entity near the receiving player. x, z and yaw are quantized (see `quantize`). `appearance`
 * and `equipment` are only present when the entity comes into view or they change: clients keep
 * the last ones they were given.
 */
export interface EntityState {
  id: number;
  kind: EntityKind;
  x: number;
  z: number;
  yaw: number;
  anim: EntityAnim;
  /** Server time (s) when `anim` started — lets clients sync one-shot clips. */
  animStart: number;
  hp: number;
  maxHp: number;
  appearance?: Appearance;
  equipment?: Equipment;
  /** Wolves: about to bite (telegraph ring). */
  telegraph?: boolean;
}

/**
 * The receiving player's own step state after the acknowledged input. With its entity's x, z
 * and yaw it is what client prediction replays the unacknowledged inputs from.
 */
export interface SelfState {
  swing: Swing | null;
  stun: number;
  dead: boolean;
}

export type GameEvent =
  | { e: 'damage'; target: number; source: number; amount: number; x: number; z: number; crit?: boolean }
  | { e: 'death'; id: number }
  | { e: 'respawn'; id: number }
  | { e: 'swing'; id: number; anim: EntityAnim };

/** Server → client. */
export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; time: number }
  /**
   * Every tick: the entities within the player's interest radius (an entity missing from it has
   * left), their events, and `ack`, the seq of the last input the server simulated.
   */
  | { t: 'snapshot'; time: number; ack: number; entities: EntityState[]; events: GameEvent[]; you: SelfState }
  | { t: 'inventory'; equipment: Equipment; items: string[] }
  | { t: 'error'; message: string };

/** A position for the wire (1/NET_PRECISION m). */
export function quantize(v: number): number {
  return Math.round(v * NET_PRECISION) / NET_PRECISION;
}

/** An angle for the wire: wrapped to [-π, π] and rounded to 1/NET_PRECISION rad. */
export function quantizeAngle(a: number): number {
  return Math.round(wrapAngle(a) * NET_PRECISION) / NET_PRECISION;
}
