import * as THREE from 'three';

/** Fixed isometric view (see docs/art/ART_DIRECTION.md). */
export const CAMERA_YAW_DEG = 45;
export const CAMERA_PITCH_DEG = 40;
/** Internal-resolution pixels per world meter at zoom 1 (sprites are painted at this density). */
export const PX_PER_METER = 32;
/** Billboards are stretched by this so painted pixels land 1:1 on screen. */
export const BILLBOARD_STRETCH = 1 / Math.cos(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));

const CAMERA_DISTANCE = 120;

/**
 * Orthographic camera looking at `target` from the fixed iso direction.
 *
 * The camera is snapped to the internal-resolution texel grid so static geometry always lands on
 * the same pixels (no shimmering while walking); the leftover sub-texel offset is exposed in
 * `subTexel` and applied by the upscale pass, which keeps camera motion smooth.
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  /** Unit vectors of the view basis (world space). `back` points from the target to the camera. */
  readonly right: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly back: THREE.Vector3;
  /** Sub-texel remainder of the snap, in internal pixels (x right, y up). */
  readonly subTexel = new THREE.Vector2();
  zoom = 1;
  private width = 640;
  private height = 360;

  constructor() {
    const yaw = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
    const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH_DEG);
    this.back = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
    this.right = new THREE.Vector3(0, 1, 0).cross(this.back).normalize();
    this.up = this.back.clone().cross(this.right).normalize();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 2.5);
    this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.right, this.up, this.back));
  }

  get pixelsPerMeter(): number {
    return PX_PER_METER * this.zoom;
  }

  /** Size of the internal render target (in texels) the camera must cover. */
  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  update(): void {
    const ppm = this.pixelsPerMeter;
    const cam = this.camera;
    cam.left = -this.width / 2 / ppm;
    cam.right = this.width / 2 / ppm;
    cam.top = this.height / 2 / ppm;
    cam.bottom = -this.height / 2 / ppm;
    cam.updateProjectionMatrix();

    const texel = 1 / ppm;
    const x = this.target.dot(this.right);
    const y = this.target.dot(this.up);
    const z = this.target.dot(this.back);
    const sx = Math.round(x / texel) * texel;
    const sy = Math.round(y / texel) * texel;
    this.subTexel.set((x - sx) / texel, (y - sy) / texel);
    cam.position
      .copy(this.right).multiplyScalar(sx)
      .addScaledVector(this.up, sy)
      .addScaledVector(this.back, z + CAMERA_DISTANCE);
    cam.updateMatrixWorld();
  }

  /**
   * Moves `p` in the view plane (its depth is kept) so that a screen-aligned rect of w x h
   * internal pixels centered on it starts exactly on a texel edge. The texel grid is fixed in the
   * world (the camera itself snaps to it), so snapped markers keep the same pixels every frame:
   * crisp, no shimmer. Valid once the pipeline has rendered (it sets the viewport).
   */
  snapToTexels(p: THREE.Vector3, w = 0, h = 0): THREE.Vector3 {
    const ppm = this.pixelsPerMeter;
    // texel edges sit at (integer - viewport/2) texels along right/up: odd viewports shift them
    const x = p.dot(this.right) * ppm - w / 2 + this.width / 2;
    const y = p.dot(this.up) * ppm - h / 2 + this.height / 2;
    return p.addScaledVector(this.right, (Math.round(x) - x) / ppm).addScaledVector(this.up, (Math.round(y) - y) / ppm);
  }

  /** Converts a screen-space direction (x right, y down) into a ground-plane (XZ) direction. */
  screenToGround(dx: number, dy: number, out = new THREE.Vector2()): THREE.Vector2 {
    const gx = this.right.x * dx - this.groundUp.x * dy;
    const gz = this.right.z * dx - this.groundUp.z * dy;
    return out.set(gx, gz);
  }

  /** Ground direction that appears as "up" on screen. */
  get groundUp(): THREE.Vector3 {
    return new THREE.Vector3(-this.back.x, 0, -this.back.z).normalize();
  }
}
