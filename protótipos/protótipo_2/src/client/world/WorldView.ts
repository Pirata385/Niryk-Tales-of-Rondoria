import * as THREE from 'three';
import type { WorldData } from '@shared/world/worldgen';
import { Grass, type GrassOptions } from './Grass';
import { NatureView } from './NatureView';
import { Terrain } from './Terrain';
import { Water } from './Water';

/** Everything static of the world: ground, ponds, woods and the grass around the player. */
export class WorldView {
  readonly group = new THREE.Group();

  private constructor(
    readonly terrain: Terrain,
    readonly water: Water,
    readonly nature: NatureView,
    readonly grass: Grass,
  ) {
    this.group.name = 'World';
    this.group.add(terrain.mesh, water.group, nature.group, grass.group);
  }

  static async create(world: WorldData, grass: GrassOptions): Promise<WorldView> {
    const [nature, g] = await Promise.all([NatureView.create(world.nature), Grass.create(world, grass)]);
    return new WorldView(new Terrain(world), new Water(world), nature, g);
  }

  update(camera: THREE.Camera, player: THREE.Vector3): void {
    this.nature.update(camera, player);
    this.grass.update(player);
  }

  dispose(): void {
    this.terrain.dispose();
    this.water.dispose();
    this.nature.dispose();
    this.grass.dispose();
    this.group.removeFromParent();
  }
}
