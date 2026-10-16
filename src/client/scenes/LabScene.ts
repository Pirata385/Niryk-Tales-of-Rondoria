import * as THREE from 'three';
import { defaultAppearance, type Appearance, type Gender, type Race } from '@shared/appearance';
import { loadTexture } from '../core/assets';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { IsoCamera } from '../render/IsoCamera';
import { Lighting } from '../render/Lighting';
import { PixelPipeline } from '../render/PixelPipeline';
import { createGround } from '../world/Ground';

/**
 * Model lab (?scene=lab): characters on a grass patch through the real game pipeline, for reviews.
 *   race=human|harpin gender=m|f hair=<style> anim=<clip> t=<sec> zoom=<n> views=<1..4>
 *   skin/haircolor/plume/eyes=<hex without #>  rot=<deg>  play (animate instead of a still)
 *   armor (wear the armor)  nosword
 */
export async function runLabScene(canvas: HTMLCanvasElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const pipeline = new PixelPipeline(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  iso.zoom = Number(q.get('zoom') ?? 1);
  const lighting = new Lighting(scene);

  const [grassA, grassB, dirt, cobble, noise] = await Promise.all(
    ['ground_grass_a', 'ground_grass_b', 'ground_dirt', 'ground_cobble', 'noise'].map((n) => loadTexture(`sprites/${n}.png`)),
  );
  scene.add(
    createGround({ grassA, grassB, dirt, cobble, noise }, { size: 32, step: 2, height: () => 0, splat: () => [0, 0, 0, 0] }),
  );

  const base = defaultAppearance((q.get('race') as Race) ?? 'human', (q.get('gender') as Gender) ?? 'm');
  const hex = (k: string) => (q.get(k) ? `#${q.get(k)}` : undefined);
  const app: Appearance = {
    ...base,
    hairStyle: q.get('hair') ?? base.hairStyle,
    skin: hex('skin') ?? base.skin,
    hairColor: hex('haircolor') ?? base.hairColor,
    plumeColor: hex('plume') ?? base.plumeColor,
    eyeColor: hex('eyes') ?? base.eyeColor,
  };
  const anim = (q.get('anim') ?? 'Idle') as AnimName;
  const views = Math.max(1, Math.min(4, Number(q.get('views') ?? 1)));
  const rot0 = THREE.MathUtils.degToRad(Number(q.get('rot') ?? 0));
  const time = Number(q.get('t') ?? 0);
  const playing = q.has('play');
  const chars: CharacterView[] = [];
  for (let i = 0; i < views; i++) {
    const c = await CharacterView.create(app, { xray: 'player' });
    if (!q.has('nosword')) await equip(c, 'weapon', 'sword_iron');
    if (q.has('armor')) await equip(c, 'armor', 'armor_guard');
    const offset = (i - (views - 1) / 2) * 1.5;
    c.root.position.copy(iso.right).multiplyScalar(offset);
    c.root.rotation.y = rot0 + (i * Math.PI) / 2;
    scene.add(c.root);
    if (playing) c.play(anim);
    else c.pose(anim, time);
    chars.push(c);
  }

  const resize = () => pipeline.resize(innerWidth, innerHeight, devicePixelRatio);
  addEventListener('resize', resize);
  resize();
  const clock = new THREE.Clock();
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (playing) for (const c of chars) c.update(dt);
    iso.target.set(0, 0.85, 0);
    lighting.follow(iso.target);
    pipeline.render(scene, iso);
    (window as unknown as { __niryk: unknown }).__niryk = { ready: true, info: pipeline.renderer.info.render };
    requestAnimationFrame(frame);
  };
  frame();
}
