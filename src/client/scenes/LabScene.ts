import * as THREE from 'three';
import { defaultAppearance, type Appearance, type Gender, type Race } from '@shared/appearance';
import { WOLF } from '@shared/constants';
import { loadSpriteAtlas, loadTexture } from '../core/assets';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { Effects } from '../game/Effects';
import { Markers } from '../game/Markers';
import { WolfView } from '../game/WolfView';
import { Billboards } from '../render/Billboards';
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
 *   markers (with lineup): legibility markers as in the game: the ground ring under the first
 *     body, a health bar and a lunge warning (warn=<0..1> progress) on the lineup wolf over a
 *     cobble patch, and a second wounded, warning wolf hidden behind a tree canopy
 */
export async function runLabScene(canvas: HTMLCanvasElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const pipeline = new PixelPipeline(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  iso.zoom = Number(q.get('zoom') ?? 1);
  const lighting = new Lighting(scene);

  const markersOn = q.has('markers') && q.has('lineup');
  // markers: lineup wolf position (stands on cobble) and the hidden wolf + the tree in front of it
  const wolfAt = new THREE.Vector3().copy(iso.right).multiplyScalar(2 * 1.6 + 0.6);
  const hiddenAt = new THREE.Vector3().copy(iso.right).multiplyScalar(-0.8).addScaledVector(iso.groundUp, 6);
  const treeAt = new THREE.Vector3().copy(iso.right).multiplyScalar(-0.8).addScaledVector(iso.groundUp, 2.5);

  const [grassA, grassB, dirt, cobble, noise] = await Promise.all(
    ['ground_grass_a', 'ground_grass_b', 'ground_dirt', 'ground_cobble', 'noise'].map((n) => loadTexture(`sprites/${n}.png`)),
  );
  const cobbleAt = (x: number, z: number) => (markersOn && Math.hypot(x - wolfAt.x, z - wolfAt.z) < 2.2 ? 1 : 0);
  scene.add(
    createGround(
      { grassA, grassB, dirt, cobble, noise },
      { size: 32, step: 2, height: () => 0, splat: (x, z) => [0, 0, cobbleAt(x, z), 0] },
    ),
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
    w.root.position.copy(wolfAt);
    w.root.rotation.y = rot0 - Math.PI / 4;
    scene.add(w.root);
    const wolfAnim = ({ Idle: 'Idle', Walk: 'Walk', Run: 'Run', Attack1: 'Attack', Attack2: 'Attack', Hit: 'Hit', Death: 'Death' } as const)[anim] ?? 'Idle';
    w.setAnim(wolfAnim, 0, 0);
    w.setXray(wolfAnim !== 'Death');
    w.update(playing ? 0 : time);
    wolves.push(w);
    if (markersOn) {
      const hidden = await WolfView.create();
      hidden.root.position.copy(hiddenAt);
      hidden.root.rotation.y = rot0 + Math.PI / 4;
      hidden.setAnim('Idle', 0, 0);
      hidden.update(0);
      scene.add(hidden.root);
      wolves.push(hidden);
      const { atlas, texture } = await loadSpriteAtlas('nature');
      scene.add(new Billboards(atlas, texture, [{ frame: 'oak_round_1', x: treeAt.x, y: 0, z: treeAt.z }]).group);
    }
  }
  const markers = new Markers(pipeline, iso);
  const effects = new Effects(document.createElement('div'), pipeline, iso);
  if (markersOn) scene.add(markers.group, effects.group);
  const warn = Number(q.get('warn') ?? 0.4);
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
    if (markersOn) {
      // same calls as the game makes every frame (see GameScene)
      const me = chars[0].root.position;
      markers.beginFrame();
      markers.playerRing(me.x, 0, me.z);
      markers.wolfBar(wolfAt.x, 0, wolfAt.z, 35, WOLF.hp);
      markers.wolfBar(hiddenAt.x, 0, hiddenAt.z, 9, WOLF.hp);
      effects.telegraph(1, true, wolfAt.x, 0, wolfAt.z, warn);
      effects.telegraph(2, true, hiddenAt.x, 0, hiddenAt.z, 0);
    }
    pipeline.render(scene, iso);
    effects.update(dt, innerWidth, innerHeight);
    (window as unknown as { __niryk: unknown }).__niryk = { ready: true, info: pipeline.renderer.info.render };
    requestAnimationFrame(frame);
  };
  frame();
}
