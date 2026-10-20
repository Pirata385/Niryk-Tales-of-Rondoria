import {
  AIM_TURN_RATE, ATTACKS, ATTACK_MOVE_SPEED, BACKPEDAL_FACTOR, PLAYER_RADIUS, RUN_MIN_FORWARD, RUN_SPEED, TURN_RATE, WALK_SPEED,
} from './constants';
import type { CollisionWorld } from './world/collision';

export type AttackName = keyof typeof ATTACKS;

export interface MoveInput {
  mx: number;
  mz: number;
  run: boolean;
  /**
   * Where the player aims (radians, world yaw: the camera's yaw), or null. With an aim the body
   * faces it and the movement is relative to it (strafe, back-pedal); without one the body turns
   * toward the movement.
   */
  aim: number | null;
}

/** One tick of player intent, as the client sends it (both sides run it through `sanitizeInput`). */
export interface PlayerInput extends MoveInput {
  /** Attack pressed during this tick (the swing goes toward `aim`, or where the player faces). */
  attack: boolean;
}

/** Any shape at all: what arrives from a client is untrusted. */
export interface RawInput {
  mx?: unknown;
  mz?: unknown;
  run?: unknown;
  attack?: unknown;
  aim?: unknown;
}

/**
 * The one reading of an input that the server simulates and the client predicts with, so both
 * step exactly the same numbers: mx/mz clamped to [-1, 1] and the vector shortened to length ≤ 1,
 * non-finite numbers zeroed, the aim wrapped to [-π, π] (null when missing or not finite), flags
 * strictly boolean. Idempotent: the server re-reading what an honest client sent changes nothing.
 * Writes into `out` and returns it.
 */
export function sanitizeInput<T extends PlayerInput>(raw: RawInput, out: T): T {
  let mx = clampUnit(raw.mx);
  let mz = clampUnit(raw.mz);
  const len = Math.hypot(mx, mz);
  // the tolerance keeps it idempotent: a normalized vector may measure 1 + a few ulps
  if (len > 1 + 1e-9) {
    mx /= len;
    mz /= len;
  }
  out.mx = mx;
  out.mz = mz;
  out.run = raw.run === true;
  out.attack = raw.attack === true;
  // % first: exact at any magnitude (wrapAngle alone drifts outside [-π, π] for huge values);
  // it leaves an aim already in [-π, π] untouched
  out.aim = typeof raw.aim === 'number' && Number.isFinite(raw.aim) ? wrapAngle(raw.aim % (Math.PI * 2)) : null;
  return out;
}

function clampUnit(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
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
  /** ...and it was a run (forward-ish with the run modifier). */
  running: boolean;
}

/**
 * One fixed tick of a player, shared by the server simulation and the client prediction so both
 * land on exactly the same state: attack press (start or combo queue), swing timing with its small
 * forward drift, hit stun, then walking/running. Swinging and stun block movement. Mutates `s`.
 */
export function stepPlayer(world: CollisionWorld, s: PlayerMotion, input: PlayerInput, dt: number): StepResult {
  const r: StepResult = { started: null, hit: null, moving: false, running: false };
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
  r.running = m.running;
  return r;
}

function startSwing(s: PlayerMotion, name: AttackName, aim: number | null): void {
  if (aim !== null) s.yaw = aim;
  s.swing = { name, t: 0, hit: false, queued: false, queuedAim: null };
}

/**
 * One movement step for a player (part of `stepPlayer`). Only the direction of the intent vector
 * matters. With an aim (the camera's yaw) the body turns quickly to face it whether moving or not,
 * and the speed depends on the movement relative to it: running only forward-ish, strafing at
 * walking pace, back-pedaling slower. Without an aim the body turns toward the movement.
 */
export function stepMovement(world: CollisionWorld, s: MoveState, input: MoveInput, dt: number): MoveState & { moving: boolean; running: boolean } {
  const { mx, mz, aim } = input;
  let yaw = aim === null ? s.yaw : turnToward(s.yaw, aim, AIM_TURN_RATE * dt);
  const len = Math.hypot(mx, mz);
  if (len < 0.15) return { x: s.x, z: s.z, yaw, moving: false, running: false };
  const dx = mx / len;
  const dz = mz / len;
  let speed: number;
  if (aim === null) {
    // always the full walk/run speed: the baked clips match exactly these speeds (no foot sliding)
    speed = input.run ? RUN_SPEED : WALK_SPEED;
    yaw = turnToward(yaw, Math.atan2(mx, mz), TURN_RATE * dt);
  } else {
    // cos of the angle between the movement and the aim (the intended facing, not the turning body)
    const forward = dx * Math.sin(aim) + dz * Math.cos(aim);
    speed = input.run && forward >= RUN_MIN_FORWARD ? RUN_SPEED : WALK_SPEED;
    if (forward < 0) speed *= 1 - (1 - BACKPEDAL_FACTOR) * -forward;
  }
  const [x, z] = world.move(s.x, s.z, PLAYER_RADIUS, dx * speed * dt, dz * speed * dt);
  return { x, z, yaw, moving: true, running: speed === RUN_SPEED };
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
