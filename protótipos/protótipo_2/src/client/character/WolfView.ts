import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RUN_SPEED, WOLF } from '@shared/constants';
import type { EntityAnim } from '@shared/protocol';
import { loadModelOrNull } from '../core/assets';
import { addOutline } from '../render/outline';
import { toonFromGltf, toonMaterial } from '../render/toon';
import { disposeInstance } from './CharacterView';

const LOOPING = new Set<EntityAnim>(['Idle', 'Walk', 'Run']);
/** Seconds after dying when the body starts sinking into the ground, and how long that takes. */
const SINK_AFTER = 12;
const SINK_TIME = 2.5;

// ------------------------------------------------------------------ placeholder wolf

/** Bones of the stand-in: name, parent index, position (model space, bind pose). */
const BONES: [string, number, [number, number, number]][] = [
  ['Root', -1, [0, 0, 0]],
  ['Hips', 0, [0, 0.72, -0.32]],
  ['Chest', 1, [0, 0.76, 0.28]],
  ['Neck', 2, [0, 0.86, 0.5]],
  ['Head', 3, [0, 0.97, 0.7]],
  ['FrontLegL', 2, [0.16, 0.68, 0.36]],
  ['FrontShinL', 5, [0.16, 0.36, 0.39]],
  ['FrontLegR', 2, [-0.16, 0.68, 0.36]],
  ['FrontShinR', 7, [-0.16, 0.36, 0.39]],
  ['HindLegL', 1, [0.16, 0.68, -0.42]],
  ['HindShinL', 9, [0.16, 0.34, -0.52]],
  ['HindLegR', 1, [-0.16, 0.68, -0.42]],
  ['HindShinR', 11, [-0.16, 0.34, -0.52]],
  ['Tail', 1, [0, 0.8, -0.66]],
  ['TailTip', 13, [0, 0.62, -0.96]],
];
const B = Object.fromEntries(BONES.map(([n], i) => [n, i])) as Record<string, number>;

const FUR = '#7f7c88';
const FUR_DARK = '#5c5966';
const FUR_LIGHT = '#cfc8bd';

