import * as THREE from 'three';
import type { IsoCamera } from '../render/IsoCamera';
import type { PixelPipeline } from '../render/PixelPipeline';
import { WarningRings } from './Markers';

interface Floating {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
}

interface Slash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  mirrored: boolean;
}

/** Lifetime of a slash flash (s). */
const SLASH_LIFE = 0.12;

const _pos = new THREE.Vector3();
const _css = new THREE.Vector2();

/**
 * Combat feedback: floating damage numbers (DOM, pixel font), sword slash arcs and wolf bite
 * warnings (rings on the ground, see WarningRings) so attacks read clearly at a glance.
 * Everything is pooled: the per-frame update allocates nothing but the DOM style strings.
 */
export class Effects {
  readonly group = new THREE.Group();
  /** Live damage numbers (compacted in place) and the hidden ones waiting for reuse. */
  private readonly floating: Floating[] = [];
  private readonly spareFloating: Floating[] = [];
  private readonly slashes: Slash[] = [];
  private readonly rings: WarningRings;
  private readonly slashGeo: THREE.BufferGeometry;

  constructor(
    private readonly layer: HTMLElement,
    private readonly pipeline: PixelPipeline,
    private readonly iso: IsoCamera,
  ) {
    // a 160° crescent at waist height, opening toward +Z (the sword trail of a cut)
    const shape = new THREE.Shape();
    const a0 = -1.4;
    const a1 = 1.4;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const p = new THREE.Vector2(Math.sin(a) * 1.9, Math.cos(a) * 1.9);
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const w = 1.35 + 0.25 * Math.sin(Math.PI * (i / steps)) ** 2;
      shape.lineTo(Math.sin(a) * w, Math.cos(a) * w);
    }
    this.slashGeo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    this.rings = new WarningRings(pipeline, iso);
    this.group.add(this.rings.group);
  }

  damageNumber(world: THREE.Vector3, amount: number, kind: 'enemy' | 'player', crit = false): void {
    let f = this.spareFloating.pop();
    if (!f) {
      f = { el: document.createElement('div'), pos: new THREE.Vector3(), age: 0, life: 0.9 };
    }
    f.el.className = `dmg dmg-${kind}${crit ? ' dmg-crit' : ''}`;
    f.el.textContent = String(amount);
    f.el.hidden = false;
    this.layer.appendChild(f.el); // (re)appended: the newest number draws on top
    f.pos.copy(world);
    f.pos.x += (Math.random() - 0.5) * 0.4;
    f.pos.y += 1.6;
    f.age = 0;
    this.floating.push(f);
  }

  slash(x: number, y: number, z: number, yaw: number, mirrored: boolean): void {
    let s: Slash | undefined;
    for (let i = 0; i < this.slashes.length && !s; i++) if (!this.slashes[i].mesh.visible) s = this.slashes[i];
    if (!s) {
      const mat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.slashGeo, mat);
      mesh.renderOrder = 5;
      this.group.add(mesh);
      s = { mesh, mat, age: 0, mirrored: false };
      this.slashes.push(s);
    }
    s.mesh.position.set(x, y + 0.9, z);
    s.mesh.rotation.y = yaw;
    s.mirrored = mirrored;
    s.age = 0;
    s.mesh.visible = true;
    this.animateSlash(s, 0);
  }

  /**
   * Red ring under a wolf that is about to bite; call every frame for every wolf (on/off).
   * Drawn above canopies and houses. A ring whose wolf stops calling this (removed from the
   * scene) disappears at the next `update`.
   */
  telegraph(id: number, on: boolean, x: number, y: number, z: number, progress: number): void {
    this.rings.set(id, on, x, y, z, progress);
  }

  /** Once per frame, after pipeline.render (damage numbers follow the camera of this frame). */
  update(dt: number, cssW: number, cssH: number): void {
    let n = 0;
    for (let i = 0; i < this.floating.length; i++) {
      const f = this.floating[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        f.el.hidden = true;
        this.spareFloating.push(f);
        continue;
      }
      _pos.copy(f.pos);
      _pos.y += k * 0.8;
      const p = this.pipeline.worldToCss(_pos, this.iso, cssW, cssH, _css);
      f.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%) scale(${k < 0.15 ? 0.6 + k * 3 : 1})`;
      f.el.style.opacity = k > 0.7 ? String((1 - k) / 0.3) : '1';
      this.floating[n++] = f;
    }
    this.floating.length = n;

    for (let i = 0; i < this.slashes.length; i++) {
      const s = this.slashes[i];
      if (!s.mesh.visible) continue;
      s.age += dt;
      const k = Math.min(1, s.age / SLASH_LIFE);
      this.animateSlash(s, k);
      if (k >= 1) s.mesh.visible = false;
    }

    this.rings.sweep();
  }

  /** Frees the GPU resources and DOM nodes (call when leaving the game). */
  dispose(): void {
    for (const f of this.floating) f.el.remove();
    for (const f of this.spareFloating) f.el.remove();
    this.floating.length = 0;
    this.spareFloating.length = 0;
    for (const s of this.slashes) s.mat.dispose();
    this.slashGeo.dispose();
    this.rings.dispose();
    this.group.removeFromParent();
  }

  /** A quick flash that fades out while it widens a little. */
  private animateSlash(s: Slash, k: number): void {
    s.mat.opacity = 1 - k;
    s.mesh.scale.setScalar(0.9 + 0.2 * k);
    if (s.mirrored) s.mesh.scale.x *= -1;
  }
}
