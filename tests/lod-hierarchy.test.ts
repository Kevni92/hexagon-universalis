import { describe, expect, it } from 'vitest';

import {
  createChildPatch,
  createChunkForParent,
  createGlobalPatch,
  estimateCellRadius,
  greatCircleAngle,
  materializeChunk,
  nearestParentIndex,
} from '@/topology/lod/hierarchy';
import type { Vector3 } from '@/topology/geodesic';

const NORTH_POLE: Vector3 = { x: 0, y: 1, z: 0 };
const SOUTH_POLE: Vector3 = { x: 0, y: -1, z: 0 };

describe('createGlobalPatch (Level 0)', () => {
  it('is deterministic across repeated calls', () => {
    const first = createGlobalPatch(4);
    const second = createGlobalPatch(4);
    expect(first.cells.map((cell) => cell.formattedId)).toEqual(
      second.cells.map((cell) => cell.formattedId),
    );
    expect(first.cells.map((cell) => cell.cell.center)).toEqual(
      second.cells.map((cell) => cell.cell.center),
    );
  });

  it('has exactly 12 pentagons on a fully materialized level', () => {
    const patch = createGlobalPatch(8);
    const pentagons = patch.cells.filter((cell) => cell.cell.type === 'pentagon');
    expect(pentagons).toHaveLength(12);
    expect(patch.cells).toHaveLength(642);
  });

  it('produces IDs with no parent (root) on level 0', () => {
    const patch = createGlobalPatch(2);
    for (const cell of patch.cells) {
      expect(cell.parentIndex).toBeNull();
      expect(cell.formattedId).toMatch(/^lvl0-global\/root\/c\d+$/);
    }
  });

  it('has symmetric neighborhoods and closed boundaries', () => {
    const patch = createGlobalPatch(4);
    for (const lodCell of patch.cells) {
      const { cell } = lodCell;
      expect(cell.boundary.length).toBe(cell.type === 'pentagon' ? 5 : 6);
      for (const neighborId of cell.neighborIds) {
        const neighbor = patch.topology.cellsById.get(neighborId);
        expect(neighbor).toBeDefined();
        expect(neighbor?.neighborIds).toContain(cell.id);
      }
    }
  });
});

describe('createChildPatch (Level 1/2 full patch before assignment)', () => {
  it('is a complete mini-sphere topology with its own 12 pentagons', () => {
    const patch = createChildPatch('regional', 1, 3, 8);
    expect(patch.level).toEqual({ name: 'regional', depth: 1 });
    expect(patch.parentIndex).toBe(3);
    expect(patch.cells.filter((cell) => cell.cell.type === 'pentagon')).toHaveLength(12);
    expect(patch.cells).toHaveLength(642);
    for (const cell of patch.cells) {
      expect(cell.parentIndex).toBe(3);
      expect(cell.formattedId).toMatch(/^lvl1-regional\/p3\/c\d+$/);
    }
  });

  it('is deterministic for the same parent index and frequency', () => {
    const first = createChildPatch('local', 2, 7, 4);
    const second = createChildPatch('local', 2, 7, 4);
    expect(first.cells.map((cell) => cell.formattedId)).toEqual(
      second.cells.map((cell) => cell.formattedId),
    );
  });
});

