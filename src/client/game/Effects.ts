import * as THREE from 'three';
import type { IsoCamera } from '../render/IsoCamera';
import type { PixelPipeline } from '../render/PixelPipeline';

interface Floating {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
}

interface Timed {
  obj: THREE.Mesh;
  age: number;
  life: number;
  update: (k: number) => void;
}

/**
 * Combat feedback: floating damage numbers (DOM, pixel font), sword slash arcs and wolf bite
 * warnings (meshes on the ground) so attacks read clearly at a glance.
 */
export class Effects {
  readonly group = new THREE.Group();
  private floating: Floating[] = [];
  private timed: Timed[] = [];
  private readonly telegraphs = new Map<number, THREE.Mesh>();
  private readonly ringGeo = new THREE.RingGeometry(0.55, 0.75, 24, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  private readonly slashGeo: THREE.BufferGeometry;

  constructor(
    private readonly layer: HTMLElement,
    private readonly pipeline: PixelPipeline,
    private readonly iso: IsoCamera,
  ) {
    // a 130° crescent lying on the ground, opening toward +Z
    const shape = new THREE.Shape();
    const a0 = -1.13;
    const a1 = 1.13;
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
  }

  damageNumber(world: THREE.Vector3, amount: number, kind: 'enemy' | 'player', crit = false): void {
    const el = document.createElement('div');
    el.className = `dmg dmg-${kind}${crit ? ' dmg-crit' : ''}`;
    el.textContent = String(amount);
    this.layer.appendChild(el);
    this.floating.push({ el, pos: world.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6, 0)), age: 0, life: 0.9 });
  }

  slash(x: number, y: number, z: number, yaw: number, mirrored: boolean): void {
    const mat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.slashGeo, mat);
    mesh.position.set(x, y + 0.9, z);
    mesh.rotation.y = yaw;
    if (mirrored) mesh.scale.x = -1;
    mesh.renderOrder = 5;
    this.group.add(mesh);
    this.timed.push({
      obj: mesh,
      age: 0,
      life: 0.16,
      update: (k) => {
        mat.opacity = 0.9 * (1 - k);
        mesh.scale.setScalar(0.9 + 0.2 * k);
        if (mirrored) mesh.scale.x *= -1;
      },
    });
  }

  /** Red ring under a wolf that is about to bite. */
  telegraph(id: number, on: boolean, x: number, y: number, z: number, progress: number): void {
    let ring = this.telegraphs.get(id);
    if (!on) {
      if (ring) {
        this.group.remove(ring);
        this.telegraphs.delete(id);
      }
      return;
    }
    if (!ring) {
      ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#ff5a48', transparent: true, opacity: 0.8, depthWrite: false }));
      ring.renderOrder = 4;
      this.telegraphs.set(id, ring);
      this.group.add(ring);
    }
    ring.position.set(x, y + 0.05, z);
    ring.scale.setScalar(1.6 - 0.8 * progress);
  }

  update(dt: number, cssW: number, cssH: number): void {
    this.floating = this.floating.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        f.el.remove();
        return false;
      }
      const p = this.pipeline.worldToCss(f.pos.clone().add(new THREE.Vector3(0, k * 0.8, 0)), this.iso, cssW, cssH);
      f.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%) scale(${k < 0.15 ? 0.6 + k * 3 : 1})`;
      f.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
      return true;
    });
    this.timed = this.timed.filter((t) => {
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      t.update(k);
      if (k >= 1) {
        this.group.remove(t.obj);
        (t.obj.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }
}
