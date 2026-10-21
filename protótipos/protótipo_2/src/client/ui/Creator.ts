import * as THREE from 'three';
import {
  CLOTH_COLORS, EYE_COLORS, HAIR_STYLES, HAIR_STYLE_LABELS, HARPIN_COLORS, HUMAN_HAIR_COLORS, SKIN_TONES, bodyModel, defaultAppearance,
  defaultTunic, migrateAppearance, randomAppearance, validateAppearance, type Appearance, type Gender, type Race,
} from '@shared/appearance';
import { ATTACKS, WALK_SPEED } from '@shared/constants';
import { worldForSeed } from '@shared/world/worldCache';
import { CLEARING_WORLD, type WorldData } from '@shared/world/worldgen';
import { CharacterView } from '../character/CharacterView';
import { equip } from '../character/equipment';
import type { AppContext } from '../game/GameScene';
import { Lighting } from '../render/Lighting';
import { LOOK, SHARED } from '../render/look';
import { Sky } from '../render/Sky';
import { WorldView } from '../world/WorldView';
import { S } from './strings';

/** Prototype 1 lives on the same origin (GitHub Pages): its own key keeps the saves apart. */
const STORE_KEY = 'niryk.p2.character.v1';
/** The preview stands in the clearing of this seed (the slice's world: pond, old oak, woods). */
const PREVIEW_SEED = 1;

export function loadSavedCharacter(): Appearance | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const a = migrateAppearance(JSON.parse(raw) as Partial<Appearance>);
    return validateAppearance(a).length === 0 ? a : null;
  } catch {
    return null;
  }
}

