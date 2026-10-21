import * as THREE from 'three';
import type { Obstacle } from '@shared/world/worldgen';

export type ViewMode = '3p' | '1p';

/** What the camera collides with: the ground and the world's vertical blockers (trunks, rocks). */
export interface CameraWorld {
  height: (x: number, z: number) => number;
  obstacles: readonly Obstacle[];
}

/** The rig in numbers (meters, radians, degrees for the field of view). */
export const RIG = {
  /** Pivot height over the feet (about the eyes of a 1.8 m hero). */
  height: 1.6,
  /** Shoulder offset to the right, and the distance behind, in landscape. */
  side: 0.45,
  back: 2.6,
  /** Portrait screens: a little farther and closer to the center (the character must fit). */
  sidePortrait: 0.28,
  backPortrait: 3.2,
  pitchMin3p: -1.1,
  pitchMax3p: 0.75,
  pitchMin1p: -1.35,
  pitchMax1p: 1.3,
  /** Vertical field of view in landscape; portrait widens it to keep a minimum horizontal one. */
  fov3p: 55,
  fov1p: 68,
  minHfov3p: 56,
  minHfov1p: 66,
  maxFov: 82,
  /** The camera is a sphere of this radius for collisions; it keeps this far over the ground. */
  probe: 0.2,
  ground: 0.3,
  /** 1/s: how fast the camera eases back out after an obstacle (it snaps in at once). */
  outRate: 5,
  /** Seconds for a full 3rd <-> 1st person transition. */
  switchTime: 0.25,
};

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _want = new THREE.Vector3();
const _third = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * The over-the-shoulder camera with a center crosshair, and the first-person view.
 *
 * Third person: the camera orbits a pivot 1.6 m over the character's feet, shifted 0.45 m to its
 * right and 2.6 m back along the look direction (yaw and a clamped pitch). Whatever stands
 * between the pivot and that spot (ground, trunks, rocks, structures) pulls the camera in at once;
 * it eases back out when the way clears. First person: the camera sits at the eyes (a point the
 * game gives every frame, from the Head bone) with a wider field of view. Switching blends the
 * two over a quarter second.
 *
 * Angles: yaw follows the game's convention (the look direction is (sin yaw, ·, cos yaw)); pitch
 * is positive looking up.
 */
