import * as THREE from 'three';
import { bodyModel } from '@shared/appearance';
import { ITEMS, type EquipSlot } from '@shared/items';
import { loadModelOrNull } from '../core/assets';
import { addOutline } from '../render/outline';
import { toonFromGltf, toonMaterial } from '../render/toon';
import { SLOT_DEFAULTS, disposeInstance, type CharacterView } from './CharacterView';
import { buildPlaceholderSword } from './placeholder';

/** Objects attached per character and slot (armor plates hang on several bones). */
const attached = new WeakMap<CharacterView, Map<EquipSlot, THREE.Object3D[]>>();
/** Latest request per character and slot: a slow load must not land after a newer equip/unequip. */
const requests = new WeakMap<CharacterView, Map<EquipSlot, number>>();
let requestId = 0;

/** Toon materials (slot tints on the GLB's white slot materials), shadows and ink. */
function prepare(root: THREE.Object3D, fromGltf: boolean, ink = 0.8): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.isOutline) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    if (fromGltf) {
      const mat = toonFromGltf(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, { rim: 1 });
      // the GLB's slot materials are white (the detail is in the vertex colors): tint them
      const tint = SLOT_DEFAULTS[mat.name];
      if (tint) mat.color.set(tint);
      mesh.material = mat;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    addOutline(mesh, { width: ink });
  }
}

/**
 * Equips an item on a character. Weapons go to Socket_Weapon_R (the sword GLB, or a stick sword
 * while it is missing). Armor is `<model>_<body>.glb` (e.g. armor_guard_human_f) re-bound to the
 * character's own skeleton by bone names; while that file is missing, steel plates hang on the
 * bones instead (breastplate, pauldrons, bracers, faulds, greaves). Never rejects (callers fire and
 * forget it): a failed load is logged and the slot stays empty.
 */
export async function equip(view: CharacterView, slot: EquipSlot, itemId: string | null): Promise<void> {
  const map = attached.get(view) ?? new Map<EquipSlot, THREE.Object3D[]>();
  attached.set(view, map);
  const reqs = requests.get(view) ?? new Map<EquipSlot, number>();
  requests.set(view, reqs);
  const id = ++requestId;
  reqs.set(slot, id);
  const stale = () => reqs.get(slot) !== id;
  for (const old of map.get(slot) ?? []) {
    old.removeFromParent();
    disposeInstance(old, old.userData.placeholder === true);
  }
  map.delete(slot);
  if (!itemId) return;
  try {
    const item = ITEMS[itemId];
    if (!item) throw new Error(`unknown item ${itemId}`);
    if (item.slot !== slot) throw new Error(`${itemId} does not go in ${slot}`);
    const objs = slot === 'weapon' ? await loadWeapon(view, item.model) : await loadArmor(view, item.model);
    if (stale()) {
      for (const o of objs) disposeInstance(o, o.userData.placeholder === true);
      return;
    }
    map.set(slot, objs);
  } catch (err) {
    if (!stale()) console.error(`equip ${slot} ${itemId} failed:`, err);
  }
}

/** What is attached in a slot right now (tests and debugging): GLB names or 'placeholder'. */
export function equippedParts(view: CharacterView, slot: EquipSlot): string[] {
  return (attached.get(view)?.get(slot) ?? []).map((o) => o.name);
}

async function loadWeapon(view: CharacterView, model: string): Promise<THREE.Object3D[]> {
  const gltf = await loadModelOrNull(model);
  const obj = gltf ? gltf.scene.clone(true) : buildPlaceholderSword();
  obj.name = gltf ? model : 'placeholder';
  obj.userData.placeholder = !gltf;
  prepare(obj, !!gltf);
  const socket = view.attachPoint('Socket_Weapon_R') ?? view.attachPoint('RightHand') ?? view.model;
  socket.add(obj);
  return [obj];
}

async function loadArmor(view: CharacterView, model: string): Promise<THREE.Object3D[]> {
  const name = `${model}_${bodyModel(view.appearance)}`;
  const skeleton = view.skeleton;
  const gltf = skeleton ? await loadModelOrNull(name) : null;
  if (!gltf || !skeleton) return armorPlates(view);
  // re-bind every skinned mesh to the character's bones, matched by name
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const group = new THREE.Group();
  group.name = name;
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
  prepare(group, true);
  view.model.add(group);
  return [group];
}

