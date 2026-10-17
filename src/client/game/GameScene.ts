import * as THREE from 'three';
import type { Appearance } from '@shared/appearance';
import { WOLF } from '@shared/constants';
import type { EntityState, Equipment, GameEvent } from '@shared/protocol';
import { CollisionWorld } from '@shared/world/collision';
import { worldForSeed } from '@shared/world/worldCache';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { Input } from '../input/Input';
import { LocalTransport } from '../net/LocalTransport';
import { CAMERA_PITCH_DEG, IsoCamera } from '../render/IsoCamera';
import { Lighting } from '../render/Lighting';
import type { PixelPipeline } from '../render/PixelPipeline';
import { Hud } from '../ui/Hud';
import { S } from '../ui/strings';
import { WorldView } from '../world/WorldView';
import { Effects } from './Effects';
import { GameClient, type Intent } from './GameClient';
import { WolfView } from './WolfView';

export interface AppContext {
  canvas: HTMLCanvasElement;
  pipeline: PixelPipeline;
  ui: HTMLElement;
}

interface View {
  kind: 'player' | 'wolf';
  char?: CharacterView;
  wolf?: WolfView;
  animKey: string;
  equipment: string;
  flash: number;
}

const WORLD_SEED = 1;
const SIN_PITCH = Math.sin(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));
/** Entities beyond this distance from the player are not drawn (the widest view is ~24 m across). */
const VIEW_RADIUS = 26;
const ONE_SHOT = new Set(['Attack1', 'Attack2', 'Attack', 'Hit', 'Death']);

