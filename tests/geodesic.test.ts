import { describe, expect, it } from 'vitest';

import { createGeodesicTopology } from '@/topology/geodesic';

describe('createGeodesicTopology', () => {
  it.each([
    [1, 12],
    [2, 42],
    [3, 92],
  ])('creates %i cells at frequency %i', (frequency, expectedCells) => {
    const topology = createGeodesicTopology(frequency);
    expect(topology.cells).toHaveLength(expectedCells);
    expect(topology.cells.filter((cell) => cell.type === 'pentagon')).toHaveLength(12);
    expect(topology.cells.filter((cell) => cell.type === 'hexagon')).toHaveLength(
      expectedCells - 12,
    );
  });

  it('keeps the graph symmetric, unique and connected', () => {
    const topology = createGeodesicTopology(3);
    const visited = new Set<string>();
    const queue = [topology.cells[0]?.id];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      const cell = topology.cellsById.get(id);
      expect(cell).toBeDefined();
      if (cell === undefined) continue;
      expect(new Set(cell.neighborIds).size).toBe(cell.neighborIds.length);
      expect(cell.neighborIds).not.toContain(cell.id);
      for (const neighborId of cell.neighborIds) {
        expect(topology.cellsById.get(neighborId)?.neighborIds).toContain(cell.id);
        if (!visited.has(neighborId)) queue.push(neighborId);
      }
    }
    expect(visited).toHaveLength(topology.cells.length);
  });

  it('creates ordered, normalized cell geometry and deterministic IDs', () => {
    const first = createGeodesicTopology(2);
    const second = createGeodesicTopology(2);
    expect(first).toEqual(second);
    for (const cell of first.cells) {
      expect(cell.boundary).toHaveLength(cell.type === 'pentagon' ? 5 : 6);
      expect(Math.hypot(cell.center.x, cell.center.y, cell.center.z)).toBeCloseTo(1, 10);
      for (const point of cell.boundary)
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 10);
    }
  });

  it.each([0, -1, 1.5, 35, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid frequency %s',
    (frequency) => {
      expect(() => createGeodesicTopology(frequency)).toThrow(RangeError);
    },
  );
});
