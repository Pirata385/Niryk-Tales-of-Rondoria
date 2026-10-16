import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EntityAnim } from '@shared/protocol';
import { loadModel } from '../core/assets';
import { LAYER_OUTLINE, LAYER_XRAY_HOSTILE } from '../render/PixelPipeline';
import { toonFromGltf } from '../render/toon';

const LOOPING = new Set(['Idle', 'Walk', 'Run']);

/** A wolf from wolf.glb with cross-faded clips and a red x-ray silhouette behind scenery. */
export class WolfView {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentKey = '';
  private readonly materials: THREE.MeshToonMaterial[] = [];

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root.add(model);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = toonFromGltf(mesh.material as THREE.Material, { rim: 0.25 });
      this.materials.push(mat);
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.layers.enable(LAYER_OUTLINE);
      mesh.layers.enable(LAYER_XRAY_HOSTILE);
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }

  static async create(): Promise<WolfView> {
    const gltf = await loadModel('wolf');
    return new WolfView(cloneSkinned(gltf.scene), gltf.animations);
  }

  /** Plays the server animation; one-shots restart whenever `start` changes. */
  setAnim(anim: EntityAnim, start: number, elapsed: number): void {
    const key = LOOPING.has(anim) ? anim : `${anim}@${start}`;
    if (key === this.currentKey) return;
    const action = this.actions.get(anim);
    if (!action) return;
    action.reset();
    action.setLoop(LOOPING.has(anim) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.12, false);
    action.play();
    if (!LOOPING.has(anim)) action.time = Math.max(0, Math.min(elapsed, action.getClip().duration));
    this.current = action;
    this.currentKey = key;
  }

  private xrayOn = true;

  /** Hostile silhouette behind scenery; off once the wolf lies dead. */
  setXray(on: boolean): void {
    if (on === this.xrayOn) return;
    this.xrayOn = on;
    this.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (on) o.layers.enable(LAYER_XRAY_HOSTILE);
      else o.layers.disable(LAYER_XRAY_HOSTILE);
    });
  }

  /** Brief white flash when hit. */
  flash(amount: number): void {
    for (const m of this.materials) m.emissive.setScalar(amount * 0.8);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
