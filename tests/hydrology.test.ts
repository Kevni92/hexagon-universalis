import { describe, expect, it } from 'vitest';

import { createProceduralWorld } from '@/world/proceduralWorld';

describe('prozedurale Hydrologie', () => {
  it('is deterministic, serializable and creates connected lake groups', () => {
    const first = createProceduralWorld({ seed: 'hexagon-universalis' });
    const second = createProceduralWorld({ seed: 'hexagon-universalis' });
    expect(first.lakes).toEqual(second.lakes);
    expect(first.cells.map((cell) => cell.flowToCellId)).toEqual(
      second.cells.map((cell) => cell.flowToCellId),
    );
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.lakes.length).toBeGreaterThan(0);
    for (const lake of first.lakes) {
      expect(lake.areaCells).toBeGreaterThanOrEqual(3);
      expect(new Set(lake.cellIds).size).toBe(lake.cellIds.length);
      expect(
        lake.cellIds.every(
          (cellId) => first.cells.find((cell) => cell.cellId === cellId)?.lakeId === lake.lakeId,
        ),
      ).toBe(true);
      expect(
        lake.cellIds.every(
          (cellId) =>
            first.cells.find((cell) => cell.cellId === cellId)?.lakeLevel === lake.waterLevel,
        ),
      ).toBe(true);
    }
  });

  it('keeps drainage acyclic and separates ocean water from inland lakes', () => {
    const world = createProceduralWorld({ seed: 'hydrology-beta' });
    const cellsById = new Map(world.cells.map((cell) => [cell.cellId, cell]));
    for (const cell of world.cells) {
      expect(Number.isFinite(cell.flowAccumulation)).toBe(true);
      if (cell.surface === 'water') {
        expect(cell.waterFeature).toBe('ocean');
        expect(cell.flowToCellId).toBeNull();
      }
      const visited = new Set<string>();
      let current: typeof cell | undefined = cell;
      while (current?.flowToCellId !== null && current?.flowToCellId !== undefined) {
        expect(visited.has(current.cellId)).toBe(false);
        visited.add(current.cellId);
        current = cellsById.get(current.flowToCellId);
      }
    }
    expect(world.cells.some((cell) => cell.waterFeature === 'lake')).toBe(true);
    expect(
      world.cells
        .filter((cell) => cell.waterFeature === 'lake')
        .every((cell) => cell.surface === 'land'),
    ).toBe(true);
  });
});
