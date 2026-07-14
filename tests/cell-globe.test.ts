import { describe, expect, it } from 'vitest';

import { createCellGlobeGeometryData } from '@/rendering/CellGlobe';
import { createGeodesicTopology } from '@/topology/geodesic';

describe('createCellGlobeGeometryData', () => {
  it('triangulates every pentagon and hexagon and preserves cell mapping', () => {
    const topology = createGeodesicTopology(2);
    const data = createCellGlobeGeometryData(topology);
    const expectedTriangles = topology.cells.reduce(
      (total, cell) => total + cell.boundary.length,
      0,
    );

    expect(data.triangleCount).toBe(expectedTriangles);
    expect(data.cellIds).toHaveLength(expectedTriangles);
    expect(data.positions).toHaveLength(expectedTriangles * 9);
    expect(data.normals).toHaveLength(expectedTriangles * 9);
    expect(new Set(data.cellIds)).toEqual(new Set(topology.cells.map((cell) => cell.id)));
    expect(data.positions.every(Number.isFinite)).toBe(true);
    expect(data.normals.every(Number.isFinite)).toBe(true);
  });

  it('rejects invalid radii', () => {
    const topology = createGeodesicTopology(1);
    expect(() => createCellGlobeGeometryData(topology, 0)).toThrow(RangeError);
    expect(() => createCellGlobeGeometryData(topology, Number.NaN)).toThrow(RangeError);
  });
});
