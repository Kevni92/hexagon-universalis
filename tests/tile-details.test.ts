import { describe, expect, it } from 'vitest';
import { createTileDetails, detailTypeBudgets } from '@/rendering/TileDetails';

describe('tile detail placement', () => {
  it('is deterministic and stays inside the documented local cell extent', () => {
    const input = {
      cellId: 'cell-1',
      tileType: 'temperateMixedForest' as const,
      modifiers: [] as const,
      count: 8,
    };
    const first = createTileDetails(input);
    expect(first).toEqual(createTileDetails(input));
    expect(first.every((detail) => Math.abs(detail.x) <= 0.35 && Math.abs(detail.y) <= 0.35)).toBe(
      true,
    );
  });
  it('excludes water, glacier and high-mountain details', () => {
    expect(
      createTileDetails({ cellId: 'sea', tileType: 'deepSea', modifiers: [], count: 5 }),
    ).toHaveLength(0);
    expect(
      createTileDetails({
        cellId: 'ice',
        tileType: 'temperateMixedForest',
        modifiers: ['glacier'],
        count: 5,
      }),
    ).toHaveLength(0);
    expect(detailTypeBudgets().grass).toBeGreaterThan(detailTypeBudgets().building);
  });
});
