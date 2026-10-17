import * as THREE from 'three';
import type { Appearance } from '@shared/appearance';
import { WOLF } from '@shared/constants';
import type { EntityState, Equipment, GameEvent } from '@shared/protocol';
import { CollisionWorld } from '@shared/world/collision';
import { worldForSeed } from '@shared/world/worldCache';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { Input } from '../input/Input';
import type { Transport } from '../net/Transport';
import { CAMERA_PITCH_DEG, IsoCamera } from '../render/IsoCamera';
import { Lighting } from '../render/Lighting';
import type { PixelPipeline } from '../render/PixelPipeline';
import { Hud } from '../ui/Hud';
import { S } from '../ui/strings';
import { WorldView } from '../world/WorldView';
import { Effects } from './Effects';
import { GameClient, type Intent } from './GameClient';
import { Markers } from './Markers';
import { WolfView } from './WolfView';

export interface AppContext {
  canvas: HTMLCanvasElement;
  pipeline: PixelPipeline;
  ui: HTMLElement;
}

/**
 * Opens a fresh connection to a server (local or remote). A factory, because a closed transport
 * cannot be reused and every entry into the world needs its own.
 */
export type TransportFactory = () => Transport;

interface View {
  id: number;
  char?: CharacterView;
  wolf?: WolfView;
  /** Clip playing (players) and the server start time of the one-shot it was started for. */
  anim: string;
  animStart: number;
  /** Equipment last attached (undefined: not synced yet). */
  weapon: string | null | undefined;
  armor: string | null | undefined;
  flash: number;
}

interface Point {
  x: number;
  z: number;
}

const SIN_PITCH = Math.sin(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));
/** Entities beyond this distance from the player are not drawn (the widest view is ~24 m across). */
const VIEW_RADIUS = 26;
const ONE_SHOT = new Set(['Attack1', 'Attack2', 'Attack', 'Hit', 'Death']);

// per-frame scratch (the frame loop allocates nothing)
const _ground = new THREE.Vector2();
const _target = new THREE.Vector3();
const _v = new THREE.Vector3();
const _css = new THREE.Vector2();

/**
 * The game: world + server connection + entities + camera + HUD. Resolves with a dispose function.
 * If entering the world fails (no welcome or first snapshot, a load error) it shows an error with
 * a way back to the creator and resolves with the function that removes that error.
 */
export async function runGame(
  ctx: AppContext,
  appearance: Appearance,
  makeTransport: TransportFactory,
  onNewCharacter: () => void,
): Promise<() => void> {
  // cleanups of everything built so far, run in reverse: on dispose, or when entering fails halfway
  const teardown: (() => void)[] = [];
  const dispose = () => {
    while (teardown.length) teardown.pop()!();
  };
  try {
    await enterWorld(ctx, appearance, makeTransport, onNewCharacter, teardown);
    return dispose;
  } catch (err) {
    console.error(err);
    dispose();
    return showEntryError(ctx.ui, onNewCharacter);
  }
}