/** The game: world + local server + entities + camera + HUD. Returns a dispose function. */
export async function runGame(ctx: AppContext, appearance: Appearance, onNewCharacter: () => void): Promise<() => void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = S.hud.loading;
  ctx.ui.append(loading);
  await new Promise((r) => setTimeout(r, 30)); // let the loading text paint

  const transport = new LocalTransport(WORLD_SEED);
  const client = new GameClient(transport);
  const welcome = await client.join(appearance);
  const world = worldForSeed(welcome.seed);
  const collision = new CollisionWorld(world.colliders, world.half);
  client.setCollision(collision);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  const lighting = new Lighting(scene, 24);
  const worldView = await WorldView.create(world);
  scene.add(worldView.group);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const views = new Map<number, View>();
  const pending = new Set<number>();
  let disposed = false;

  // eslint-disable-next-line prefer-const
  let input: Input;
  const hud = new Hud(
    ctx.ui,
    {
      onEquip: (slot, item) => client.send({ t: 'equip', slot, item }),
      onAttack: () => input.pressAttack(),
      onRespawn: () => client.send({ t: 'respawn' }),
      onNewCharacter,
    },
    touch,
  );
  const effects = new Effects(hud.fx, ctx.pipeline, iso); // damage numbers live in the HUD layer
  scene.add(effects.group);
  input = new Input(ctx.canvas, hud.joystick);
  input.touchMode = touch;
  input.onKey = (k) => {
    if (k === 'i') hud.toggleEquipment();
    if (k === 'escape') (hud.panelOpen ? hud.closeModal() : hud.toggleMenu());
  };

  client.onInventory = () => {
    hud.setInventory(client.equipment, client.items);
  };
  client.onError = (m) => console.error(m);
  client.onEvent = (e) => onEvent(e);
  hud.setInventory(client.equipment, client.items); // the inventory came with the welcome, before these hooks

  await client.waitForSelf();

  async function createView(e: EntityState): Promise<void> {
    if (pending.has(e.id)) return;
    pending.add(e.id);
    let v: View;
    if (e.kind === 'wolf') {
      const wolf = await WolfView.create();
      v = { kind: 'wolf', wolf, animKey: '', equipment: '', flash: 0 };
      scene.add(wolf.root);
    } else {
      const char = await CharacterView.create(e.appearance!, { xray: e.id === client.myId ? 'player' : undefined });
      v = { kind: 'player', char, animKey: '', equipment: '', flash: 0 };
      scene.add(char.root);
    }
    if (disposed) return;
    views.set(e.id, v);
    pending.delete(e.id);
  }

  function syncEquipment(v: View, eq: Equipment | undefined, isMe: boolean): void {
    if (!v.char || !eq) return;
    const key = `${eq.weapon}|${eq.armor}`;
    if (key === v.equipment) return;
    v.equipment = key;
    void equip(v.char, 'weapon', eq.weapon, isMe);
    void equip(v.char, 'armor', eq.armor, isMe);
  }

  function onEvent(e: GameEvent): void {
    if (e.e === 'damage') {
      const target = client.entities.get(e.target);
      const pos = new THREE.Vector3(e.x, world.height(e.x, e.z), e.z);
      effects.damageNumber(pos, e.amount, target?.kind === 'player' ? 'player' : 'enemy', e.crit);
      const v = views.get(e.target);
      if (v) v.flash = 0.14;
    } else if (e.e === 'swing') {
      const ent = client.entities.get(e.id);
      if (!ent) return;
      const self = e.id === client.myId ? client.renderedSelf() : ent;
      setTimeout(() => {
        const s = e.id === client.myId ? client.renderedSelf() : self;
        effects.slash(s.x, world.height(s.x, s.z), s.z, ent.yaw, e.anim === 'Attack2');
      }, (e.anim === 'Attack2' ? 0.22 : 0.17) * 1000);
    }
  }

  function aimFromScreen(at: { x: number; y: number } | null, self: { x: number; z: number; yaw: number }): number | null {
    if (at) {
      const p = ctx.pipeline.worldToCss(new THREE.Vector3(self.x, world.height(self.x, self.z) + 0.9, self.z), iso, innerWidth, innerHeight);
      const dx = at.x - p.x;
      const dy = at.y - p.y;
      // screen delta -> ground: screen-up is foreshortened by sin(pitch)
      const g = new THREE.Vector3().addScaledVector(iso.right, dx).addScaledVector(iso.groundUp, -dy / SIN_PITCH);
      return Math.atan2(g.x, g.z);
    }
    // touch / keyboard: auto-aim at the nearest wolf in reach
    let best: EntityState | null = null;
    let bd = 4.5;
    for (const e of client.entities.values()) {
      if (e.kind !== 'wolf' || e.hp <= 0) continue;
      const d = Math.hypot(e.x - self.x, e.z - self.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best ? Math.atan2(best.x - self.x, best.z - self.z) : null;
  }

  const resize = () => ctx.pipeline.resize(innerWidth, innerHeight, devicePixelRatio);
  addEventListener('resize', resize);
  resize();
  loading.remove();

  // debug/test hooks (tools/e2e.mjs, tools/shoot.mjs): getters, so nothing is allocated per frame
  (window as unknown as { __niryk: unknown }).__niryk = {
    get ready() {
      return views.has(client.myId);
    },
    get info() {
      return { ...ctx.pipeline.renderer.info.render };
    },
    get me() {
      const me = client.me;
      return me && { x: me.x, z: me.z, hp: me.hp, anim: me.anim };
    },
    get wolves() {
      return transport.debug.wolves();
    },
    get equipment() {
      return client.equipment;
    },
    get time() {
      return client.serverTime;
    },
    threeScene: scene,
    teleport: (x: number, z: number) => transport.debug.teleport(x, z),
  };

  const clock = new THREE.Clock();
  let lastSelf = { x: 0, z: 0 };
  let raf = 0;
  const frame = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    input.update();
    const me = client.me;
    const self = client.renderedSelf();
    const dead = !me || me.hp <= 0 || me.anim === 'Death';
    const blocked = hud.panelOpen || dead;
    const g = iso.screenToGround(input.move.x, input.move.y);
    const atk = input.consumeAttack();
    const intent: Intent = {
      mx: blocked ? 0 : g.x,
      mz: blocked ? 0 : g.y,
      run: input.run,
      attack: !blocked && atk.pressed,
      aim: atk.pressed ? aimFromScreen(atk.at, self) : null,
    };
    client.update(dt, intent);
    if (intent.mx || intent.mz) hud.hideHint();

    // entities
    for (const e of client.entities.values()) if (!views.has(e.id)) void createView(e);
    for (const [id, v] of views) {
      const e = client.entities.get(id);
      const obj = v.char?.root ?? v.wolf!.root;
      if (!e) {
        scene.remove(obj);
        views.delete(id);
        continue;
      }
      const isMe = id === client.myId;
      const pos = isMe ? client.renderedSelf() : (client.interpolated(id) ?? e);
      // skinned meshes skip frustum culling (animated bounds): cull far entities by distance instead
      obj.visible = isMe || Math.hypot(pos.x - self.x, pos.z - self.z) < VIEW_RADIUS;
      obj.position.set(pos.x, world.height(pos.x, pos.z), pos.z);
      obj.rotation.y = pos.yaw;
      let anim: string = e.anim;
      if (isMe && !ONE_SHOT.has(e.anim)) {
        const moved = Math.hypot(pos.x - lastSelf.x, pos.z - lastSelf.z) > dt * 0.8;
        anim = moved ? (input.run ? 'Run' : 'Walk') : 'Idle';
        lastSelf = { x: pos.x, z: pos.z };
      }
      const key = ONE_SHOT.has(anim) ? `${anim}@${e.animStart}` : anim;
      const elapsed = client.serverTime - e.animStart;
      if (v.char) {
        if (key !== v.animKey) {
          v.char.play(anim as AnimName, 0.12);
          v.animKey = key;
        }
        syncEquipment(v, isMe ? client.equipment : e.equipment, isMe);
        v.char.setXray(e.anim !== 'Death');
        v.char.update(dt);
        v.char.flash(v.flash > 0 ? 1 : 0);
      } else if (v.wolf) {
        v.wolf.setAnim(e.anim, e.animStart, elapsed);
        v.wolf.setXray(e.anim !== 'Death');
        v.wolf.update(dt);
        v.wolf.flash(v.flash > 0 ? 1 : 0);
        effects.telegraph(id, !!e.telegraph, pos.x, world.height(pos.x, pos.z), pos.z, Math.min(1, elapsed / WOLF.windup));
      }
      v.flash = Math.max(0, v.flash - dt);
    }

    // camera, light, canopy fade, hud
    const target = new THREE.Vector3(self.x, world.height(self.x, self.z) + 0.9, self.z);
    iso.target.lerp(target, 1 - Math.exp(-dt * 12));
    if (iso.target.distanceTo(target) > 6) iso.target.copy(target);
    lighting.follow(iso.target);
    const focus = [{ x: self.x, z: self.z }];
    for (const e of client.entities.values()) if (e.kind === 'wolf' && Math.hypot(e.x - self.x, e.z - self.z) < 10) focus.push({ x: e.x, z: e.z });
    worldView.billboards.setFocus(focus);
    worldView.update(dt, self.x, self.z);
    if (me) {
      hud.setHealth(appearance.name, me.hp, me.maxHp);
      hud.showDeath(dead, dead && client.serverTime - me.animStart > 3);
    }

    ctx.pipeline.render(scene, iso);
    effects.update(dt, innerWidth, innerHeight);
    raf = requestAnimationFrame(frame);
  };
  frame();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    input.dispose();
    hud.dispose();
    transport.close();
  };
}
