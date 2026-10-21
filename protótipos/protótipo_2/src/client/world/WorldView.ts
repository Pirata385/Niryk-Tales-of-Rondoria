import * as THREE from 'three';
import type { WorldData } from '@shared/world/worldgen';
import { Grass, type GrassOptions } from './Grass';
import { NatureView } from './NatureView';
import { Plaza } from './Plaza';
import { StructureView } from './StructureView';
import { Terrain } from './Terrain';
import { Water } from './Water';

/** Everything static of the world: ground, ponds, woods, the village and the grass around the player. */
export class WorldView {
  readonly group = new THREE.Group();

  private constructor(
    readonly terrain: Terrain,
    readonly water: Water,
    readonly nature: NatureView,
    readonly grass: Grass,
    readonly structures: StructureView,
    readonly plaza: Plaza | null,
  ) {
    this.group.name = 'World';
    this.group.add(terrain.mesh, water.group, nature.group, grass.group, structures.group);
    if (plaza) this.group.add(plaza.mesh);
  }

  static async create(world: WorldData, grass: GrassOptions, ranges: { draw: number; ink: number } = { draw: 1, ink: 1 }): Promise<WorldView> {
    const [nature, g, structures] = await Promise.all([NatureView.create(world.nature), Grass.create(world, grass), StructureView.create(world)]);
    nature.drawScale = ranges.draw;
    nature.inkScale = ranges.ink;
    return new WorldView(new Terrain(world), new Water(world), nature, g, structures, world.plaza ? new Plaza(world) : null);
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
    this.structures.dispose();
    this.plaza?.dispose();
    this.group.removeFromParent();
  }
}
