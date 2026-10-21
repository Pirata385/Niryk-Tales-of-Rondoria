import { ITEMS, type EquipSlot } from '@shared/items';
import type { Equipment } from '@shared/protocol';
import { ICONS } from './icons';
import { S } from './strings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** An element holding one of our own inline SVG icons (constant markup from icons.ts). */
function icon(cls: string, name: string): HTMLElement {
  const e = el('div', cls);
  e.innerHTML = ICONS[name] ?? '';
  return e;
}

export interface HudHandlers {
  onAttack: () => void;
  onToggleView: () => void;
  onRespawn: () => void;
  onNewCharacter: () => void;
  onEquip: (slot: EquipSlot, item: string | null) => void;
  /** A panel opened or closed (the game releases the mouse while one is open). */
  onPanel: (open: boolean) => void;
}

/**
 * In-game interface: health bar, center crosshair, the "click to play" prompt (mouse not captured),
 * a controls hint that fades once the player moves, touch controls (joystick, attack and 1st/3rd
 * person buttons), the equipment panel (bag button or I), the menu (new character, fullscreen) and
 * the death screen.
 */
export class Hud {
  readonly root = el('div', 'hud');
  /** Damage numbers, wolf health bars and bite warnings (Effects) live here, under the panels. */
  readonly fx = el('div', 'fx');
  private readonly hurtEl = el('div', 'hurt');
  readonly joystick = { base: el('div', 'joy-base'), knob: el('div', 'joy-knob') };
  /** Touch buttons: Input ignores touches that start on them (they are not a look drag). */
  readonly buttons: HTMLElement[] = [];
  private readonly hpFill = el('div', 'fill');
  private readonly hpLabel = el('div', 'label');
  private readonly nameEl = el('div', 'hud-name');
  private readonly hint = el('div', 'hint panel');
  private readonly crosshair = el('div', 'crosshair');
  private readonly lockPrompt = el('div', 'lock-prompt hidden', S.hud.clickToPlay);
  private readonly viewBtn = el('button', 'btn view-btn touch-only interactive', S.hud.viewFirst);
  private modal: HTMLElement | null = null;
  private equipment: Equipment = { weapon: null, armor: null };
  private items: string[] = [];
  private death: HTMLElement | null = null;
  private shownName: string | null = null;
  private shownHp = NaN;
  private shownMax = NaN;
  private fireUntil = 0;
  private hintTimer = 0;

