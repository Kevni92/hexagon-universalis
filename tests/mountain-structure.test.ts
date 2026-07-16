import { describe, expect, it } from 'vitest';

import { ContinentalStructure } from '@/world/continentalStructure';
import { MountainStructure } from '@/world/mountainStructure';
import { createProceduralWorld } from '@/world/proceduralWorld';

describe('prozedurales Gebirgsgerüst', () => {
  it('reconstructs ranges and a cross-axis profile deterministically', () => {
    const macro = new ContinentalStructure('mountain-alpha', 1.35);
    const first = new MountainStructure('mountain-alpha', macro.diagnostics);
    const second = new MountainStructure('mountain-alpha', macro.diagnostics);
    const range = first.diagnostics.ranges[0];
    expect(range).toBeDefined();
    if (range === undefined) return;
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.sample(range.center, 0.8)).toEqual(second.sample(range.center, 0.8));
    expect(first.sample(range.center, 0.8).influence).toBeGreaterThan(0);
    expect(first.sample(range.normal, 0.8).influence).toBeLessThan(
      first.sample(range.center, 0.8).influence,
    );
  });

  it('forms coherent mountain components without positive ocean relief', () => {
    const world = createProceduralWorld({ seed: 'hexagon-universalis' });
    const cellsById = new Map(world.cells.map((cell) => [cell.cellId, cell]));
    const mountainCells = world.cells.filter(
      (cell) => cell.surface === 'land' && cell.mountainInfluence >= 0.25,
    );
    const components: string[][] = [];
    const visited = new Set<string>();
    for (const cell of mountainCells) {
      if (visited.has(cell.cellId)) continue;
      const component: string[] = [];
      const queue = [cell.cellId];
      visited.add(cell.cellId);
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) continue;
        const current = cellsById.get(id);
        if (current === undefined) continue;
        component.push(id);
        for (const neighborId of current.neighborIds) {
          const neighbor = cellsById.get(neighborId);
          if (
            neighbor !== undefined &&
            neighbor.surface === 'land' &&
            neighbor.mountainInfluence >= 0.25 &&
            !visited.has(neighborId)
          ) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
      components.push(component);
    }
    expect(components.length).toBeGreaterThanOrEqual(2);
    expect(components.every((component) => component.length >= 2)).toBe(true);
    expect(mountainCells.length).toBeGreaterThan(20);
    expect(
      world.cells
        .filter((cell) => cell.surface === 'water')
        .every((cell) => cell.mountainInfluence === 0),
    ).toBe(true);
    expect(
      world.cells.filter((cell) => cell.surface === 'water').every((cell) => cell.elevation <= 0),
    ).toBe(true);
  });
});
