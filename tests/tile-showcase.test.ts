import { describe, expect, it } from 'vitest';
import { createGeodesicTopology } from '@/topology/geodesic';
import { TILE_TYPES } from '@/data/tileCatalog';
import { createTileShowcaseWorld } from '@/data/tileShowcase';

describe('tile showcase world', () => {
  it('distributes every catalog type evenly and deterministically', () => {
    const topology = createGeodesicTopology(2);
    const first = createTileShowcaseWorld(topology);
    const second = createTileShowcaseWorld(topology);
    expect(first).toEqual(second);
    expect(first.cells).toHaveLength(42);
    expect(first.counts.size).toBe(TILE_TYPES.length);
    const counts = [...first.counts.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(first.label).toContain('keine reale Erde');
  });
  it('rejects a topology that cannot show every type', () => {
    expect(() => createTileShowcaseWorld(createGeodesicTopology(1))).toThrow(RangeError);
  });
});
