import * as THREE from 'three';
import type { Appearance } from '@shared/appearance';
import { assistAim, type AssistTarget } from '@shared/combat';
import { WOLF } from '@shared/constants';
import type { EntityState, Equipment, GameEvent } from '@shared/protocol';
import { CollisionWorld } from '@shared/world/collision';
import { worldForSeed } from '@shared/world/worldCache';
import { ShoulderCamera, type ViewMode } from '../camera/ShoulderCamera';
import { CharacterView, type OneShot } from '../character/CharacterView';
import { equip, equippedParts } from '../character/equipment';
import { WolfView } from '../character/WolfView';
import { Input } from '../input/Input';
import type { Transport } from '../net/Transport';
import { Lighting } from '../render/Lighting';
import { LOOK, SHARED } from '../render/look';
import type { Quality } from '../render/quality';
import type { Renderer } from '../render/Renderer';
import { Sky } from '../render/Sky';
import { Hud } from '../ui/Hud';
import { S } from '../ui/strings';
import { WorldView } from '../world/WorldView';
import { Effects } from './Effects';
import { GameClient, type Intent } from './GameClient';

export interface AppContext {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  renderer: Renderer;
  /** Touch device: touch controls. */
  touch: boolean;
  quality: Quality;
}

/**
 * Opens a fresh connection to a server (local or remote). A factory, because a closed transport
 * cannot be reused and every entry into the world needs its own.
 */
export type TransportFactory = () => Transport;

interface View {
  id: number;
  /** Players: their character; wolves: their wolf. */
  char: CharacterView | null;
  wolf: WolfView | null;
  root: THREE.Object3D;
  /** Server start time of the last one-shot started from the entity state (remote players, Hit, Death). */
  animStart: number;
  anim: string;
  /** Weapon and armor last attached (undefined: not synced yet). */
  weapon: string | null | undefined;
  armor: string | null | undefined;
  flash: number;
  /** Last rendered position (velocity for the locomotion blend). */
  last: THREE.Vector2;
  vel: THREE.Vector2;
  placed: boolean;
}

/** Entities beyond this distance from the player are not drawn (skinned meshes skip frustum culling). */
const VIEW_RADIUS = 60;
const ONE_SHOT = new Set<string>(['Attack1', 'Attack2', 'Hit', 'Death']);
/** How long a hit flash lasts (s); it fades out over that time. */
const FLASH_TIME = 0.16;

// per-frame scratch (the frame loop allocates nothing)
const _feet = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _look = { x: 0, y: 0 };
/** Living wolves as last drawn (the aim assist snaps to what the player sees). */
const _targets: AssistTarget[] = [];

/**
 * The game: server connection, world, the characters, the shoulder camera, input and HUD.
 * Resolves with a dispose function. If entering the world fails it shows an error and resolves
 * with the function that removes it.
 */
