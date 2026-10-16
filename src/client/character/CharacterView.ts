import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bodyModel, type Appearance } from '@shared/appearance';
import { loadModel } from '../core/assets';
import { LAYER_OUTLINE, LAYER_XRAY, LAYER_XRAY_HOSTILE } from '../render/PixelPipeline';
import { toonFromGltf } from '../render/toon';

export type AnimName = 'Idle' | 'Walk' | 'Run' | 'Attack1' | 'Attack2' | 'Hit' | 'Death';
const LOOPING = new Set<AnimName>(['Idle', 'Walk', 'Run']);

export interface CharacterOptions {
  /** Silhouette when hidden behind scenery: 'player' (lilac), 'hostile' (red) or none. */
  xray?: 'player' | 'hostile';
  rim?: number;
}

/**
 * A rigged character assembled from a Pyram3D body GLB: toon materials per color slot, the chosen
 * hair style, an AnimationMixer with cross-faded clips, and equipment attached to sockets/bones.
 */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly slots = new Map<string, THREE.MeshToonMaterial[]>();
  private current: THREE.AnimationAction | null = null;
  private currentName: AnimName | null = null;
  appearance: Appearance;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], appearance: Appearance, opts: CharacterOptions) {
    this.model = model;
    this.appearance = appearance;
    this.root.add(model);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const t = toonFromGltf(m, { rim: opts.rim ?? 0.35 });
        const list = this.slots.get(t.name) ?? [];
        list.push(t);
        this.slots.set(t.name, list);
        return t;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds are unreliable when animated
      mesh.layers.enable(LAYER_OUTLINE);
      if (opts.xray === 'player') mesh.layers.enable(LAYER_XRAY);
      if (opts.xray === 'hostile') mesh.layers.enable(LAYER_XRAY_HOSTILE);
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.applyAppearance(appearance);
  }

  static async create(appearance: Appearance, opts: CharacterOptions = {}): Promise<CharacterView> {
    const gltf = await loadModel(bodyModel(appearance));
    const model = cloneSkinned(gltf.scene);
    return new CharacterView(model, gltf.animations, appearance, opts);
  }

  /** Recolors slots and swaps the hair style (same race/gender; otherwise rebuild the view). */
  applyAppearance(a: Appearance): void {
    this.appearance = a;
    const plume = a.race === 'harpin' ? a.plumeColor : a.hairColor;
    const tint: Record<string, string> = {
      Skin: a.skin,
      Hair: a.hairColor,
      Plume: plume,
      Plume_Feather: plume,
      Eye: a.eyeColor,
    };
    for (const [slot, color] of Object.entries(tint)) {
      for (const m of this.slots.get(slot) ?? []) m.color.set(color);
    }
    this.model.traverse((o) => {
      if (o.name.startsWith('Hair_')) o.visible = o.name === `Hair_${a.hairStyle}`;
    });
  }

  play(name: AnimName, fade = 0.15, timeScale = 1): THREE.AnimationAction | null {
    const action = this.actions.get(name);
    if (!action) return null;
    if (this.currentName === name && LOOPING.has(name)) {
      action.timeScale = timeScale;
      return action;
    }
    action.reset();
    action.timeScale = timeScale;
    action.setLoop(LOOPING.has(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !LOOPING.has(name);
    action.enabled = true;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, fade, false);
    action.play();
    this.current = action;
    this.currentName = name;
    return action;
  }

  get animation(): AnimName | null {
    return this.currentName;
  }

  clipDuration(name: AnimName): number {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  /** Brief white flash when hit (0..1). */
  flash(amount: number): void {
    if (amount === this.flashAmount) return;
    this.flashAmount = amount;
    for (const list of this.slots.values()) for (const m of list) m.emissive.setScalar(amount * 0.6);
  }

  private flashAmount = 0;

  /** Pose at a fixed time (screenshots / creator preview). */
  pose(name: AnimName, time: number): void {
    this.play(name, 0);
    this.mixer.setTime(time);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Finds a bone or socket by name (e.g. Socket_Weapon_R). */
  attachPoint(name: string): THREE.Object3D | undefined {
    return this.model.getObjectByName(name);
  }

  /** The skeleton shared by every skinned part (armor is re-bound to it by bone name). */
  get skeleton(): THREE.Skeleton | null {
    let sk: THREE.Skeleton | null = null;
    this.model.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (!sk && s.isSkinnedMesh) sk = s.skeleton;
    });
    return sk;
  }
}
