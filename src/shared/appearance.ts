/** Character appearance: what the creator edits and what the server stores/validates. */

export type Race = 'human' | 'harpin';
export type Gender = 'm' | 'f';

export interface Appearance {
  name: string;
  race: Race;
  gender: Gender;
  skin: string;
  hairStyle: string;
  hairColor: string;
  /** Harpins only: feathers of wings, tail, legs and head tufts. */
  plumeColor: string;
  eyeColor: string;
  /** Tunic color (the starter outfit's Cloth_A slot). */
  clothColor: string;
}

export const SKIN_TONES = ['#f3d2b8', '#e8b994', '#d9a57c', '#c68a5e', '#a96f47', '#8a5636', '#6a3f27', '#4a2b1c'];

export const HUMAN_HAIR_COLORS = ['#1f1714', '#3b2619', '#5b3a26', '#8a5a34', '#c08a4a', '#e0c07a', '#a8432a', '#d9d4cc'];

/** Harpin hair and plumes may only be: white, black, gray, green, blue, red, yellow (GDD). */
export const HARPIN_COLORS: Record<string, string> = {
  branco: '#ecebe6',
  preto: '#2b2830',
  cinza: '#8d8a92',
  verde: '#4f9a52',
  azul: '#3f72c4',
  vermelho: '#c43a32',
  amarelo: '#e8c040',
};

/** Tunic colors: green, brown, dark blue, wine, gray, ochre (defaults avoid the green). */
export const CLOTH_COLORS = ['#5c8a44', '#7a5236', '#34507a', '#7a2f3a', '#6b6870', '#b08a3a'];

export const EYE_COLORS = ['#3f6fa8', '#3f8a5c', '#6a4a2a', '#2b2b2b', '#8a7a3a', '#7a4ab0'];

export const HAIR_STYLES: Record<Race, string[]> = {
  human: ['curto', 'rabo', 'longo', 'coque'],
  harpin: ['espetado', 'crista', 'plumado'],
};

export const HAIR_STYLE_LABELS: Record<string, string> = {
  curto: 'Curto',
  rabo: 'Rabo de cavalo',
  longo: 'Longo',
  coque: 'Coque',
  espetado: 'Espetado',
  crista: 'Crista',
  plumado: 'Longo plumado',
};

/** Which GLB holds the body for a race + gender. */
export function bodyModel(a: Pick<Appearance, 'race' | 'gender'>): string {
  return `${a.race}_${a.gender}`;
}

/**
 * Starting look per race and gender. Default tunics stay off green (a green tunic on the green
 * fields loses the character's silhouette): human male brown, human female wine, Harpins ochre.
 */
