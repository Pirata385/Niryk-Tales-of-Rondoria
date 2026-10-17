import { ATTACKS, ATTACK_MOVE_SPEED, PLAYER_RADIUS, RUN_SPEED, TURN_RATE, WALK_SPEED } from './constants';
import type { CollisionWorld } from './world/collision';

export type AttackName = keyof typeof ATTACKS;

export interface MoveInput {
  mx: number;
  mz: number;
  run: boolean;
}

/** One tick of player intent, as the client sends it (the server sanitizes it first). */
export interface PlayerInput extends MoveInput {
  /** Attack pressed during this tick. */
  attack: boolean;
  /** Aim of that press (radians, world yaw), or null to swing where the player faces. */
  aim: number | null;
}

export interface MoveState {
  x: number;
  z: number;
  yaw: number;
}

/** A sword swing in progress. */
export interface Swing {
  name: AttackName;
  /** Seconds since the swing started. */
  t: number;
  /** The hit frame was reached (damage resolved once). */
  hit: boolean;
  /** The combo follow-up was pressed in the chain window; it starts when this swing ends. */
  queued: boolean;
  /** Aim of the follow-up press. */
  queuedAim: number | null;
}

/**
 * Everything one player step reads and writes. The server owns the authoritative copy; the client
 * predicts its own with the same `stepPlayer` and re-bases it on the server's at every ack.
 */
export interface PlayerMotion extends MoveState {
  swing: Swing | null;
  /** Hit stun left (s): set by the server when a bite lands, counts down here. */
  stun: number;
  dead: boolean;
}

export interface StepResult {
  /** A swing started during this step (Attack1 from a press, Attack2 from a queued combo). */
  started: AttackName | null;
  /** The current swing reached its hit frame during this step (the server resolves the damage). */
  hit: AttackName | null;
  /** The player walked or ran (locomotion animation). */
  moving: boolean;
}

/**
 * One fixed tick of a player, shared by the server simulation and the client prediction so both
 * land on exactly the same state: attack press (start or combo queue), swing timing with its small
 * forward drift, hit stun, then walking/running. Swinging and stun block movement. Mutates `s`.
 */
export function stepPlayer(world: CollisionWorld, s: PlayerMotion, input: PlayerInput, dt: number): StepResult {
  const r: StepResult = { started: null, hit: null, moving: false };
  if (s.dead) return r;
  if (s.stun > 0) s.stun = Math.max(0, s.stun - dt);
  const stunned = s.stun > 0;

  if (input.attack && !stunned) {
    if (!s.swing) {
      startSwing(s, 'Attack1', input.aim);
      r.started = 'Attack1';
    } else {
      const def = ATTACKS[s.swing.name];
      if (s.swing.name === 'Attack1' && s.swing.t >= def.chainFrom && s.swing.t <= def.chainTo) {
        s.swing.queued = true;
        s.swing.queuedAim = input.aim;
      }
    }
  }

  const sw = s.swing;
  if (sw) {
    const def = ATTACKS[sw.name];
    sw.t += dt;
    if (!sw.hit && sw.t >= def.hit) {
      sw.hit = true;
      r.hit = sw.name;
    }
    // a slight forward drift while swinging
    const step = ATTACK_MOVE_SPEED * dt;
    [s.x, s.z] = world.move(s.x, s.z, PLAYER_RADIUS, Math.sin(s.yaw) * step, Math.cos(s.yaw) * step);
    if (sw.t >= def.duration) {
      s.swing = null;
      if (sw.queued) {
        startSwing(s, 'Attack2', sw.queuedAim);
        r.started = 'Attack2';
      }
    }
    if (s.swing) return r;
  }
  if (stunned) return r;

  const m = stepMovement(world, s, input, dt);
  s.x = m.x;
  s.z = m.z;
  s.yaw = m.yaw;
  r.moving = m.moving;
  return r;
}

function startSwing(s: PlayerMotion, name: AttackName, aim: number | null): void {
  if (aim !== null) s.yaw = aim;
  s.swing = { name, t: 0, hit: false, queued: false, queuedAim: null };
}

/**
 * One movement step for a player (part of `stepPlayer`).
 * Only the direction of the intent vector matters; yaw turns smoothly toward the movement.
 */
export function stepMovement(world: CollisionWorld, s: MoveState, input: MoveInput, dt: number): MoveState & { moving: boolean } {
  const mx = input.mx;
  const mz = input.mz;
  const len = Math.hypot(mx, mz);
  if (len < 0.15) return { x: s.x, z: s.z, yaw: s.yaw, moving: false };
  // always the full walk/run speed: the baked clips match exactly these speeds (no foot sliding)
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const [x, z] = world.move(s.x, s.z, PLAYER_RADIUS, (mx / len) * speed * dt, (mz / len) * speed * dt);
  const yaw = turnToward(s.yaw, Math.atan2(mx, mz), TURN_RATE * dt);
  return { x, z, yaw, moving: true };
}

export function turnToward(yaw: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - yaw);
  if (Math.abs(d) <= maxStep) return target;
  return yaw + Math.sign(d) * maxStep;
}

/** The same angle in [-π, π] (no loop: safe for any finite input). */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}
