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

export function defaultAppearance(race: Race = 'human', gender: Gender = 'm'): Appearance {
  return race === 'human'
    ? { name: '', race, gender, skin: SKIN_TONES[1], hairStyle: 'curto', hairColor: HUMAN_HAIR_COLORS[2], plumeColor: HARPIN_COLORS.branco, eyeColor: EYE_COLORS[1] }
    : { name: '', race, gender, skin: SKIN_TONES[1], hairStyle: 'espetado', hairColor: HARPIN_COLORS.branco, plumeColor: HARPIN_COLORS.preto, eyeColor: EYE_COLORS[1] };
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
  const harpinColors = Object.values(HARPIN_COLORS);
  if (a.race === 'harpin') {
    if (!harpinColors.includes(a.hairColor)) errors.push('hairColor');
    if (!harpinColors.includes(a.plumeColor)) errors.push('plumeColor');
  } else if (!HUMAN_HAIR_COLORS.includes(a.hairColor)) {
    errors.push('hairColor');
  }
  for (const k of ['skin', 'hairColor', 'plumeColor', 'eyeColor'] as const) if (!HEX.test(a[k])) errors.push(k);
  return [...new Set(errors)];
}

export function randomAppearance(rand: () => number, race?: Race): Appearance {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const r: Race = race ?? (rand() < 0.5 ? 'human' : 'harpin');
  const g: Gender = rand() < 0.5 ? 'm' : 'f';
  const harpin = Object.values(HARPIN_COLORS);
  const hair = r === 'harpin' ? pick(harpin) : pick(HUMAN_HAIR_COLORS);
  return {
    name: '',
    race: r,
    gender: g,
    skin: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES[r]),
    hairColor: hair,
    plumeColor: r === 'harpin' ? (rand() < 0.6 ? hair : pick(harpin)) : HARPIN_COLORS.branco,
    eyeColor: pick(EYE_COLORS),
  };
}
