import * as THREE from 'three';
import type { IsoCamera } from '../render/IsoCamera';
import { LAYER_OVERLAY, type PixelPipeline } from '../render/PixelPipeline';

/** Player ground ring: radius (m), color and opacity (critic G9 #14a). */
const RING_RADIUS = 0.5;
const RING_COLOR = '#f4f1e6';
const RING_OPACITY = 0.35;
/**
 * The ring is pulled this far toward the camera along the view axis. In an orthographic view
 * that changes only its depth, not its pixels: it then wins against small bumps of the terrain
 * under it, yet still loses against the legs standing in it (≈0.5 m nearer for its back arc).
 */
const RING_DEPTH_BIAS = 0.2;

/** Health bar: filled area in internal pixels, plus a 1 px ink border around it. */
const BAR_W = 24;
const BAR_H = 3;
/** Height of the bar's center above the wolf's feet (clear of its head and ears). */
const BAR_LIFT = 1.25;

/** Wolf lunge warning: ring radius (m) at the start and at the end of the windup. */
const WARN_R0 = 1.05;
const WARN_R1 = 0.55;
/** Half-size (m) of the warning quad: the largest ring plus its band. */
const WARN_EXTENT = WARN_R0 + 0.2;
const _p = new THREE.Vector3();

/** sRGB hex -> raw sRGB components (overlay shaders write the final image: no color management). */
function srgb(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Flat quad lying on the ground (XZ), centered on the origin. */
function groundQuad(half: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2);
}

// Ground-quad shaders get the local ground position (meters) and turn it into a crisp line of a
// fixed width in INTERNAL PIXELS: the distance to the circle is divided by how many meters one
// pixel step covers along the screen axis that crosses the line most (x near the ellipse's top
// and bottom, y at its sides). That gives exactly one pixel per column/row: a clean 8-connected
// pixel-art ellipse at any zoom, with no gaps where the ground is foreshortened.
const GROUND_VS = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_PX_GLSL = /* glsl */ `
float ringPixels(vec2 local, float radius) {
  float d = length(local);
  vec2 n = local / max(d, 1e-5);
  float pxStep = max(abs(dot(n, dFdx(local))), abs(dot(n, dFdy(local))));
  return (d - radius) / pxStep;
}`;

function playerRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      radius: { value: RING_RADIUS },
      color: { value: new THREE.Color(RING_COLOR) }, // beauty pass: linear, graded with the world
      opacity: { value: RING_OPACITY },
    },
    vertexShader: GROUND_VS,
    fragmentShader: /* glsl */ `
      uniform float radius;
      uniform vec3 color;
      uniform float opacity;
      varying vec2 vLocal;
      ${RING_PX_GLSL}
      void main() {
        if (abs(ringPixels(vLocal, radius)) >= 0.5) discard; // 1 internal pixel wide
        gl_FragColor = vec4(color, opacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

function warningRingMaterial(pipeline: PixelPipeline, iso: IsoCamera): THREE.ShaderMaterial {
  const depthRange = iso.camera.far - iso.camera.near; // orthographic: window depth is linear
  return new THREE.ShaderMaterial({
    uniforms: {
      radius: { value: WARN_R0 },
      fill: { value: srgb('#ff5a48') },
      ink: { value: srgb('#1b1424') },
      opacity: { value: 0.9 },
      tXrayDepth: { value: pipeline.xrayDepth },
    },
    vertexShader: GROUND_VS,
    fragmentShader: /* glsl */ `
      uniform float radius;
      uniform vec3 fill;
      uniform vec3 ink;
      uniform float opacity;
      uniform sampler2D tXrayDepth;
      varying vec2 vLocal;
      ${RING_PX_GLSL}
      void main() {
        // 4 px band: ink, red, red, ink (reads on grass, dirt and stone alike)
        float t = ringPixels(vLocal, radius);
        if (abs(t) >= 2.0) discard;
        // drawn over canopies and roofs, but under the creatures standing on it
        float zx = texelFetch(tXrayDepth, ivec2(gl_FragCoord.xy), 0).r;
        if (zx < 1.0 && (gl_FragCoord.z - zx) * ${depthRange.toFixed(1)} > 0.05) discard;
        gl_FragColor = vec4(abs(t) < 1.0 ? fill : ink, opacity);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

function healthBarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      filled: { value: BAR_W },
      ink: { value: srgb('#1b1424') },
      red: { value: srgb('#d8402f') },
      shine: { value: srgb('#ff7f5f') },
      empty: { value: srgb('#3e2131') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float filled;
      uniform vec3 ink;
      uniform vec3 red;
      uniform vec3 shine;
      uniform vec3 empty;
      varying vec2 vUv;
      const vec2 SIZE = vec2(${BAR_W + 2}.0, ${BAR_H + 2}.0);
      void main() {
        vec2 p = floor(vUv * SIZE); // the quad is snapped to the texel grid: one cell per pixel
        vec3 c;
        if (p.x < 1.0 || p.y < 1.0 || p.x > SIZE.x - 2.0 || p.y > SIZE.y - 2.0) c = ink;
        else if (p.x - 1.0 < filled) c = p.y > SIZE.y - 3.0 ? shine : red;
        else c = empty;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, // sorted with the other overlay markers by renderOrder
    depthTest: false,
    depthWrite: false,
  });
}

interface Bar {
  mesh: THREE.Mesh;
  filled: { value: number };
}

/**
 * Legibility markers for the small phone view (critic G9 #14): a thin light ring on the ground
 * under the local player, and pixel health bars over wounded wolves that stay visible above
 * canopies. Immediate-mode: call `beginFrame()`, then `playerRing()` / `wolfBar()` for whatever
 * should show this frame; everything not requested again is hidden. Bars are pooled by slot,
 * so wolves despawning or respawning with new ids need no bookkeeping. Nothing is allocated per
 * frame (the pool only grows when more wounded wolves are on screen at once than ever before).
 */
