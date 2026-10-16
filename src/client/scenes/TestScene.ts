import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ValueNoise } from '@shared/math/noise';
import { placeNature } from '@shared/world/nature';
import { loadModel, loadSpriteAtlas, loadTexture } from '../core/assets';
import { Billboards, type SpritePlacement } from '../render/Billboards';
import { IsoCamera } from '../render/IsoCamera';
import { Lighting, shadeSpritesUnder } from '../render/Lighting';
import { LAYER_OUTLINE, LAYER_XRAY, PixelPipeline } from '../render/PixelPipeline';
import { toonFromGltf } from '../render/toon';
import { createGround } from '../world/Ground';

/**
 * Look-development scene (?scene=test): painted ground + 2D nature + placeholder 3D models,
 * rendered through the full pixel pipeline. Used for the G1 art review.
 */
export async function runTestScene(canvas: HTMLCanvasElement): Promise<void> {
  const pipeline = new PixelPipeline(canvas);
  const params = new URLSearchParams(location.search);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  iso.zoom = Number(params.get('zoom') ?? 1);
  const lighting = new Lighting(scene);

  const noise = new ValueNoise(7);
  const size = 96;
  const half = size / 2;
  const pathX = (z: number) => Math.sin(z * 0.09) * 6 + 4;
  const heightAt = (x: number, z: number) => (noise.fbm(x, z, 18, 2) - 0.5) * 0.6;
  const plazaDist = (x: number, z: number) => Math.hypot(x + 6, z + 2);
  const housesAt: [number, number, number][] = [[-12, -10, 0.2], [-17, 3, Math.PI / 2]];
  const blocked = (x: number, z: number, r: number) =>
    Math.abs(x - pathX(z)) < 1.6 + r || plazaDist(x, z) < 7.2 + r || housesAt.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 5 + r);

  const { atlas, texture } = await loadSpriteAtlas('nature');
  const nature = placeNature({
    seed: 3,
    bounds: { minX: -half + 2, maxX: half - 2, minZ: -half + 2, maxZ: half - 2 },
    frames: atlas.frames,
    height: heightAt,
    blocked,
  });

  const [grassA, grassB, dirt, cobble, noiseTex] = await Promise.all([
    loadTexture('sprites/ground_grass_a.png'),
    loadTexture('sprites/ground_grass_b.png'),
    loadTexture('sprites/ground_dirt.png'),
    loadTexture('sprites/ground_cobble.png'),
    loadTexture('sprites/noise.png'),
  ]);
  const ground = createGround(
    { grassA, grassB, dirt, cobble, noise: noiseTex },
    {
      size,
      step: 1,
      height: heightAt,
      splat: (x, z) => {
        const r = noise.fbm(x + 100, z, 9, 3);
        const plaza = plazaDist(x, z);
        const dPath = Math.abs(x - pathX(z));
        return [r, plaza > 7 ? THREE.MathUtils.clamp(1.2 - dPath / 2.2, 0, 1) : 0, THREE.MathUtils.clamp((6.5 - plaza) / 1.5 + 0.5, 0, 1), nature.shade(x, z)];
      },
    },
  );
  scene.add(ground);

  // --- placeholder 3D models (real assets arrive in phases 2-3)
  const toonify = (root: THREE.Object3D, rim: number) => {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => toonFromGltf(m, { rim })) : toonFromGltf(mesh.material, { rim });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(LAYER_OUTLINE);
    });
  };
  const [heroG, wolfG, houseG] = await Promise.all([loadModel('t_hero'), loadModel('t_wolf'), loadModel('t_house')]);
  const hero = cloneSkinned(heroG.scene);
  toonify(hero, 0.35);
  hero.traverse((o) => (o as THREE.Mesh).isMesh && o.layers.enable(LAYER_XRAY));
  const [hx, hz] = (params.get('at') ?? '2,3').split(',').map(Number);
  hero.position.set(hx, heightAt(hx, hz), hz);
  scene.add(hero);
  const mixers: THREE.AnimationMixer[] = [];
  const heroMixer = new THREE.AnimationMixer(hero);
  heroMixer.clipAction(heroG.animations[0]).play();
  mixers.push(heroMixer);
  for (const [x, z, ry] of [[6, 9, -0.6], [8, 11, -0.9]] as const) {
    const wolf = cloneSkinned(wolfG.scene);
    toonify(wolf, 0.2);
    wolf.position.set(x, heightAt(x, z), z);
    wolf.rotation.y = ry;
    scene.add(wolf);
    const m = new THREE.AnimationMixer(wolf);
    m.clipAction(wolfG.animations[0]).play();
    mixers.push(m);
  }
  const houses: THREE.Object3D[] = [];
  for (const [x, z, ry] of housesAt) {
    const house = houseG.scene.clone();
    toonify(house, 0);
    house.position.set(x, heightAt(x, z), z);
    house.rotation.y = ry;
    house.updateMatrixWorld(true);
    scene.add(house);
    houses.push(house);
  }
  const placements: SpritePlacement[] = nature.placements.map((p) => ({ ...p, tint: new THREE.Color(...p.tint) }));
  shadeSpritesUnder(placements, houses, (f) => atlas.frames[f].rect[3] / atlas.pxPerMeter / Math.cos(THREE.MathUtils.degToRad(40)));
  const billboards = new Billboards(atlas, texture, placements);
  scene.add(billboards.group);

  // --- camera / input (WASD moves the placeholder hero)
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  const resize = () => pipeline.resize(innerWidth, innerHeight, devicePixelRatio);
  addEventListener('resize', resize);
  resize();

  const still = params.has('shot');
  const clock = new THREE.Clock();
  const move = new THREE.Vector2();
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    move.set(0, 0);
    if (keys.has('w') || keys.has('arrowup')) move.y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) move.y += 1;
    if (keys.has('a') || keys.has('arrowleft')) move.x -= 1;
    if (keys.has('d') || keys.has('arrowright')) move.x += 1;
    if (move.lengthSq() > 0) {
      const g = iso.screenToGround(move.x, move.y).normalize();
      hero.position.x += g.x * dt * 3;
      hero.position.z += g.y * dt * 3;
      hero.position.y = heightAt(hero.position.x, hero.position.z);
      hero.rotation.y = Math.atan2(g.x, g.y);
    }
    if (!still) {
      for (const m of mixers) m.update(dt);
      billboards.update(dt);
    } else {
      for (const m of mixers) m.setTime(0.3);
    }
    iso.target.copy(hero.position).add(new THREE.Vector3(0, 0.8, 0));
    lighting.follow(iso.target);
    pipeline.render(scene, iso);
    (window as unknown as { __niryk: unknown }).__niryk = { ready: true, info: pipeline.renderer.info.render };
    requestAnimationFrame(frame);
  };
  frame();
}
