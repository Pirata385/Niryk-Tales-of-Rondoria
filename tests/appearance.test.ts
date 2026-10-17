import { describe, expect, it } from 'vitest';
import {
  CLOTH_COLORS, HARPIN_COLORS, HUMAN_HAIR_COLORS, defaultAppearance, defaultTunic, migrateAppearance, randomAppearance, tunicFor,
  validateAppearance, type Gender, type Race,
} from '../src/shared/appearance';

const GREEN = CLOTH_COLORS[0];
const BROWN = CLOTH_COLORS[1];
const WINE = CLOTH_COLORS[3];
const OCHRE = CLOTH_COLORS[5];
const BODIES: [Race, Gender][] = [['human', 'm'], ['human', 'f'], ['harpin', 'm'], ['harpin', 'f']];

describe('default tunic', () => {
  it('is the agreed color per race and gender, and the creator keeps it', () => {
    const agreed = { human_m: BROWN, human_f: WINE, harpin_m: OCHRE, harpin_f: OCHRE };
    for (const [race, gender] of BODIES) {
      const d = defaultAppearance(race, gender);
      expect(d.clothColor).toBe(agreed[`${race}_${gender}`]);
      // what the creator shows before the player picks a tunic (the G9 bug turned these green)
      expect(defaultTunic(d)).toBe(d.clothColor);
    }
  });

  it('never moves for human hair, and never falls back to green for Harpin plumes', () => {
    for (const gender of ['m', 'f'] as Gender[]) {
      for (const hairColor of HUMAN_HAIR_COLORS) expect(defaultTunic({ ...defaultAppearance('human', gender), hairColor })).toBe(gender === 'f' ? WINE : BROWN);
    }
    const feathers = Object.values(HARPIN_COLORS);
    for (const hairColor of feathers) {
      for (const plumeColor of feathers) {
        const tunic = defaultTunic({ ...defaultAppearance('harpin', 'f'), hairColor, plumeColor });
        expect(tunic).not.toBe(GREEN);
        expect(tunicFor([hairColor, plumeColor], tunic)).toBe(tunic); // and it does not clash
      }
    }
  });

  it('old saves without a tunic get the default, and random looks stay valid', () => {
    const { clothColor: _, ...old } = { ...defaultAppearance('human', 'm'), name: 'Aldren' };
    expect(migrateAppearance(old).clothColor).toBe(BROWN);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) expect(validateAppearance({ ...randomAppearance(rand), name: 'Teste' })).toEqual([]);
  });
});
