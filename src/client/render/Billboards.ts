import * as THREE from 'three';
import { BILLBOARD_STRETCH, CAMERA_PITCH_DEG, CAMERA_YAW_DEG, PX_PER_METER } from './IsoCamera';

/** One sprite of a painted atlas (see tools/art2d). Pixel units, y down from the top-left. */
export interface SpriteFrame {
  rect: [number, number, number, number];
  /** Base point (touches the ground) inside the rect. */
  anchor: [number, number];
  /** Collision radius in meters (0 = walkable). */
  collider?: number;
  /** Name of the flat ground-shadow frame drawn under this sprite. */
  shadow?: string;
  /** Wind sway in meters at the top of the sprite. */
  sway?: number;
  /** Crown/footprint radius in meters (placement spacing). */
  radius?: number;
  kind?: string;
}

export interface SpriteAtlas {
  image: string;
  size: [number, number];
  pxPerMeter: number;
  frames: Record<string, SpriteFrame>;
}

export interface SpritePlacement {
  frame: string;
  x: number;
  y: number;
  z: number;
  /** Uniform scale (1 = painted size). */
  scale?: number;
  /** Mirror horizontally (through the uv rect: the quad keeps its winding, see buildMesh). */
  flip?: boolean;
  tint?: THREE.ColorRepresentation;
}

const YAW = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
const SIN_PITCH = Math.sin(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));
/** Screen-right direction on the ground (world XZ). */
const RIGHT_X = Math.cos(YAW);
const RIGHT_Z = -Math.sin(YAW);

/**
 * Upright painted sprites (trees, rocks, bushes...) as one InstancedMesh, plus their ground
 * shadows as a second InstancedMesh of flat decals. Quads face the fixed camera yaw and are
 * stretched so one painted pixel = one internal pixel. Alpha-tested, so they write depth and
 * characters correctly pass in front of / behind them.
 */
export class Billboards {
  readonly group = new THREE.Group();
  readonly sprites: THREE.InstancedMesh;
  readonly decals: THREE.InstancedMesh;
  readonly shadows: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly time = { value: 0 };
  /** Upright instances that may fade when something stands behind them (trees, bushes). */
  private readonly faders: { index: number; x: number; z: number; r: number; h: number }[] = [];
  private fade!: THREE.InstancedBufferAttribute;
  /** Instances dithered now, and the scratch set setFocus fills before swapping the two. */
  private faded = new Set<number>();
  private nextFaded = new Set<number>();

