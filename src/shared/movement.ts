import { PLAYER_RADIUS, RUN_SPEED, TURN_RATE, WALK_SPEED } from './constants';
import type { CollisionWorld } from './world/collision';

export interface MoveInput {
  mx: number;
  mz: number;
  run: boolean;
}

export interface MoveState {
  x: number;
  z: number;
  yaw: number;
}

/**
 * One movement step for a player (server simulation and client prediction run the same code).
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
  let d = target - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return yaw + Math.sign(d) * maxStep;
}
