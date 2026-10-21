import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HAIR_STYLES, type Gender, type Race } from '@shared/appearance';
import { toonMaterial } from '../render/toon';

/**
 * A stand-in hero while the human GLB is missing: capsules and spheres in the color slots of the
 * real model (Skin, Hair, Cloth_A, Cloth_B, Leather, Metal), jointed like the rig (hips, legs,
 * arms, a Head node for the first-person camera, Socket_Weapon_R in the right hand) and animated
 * procedurally by PlaceholderRig.
 */
export interface PlaceholderParts {
  root: THREE.Group;
  hips: THREE.Object3D;
  chest: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  /** Harpins: the tail (sways with the walk) and the two wings. */
  tail: THREE.Object3D | null;
  wings: THREE.Object3D[];
}

const SLOT_COLORS: Record<string, string> = {
  Skin: '#f0c8a8',
  Hair: '#6a4632',
  Plume: '#ecebe6',
  Talon: '#3a3036',
  Cloth_A: '#e8e4dc',
  Cloth_B: '#d8d0c4',
  Leather: '#c8a888',
  Metal: '#d4d8e0',
  Eye: '#2b2b2b',
};

function slot(name: string): THREE.MeshToonMaterial {
  // one material per slot per character: the view recolors them
  return toonMaterial({ name, color: SLOT_COLORS[name] ?? '#ffffff' }, { rim: 1, warm: name === 'Skin' ? 0.8 : 0 });
}

function capsule(r: number, len: number, mat: THREE.Material, name: string, y = -len / 2 - r): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14).translate(0, y, 0), mat);
  m.name = name;
  return m;
}

function joint(name: string, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** A feather or spike: a cone flattened sideways, its base at the origin pointing along +Y. */
function feather(r: number, len: number, flat = 0.45): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, len, 8).translate(0, len / 2, 0).scale(1, 1, flat);
}

/** Merges geometries (all with or all without an index) into one. */
function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const plain = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of plain) {
    g.deleteAttribute('uv');
  }
  return mergeGeometries(plain)!;
}

/** The skull cap every hair style starts from (head space: the Head joint sits on the neck). */
function hairCap(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.125, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.08, 1.06).translate(0, 0.075, -0.012);
}

/** Head-space shapes of each hair style (on top of the cap), merged into one Hair_<style> mesh. */
function hairStyle(style: string): THREE.BufferGeometry {
  const parts = [hairCap()];
  const back = (len: number, width: number) =>
    new THREE.CapsuleGeometry(0.1, len, 6, 14).scale(width, 1, 0.42).translate(0, 0.06 - len / 2, -0.085);
  const locks = (len: number) =>
    [-1, 1].map((s) => new THREE.CapsuleGeometry(0.03, len, 4, 10).translate(s * 0.105, 0.05 - len / 2, 0.02));
  switch (style) {
    case 'rabo':
      parts.push(new THREE.SphereGeometry(0.04, 10, 8).translate(0, 0.1, -0.13));
      parts.push(new THREE.CapsuleGeometry(0.04, 0.24, 6, 10).rotateX(-0.35).translate(0, -0.04, -0.17));
      break;
    case 'longo':
      parts.push(back(0.26, 1.15), ...locks(0.16));
      break;
    case 'coque':
      parts.push(new THREE.SphereGeometry(0.065, 14, 10).translate(0, 0.17, -0.09));
      break;
    case 'espetado':
      for (const [x, z, rx, rz] of [[0, 0.05, -0.5, 0], [0.06, -0.02, -0.9, -0.5], [-0.06, -0.02, -0.9, 0.5], [0, -0.07, -1.3, 0], [0.08, 0.04, -0.4, -0.7], [-0.08, 0.04, -0.4, 0.7]]) {
        parts.push(feather(0.045, 0.15).rotateX(rx).rotateZ(rz).translate(x, 0.15, z));
      }
      break;
    case 'crista':
      for (let i = 0; i < 5; i++) parts.push(feather(0.05, 0.2 - i * 0.015, 0.3).rotateX(-0.4 - i * 0.25).translate(0, 0.18 - i * 0.012, 0.06 - i * 0.05));
      break;
    case 'plumado':
      parts.push(back(0.32, 1.2), ...locks(0.2));
      for (const s of [-0.6, 0, 0.6]) parts.push(feather(0.04, 0.12).rotateX(Math.PI).translate(s * 0.1, -0.33, -0.09));
      break;
  }
  return merged(parts);
}