  constructor(readonly atlas: SpriteAtlas, texture: THREE.Texture, placements: SpritePlacement[]) {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
    patchAtlasMaterial(this.material, this.time, true);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    patchAtlasMaterial(shadowMat, this.time, false);

    const decalMat = new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    patchAtlasMaterial(decalMat, this.time, false);

    const isDecal = (p: SpritePlacement) => atlas.frames[p.frame]?.kind === 'decal';
    const withShadow = placements.filter((p) => atlas.frames[p.frame]?.shadow);
    const upright = placements.filter((p) => !isDecal(p));
    this.sprites = this.buildMesh(upright, this.material, false);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, upright.length)), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    this.sprites.geometry.setAttribute('fadeOn', this.fade);
    const ppm = atlas.pxPerMeter || PX_PER_METER;
    upright.forEach((p, index) => {
      const f = atlas.frames[p.frame];
      if (f.kind !== 'tree') return;
      const s = p.scale ?? 1;
      // half width on screen and painted height (screen meters) of the crown
      this.faders.push({ index, x: p.x, z: p.z, r: (f.rect[2] / ppm) * s * 0.45, h: (f.rect[3] / ppm) * s });
    });
    this.decals = this.buildMesh(placements.filter(isDecal), decalMat, true);
    this.decals.renderOrder = -2;
    this.shadows = this.buildMesh(
      withShadow.map((p) => this.castShadow(p)),
      shadowMat,
      true,
    );
    this.shadows.renderOrder = -1;
    this.group.add(this.decals, this.shadows, this.sprites);
  }

  update(dt: number): void {
    this.time.value += dt;
  }

  /**
   * Dithers (50%) the trees that hide any of the focus points (the player, nearby hostiles):
   * a tree in front of the point (closer to the camera) whose painted crown covers it on screen.
   */
  setFocus(points: { x: number; z: number }[]): void {
    const next = this.nextFaded;
    next.clear();
    for (const p of points) {
      for (const t of this.faders) {
        const dx = p.x - t.x;
        const dz = p.z - t.z;
        if (dx * dx + dz * dz > 100) continue;
        // screen right: (cos45, 0, -sin45); depth toward the camera (ground back): (sin45, 0, cos45)
        const across = (dx - dz) * Math.SQRT1_2;
        const behind = -(dx + dz) * Math.SQRT1_2; // > 0 when the point is farther from the camera
        if (Math.abs(across) > t.r || behind < 0.2) continue;
        if (behind * SIN_PITCH > t.h * 0.95) continue;
        next.add(t.index);
      }
    }
    let dirty = false;
    for (const i of this.faded) if (!next.has(i)) (this.fade.setX(i, 0), (dirty = true));
    for (const i of next) if (!this.faded.has(i)) (this.fade.setX(i, 1), (dirty = true));
    this.nextFaded = this.faded;
    this.faded = next;
    if (dirty) this.fade.needsUpdate = true;
  }

  /** Frees the meshes' geometries, instance buffers and materials (the atlas texture is shared). */
  dispose(): void {
    for (const mesh of [this.sprites, this.decals, this.shadows]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose(); // instanceMatrix / instanceColor buffers
    }
    this.group.removeFromParent();
  }

  /**
   * The ground shadow of an upright sprite. Painted shadows are cast by the fixed sun (down-right on
   * screen), so a mirrored sprite does not mirror its shadow (that would cast it down-left, against
   * the 3D shadows); the shadow moves with the mirrored crown instead: twice the crown's offset
   * from the anchor (rect center minus anchor, along screen right).
   */
  private castShadow(p: SpritePlacement): SpritePlacement {
    const f = this.atlas.frames[p.frame];
    const shadow = { ...p, frame: f.shadow!, flip: false };
    if (p.flip) {
      const shift = (-2 * (f.rect[2] / 2 - f.anchor[0]) * (p.scale ?? 1)) / (this.atlas.pxPerMeter || PX_PER_METER);
      shadow.x += shift * RIGHT_X;
      shadow.z += shift * RIGHT_Z;
    }
    return shadow;
  }

  private buildMesh(list: SpritePlacement[], material: THREE.Material, ground: boolean): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(1, 1);
    if (ground) geo.rotateX(-Math.PI / 2);
    const n = Math.max(1, list.length);
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.count = list.length;
    const rects = new Float32Array(n * 4);
    const sway = new Float32Array(n * 2);
    const [AW, AH] = this.atlas.size;
    const ppm = this.atlas.pxPerMeter || PX_PER_METER;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationY(YAW);
    const off = new THREE.Matrix4();
    const scl = new THREE.Matrix4();
    const pos = new THREE.Matrix4();
    const color = new THREE.Color();

    list.forEach((p, i) => {
      const f = this.atlas.frames[p.frame];
      if (!f) throw new Error(`sprite frame "${p.frame}" not in atlas`);
      const [x, y, w, h] = f.rect;
      const s = p.scale ?? 1;
      const W = (w / ppm) * s;
      // upright quads stretch vertically (pitch); ground decals stretch along screen-up (1/sin)
      const H = (h / ppm) * s * (ground ? 1 / SIN_PITCH : BILLBOARD_STRETCH);
      // Mirrored sprites flip the uv rect, never the scale: three.js picks the front face from
      // the object matrix only, so a negative per-instance scale reverses the winding and the
      // single-sided quad is culled. The anchor column mirrors with the image.
      let ua = f.anchor[0] / w;
      if (p.flip) ua = 1 - ua;
      const va = 1 - f.anchor[1] / h;
      if (ground) {
        // plane lies in XZ after rotateX(-90): local +Y became -Z (screen-up direction after yaw)
        off.makeTranslation((0.5 - ua) * W, 0, -(0.5 - va) * H);
        scl.makeScale(W, 1, H);
      } else {
        off.makeTranslation((0.5 - ua) * W, (0.5 - va) * H, 0);
        scl.makeScale(W, H, 1);
      }
      pos.makeTranslation(p.x, p.y, p.z);
      m.copy(pos).multiply(rot).multiply(off).multiply(scl);
      mesh.setMatrixAt(i, m);
      // flipped: start at the right edge with a negative width (vMapUv = rect.xy + uv * rect.zw)
      rects[i * 4] = (p.flip ? x + w : x) / AW;
      rects[i * 4 + 1] = 1 - (y + h) / AH;
      rects[i * 4 + 2] = (p.flip ? -w : w) / AW;
      rects[i * 4 + 3] = h / AH;
      sway.set([ground ? 0 : (f.sway ?? 0) * s, (p.x * 0.37 + p.z * 0.61) % 6.283], i * 2);
      mesh.setColorAt(i, color.set(p.tint ?? 0xffffff));
    });
    if (list.length === 0) mesh.setColorAt(0, color.set(0xffffff));
    geo.setAttribute('uvRect', new THREE.InstancedBufferAttribute(rects, 4));
    geo.setAttribute('swayData', new THREE.InstancedBufferAttribute(sway, 2));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    return mesh;
  }
}

function patchAtlasMaterial(mat: THREE.MeshBasicMaterial, time: { value: number }, upright: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        upright
          ? '#include <common>\nattribute vec4 uvRect;\nattribute vec2 swayData;\nattribute float fadeOn;\nvarying float vFade;\nuniform float uTime;'
          : '#include <common>\nattribute vec4 uvRect;\nattribute vec2 swayData;\nuniform float uTime;',
      )
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = uvRect.xy + uv * uvRect.zw;${upright ? '\nvFade = fadeOn;' : ''}`)
      .replace(
        '#include <begin_vertex>',
        upright
          ? `#include <begin_vertex>
             float swayT = uv.y * uv.y;
             transformed.x += sin(uTime * 1.4 + swayData.y) * swayData.x * swayT / max(length(instanceMatrix[0].xyz), 1e-4);`
          : '#include <begin_vertex>',
      );
    if (upright) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          if (vFade > 0.5) {
            ivec2 q = ivec2(gl_FragCoord.xy) % 2;
            if ((q.x + q.y) % 2 == 0) discard; // 2x2 checker dither: see through the crown
          }`,
        );
    }
  };
  mat.customProgramCacheKey = () => (upright ? 'atlas-upright' : 'atlas-ground');
}
