import * as THREE from 'three';
import { ITEMS, type EquipSlot } from '@shared/items';
import { loadModelOrNull } from '../core/assets';
import { addOutline } from '../render/outline';
import { toonFromGltf } from '../render/toon';
import { disposeInstance, type CharacterView } from './CharacterView';
import { buildPlaceholderSword } from './placeholder';

/** Attached equipment objects per character (so they can be removed on unequip). */
const attached = new WeakMap<CharacterView, Map<EquipSlot, THREE.Object3D>>();
/** Latest request per character and slot: a slow load must not land after a newer equip/unequip. */
const requests = new WeakMap<CharacterView, Map<EquipSlot, number>>();
let requestId = 0;

function prepare(root: THREE.Object3D, fromGltf: boolean): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    if (fromGltf) mesh.material = toonFromGltf(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, { rim: 1 });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    addOutline(mesh, { width: 0.8 });
  }
}

/**
 * Equips an item on a character. Weapons go to Socket_Weapon_R (the sword GLB, or a stick sword
 * while it is missing). Armor is not part of the style slice: it is ignored for now. Never
 * rejects (callers fire and forget it): a failed load is logged and the slot stays empty.
 */
export async function equip(view: CharacterView, slot: EquipSlot, itemId: string | null): Promise<void> {
  const map = attached.get(view) ?? new Map<EquipSlot, THREE.Object3D>();
  attached.set(view, map);
  const reqs = requests.get(view) ?? new Map<EquipSlot, number>();
  requests.set(view, reqs);
  const id = ++requestId;
  reqs.set(slot, id);
  const stale = () => reqs.get(slot) !== id;
  const old = map.get(slot);
  if (old) {
    old.removeFromParent();
    disposeInstance(old, old.userData.placeholder === true);
    map.delete(slot);
  }
  if (!itemId || slot !== 'weapon') return;
  try {
    const item = ITEMS[itemId];
    if (!item) throw new Error(`unknown item ${itemId}`);
    const gltf = await loadModelOrNull(item.model);
    if (stale()) return;
    const obj = gltf ? gltf.scene.clone(true) : buildPlaceholderSword();
    obj.userData.placeholder = !gltf;
    prepare(obj, !!gltf);
    const socket = view.attachPoint('Socket_Weapon_R') ?? view.attachPoint('RightHand') ?? view.model;
    socket.add(obj);
    map.set(slot, obj);
  } catch (err) {
    if (!stale()) console.error(`equip ${slot} ${itemId} failed:`, err);
  }
}
