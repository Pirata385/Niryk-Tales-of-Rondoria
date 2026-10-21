import { describe, expect, it } from 'vitest';
import { ASSIST_ANGLE, ASSIST_RANGE, assistAim } from '../src/shared/combat';
import { ATTACKS, WOLF } from '../src/shared/constants';

describe('aim assist', () => {
  const at = (deg: number, d: number, hp = 60) => ({ x: Math.sin((deg * Math.PI) / 180) * d, z: Math.cos((deg * Math.PI) / 180) * d, hp });

  it('keeps the crosshair aim with nothing to snap to', () => {
    expect(assistAim(0.4, 0, 0, [])).toBe(0.4);
    // too far off the crosshair, too far away, dead, or right on top of the player
    expect(assistAim(0, 0, 0, [at(40, 2)])).toBe(0);
    expect(assistAim(0, 0, 0, [at(5, ASSIST_RANGE + 0.5)])).toBe(0);
    expect(assistAim(0, 0, 0, [at(5, 2, 0)])).toBe(0);
    expect(assistAim(0, 0, 0, [at(5, 0.1)])).toBe(0);
  });

  it('snaps to a wolf within the cone and reach, from any position and across the ±π seam', () => {
    expect(assistAim(0, 0, 0, [at(20, 2)])).toBeCloseTo((20 * Math.PI) / 180, 6);
    const w = { x: 10 + Math.sin(Math.PI - 0.2) * 2, z: -5 + Math.cos(Math.PI - 0.2) * 2, hp: 30 };
    const aim = assistAim(-Math.PI + 0.1, 10, -5, [w]);
    expect(Math.abs(Math.abs(aim) - (Math.PI - 0.2))).toBeLessThan(1e-6);
  });

  it('prefers the wolf nearest the crosshair, and the closer one when they line up', () => {
    expect(assistAim(0, 0, 0, [at(-18, 1.8), at(4, 2.6)])).toBeCloseTo((4 * Math.PI) / 180, 6);
    expect(assistAim(0, 0, 0, [at(3, 3.0), at(3, 1.5)])).toBeCloseTo((3 * Math.PI) / 180, 6);
    expect(assistAim(0, 0, 0, [at(3, 3.0), { ...at(-3, 1.5) }])).toBeCloseTo((-3 * Math.PI) / 180, 6);
  });

  it('reaches as far as a swing can land', () => {
    expect(ASSIST_ANGLE).toBeCloseTo((25 * Math.PI) / 180, 9);
    expect(ASSIST_RANGE).toBeGreaterThan(ATTACKS.Attack2.range + WOLF.radius);
    expect(ASSIST_RANGE).toBeLessThan(4);
  });
});
