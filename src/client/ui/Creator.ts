import * as THREE from 'three';
import {
  CLOTH_COLORS, EYE_COLORS, HAIR_STYLES, HAIR_STYLE_LABELS, HARPIN_COLORS, HUMAN_HAIR_COLORS, SKIN_TONES, defaultAppearance,
  migrateAppearance, randomAppearance, tunicFor, validateAppearance, type Appearance, type Gender, type Race,
} from '@shared/appearance';
import { CharacterView, type AnimName } from '../character/CharacterView';
import { equip } from '../character/equipment';
import { loadTexture } from '../core/assets';
import { IsoCamera } from '../render/IsoCamera';
import { Lighting } from '../render/Lighting';
import type { AppContext } from '../game/GameScene';
import { createGround } from '../world/Ground';
import { S } from './strings';

const STORE_KEY = 'niryk.character.v1';

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

function saveCharacter(a: Appearance): void {
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

/**
 * Character creator: race, gender, skin, hair style and color, plume color (Harpins), eyes and
 * name, with a live 3D preview through the game's pixel pipeline (drag to turn it).
 */
export async function runCreator(ctx: AppContext, onStart: (a: Appearance) => void): Promise<() => void> {
  const saved = loadSavedCharacter();
  let app: Appearance = saved ?? { ...defaultAppearance('human', 'm') };
  let plumeLinked = app.race !== 'harpin' || app.plumeColor === app.hairColor;
  let previewAnim: AnimName = 'Idle';
  /** Until the player picks a tunic color, it steps away from green plumes/hair automatically. */
  let clothChosen = saved !== null;
  const autoTunic = (a: Appearance): Appearance =>
    clothChosen ? a : { ...a, clothColor: tunicFor(a.race === 'harpin' ? [a.hairColor, a.plumeColor] : [a.hairColor], defaultAppearance(a.race, a.gender).clothColor) };

  // ---------------------------------------------------------------- 3D preview
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1424');
  const iso = new IsoCamera();
  iso.zoom = 3;
  const lighting = new Lighting(scene, 6);
  const tex = await Promise.all(['ground_grass_a', 'ground_grass_b', 'ground_dirt', 'ground_cobble', 'noise'].map((n) => loadTexture(`sprites/${n}.png`)));
  const ground = createGround(
    { grassA: tex[0], grassB: tex[1], dirt: tex[2], cobble: tex[3], noise: tex[4] },
    { size: 12, step: 1, height: () => 0, splat: (x, z) => [0, 0, Math.hypot(x, z) < 1.6 ? 1 : 0, 0] },
  );
  scene.add(ground);
  let view: CharacterView | null = null;
  let viewKey = '';
  let yaw = 0.35;
  let building = Promise.resolve();

  async function rebuildView(): Promise<void> {
    const key = `${app.race}_${app.gender}`;
    if (key === viewKey && view) {
      view.applyAppearance(app);
      return;
    }
    viewKey = key;
    const v = await CharacterView.create(app, { xray: 'player' });
    await equip(v, 'weapon', 'sword_iron');
    if (view) scene.remove(view.root);
    view = v;
    scene.add(v.root);
    v.play(previewAnim, 0);
  }
  const refresh = () => {
    building = building.then(rebuildView);
  };

  // ---------------------------------------------------------------- UI
  const root = h('div', 'creator');
  const side = h('div', 'side panel interactive');
  root.append(side);
  const previewUi = h('div', 'preview-ui');
  root.append(previewUi);
  ctx.ui.append(root);

  const title = h('h1');
  title.innerHTML = `${S.title}<small>${S.subtitle} · ${S.creator.heading}</small>`;
  const nameField = h('div', 'field');
  const nameInput = h('input');
  nameInput.type = 'text';
  nameInput.maxLength = 16;
  nameInput.placeholder = S.creator.namePlaceholder;
  nameInput.value = app.name;
  nameInput.oninput = () => (app = { ...app, name: nameInput.value });
  nameField.append(h('label', '', S.creator.name), nameInput);
  const options = h('div');
  const error = h('div', 'error');
  const actions = h('div', 'actions');
  const random = h('button', 'btn', S.creator.random);
  const start = h('button', 'btn primary', S.creator.start);
  actions.append(random, start);
  side.append(title, nameField, options, error, actions);

  function seg<T extends string>(label: string, values: T[], current: T, text: (v: T) => string, on: (v: T) => void): HTMLElement {
    const f = h('div', 'field');
    f.append(h('div', 'lbl', label));
    const row = h('div', 'seg');
    for (const v of values) {
      const b = h('button', `btn${v === current ? ' selected' : ''}`, text(v));
      b.onclick = () => on(v);
      row.append(b);
    }
    f.append(row);
    return f;
  }

  function swatches(label: string, colors: string[], current: string, on: (c: string) => void, extra?: HTMLElement): HTMLElement {
    const f = h('div', 'field');
    f.append(h('div', 'lbl', label));
    const row = h('div', 'swatches');
    for (const c of colors) {
      const s = h('button', `swatch${c === current ? ' selected' : ''}`);
      s.style.background = c;
      s.setAttribute('aria-label', c);
      s.onclick = () => on(c);
      row.append(s);
    }
    f.append(row);
    if (extra) f.append(extra);
    return f;
  }

  function render(): void {
    options.innerHTML = '';
    options.append(
      seg<Race>(S.creator.race, ['human', 'harpin'], app.race, (r) => S.creator.races[r], (r) => {
        if (r === app.race) return;
        const d = defaultAppearance(r, app.gender);
        app = { ...d, name: app.name, gender: app.gender, skin: app.skin, eyeColor: app.eyeColor, clothColor: app.clothColor };
        plumeLinked = r === 'harpin' ? false : true;
        update();
      }),
    );
    const info = h('div', 'race-info', S.creator.raceInfo[app.race]);
    options.append(info);
    options.append(
      seg<Gender>(S.creator.gender, ['m', 'f'], app.gender, (g) => S.creator.genders[g], (g) => {
        app = { ...app, gender: g };
        update();
      }),
    );
    options.append(swatches(S.creator.skin, SKIN_TONES, app.skin, (c) => ((app = { ...app, skin: c }), update())));
    options.append(
      seg<string>(S.creator.hair, HAIR_STYLES[app.race], app.hairStyle, (s) => HAIR_STYLE_LABELS[s], (s) => {
        app = { ...app, hairStyle: s };
        update();
      }),
    );
    const hairColors = app.race === 'harpin' ? Object.values(HARPIN_COLORS) : HUMAN_HAIR_COLORS;
    options.append(
      swatches(S.creator.hairColor, hairColors, app.hairColor, (c) => {
        app = { ...app, hairColor: c, plumeColor: plumeLinked && app.race === 'harpin' ? c : app.plumeColor };
        update();
      }),
    );
    if (app.race === 'harpin') {
      const link = h('button', `btn${plumeLinked ? ' selected' : ''}`, S.creator.plumeSame);
      link.style.marginTop = '6px';
      link.onclick = () => {
        plumeLinked = !plumeLinked;
        if (plumeLinked) app = { ...app, plumeColor: app.hairColor };
        update();
      };
      options.append(
        swatches(
          S.creator.plume,
          Object.values(HARPIN_COLORS),
          app.plumeColor,
          (c) => {
            plumeLinked = false;
            app = { ...app, plumeColor: c };
            update();
          },
          link,
        ),
      );
    }
    options.append(swatches(S.creator.eyes, EYE_COLORS, app.eyeColor, (c) => ((app = { ...app, eyeColor: c }), update())));
    options.append(
      swatches(S.creator.cloth, CLOTH_COLORS, app.clothColor, (c) => {
        clothChosen = true;
        app = { ...app, clothColor: c };
        update();
      }),
    );
  }

  function update(): void {
    app = autoTunic(app);
    render();
    refresh();
  }

  for (const [anim, label] of [
    ['Idle', S.creator.preview.idle],
    ['Walk', S.creator.preview.walk],
    ['Attack1', S.creator.preview.attack],
  ] as [AnimName, string][]) {
    const b = h('button', 'btn', label);
    b.onclick = () => {
      previewAnim = anim;
      view?.play(anim, 0.15);
    };
    previewUi.append(b);
  }

  random.onclick = () => {
    const name = app.name;
    app = { ...randomAppearance(Math.random), name };
    clothChosen = false;
    plumeLinked = app.plumeColor === app.hairColor;
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

  // drag to rotate
  let dragX: number | null = null;
  const down = (e: PointerEvent) => (dragX = e.clientX);
  const move = (e: PointerEvent) => {
    if (dragX === null) return;
    yaw += (e.clientX - dragX) * 0.012;
    dragX = e.clientX;
  };
  const up = () => (dragX = null);
  ctx.canvas.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);

  update();
  await building;

  const resize = () => ctx.pipeline.resize(innerWidth, innerHeight, devicePixelRatio);
  addEventListener('resize', resize);
  resize();
  (window as unknown as { __niryk: unknown }).__niryk = {
    scene: 'creator',
    get ready() {
      return !!view;
    },
    get info() {
      return { ...ctx.pipeline.renderer.info.render };
    },
  };
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;
  const frame = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (view) {
      view.root.rotation.y = yaw;
      view.update(dt);
      if (previewAnim === 'Attack1' && view.animation === 'Attack1' && view.mixer.time > 0) {
        /* attack loops back to idle after it ends */
      }
    }
    // keep the character in the free part of the screen (right on desktop, top on phones)
    const cssPerMeter = (innerWidth / ctx.pipeline.width) * iso.pixelsPerMeter;
    const portrait = innerHeight > innerWidth;
    const panelRect = side.getBoundingClientRect();
    iso.target.set(0, 0.9, 0);
    if (portrait) {
      // the panel is a bottom sheet: center the character in the strip above it (screen-up = +up)
      const freeCenter = panelRect.top / 2;
      iso.target.addScaledVector(iso.up, (freeCenter - innerHeight / 2) / cssPerMeter);
    } else {
      const freeCenter = (panelRect.right + innerWidth) / 2;
      iso.target.addScaledVector(iso.right, (innerWidth / 2 - freeCenter) / cssPerMeter);
    }
    lighting.follow(new THREE.Vector3(0, 0, 0));
    ctx.pipeline.render(scene, iso);
    raf = requestAnimationFrame(frame);
  };
  frame();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    ctx.canvas.removeEventListener('pointerdown', down);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    root.remove();
  };
}
