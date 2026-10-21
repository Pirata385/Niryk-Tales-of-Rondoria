import * as THREE from 'three';
import { STRUCTURES, footprint, type Structure, type WorldData } from '@shared/world/worldgen';
import { addOutline } from '../render/outline';
import { structureModel, type StructureModel } from './structureModels';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The village: every structure of the world (houses, well, market stall, notice board, lamps,
 * crates, barrels, fences, benches, flower beds), one instanced mesh per type and model part
 * with an instanced ink hull. Each type draws its imported GLB when there is one (see
 * structureModels: `<type>.glb` or an alias) and a tidy toon stand-in of the same footprint
 * otherwise. Static: the instances are placed once, standing on the lowest ground under their
 * footprint (footings reach into the slope).
 */
export class StructureView {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Types drawn with a placeholder (no GLB imported). */
  readonly placeholders: string[] = [];
  /** Types and the GLB each one uses. */
  readonly sources: Record<string, string | null> = {};

  private constructor() {
    this.group.name = 'Structures';
  }

  static async create(world: WorldData): Promise<StructureView> {
    const view = new StructureView();
    const byType = new Map<string, Structure[]>();
    for (const s of world.structures) {
      let list = byType.get(s.type);
      if (!list) byType.set(s.type, (list = []));
      list.push(s);
    }
    const models = await Promise.all([...byType.keys()].map((t) => structureModel(t)));
    for (const model of models) view.add(model, byType.get(model.type)!, world);
    return view;
  }

  private add(model: StructureModel, list: Structure[], world: WorldData): void {
    this.sources[model.type] = model.source;
    if (!model.source) this.placeholders.push(model.type);
    const n = list.length;
    const base = list.map((s) => {
      _q.setFromAxisAngle(_up, s.rot);
      return new THREE.Matrix4().compose(_p.set(s.x, groundUnder(s, world), s.z), _q, _s);
    });
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, n);
      mesh.name = `${model.type}_${part.material.name || 'part'}`;
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _m.multiplyMatrices(base[i], part.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = STRUCTURES[model.type]?.painted !== true;
      mesh.receiveShadow = true;
      if (part.ink) {
        const hull = addOutline(mesh, { width: 1 }) as THREE.InstancedMesh;
        hull.computeBoundingSphere();
      }
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  dispose(): void {
    // geometries and materials belong to the cached models (shared with a later game)
    for (const m of this.meshes) {
      m.dispose();
      (m.userData.outline as THREE.InstancedMesh | undefined)?.dispose();
    }
    this.group.removeFromParent();
  }
}

/** The lowest ground under a structure's footprint (and its center). */
function groundUnder(s: Structure, world: WorldData): number {
  let y = world.height(s.x, s.z);
  for (const [x, z] of footprint(s)) y = Math.min(y, world.height(x, z));
  return y;
}
