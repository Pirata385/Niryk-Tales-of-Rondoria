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
import { Butterflies } from './Butterflies';
import { createGround } from './Ground';
import { Water } from './Water';

/**
 * Everything static of the world: painted ground (splat from the world generator), the 2D nature
 * (billboards, decals, shadows), and the village structures (Pyram3D GLBs).
 */
export class WorldView {
  readonly group = new THREE.Group();
  billboards!: Billboards;
  butterflies!: Butterflies;
  water!: Water;
  /** Meshes whose geometry and material this view created (ground, merged static batches). */
  private readonly owned: THREE.Mesh[] = [];

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
    this.owned.push(ground);
    this.water = new Water(w.ponds, w.pondDist, noise);
    this.group.add(this.water.group);

    const structures = await this.buildStructures();

    const { atlas, texture } = await loadSpriteAtlas('nature');
    const placements: SpritePlacement[] = w.nature.placements.map((p) => ({ ...p, tint: new THREE.Color(...p.tint) }));
    const cosP = Math.cos(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));
    const near = (p: SpritePlacement) => Math.hypot(p.x, p.z) < 45; // only the village casts on sprites
    shadeSpritesUnder(placements.filter(near), structures, (f) => atlas.frames[f].rect[3] / atlas.pxPerMeter / cosP);
    for (const m of staticBatch(structures)) {
      this.group.add(m);
      this.owned.push(m); // its own merged geometry and cloned material; texture maps are shared
    }
    this.billboards = new Billboards(atlas, texture, placements);
    this.group.add(this.billboards.group);
    // butterflies over grass and roads, never over the paved plaza
    this.butterflies = new Butterflies(atlas, texture, w.height, (x, z) => w.splat(x, z)[2] < 0.3 && Math.abs(x) < w.half - 4 && Math.abs(z) < w.half - 4);
    this.group.add(this.butterflies.mesh);
  }

  private async buildStructures(): Promise<THREE.Object3D[]> {
    const out: THREE.Object3D[] = [];
    const types = [...new Set(this.world.structures.map((s) => s.type))].filter((t) => !STRUCTURES[t].painted);
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
      if (def.painted) continue; // drawn by the ground splat and the nature sprites
      const obj = models.get(s.type)?.clone(true) ?? placeholder(def.w, def.d, s.type);
      obj.position.set(s.x, this.world.height(s.x, s.z), s.z);
      obj.rotation.y = s.rot;
      obj.updateMatrixWorld(true);
      out.push(obj); // merged into static batches by build()
    }
    return out;
  }

  /** Animates sway and the butterflies around the player at (x, z). */
  update(dt: number, x: number, z: number): void {
    this.billboards.update(dt);
    this.butterflies.update(dt, x, z);
    this.water.update(dt);
  }

  /**
   * Frees the GPU resources this view created. Textures and the models' own geometries come from
   * the shared asset cache (loadTexture / loadModel) and stay for the next entry into the world.
   */
  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.owned) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.owned.length = 0;
    this.water.dispose();
    this.billboards.dispose();
    this.butterflies.dispose();
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
