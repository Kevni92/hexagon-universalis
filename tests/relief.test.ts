import { describe, expect, it } from 'vitest';

import { cellElevation, elevationToRadius, RELIEF_PROFILES } from '@/rendering/Relief';

describe('relief mapping', () => {
  it('is monotonic and keeps sea level at the base radius', () => {
    for (const profile of Object.values(RELIEF_PROFILES)) {
      const values = [-12000, -5000, -1, 0, 1, 1000, 5000, 10000].map((height) =>
        elevationToRadius(height, profile),
      );
      expect(
        values.every((value, index) => {
          const previous = values[index - 1];
          return previous === undefined || value >= previous;
        }),
      ).toBe(true);
      expect(elevationToRadius(0, profile)).toBe(profile.baseRadius);
      expect(values.every(Number.isFinite)).toBe(true);
    }
  });

  it('uses a bounded monotone contribution from cell maxima', () => {
    expect(cellElevation(100, 500)).toBe(240);
    expect(cellElevation(100, 500, 0)).toBe(100);
    expect(cellElevation(100, 500, 1)).toBe(500);
    expect(() => cellElevation(500, 100)).toThrow(RangeError);
  });
});
