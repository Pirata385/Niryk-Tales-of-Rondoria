import * as THREE from 'three';
import { NATURE } from '@shared/world/natureCatalog';
import type { NaturePlacement } from '@shared/world/worldgen';
import { addOutline } from '../render/outline';
import { natureModel, type NatureModel } from './natureModels';

/** How far each kind is drawn, outlined and casts shadows (m from the player). */
const RANGES: Record<string, { draw: number; ink: number }> = {
  tree: { draw: 150, ink: 75 },
  bush: { draw: 80, ink: 45 },
  rock: { draw: 90, ink: 50 },
  log: { draw: 70, ink: 40 },
  stump: { draw: 70, ink: 40 },
};
const DEFAULT_RANGE = { draw: 80, ink: 40 };
/** Everything this close to the player casts shadows, in view or not (the sun's frustum is ~28 m). */
const SHADOW_RADIUS = 30;

interface PartMeshes {
  mesh: THREE.InstancedMesh;
  hull: THREE.InstancedMesh;
  /** Draws nothing in the main pass; casts the shadows of the nearest instances. */
  caster: THREE.InstancedMesh;
  /** Instance matrices of every placement (16 floats each), precomputed. */
  matrices: Float32Array;
}

interface Batch {
  asset: string;
  kind: string;
  placements: NaturePlacement[];
  /** Bounding sphere per placement (x, y, z, r). */
  spheres: Float32Array;
  colors: Float32Array;
  parts: PartMeshes[];
  model: NatureModel;
}

const casterMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Trees, bushes, rocks and dead wood: one instanced mesh per model part (bark, leaves...), each
 * with an instanced ink hull and an instanced shadow caster. Every frame the instances are culled
 * (distance and view frustum) and sorted near to far, so the hull draws the nearest prefix (ink
 * fades out with distance) and the caster the ones around the player.
 */
export class NatureView {
  readonly group = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly order: number[] = [];
  private readonly dist: Float32Array;
  drawn = 0;
  /** Multipliers of the draw and ink ranges (quality presets). */
  drawScale = 1;
  inkScale = 1;

  private constructor(placements: NaturePlacement[]) {
    this.group.name = 'Nature';
    this.dist = new Float32Array(placements.length);
  }

  static async create(placements: NaturePlacement[]): Promise<NatureView> {
    const view = new NatureView(placements);
    const byAsset = new Map<string, NaturePlacement[]>();
    for (const p of placements) {
      let list = byAsset.get(p.asset);
      if (!list) byAsset.set(p.asset, (list = []));
      list.push(p);
    }
    const models = await Promise.all([...byAsset.keys()].map((a) => natureModel(a)));
    for (const model of models) view.addBatch(model, byAsset.get(model.name)!);
    return view;
  }

  private addBatch(model: NatureModel, placements: NaturePlacement[]): void {
    const a = NATURE[model.name];
    const kind = a?.kind ?? 'rock';
    const n = placements.length;
    const spheres = new Float32Array(n * 4);
    const colors = new Float32Array(n * 3);
    const base: THREE.Matrix4[] = placements.map((p, i) => {
      spheres.set([p.x, p.y + (a?.height ?? 1) * p.scale * 0.5, p.z, Math.max(a?.radius ?? 1, (a?.height ?? 1) * 0.6) * p.scale], i * 4);
      colors.set(p.tint, i * 3);
      _q.setFromAxisAngle(_up, p.rot);
      return new THREE.Matrix4().compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(p.scale));
    });
    const parts: PartMeshes[] = model.parts.map((part) => {
      const matrices = new Float32Array(n * 16);
      for (let i = 0; i < n; i++) _m.multiplyMatrices(base[i], part.matrix).toArray(matrices, i * 16);
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, n);
      mesh.name = `${model.name}_${part.material.name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      const hull = addOutline(mesh, { wind: part.wind, width: kind === 'tree' ? 1.15 : 1 }) as THREE.InstancedMesh;
      hull.frustumCulled = false;
      hull.count = 0;
      const caster = new THREE.InstancedMesh(part.geometry, casterMaterial, n);
      caster.instanceMatrix = mesh.instanceMatrix;
      caster.frustumCulled = false;
      caster.castShadow = true;
      caster.count = 0;
      caster.name = `${mesh.name}_caster`;
      this.group.add(mesh, caster);
      return { mesh, hull, caster, matrices };
    });
    this.batches.push({ asset: model.name, kind, placements, spheres, colors, parts, model });
  }

  /** Culls and sorts the instances for this frame's camera (and the player, for shadows). */
  update(camera: THREE.Camera, player: THREE.Vector3): void {
    _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projView);
    let drawn = 0;
    for (const b of this.batches) {
      const range = RANGES[b.kind] ?? DEFAULT_RANGE;
      const order = this.order;
      order.length = 0;
      const sp = b.spheres;
      for (let i = 0; i < b.placements.length; i++) {
        const dx = sp[i * 4] - player.x;
        const dz = sp[i * 4 + 2] - player.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > range.draw * this.drawScale + sp[i * 4 + 3]) continue;
        if (d > SHADOW_RADIUS) {
          _sphere.center.set(sp[i * 4], sp[i * 4 + 1], sp[i * 4 + 2]);
          _sphere.radius = sp[i * 4 + 3];
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }
        this.dist[i] = d;
        order.push(i);
      }
      order.sort((x, y) => this.dist[x] - this.dist[y]);
      let nInk = 0;
      let nShadow = 0;
      for (let k = 0; k < order.length; k++) {
        const d = this.dist[order[k]];
        if (d <= range.ink * this.inkScale) nInk = k + 1;
        if (d <= SHADOW_RADIUS) nShadow = k + 1;
      }
      for (const part of b.parts) {
        const dst = part.mesh.instanceMatrix.array as Float32Array;
        const col = part.mesh.instanceColor!.array as Float32Array;
        for (let k = 0; k < order.length; k++) {
          const i = order[k];
          dst.set(part.matrices.subarray(i * 16, i * 16 + 16), k * 16);
          col[k * 3] = b.colors[i * 3];
          col[k * 3 + 1] = b.colors[i * 3 + 1];
          col[k * 3 + 2] = b.colors[i * 3 + 2];
        }
        part.mesh.count = order.length;
        part.hull.count = nInk;
        part.caster.count = nShadow;
        part.mesh.instanceMatrix.clearUpdateRanges();
        part.mesh.instanceMatrix.addUpdateRange(0, order.length * 16);
        part.mesh.instanceMatrix.needsUpdate = true;
        part.mesh.instanceColor!.clearUpdateRanges();
        part.mesh.instanceColor!.addUpdateRange(0, order.length * 3);
        part.mesh.instanceColor!.needsUpdate = true;
      }
      drawn += order.length;
    }
    this.drawn = drawn;
  }

  /** Asset names drawn with a placeholder shape (no GLB imported). */
  get placeholders(): string[] {
    return this.batches.filter((b) => b.model.placeholder).map((b) => b.asset);
  }

  dispose(): void {
    for (const b of this.batches) {
      for (const p of b.parts) {
        p.mesh.dispose();
        p.hull.dispose();
        p.caster.dispose();
      }
    }
    this.group.removeFromParent();
  }
}
