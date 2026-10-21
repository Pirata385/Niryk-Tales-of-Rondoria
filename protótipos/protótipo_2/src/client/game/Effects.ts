import * as THREE from 'three';
import { WOLF } from '@shared/constants';
import type { WorldData } from '@shared/world/worldgen';

/** The bite's reach as the server checks it (shared/constants WOLF, GameServer's attack). */
const BITE_REACH = WOLF.attackRange + 0.7;
const BITE_HALF_ANGLE = Math.PI / 2.5;
/** Health bar: height of its center over a wolf's feet (m) and how far away it still shows. */
const BAR_LIFT = 1.45;
const BAR_RANGE = 34;
/** The "!" over a wolf about to bite. */
const WARN_LIFT = 1.85;
const NUMBER_LIFE = 0.95;

interface Floating {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  drift: number;
}

interface Bar {
  el: HTMLElement;
  fill: HTMLElement;
  used: boolean;
  shownFill: number;
}

interface Warn {
  id: number;
  used: boolean;
  mesh: THREE.Mesh;
  progress: { value: number };
  glyph: HTMLElement;
  /** Where the "!" floats (over the wolf's head). */
  at: THREE.Vector3;
}

const _p = new THREE.Vector3();
const _ndc = new THREE.Vector3();

/**
 * Combat feedback over the 3D view: floating damage numbers and wolf health bars (DOM, crisp at
 * any distance), and the bite warning of a wolf winding up: the area its bite reaches painted on
 * the ground in front of it, filling as the bite comes, with a "!" over its head. Immediate mode:
 * every frame call `beginFrame()`, then `wolfBar()` / `telegraph()` for what should show, then
 * `update()` after the camera moved. Everything is pooled; nothing is allocated per frame.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly floating: Floating[] = [];
  private readonly spare: Floating[] = [];
  private readonly bars: Bar[] = [];
  private barsUsed = 0;
  private readonly barPos: THREE.Vector3[] = [];
  private readonly warns: Warn[] = [];
  private readonly sectorGeo: THREE.BufferGeometry;
  /** Local (x, z) of the sector's vertices: re-draped on the ground every frame. */
  private readonly sectorXZ: Float32Array;

  constructor(
    private readonly layer: HTMLElement,
    private readonly world: WorldData,
  ) {
    this.group.name = 'Effects';
    // a fan in front of the wolf (+Z), with each vertex's (r / R, angle / half) for the shader
    const rings = 6;
    const segs = 22;
    const pos: number[] = [];
    const local: number[] = [];
    const xz: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rings; j++) {
      const r = (j / rings) * BITE_REACH;
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * 2 - 1;
        const a = t * BITE_HALF_ANGLE;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        pos.push(x, 0, z);
        xz.push(x, z);
        local.push(j / rings, t);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    this.sectorXZ = new Float32Array(xz);
    this.sectorGeo = new THREE.BufferGeometry();
    this.sectorGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.sectorGeo.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 2));
    this.sectorGeo.setIndex(index);
  }

  /** A number floating up from a hit (world position of the target's feet). */
  damageNumber(x: number, y: number, z: number, amount: number, kind: 'enemy' | 'player', crit = false): void {
    const f = this.spare.pop() ?? { el: document.createElement('div'), pos: new THREE.Vector3(), age: 0, drift: 0 };
    f.el.className = `dmg dmg-${kind}${crit ? ' dmg-crit' : ''}`;
    f.el.textContent = String(amount);
    f.el.hidden = false;
    this.layer.appendChild(f.el); // (re)appended: the newest number draws on top
    f.pos.set(x, y + 1.35, z);
    f.age = 0;
    f.drift = (Math.random() - 0.5) * 40;
    this.floating.push(f);
  }

  /** Hides every bar and warning; call once per frame before requesting this frame's ones. */
  beginFrame(): void {
    this.barsUsed = 0;
    for (const w of this.warns) w.used = false;
  }

  /** A health bar over a wolf (feet at x, y, z): only while it is alive and wounded. */
  wolfBar(x: number, y: number, z: number, hp: number, maxHp: number): void {
    if (hp <= 0 || hp >= maxHp) return;
    let bar = this.bars[this.barsUsed];
    if (!bar) {
      const el = document.createElement('div');
      el.className = 'wolf-bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      el.append(fill);
      this.layer.append(el);
      bar = { el, fill, used: false, shownFill: -1 };
      this.bars.push(bar);
      this.barPos.push(new THREE.Vector3());
    }
    this.barPos[this.barsUsed].set(x, y + BAR_LIFT, z);
    const f = Math.max(0.04, hp / maxHp);
    if (Math.abs(f - bar.shownFill) > 0.001) {
      bar.fill.style.transform = `scaleX(${f.toFixed(3)})`;
      bar.shownFill = f;
    }
    bar.used = true;
    this.barsUsed++;
  }

  /** The bite warning of wolf `id` at (x, ground y, z) facing `yaw`, `progress` 0..1 of the windup. */
  telegraph(id: number, x: number, y: number, z: number, yaw: number, progress: number): void {
    let w: Warn | undefined;
    for (let i = 0; i < this.warns.length && !w; i++) if (this.warns[i].id === id) w = this.warns[i];
    for (let i = 0; i < this.warns.length && !w; i++) if (!this.warns[i].used && this.warns[i].id < 0) w = this.warns[i];
    w ??= this.newWarn();
    w.id = id;
    w.used = true;
    w.progress.value = Math.min(1, Math.max(0, progress));
    w.mesh.position.set(x, y, z);
    w.mesh.rotation.y = yaw;
    w.mesh.visible = true;
    // drape the fan over the ground (this sector's own geometry copy)
    const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
      const lx = this.sectorXZ[i * 2];
      const lz = this.sectorXZ[i * 2 + 1];
      pos.setY(i, this.world.height(x + lx * c + lz * s, z - lx * s + lz * c) - y + 0.06);
    }
    pos.needsUpdate = true;
    w.at.set(x, y + WARN_LIFT, z);
  }

  /** Once per frame after the camera is placed: moves the DOM markers and retires the unused ones. */
  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    // damage numbers
    let n = 0;
    for (let i = 0; i < this.floating.length; i++) {
      const f = this.floating[i];
      f.age += dt;
      const k = f.age / NUMBER_LIFE;
      if (k >= 1 || !project(_p.copy(f.pos).setY(f.pos.y + k * 0.7), camera, width, height)) {
        if (k >= 1) {
          f.el.hidden = true;
          this.spare.push(f);
          continue;
        }
        f.el.style.opacity = '0';
        this.floating[n++] = f;
        continue;
      }
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : k < 0.22 ? 1.1 - ((k - 0.12) / 0.1) * 0.1 : 1;
      f.el.style.transform = `translate(${Math.round(_ndc.x + f.drift * k)}px, ${Math.round(_ndc.y)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = k > 0.7 ? ((1 - k) / 0.3).toFixed(2) : '1';
      this.floating[n++] = f;
    }
    this.floating.length = n;

    // health bars
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i];
      const p = this.barPos[i];
      const show = i < this.barsUsed && camera.position.distanceTo(p) < BAR_RANGE && project(_p.copy(p), camera, width, height);
      if (!show) {
        if (!bar.el.hidden) bar.el.hidden = true;
        continue;
      }
      bar.el.hidden = false;
      bar.el.style.transform = `translate(${Math.round(_ndc.x)}px, ${Math.round(_ndc.y)}px) translate(-50%, -50%)`;
    }

    // bite warnings
    for (const w of this.warns) {
      if (!w.used) {
        w.mesh.visible = false;
        w.glyph.hidden = true;
        w.id = -1;
        continue;
      }
      if (!project(_p.copy(w.at), camera, width, height)) {
        w.glyph.hidden = true;
        continue;
      }
      w.glyph.hidden = false;
      const scale = 0.8 + w.progress.value * 0.45;
      w.glyph.style.transform = `translate(${Math.round(_ndc.x)}px, ${Math.round(_ndc.y)}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }

  dispose(): void {
    for (const f of [...this.floating, ...this.spare]) f.el.remove();
    this.floating.length = 0;
    this.spare.length = 0;
    for (const b of this.bars) b.el.remove();
    for (const w of this.warns) {
      w.glyph.remove();
      w.mesh.geometry.dispose();
      (w.mesh.material as THREE.Material).dispose();
    }
    this.sectorGeo.dispose();
    this.group.removeFromParent();
  }

  private newWarn(): Warn {
    const progress = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      name: 'BiteWarning',
      uniforms: { uProgress: progress },
      vertexShader: /* glsl */ `
        attribute vec2 aLocal;
        varying vec2 vLocal;
        void main() {
          vLocal = aLocal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // raw output values (no color management): a hot red-orange with an ink rim
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        varying vec2 vLocal;
        void main() {
          float r = vLocal.x;
          float a = abs(vLocal.y);
          float fr = fwidth(r) * 1.5;
          float fa = fwidth(a) * 1.5;
          vec3 red = vec3(1.0, 0.32, 0.2);
          vec3 ink = vec3(0.106, 0.078, 0.141);
          float filled = 1.0 - smoothstep(uProgress - fr, uProgress + fr, r);
          vec4 c = vec4(red, mix(0.12, 0.42, filled));
          float lead = 1.0 - smoothstep(0.0, 0.035 + fr, abs(r - uProgress));
          c = mix(c, vec4(1.0, 0.85, 0.6, 0.95), lead * step(0.02, uProgress));
          float rim = max(smoothstep(0.9 - fr, 0.9 + fr, r), smoothstep(0.92 - fa, 0.92 + fa, a));
          c = mix(c, vec4(red, 0.95), rim);
          float inkRim = max(smoothstep(0.965 - fr, 0.965 + fr, r), smoothstep(0.975 - fa, 0.975 + fa, a));
          c = mix(c, vec4(ink, 0.9), inkRim);
          gl_FragColor = c;
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(this.sectorGeo.clone(), mat);
    mesh.name = 'BiteWarning';
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const glyph = document.createElement('div');
    glyph.className = 'warn-glyph';
    glyph.textContent = '!';
    glyph.hidden = true;
    this.layer.append(glyph);
    const w: Warn = { id: -1, used: false, mesh, progress, glyph, at: new THREE.Vector3() };
    this.warns.push(w);
    return w;
  }
}

/** World point -> css px in _ndc.x/_ndc.y; false when it is behind the camera or off the far plane. */
function project(p: THREE.Vector3, camera: THREE.Camera, width: number, height: number): boolean {
  _ndc.copy(p).project(camera);
  if (_ndc.z < -1 || _ndc.z > 1) return false;
  _ndc.x = (_ndc.x * 0.5 + 0.5) * width;
  _ndc.y = (-_ndc.y * 0.5 + 0.5) * height;
  return true;
}
