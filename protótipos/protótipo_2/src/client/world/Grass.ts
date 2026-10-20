import * as THREE from 'three';
import { Rng, hashSeed } from '@shared/math/random';
import { NATURE, assetsOfKind } from '@shared/world/natureCatalog';
import type { WorldData } from '@shared/world/worldgen';
import { addOutline } from '../render/outline';
import { natureModel, type NatureModel } from './natureModels';

/** Grass and flower clumps per m² where the world's density is 1. */
const GRASS_PER_M2 = 2.4;
const FLOWERS_PER_M2 = 0.9;
const CELL = 4;

interface Tuft {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

/** Tufts of one cell, per asset. */
type Cell = Map<string, Tuft[]>;

interface AssetMeshes {
  name: string;
  meshes: { mesh: THREE.InstancedMesh; hull: THREE.InstancedMesh; matrix: THREE.Matrix4 }[];
}

export interface GrassOptions {
  /** Radius around the player with grass (m). */
  radius: number;
  /** Instances per asset at most. */
  capacity: number;
  /** Radius with ink outlines (m). */
  inkRadius: number;
}

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Grass tufts and flower clumps around the player, in large numbers: scattered per 4 m cell from
 * the world's density maps (deterministic for the seed and the cell), instanced per asset, swaying
 * in the wind. Refilled as the player moves; instances shrink into the ground toward the edge of
 * the radius so nothing pops, and only the nearest get ink outlines.
 */
export class Grass {
  readonly group = new THREE.Group();
  private readonly cells = new Map<number, Cell>();
  private readonly assets: AssetMeshes[] = [];
  private last = new THREE.Vector2(Infinity, Infinity);
  drawn = 0;

  private constructor(
    private readonly world: WorldData,
    private readonly opts: GrassOptions,
    private readonly grassNames: string[],
    private readonly flowerNames: string[],
  ) {
    this.group.name = 'Grass';
  }

  static async create(world: WorldData, opts: GrassOptions): Promise<Grass> {
    const grass = assetsOfKind('grass');
    const flowers = assetsOfKind('flowers');
    const g = new Grass(world, opts, grass, flowers);
    const models = await Promise.all([...grass, ...flowers].map((n) => natureModel(n)));
    for (const m of models) g.addAsset(m);
    return g;
  }

  private addAsset(model: NatureModel): void {
    const meshes = model.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.opts.capacity);
      mesh.name = `${model.name}_${part.material.name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      const hull = addOutline(mesh, { wind: part.wind, width: 0.55 }) as THREE.InstancedMesh;
      hull.frustumCulled = false;
      hull.count = 0;
      this.group.add(mesh);
      return { mesh, hull, matrix: part.matrix };
    });
    this.assets.push({ name: model.name, meshes });
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  private cell(ix: number, iz: number): Cell {
    const k = this.key(ix, iz);
    let c = this.cells.get(k);
    if (c) return c;
    c = new Map();
    const w = this.world;
    const rng = new Rng(hashSeed(w.seed, `grass:${ix},${iz}`));
    const add = (name: string, x: number, z: number) => {
      const a = NATURE[name];
      let list = c!.get(name);
      if (!list) c!.set(name, (list = []));
      list.push({ x, y: w.height(x, z) - 0.02, z, scale: rng.range(a.scale[0], a.scale[1]), rot: rng.range(-Math.PI, Math.PI) });
    };
    const x0 = ix * CELL;
    const z0 = iz * CELL;
    if (this.grassNames.length) {
      for (let i = Math.round(CELL * CELL * GRASS_PER_M2); i > 0; i--) {
        const x = x0 + rng.next() * CELL;
        const z = z0 + rng.next() * CELL;
        const pick = rng.pick(this.grassNames);
        if (rng.next() < w.grass(x, z)) add(pick, x, z);
      }
    }
    if (this.flowerNames.length) {
      // one flower kind per patch: the cell's kind, with a few strays
      const main = this.flowerNames[Math.floor(rng.next() * this.flowerNames.length)];
      for (let i = Math.round(CELL * CELL * FLOWERS_PER_M2); i > 0; i--) {
        const x = x0 + rng.next() * CELL;
        const z = z0 + rng.next() * CELL;
        const pick = rng.chance(0.8) ? main : rng.pick(this.flowerNames);
        if (rng.next() < w.flowers(x, z)) add(pick, x, z);
      }
    }
    // keep the cache bounded: forget cells far away
    if (this.cells.size > 2500) this.cells.clear();
    this.cells.set(k, c);
    return c;
  }

  /** Refills the instances when the player has moved enough. */
  update(player: THREE.Vector3): void {
    if (Math.hypot(player.x - this.last.x, player.z - this.last.y) < 1.5) return;
    this.last.set(player.x, player.z);
    const R = this.opts.radius;
    const cells: [number, number, number][] = [];
    const r = Math.ceil(R / CELL);
    const cx = Math.floor(player.x / CELL);
    const cz = Math.floor(player.z / CELL);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        const d = Math.hypot((i + 0.5) * CELL - player.x, (j + 0.5) * CELL - player.z);
        if (d < R + CELL) cells.push([i, j, d]);
      }
    }
    cells.sort((a, b) => a[2] - b[2]);
    let drawn = 0;
    for (const asset of this.assets) {
      let n = 0;
      let nInk = 0;
      const cap = this.opts.capacity;
      for (const [i, j] of cells) {
        const tufts = this.cell(i, j).get(asset.name);
        if (!tufts) continue;
        for (const t of tufts) {
          if (n >= cap) break;
          const d = Math.hypot(t.x - player.x, t.z - player.z);
          if (d > R) continue;
          // shrink into the ground over the last 6 m
          const fade = Math.min(1, (R - d) / 6);
          const s = t.scale * (fade * fade * (3 - 2 * fade));
          if (s < 0.05) continue;
          _q.setFromAxisAngle(_up, t.rot);
          _b.compose(_p.set(t.x, t.y, t.z), _q, _s.setScalar(s));
          for (const m of asset.meshes) {
            _m.multiplyMatrices(_b, m.matrix);
            m.mesh.setMatrixAt(n, _m);
          }
          n++;
          if (d <= this.opts.inkRadius) nInk = n;
        }
      }
      for (const m of asset.meshes) {
        m.mesh.count = n;
        m.hull.count = nInk;
        m.mesh.instanceMatrix.clearUpdateRanges();
        m.mesh.instanceMatrix.addUpdateRange(0, n * 16);
        m.mesh.instanceMatrix.needsUpdate = true;
      }
      drawn += n;
    }
    this.drawn = drawn;
  }

  dispose(): void {
    for (const a of this.assets) {
      for (const m of a.meshes) {
        m.mesh.dispose();
        m.hull.dispose();
      }
    }
    this.group.removeFromParent();
  }
}