/** A geometry piece painted one color and bound rigidly to one bone. */
function piece(g: THREE.BufferGeometry, hex: string, bone: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

const ellipsoid = (r: [number, number, number], at: [number, number, number]) => new THREE.SphereGeometry(1, 16, 12).scale(...r).translate(...at);

/** A capsule between two points (model space). */
function limb(a: [number, number, number], b: [number, number, number], r: number, rb = r): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(rb, r, len, 10, 1);
  const capA = new THREE.SphereGeometry(r, 10, 6).translate(0, -len / 2, 0);
  const capB = new THREE.SphereGeometry(rb, 10, 6).translate(0, len / 2, 0);
  const m = mergeGeometries([g.toNonIndexed(), capA.toNonIndexed(), capB.toNonIndexed()])!;
  m.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  return m.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

let placeholderGeometry: THREE.BufferGeometry | null = null;

/** The stand-in wolf's geometry (built once, shared): fur in three tones, rigidly skinned. */
function wolfGeometry(): THREE.BufferGeometry {
  if (placeholderGeometry) return placeholderGeometry;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(piece(ellipsoid([0.21, 0.23, 0.4], [0, 0.72, -0.3]), FUR, B.Hips));
  parts.push(piece(ellipsoid([0.24, 0.28, 0.36], [0, 0.76, 0.2]), FUR, B.Chest));
  parts.push(piece(ellipsoid([0.2, 0.12, 0.42], [0, 0.88, -0.02]), FUR_DARK, B.Hips)); // dark saddle
  parts.push(piece(ellipsoid([0.27, 0.29, 0.22], [0, 0.85, 0.42]), FUR_DARK, B.Chest)); // mane
  parts.push(piece(ellipsoid([0.16, 0.18, 0.2], [0, 0.64, 0.34]), FUR_LIGHT, B.Chest)); // chest bib
  parts.push(piece(limb([0, 0.84, 0.48], [0, 0.95, 0.68], 0.12), FUR, B.Neck));
  parts.push(piece(ellipsoid([0.15, 0.135, 0.17], [0, 0.99, 0.72]), FUR, B.Head));
  parts.push(piece(limb([0, 0.94, 0.84], [0, 0.9, 1.02], 0.075, 0.055), FUR_LIGHT, B.Head)); // muzzle
  parts.push(piece(new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.925, 1.07), '#2a2430', B.Head)); // nose
  for (const s of [1, -1]) {
    parts.push(piece(new THREE.ConeGeometry(0.055, 0.15, 6).scale(1, 1, 0.55).rotateX(-0.2).rotateZ(-s * 0.25).translate(s * 0.085, 1.14, 0.66), FUR_DARK, B.Head));
    parts.push(piece(new THREE.SphereGeometry(0.026, 8, 6).scale(1.3, 0.8, 0.6).translate(s * 0.07, 1.01, 0.86), '#f2c040', B.Head)); // eyes
    // legs: thigh/upper, shin/fore, paw
    parts.push(piece(limb([s * 0.16, 0.7, 0.36], [s * 0.16, 0.38, 0.39], 0.075, 0.06), FUR, s > 0 ? B.FrontLegL : B.FrontLegR));
    parts.push(piece(limb([s * 0.16, 0.36, 0.39], [s * 0.16, 0.05, 0.4], 0.05, 0.045), FUR_LIGHT, s > 0 ? B.FrontShinL : B.FrontShinR));
    parts.push(piece(ellipsoid([0.06, 0.04, 0.08], [s * 0.16, 0.035, 0.43]), FUR_DARK, s > 0 ? B.FrontShinL : B.FrontShinR));
    parts.push(piece(limb([s * 0.16, 0.72, -0.4], [s * 0.16, 0.36, -0.5], 0.1, 0.065), FUR, s > 0 ? B.HindLegL : B.HindLegR));
    parts.push(piece(limb([s * 0.16, 0.34, -0.52], [s * 0.16, 0.05, -0.44], 0.05, 0.045), FUR_LIGHT, s > 0 ? B.HindShinL : B.HindShinR));
    parts.push(piece(ellipsoid([0.06, 0.04, 0.08], [s * 0.16, 0.035, -0.4]), FUR_DARK, s > 0 ? B.HindShinL : B.HindShinR));
  }
  parts.push(piece(limb([0, 0.8, -0.64], [0, 0.64, -0.94], 0.075, 0.09), FUR, B.Tail));
  parts.push(piece(limb([0, 0.62, -0.96], [0, 0.48, -1.14], 0.085, 0.04), FUR_LIGHT, B.TailTip));
  placeholderGeometry = mergeGeometries(parts)!;
  return placeholderGeometry;
}

