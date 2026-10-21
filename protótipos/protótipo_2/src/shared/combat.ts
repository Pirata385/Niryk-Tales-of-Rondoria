import { ATTACKS, WOLF } from './constants';
import { wrapAngle } from './movement';

/** Aim assist: how far (rad) from the crosshair a wolf may be and still pull the swing to it. */
export const ASSIST_ANGLE = (25 * Math.PI) / 180;
/** ...and how far away (m, center to center): the longer swing's reach, the wolf's body and a step. */
export const ASSIST_RANGE = Math.max(ATTACKS.Attack1.range, ATTACKS.Attack2.range) + WOLF.radius + 0.8;

export interface AssistTarget {
  x: number;
  z: number;
  hp: number;
}

/**
 * The yaw a melee swing goes toward: the crosshair's `aim`, or, when a living target stands within
 * ASSIST_ANGLE of it and ASSIST_RANGE of (x, z), straight at that target (the one nearest the
 * crosshair, closer ones winning ties). A target practically on top of the player (closer than
 * 0.3 m) is ignored: its bearing is noise. Pure: client and tests share it.
 */
export function assistAim(aim: number, x: number, z: number, targets: Iterable<AssistTarget>, maxAngle = ASSIST_ANGLE, range = ASSIST_RANGE): number {
  let best = aim;
  let bestScore = Infinity;
  for (const t of targets) {
    if (t.hp <= 0) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 0.3) continue;
    const bearing = Math.atan2(dx, dz);
    const off = Math.abs(wrapAngle(bearing - aim));
    if (off > maxAngle) continue;
    const score = off / maxAngle + (d / range) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = bearing;
    }
  }
  return best;
}
