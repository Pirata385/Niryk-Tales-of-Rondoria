import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bodyModel, type Appearance } from '@shared/appearance';
import { BACKPEDAL_FACTOR, RUN_SPEED, WALK_SPEED } from '@shared/constants';
import { loadModelOrNull } from '../core/assets';
import { addOutline } from '../render/outline';
import { toonFromGltf } from '../render/toon';
import { PlaceholderRig, buildPlaceholderHuman } from './placeholder';

export type OneShot = 'Attack1' | 'Attack2' | 'Hit' | 'Death';
type Loco = 'Idle' | 'Walk' | 'Run' | 'WalkBack' | 'StrafeLeft' | 'StrafeRight';
const MOVING: Exclude<Loco, 'Idle'>[] = ['Walk', 'Run', 'WalkBack', 'StrafeLeft', 'StrafeRight'];
/** Speed (m/s) each locomotion clip is authored for: playback follows the real speed (no sliding). */
const CLIP_SPEED: Record<Exclude<Loco, 'Idle'>, number> = {
  Walk: WALK_SPEED,
  Run: RUN_SPEED,
  WalkBack: WALK_SPEED * BACKPEDAL_FACTOR,
  StrafeLeft: WALK_SPEED,
  StrafeRight: WALK_SPEED,
};
/** Materials without ink: eyes and small dark details read better clean. */
const NO_INK = /^(Eye|EyeWhite|Dark)/;
/** Hidden in first person (the camera sits inside the head). */
const FIRST_PERSON_HIDDEN = /^(Head_|Hair_)/;

const DARK_FLOOR = new THREE.Color('#4a4560');
const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const MIN_LUMA = luma(new THREE.Color('#3c3750'));

/** Very dark slot colors are lifted toward a cool dark violet so they keep their toon bands. */
function liftDark(c: THREE.Color): THREE.Color {
  const y = luma(c);
  if (y >= MIN_LUMA) return c;
  return c.lerp(DARK_FLOOR, Math.min(1, (MIN_LUMA - y) / Math.max(1e-6, luma(DARK_FLOOR) - y)));
}

/**
 * Frees what an instance owns: its toon materials and cloned skeletons. Geometries and textures
 * belong to the cached GLTF (or to the placeholder, which is rebuilt per view and disposed here).
 */
export function disposeInstance(root: THREE.Object3D, geometries = false): void {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.userData.isOutline) {
      if (Array.isArray(mesh.material)) for (const m of mesh.material) m.dispose();
      else mesh.material.dispose();
    }
    if (geometries) mesh.geometry.dispose();
    const skinned = o as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton);
  });
  for (const s of skeletons) s.dispose();
}

