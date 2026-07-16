import { describe, expect, it } from 'vitest';

import { createProceduralWorld, createProceduralWorldAtFrequency } from '@/world/proceduralWorld';
import { ContinentalStructure } from '@/world/continentalStructure';

const REFERENCE_SEEDS = [
  'hexagon-universalis',
  'reference-alpha',
  'reference-beta',
  'seam-reference',
  'north-atlantic',
] as const;

describe('prozedurale Kontinentalstruktur', () => {
  it('reconstructs the same macro seeds and field values for the same seed', () => {
    const first = new ContinentalStructure('structure-alpha', 1.35);
    const second = new ContinentalStructure('structure-alpha', 1.35);
    const other = new ContinentalStructure('structure-beta', 1.35);

    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.sample({ x: 0.2, y: 0.3, z: 0.9327379 })).toEqual(
      second.sample({ x: 0.2, y: 0.3, z: 0.9327379 }),
    );
    expect(first.diagnostics).not.toEqual(other.diagnostics);
    expect(first.diagnostics.majorContinents).toHaveLength(5);
    expect(first.diagnostics.islandGroups).toHaveLength(7);
    expect(first.diagnostics.oceanBasins).toHaveLength(4);
  });

  it('keeps reference landmasses coherent and avoids isolated coarse cells', () => {
    for (const seed of REFERENCE_SEEDS) {
      const world = createProceduralWorld({ seed });
      const components = connectedComponents(world.cells);
      const landComponents = components.filter((component) => component.surface === 'land');
      const waterComponents = components.filter((component) => component.surface === 'water');
      const landCount = world.cells.filter((cell) => cell.surface === 'land').length;

      expect(landCount / world.cellCount).toBeGreaterThanOrEqual(0.35);
      expect(landCount / world.cellCount).toBeLessThanOrEqual(0.4);
      expect(landComponents.length).toBeGreaterThanOrEqual(2);
      expect(landComponents.length).toBeLessThanOrEqual(8);
      expect(landComponents.every((component) => component.ids.length >= 2)).toBe(true);
      expect(waterComponents).toHaveLength(1);
      expect(world.cells.some((cell) => cell.isShelf && cell.surface === 'water')).toBe(true);
      expect(world.cells.some((cell) => cell.isInlandBasin)).toBe(true);
      expect(world.cells.every((cell) => Object.values(cell.center).every(Number.isFinite))).toBe(
        true,
      );
    }
  });

  it('keeps macro diagnostics independent of the reference LOD frequency', () => {
    const frequencies = [4, 8, 16, 34];
    const diagnostics = frequencies.map(
      (frequency) =>
        createProceduralWorldAtFrequency({ seed: 'lod-stable', density: 'standard' }, frequency)
          .macroStructure,
    );
    expect(diagnostics[1]).toEqual(diagnostics[0]);
    expect(diagnostics[2]).toEqual(diagnostics[0]);
    expect(diagnostics[3]).toEqual(diagnostics[0]);
  });
});

interface Component {
  readonly surface: 'land' | 'water';
  readonly ids: readonly string[];
}

function connectedComponents(
  cells: readonly ReturnType<typeof createProceduralWorld>['cells'][number][],
): readonly Component[] {
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const visited = new Set<string>();
  const components: Component[] = [];
  for (const cell of cells) {
    if (visited.has(cell.cellId)) continue;
    const ids: string[] = [];
    const queue = [cell.cellId];
    visited.add(cell.cellId);
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) continue;
      const current = cellsById.get(id);
      if (current === undefined) continue;
      ids.push(id);
      for (const neighborId of current.neighborIds) {
        const neighbor = cellsById.get(neighborId);
        if (neighbor === undefined || neighbor.surface !== cell.surface || visited.has(neighborId))
          continue;
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
    components.push({ surface: cell.surface, ids });
  }
  return components;
}
