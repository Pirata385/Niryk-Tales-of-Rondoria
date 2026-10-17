/** Static colliders (circles and oriented boxes) in a grid, and circle movement that slides. */

export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  kind: 'box';
  x: number;
  z: number;
  /** Half extents along the box's local X/Z. */
  hw: number;
  hd: number;
  /** Rotation around Y (radians), same convention as three.js rotation.y. */
  rot: number;
}

export type Collider = CircleCollider | BoxCollider;

const CELL = 4;
const NO_COLLIDERS: readonly number[] = [];
/** Scratch result of pushOut / resolveInto (single-threaded, read right after the call). */
const OUT = { x: 0, z: 0 };

export class CollisionWorld {
  /** Grid cell -> indices into `list`. */
  private cells = new Map<number, number[]>();
  private readonly list: Collider[] = [];
  /** Query stamps per collider (dedupes colliders spanning several cells without a Set). */
  private stamps = new Uint32Array(64);
  private stamp = 0;
  private readonly found: Collider[] = [];

  constructor(
    colliders: Collider[],
    readonly half: number,
  ) {
    for (const c of colliders) this.add(c);
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(c: Collider): void {
    const index = this.list.length;
    this.list.push(c);
    if (index >= this.stamps.length) {
      const grown = new Uint32Array(this.stamps.length * 2);
      grown.set(this.stamps);
      this.stamps = grown;
    }
    const ext = c.kind === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    for (let ix = Math.floor((c.x - ext) / CELL); ix <= Math.floor((c.x + ext) / CELL); ix++) {
      for (let iz = Math.floor((c.z - ext) / CELL); iz <= Math.floor((c.z + ext) / CELL); iz++) {
        const k = this.key(ix, iz);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(index);
      }
    }
  }

  /**
   * Colliders in the grid cells around (x, z) within r. Allocation-free: the returned array is
   * reused by the next query on this world, so iterate it right away and do not keep it.
   */
  nearby(x: number, z: number, r: number): readonly Collider[] {
    const out = this.found;
    out.length = 0;
    if (++this.stamp >= 0xffffffff) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const cell = this.cells.get(this.key(ix, iz)) ?? NO_COLLIDERS;
        for (let i = 0; i < cell.length; i++) {
          const index = cell[i];
          if (this.stamps[index] === stamp) continue;
          this.stamps[index] = stamp;
          out.push(this.list[index]);
        }
      }
    }
    return out;
  }

  /** Pushes a circle out of every overlapping collider; returns the corrected position. */
  resolve(x: number, z: number, r: number): [number, number] {
    this.resolveInto(x, z, r);
    return [OUT.x, OUT.z];
  }

  /** Moves a circle by (dx, dz) in sub-steps, sliding along obstacles. */
  move(x: number, z: number, r: number, dx: number, dz: number): [number, number] {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    for (let i = 0; i < steps; i++) {
      this.resolveInto(x + dx / steps, z + dz / steps, r);
      x = OUT.x;
      z = OUT.z;
    }
    return [x, z];
  }

  blocked(x: number, z: number, r: number): boolean {
    const list = this.nearby(x, z, r + 0.5);
    for (let i = 0; i < list.length; i++) if (pushOut(list[i], x, z, r)) return true;
    return false;
  }

  /** `resolve` without allocating: the result goes to OUT. */
  private resolveInto(x: number, z: number, r: number): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const list = this.nearby(x, z, r + 0.5);
      for (let i = 0; i < list.length; i++) {
        if (pushOut(list[i], x, z, r)) {
          x = OUT.x;
          z = OUT.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
    const lim = this.half - r;
    OUT.x = Math.max(-lim, Math.min(lim, x));
    OUT.z = Math.max(-lim, Math.min(lim, z));
  }
}

/** If the circle overlaps `c`, writes the pushed-out center to OUT and returns true. */
function pushOut(c: Collider, x: number, z: number, r: number): boolean {
  if (c.kind === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d >= min) return false;
    if (d < 1e-6) {
      OUT.x = c.x + min;
      OUT.z = c.z;
    } else {
      OUT.x = c.x + (dx / d) * min;
      OUT.z = c.z + (dz / d) * min;
    }
    return true;
  }
  // box: work in the box frame (three.js rotation.y maps local (x, z) to world (x cos + z sin, -x sin + z cos))
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const wx = x - c.x;
  const wz = z - c.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  const cx = Math.max(-c.hw, Math.min(c.hw, lx));
  const cz = Math.max(-c.hd, Math.min(c.hd, lz));
  const nx = lx - cx;
  const nz = lz - cz;
  const d = Math.hypot(nx, nz);
  let px: number;
  let pz: number;
  if (d > 1e-6) {
    if (d >= r) return false;
    px = cx + (nx / d) * r;
    pz = cz + (nz / d) * r;
  } else {
    // center inside the box: push out through the nearest face
    const ex = c.hw - Math.abs(lx);
    const ez = c.hd - Math.abs(lz);
    if (ex < ez) {
      px = Math.sign(lx || 1) * (c.hw + r);
      pz = lz;
    } else {
      px = lx;
      pz = Math.sign(lz || 1) * (c.hd + r);
    }
  }
  OUT.x = c.x + px * cos + pz * sin;
  OUT.z = c.z - px * sin + pz * cos;
  return true;
}
