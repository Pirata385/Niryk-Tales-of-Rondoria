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
  /** Mirror horizontally. */
  flip?: boolean;
  tint?: THREE.ColorRepresentation;
}

const YAW = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
const SIN_PITCH = Math.sin(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));

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
    this.sprites = this.buildMesh(placements.filter((p) => !isDecal(p)), this.material, false);
    this.decals = this.buildMesh(placements.filter(isDecal), decalMat, true);
    this.decals.renderOrder = -2;
    this.shadows = this.buildMesh(
      withShadow.map((p) => ({ ...p, frame: atlas.frames[p.frame].shadow! })),
      shadowMat,
      true,
    );
    this.shadows.renderOrder = -1;
    this.group.add(this.decals, this.shadows, this.sprites);
  }

  update(dt: number): void {
    this.time.value += dt;
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
      let ua = f.anchor[0] / w;
      if (p.flip) ua = 1 - ua;
      const va = 1 - f.anchor[1] / h;
      if (ground) {
        // plane lies in XZ after rotateX(-90): local +Y became -Z (screen-up direction after yaw)
        off.makeTranslation((0.5 - ua) * W, 0, -(0.5 - va) * H);
        scl.makeScale(p.flip ? -W : W, 1, H);
      } else {
        off.makeTranslation((0.5 - ua) * W, (0.5 - va) * H, 0);
        scl.makeScale(p.flip ? -W : W, H, 1);
      }
      pos.makeTranslation(p.x, p.y, p.z);
      m.copy(pos).multiply(rot).multiply(off).multiply(scl);
      mesh.setMatrixAt(i, m);
      rects.set([x / AW, 1 - (y + h) / AH, w / AW, h / AH], i * 4);
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
        '#include <common>\nattribute vec4 uvRect;\nattribute vec2 swayData;\nuniform float uTime;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uvRect.xy + uv * uvRect.zw;')
      .replace(
        '#include <begin_vertex>',
        upright
          ? `#include <begin_vertex>
             float swayT = uv.y * uv.y;
             transformed.x += sin(uTime * 1.4 + swayData.y) * swayData.x * swayT / max(length(instanceMatrix[0].xyz), 1e-4);`
          : '#include <begin_vertex>',
      );
  };
  mat.customProgramCacheKey = () => (upright ? 'atlas-upright' : 'atlas-ground');
}