export class ShoulderCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.12;
  mode: ViewMode = '3p';
  /** 0 = third person, 1 = first person (eased while switching). */
  fp = 0;
  /** Current fraction of the wanted 3rd-person distance (pulled in by obstacles). */
  private reach = 1;
  private portrait = false;
  private aspect = 16 / 9;
  private readonly smoothPivot = new THREE.Vector3();
  private hasPivot = false;

  constructor(private readonly world: CameraWorld) {
    this.camera = new THREE.PerspectiveCamera(RIG.fov3p, 16 / 9, 0.05, 420);
    this.camera.name = 'ShoulderCamera';
  }

  /** Turns the view: `dx` radians to the right, `dy` radians down. */
  look(dx: number, dy: number): void {
    this.yaw = wrap(this.yaw - dx);
    this.pitch -= dy;
    this.clampPitch();
  }

  /** Sets the view directly (tests, spawn). */
  setLook(yaw: number, pitch: number): void {
    this.yaw = wrap(yaw);
    this.pitch = pitch;
    this.clampPitch();
  }

  setMode(mode: ViewMode, instant = false): void {
    this.mode = mode;
    if (instant) this.fp = mode === '1p' ? 1 : 0;
    this.clampPitch();
  }

  toggleMode(): void {
    this.setMode(this.mode === '1p' ? '3p' : '1p');
  }

  /** The horizontal look direction (where the character faces and walks "forward"). */
  get forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.portrait = this.aspect < 1;
    this.camera.aspect = this.aspect;
    this.applyFov();
  }

  /**
   * Places the camera for this frame. `feet` is the character's rendered position on the ground,
   * `eye` the first-person eye point in world space (null: derived from the feet).
   */
  update(dt: number, feet: THREE.Vector3, eye: THREE.Vector3 | null): void {
    // ease the 1st/3rd person blend
    const goal = this.mode === '1p' ? 1 : 0;
    const step = dt / RIG.switchTime;
    this.fp = goal > this.fp ? Math.min(goal, this.fp + step) : Math.max(goal, this.fp - step);
    const k = this.fp * this.fp * (3 - 2 * this.fp);
    this.applyFov();

    // the pivot follows the feet; its height is smoothed a little (steps on bumpy ground)
    _pivot.set(feet.x, feet.y + RIG.height, feet.z);
    if (!this.hasPivot || this.smoothPivot.distanceToSquared(_pivot) > 9) {
      this.smoothPivot.copy(_pivot);
      this.hasPivot = true;
    }
    this.smoothPivot.x = _pivot.x;
    this.smoothPivot.z = _pivot.z;
    this.smoothPivot.y += (_pivot.y - this.smoothPivot.y) * (1 - Math.exp(-dt * 14));
    const pivot = this.smoothPivot;

    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));

    // third person: shoulder spot, closer when looking up (the ground is behind the camera)
    const up = THREE.MathUtils.smoothstep(this.pitch, 0, RIG.pitchMax3p);
    const back = (this.portrait ? RIG.backPortrait : RIG.back) * (1 - 0.38 * up);
    const side = this.portrait ? RIG.sidePortrait : RIG.side;
    _want.copy(pivot).addScaledVector(_right, side).addScaledVector(_dir, -back);
    const free = this.clearance(pivot, _want);
    if (free < this.reach) this.reach = free;
    else this.reach += (free - this.reach) * (1 - Math.exp(-dt * RIG.outRate));
    _third.copy(pivot).lerp(_want, this.reach);

    // first person: the eyes
    const fpPos = eye ?? pivot;
    this.camera.position.copy(_third).lerp(fpPos, k);
    this.camera.near = k > 0.5 ? 0.04 : 0.08;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(_look.copy(this.camera.position).add(_dir));
    this.camera.updateMatrixWorld();
  }

  /**
   * How far (0..1) the camera can go along pivot -> want before it touches the ground or a
   * blocker, minus the probe radius.
   */
  private clearance(from: THREE.Vector3, to: THREE.Vector3): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return 1;
    let t = 1;
    // vertical cylinders (trunks, rocks) and oriented boxes (buildings), grown by the probe
    const a = dx * dx + dz * dz;
    for (const o of this.world.obstacles) {
      const fx = from.x - o.x;
      const fz = from.z - o.z;
      const reach = len + o.r + RIG.probe;
      if (fx * fx + fz * fz > reach * reach) continue;
      if (a < 1e-8) continue;
      const t0 = o.box ? boxEntry(o.box, fx, fz, dx, dz, RIG.probe) : circleEntry(o.r + RIG.probe, fx, fz, dx, dz, a);
      if (t0 < 0 || t0 >= t) continue;
      if (from.y + dy * t0 > o.top + RIG.probe) continue; // passes over it
      t = t0;
    }
    // the ground: march, then refine the first step under it
    const steps = 14;
    const below = (s: number) => from.y + dy * s < this.world.height(from.x + dx * s, from.z + dz * s) + RIG.ground;
    let prev = 0;
    for (let i = 1; i <= steps; i++) {
      const s = (i / steps) * t;
      if (below(s)) {
        let lo = prev;
        let hi = s;
        for (let j = 0; j < 6; j++) {
          const m = (lo + hi) / 2;
          if (below(m)) hi = m;
          else lo = m;
        }
        t = lo;
        break;
      }
      prev = s;
    }
    // keep the probe radius off whatever was hit
    if (t < 1) t = Math.max(0, t - RIG.probe / len);
    return t;
  }

  private clampPitch(): void {
    const fp = this.mode === '1p';
    this.pitch = THREE.MathUtils.clamp(this.pitch, fp ? RIG.pitchMin1p : RIG.pitchMin3p, fp ? RIG.pitchMax1p : RIG.pitchMax3p);
  }

  private applyFov(): void {
    const k = this.fp * this.fp * (3 - 2 * this.fp);
    const vfov = THREE.MathUtils.lerp(RIG.fov3p, RIG.fov1p, k);
    const minH = THREE.MathUtils.lerp(RIG.minHfov3p, RIG.minHfov1p, k);
    // the vertical field that gives the minimum horizontal one at this aspect
    const fromH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minH / 2)) / this.aspect));
    const fov = Math.min(RIG.maxFov, Math.max(vfov, fromH));
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/**
 * Where the segment from (fx, fz) (relative to a circle's center) along (dx, dz) enters a circle of
 * radius r, as a fraction of the segment; -1 when it misses or starts inside (hugging a trunk).
 */
function circleEntry(r: number, fx: number, fz: number, dx: number, dz: number, a: number): number {
  const c = fx * fx + fz * fz - r * r;
  if (c < 0) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

/**
 * The same for an oriented box grown by `grow` (slab test in the box frame; three.js rotation.y:
 * world (x, z) -> local (x cos - z sin, x sin + z cos)); -1 when it misses or starts inside.
 */
function boxEntry(box: { hw: number; hd: number; rot: number }, fx: number, fz: number, dx: number, dz: number, grow: number): number {
  const c = Math.cos(box.rot);
  const s = Math.sin(box.rot);
  const ox = fx * c - fz * s;
  const oz = fx * s + fz * c;
  const vx = dx * c - dz * s;
  const vz = dx * s + dz * c;
  const hx = box.hw + grow;
  const hz = box.hd + grow;
  if (Math.abs(ox) < hx && Math.abs(oz) < hz) return -1;
  // the two slabs, unrolled (called per obstacle per frame: no arrays)
  let lo = -Infinity;
  let hi = Infinity;
  if (Math.abs(vx) < 1e-9) {
    if (Math.abs(ox) >= hx) return -1;
  } else {
    const t1 = (-hx - ox) / vx;
    const t2 = (hx - ox) / vx;
    lo = Math.min(t1, t2);
    hi = Math.max(t1, t2);
  }
  if (Math.abs(vz) < 1e-9) {
    if (Math.abs(oz) >= hz) return -1;
  } else {
    const t1 = (-hz - oz) / vz;
    const t2 = (hz - oz) / vz;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  return lo <= hi && lo >= 0 ? lo : -1;
}

function wrap(a: number): number {
  const TAU = Math.PI * 2;
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}