describe('greatCircleAngle / nearestParentIndex', () => {
  it('is zero for identical points and pi for antipodal points', () => {
    expect(greatCircleAngle(NORTH_POLE, NORTH_POLE)).toBeCloseTo(0, 10);
    expect(greatCircleAngle(NORTH_POLE, SOUTH_POLE)).toBeCloseTo(Math.PI, 10);
  });

  it('assigns a child center to its exact nearest parent center', () => {
    const parents: Vector3[] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    expect(nearestParentIndex({ x: 0.9, y: 0.1, z: 0.1 }, parents)).toBe(0);
    expect(nearestParentIndex({ x: 0.1, y: 0.9, z: 0.1 }, parents)).toBe(1);
    expect(nearestParentIndex({ x: 0.1, y: 0.1, z: 0.9 }, parents)).toBe(2);
  });

  it('is correct at the poles (pure 3D vectors, no lat/lon special case)', () => {
    const parents: Vector3[] = [NORTH_POLE, SOUTH_POLE, { x: 1, y: 0, z: 0 }];
    expect(nearestParentIndex({ x: 0.01, y: 0.999, z: 0.01 }, parents)).toBe(0);
    expect(nearestParentIndex({ x: -0.01, y: -0.999, z: 0.01 }, parents)).toBe(1);
  });

  it('is correct across the antimeridian (points with opposite-signed x/z near it)', () => {
    // Zwei Zentren knapp diesseits und jenseits von x = -1 (der "Datumsgrenze"
    // in 3D-Vektor-Sicht: keine Sonderbehandlung nötig, da nie mit lat/lon
    // gearbeitet wird).
    const parents: Vector3[] = [
      normalize({ x: -1, y: 0, z: 0.05 }),
      normalize({ x: -1, y: 0, z: -0.05 }),
    ];
    const childNearFirst = normalize({ x: -1, y: 0, z: 0.06 });
    const childNearSecond = normalize({ x: -1, y: 0, z: -0.06 });
    expect(nearestParentIndex(childNearFirst, parents)).toBe(0);
    expect(nearestParentIndex(childNearSecond, parents)).toBe(1);
  });

  it('throws for an empty parent list', () => {
    expect(() => nearestParentIndex(NORTH_POLE, [])).toThrow(RangeError);
  });
});

describe('materializeChunk / createChunkForParent (Umgang mit Kind-Pentagonen)', () => {
  it('discards child cells not assigned to the given parent, including most patch pentagons', () => {
    const globalPatch = createGlobalPatch(2);
    const parentCenters = globalPatch.cells.map((cell) => cell.cell.center);
    const parent = globalPatch.cells[0];
    if (parent === undefined) throw new Error('missing parent cell');

    const chunk = createChunkForParent('regional', 1, parent, parentCenters, 4);

    expect(chunk.cells.length).toBeGreaterThan(0);
    expect(chunk.cells.length).toBeLessThan(162); // volles Patch hat 162 Zellen bei f=4
    for (const cell of chunk.cells) {
      expect(cell.parentIndex).toBe(parent.id.index);
    }
  });

  it('produces a chunk whose id matches the ChunkId schema', () => {
    const globalPatch = createGlobalPatch(2);
    const parentCenters = globalPatch.cells.map((cell) => cell.cell.center);
    const parent = globalPatch.cells[5];
    if (parent === undefined) throw new Error('missing parent cell');
    const chunk = createChunkForParent('regional', 1, parent, parentCenters, 4);
    expect(chunk.formattedId).toBe(`lvl1-regional/chunk-p${parent.id.index}`);
  });

  it('every assigned cell is strictly nearest to its own parent among all parents', () => {
    const globalPatch = createGlobalPatch(2);
    const parentCenters = globalPatch.cells.map((cell) => cell.cell.center);
    const parent = globalPatch.cells[2];
    if (parent === undefined) throw new Error('missing parent cell');
    const patch = createChildPatch('regional', 1, parent.id.index, 4);
    const chunk = materializeChunk(
      patch,
      parent.id.index,
      parentCenters,
      parent.cell.center,
      estimateCellRadius(parent.cell),
    );
    for (const lodCell of chunk.cells) {
      expect(nearestParentIndex(lodCell.cell.center, parentCenters)).toBe(parent.id.index);
    }
  });

  it('throws when trying to materialize a chunk for level 0', () => {
    const patch = createGlobalPatch(2);
    expect(() => materializeChunk(patch, 0, [], { x: 0, y: 0, z: 1 }, 0)).toThrow(RangeError);
  });
});

describe('estimateCellRadius', () => {
  it('returns a positive finite radius for regular cells', () => {
    const patch = createGlobalPatch(2);
    for (const cell of patch.cells) {
      const radius = estimateCellRadius(cell.cell);
      expect(radius).toBeGreaterThan(0);
      expect(Number.isFinite(radius)).toBe(true);
    }
  });
});

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