  constructor(
    host: HTMLElement,
    private readonly h: HudHandlers,
    readonly touch: boolean,
  ) {
    host.classList.toggle('touch', touch);
    const top = el('div', 'hud-top');
    const bar = el('div', 'hpbar');
    bar.append(this.hpFill, this.hpLabel);
    top.append(this.nameEl, bar);

    const buttons = el('div', 'hud-buttons');
    const bag = el('button', 'btn icon-btn bag-btn interactive');
    bag.innerHTML = ICONS.bag;
    bag.title = S.hud.equipment;
    bag.setAttribute('aria-label', S.hud.equipment);
    bag.onclick = () => this.toggleEquipment();
    const menu = el('button', 'btn icon-btn menu-btn interactive');
    menu.innerHTML = ICONS.menu;
    menu.title = S.hud.menu;
    menu.setAttribute('aria-label', S.hud.menu);
    menu.onclick = () => this.toggleMenu();
    buttons.append(bag, menu);

    const attack = el('button', 'btn attack-btn touch-only interactive', '⚔');
    attack.setAttribute('aria-label', S.hud.attack);
    this.viewBtn.setAttribute('aria-label', S.hud.view);
    // touchstart, not click: no 300 ms delay, and a thumb resting on the button repeats nothing
    const press = (b: HTMLElement, f: () => void) => {
      b.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          b.classList.add('pressed');
          f();
        },
        { passive: false },
      );
      const up = () => b.classList.remove('pressed');
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      b.addEventListener('click', (e) => {
        // a mouse click (or a synthetic tap) on a device without touch events
        if ((e as PointerEvent).pointerType === 'touch') return;
        f();
      });
    };
    press(attack, () => this.h.onAttack());
    press(this.viewBtn, () => this.h.onToggleView());
    this.buttons.push(attack, this.viewBtn, menu, bag);

    this.joystick.base.append(this.joystick.knob);
    this.hint.textContent = touch ? S.hud.hintTouch : S.hud.hintDesktop;
    this.root.append(this.hurtEl, this.fx, top, buttons, this.crosshair, this.lockPrompt, this.joystick.base, attack, this.viewBtn, this.hint);
    host.append(this.root);
    this.hintTimer = window.setTimeout(() => this.hideHint(), 9000);
  }

  /** Fades the controls hint (after a few seconds, or as soon as the player moves). */
  hideHint(): void {
    this.hint.classList.add('hidden');
  }

  /** Desktop: show "click to play" while the mouse is not captured. */
  setLockPrompt(show: boolean): void {
    this.lockPrompt.classList.toggle('hidden', !show);
  }

  /** Called every frame: touches the DOM only when the shown values change. */
  setHealth(name: string, hp: number, max: number): void {
    const shown = Math.ceil(hp);
    if (name !== this.shownName) this.nameEl.textContent = this.shownName = name;
    if (shown === this.shownHp && max === this.shownMax) return;
    this.shownHp = shown;
    this.shownMax = max;
    this.hpFill.style.width = `calc(${Math.max(0, shown / max) * 100}% - 4px)`;
    this.hpLabel.textContent = `${shown} / ${max}`;
  }

  /** Red edges flash when the player is bitten. */
  hurt(): void {
    this.hurtEl.classList.remove('on');
    void this.hurtEl.offsetWidth; // restart the animation
    this.hurtEl.classList.add('on');
  }

  /** The crosshair kicks briefly on an attack. */
  fire(now: number): void {
    this.fireUntil = now + 0.12;
    this.crosshair.classList.add('fire');
  }

  update(now: number, firstPerson: boolean, dead: boolean): void {
    if (now > this.fireUntil) this.crosshair.classList.remove('fire');
    this.crosshair.classList.toggle('hidden', dead);
    const label = firstPerson ? S.hud.viewThird : S.hud.viewFirst;
    if (this.viewBtn.textContent !== label) this.viewBtn.textContent = label;
  }

  showDeath(show: boolean, canRespawn: boolean): void {
    if (!show) {
      this.death?.remove();
      this.death = null;
      return;
    }
    if (!this.death) {
      this.death = el('div', 'modal-back');
      const p = el('div', 'panel modal death');
      const btn = el('button', 'btn primary', S.hud.respawn);
      btn.onclick = () => this.h.onRespawn();
      p.append(el('h2', '', S.hud.died), el('p', 'death-info', S.hud.diedInfo), btn);
      this.death.append(p);
      this.root.append(this.death);
    }
    (this.death.querySelector('button') as HTMLButtonElement).disabled = !canRespawn;
  }

  get panelOpen(): boolean {
    return this.modal !== null;
  }

  /** The open panel ('menu' or 'equipment'), or null. */
  get panelKind(): string | null {
    return this.modal?.dataset.kind ?? null;
  }

  /** The server's word on what is worn and carried. */
  setInventory(equipment: Equipment, items: string[]): void {
    this.equipment = equipment;
    this.items = items;
    if (this.panelKind === 'equipment') this.renderEquipment();
  }

  toggleEquipment(): void {
    if (this.panelKind === 'equipment') return this.closeModal();
    this.openModal('equipment');
    this.renderEquipment();
  }

  toggleMenu(): void {
    if (this.modal) return this.closeModal();
    const panel = this.openModal('menu');
    const list = el('div', 'menu-list');
    const full = el('button', 'btn', S.hud.fullscreen);
    full.onclick = () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
      this.closeModal();
    };
    const fresh = el('button', 'btn new-character', S.hud.newCharacter);
    fresh.onclick = () => {
      this.closeModal();
      this.h.onNewCharacter();
    };
    const close = el('button', 'btn close-btn', S.hud.close);
    close.onclick = () => this.closeModal();
    list.append(fresh, full, close);
    panel.append(el('h2', '', S.hud.menu), list);
  }

  closeModal(): void {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    this.h.onPanel(false);
  }

  private openModal(kind: string): HTMLElement {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    const back = el('div', 'modal-back');
    back.dataset.kind = kind;
    back.onclick = (e) => e.target === back && this.closeModal();
    const panel = el('div', `panel modal ${kind}`);
    back.append(panel);
    this.root.append(back);
    this.modal = back;
    this.h.onPanel(true);
    return panel;
  }

  /** Worn items (with Tirar) and the bag's items (with Equipar). */
  private renderEquipment(): void {
    const panel = this.modal?.querySelector('.modal') as HTMLElement | null;
    if (!panel) return;
    panel.replaceChildren(el('h2', '', S.hud.equipment));
    for (const slot of ['weapon', 'armor'] as EquipSlot[]) {
      const id = this.equipment[slot];
      const item = id ? ITEMS[id] : null;
      const row = el('div', 'slot-row');
      row.dataset.slot = slot;
      row.append(icon(`item-icon${item ? '' : ' empty'}`, item?.icon ?? ''));
      const txt = el('div', 'grow');
      txt.append(el('div', 'item-name', item ? item.name : S.hud.empty), el('small', '', slot === 'weapon' ? S.hud.weapon : S.hud.armor));
      row.append(txt);
      if (item) {
        const b = el('button', 'btn small', S.hud.unequip);
        b.dataset.action = 'unequip';
        b.onclick = () => this.h.onEquip(slot, null);
        row.append(b);
      }
      panel.append(row);
    }
    panel.append(el('h2', 'sub', S.hud.inventory));
    if (this.items.length === 0) panel.append(el('div', 'race-info', S.hud.inventoryEmpty));
    for (const id of this.items) {
      const item = ITEMS[id];
      if (!item) continue;
      const row = el('div', 'slot-row');
      row.dataset.item = id;
      row.append(icon('item-icon', item.icon));
      const txt = el('div', 'grow');
      txt.append(el('div', 'item-name', item.name), el('small', '', item.description));
      const b = el('button', 'btn small', S.hud.equip);
      b.dataset.action = 'equip';
      b.onclick = () => this.h.onEquip(item.slot, id);
      row.append(txt, b);
      panel.append(row);
    }
    const close = el('button', 'btn close-btn', S.hud.close);
    close.onclick = () => this.closeModal();
    panel.append(close);
  }

  dispose(): void {
    clearTimeout(this.hintTimer);
    this.root.remove();
  }
}