export class Markers {
  /** Add to the game scene. Holds the ground ring (beauty pass) and the bars (overlay layer). */
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly bars: Bar[] = [];
  private readonly barGeo = new THREE.PlaneGeometry(1, 1);
  private used = 0;

  constructor(private readonly iso: IsoCamera) {
    this.ring = new THREE.Mesh(groundQuad(RING_RADIUS + 0.1), playerRingMaterial());
    this.ring.renderOrder = 1; // after the sprites' ground shadows (-1), with the depth test on
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /** Hides every marker; call once per frame before requesting this frame's markers. */
  beginFrame(): void {
    this.ring.visible = false;
    for (let i = 0; i < this.used; i++) this.bars[i].mesh.visible = false;
    this.used = 0;
  }

  /** Light ring on the ground under the local player (x, z and the terrain height there). */
  playerRing(x: number, groundY: number, z: number): void {
    const p = this.iso.snapToTexels(_p.set(x, groundY, z));
    this.ring.position.copy(p).addScaledVector(this.iso.back, RING_DEPTH_BIAS);
    this.ring.visible = true;
  }

  /** Health bar over a wolf; shows only while it is alive and wounded (0 < hp < maxHp). */
  wolfBar(x: number, groundY: number, z: number, hp: number, maxHp: number): void {
    if (hp <= 0 || hp >= maxHp) return;
    const bar = this.bars[this.used] ?? this.newBar();
    this.used++;
    // floor keeps a sliver of the dark part on any wound; never less than one red pixel
    bar.filled.value = Math.max(1, Math.floor((BAR_W * hp) / maxHp));
    const ppm = this.iso.pixelsPerMeter;
    bar.mesh.scale.set((BAR_W + 2) / ppm, (BAR_H + 2) / ppm, 1);
    bar.mesh.position.copy(this.iso.snapToTexels(_p.set(x, groundY + BAR_LIFT, z), BAR_W + 2, BAR_H + 2));
    bar.mesh.visible = true;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    for (const b of this.bars) (b.mesh.material as THREE.Material).dispose();
    this.barGeo.dispose();
    this.group.removeFromParent();
  }

  private newBar(): Bar {
    const mat = healthBarMaterial();
    const mesh = new THREE.Mesh(this.barGeo, mat);
    mesh.layers.set(LAYER_OVERLAY);
    mesh.quaternion.copy(this.iso.camera.quaternion); // faces the fixed camera
    mesh.renderOrder = 20; // above the warning rings
    mesh.visible = false;
    this.group.add(mesh);
    const bar = { mesh, filled: mat.uniforms.filled as { value: number } };
    this.bars.push(bar);
    return bar;
  }
}

interface WarnRing {
  mesh: THREE.Mesh;
  radius: { value: number };
  /** Wolf id, or -1 when the ring is free. */
  id: number;
  seen: boolean;
}

/**
 * Pooled wolf lunge warnings (used by Effects.telegraph). Each ring keeps its own material for
 * life; rings are drawn on LAYER_OVERLAY so canopies and houses never hide them, while the wolf
 * (and the player) standing on one still covers it. A ring whose wolf stops reporting (despawned,
 * view removed) is freed by `sweep()`.
 */
export class WarningRings {
  readonly group = new THREE.Group();
  private readonly rings: WarnRing[] = [];
  private readonly geo = groundQuad(WARN_EXTENT);

  constructor(
    private readonly pipeline: PixelPipeline,
    private readonly iso: IsoCamera,
  ) {}

  /** Per wolf and frame: `on` while the bite winds up, `progress` 0..1 shrinks the ring. */
  set(id: number, on: boolean, x: number, y: number, z: number, progress: number): void {
    let ring = this.find(id);
    if (!on) {
      if (ring) this.free(ring);
      return;
    }
    if (!ring) {
      ring = this.find(-1) ?? this.newRing();
      ring.id = id;
      ring.mesh.visible = true;
    }
    ring.seen = true;
    const ppm = this.iso.pixelsPerMeter;
    const r = WARN_R0 + (WARN_R1 - WARN_R0) * Math.min(1, Math.max(0, progress));
    ring.radius.value = Math.max(2, Math.round(r * ppm)) / ppm; // shrinks in whole pixels
    ring.mesh.position.copy(this.iso.snapToTexels(_p.set(x, y + 0.02, z)));
  }

  /** Once per frame (Effects.update): frees the rings that were not set since the last sweep. */
  sweep(): void {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.id < 0) continue;
      if (!r.seen) this.free(r);
      r.seen = false;
    }
  }

  dispose(): void {
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
    this.geo.dispose();
    this.group.removeFromParent();
  }

  /** Ring of this wolf id (-1: any free ring). Index loop: no iterator per call. */
  private find(id: number): WarnRing | undefined {
    for (let i = 0; i < this.rings.length; i++) if (this.rings[i].id === id) return this.rings[i];
    return undefined;
  }

  private free(ring: WarnRing): void {
    ring.id = -1;
    ring.seen = false;
    ring.mesh.visible = false;
  }

  private newRing(): WarnRing {
    const mat = warningRingMaterial(this.pipeline, this.iso);
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.layers.set(LAYER_OVERLAY);
    mesh.renderOrder = 10;
    this.group.add(mesh);
    const ring = { mesh, radius: mat.uniforms.radius as { value: number }, id: -1, seen: false };
    this.rings.push(ring);
    return ring;
  }
}
