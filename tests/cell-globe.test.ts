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

  it('keeps spherical centers and boundaries on one radius without radial craters', () => {
    const data = createCellGlobeGeometryData(createGeodesicTopology(2), 2);
    for (let index = 0; index < data.positions.length; index += 3) {
      expect(
        Math.hypot(
          data.positions[index] ?? 0,
          data.positions[index + 1] ?? 0,
          data.positions[index + 2] ?? 0,
        ),
      ).toBeCloseTo(2, 6);
    }
  });

  it('applies a deterministic per-cell surface radius without losing picking IDs', () => {
    const topology = createGeodesicTopology(2);
    const selected = topology.cells[0];
    if (selected === undefined) throw new Error('missing cell');
    const data = createCellGlobeGeometryData(
      topology,
      1,
      undefined,
      'spherical',
      (_position, cellId) => (cellId === selected.id ? 1.08 : 0.99),
    );

    for (const [triangleIndex, cellId] of data.cellIds.entries()) {
      const expectedRadius = cellId === selected.id ? 1.08 : 0.99;
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        const offset = triangleIndex * 9 + vertexIndex * 3;
        expect(
          Math.hypot(
            data.positions[offset] ?? 0,
            data.positions[offset + 1] ?? 0,
            data.positions[offset + 2] ?? 0,
          ),
        ).toBeCloseTo(expectedRadius, 6);
      }
    }
    expect(data.cellIds).toContain(selected.id);
  });

  it('projects every local tile onto its tangent plane with one stable up normal', () => {
    const topology = createGeodesicTopology(2);
    const radius = 2;
    const data = createCellGlobeGeometryData(topology, radius, undefined, 'tangent-plane');

    for (const [triangleIndex, cellId] of data.cellIds.entries()) {
      const cell = topology.cellsById.get(cellId);
      if (cell === undefined) throw new Error(`missing cell ${cellId}`);
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        const offset = triangleIndex * 9 + vertexIndex * 3;
        const position = {
          x: data.positions[offset] ?? 0,
          y: data.positions[offset + 1] ?? 0,
          z: data.positions[offset + 2] ?? 0,
        };
        const normal = {
          x: data.normals[offset] ?? 0,
          y: data.normals[offset + 1] ?? 0,
          z: data.normals[offset + 2] ?? 0,
        };
        expect(dot(position, cell.center)).toBeCloseTo(radius, 6);
        expect(normal).toEqual(cell.center);
      }
    }
  });

  it('rejects invalid radii', () => {
    const topology = createGeodesicTopology(1);
    expect(() => createCellGlobeGeometryData(topology, 0)).toThrow(RangeError);
    expect(() => createCellGlobeGeometryData(topology, Number.NaN)).toThrow(RangeError);
    expect(() =>
      createCellGlobeGeometryData(topology, 1, undefined, 'spherical', () => Number.NaN),
    ).toThrow(RangeError);
  });
});

function dot(
  first: { readonly x: number; readonly y: number; readonly z: number },
  second: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
