/**
 * Messages between client and server. Today they travel through LocalTransport (in-process,
 * cloned like a network would); later the same objects go over a WebSocket as JSON.
 */
import type { Appearance } from './appearance';
import type { EquipSlot } from './items';

export type EntityKind = 'player' | 'wolf';
export type EntityAnim = 'Idle' | 'Walk' | 'Run' | 'Attack1' | 'Attack2' | 'Attack' | 'Hit' | 'Death';

export interface Equipment {
  weapon: string | null;
  armor: string | null;
}

/** Client → server. */
export type ClientMsg =
  | { t: 'join'; appearance: Appearance }
  /** Movement intent (world XZ, length ≤ 1), run modifier, attack press and aim (radians). */
  | { t: 'input'; seq: number; mx: number; mz: number; run: boolean; attack: boolean; aim: number | null }
  | { t: 'equip'; slot: EquipSlot; item: string | null }
  | { t: 'respawn' };

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
  name?: string;
  appearance?: Appearance;
  equipment?: Equipment;
  /** Wolves: about to bite (telegraph ring). */
  telegraph?: boolean;
}

export type GameEvent =
  | { e: 'damage'; target: number; source: number; amount: number; x: number; z: number; crit?: boolean }
  | { e: 'death'; id: number }
  | { e: 'respawn'; id: number }
  | { e: 'swing'; id: number; anim: EntityAnim };

/** Server → client. */
export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; time: number }
  | { t: 'snapshot'; time: number; ack: number; entities: EntityState[]; events: GameEvent[] }
  | { t: 'inventory'; equipment: Equipment; items: string[] }
  | { t: 'error'; message: string };