/**
 * A rigged character: the body GLB from Pyram3D (or a placeholder hero while it is missing) with
 * toon materials per color slot and ink hulls on the same skeleton. Locomotion is a blend of
 * Idle/Walk/Run/WalkBack/StrafeLeft/StrafeRight from the velocity relative to the facing, all
 * moving clips on one shared phase so the feet stay in step; the one-shots (Attack1/2, Hit, Death)
 * fade in over it.
 */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  /** The head bone: where the first-person camera sits. */
  readonly head: THREE.Object3D | null;
  readonly placeholder: boolean;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly slots = new Map<string, THREE.MeshToonMaterial[]>();
  private readonly rig: PlaceholderRig | null;
  private readonly durations = new Map<string, number>();
  /** Local velocity (m/s): x to the character's left (+X), z forward. */
  private readonly vel = new THREE.Vector2();
  private phase = 0;
  private shot: { name: OneShot; t: number; action: THREE.AnimationAction | null; weight: number } | null = null;
  private flashAmount = 0;
  private firstPerson = false;
  appearance: Appearance;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], appearance: Appearance, rig: PlaceholderRig | null) {
    this.model = model;
    this.appearance = appearance;
    this.rig = rig;
    this.placeholder = rig !== null;
    this.root.add(model);
    this.head = model.getObjectByName('Head') ?? null;
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const t = rig ? (src as THREE.MeshToonMaterial) : toonFromGltf(src, { rim: 1 });
      const list = this.slots.get(t.name) ?? [];
      list.push(t);
      this.slots.set(t.name, list);
      mesh.material = t;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds are unreliable when animated
      if (!NO_INK.test(t.name) && !mesh.name.startsWith('Head_eye')) addOutline(mesh, { width: 1 });
    }
    this.mixer = rig ? null : new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer!.clipAction(clip);
      this.actions.set(clip.name, action);
      this.durations.set(clip.name, clip.duration);
    }
    // locomotion clips all run at once; their weights and times are set every frame
    for (const name of ['Idle', ...MOVING]) {
      const a = this.actions.get(name);
      if (!a) continue;
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.enabled = true;
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
      a.timeScale = name === 'Idle' ? 1 : 0;
      a.play();
    }
    this.applyAppearance(appearance);
  }

  static async create(appearance: Appearance): Promise<CharacterView> {
    const gltf = await loadModelOrNull(bodyModel(appearance));
    if (gltf) return new CharacterView(cloneSkinned(gltf.scene), gltf.animations, appearance, null);
    const parts = buildPlaceholderHuman();
    return new CharacterView(parts.root, [], appearance, new PlaceholderRig(parts));
  }

  /** Recolors the tintable slots from the appearance. */
  applyAppearance(a: Appearance): void {
    this.appearance = a;
    const tint: Record<string, string> = { Skin: a.skin, Hair: a.hairColor, Eye: a.eyeColor, Cloth_A: a.clothColor };
    for (const [slot, color] of Object.entries(tint)) {
      const c = slot === 'Eye' || slot === 'Skin' ? new THREE.Color(color) : liftDark(new THREE.Color(color));
      for (const m of this.slots.get(slot) ?? []) m.color.copy(c);
    }
    // only the chosen hair style (top nodes Hair_<style>; the placeholder has one cap)
    if (!this.placeholder) {
      const styles = new Set<string>();
      this.model.traverse((o) => {
        if (o.name.startsWith('Hair_') && !o.parent?.name.startsWith('Hair_')) styles.add(o.name);
      });
      if (styles.has(`Hair_${a.hairStyle}`)) {
        this.model.traverse((o) => {
          if (o.name.startsWith('Hair_') && !o.parent?.name.startsWith('Hair_')) o.visible = o.name === `Hair_${a.hairStyle}` && !this.firstPerson;
        });
      }
    }
  }

  /** First person: hides the head and hair (Head_*, Hair_*), keeps arms and sword. */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.model.traverse((o) => {
      if (!FIRST_PERSON_HIDDEN.test(o.name) || o.userData.isOutline) return;
      if (o.name.startsWith('Hair_') && !this.placeholder && o.parent?.name.startsWith('Hair_')) return;
      if (on) {
        o.userData.fpWasVisible = o.visible;
        o.visible = false;
      } else {
        o.visible = (o.userData.fpWasVisible as boolean | undefined) ?? true;
      }
    });
  }

  /** The velocity in the character's own frame (m/s): `left` toward its +X, `forward` along +Z. */
  setVelocity(left: number, forward: number): void {
    this.vel.set(left, forward);
  }

  /** Starts a one-shot clip (it fades in over the locomotion and back out at its end; Death holds). */
  playOneShot(name: OneShot): void {
    const action = this.actions.get(name) ?? null;
    if (action) {
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
    }
    if (this.shot?.action && this.shot.action !== action) this.shot.action.stop();
    this.shot = { name, t: 0, action, weight: 0 };
  }

  /** Back to locomotion at once (respawn). */
  clearOneShot(): void {
    this.shot?.action?.stop();
    this.shot = null;
  }

  get oneShot(): OneShot | null {
    return this.shot?.name ?? null;
  }

  /** Brief white flash when hit (0..1). */
  flash(amount: number): void {
    if (amount === this.flashAmount) return;
    this.flashAmount = amount;
    for (const list of this.slots.values()) for (const m of list) m.emissive.setScalar(amount * 0.6);
  }

  /** Finds a bone or socket by name (e.g. Socket_Weapon_R). */
  attachPoint(name: string): THREE.Object3D | undefined {
    return this.model.getObjectByName(name);
  }

  update(dt: number): void {
    const speed = this.vel.length();
    const moving = THREE.MathUtils.smoothstep(speed, 0.15, 0.9);
    // direction weights: forward / back / left / right, normalized
    const ang = Math.atan2(this.vel.x, this.vel.y);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const wf = Math.max(0, c);
    const wb = Math.max(0, -c);
    const wl = Math.max(0, s);
    const wr = Math.max(0, -s);
    const sum = wf + wb + wl + wr || 1;
    const run = THREE.MathUtils.clamp((speed - WALK_SPEED * 1.15) / (RUN_SPEED - WALK_SPEED * 1.15), 0, 1);
    const w: Record<Loco, number> = {
      Idle: 1 - moving,
      Walk: (wf / sum) * (1 - run) * moving,
      Run: (wf / sum) * run * moving,
      WalkBack: (wb / sum) * moving,
      StrafeLeft: (wl / sum) * moving,
      StrafeRight: (wr / sum) * moving,
    };

    // one-shot: fade in fast, out over its last 0.15 s (Death holds its last pose)
    let o = 0;
    if (this.shot) {
      const sh = this.shot;
      sh.t += dt;
      const dur = sh.action ? this.durations.get(sh.name) ?? 0.5 : { Attack1: 0.5, Attack2: 0.55, Hit: 0.36, Death: 99 }[sh.name];
      const fadeIn = Math.min(1, sh.t / 0.07);
      const fadeOut = sh.name === 'Death' ? 1 : THREE.MathUtils.clamp((dur - sh.t) / 0.15, 0, 1);
      o = sh.weight = Math.min(fadeIn, fadeOut);
      if (sh.name !== 'Death' && sh.t >= dur) {
        sh.action?.stop();
        this.shot = null;
        o = 0;
      }
    }

    // the shared phase of the moving clips: cycles per second from each clip's speed and length
    let rate = 0;
    let wsum = 0;
    for (const name of MOVING) {
      const d = this.clipFor(name);
      const len = (d && this.durations.get(d)) || 1;
      rate += (w[name] * Math.max(speed, 0.4)) / CLIP_SPEED[name] / len;
      wsum += w[name];
    }
    rate = wsum > 0.001 ? rate / wsum : 1 / ((this.durations.get('Walk') ?? 1) || 1);
    this.phase = (this.phase + rate * dt) % 1;

    if (this.rig) {
      const fwd = this.vel.y;
      this.rig.update(dt, { phase: this.phase, fwd, side: this.vel.x, speed }, this.shot);
      return;
    }
    // clips: effective weights (a missing clip lends its weight to its fallback)
    const total = new Map<string, number>();
    for (const name of ['Idle', ...MOVING] as Loco[]) {
      const clip = this.clipFor(name);
      if (!clip) continue;
      total.set(clip, (total.get(clip) ?? 0) + w[name] * (1 - o));
    }
    for (const name of ['Idle', ...MOVING]) {
      const a = this.actions.get(name);
      if (!a) continue;
      a.setEffectiveWeight(total.get(name) ?? 0);
      if (name !== 'Idle') a.time = this.phase * (this.durations.get(name) ?? 1);
    }
    if (this.shot?.action) this.shot.action.setEffectiveWeight(o);
    this.mixer!.update(dt);
  }

  /** The clip that plays a locomotion state: its own, or the closest one the model has. */
  private clipFor(name: Loco): string | null {
    if (this.rig) return name;
    if (this.actions.has(name)) return name;
    if (name !== 'Idle' && this.actions.has('Walk')) return 'Walk';
    return this.actions.has('Idle') ? 'Idle' : null;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.model);
    this.root.removeFromParent();
    disposeInstance(this.root, this.placeholder);
    this.slots.clear();
    this.actions.clear();
  }
}
