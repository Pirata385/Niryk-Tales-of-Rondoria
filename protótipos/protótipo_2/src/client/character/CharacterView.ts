import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bodyModel, type Appearance } from '@shared/appearance';
import { BACKPEDAL_FACTOR, RUN_SPEED, WALK_SPEED } from '@shared/constants';
import { loadModelOrNull } from '../core/assets';
import { LAYERS } from '../render/look';
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

/** Slots the appearance does not choose (yet): trousers, leather, metal fittings, Harpin talons. */
export const SLOT_DEFAULTS: Record<string, string> = {
  Cloth_B: '#5e4c40',
  Leather: '#7a4a2c',
  Metal: '#bcc4ce',
  Talon: '#3a3036',
};

/**
 * First-person "ready" pose of the right arm (character frame: +X left, +Y up, +Z forward):
 * upper arm forward and a little down, forearm raised, so the fist and the sword stand in the
 * lower right of the view instead of hanging out of it.
 */
const FP_UPPER = new THREE.Vector3(-0.16, -0.27, 0.95).normalize();
const FP_FORE = new THREE.Vector3(0.12, 0.35, 0.93).normalize();
/** The sword's blade (Socket_Weapon_R +Y) in that pose: up and away, a little outward. */
const FP_BLADE = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
/** ...and the left arm, slightly forward (a fist at the lower left edge when walking). */
const FP_UPPER_L = new THREE.Vector3(0.2, -0.62, 0.76).normalize();
const FP_FORE_L = new THREE.Vector3(-0.25, 0.05, 0.97).normalize();

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

const _up = new THREE.Vector3(0, 1, 0);