export function saveCharacter(a: Appearance): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(a));
  } catch {
    /* private mode: the character just isn't remembered */
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type PreviewMode = 'idle' | 'walk' | 'attack';
/** One preview combo: Attack1, Attack2 chained, a breath, again. */
const COMBO_LOOP = ATTACKS.Attack1.duration + ATTACKS.Attack2.duration + 0.9;

/**
 * Character creator: race, gender, skin, hair style and color, plume color (Harpins), eyes, tunic
 * and name, with a live 3D preview of the character standing in a corner of the clearing (the
 * game's toon look), framed in the free part of the screen. Drag turns it, the wheel or a pinch
 * zooms toward the face; Parado / Andar / Atacar preview the clips. Resolves with its dispose.
 */
export async function runCreator(ctx: AppContext, onStart: (a: Appearance) => void): Promise<() => void> {
  const saved = loadSavedCharacter();
  let app: Appearance = saved ?? { ...defaultAppearance('human', 'm') };
  let plumeLinked = app.race !== 'harpin' || app.plumeColor === app.hairColor;
  let mode: PreviewMode = 'idle';
  /**
   * Until the player picks a tunic color it follows the race/gender default (or the last random
   * roll) and steps away from clashing Harpin plumes; a race or gender switch drops the roll.
   */
  let clothChosen = saved !== null;
  let clothRolled: string | null = null;
  const autoTunic = (a: Appearance): Appearance => (clothChosen ? a : { ...a, clothColor: defaultTunic(a, clothRolled ?? undefined) });

  const loading = h('div', 'loading', S.creator.loading);
  ctx.ui.append(loading);
  await new Promise((r) => setTimeout(r, 30)); // let the loading text paint

  // ---------------------------------------------------------------- 3D preview: a corner of the clearing
  const world = worldForSeed(PREVIEW_SEED, CLEARING_WORLD);
  const stand = { x: world.spawn.x, z: world.spawn.z };
  const standY = world.height(stand.x, stand.z);
  // the camera looks the way the spawn faces (pond and old oak behind the character)
  const dirX = Math.sin(world.spawn.yaw);
  const dirZ = Math.cos(world.spawn.yaw);
  // grass off the character's feet and out of the camera's way (the stage only: same world otherwise)
  const clear = (x: number, z: number) => {
    const dx = x - stand.x;
    const dz = z - stand.z;
    let k = smooth(1.0, 1.8, Math.hypot(dx, dz));
    const toward = -(dx * dirX + dz * dirZ);
    if (toward > 0 && toward < 9) k = Math.min(k, smooth(0.7, 1.6 + toward * 0.25, Math.abs(dx * dirZ - dz * dirX)));
    return k;
  };
  const stage: WorldData = { ...world, grass: (x, z) => world.grass(x, z) * clear(x, z), flowers: (x, z) => world.flowers(x, z) * clear(x, z) };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(LOOK.fog, LOOK.fogNear, LOOK.fogFar);
  const sky = new Sky();
  scene.add(sky.mesh);
  const lighting = new Lighting(scene, { mapSize: ctx.quality.shadowMapSize, radius: 10 });
  const feet = new THREE.Vector3(stand.x, standY, stand.z);
  lighting.follow(feet);
  const worldView = await WorldView.create(stage, ctx.quality.grass, ctx.quality.nature);
  scene.add(worldView.group);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);

  let view: CharacterView | null = null;
  let viewKey = '';
  /** Character's turn away from facing the camera (radians), and the zoom (1 full body .. 0.35 face). */
  let turn = -0.45;
  let zoom = 1;
  /** Time into the preview combo (s); negative: start a new one now. */
  let comboT = -1;
  let building = Promise.resolve();
  let disposed = false;
  let frames = 0;

  async function rebuildView(): Promise<void> {
    const key = bodyModel(app);
    if (key === viewKey && view) {
      view.applyAppearance(app);
      return;
    }
    viewKey = key;
    const v = await CharacterView.create(app);
    await equip(v, 'weapon', 'sword_iron');
    if (disposed) {
      v.dispose(); // the creator closed while the model loaded
      return;
    }
    view?.dispose();
    view = v;
    v.root.position.set(stand.x, standY, stand.z);
    scene.add(v.root);
    applyMode();
  }
  const refresh = () => {
    building = building.then(rebuildView).catch((err) => console.error(err));
  };

  // ---------------------------------------------------------------- UI
  const root = h('div', 'creator');
  const side = h('div', 'side panel interactive');
  const previewUi = h('div', 'preview-ui');
  root.append(side, previewUi);

  const title = h('h1');
  title.append(S.title, h('small', '', `${S.subtitle} · ${S.creator.heading}`));
  const nameField = h('div', 'field');
  const nameInput = h('input');
  nameInput.type = 'text';
  nameInput.maxLength = 16;
  nameInput.placeholder = S.creator.namePlaceholder;
  nameInput.value = app.name;
  nameInput.id = 'creator-name';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.oninput = () => {
    app = { ...app, name: nameInput.value };
    error.textContent = '';
  };
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') start.click();
  };
  const nameLabel = h('label', '', S.creator.name);
  nameLabel.htmlFor = nameInput.id;
  nameField.append(nameLabel, nameInput);
  const options = h('div', 'options');
  const error = h('div', 'error');
  error.setAttribute('role', 'alert');
  const actions = h('div', 'actions');
  const random = h('button', 'btn', S.creator.random);
  const start = h('button', 'btn primary', S.creator.start);
  actions.append(random, start);
  // only the option list scrolls: the title and the action buttons always stay in view
  const list = h('div', 'side-list');
  list.append(nameField, options);
  const foot = h('div', 'side-foot');
  foot.append(error, actions);
  side.append(title, list, foot);
  /** Fades the list's edges while there is more to scroll that way (phones hide scrollbars). */
  const syncScroll = () => {
    list.classList.toggle('more-above', list.scrollTop > 1);
    list.classList.toggle('more-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  list.addEventListener('scroll', syncScroll, { passive: true });
  const listResize = new ResizeObserver(syncScroll);
  listResize.observe(list);
  listResize.observe(options);

  function seg<T extends string>(label: string, values: readonly T[], current: T, text: (v: T) => string, on: (v: T) => void, key: string): HTMLElement {
    const f = h('div', 'field');
    f.append(h('div', 'lbl', label));
    const row = h('div', 'seg');
    row.dataset.field = key;
    for (const v of values) {
      const b = h('button', `btn${v === current ? ' selected' : ''}`, text(v));
      b.dataset.value = v;
      b.onclick = () => on(v);
      row.append(b);
    }
    f.append(row);
    return f;
  }

  function swatches(label: string, colors: string[], current: string, on: (c: string) => void, key: string, extra?: HTMLElement): HTMLElement {
    const f = h('div', 'field');
    f.append(h('div', 'lbl', label));
    const row = h('div', 'swatches');
    row.dataset.field = key;
    for (const c of colors) {
      const s = h('button', `swatch${c === current ? ' selected' : ''}`);
      s.style.setProperty('--swatch', c);
      s.dataset.value = c;
      s.setAttribute('aria-label', `${label} ${c}`);
      s.onclick = () => on(c);
      row.append(s);
    }
    f.append(row);
    if (extra) f.append(extra);
    return f;
  }

  function render(): void {
    const scroll = list.scrollTop;
    options.replaceChildren();
    options.append(
      seg<Race>(S.creator.race, ['human', 'harpin'], app.race, (r) => S.creator.races[r], (r) => {
        if (r === app.race) return;
        const d = defaultAppearance(r, app.gender);
        app = { ...d, name: app.name, gender: app.gender, skin: app.skin, eyeColor: app.eyeColor, clothColor: app.clothColor };
        plumeLinked = r !== 'harpin';
        clothRolled = null;
        update();
      }, 'race'),
      h('div', 'race-info', S.creator.raceInfo[app.race]),
      seg<Gender>(S.creator.gender, ['m', 'f'], app.gender, (g) => S.creator.genders[g], (g) => {
        if (g === app.gender) return;
        const d = defaultAppearance(app.race, g);
        // the hair style follows the gender's default only if it was still the other default
        const hairStyle = app.hairStyle === defaultAppearance(app.race, app.gender).hairStyle ? d.hairStyle : app.hairStyle;
        app = { ...app, gender: g, hairStyle };
        clothRolled = null;
        update();
      }, 'gender'),
      swatches(S.creator.skin, SKIN_TONES, app.skin, (c) => ((app = { ...app, skin: c }), update()), 'skin'),
      seg<string>(S.creator.hair, HAIR_STYLES[app.race], app.hairStyle, (s) => HAIR_STYLE_LABELS[s], (s) => {
        app = { ...app, hairStyle: s };
        update();
      }, 'hairStyle'),
    );
    const hairColors = app.race === 'harpin' ? Object.values(HARPIN_COLORS) : HUMAN_HAIR_COLORS;
    options.append(
      swatches(S.creator.hairColor, hairColors, app.hairColor, (c) => {
        app = { ...app, hairColor: c, plumeColor: plumeLinked && app.race === 'harpin' ? c : app.plumeColor };
        update();
      }, 'hairColor'),
    );
    if (app.race === 'harpin') {
      const link = h('button', `btn link${plumeLinked ? ' selected' : ''}`, S.creator.plumeSame);
      link.onclick = () => {
        plumeLinked = !plumeLinked;
        if (plumeLinked) app = { ...app, plumeColor: app.hairColor };
        update();
      };
      options.append(
        swatches(S.creator.plume, Object.values(HARPIN_COLORS), app.plumeColor, (c) => {
          plumeLinked = false;
          app = { ...app, plumeColor: c };
          update();
        }, 'plumeColor', link),
      );
    }
    options.append(
      swatches(S.creator.eyes, EYE_COLORS, app.eyeColor, (c) => ((app = { ...app, eyeColor: c }), update()), 'eyeColor'),
      swatches(S.creator.cloth, CLOTH_COLORS, app.clothColor, (c) => {
        clothChosen = true;
        app = { ...app, clothColor: c };
        update();
      }, 'clothColor'),
    );
    list.scrollTop = scroll;
  }

  function update(): void {
    app = autoTunic(app);
    render();
    refresh();
  }

  const modeButtons = new Map<PreviewMode, HTMLButtonElement>();
  for (const [m, label] of [
    ['idle', S.creator.preview.idle],
    ['walk', S.creator.preview.walk],
    ['attack', S.creator.preview.attack],
  ] as [PreviewMode, string][]) {
    const b = h('button', 'btn', label);
    b.dataset.mode = m;
    b.onclick = () => {
      mode = m;
      comboT = -1;
      applyMode();
    };
    modeButtons.set(m, b);
    previewUi.append(b);
  }
  previewUi.append(h('div', 'preview-hint', S.creator.previewHint));

  function applyMode(): void {
    for (const [m, b] of modeButtons) b.classList.toggle('selected', m === mode);
    view?.setVelocity(0, mode === 'walk' ? WALK_SPEED : 0);
    if (mode !== 'attack') view?.clearOneShot();
  }

  random.onclick = () => {
    const name = app.name.trim() || S.creator.names[Math.floor(Math.random() * S.creator.names.length)];
    nameInput.value = name;
    app = { ...randomAppearance(Math.random), name };
    clothChosen = false;
    clothRolled = app.clothColor;
    plumeLinked = app.plumeColor === app.hairColor;
    error.textContent = '';
    update();
  };
  start.onclick = () => {
    app = { ...app, name: nameInput.value.trim() };
    const errs = validateAppearance(app);
    if (errs.includes('name')) {
      error.textContent = S.creator.nameError;
      nameInput.focus();
      return;
    }
    if (errs.length) {
      error.textContent = errs.join(', ');
      return;
    }
    saveCharacter(app);
    onStart(app);
  };

  // ---------------------------------------------------------------- drag to turn, wheel / pinch to zoom
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const down = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) turn += (e.clientX - p.x) * 0.012;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom = THREE.MathUtils.clamp(zoom * (pinch / d), 0.35, 1);
      pinch = d;
    }
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.0012), 0.35, 1);
  };
  ctx.canvas.addEventListener('pointerdown', down);
  ctx.canvas.addEventListener('wheel', wheel, { passive: false });
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  update();
  await building;
  if (disposed) return () => {};
  ctx.ui.append(root);
  loading.remove();

  const resize = () => ctx.renderer.resize(innerWidth, innerHeight, devicePixelRatio);
  addEventListener('resize', resize);
  resize();

  /**
   * Frames the character in the part of the screen the panel leaves free (right of it on wide
   * screens, above the bottom sheet in portrait), through a view offset: the camera keeps looking
   * straight at the character, only the image is shifted.
   */
  const target = new THREE.Vector3();
  function placeCamera(): void {
    const W = innerWidth;
    const H = innerHeight;
    const r = side.getBoundingClientRect();
    const portrait = H > W;
    const x0 = portrait ? 0 : Math.min(W * 0.6, r.right);
    const y1 = (portrait ? Math.max(H * 0.25, r.top) : H) - previewUi.offsetHeight - 10;
    const fw = W - x0;
    const fh = Math.max(80, y1);
    const harpin = app.race === 'harpin';
    const subjectH = 1.95;
    const subjectW = harpin ? 1.5 : 0.95;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distH = ((subjectH * 1.12) / (2 * tanV)) * (H / fh);
    const distW = ((subjectW * 1.2) / (2 * tanV * (W / H))) * (W / fw);
    const face = (1 - zoom) / 0.65;
    const dist = Math.max(distH, distW, 2) * zoom;
    target.set(stand.x, standY + THREE.MathUtils.lerp(subjectH * 0.5, 1.5, face), stand.z);
    camera.position.set(target.x - dirX * dist, target.y + dist * 0.07, target.z - dirZ * dist);
    camera.lookAt(target);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - (x0 + W) / 2, H / 2 - y1 / 2, W, H);
    camera.updateProjectionMatrix();
  }

  (window as unknown as { __niryk: unknown }).__niryk = {
    scene: 'creator',
    get ready() {
      return !!view && frames > 1;
    },
    get info() {
      return { ...ctx.renderer.renderer.info.render };
    },
    get appearance() {
      return { ...app, name: nameInput.value };
    },
    get preview() {
      return { mode, model: viewKey, placeholder: view?.placeholder ?? null, oneShot: view?.oneShot ?? null };
    },
  };

  const clock = new THREE.Clock();
  let raf = 0;
  let now = 0;
  const frame = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    now += dt;
    SHARED.uTime.value = now;
    if (view) {
      view.root.rotation.y = world.spawn.yaw + Math.PI + turn;
      if (mode === 'attack') {
        const t0 = comboT;
        comboT = t0 < 0 ? 0 : (t0 + dt) % COMBO_LOOP;
        if (comboT < t0 || t0 < 0) view.playOneShot('Attack1');
        const t2 = ATTACKS.Attack1.duration - 0.02;
        if (t0 >= 0 && t0 < t2 && comboT >= t2) view.playOneShot('Attack2');
      }
      view.update(dt);
    }
    placeCamera();
    sky.update(camera);
    worldView.update(camera, feet);
    ctx.renderer.render(scene, camera);
    frames++;
    raf = requestAnimationFrame(frame);
  };
  frame();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    ctx.canvas.removeEventListener('pointerdown', down);
    ctx.canvas.removeEventListener('wheel', wheel);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    listResize.disconnect();
    root.remove();
    loading.remove();
    view?.dispose();
    view = null;
    worldView.dispose();
    sky.dispose();
    lighting.dispose();
  };
}
