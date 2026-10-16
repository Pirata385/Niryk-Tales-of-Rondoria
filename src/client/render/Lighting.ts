import * as THREE from 'three';

/** Sun comes from the upper-left of the screen (world -X), warm; ambient is cool (sky) / warm (ground). */
export const SUN_DIRECTION = new THREE.Vector3(-1, 1.35, -0.25).normalize();
/** Linear multiplier for painted sprites standing in the shadow of 3D objects (≈ ground shadow). */
export const SPRITE_SHADE = new THREE.Color(0.5, 0.56, 0.72);

/** Darkens the tint of sprites whose base is in the sun shadow of the given static meshes. */
export function shadeSpritesUnder(
  placements: { x: number; y: number; z: number; tint?: THREE.ColorRepresentation; frame: string }[],
  occluders: THREE.Object3D[],
  heightOf: (frame: string) => number,
): void {
  const ray = new THREE.Raycaster();
  ray.far = 40;
  const boxes = occluders.map((o) => new THREE.Box3().setFromObject(o));
  const origin = new THREE.Vector3();
  const inShadow = (x: number, y: number, z: number) => {
    origin.set(x, y, z);
    ray.set(origin, SUN_DIRECTION);
    const candidates = occluders.filter((_, i) => ray.ray.intersectsBox(boxes[i]));
    return candidates.length > 0 && ray.intersectObjects(candidates, true).length > 0;
  };
  for (const p of placements) {
    // shade only when both the base and 60% of the height are shadowed (a tall tree next to a low
    // house keeps its crown in the sun)
    if (!inShadow(p.x, p.y + 0.4, p.z) || !inShadow(p.x, p.y + Math.max(0.4, heightOf(p.frame) * 0.6), p.z)) continue;
    p.tint = new THREE.Color(p.tint ?? 0xffffff).multiply(SPRITE_SHADE);
  }
}

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sunTarget = new THREE.Object3D();

  constructor(scene: THREE.Scene, shadowRadius = 22) {
    this.hemi = new THREE.HemisphereLight('#8fa8e8', '#7a6a4a', Math.PI * 0.95);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff0d6', Math.PI * 0.8);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(1024, 1024);
    s.camera.left = -shadowRadius;
    s.camera.right = shadowRadius;
    s.camera.top = shadowRadius;
    s.camera.bottom = -shadowRadius;
    s.camera.near = 1;
    s.camera.far = 120;
    s.bias = -0.0006;
    s.normalBias = 0.02;
    this.sun.target = this.sunTarget;
    scene.add(this.sun, this.sunTarget);
  }

  /** Keeps the shadow frustum centered on what the camera is looking at (snapped to shadow texels). */
  follow(center: THREE.Vector3): void {
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const c = new THREE.Vector3(
      Math.round(center.x / texel) * texel,
      0,
      Math.round(center.z / texel) * texel,
    );
    this.sunTarget.position.copy(c);
    this.sun.position.copy(c).addScaledVector(SUN_DIRECTION, 60);
    this.sunTarget.updateMatrixWorld();
  }
}
