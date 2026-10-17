import * as THREE from 'three';
import { bodyModel } from '@shared/appearance';
import { ITEMS, type EquipSlot } from '@shared/items';
import { loadModel } from '../core/assets';
import { LAYER_OUTLINE, LAYER_XRAY } from '../render/PixelPipeline';
import { toonFromGltf } from '../render/toon';
import type { CharacterView } from './CharacterView';

/** Attached equipment objects per character (so they can be removed on unequip). */
const attached = new WeakMap<CharacterView, Map<EquipSlot, THREE.Object3D>>();
/** Latest request per character and slot: a slow load must not land after a newer equip/unequip. */
const requests = new WeakMap<CharacterView, Map<EquipSlot, number>>();
let requestId = 0;

function prepare(root: THREE.Object3D, xray: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => toonFromGltf(m, { rim: 0.3 })) : toonFromGltf(mesh.material, { rim: 0.3 });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.layers.enable(LAYER_OUTLINE);
    if (xray) mesh.layers.enable(LAYER_XRAY);
  });
}

/**
 * Equips an item model on a character: weapons are parented to Socket_Weapon_R; armor meshes are
 * skinned on the same bone names as the body, so they are re-bound to the character's skeleton.
 * Never rejects (callers fire and forget it): a failed load is logged and the slot stays empty.
 */
export async function equip(view: CharacterView, slot: EquipSlot, itemId: string | null, xray = false): Promise<void> {
  const map = attached.get(view) ?? new Map<EquipSlot, THREE.Object3D>();
  attached.set(view, map);
  const reqs = requests.get(view) ?? new Map<EquipSlot, number>();
  requests.set(view, reqs);
  const id = ++requestId;
  reqs.set(slot, id);
  const stale = () => reqs.get(slot) !== id;
  map.get(slot)?.removeFromParent();
  map.delete(slot);
  if (!itemId) return;
  try {
    const obj = await loadEquipment(view, slot, itemId);
    if (stale()) return;
    prepare(obj, xray);
    (slot === 'weapon' ? view.attachPoint('Socket_Weapon_R') : view.model)?.add(obj);
    map.set(slot, obj);
  } catch (err) {
    // a newer request already owns the slot: its own outcome is what matters
    if (!stale()) console.error(`equip ${slot} ${itemId} failed:`, err);
  }
}

/** Loads the object for an item, ready to attach (armor already bound to the view's bones). */
async function loadEquipment(view: CharacterView, slot: EquipSlot, itemId: string): Promise<THREE.Object3D> {
  const item = ITEMS[itemId];
  if (!item) throw new Error(`unknown item ${itemId}`);
  if (slot === 'weapon') return (await loadModel(item.model)).scene.clone(true);

  // armor: rebind every skinned mesh to the character's bones (matched by name)
  const gltf = await loadModel(`${item.model}_${bodyModel(view.appearance)}`);
  const skeleton = view.skeleton;
  if (!skeleton) throw new Error('character has no skeleton');
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const group = new THREE.Group();
  gltf.scene.traverse((o) => {
    const src = o as THREE.SkinnedMesh;
    if (!src.isSkinnedMesh) return;
    const mesh = new THREE.SkinnedMesh(src.geometry, src.material);
    mesh.name = src.name;
    const bones = src.skeleton.bones.map((b) => {
      const bone = byName.get(b.name);
      if (!bone) throw new Error(`armor bone ${b.name} missing on the character`);
      return bone;
    });
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
    group.add(mesh);
  });
  return group;
}
