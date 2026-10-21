import type { GrassOptions } from '../world/Grass';

/** How much the device is asked to draw. */
export interface Quality {
  name: 'high' | 'medium' | 'low';
  /** Highest device pixel ratio rendered. */
  maxPixelRatio: number;
  shadowMapSize: number;
  /** Half size of the sun's shadow square around the player (m). */
  shadowRadius: number;
  grass: GrassOptions;
  /** Multipliers of the nature draw and ink ranges (NatureView). */
  nature: { draw: number; ink: number };
}

const PRESETS: Record<Quality['name'], Quality> = {
  high: { name: 'high', maxPixelRatio: 2, shadowMapSize: 2048, shadowRadius: 28, grass: { radius: 30, capacity: 7200, inkRadius: 9 }, nature: { draw: 1, ink: 1 } },
  medium: { name: 'medium', maxPixelRatio: 1.75, shadowMapSize: 1024, shadowRadius: 22, grass: { radius: 20, capacity: 3200, inkRadius: 6 }, nature: { draw: 0.85, ink: 0.7 } },
  // weak devices (and the automated tests under a software renderer)
  low: { name: 'low', maxPixelRatio: 0.75, shadowMapSize: 1024, shadowRadius: 18, grass: { radius: 12, capacity: 1200, inkRadius: 4 }, nature: { draw: 0.7, ink: 0.5 } },
};

/** `?q=high|medium|low` wins; otherwise desktops get high and touch devices medium. */
export function pickQuality(touch: boolean, param: string | null): Quality {
  if (param === 'high' || param === 'medium' || param === 'low') return PRESETS[param];
  return PRESETS[touch ? 'medium' : 'high'];
}
