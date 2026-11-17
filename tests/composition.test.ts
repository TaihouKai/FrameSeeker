import { describe, expect, it } from 'vitest';
import { composition, diagonalDistance, isDiagonal, thirdLineDistance } from '../src/camera/composition2d.ts';

describe('Liu et al. 2010 composition scores', () => {
  it('LC1 a subject on a power point at a typical size: the paper\'s formulas by hand', () => {
    const c = composition([{ c: [1 / 3, 1 / 3], area: 0.1, saliency: 1 }], [], 1);
    expect(c.RT).toBeCloseTo(1, 6);
    // balance: the mass centre is the subject, d_M = 1/3 from the centre: exp(-(1/9)/(2*0.2))
    expect(c.VB).toBeCloseTo(Math.exp(-(1 / 9) / 0.4), 6);
    expect(c.SZ).toBeCloseTo(1, 6);
    expect(c.E).toBeCloseTo(0.92 * ((1 + 0.3 * Math.exp(-(1 / 9) / 0.4)) / 1.3) + 0.08, 6);
  });

  it('LC2 the centre is worse for the thirds, better for balance', () => {
    const centre = composition([{ c: [0.5, 0.5], area: 0.1, saliency: 1 }], [], 1);
    const third = composition([{ c: [1 / 3, 1 / 3], area: 0.1, saliency: 1 }], [], 1);
    expect(centre.RT).toBeLessThan(third.RT);
    expect(centre.VB).toBeCloseTo(1, 6);
  });

  it('LC3 lines: on a third line, along a diagonal', () => {
    expect(thirdLineDistance({ a: [0, 1 / 3], b: [1, 1 / 3], saliency: 1 })).toBeCloseTo(0, 6);
    expect(thirdLineDistance({ a: [0, 0.5], b: [1, 0.5], saliency: 1 })).toBeCloseTo(1 / 6, 6);
    const d = { a: [0.1, 0.1] as [number, number], b: [0.9, 0.9] as [number, number], saliency: 1 };
    expect(isDiagonal(d, 1)).toBe(true);
    expect(diagonalDistance(d)).toBeCloseTo(0, 6);
    // in a portrait frame the diagonal is steeper on the screen: a 45° (in pixels) line is not diagonal there
    expect(isDiagonal({ a: [0, 0], b: [1, 1 / 1.4615], saliency: 1 }, 1.4615)).toBe(false);
    // lines weigh 2/3 of the thirds score: a horizon on a third line lifts it
    const withHorizon = composition([{ c: [0.5, 0.5], area: 0.1, saliency: 1 }], [{ a: [0, 2 / 3], b: [1, 2 / 3], saliency: 1 }], 1);
    const without = composition([{ c: [0.5, 0.5], area: 0.1, saliency: 1 }], [], 1);
    expect(withHorizon.RT).toBeGreaterThan(without.RT);
  });
});
