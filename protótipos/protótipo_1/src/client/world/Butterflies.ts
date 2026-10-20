import * as THREE from 'three';
import type { SpriteAtlas } from '../render/Billboards';
import { BILLBOARD_STRETCH, CAMERA_YAW_DEG, PX_PER_METER } from '../render/IsoCamera';

const COLORS = ['white', 'yellow', 'blue', 'orange'];
const COUNT = 18;
const RANGE = 13; // butterflies farther than this from the player fly off and reappear nearer

// per-frame scratch (update allocates nothing)
const _rot = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(CAMERA_YAW_DEG));
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();

interface Fly {
  home: THREE.Vector2;
  color: string;
  phase: number;
  speed: number;
  radius: number;
  flap: number;
}

/**
 * A few painted butterflies wandering over the meadows around the player (one instanced draw).
 * Purely cosmetic and client-side: they never touch the simulation.
 */
export class Butterflies {
  readonly mesh: THREE.InstancedMesh;
  private readonly flies: Fly[] = [];
  private readonly rects: THREE.InstancedBufferAttribute;
  private time = 0;
  private seed = 1;

  constructor(
    private readonly atlas: SpriteAtlas,
    texture: THREE.Texture,
    private readonly height: (x: number, z: number) => number,
    private readonly allowed: (x: number, z: number) => boolean,
  ) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.rects = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4);
    this.rects.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('uvRect', this.rects);
    const mat = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 uvRect;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uvRect.xy + uv * uvRect.zw;');
    };
    mat.customProgramCacheKey = () => 'butterflies';
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private spawn(fly: Fly | null, cx: number, cz: number, near: boolean): Fly {
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = near ? 2 + this.rand() * (RANGE - 3) : RANGE * (0.6 + this.rand() * 0.35);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!this.allowed(x, z) && tries < 11) continue;
      const f = fly ?? ({} as Fly);
      f.home = new THREE.Vector2(x, z);
      f.color = COLORS[Math.floor(this.rand() * COLORS.length)];
      f.phase = this.rand() * 100;
      f.speed = 0.35 + this.rand() * 0.35;
      f.radius = 0.8 + this.rand() * 1.6;
      f.flap = 7 + this.rand() * 5;
      return f;
    }
    throw new Error('unreachable');
  }

  /** Moves the butterflies around the player at (cx, cz). */
  update(dt: number, cx: number, cz: number): void {
    this.time += dt;
    if (this.flies.length === 0) for (let i = 0; i < COUNT; i++) this.flies.push(this.spawn(null, cx, cz, true));
    const [AW, AH] = this.atlas.size;
    const ppm = this.atlas.pxPerMeter || PX_PER_METER;
    this.flies.forEach((f, i) => {
      if (Math.hypot(f.home.x - cx, f.home.y - cz) > RANGE) this.spawn(f, cx, cz, false);
      const t = this.time * f.speed + f.phase;
      // lazy figure-of-eight around the home point, bobbing up and down
      const x = f.home.x + Math.sin(t) * f.radius;
      const z = f.home.y + Math.sin(t * 2.1) * f.radius * 0.6;
      const y = this.height(x, z) + 0.55 + Math.sin(t * 3.3) * 0.25 + Math.sin(this.time * 9 + f.phase) * 0.05;
      const open = Math.sin(this.time * f.flap + f.phase) > -0.2;
      const frame = this.atlas.frames[`butterfly_${f.color}_${open ? 0 : 1}`];
      const [rx, ry, rw, rh] = frame.rect;
      // face the direction of travel: mirrored through the uv rect (a negative instance scale
      // would reverse the winding and cull the single-sided quad)
      const flip = Math.cos(t) < 0;
      this.rects.setXYZW(i, (flip ? rx + rw : rx) / AW, 1 - (ry + rh) / AH, (flip ? -rw : rw) / AW, rh / AH);
      _s.makeScale(rw / ppm, (rh / ppm) * BILLBOARD_STRETCH, 1);
      _m.makeTranslation(x, y, z).multiply(_rot).multiply(_s);
      this.mesh.setMatrixAt(i, _m);
    });
    this.rects.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees the geometry, instance buffers and material (the atlas texture is shared). */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
