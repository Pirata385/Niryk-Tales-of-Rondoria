import * as THREE from 'three';
import { LAYERS, LOOK } from './look';

// follow() scratch
const _snapped = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * The sun: the one directional light the toon materials read (direction and shadow map; its color
 * is unused, the toon bands carry the color). Its shadow frustum is a square centered on the
 * player, snapped to shadow texels so the stepped shadow edges don't crawl as it moves.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();

  constructor(scene: THREE.Scene, opts: { radius?: number; mapSize?: number } = {}) {
    const radius = opts.radius ?? 28;
    this.sun = new THREE.DirectionalLight('#ffffff', 1);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(opts.mapSize ?? 2048, opts.mapSize ?? 2048);
    s.camera.left = -radius;
    s.camera.right = radius;
    s.camera.top = radius;
    s.camera.bottom = -radius;
    s.camera.near = 1;
    s.camera.far = 160;
    s.bias = -0.0004;
    s.normalBias = 0.045;
    s.radius = 1;
    s.camera.layers.enable(LAYERS.fpHidden);
    this.sun.target = this.sunTarget;
    scene.add(this.sun, this.sunTarget);
  }

  /** Centers the shadow frustum on `center` (the player). */
  follow(center: THREE.Vector3): void {
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    // snap in the shadow camera's own frame (lookAt with +Y up: x = up × z, y = z × x, z = toward the sun)
    const f = LOOK.sunDir;
    _right.set(0, 1, 0).cross(f).normalize();
    _up.copy(f).cross(_right);
    const u = Math.round(center.dot(_right) / texel) * texel;
    const v = Math.round(center.dot(_up) / texel) * texel;
    const c = _snapped.copy(f).multiplyScalar(center.dot(f)).addScaledVector(_right, u).addScaledVector(_up, v);
    this.sunTarget.position.copy(c);
    this.sun.position.copy(c).addScaledVector(LOOK.sunDir, 80);
    this.sunTarget.updateMatrixWorld();
  }

  dispose(): void {
    this.sun.removeFromParent();
    this.sunTarget.removeFromParent();
    this.sun.dispose();
  }
}
