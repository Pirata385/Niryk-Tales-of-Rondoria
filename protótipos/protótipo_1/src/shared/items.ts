/** Item definitions shared by client (models, UI) and server (rules). */

export type EquipSlot = 'weapon' | 'armor';

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot;
  /** Model name in assets/models (armor: suffixed with the body model, e.g. armor_guard_human_m). */
  model: string;
  /** Weapon damage range. */
  damage?: [number, number];
  /** Fraction of incoming damage absorbed by armor. */
  defense?: number;
  icon: string;
  description: string;
}

export const ITEMS: Record<string, ItemDef> = {
  sword_iron: {
    id: 'sword_iron',
    name: 'Espada de Ferro',
    slot: 'weapon',
    model: 'sword_iron',
    damage: [12, 16],
    icon: 'icon_sword',
    description: 'Lâmina de ferro forjada na vila. Golpe horizontal e corte diagonal em combo.',
  },
  armor_guard: {
    id: 'armor_guard',
    name: 'Armadura do Guarda',
    slot: 'armor',
    model: 'armor_guard',
    defense: 0.4,
    icon: 'icon_armor',
    description: 'Peitoral, ombreiras, braçadeiras, faldas e grevas da guarda de Rondoria. Reduz 40% do dano.',
  },
};

export const STARTING_EQUIPMENT: Record<EquipSlot, string | null> = { weapon: 'sword_iron', armor: null };
export const STARTING_INVENTORY = ['armor_guard'];