export async function runGame(ctx: AppContext, appearance: Appearance, makeTransport: TransportFactory, onNewCharacter: () => void): Promise<() => void> {
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

  const touch = ctx.touch;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(LOOK.fog, LOOK.fogNear, LOOK.fogFar);
  const sky = new Sky();
  scene.add(sky.mesh);
  teardown.push(() => sky.dispose());
  const q = ctx.quality;
  const lighting = new Lighting(scene, { mapSize: q.shadowMapSize, radius: q.shadowRadius });
  teardown.push(() => lighting.dispose());
  const worldView = await WorldView.create(world, q.grass, q.nature);
  teardown.push(() => worldView.dispose());
  scene.add(worldView.group);

  const cam = new ShoulderCamera(world);
  const spawn = world.spawn;
  cam.setLook(spawn.yaw, -0.14);

  // nothing below awaits: from here on the HUD's callbacks and the frame loop own the scene
  const views = new Map<number, View>();
  const pending = new Set<number>();
  let disposed = false;
  let now = 0;

  // eslint-disable-next-line prefer-const
  let input: Input;
  const hud = new Hud(
    ctx.ui,
    {
      onAttack: () => input.pressAttack(),
      onToggleView: () => cam.toggleMode(),
      onRespawn: () => client.send({ t: 'respawn' }),
      onNewCharacter,
      onEquip: (slot, item) => client.send({ t: 'equip', slot, item }),
      // a panel needs the mouse: release it (a click on the game captures it again)
      onPanel: (open) => {
        if (open) input.releaseLock();
      },
    },
    touch,
  );
  teardown.push(() => hud.dispose());
  input = new Input(ctx.canvas, hud.joystick, { ignore: () => hud.buttons });
  input.touchMode = touch;
  input.onKey = (k) => {
    if (k === 'v') cam.toggleMode();
    if (k === 'i') hud.toggleEquipment();
    if (k === 'escape' && !input.locked) hud.toggleMenu();
  };
  input.onLockChange = () => hud.setLockPrompt(!touch && !input.locked && !input.lockUnavailable);
  hud.setLockPrompt(!touch);
  teardown.push(() => input.dispose());
  client.onError = (m) => console.error(m);
  client.onInventory = () => hud.setInventory(client.equipment, client.items);
  hud.setInventory(client.equipment, client.items); // the inventory came with the welcome, before this hook

  async function createView(e: EntityState): Promise<void> {
    const id = e.id;
    pending.add(id);
    let char: CharacterView | null = null;
    let wolf: WolfView | null = null;
    try {
      if (e.kind === 'wolf') wolf = await WolfView.create();
      else if (e.appearance) char = await CharacterView.create(e.appearance);
      else throw new Error(`player ${id} came without its appearance`);
    } catch (err) {
      console.error(err); // stays pending: not retried every frame
      return;
    }
    pending.delete(id);
    const root = char?.root ?? wolf!.root;
    // the game may have closed, or the entity left our area, while its model loaded
    if (disposed || !client.entities.has(id)) {
      (char ?? wolf!).dispose();
      return;
    }
    scene.add(root);
    views.set(id, {
      id, char, wolf, root, anim: '', animStart: NaN, weapon: undefined, armor: undefined, flash: 0, last: new THREE.Vector2(), vel: new THREE.Vector2(),
      placed: false,
    });
  }

  function removeView(v: View): void {
    views.delete(v.id);
    (v.char ?? v.wolf!).dispose();
  }

  teardown.push(() => {
    disposed = true; // async view creations still in flight dispose their result
    for (const v of views.values()) removeView(v);
  });

  function syncEquipment(v: View, eq: Equipment | undefined): void {
    if (!eq || !v.char) return;
    if (eq.weapon !== v.weapon) void equip(v.char, 'weapon', (v.weapon = eq.weapon));
    if (eq.armor !== v.armor) void equip(v.char, 'armor', (v.armor = eq.armor));
  }

  const effects = new Effects(hud.fx, world);
  scene.add(effects.group);
  teardown.push(() => effects.dispose());
  /** Wolves this player killed, and the last events (tests and debugging). */
  let kills = 0;
  const recent: GameEvent[] = [];

  function onEvent(e: GameEvent): void {
    recent.push(e);
    if (recent.length > 24) recent.shift();
    if (e.e === 'damage') {
      const target = client.entities.get(e.target);
      const v = views.get(e.target);
      if (v) v.flash = FLASH_TIME;
      const mine = e.target === client.myId;
      effects.damageNumber(e.x, world.height(e.x, e.z), e.z, e.amount, target?.kind === 'wolf' ? 'enemy' : 'player', e.crit);
      if (mine) {
        hud.hurt();
        cam.shake(0.9);
      } else if (e.source === client.myId) {
        cam.shake(e.crit ? 0.45 : 0.3); // the blow lands
      }
    } else if (e.e === 'death') {
      if (client.entities.get(e.id)?.kind === 'wolf') kills++;
    }
  }
  client.onEvent = onEvent;

  const resize = () => {
    ctx.renderer.resize(innerWidth, innerHeight, devicePixelRatio);
    cam.resize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  teardown.push(() => removeEventListener('resize', resize));
  resize();
  loading.remove();

  // test hooks: `ready` and `info` always (tools/dev/check-csp.mjs waits for them on the production
  // single-file build); the rest only on the dev server (tools/e2e.mjs, tools/shoot.mjs) or with
  // ?debug. Getters, so nothing is allocated per frame.
  const hooks = {
    scene: 'game',
    get ready() {
      return views.has(client.myId) && views.get(client.myId)!.placed;
    },
    get info() {
      return { ...ctx.renderer.renderer.info.render };
    },
  };
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    const debug = {
      get me() {
        const me = client.me;
        const p = client.predicted;
        return me && { x: p.x, z: p.z, yaw: p.yaw, hp: me.hp, anim: me.anim, swing: p.swing?.name ?? null, swingT: p.swing?.t ?? 0 };
      },
      get time() {
        return client.serverTime;
      },
      get view() {
        return { mode: cam.mode, fp: cam.fp, yaw: cam.yaw, pitch: cam.pitch, fov: cam.camera.fov, locked: input.locked };
      },
      get camera() {
        const p = cam.camera.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      get oneShot() {
        return views.get(client.myId)?.char?.oneShot ?? null;
      },
      get clips() {
        return views.get(client.myId)?.char?.clipWeights() ?? null;
      },
      /** Every wolf of the world (server side), with the ones near us that the client knows. */
      get wolves() {
        return transport.debug?.wolves() ?? [];
      },
      get nearWolves() {
        const out: { id: number; x: number; z: number; hp: number; anim: string; telegraph: boolean; drawn: boolean }[] = [];
        for (const e of client.entities.values()) {
          if (e.kind === 'wolf') out.push({ id: e.id, x: e.x, z: e.z, hp: e.hp, anim: e.anim, telegraph: !!e.telegraph, drawn: views.has(e.id) });
        }
        return out;
      },
      get kills() {
        return kills;
      },
      get events() {
        return recent.slice();
      },
      get dead() {
        const me = client.me;
        return !me || me.hp <= 0 || me.anim === 'Death';
      },
      get equipment() {
        const mine = views.get(client.myId)?.char;
        return { ...client.equipment, items: [...client.items], armorParts: mine ? equippedParts(mine, 'armor') : [], weaponParts: mine ? equippedParts(mine, 'weapon') : [] };
      },
      get panel() {
        return hud.panelKind;
      },
      get world() {
        return { seed: world.seed, spawn: world.spawn, quality: q.name, nature: world.nature.length, drawnNature: worldView.nature.drawn, drawnGrass: worldView.grass.drawn, structures: worldView.structures.sources, dens: world.dens };
      },
      threeScene: scene,
      teleport: (x: number, z: number) => transport.debug?.teleport(x, z),
      setLook: (yaw: number, pitch: number) => cam.setLook(yaw, pitch),
      /** Turns the camera toward a world point (yaw only; pitch kept). */
      lookAt: (x: number, z: number) => {
        const p = client.renderedSelf();
        cam.setLook(Math.atan2(x - p.x, z - p.z), cam.pitch);
      },
      respawn: () => client.send({ t: 'respawn' }),
      kill: () => transport.debug?.kill(),
      get appearance() {
        return { ...appearance };
      },
      /** Stops the clock (server and animations) while the page keeps drawing: steady screenshots. */
      freeze: (on: boolean) => {
        frozen = on;
      },
      setView: (mode: ViewMode) => cam.setMode(mode, true),
      attack: () => input.pressAttack(),
    };
    Object.defineProperties(hooks, Object.getOwnPropertyDescriptors(debug));
  }
  (window as unknown as { __niryk: unknown }).__niryk = hooks;

  const clock = new THREE.Clock();
  const intent: Intent = { mx: 0, mz: 0, run: false, attack: false, aim: null };
  /** The local swing last started (name and local start time), so each one plays once. */
  const lastSwing = { name: '', start: -99 };
  let wasDead = false;
  let frozen = false;
  let raf = 0;
  const frame = () => {
    if (disposed) return;
    const delta = Math.min(clock.getDelta(), 0.1);
    const dt = frozen ? 0 : delta;
    now += dt;
    SHARED.uTime.value = now;
    input.update();
    const me = client.me;
    const dead = !me || me.hp <= 0 || me.anim === 'Death';
    const blocked = hud.panelOpen || dead;

    // look, then move relative to where the camera looks; the body faces the camera's yaw
    input.consumeLook(_look);
    if (!hud.panelOpen) cam.look(_look.x, _look.y);
    const f = blocked ? 0 : input.move.y;
    const r = blocked ? 0 : input.move.x;
    const sy = Math.sin(cam.yaw);
    const cy = Math.cos(cam.yaw);
    const atk = input.consumeAttack();
    intent.mx = sy * f - cy * r;
    intent.mz = cy * f + sy * r;
    intent.run = input.run;
    intent.attack = !blocked && atk;
    intent.aim = dead ? null : cam.yaw;
    if (intent.attack) {
      // the swing goes toward the crosshair, pulled onto a wolf close to it
      const at = client.renderedSelf();
      intent.aim = assistAim(cam.yaw, at.x, at.z, _targets);
    }
    client.update(dt, intent);
    if (f || r || intent.attack) hud.hideHint();
    if (intent.attack) hud.fire(now);
    const self = client.renderedSelf(); // after the update: this frame's prediction

    for (const e of client.entities.values()) if (!views.has(e.id) && !pending.has(e.id)) void createView(e);
    effects.beginFrame();
    let nTargets = 0;
    for (const v of views.values()) {
      const e = client.entities.get(v.id);
      if (!e) {
        removeView(v); // left our area, died out or respawned with a new id
        continue;
      }
      const isMe = v.id === client.myId;
      const pos = isMe ? self : (client.interpolated(v.id) ?? e);
      const gy = world.height(pos.x, pos.z);
      const obj = v.root;
      obj.visible = isMe || Math.hypot(pos.x - self.x, pos.z - self.z) < VIEW_RADIUS;
      obj.position.set(pos.x, gy, pos.z);
      obj.rotation.y = pos.yaw;

      // locomotion: the velocity in the character's own frame (x to its left, z forward)
      if (v.placed && dt > 0) {
        const vx = (pos.x - v.last.x) / dt;
        const vz = (pos.z - v.last.y) / dt;
        const s = Math.sin(pos.yaw);
        const c = Math.cos(pos.yaw);
        const k = 1 - Math.exp(-dt * 12);
        const jump = Math.hypot(vx, vz) > 12; // teleport or respawn
        v.vel.x += ((jump ? 0 : vx * c - vz * s) - v.vel.x) * k;
        v.vel.y += ((jump ? 0 : vx * s + vz * c) - v.vel.y) * k;
      }
      v.last.set(pos.x, pos.z);
      v.placed = true;

      if (v.wolf) {
        // one-shots run on the smooth render clock, not the 20 Hz snapshot time
        const elapsed = Math.max(0, client.renderTime - e.animStart);
        v.wolf.setAnim(e.anim, e.animStart, elapsed);
        v.wolf.setSpeed(v.vel.length());
        v.wolf.update(dt);
        v.wolf.flash(v.flash / FLASH_TIME);
        v.flash = Math.max(0, v.flash - dt);
        if (obj.visible) {
          if (e.telegraph) effects.telegraph(v.id, pos.x, gy, pos.z, pos.yaw, elapsed / WOLF.windup);
          effects.wolfBar(pos.x, gy, pos.z, e.hp, e.maxHp);
        }
        if (e.hp > 0) {
          const t = (_targets[nTargets++] ??= { x: 0, z: 0, hp: 0 });
          t.x = pos.x;
          t.z = pos.z;
          t.hp = e.hp;
        }
        continue;
      }
      const char = v.char!;
      char.setVelocity(v.vel.x, v.vel.y);

      // one-shots: the local swing from the prediction (no round trip), the rest from the server
      if (isMe) {
        const sw = client.predicted.swing;
        if (sw) {
          const start = now - sw.t;
          if (sw.name !== lastSwing.name || Math.abs(start - lastSwing.start) > 0.3) {
            char.playOneShot(sw.name);
            lastSwing.name = sw.name;
            lastSwing.start = start;
          }
        }
      }
      const remoteSwing = !isMe && (e.anim === 'Attack1' || e.anim === 'Attack2');
      if ((remoteSwing || e.anim === 'Hit' || e.anim === 'Death') && (e.anim !== v.anim || e.animStart !== v.animStart)) {
        char.playOneShot(e.anim as OneShot);
      } else if (!ONE_SHOT.has(e.anim) && v.anim === 'Death') {
        char.clearOneShot(); // respawned
      }
      v.anim = e.anim;
      v.animStart = e.animStart;
      syncEquipment(v, isMe ? client.equipment : e.equipment);
      if (isMe) char.setFirstPerson(cam.fp > 0.55);
      char.update(dt);
      char.flash(v.flash / FLASH_TIME);
      v.flash = Math.max(0, v.flash - dt);
    }
    _targets.length = nTargets;

    // camera, sun, world around the player, hud
    const mine = views.get(client.myId)?.char;
    _feet.set(self.x, world.height(self.x, self.z), self.z);
    cam.update(dt, _feet, mine ? mine.eyeWorld(_eye) : null);
    lighting.follow(_feet);
    sky.update(cam.camera);
    worldView.update(cam.camera, _feet);
    if (me) {
      hud.setHealth(appearance.name, me.hp, me.maxHp);
      hud.showDeath(dead, dead && client.serverTime - me.animStart > 3);
      // back on our feet at the plaza: face into it again
      if (wasDead && !dead) cam.setLook(world.spawn.yaw, -0.14);
      wasDead = dead;
    }
    hud.update(now, cam.mode === '1p', dead);

    ctx.renderer.render(scene, cam.camera);
    effects.update(dt, cam.camera, innerWidth, innerHeight);
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
  const back2 = document.createElement('button');
  back2.className = 'btn primary';
  back2.textContent = S.hud.backToCreator;
  back2.onclick = onBack;
  const button = document.createElement('button');
  button.className = 'btn';
  button.textContent = S.hud.reload;
  button.onclick = () => location.reload();
  const list = document.createElement('div');
  list.className = 'menu-list';
  list.append(back2, button);
  panel.append(title, list);
  back.append(panel);
  ui.append(back);
  return () => back.remove();
}
