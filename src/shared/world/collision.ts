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

export class CollisionWorld {
  private cells = new Map<number, Collider[]>();

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
    const ext = c.kind === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    for (let ix = Math.floor((c.x - ext) / CELL); ix <= Math.floor((c.x + ext) / CELL); ix++) {
      for (let iz = Math.floor((c.z - ext) / CELL); iz <= Math.floor((c.z + ext) / CELL); iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
  }

  nearby(x: number, z: number, r: number): Collider[] {
    const out = new Set<Collider>();
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        for (const c of this.cells.get(this.key(ix, iz)) ?? []) out.add(c);
      }
    }
    return [...out];
  }

  /** Pushes a circle out of every overlapping collider; returns the corrected position. */
  resolve(x: number, z: number, r: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.nearby(x, z, r + 0.5)) {
        const p = pushOut(c, x, z, r);
        if (p) {
          x = p[0];
          z = p[1];
          moved = true;
        }
      }
      if (!moved) break;
    }
    const lim = this.half - r;
    return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
  }

  /** Moves a circle by (dx, dz) in sub-steps, sliding along obstacles. */
  move(x: number, z: number, r: number, dx: number, dz: number): [number, number] {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    for (let i = 0; i < steps; i++) [x, z] = this.resolve(x + dx / steps, z + dz / steps, r);
    return [x, z];
  }

  blocked(x: number, z: number, r: number): boolean {
    return this.nearby(x, z, r + 0.5).some((c) => pushOut(c, x, z, r) !== null);
  }
}

function pushOut(c: Collider, x: number, z: number, r: number): [number, number] | null {
  if (c.kind === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d >= min) return null;
    if (d < 1e-6) return [c.x + min, c.z];
    return [c.x + (dx / d) * min, c.z + (dz / d) * min];
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
    if (d >= r) return null;
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
  return [c.x + px * cos + pz * sin, c.z - px * sin + pz * cos];
}