export function defaultAppearance(race: Race = 'human', gender: Gender = 'm'): Appearance {
  return race === 'human'
    ? { name: '', race, gender, skin: SKIN_TONES[1], hairStyle: gender === 'f' ? 'longo' : 'curto', hairColor: HUMAN_HAIR_COLORS[2], plumeColor: HARPIN_COLORS.branco, eyeColor: EYE_COLORS[1], clothColor: gender === 'f' ? CLOTH_COLORS[3] : CLOTH_COLORS[1] }
    : { name: '', race, gender, skin: SKIN_TONES[1], hairStyle: gender === 'f' ? 'plumado' : 'espetado', hairColor: HARPIN_COLORS.branco, plumeColor: HARPIN_COLORS.preto, eyeColor: EYE_COLORS[1], clothColor: CLOTH_COLORS[5] };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Server-side style validation: returns a list of problems (empty = valid). */
export function validateAppearance(a: Appearance): string[] {
  const errors: string[] = [];
  if (a.race !== 'human' && a.race !== 'harpin') errors.push('race');
  if (a.gender !== 'm' && a.gender !== 'f') errors.push('gender');
  const name = a.name.trim();
  if (name.length < 2 || name.length > 16 || !/^[\p{L}\p{N} '-]+$/u.test(name)) errors.push('name');
  if (!SKIN_TONES.includes(a.skin)) errors.push('skin');
  if (!HAIR_STYLES[a.race]?.includes(a.hairStyle)) errors.push('hairStyle');
  if (!EYE_COLORS.includes(a.eyeColor)) errors.push('eyeColor');
  if (!CLOTH_COLORS.includes(a.clothColor)) errors.push('clothColor');
  const harpinColors = Object.values(HARPIN_COLORS);
  if (a.race === 'harpin') {
    if (!harpinColors.includes(a.hairColor)) errors.push('hairColor');
    if (!harpinColors.includes(a.plumeColor)) errors.push('plumeColor');
  } else if (!HUMAN_HAIR_COLORS.includes(a.hairColor)) {
    errors.push('hairColor');
  }
  for (const k of ['skin', 'hairColor', 'plumeColor', 'eyeColor', 'clothColor'] as const) if (!HEX.test(a[k])) errors.push(k);
  return [...new Set(errors)];
}

export function randomAppearance(rand: () => number, race?: Race): Appearance {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const r: Race = race ?? (rand() < 0.5 ? 'human' : 'harpin');
  const g: Gender = rand() < 0.5 ? 'm' : 'f';
  const harpin = Object.values(HARPIN_COLORS);
  const hair = r === 'harpin' ? pick(harpin) : pick(HUMAN_HAIR_COLORS);
  const plume = r === 'harpin' ? (rand() < 0.6 ? hair : pick(harpin)) : HARPIN_COLORS.branco;
  return {
    name: '',
    race: r,
    gender: g,
    skin: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES[r]),
    hairColor: hair,
    plumeColor: plume,
    eyeColor: pick(EYE_COLORS),
    clothColor: tunicFor(tunicClashColors({ race: r, hairColor: hair, plumeColor: plume }), pick(CLOTH_COLORS)),
  };
}

function hue(hex: string): { h: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / max };
}

/**
 * Keeps the tunic from melting into the plumes/hair: if the wanted tunic color is within 60° of
 * hue of a saturated hair/plume color, returns the first tunic color that is not.
 */
export function tunicFor(featherColors: string[], wanted: string): string {
  const clash = (c: string) =>
    featherColors.some((f) => {
      const a = hue(f);
      const b = hue(c);
      if (a.s < 0.25 || b.s < 0.25) return false;
      const dh = Math.abs(a.h - b.h);
      return Math.min(dh, 360 - dh) < 60;
    });
  if (!clash(wanted)) return wanted;
  // green (CLOTH_COLORS[0]) is the last resort: it melts into the fields
  return [...CLOTH_COLORS.slice(1), CLOTH_COLORS[0]].find((c) => !clash(c)) ?? wanted;
}

/**
 * Colors a tunic must not melt into: a Harpin's hair and plumes (saturated greens, blues, reds and
 * yellows, with wings and tail framing the tunic). Human hair is a natural brown or red that never
 * moves the tunic: brown hair with a brown or wine tunic is the agreed human look.
 */
export function tunicClashColors(a: Pick<Appearance, 'race' | 'hairColor' | 'plumeColor'>): string[] {
  return a.race === 'harpin' ? [a.hairColor, a.plumeColor] : [];
}

/** Tunic for a character whose player has not picked one: `wanted` (the race/gender default) off its plumes. */
export function defaultTunic(a: Pick<Appearance, 'race' | 'gender' | 'hairColor' | 'plumeColor'>, wanted?: string): string {
  return tunicFor(tunicClashColors(a), wanted ?? defaultAppearance(a.race, a.gender).clothColor);
}

/** Fills fields added after a character was saved (old saves keep working). */
export function migrateAppearance(a: Partial<Appearance>): Appearance {
  const filled = { ...defaultAppearance(a.race ?? 'human', a.gender ?? 'm'), ...a };
  return { ...filled, clothColor: a.clothColor ?? defaultTunic(filled) };
}
