/** Game rules shared by the client (prediction, UI) and the authoritative server. */

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

/** Movement speeds in m/s — the baked Walk/Run clips are authored for exactly these. */
export const WALK_SPEED = 1.9;
export const RUN_SPEED = 5.0;
export const PLAYER_RADIUS = 0.32;
export const TURN_RATE = 14; // rad/s toward the movement direction

export const PLAYER_HP = 100;
export const PLAYER_REGEN = 4; // hp/s when out of combat
export const OUT_OF_COMBAT = 6; // s without dealing/taking damage
export const RESPAWN_DELAY = 3;

/** Sword combo: two swings; the second must be pressed within the chain window of the first. */
export const ATTACKS = {
  Attack1: { duration: 0.5, hit: 0.2, range: 1.9, arc: 120, mult: 1.0, chainFrom: 0.22, chainTo: 0.5 },
  Attack2: { duration: 0.55, hit: 0.24, range: 2.0, arc: 140, mult: 1.25, chainFrom: 0, chainTo: 0 },
} as const;
export const UNARMED_DAMAGE: [number, number] = [4, 6];
/** While attacking the player still drifts a little forward. */
export const ATTACK_MOVE_SPEED = 0.6;

export const HIT_STUN = 0.36;

export const WOLF = {
  hp: 60,
  radius: 0.45,
  walkSpeed: 2.0,
  runSpeed: 6.5,
  aggroRange: 9,
  leashRange: 25,
  attackRange: 1.6,
  windup: 0.42, // the bite lands this long after the attack starts (baked clip)
  attackDuration: 0.75,
  attackCooldown: 1.4,
  damage: [8, 12] as [number, number],
  respawn: 30,
  maxAlive: 12,
  wanderRadius: 7,
};

export const WORLD_SIZE = 200;
export const VILLAGE_RADIUS = 30;
export const WOLF_MIN_VILLAGE_DIST = 40;

/** Each player only hears about entities (and their events) within this distance (m). */
export const INTEREST_RADIUS = 30;
/** Hysteresis: an entity already known is dropped only beyond INTEREST_RADIUS + this (no flicker at the edge). */
export const INTEREST_SLACK = 2;
/** Snapshot precision: positions travel to 1/NET_PRECISION m, angles to 1/NET_PRECISION rad. */
export const NET_PRECISION = 100;
/** Inputs buffered per player on the server (one is simulated per tick; the oldest drop beyond this). */
export const INPUT_QUEUE_MAX = 10;
/** Equip requests: a burst of EQUIP_BURST, then EQUIP_RATE per second. */
export const EQUIP_BURST = 4;
export const EQUIP_RATE = 3;
