import { describe, expect, it } from 'vitest';

import { classifyWaterDepth, isCoastCell, waterVisual } from '@/rendering/WaterVisuals';

describe('water visuals', () => {
  it('maps real negative elevations to monotone depth bands', () => {
    expect(classifyWaterDepth(-10)).toBe('coastal');
    expect(classifyWaterDepth(-100)).toBe('shelf');
    expect(classifyWaterDepth(-1000)).toBe('ocean');
    expect(classifyWaterDepth(-11000)).toBe('deepOcean');
    expect(waterVisual(-100).normalizedDepth).toBeLessThan(waterVisual(-5000).normalizedDepth);
    expect(() => classifyWaterDepth(0)).toThrow(RangeError);
  });

  it('uses mixed fractions and neighbors to identify coasts', () => {
    expect(isCoastCell(0.5, false, false)).toBe(true);
    expect(isCoastCell(1, false, true)).toBe(true);
    expect(isCoastCell(0, true, false)).toBe(true);
    expect(isCoastCell(1, false, false)).toBe(false);
    expect(isCoastCell(0, false, false)).toBe(false);
  });
});