/** A stand-in wolf: one skinned mesh on a small skeleton, animated procedurally. */
function buildPlaceholderWolf(): { root: THREE.Object3D; bones: THREE.Bone[]; material: THREE.MeshToonMaterial } {
  const bones = BONES.map(([name]) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  BONES.forEach(([, parent, pos], i) => {
    const p = parent < 0 ? null : BONES[parent][2];
    bones[i].position.set(pos[0] - (p?.[0] ?? 0), pos[1] - (p?.[1] ?? 0), pos[2] - (p?.[2] ?? 0));
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  const material = toonMaterial({ name: 'Fur', vertexColors: true }, { rim: 0.6 });
  const mesh = new THREE.SkinnedMesh(wolfGeometry(), material);
  mesh.name = 'Wolf_body';
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  addOutline(mesh, { width: 1 });
  const root = new THREE.Group();
  root.name = 'PlaceholderWolf';
  root.add(mesh);
  return { root, bones, material };
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Procedural clips of the stand-in wolf (bind pose + offsets every frame). */
class WolfRig {
  private readonly rest: THREE.Vector3[];
  private t = 0;
  private phase = 0;

  constructor(private readonly bones: THREE.Bone[]) {
    this.rest = bones.map((b) => b.position.clone());
  }

  update(dt: number, speed: number, anim: EntityAnim, elapsed: number): void {
    this.t += dt;
    const b = this.bones;
    for (let i = 0; i < b.length; i++) {
      b[i].position.copy(this.rest[i]);
      b[i].rotation.set(0, 0, 0);
    }
    const run = THREE.MathUtils.smoothstep(speed, WOLF.walkSpeed * 1.2, WOLF.runSpeed * 0.8);
    const moving = THREE.MathUtils.smoothstep(speed, 0.1, 0.8);
    const stride = THREE.MathUtils.lerp(1.1, 2.6, run);
    this.phase = (this.phase + (Math.max(speed, 0.3) / stride) * dt) % 1;
    const w = this.phase * Math.PI * 2;
    const amp = moving * THREE.MathUtils.lerp(0.42, 0.75, run);
    // a trot that becomes a bounding run: diagonal pairs, the hind legs a little later
    const leg = (upper: number, shin: number, off: number) => {
      const s = Math.sin(w + off);
      b[upper].rotation.x = -s * amp;
      b[shin].rotation.x = Math.max(0, Math.cos(w + off)) * amp * 1.1; // the paw folds back as it lifts
    };
    const gallop = run * 1.2;
    leg(B.FrontLegL, B.FrontShinL, 0);
    leg(B.HindLegR, B.HindShinR, 0.4 + gallop * 0.6);
    leg(B.FrontLegR, B.FrontShinR, Math.PI - gallop);
    leg(B.HindLegL, B.HindShinL, Math.PI + 0.4 - gallop * 0.4);
    b[B.Hips].position.y += Math.abs(Math.sin(w)) * 0.035 * moving - run * 0.05;
    b[B.Chest].rotation.x = Math.sin(w * 2) * 0.05 * run;
    b[B.Head].rotation.x = Math.sin(this.t * 1.7) * 0.04 * (1 - moving) + run * 0.18;
    b[B.Neck].rotation.x = run * 0.15;
    b[B.Tail].rotation.x = 0.25 - moving * 0.35 - run * 0.2 + Math.sin(this.t * 2.1) * 0.05;
    b[B.Tail].rotation.y = Math.sin(this.t * (moving > 0.5 ? 6 : 2.3)) * (0.12 + moving * 0.1);

    const root = b[B.Root];
    if (anim === 'Attack') {
      // crouch and pull back while winding up, then the lunge and the bite, then recover
      const wind = ease(Math.min(1, elapsed / WOLF.windup));
      const lunge = elapsed < WOLF.windup ? 0 : Math.sin(Math.min(1, (elapsed - WOLF.windup) / 0.3) * Math.PI);
      const back = ease(Math.max(0, Math.min(1, (elapsed - WOLF.windup - 0.15) / 0.2)));
      b[B.Hips].position.y -= 0.1 * wind * (1 - back);
      b[B.Chest].rotation.x += (-0.25 * wind + 0.35 * lunge) * (1 - back * 0.5);
      b[B.Neck].rotation.x += 0.45 * lunge - 0.2 * wind * (1 - lunge);
      b[B.Head].rotation.x += -0.35 * lunge + 0.1 * wind;
      root.position.z += -0.15 * wind * (1 - lunge) + 0.45 * lunge;
      b[B.Tail].rotation.x += 0.4 * wind;
      b[B.FrontLegL].rotation.x -= 0.5 * lunge;
      b[B.FrontLegR].rotation.x -= 0.5 * lunge;
    } else if (anim === 'Hit') {
      const k = Math.sin(Math.min(1, elapsed / 0.36) * Math.PI);
      b[B.Chest].rotation.x -= 0.3 * k;
      b[B.Head].rotation.x -= 0.3 * k;
      root.position.z -= 0.18 * k;
    } else if (anim === 'Death') {
      const k = ease(Math.min(1, elapsed / 0.7));
      root.rotation.z = (Math.PI / 2) * k * 0.98;
      root.position.y = 0.2 * k; // on its side, the flank on the ground
      root.position.x = 0.5 * k;
      for (const i of [B.FrontLegL, B.FrontLegR, B.HindLegL, B.HindLegR]) b[i].rotation.x = 0.25 * k * (i === B.HindLegL || i === B.HindLegR ? -1 : 1);
      b[B.Head].rotation.x = 0.3 * k;
      b[B.Tail].rotation.x = -0.6 * k;
    }
  }
}

/**
 * A wolf: wolf.glb (clips Idle, Walk, Run, Attack, Hit, Death, cross-faded; the gait clips speed
 * up with the real speed) or, while it is missing, a toon stand-in on a small skeleton animated
 * procedurally. Both get ink, a hit flash and a slow sink into the ground some seconds after dying.
 */
export class WolfView {
  readonly root = new THREE.Group();
  readonly placeholder: boolean;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly materials: THREE.MeshToonMaterial[] = [];
  private readonly rig: WolfRig | null;
  private current: THREE.AnimationAction | null = null;
  private anim: EntityAnim = 'Idle';
  private animStart = NaN;
  private elapsed = 0;
  private speed = 0;
  private flashAmount = NaN; // NaN: the first call always writes the emissive

  private constructor(
    private readonly model: THREE.Object3D,
    clips: THREE.AnimationClip[],
    rig: WolfRig | null,
  ) {
    this.root.add(model);
    this.rig = rig;
    this.placeholder = rig !== null;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.isOutline) return;
      const mat = rig ? (mesh.material as THREE.MeshToonMaterial) : toonFromGltf(mesh.material as THREE.Material, { rim: 0.6 });
      this.materials.push(mat);
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (!rig && !/^(Eye|Dark)/.test(mat.name)) addOutline(mesh, { width: 1 });
    });
    this.mixer = rig ? null : new THREE.AnimationMixer(model);
    for (const c of clips) this.actions.set(c.name, this.mixer!.clipAction(c));
  }

  static async create(): Promise<WolfView> {
    const gltf = await loadModelOrNull('wolf');
    if (gltf) return new WolfView(cloneSkinned(gltf.scene), gltf.animations, null);
    const p = buildPlaceholderWolf();
    return new WolfView(p.root, [], new WolfRig(p.bones));
  }

  /**
   * The server's animation: `start` is its server start time, `elapsed` how long ago that was on
   * the render clock. One-shots restart whenever `start` changes.
   */
  setAnim(anim: EntityAnim, start: number, elapsed: number): void {
    this.elapsed = elapsed;
    if (anim === this.anim && (LOOPING.has(anim) || start === this.animStart)) return;
    this.anim = anim;
    this.animStart = start;
    const action = this.actions.get(anim);
    if (!action) return;
    const looping = LOOPING.has(anim);
    action.reset();
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.12, false);
    action.play();
    if (!looping) action.time = Math.max(0, Math.min(elapsed, action.getClip().duration));
    this.current = action;
  }

  /** Ground speed (m/s) from the interpolated movement: the gait follows it. */
  setSpeed(v: number): void {
    this.speed = v;
  }

  get dead(): boolean {
    return this.anim === 'Death';
  }

  /** Brief warm-white flash when hit (0..1, fading). */
  flash(amount: number): void {
    const a = Math.round(amount * 20) / 20; // material writes only when the step changes
    if (a === this.flashAmount) return;
    this.flashAmount = a;
    for (const m of this.materials) m.emissive.setRGB(a * 0.55, a * 0.48, a * 0.4);
  }

  update(dt: number): void {
    if (this.rig) this.rig.update(dt, this.speed, this.anim, this.elapsed);
    else {
      const gait = this.anim === 'Walk' ? this.speed / WOLF.walkSpeed : this.anim === 'Run' ? this.speed / RUN_SPEED : 1;
      if (this.current && LOOPING.has(this.anim)) this.current.timeScale = THREE.MathUtils.clamp(gait, 0.6, 1.6);
      this.mixer!.update(dt);
    }
    // the body sinks into the ground a while after dying (the server removes it at respawn)
    const sink = this.anim === 'Death' ? THREE.MathUtils.clamp((this.elapsed - SINK_AFTER) / SINK_TIME, 0, 1) : 0;
    this.model.position.y = -sink * 0.9;
    this.model.visible = sink < 1;
  }

  /** Frees this instance's animation state, materials and skeleton (shared geometry stays cached). */
  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.model);
    this.root.removeFromParent();
    disposeInstance(this.root);
    this.materials.length = 0;
    this.actions.clear();
    this.current = null;
  }
}
