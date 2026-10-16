import { ITEMS, type EquipSlot } from '@shared/items';
import type { Equipment } from '@shared/protocol';
import { ICONS } from './icons';
import { S } from './strings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface HudHandlers {
  onEquip: (slot: EquipSlot, item: string | null) => void;
  onAttack: () => void;
  onRespawn: () => void;
  onNewCharacter: () => void;
}

/** In-game interface: health, buttons, touch controls, equipment and menu panels, death screen. */
export class Hud {
  readonly root = el('div', 'hud');
  readonly fx = el('div', 'fx');
  readonly joystick = { base: el('div', 'joy-base'), knob: el('div', 'joy-knob') };
  private readonly hpFill = el('div', 'fill');
  private readonly hpLabel = el('div', 'label');
  private readonly nameEl = el('div', 'hud-name');
  private readonly hint = el('div', 'hint panel');
  private modal: HTMLElement | null = null;
  private death: HTMLElement | null = null;
  private equipment: Equipment = { weapon: null, armor: null };
  private items: string[] = [];

  constructor(
    host: HTMLElement,
    private readonly h: HudHandlers,
    touch: boolean,
  ) {
    host.classList.toggle('touch', touch);
    const top = el('div', 'hud-top');
    const bar = el('div', 'hpbar');
    bar.append(this.hpFill, this.hpLabel);
    const info = el('div');
    info.append(this.nameEl, bar);
    top.append(info);

    const buttons = el('div', 'hud-buttons');
    const bag = el('button', 'btn icon-btn interactive', ICONS.bag);
    bag.title = S.hud.equipment;
    bag.setAttribute('aria-label', S.hud.equipment);
    bag.onclick = () => this.toggleEquipment();
    const menu = el('button', 'btn icon-btn interactive', ICONS.menu);
    menu.title = S.hud.menu;
    menu.setAttribute('aria-label', S.hud.menu);
    menu.onclick = () => this.toggleMenu();
    buttons.append(bag, menu);

    const attack = el('button', 'btn attack-btn touch-only interactive', '⚔');
    attack.setAttribute('aria-label', S.hud.attack);
    attack.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.h.onAttack();
    });

    this.joystick.base.append(this.joystick.knob);
    this.hint.textContent = touch ? S.hud.hintTouch : S.hud.hintDesktop;
    this.root.append(this.fx, top, buttons, this.joystick.base, attack, this.hint);
    host.append(this.root);
    setTimeout(() => this.hideHint(), 6000);
  }

  /** Fades the controls hint (after 6 s or as soon as the player moves). */
  hideHint(): void {
    this.hint.style.opacity = '0';
  }

  setHealth(name: string, hp: number, max: number): void {
    this.nameEl.textContent = name;
    this.hpFill.style.width = `calc(${Math.max(0, hp / max) * 100}% - 4px)`;
    this.hpLabel.textContent = `${Math.ceil(hp)} / ${max}`;
  }

  setInventory(equipment: Equipment, items: string[]): void {
    this.equipment = equipment;
    this.items = items;
    if (this.modal?.dataset.kind === 'equipment') this.renderEquipment();
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
      p.append(el('h2', '', S.hud.died), btn);
      this.death.append(p);
      this.root.append(this.death);
    }
    (this.death.querySelector('button') as HTMLButtonElement).disabled = !canRespawn;
  }

  get panelOpen(): boolean {
    return this.modal !== null;
  }

  toggleEquipment(): void {
    if (this.modal?.dataset.kind === 'equipment') return this.closeModal();
    this.openModal('equipment');
    this.renderEquipment();
  }

  toggleMenu(): void {
    if (this.modal?.dataset.kind === 'menu') return this.closeModal();
    const body = this.openModal('menu');
    const list = el('div', 'menu-list');
    const full = el('button', 'btn', S.hud.fullscreen);
    full.onclick = () => {
      const d = document.documentElement;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void d.requestFullscreen?.().catch(() => {});
      this.closeModal();
    };
    const fresh = el('button', 'btn', S.hud.newCharacter);
    fresh.onclick = () => this.h.onNewCharacter();
    const close = el('button', 'btn', S.hud.close);
    close.onclick = () => this.closeModal();
    list.append(full, fresh, close);
    body.append(el('h2', '', S.hud.menu), list);
  }

  closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private openModal(kind: string): HTMLElement {
    this.closeModal();
    const back = el('div', 'modal-back');
    back.dataset.kind = kind;
    back.onclick = (e) => e.target === back && this.closeModal();
    const panel = el('div', 'panel modal');
    back.append(panel);
    this.root.append(back);
    this.modal = back;
    return panel;
  }

  private renderEquipment(): void {
    const panel = this.modal?.querySelector('.modal') as HTMLElement;
    panel.innerHTML = '';
    panel.append(el('h2', '', S.hud.equipment));
    for (const slot of ['weapon', 'armor'] as EquipSlot[]) {
      const id = this.equipment[slot];
      const item = id ? ITEMS[id] : null;
      const row = el('div', 'slot-row');
      row.append(el('div', 'item-icon', item ? ICONS[item.icon] : ''));
      const txt = el('div', 'grow');
      txt.innerHTML = `${item ? item.name : S.hud.empty}<small>${slot === 'weapon' ? S.hud.weapon : S.hud.armor}</small>`;
      row.append(txt);
      if (item) {
        const b = el('button', 'btn', S.hud.unequip);
        b.onclick = () => this.h.onEquip(slot, null);
        row.append(b);
      }
      panel.append(row);
    }
    panel.append(el('h2', '', S.hud.inventory));
    if (this.items.length === 0) panel.append(el('div', 'race-info', S.hud.inventoryEmpty));
    for (const id of this.items) {
      const item = ITEMS[id];
      const row = el('div', 'slot-row');
      row.append(el('div', 'item-icon', ICONS[item.icon]));
      const txt = el('div', 'grow');
      txt.innerHTML = `${item.name}<small>${item.description}</small>`;
      const b = el('button', 'btn', S.hud.equip);
      b.onclick = () => this.h.onEquip(item.slot, id);
      row.append(txt, b);
      panel.append(row);
    }
    const close = el('button', 'btn', S.hud.close);
    close.onclick = () => this.closeModal();
    panel.append(close);
  }

  dispose(): void {
    this.root.remove();
  }
}