// ------------------------------------------------------------------ placeholder plates

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** A shape built in the model's rest space, re-expressed in a bone's frame and hung on it. */
function hang(view: CharacterView, boneName: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Object3D | null {
  const bone = view.attachPoint(boneName);
  const rest = view.restMatrix(boneName);
  if (!bone || !rest) return null;
  geometry.applyMatrix4(_m.copy(rest).invert());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'placeholder';
  mesh.userData.placeholder = true;
  bone.add(mesh);
  return mesh;
}

/** The rest position (model space) of a node, if the model has it. */
function restPos(view: CharacterView, name: string, out: THREE.Vector3): THREE.Vector3 | null {
  const m = view.restMatrix(name);
  return m ? out.setFromMatrixPosition(m) : null;
}

/** A cylinder (with rounded ends) from a to b, radius r: model space. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, flare = 1): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r * flare, r, len, 14, 1, false).translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _b.copy(b).sub(a).normalize()));
  return g.translate(a.x, a.y, a.z);
}

/**
 * The Guard armor's stand-in: steel plates on the character's bones, measured from its rest pose
 * so they fit any body (the four GLB bodies or the capsule hero) and follow every clip.
 */
function armorPlates(view: CharacterView): THREE.Object3D[] {
  // a darker steel than the sword's fittings: big plates in the light band would read white
  const steel = toonMaterial({ name: 'Metal', color: '#8e98a8' }, { rim: 1 });
  const leather = toonMaterial({ name: 'Leather', color: SLOT_DEFAULTS.Leather }, { rim: 0.6 });
  const out: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D | null) => o && out.push(o);
  const p = (name: string) => restPos(view, name, new THREE.Vector3());
  const head = p('Head');
  const hips = p('Hips');
  const chest = p('Chest') ?? p('Spine');
  const armL = p('LeftUpperArm');
  const armR = p('RightUpperArm');
  if (!head || !hips || !chest) return out;
  const s = head.y / 1.6; // body scale (1 for a 1.8 m hero)
  const shoulders = armL && armR ? armL.distanceTo(armR) / 2 : 0.2 * s;
  // breastplate: a rounded shell over the chest, a ridge down its middle, and faulds at the waist
  const neck = p('Neck') ?? head;
  const c = new THREE.Vector3().lerpVectors(chest, neck, 0.32);
  c.z += 0.03 * s;
  const plate = new THREE.SphereGeometry(1, 24, 16).scale(Math.max(shoulders * 1.05, 0.19 * s), 0.27 * s, 0.205 * s).translate(c.x, c.y, c.z);
  add(hang(view, view.restMatrix('Chest') ? 'Chest' : 'Spine', plate, steel));
  const belt = new THREE.CylinderGeometry(0.18 * s, 0.2 * s, 0.07 * s, 20).scale(1.05, 1, 0.8).translate(hips.x, hips.y + 0.1 * s, hips.z);
  add(hang(view, 'Hips', belt, leather));
  const faulds = new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.11 * s, 20, 1, true).scale(1.05, 1, 0.85).translate(hips.x, hips.y + 0.02 * s, hips.z);
  add(hang(view, 'Hips', faulds, steel));
  for (const side of ['Left', 'Right']) {
    const shoulder = p(`${side}UpperArm`);
    const elbow = p(`${side}LowerArm`);
    const wrist = p(`${side}Hand`);
    if (shoulder) {
      const pauldron = new THREE.SphereGeometry(0.105 * s, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1.15, 0.85, 1.15).translate(shoulder.x, shoulder.y + 0.03 * s, shoulder.z);
      add(hang(view, `${side}UpperArm`, pauldron, steel));
    }
    if (elbow && wrist) {
      add(hang(view, `${side}LowerArm`, tube(_a.lerpVectors(elbow, wrist, 0.3), _b.lerpVectors(elbow, wrist, 0.86).clone(), 0.05 * s, 1.15), steel));
    }
    const knee = p(`${side}LowerLeg`);
    const foot = p(`${side}Foot`) ?? (knee ? knee.clone().setY(knee.y - 0.42 * s) : null);
    if (knee && foot) {
      add(hang(view, `${side}LowerLeg`, tube(_a.lerpVectors(knee, foot, 0.14), _b.lerpVectors(knee, foot, 0.8).clone(), 0.064 * s, 1.12), steel));
      add(hang(view, `${side}LowerLeg`, new THREE.SphereGeometry(0.062 * s, 12, 8).scale(1, 1.1, 0.8).translate(knee.x, knee.y, knee.z + 0.045 * s), steel));
    }
  }
  for (const o of out) prepare(o, false);
  return out;
}
