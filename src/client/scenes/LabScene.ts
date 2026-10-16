import * as THREE from 'three';
import { defaultAppearance, type Appearance, type Gender, type Race } from '@shared/appearance';
import { loadTexture } from '../core/assets';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { WolfView } from '../game/WolfView';
import { IsoCamera } from '../render/IsoCamera';
import { Lighting } from '../render/Lighting';
import { PixelPipeline } from '../render/PixelPipeline';
import { createGround } from '../world/Ground';

/**
 * Model lab (?scene=lab): characters on a grass patch through the real game pipeline, for reviews.
 *   race=human|harpin gender=m|f hair=<style> anim=<clip> t=<sec> zoom=<n> views=<1..4>
 *   skin/haircolor/plume/eyes=<hex without #>  rot=<deg>  play (animate instead of a still)
 *   armor (wear the armor)  nosword
 *   lineup: the four bodies (valid in-game colors) and a wolf side by side, at game scale
 *   dirs: the chosen body in 8 directions (0, 45 ... 315 deg) side by side
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
    clothColor: hex('cloth') ?? base.clothColor,
  };
  const anim = (q.get('anim') ?? 'Idle') as AnimName;
  const views = Math.max(1, Math.min(4, Number(q.get('views') ?? 1)));
  const rot0 = THREE.MathUtils.degToRad(Number(q.get('rot') ?? 0));
  const time = Number(q.get('t') ?? 0);
  const playing = q.has('play');
  const chars: CharacterView[] = [];
  const wolves: WolfView[] = [];
  if (q.has('lineup')) {
    const looks: Appearance[] = [
      { ...defaultAppearance('human', 'm'), skin: '#c68a5e', hairStyle: 'curto', hairColor: '#3b2619', eyeColor: '#3f6fa8' },
      { ...defaultAppearance('human', 'f'), skin: '#e8b994', hairStyle: 'longo', hairColor: '#a8432a', eyeColor: '#3f8a5c', clothColor: '#34507a' },
      { ...defaultAppearance('harpin', 'm'), skin: '#d9a57c', hairStyle: 'espetado', hairColor: '#ecebe6', plumeColor: '#2b2830', eyeColor: '#3f8a5c' },
      { ...defaultAppearance('harpin', 'f'), skin: '#f3d2b8', hairStyle: 'plumado', hairColor: '#3f72c4', plumeColor: '#3f72c4', eyeColor: '#8a7a3a', clothColor: '#7a5236' },
    ];
    for (const [i, look] of looks.entries()) {
      const c = await CharacterView.create(look, { xray: 'player' });
      if (!q.has('nosword')) await equip(c, 'weapon', 'sword_iron');
      if (q.has('armor')) await equip(c, 'armor', 'armor_guard');
      c.root.position.copy(iso.right).multiplyScalar((i - 2) * 1.6);
      c.root.rotation.y = rot0;
      scene.add(c.root);
      if (playing) c.play(anim);
      else c.pose(anim, time);
      c.setXray(anim !== 'Death');
      chars.push(c);
    }
    const w = await WolfView.create();
    w.root.position.copy(iso.right).multiplyScalar(2 * 1.6 + 0.6);
    w.root.rotation.y = rot0 - Math.PI / 4;
    scene.add(w.root);
    const wolfAnim = ({ Idle: 'Idle', Walk: 'Walk', Run: 'Run', Attack1: 'Attack', Attack2: 'Attack', Hit: 'Hit', Death: 'Death' } as const)[anim] ?? 'Idle';
    w.setAnim(wolfAnim, 0, 0);
    w.setXray(wolfAnim !== 'Death');
    w.update(playing ? 0 : time);
    wolves.push(w);
  }
  if (q.has('dirs')) {
    for (let i = 0; i < 8; i++) {
      const c = await CharacterView.create(app, { xray: 'player' });
      if (!q.has('nosword')) await equip(c, 'weapon', 'sword_iron');
      if (q.has('armor')) await equip(c, 'armor', 'armor_guard');
      c.root.position.copy(iso.right).multiplyScalar((i - 3.5) * 1.55);
      c.root.rotation.y = (i * Math.PI) / 4;
      scene.add(c.root);
      if (playing) c.play(anim);
      else c.pose(anim, time);
      c.setXray(anim !== 'Death');
      chars.push(c);
    }
  }
  for (let i = 0; i < (q.has('lineup') || q.has('dirs') ? 0 : views); i++) {
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
    if (playing) for (const c of [...chars, ...wolves]) c.update(dt);
    iso.target.set(Number(q.get('tx') ?? 0), Number(q.get('ty') ?? 0.85), Number(q.get('tz') ?? 0));
    lighting.follow(iso.target);
    pipeline.render(scene, iso);
    (window as unknown as { __niryk: unknown }).__niryk = { ready: true, info: pipeline.renderer.info.render };
    requestAnimationFrame(frame);
  };
  frame();
}
