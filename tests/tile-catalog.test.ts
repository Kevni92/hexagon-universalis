import { describe, expect, it } from 'vitest';
import { TILE_PROFILES, TILE_TYPES, mapToVisualTile } from '@/data/tileCatalog';

describe('visual tile catalog', () => {
  it('has unique complete profiles and stable IDs', () => {
    expect(new Set(TILE_TYPES).size).toBe(25);
    for (const type of TILE_TYPES) expect(TILE_PROFILES[type].id).toBe(type);
  });
  it('maps representative real terrain deterministically', () => {
    expect(
      mapToVisualTile({ terrain: 'forest', elevationMeters: 200, landFraction: 1, isCoast: false })
        .type,
    ).toBe('temperateMixedForest');
    expect(
      mapToVisualTile({ terrain: 'forest', elevationMeters: 5000, landFraction: 1, isCoast: false })
        .modifiers,
    ).toContain('snowCover');
    expect(
      mapToVisualTile({
        terrain: 'deepWater',
        elevationMeters: -6000,
        landFraction: 0,
        isCoast: false,
      }).type,
    ).toBe('deepSea');
  });
  it('rejects invalid fachliche values', () => {
    expect(() =>
      mapToVisualTile({ terrain: 'forest', elevationMeters: 0, landFraction: 2, isCoast: false }),
    ).toThrow(RangeError);
  });
});
