import catalog from '../../../assets/nature.json';

/**
 * What the world needs to know about each 3D nature asset (Pyram3D's nature.json, copied to
 * assets/nature.json by `npm run models`): meters, origin at the base center.
 */
export interface NatureAsset {
  kind: string;
  /** Radius of the solid cylinder at the base (0 = walk through). */
  collider: number;
  height: number;
  /** Visual footprint radius. */
  radius: number;
  /** Suggested uniform random scale range. */
  scale: [number, number];
  /** Wind: top displacement (m) for the listed materials, weighted by height above the ground. */
  wind?: { sway: number; materials: string[] };
  /** [min y, max y] of the leaves. */
  canopy?: [number, number];
  /** A lying solid (logs): segment ends and radius, in model space. */
  capsule?: [[number, number, number], [number, number, number], number];
}

/**
 * Stand-ins while an asset is missing from the catalog (and the measures the placeholder shapes in
 * the client are built to). Real entries from nature.json override these.
 */
const DEFAULTS: Record<string, NatureAsset> = {
  oak_1: { kind: 'tree', collider: 0.4, height: 6.9, radius: 3.4, scale: [0.85, 1.2], canopy: [2.9, 6.9], wind: { sway: 0.1, materials: ['Leaves'] } },
  oak_2: { kind: 'tree', collider: 0.37, height: 7.4, radius: 3.0, scale: [0.85, 1.2], canopy: [3.2, 7.4], wind: { sway: 0.1, materials: ['Leaves'] } },
  pine_1: { kind: 'tree', collider: 0.27, height: 9, radius: 2.6, scale: [0.8, 1.2], canopy: [1.6, 9], wind: { sway: 0.07, materials: ['Leaves'] } },
  bush_1: { kind: 'bush', collider: 0.48, height: 1.0, radius: 0.95, scale: [0.8, 1.3], wind: { sway: 0.04, materials: ['Leaves'] } },
  rock_1: { kind: 'rock', collider: 0.33, height: 0.41, radius: 0.43, scale: [0.7, 1.4] },
  rock_2: { kind: 'rock', collider: 0.94, height: 1.29, radius: 1.38, scale: [0.8, 1.25] },
  stump_1: { kind: 'stump', collider: 0.3, height: 0.45, radius: 0.47, scale: [0.85, 1.25] },
  log_1: { kind: 'log', collider: 0, height: 0.63, radius: 0.98, scale: [0.85, 1.2], capsule: [[-0.9, 0.17, 0], [0.9, 0.17, 0], 0.2] },
  grass_1: { kind: 'grass', collider: 0, height: 0.34, radius: 0.21, scale: [0.7, 1.35], wind: { sway: 0.05, materials: ['Grass'] } },
  flowers_1: { kind: 'flowers', collider: 0, height: 0.32, radius: 0.2, scale: [0.8, 1.25], wind: { sway: 0.05, materials: ['Grass', 'Flower'] } },
};

export const NATURE: Record<string, NatureAsset> = {
  ...DEFAULTS,
  ...((catalog as unknown as { assets?: Record<string, NatureAsset> }).assets ?? {}), // JSON arrays type as number[]
};

/** Asset names of a kind, sorted (stable for the seeded placement). */
export function assetsOfKind(kind: string): string[] {
  return Object.keys(NATURE)
    .filter((k) => NATURE[k].kind === kind)
    .sort();
}
