import * as THREE from 'three';
import type { WorldData } from '@shared/world/worldgen';
import { STRUCTURES } from '@shared/world/worldgen';
import { hasAsset, loadModel, loadSpriteAtlas, loadTexture } from '../core/assets';
import { Billboards, type SpritePlacement } from '../render/Billboards';
import { CAMERA_PITCH_DEG } from '../render/IsoCamera';
import { shadeSpritesUnder } from '../render/Lighting';
import { LAYER_OUTLINE } from '../render/PixelPipeline';
import { staticBatch } from '../render/staticBatch';
import { toonFromGltf, toonMaterial } from '../render/toon';
import { createGround } from './Ground';

/**
 * Everything static of the world: painted ground (splat from the world generator), the 2D nature
 * (billboards, decals, shadows), and the village structures (Pyram3D GLBs).
 */
export class WorldView {
  readonly group = new THREE.Group();
  billboards!: Billboards;

  private constructor(readonly world: WorldData) {}

  static async create(world: WorldData): Promise<WorldView> {
    const v = new WorldView(world);
    await v.build();
    return v;
  }

  private async build(): Promise<void> {
    const w = this.world;
    const [grassA, grassB, dirt, cobble, noise] = await Promise.all(
      ['ground_grass_a', 'ground_grass_b', 'ground_dirt', 'ground_cobble', 'noise'].map((n) => loadTexture(`sprites/${n}.png`)),
    );
    const ground = createGround({ grassA, grassB, dirt, cobble, noise }, { size: w.size, step: 2, height: w.height, splat: w.splat });
    this.group.add(ground);

    const structures = await this.buildStructures();

    const { atlas, texture } = await loadSpriteAtlas('nature');
    const placements: SpritePlacement[] = w.nature.placements.map((p) => ({ ...p, tint: new THREE.Color(...p.tint) }));
    const cosP = Math.cos(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));
    const near = (p: SpritePlacement) => Math.hypot(p.x, p.z) < 45; // only the village casts on sprites
    shadeSpritesUnder(placements.filter(near), structures, (f) => atlas.frames[f].rect[3] / atlas.pxPerMeter / cosP);
    for (const m of staticBatch(structures)) this.group.add(m);
    this.billboards = new Billboards(atlas, texture, placements);
    this.group.add(this.billboards.group);
  }

  private async buildStructures(): Promise<THREE.Object3D[]> {
    const out: THREE.Object3D[] = [];
    const types = [...new Set(this.world.structures.map((s) => s.type))];
    const models = new Map<string, THREE.Object3D>();
    await Promise.all(
      types.map(async (t) => {
        if (!hasAsset(`models/${t}.glb`)) return;
        const gltf = await loadModel(t);
        prepare(gltf.scene);
        models.set(t, gltf.scene);
      }),
    );
    for (const s of this.world.structures) {
      const def = STRUCTURES[s.type];
      const obj = models.get(s.type)?.clone(true) ?? placeholder(def.w, def.d, s.type);
      obj.position.set(s.x, this.world.height(s.x, s.z), s.z);
      obj.rotation.y = s.rot;
      obj.updateMatrixWorld(true);
      out.push(obj); // merged into static batches by build()
    }
    return out;
  }

  update(dt: number): void {
    this.billboards.update(dt);
  }
}

function prepare(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => toonFromGltf(m)) : toonFromGltf(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(LAYER_OUTLINE);
  });
}

function placeholder(w: number, d: number, type: string): THREE.Object3D {
  const h = type.startsWith('house') ? 4 : 1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), toonMaterial({ color: '#b8a888' }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.layers.enable(LAYER_OUTLINE);
  return mesh;
}