export interface PlaceholderOptions {
  race: Race;
  gender: Gender;
}

/**
 * The stand-in body for a race and gender: a slimmer frame for women; Harpins get folded feather
 * wings, a long plumed tail, temple feathers, feathered shins and talons (Plume and Talon slots).
 * Every hair style of the race is built (Hair_<style>); the view shows the chosen one.
 */
export function buildPlaceholderHuman(opts: PlaceholderOptions = { race: 'human', gender: 'm' }): PlaceholderParts {
  const mats = Object.fromEntries(Object.keys(SLOT_COLORS).map((k) => [k, slot(k)])) as Record<string, THREE.MeshToonMaterial>;
  const f = opts.gender === 'f';
  const harpin = opts.race === 'harpin';
  const root = new THREE.Group();
  root.name = 'PlaceholderHuman';
  const hips = joint('Hips', 0, 0.95, 0, root);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12).scale(f ? 1.12 : 1.05, 0.7, 0.8), mats.Cloth_B);
  pelvis.name = 'Body_pelvis';
  hips.add(pelvis);
  const chest = joint('Chest', 0, 0.1, 0, hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 6, 16).scale(f ? 1.05 : 1.2, 1, 0.78).translate(0, 0.26, 0), mats.Cloth_A);
  torso.name = 'Body_torso';
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 24).rotateX(Math.PI / 2).scale(f ? 1.0 : 1.12, 1, 0.82).translate(0, 0.02, 0), mats.Leather);
  belt.name = 'Body_belt';
  chest.add(torso, belt);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 10).translate(0, 0.58, 0), mats.Skin);
  neck.name = 'Body_neck';
  chest.add(neck);
  const head = joint('Head', 0, 0.68, 0.01, chest);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16).scale(0.95, 1.1, 1).translate(0, 0.06, 0), mats.Skin);
  skull.name = 'Head_skull';
  head.add(skull);
  for (const style of HAIR_STYLES[opts.race]) {
    const hair = new THREE.Mesh(hairStyle(style), mats.Hair);
    hair.name = `Hair_${style}`;
    head.add(hair);
  }
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8).scale(0.8, 1.15, 0.6).translate(side * 0.042, 0.065, 0.102), mats.Eye);
    eye.name = side > 0 ? 'Head_eye_l' : 'Head_eye_r';
    head.add(eye);
  }
  if (harpin) {
    // temple feathers sweeping back
    const temples = merged([1, -1].flatMap((s) => [0, 1].map((k) => feather(0.03, 0.17 - k * 0.04, 0.35).rotateX(-1.9 + k * 0.3).rotateZ(-s * 0.35).translate(s * 0.108, 0.075 + k * 0.025, 0.0))));
    const t = new THREE.Mesh(temples, mats.Plume);
    t.name = 'Head_feathers';
    head.add(t);
  }

  const shoulderX = f ? 0.22 : 0.25;
  const arm = (side: 1 | -1) => {
    const shoulder = joint(side > 0 ? 'LeftUpperArm' : 'RightUpperArm', side * shoulderX, 0.44, 0, chest);
    shoulder.add(new THREE.Mesh(new THREE.SphereGeometry(f ? 0.065 : 0.075, 12, 10), mats.Cloth_A));
    shoulder.add(capsule(f ? 0.052 : 0.06, 0.2, mats.Cloth_A, 'Body_upperarm'));
    const fore = joint(side > 0 ? 'LeftLowerArm' : 'RightLowerArm', 0, -0.3, 0, shoulder);
    fore.add(capsule(f ? 0.044 : 0.05, 0.19, mats.Skin, 'Body_forearm'));
    const hand = joint(side > 0 ? 'LeftHand' : 'RightHand', 0, -0.27, 0.01, fore);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(f ? 0.05 : 0.058, 12, 10).scale(0.9, 1.1, 1), mats.Skin);
    fist.name = 'Body_hand';
    hand.add(fist);
    if (side < 0) {
      const socket = joint('Socket_Weapon_R', 0, -0.02, 0.02, hand);
      socket.rotation.x = Math.PI / 2; // the blade points forward out of the fist (+Y of the socket)
    }
    return { shoulder, fore };
  };
  const leg = (side: 1 | -1) => {
    const hip = joint(side > 0 ? 'LeftUpperLeg' : 'RightUpperLeg', side * 0.1, -0.04, 0, hips);
    hip.add(capsule(f ? 0.08 : 0.085, 0.3, mats.Cloth_B, 'Body_thigh'));
    const shin = joint(side > 0 ? 'LeftLowerLeg' : 'RightLowerLeg', 0, -0.44, 0, hip);
    if (harpin) {
      // feathered eagle shins ending in talons
      shin.add(capsule(0.08, 0.26, mats.Plume, 'Body_shin', -0.17));
      const talons = merged([-0.5, 0, 0.5].map((a) => new THREE.ConeGeometry(0.018, 0.1, 6).rotateX(Math.PI / 2).translate(0, -0.42, 0.06).rotateY(a * 0.6)));
      const t = new THREE.Mesh(talons, mats.Talon);
      t.name = 'Body_talons';
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.6, 1.3).translate(0, -0.41, 0.02), mats.Talon);
      foot.name = 'Body_foot';
      shin.add(t, foot);
    } else {
      shin.add(capsule(0.07, 0.3, mats.Leather, 'Body_boot'));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.22).translate(0, -0.42, 0.05), mats.Leather);
      foot.name = 'Body_foot';
      shin.add(foot);
    }
    return { hip, shin };
  };
  const L = arm(1);
  const R = arm(-1);
  const LL = leg(1);
  const RL = leg(-1);
  // rest pose: arms slightly away from the body
  L.shoulder.rotation.z = 0.12;
  R.shoulder.rotation.z = -0.12;

  let tail: THREE.Object3D | null = null;
  const wings: THREE.Object3D[] = [];
  if (harpin) {
    // a long mammal tail with a plume, hanging back from the hips
    tail = joint('Tail', 0, -0.02, -0.13, hips);
    tail.rotation.x = 2.25;
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.55, 6, 12).translate(0, 0.3, 0), mats.Plume);
    t.name = 'Body_tail';
    const tuft = new THREE.Mesh(merged([-0.35, 0, 0.35].map((a) => feather(0.06, 0.26, 0.3).rotateZ(a).translate(0, 0.58, 0))), mats.Plume);
    tuft.name = 'Body_tail_tuft';
    tail.add(t, tuft);
    // big folded wings behind the shoulders, reaching past the hips
    for (const side of [1, -1]) {
      const w = joint(side > 0 ? 'WingL' : 'WingR', side * 0.12, 0.5, -0.16, chest);
      w.rotation.set(-0.18, side * 0.4, side * 0.32);
      const vane = new THREE.Mesh(
        merged([
          new THREE.SphereGeometry(0.5, 18, 12).scale(0.34, 1, 0.09).translate(side * 0.12, -0.28, 0),
          ...[0, 1, 2].map((k) => feather(0.07, 0.36, 0.25).rotateZ(Math.PI + side * (0.1 + k * 0.18)).translate(side * (0.08 + k * 0.08), -0.62 + k * 0.08, -0.01)),
        ]),
        mats.Plume,
      );
      vane.name = 'Body_wing';
      w.add(vane);
      wings.push(w);
    }
  }
  if (f) root.scale.setScalar(0.96);
  return {
    root, hips, chest, head, armL: L.shoulder, armR: R.shoulder, foreL: L.fore, foreR: R.fore, legL: LL.hip, legR: RL.hip, shinL: LL.shin, shinR: RL.shin, tail, wings,
  };
}

