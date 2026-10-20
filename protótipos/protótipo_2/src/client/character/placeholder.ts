import * as THREE from 'three';
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
}

const SLOT_COLORS: Record<string, string> = {
  Skin: '#f0c8a8',
  Hair: '#6a4632',
  Cloth_A: '#e8e4dc',
  Cloth_B: '#d8d0c4',
  Leather: '#c8a888',
  Metal: '#d4d8e0',
  Eye: '#2b2b2b',
};

const materials = new Map<string, THREE.MeshToonMaterial>();
function slot(name: string): THREE.MeshToonMaterial {
  // one material per slot per character: the view recolors them
  const m = toonMaterial({ name, color: SLOT_COLORS[name] ?? '#ffffff' }, { rim: 1 });
  materials.set(name, m);
  return m;
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

export function buildPlaceholderHuman(): PlaceholderParts {
  const mats = Object.fromEntries(Object.keys(SLOT_COLORS).map((k) => [k, slot(k)])) as Record<string, THREE.MeshToonMaterial>;
  const root = new THREE.Group();
  root.name = 'PlaceholderHuman';
  const hips = joint('Hips', 0, 0.95, 0, root);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12).scale(1.05, 0.7, 0.8), mats.Cloth_B);
  pelvis.name = 'Body_pelvis';
  hips.add(pelvis);
  const chest = joint('Chest', 0, 0.1, 0, hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 6, 16).scale(1.2, 1, 0.78).translate(0, 0.26, 0), mats.Cloth_A);
  torso.name = 'Body_torso';
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 24).rotateX(Math.PI / 2).scale(1.12, 1, 0.82).translate(0, 0.02, 0), mats.Leather);
  belt.name = 'Body_belt';
  chest.add(torso, belt);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 10).translate(0, 0.58, 0), mats.Skin);
  neck.name = 'Body_neck';
  chest.add(neck);
  const head = joint('Head', 0, 0.68, 0.01, chest);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16).scale(0.95, 1.1, 1).translate(0, 0.06, 0), mats.Skin);
  skull.name = 'Head_skull';
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.08, 1.06).translate(0, 0.075, -0.012), mats.Hair);
  hair.name = 'Hair_cap';
  const eyes = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 8, 6)
      .translate(0.04, 0.07, 0.1)
      .toNonIndexed(),
    mats.Eye,
  );
  eyes.name = 'Head_eye_l';
  const eyeR = eyes.clone();
  eyeR.name = 'Head_eye_r';
  eyeR.position.x = -0.08;
  head.add(skull, hair, eyes, eyeR);

  const arm = (side: 1 | -1) => {
    const shoulder = joint(side > 0 ? 'LeftUpperArm' : 'RightUpperArm', side * 0.25, 0.44, 0, chest);
    shoulder.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mats.Cloth_A));
    shoulder.add(capsule(0.06, 0.2, mats.Cloth_A, 'Body_upperarm'));
    const fore = joint(side > 0 ? 'LeftLowerArm' : 'RightLowerArm', 0, -0.3, 0, shoulder);
    fore.add(capsule(0.05, 0.19, mats.Skin, 'Body_forearm'));
    const hand = joint(side > 0 ? 'LeftHand' : 'RightHand', 0, -0.27, 0.01, fore);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10).scale(0.9, 1.1, 1), mats.Skin);
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
    hip.add(capsule(0.085, 0.3, mats.Cloth_B, 'Body_thigh'));
    const shin = joint(side > 0 ? 'LeftLowerLeg' : 'RightLowerLeg', 0, -0.44, 0, hip);
    shin.add(capsule(0.07, 0.3, mats.Leather, 'Body_boot'));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.22).translate(0, -0.42, 0.05), mats.Leather);
    foot.name = 'Body_foot';
    shin.add(foot);
    return { hip, shin };
  };
  const L = arm(1);
  const R = arm(-1);
  const LL = leg(1);
  const RL = leg(-1);
  // rest pose: arms slightly away from the body
  L.shoulder.rotation.z = 0.12;
  R.shoulder.rotation.z = -0.12;
  return {
    root, hips, chest, head, armL: L.shoulder, armR: R.shoulder, foreL: L.fore, foreR: R.fore, legL: LL.hip, legR: RL.hip, shinL: LL.shin, shinR: RL.shin,
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
