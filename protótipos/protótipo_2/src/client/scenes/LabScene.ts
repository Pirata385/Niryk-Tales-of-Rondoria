import * as THREE from 'three';
import type { Appearance } from '@shared/appearance';
import { RUN_SPEED, WALK_SPEED } from '@shared/constants';
import { worldForSeed } from '@shared/world/worldCache';
import { CLEARING_WORLD } from '@shared/world/worldgen';
import { CharacterView, type OneShot } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { Lighting } from '../render/Lighting';
import { LOOK, SHARED } from '../render/look';
import type { Renderer } from '../render/Renderer';
import { Sky } from '../render/Sky';
import { WorldView } from '../world/WorldView';

/** Local velocity (x left, z forward, m/s) that drives each locomotion clip in the lab. */
const LOCO: Record<string, [number, number]> = {
  Idle: [0, 0],
  Walk: [0, WALK_SPEED],
  Run: [0, RUN_SPEED],
  WalkBack: [0, -WALK_SPEED * 0.7],
  StrafeLeft: [WALK_SPEED, 0],
  StrafeRight: [-WALK_SPEED, 0],
};

/**
 * A close look at the character in the clearing, to judge smoothness, toon bands and ink:
 *   ?scene=lab                     3/4 view of the upper body, Idle
 *   &anim=Run|Walk|Attack1|...     clip (locomotion clips are driven by their speed)
 *   &t=0.3                         seconds into the clip (frozen there)
 *   &turn=35                       how far the character is turned from facing the camera (deg)
 *   &dist=1.6 &h=1.35 &fov=35      camera distance, aim height and vertical field of view
 *   &fp                            first-person setup (head hidden, arms in the ready pose)
 *   &armor                         wearing the Guard armor
 */
export async function runLabScene(renderer: Renderer, appearance: Appearance): Promise<void> {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : d);
  const anim = q.get('anim') ?? 'Idle';
  const world = worldForSeed(1, CLEARING_WORLD);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(LOOK.fog, LOOK.fogNear, LOOK.fogFar);
  const sky = new Sky();
  scene.add(sky.mesh);
  const lighting = new Lighting(scene, { mapSize: 2048, radius: 12 });
  const worldView = await WorldView.create(world, { radius: 24, capacity: 6000, inkRadius: 9 });
  scene.add(worldView.group);

  const char = await CharacterView.create(appearance);
  await equip(char, 'weapon', 'sword_iron');
  if (q.has('armor')) await equip(char, 'armor', 'armor_guard');
  scene.add(char.root);
  const { x, z, yaw } = world.spawn;
  const gy = world.height(x, z);
  char.root.position.set(x, gy, z);
  // the camera looks the way the spawn faces (into the clearing); the character faces the camera, turned
  char.root.rotation.y = yaw + Math.PI - THREE.MathUtils.degToRad(num('turn', 35));
  if (q.has('fp')) char.setFirstPerson(true);

  const camera = new THREE.PerspectiveCamera(num('fov', 35), 1, 0.03, 400);
  const target = new THREE.Vector3(x, gy + num('h', 1.35), z);
  const dist = num('dist', 1.7);
  const lift = num('lift', 0.12);
  camera.position.set(x - Math.sin(yaw) * dist, target.y + lift, z - Math.cos(yaw) * dist);
  camera.lookAt(target);

  const resize = () => {
    renderer.resize(innerWidth, innerHeight, devicePixelRatio);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  // pose: drive the clip to `t` in 30 fps steps
  const [vl, vf] = LOCO[anim] ?? [0, 0];
  char.setVelocity(vl, vf);
  if (!(anim in LOCO)) char.playOneShot(anim as OneShot);
  const t = num('t', anim in LOCO ? 0.4 : 0.25);
  for (let s = 0; s < t; s += 1 / 30) char.update(Math.min(1 / 30, t - s) || 1 / 30);
  const feet = new THREE.Vector3(x, gy, z);
  lighting.follow(feet);
  sky.update(camera);
  worldView.update(camera, feet);
  SHARED.uTime.value = 1;

  let frames = 0;
  (window as unknown as { __niryk: unknown }).__niryk = {
    get ready() {
      return frames > 2;
    },
    get info() {
      return { ...renderer.renderer.info.render };
    },
  };
  const frame = () => {
    renderer.render(scene, camera);
    frames++;
    requestAnimationFrame(frame);
  };
  frame();
}