/** A stick sword (blade along +Y of its parent socket). */
export function buildPlaceholderSword(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'sword_placeholder';
  const metal = toonMaterial({ name: 'Metal', color: '#c9d0da' }, { rim: 1 });
  const leather = toonMaterial({ name: 'Leather', color: '#6a4630' }, { rim: 0.5 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.72, 0.014).translate(0, 0.5, 0), metal);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.039, 0.1, 4).rotateY(Math.PI / 4).scale(1, 1, 0.25).translate(0, 0.91, 0), metal);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.04).translate(0, 0.12, 0), metal);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.14, 8).translate(0, 0.04, 0), leather);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8).translate(0, -0.04, 0), metal);
  for (const m of [blade, tip, guard, grip, pommel]) m.name = 'Sword_part';
  g.add(blade, tip, guard, grip, pommel);
  return g;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Procedural animation of the placeholder: a walk/run/strafe/back-pedal cycle driven by the
 * locomotion phase and the local velocity, an idle sway, sword swings, a hit flinch and a fall.
 */
export class PlaceholderRig {
  private t = 0;

  constructor(private readonly p: PlaceholderParts) {}

  update(dt: number, loco: { phase: number; fwd: number; side: number; speed: number }, shot: { name: string; t: number } | null): void {
    this.t += dt;
    const p = this.p;
    const s = Math.min(1, loco.speed / 1.9);
    const run = Math.max(0, Math.min(1, (loco.speed - 2.2) / 2.5));
    const amp = s * (0.5 + run * 0.45);
    const w = loco.phase * Math.PI * 2;
    const total = Math.abs(loco.fwd) + Math.abs(loco.side) || 1;
    const fw = loco.fwd / total;
    const sd = loco.side / total;
    const sw = Math.sin(w);
    // legs swing along the movement (forward/back about X, sideways about Z)
    p.legL.rotation.set(sw * amp * fw, 0, sw * amp * sd * 0.6);
    p.legR.rotation.set(-sw * amp * fw, 0, -sw * amp * sd * 0.6);
    p.shinL.rotation.x = Math.max(0, -Math.cos(w)) * amp * 1.3 * Math.abs(fw) + Math.max(0, Math.sin(w)) * 0.1 * s;
    p.shinR.rotation.x = Math.max(0, Math.cos(w)) * amp * 1.3 * Math.abs(fw) + Math.max(0, -Math.sin(w)) * 0.1 * s;
    p.hips.position.y = 0.95 - Math.abs(Math.cos(w)) * 0.04 * s - run * 0.04;
    p.chest.rotation.set(run * 0.18 + Math.sin(this.t * 1.7) * 0.015, Math.sin(w) * 0.12 * s * fw, 0);
    p.armL.rotation.set(-sw * amp * 0.7 * fw, 0, 0.12);
    p.armR.rotation.set(sw * amp * 0.7 * fw - 0.15, 0, -0.12);
    p.foreL.rotation.x = -0.25 - run * 0.9;
    p.foreR.rotation.x = -0.45 - run * 0.7;
    p.root.rotation.x = 0;
    p.root.position.y = 0;
    if (p.tail) {
      p.tail.rotation.z = Math.sin(this.t * 1.3) * 0.08 + Math.sin(w) * 0.12 * s;
      p.tail.rotation.x = 2.25 - run * 0.5;
    }
    for (let i = 0; i < p.wings.length; i++) p.wings[i].rotation.x = -0.18 - run * 0.15 + Math.sin(this.t * 1.1 + i) * 0.02;
    if (!shot) return;
    if (shot.name === 'Attack1' || shot.name === 'Attack2') {
      const dur = shot.name === 'Attack1' ? 0.5 : 0.55;
      const k = Math.min(1, shot.t / dur);
      const wind = ease(Math.min(1, k / 0.3));
      const strike = ease(Math.max(0, Math.min(1, (k - 0.3) / 0.35)));
      const back = ease(Math.max(0, (k - 0.75) / 0.25));
      if (shot.name === 'Attack1') {
        // horizontal: raise to the right, sweep across to the left
        p.armR.rotation.set(-1.35 * wind + 0.2 * strike, 0, (-1.2 * wind + 2.0 * strike) * (1 - back) - 0.12);
        p.chest.rotation.y = (0.6 * wind - 1.1 * strike) * (1 - back);
      } else {
        // diagonal: overhead and down
        p.armR.rotation.set((-2.6 * wind + 2.4 * strike) * (1 - back), 0, -0.4 * wind * (1 - back) - 0.12);
        p.chest.rotation.x = 0.35 * strike * (1 - back);
      }
      p.foreR.rotation.x = -0.3 * (1 - strike);
    } else if (shot.name === 'Hit') {
      const k = Math.sin(Math.min(1, shot.t / 0.36) * Math.PI);
      p.chest.rotation.x = -0.35 * k;
    } else if (shot.name === 'Death') {
      const k = ease(Math.min(1, shot.t / 0.7));
      p.root.rotation.x = -k * Math.PI * 0.48;
      p.root.position.y = k * 0.12;
    }
  }
}
