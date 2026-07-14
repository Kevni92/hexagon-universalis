import { describe, expect, it } from 'vitest';

import { classifyTerrain, ESA_WORLD_COVER_MAPPING, TERRAIN_PALETTE } from '@/data/terrain';

describe('terrain classification', () => {
  it('covers every supported ESA WorldCover class and palette entry', () => {
    for (const terrain of Object.values(ESA_WORLD_COVER_MAPPING))
      expect(TERRAIN_PALETTE[terrain]).toMatch(/^#/);
    expect(Object.keys(ESA_WORLD_COVER_MAPPING)).toHaveLength(11);
  });

  it.each([
    [60, 200, 1, false, 'desert'],
    [10, 100, 1, false, 'forest'],
    [70, 0, 1, false, 'snowIce'],
    [30, 5000, 1, false, 'mountain'],
    [10, 2000, 1, false, 'highland'],
    [80, -4000, 0, false, 'deepWater'],
    [80, -10, 0.2, true, 'coast'],
  ])(
    'classifies reference terrain deterministically',
    (sourceClass, elevationMeters, landFraction, isCoast, expected) => {
      expect(classifyTerrain({ sourceClass, elevationMeters, landFraction, isCoast })).toBe(
        expected,
      );
    },
  );

  it('rejects unknown classes and invalid values', () => {
    expect(() =>
      classifyTerrain({ sourceClass: 999, elevationMeters: 0, landFraction: 1, isCoast: false }),
    ).toThrow(RangeError);
    expect(() =>
      classifyTerrain({
        sourceClass: 10,
        elevationMeters: Number.NaN,
        landFraction: 1,
        isCoast: false,
      }),
    ).toThrow(RangeError);
    expect(() =>
      classifyTerrain({ sourceClass: 10, elevationMeters: 0, landFraction: 2, isCoast: false }),
    ).toThrow(RangeError);
  });
});
