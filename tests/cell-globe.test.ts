import { describe, expect, it } from 'vitest';

import { createCellGlobeGeometryData } from '@/rendering/CellGlobe';
import { createGeodesicTopology, type GeodesicTopology } from '@/topology/geodesic';

describe('createCellGlobeGeometryData', () => {
  it('triangulates every pentagon and hexagon and preserves cell mapping', () => {
    const topology = createGeodesicTopology(2);
    const data = createCellGlobeGeometryData(topology);
    const expectedTriangles = topology.cells.reduce(
      (total, cell) => total + cell.boundary.length,
      0,
    );

    expect(data.triangleCount).toBe(expectedTriangles);
    expect(data.topTriangleCount).toBe(expectedTriangles);
    expect(data.sideTriangleCount).toBe(0);
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

  it('builds inset podium tops with two closed side triangles per cell edge', () => {
    const source = createGeodesicTopology(1);
    const selected = source.cells[0];
    if (selected === undefined) throw new Error('missing cell');
    const topology: GeodesicTopology = {
      ...source,
      cells: [selected],
      cellsById: new Map([[selected.id, selected]]),
    };
    const topRadius = 1.08;
    const baseRadius = 0.975;
    const data = createCellGlobeGeometryData(
      topology,
      1,
      new Map([[selected.id, '#80a060']]),
      'spherical',
      () => topRadius,
      { baseRadius, topInset: 0.9 },
    );
    const edgeCount = selected.boundary.length;

    expect(data.topTriangleCount).toBe(edgeCount);
    expect(data.sideTriangleCount).toBe(edgeCount * 2);
    expect(data.triangleCount).toBe(edgeCount * 3);
    expect(data.positions).toHaveLength(data.triangleCount * 9);
    expect(data.normals).toHaveLength(data.triangleCount * 9);
    expect(data.colors).toHaveLength(data.triangleCount * 9);
    expect(new Set(data.cellIds)).toEqual(new Set([selected.id]));

    const topPositionCount = data.topTriangleCount * 9;
    const topDots: number[] = [];
    for (let offset = 0; offset < topPositionCount; offset += 3) {
      const position = vectorAt(data.positions, offset);
      expect(length(position)).toBeCloseTo(topRadius, 6);
      topDots.push(dot(normalize(position), selected.center));
    }
    expect(Math.min(...topDots)).toBeGreaterThan(
      Math.min(...selected.boundary.map((point) => dot(point, selected.center))),
    );

    for (let triangle = data.topTriangleCount; triangle < data.triangleCount; triangle += 1) {
      const radii = [0, 1, 2].map((vertex) =>
        length(vectorAt(data.positions, triangle * 9 + vertex * 3)),
      );
      expect(radii.some((value) => Math.abs(value - topRadius) < 1e-6)).toBe(true);
      expect(radii.some((value) => Math.abs(value - baseRadius) < 1e-6)).toBe(true);
    }
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
        const position = vectorAt(data.positions, offset);
        const normal = vectorAt(data.normals, offset);
        expect(dot(position, cell.center)).toBeCloseTo(radius, 6);
        expect(normal).toEqual(cell.center);
      }
    }
  });

  it('rejects invalid radii and podium settings', () => {
    const topology = createGeodesicTopology(1);
    expect(() => createCellGlobeGeometryData(topology, 0)).toThrow(RangeError);
    expect(() => createCellGlobeGeometryData(topology, Number.NaN)).toThrow(RangeError);
    expect(() =>
      createCellGlobeGeometryData(topology, 1, undefined, 'spherical', () => Number.NaN),
    ).toThrow(RangeError);
    expect(() =>
      createCellGlobeGeometryData(topology, 1, undefined, 'spherical', () => 1.02, {
        baseRadius: 1.03,
      }),
    ).toThrow(/Podestbasis/);
    expect(() =>
      createCellGlobeGeometryData(topology, 1, undefined, 'spherical', () => 1.02, {
        baseRadius: 0.98,
        topInset: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createCellGlobeGeometryData(topology, 1, undefined, 'tangent-plane', () => 1.02, {
        baseRadius: 0.98,
      }),
    ).toThrow(/sphärische/);
  });
});

function vectorAt(
  values: readonly number[],
  offset: number,
): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  return {
    x: values[offset] ?? 0,
    y: values[offset + 1] ?? 0,
    z: values[offset + 2] ?? 0,
  };
}

function normalize(vector: { readonly x: number; readonly y: number; readonly z: number }) {
  const divisor = length(vector);
  return {
    x: vector.x / divisor,
    y: vector.y / divisor,
    z: vector.z / divisor,
  };
}

function length(vector: { readonly x: number; readonly y: number; readonly z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dot(
  first: { readonly x: number; readonly y: number; readonly z: number },
  second: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