/**
 * Turns `bone` so the direction to its child (or `axis`, a direction in `ref`'s frame, `ref`
 * being the bone or one of its descendants) points along `dir` (world), blended by `w`.
 */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number, axis?: THREE.Vector3): void {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_qa);
  if (axis) {
    child.updateWorldMatrix(true, false);
    child.getWorldQuaternion(_qb);
    _va.copy(axis).applyQuaternion(_qb);
  } else {
    _va.copy(child.position).normalize().applyQuaternion(_qa);
  }
  _qb.setFromUnitVectors(_va, dir).multiply(_qa); // new world rotation
  bone.parent!.getWorldQuaternion(_qc).invert();
  _qb.premultiply(_qc); // back to the parent's space
  bone.quaternion.slerp(_qb, w);
  bone.updateMatrixWorld(true);
}

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
  /** Weight of the first-person arm pose (eases in and out). */
  private fpArms = 0;
  /** Eye point relative to the Head bone, in the character's frame (bind pose). */
  readonly eyeOffset = new THREE.Vector3(0, 0.1, 0.07);
  private readonly arms: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D; left: boolean }[] = [];
  private readonly weaponSocket: THREE.Object3D | null;
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
      const t = rig ? (src as THREE.MeshToonMaterial) : toonFromGltf(src, { rim: 1, warm: src.name === 'Skin' ? 0.8 : 0 });
      const list = this.slots.get(t.name) ?? [];
      list.push(t);
      this.slots.set(t.name, list);
      mesh.material = t;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds are unreliable when animated
      if (!NO_INK.test(t.name) && !mesh.name.startsWith('Head_eye')) addOutline(mesh, { width: 1 });
    }
    for (const side of ['Right', 'Left']) {
      const upper = model.getObjectByName(`${side}UpperArm`);
      const fore = model.getObjectByName(`${side}LowerArm`);
      const hand = model.getObjectByName(`${side}Hand`);
      if (upper && fore && hand) this.arms.push({ upper, fore, hand, left: side === 'Left' });
    }
    this.weaponSocket = model.getObjectByName('Socket_Weapon_R') ?? null;
    this.measureEyes(meshes);
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
    const parts = buildPlaceholderHuman({ race: appearance.race, gender: appearance.gender });
    return new CharacterView(parts.root, [], appearance, new PlaceholderRig(parts));
  }

  /** Recolors the tintable slots from the appearance. */
  applyAppearance(a: Appearance): void {
    this.appearance = a;
    const tint: Record<string, string> = { ...SLOT_DEFAULTS, Skin: a.skin, Hair: a.hairColor, Plume: a.plumeColor, Eye: a.eyeColor, Cloth_A: a.clothColor };
    for (const [slot, color] of Object.entries(tint)) {
      const c = slot === 'Eye' || slot === 'Skin' ? new THREE.Color(color) : liftDark(new THREE.Color(color));
      for (const m of this.slots.get(slot) ?? []) m.color.copy(c);
    }
    // only the chosen hair style (top nodes Hair_<style>); a model without that style keeps its own
    const styles: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if (o.name.startsWith('Hair_') && !o.parent?.name.startsWith('Hair_')) styles.push(o);
    });
    if (styles.some((o) => o.name === `Hair_${a.hairStyle}`)) for (const o of styles) o.visible = o.name === `Hair_${a.hairStyle}`;
  }

  /**
   * First person: the head and hair (nodes Head_*, Hair_*) move to a layer the game camera does not
   * draw (the sun's shadow camera still does: the shadow keeps its head); arms and sword stay.
   */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    const layer = on ? LAYERS.fpHidden : 0;
    const apply = (o: THREE.Object3D) => {
      if (FIRST_PERSON_HIDDEN.test(o.name)) {
        o.traverse((c) => c.layers.set(layer));
        return;
      }
      for (const c of o.children) apply(c);
    };
    apply(this.model);
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

  /** Brief warm-white flash when hit (0..1, fading). */
  flash(amount: number): void {
    const a = Math.round(amount * 20) / 20; // material writes only when the step changes
    if (a === this.flashAmount) return;
    this.flashAmount = a;
    for (const list of this.slots.values()) for (const m of list) m.emissive.setRGB(a * 0.45, a * 0.38, a * 0.32);
  }

  /** Effective weight of every clip playing (tests and debugging). */
  clipWeights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, a] of this.actions) if (a.isRunning() && a.getEffectiveWeight() > 0.001) out[name] = Math.round(a.getEffectiveWeight() * 100) / 100;
    out.speed = Math.round(this.vel.length() * 100) / 100;
    return out;
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
    this.applyFirstPersonArms(dt, o, speed);
  }

  /**
   * First person: blends the arms toward a ready pose in front of the camera (attacks fade it out
   * so the swing plays as authored), with a little sway from the walk phase.
   */
  private applyFirstPersonArms(dt: number, oneShot: number, speed: number): void {
    const goal = this.firstPerson ? 1 : 0;
    this.fpArms += (goal - this.fpArms) * (1 - Math.exp(-dt * 12));
    if (this.fpArms < 0.01 || !this.arms.length) return;
    const attacking = this.shot && this.shot.name !== 'Hit' ? oneShot : 0;
    const w = this.fpArms * (1 - attacking);
    if (w < 0.01) return;
    this.root.updateWorldMatrix(true, false);
    const q = this.root.getWorldQuaternion(_qc.clone());
    const sway = Math.sin(this.phase * Math.PI * 2) * Math.min(1, speed / 3);
    for (const arm of this.arms) {
      const up = (arm.left ? FP_UPPER_L : FP_UPPER).clone();
      const fore = (arm.left ? FP_FORE_L : FP_FORE).clone();
      fore.y += sway * (arm.left ? -0.06 : 0.06);
      up.applyQuaternion(q);
      fore.normalize().applyQuaternion(q);
      aimBone(arm.upper, arm.fore, up, w * (arm.left ? 0.8 : 1));
      aimBone(arm.fore, arm.hand, fore, w * (arm.left ? 0.8 : 1));
      if (!arm.left && this.weaponSocket) {
        // the wrist turns the blade up and away instead of across the view
        aimBone(arm.hand, this.weaponSocket, FP_BLADE.clone().applyQuaternion(q), w, _up);
      }
    }
  }

  /** The eye point from the bind pose: the center of the eye meshes relative to the Head bone. */
  private measureEyes(meshes: THREE.Mesh[]): void {
    const eyes = meshes.filter((m) => m.name.startsWith('Head_Eyes') || m.name.startsWith('Head_eye'));
    const head = this.head;
    if (!eyes.length || !head) return;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of eyes) {
      const skinned = m as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) {
        // rest pose: every bone's matrixWorld * boneInverse is the same matrix (which also holds
        // the dequantization of quantized meshes)
        const bone = skinned.skeleton.bones[0];
        bone.updateWorldMatrix(true, false);
        const rest = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, skinned.skeleton.boneInverses[0]).multiply(skinned.bindMatrix);
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(rest));
      } else {
        box.union(new THREE.Box3().setFromObject(m));
      }
    }
    const center = box.getCenter(_vb);
    const headPos = head.getWorldPosition(_va);
    this.root.worldToLocal(center);
    this.root.worldToLocal(headPos);
    this.eyeOffset.subVectors(center, headPos);
  }

  /** The first-person eye point in world space (after update()). */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.head) return this.root.getWorldPosition(out).add(_va.set(0, 1.62, 0));
    this.head.updateWorldMatrix(true, false);
    this.head.getWorldPosition(out);
    this.root.getWorldQuaternion(_qa);
    return out.add(_va.copy(this.eyeOffset).applyQuaternion(_qa));
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