async function enterWorld(
  ctx: AppContext,
  appearance: Appearance,
  makeTransport: TransportFactory,
  onNewCharacter: () => void,
  teardown: (() => void)[],
): Promise<void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = S.hud.loading;
  ctx.ui.append(loading);
  teardown.push(() => loading.remove());
  await new Promise((r) => setTimeout(r, 30)); // let the loading text paint

  // connect: the world comes from the seed in the welcome
  const transport = makeTransport();
  teardown.push(() => transport.close());
  const client = new GameClient(transport);
  const welcome = await client.join(appearance);
  const world = worldForSeed(welcome.seed);
  client.setCollision(new CollisionWorld(world.colliders, world.half));
  await client.waitForSelf();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  const lighting = new Lighting(scene, 24);
  const worldView = await WorldView.create(world);
  scene.add(worldView.group);

  // nothing below awaits: from here on the HUD's callbacks and the frame loop own the scene
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
  teardown.push(() => hud.dispose());
  const effects = new Effects(hud.fx, ctx.pipeline, iso); // damage numbers live in the HUD layer
  scene.add(effects.group);
  teardown.push(() => effects.dispose());
  const markers = new Markers(ctx.pipeline, iso);
  scene.add(markers.group);
  teardown.push(() => markers.dispose());
  input = new Input(ctx.canvas, hud.joystick);
  input.touchMode = touch;
  input.onKey = (k) => {
    if (k === 'i') hud.toggleEquipment();
    if (k === 'escape') (hud.panelOpen ? hud.closeModal() : hud.toggleMenu());
  };
  teardown.push(() => input.dispose());

  client.onInventory = () => {
    hud.setInventory(client.equipment, client.items);
  };
  client.onError = (m) => console.error(m);
  client.onEvent = (e) => onEvent(e);
  hud.setInventory(client.equipment, client.items); // the inventory came with the welcome, before these hooks

  async function createView(e: EntityState): Promise<void> {
    const id = e.id;
    pending.add(id);
    let v: View;
    try {
      v = { id, anim: '', animStart: NaN, weapon: undefined, armor: undefined, flash: 0 };
      if (e.kind === 'wolf') v.wolf = await WolfView.create();
      else v.char = await CharacterView.create(e.appearance!, { xray: id === client.myId ? 'player' : undefined });
    } catch (err) {
      console.error(err); // stays pending: not retried every frame
      return;
    }
    pending.delete(id);
    // the game may have closed, or the entity left our area, while its model loaded
    if (disposed || !client.entities.has(id)) {
      (v.char ?? v.wolf!).dispose();
      return;
    }
    scene.add(v.char?.root ?? v.wolf!.root);
    views.set(id, v);
  }

  function removeView(v: View): void {
    views.delete(v.id);
    if (v.wolf) effects.telegraph(v.id, false, 0, 0, 0, 0); // frees its warning ring right away
    (v.char ?? v.wolf!).dispose();
  }

  teardown.push(() => {
    disposed = true; // async view creations still in flight dispose their result
    for (const v of views.values()) removeView(v);
  });

  function syncEquipment(v: View, eq: Equipment | undefined, isMe: boolean): void {
    if (!v.char || !eq) return;
    if (eq.weapon !== v.weapon) void equip(v.char, 'weapon', (v.weapon = eq.weapon), isMe);
    if (eq.armor !== v.armor) void equip(v.char, 'armor', (v.armor = eq.armor), isMe);
  }

  function onEvent(e: GameEvent): void {
    if (e.e === 'damage') {
      const target = client.entities.get(e.target);
      // damageNumber copies the position: a scratch vector will do
      effects.damageNumber(_v.set(e.x, world.height(e.x, e.z), e.z), e.amount, target?.kind === 'player' ? 'player' : 'enemy', e.crit);
      const v = views.get(e.target);
      if (v) v.flash = 0.14;
    } else if (e.e === 'swing') {
      const ent = client.entities.get(e.id);
      if (!ent) return;
      const isMe = e.id === client.myId;
      setTimeout(() => {
        if (disposed) return;
        const s = isMe ? client.renderedSelf() : ent;
        effects.slash(s.x, world.height(s.x, s.z), s.z, ent.yaw, e.anim === 'Attack2');
      }, (e.anim === 'Attack2' ? 0.22 : 0.17) * 1000);
    }
  }

  function aimFromScreen(at: { x: number; y: number } | null, self: Point): number | null {
    if (at) {
      const p = ctx.pipeline.worldToCss(_v.set(self.x, world.height(self.x, self.z) + 0.9, self.z), iso, innerWidth, innerHeight, _css);
      const dx = at.x - p.x;
      const dy = at.y - p.y;
      // screen delta -> ground: screen-up is foreshortened by sin(pitch)
      const g = iso.screenToGround(dx, dy / SIN_PITCH, _ground);
      return Math.atan2(g.x, g.y);
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
  teardown.push(() => removeEventListener('resize', resize));
  resize();
  loading.remove();

  // test hooks: `ready` and `info` always (tools/dev/check-*.mjs wait for them on the production
  // single-file build); the rest only on the dev server (tools/e2e.mjs, tools/shoot.mjs) or with
  // ?debug. Getters, so nothing is allocated per frame.
  const hooks = {
    get ready() {
      return views.has(client.myId);
    },
    get info() {
      return { ...ctx.pipeline.renderer.info.render };
    },
  };
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    const debug = {
      get me() {
        const me = client.me;
        return me && { x: me.x, z: me.z, hp: me.hp, anim: me.anim };
      },
      get wolves() {
        return transport.debug?.wolves() ?? [];
      },
      get equipment() {
        return client.equipment;
      },
      get time() {
        return client.serverTime;
      },
      threeScene: scene,
      teleport: (x: number, z: number) => transport.debug?.teleport(x, z),
    };
    Object.defineProperties(hooks, Object.getOwnPropertyDescriptors(debug));
  }
  (window as unknown as { __niryk: unknown }).__niryk = hooks;

  const clock = new THREE.Clock();
  const intent: Intent = { mx: 0, mz: 0, run: false, attack: false, aim: null };
  const lastSelf: Point = { x: 0, z: 0 };
  // camera-fade focus points: the array and its points are reused (setFocus does not keep them)
  const focus: Point[] = [];
  const focusPool: Point[] = [];
  const setFocusPoint = (i: number, x: number, z: number) => {
    const p = (focusPool[i] ??= { x: 0, z: 0 });
    p.x = x;
    p.z = z;
    focus[i] = p;
  };
  let raf = 0;
  const frame = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    input.update();
    const me = client.me;
    const dead = !me || me.hp <= 0 || me.anim === 'Death';
    const blocked = hud.panelOpen || dead;
    const g = iso.screenToGround(input.move.x, input.move.y, _ground);
    const atk = input.consumeAttack();
    intent.mx = blocked ? 0 : g.x;
    intent.mz = blocked ? 0 : g.y;
    intent.run = input.run;
    intent.attack = !blocked && atk.pressed;
    intent.aim = atk.pressed ? aimFromScreen(atk.at, client.renderedSelf()) : null;
    client.update(dt, intent);
    if (intent.mx || intent.mz) hud.hideHint();
    const self = client.renderedSelf(); // after the update: this frame's prediction
    const selfY = world.height(self.x, self.z);

    // entities and their markers (all set before the render: the overlay pass needs them)
    markers.beginFrame();
    for (const e of client.entities.values()) if (!views.has(e.id) && !pending.has(e.id)) void createView(e);
    for (const v of views.values()) {
      const e = client.entities.get(v.id);
      if (!e) {
        removeView(v); // left our area, died out or respawned with a new id
        continue;
      }
      const isMe = v.id === client.myId;
      const pos = isMe ? self : (client.interpolated(v.id) ?? e);
      const obj = v.char?.root ?? v.wolf!.root;
      const gy = isMe ? selfY : world.height(pos.x, pos.z);
      // skinned meshes skip frustum culling (animated bounds): cull far entities by distance instead
      obj.visible = isMe || Math.hypot(pos.x - self.x, pos.z - self.z) < VIEW_RADIUS;
      obj.position.set(pos.x, gy, pos.z);
      obj.rotation.y = pos.yaw;
      // one-shot clips run on the smooth render clock, not the 20 Hz snapshot time
      const elapsed = Math.max(0, client.renderTime - e.animStart);
      if (v.char) {
        let anim: string = e.anim;
        if (isMe && !ONE_SHOT.has(e.anim)) {
          const moved = Math.hypot(pos.x - lastSelf.x, pos.z - lastSelf.z) > dt * 0.8;
          anim = moved ? (input.run ? 'Run' : 'Walk') : 'Idle';
          lastSelf.x = pos.x;
          lastSelf.z = pos.z;
        }
        if (anim !== v.anim || (ONE_SHOT.has(anim) && e.animStart !== v.animStart)) {
          v.char.play(anim as AnimName, 0.12);
          v.anim = anim;
          v.animStart = e.animStart;
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
        // every wolf, every frame: a ring not set again disappears at the next effects.update
        effects.telegraph(v.id, obj.visible && !!e.telegraph, pos.x, gy, pos.z, Math.min(1, elapsed / WOLF.windup));
        if (obj.visible) markers.wolfBar(pos.x, gy, pos.z, e.hp, e.maxHp);
      }
      v.flash = Math.max(0, v.flash - dt);
    }
    if (!dead) markers.playerRing(self.x, selfY, self.z);

    // camera, light, canopy fade, hud
    const target = _target.set(self.x, selfY + 0.9, self.z);
    iso.target.lerp(target, 1 - Math.exp(-dt * 12));
    if (iso.target.distanceTo(target) > 6) iso.target.copy(target);
    lighting.follow(iso.target);
    let n = 0;
    setFocusPoint(n++, self.x, self.z);
    for (const e of client.entities.values()) {
      if (e.kind === 'wolf' && Math.hypot(e.x - self.x, e.z - self.z) < 10) setFocusPoint(n++, e.x, e.z);
    }
    focus.length = n;
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
  teardown.push(() => {
    disposed = true;
    cancelAnimationFrame(raf);
  });
  frame();
}

/** Shown when entering the world failed; returns the function that removes it. */
function showEntryError(ui: HTMLElement, onBack: () => void): () => void {
  const back = document.createElement('div');
  back.className = 'loading';
  const panel = document.createElement('div');
  panel.className = 'panel modal death';
  const title = document.createElement('h2');
  title.textContent = S.hud.connectionError;
  const button = document.createElement('button');
  button.className = 'btn primary';
  button.textContent = S.hud.backToCreator;
  button.onclick = onBack;
  panel.append(title, button);
  back.append(panel);
  ui.append(back);
  return () => back.remove();
}
