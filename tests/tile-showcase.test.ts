import { describe, expect, it } from 'vitest';
import { createGeodesicTopology } from '@/topology/geodesic';
import { TILE_PROFILES, TILE_TYPES } from '@/data/tileCatalog';
import { createTileShowcaseWorld, tileShowcaseCellColors } from '@/data/tileShowcase';

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

describe('tileShowcaseCellColors', () => {
  it('maps every showcase cell to its catalog tile color', () => {
    const topology = createGeodesicTopology(2);
    const world = createTileShowcaseWorld(topology);
    const colors = tileShowcaseCellColors(world);

    expect(colors.size).toBe(world.cells.length);
    for (const cell of world.cells) {
      expect(colors.get(cell.cellId)).toBe(TILE_PROFILES[cell.tileType].color);
    }
  });
});
