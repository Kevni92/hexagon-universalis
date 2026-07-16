import { describe, expect, it } from 'vitest';

import {
  angularDistance,
  createFlatSurfaceProjection,
  createLocalTangentFrame,
  inverseProjectLocalTangentPoint,
  projectLocalTangentPoint,
  projectSurfacePoint,
  WorldLodProjectionController,
} from '@/topology/lod/projection';

describe('hybride Globe-/Flat-Projektion', () => {
  it('creates a deterministic orthonormal east/north/up frame, including near poles', () => {
    const frame = createLocalTangentFrame({ x: 0.01, y: 0.9999, z: 0.01 });
    expect(frame).toEqual(createLocalTangentFrame({ x: 0.01, y: 0.9999, z: 0.01 }));
    for (const vector of [frame.east, frame.north, frame.up])
      expect(Math.hypot(vector.x, vector.y, vector.z)).toBeCloseTo(1, 10);
    expect(dot(frame.east, frame.north)).toBeCloseTo(0, 10);
    expect(dot(frame.east, frame.up)).toBeCloseTo(0, 10);
    expect(dot(frame.north, frame.up)).toBeCloseTo(0, 10);
  });

  it('keeps the focus at the local origin and preserves radial distance', () => {
    const frame = createLocalTangentFrame({ x: 0, y: 0, z: 1 }, 2);
    expect(projectLocalTangentPoint(frame.center, frame)).toEqual({ x: 0, y: 0, z: 0 });
    expect(projectLocalTangentPoint({ x: 0, y: 0, z: -1 }, frame)).toEqual({
      x: Math.PI * 2,
      y: 0,
      z: 0,
    });
    const point = { x: Math.sin(0.2), y: 0, z: Math.cos(0.2) };
    const local = projectLocalTangentPoint(point, frame);
    expect(Math.hypot(local.x, local.y)).toBeCloseTo(0.4, 10);
    expect(angularDistance(frame.center, point)).toBeCloseTo(0.2, 10);
    expect(projectSurfacePoint(point, frame, 2.05).z).toBeCloseTo(0.05, 10);
  });

  it('round-trips local coordinates for the diagnostic inverse', () => {
    const frame = createLocalTangentFrame({ x: 0.2, y: 0.4, z: 0.8 });
    const point = { x: -0.2, y: 0.6, z: 0.7745966692 };
    const local = projectLocalTangentPoint(point, frame);
    const roundTrip = inverseProjectLocalTangentPoint(local, frame);
    expect(angularDistance(point, roundTrip)).toBeLessThan(1e-7);
  });

  it('uses separate enter/exit thresholds and recenters only after six degrees', () => {
    const controller = new WorldLodProjectionController();
    const focus = { x: 0, y: 0, z: 1 };
    expect(controller.update({ levelName: 'local', projectedCellSizePx: 31, focus }).mode).toBe(
      'globe',
    );
    expect(controller.update({ levelName: 'local', projectedCellSizePx: 32, focus }).mode).toBe(
      'flat',
    );
    const generation = controller.current.generation;
    const smallMove = { x: Math.sin(0.05), y: 0, z: Math.cos(0.05) };
    expect(
      controller.update({ levelName: 'local', projectedCellSizePx: 32, focus: smallMove })
        .generation,
    ).toBe(generation);
    const largeMove = { x: Math.sin(0.12), y: 0, z: Math.cos(0.12) };
    expect(
      controller.update({ levelName: 'local', projectedCellSizePx: 32, focus: largeMove }).reason,
    ).toBe('focus-recenter');
    expect(controller.current.mode).toBe('flat');
    expect(
      controller.update({ levelName: 'regional', projectedCellSizePx: 100, focus: largeMove }).mode,
    ).toBe('globe');
    expect(
      controller.update({ levelName: 'local', projectedCellSizePx: 23, focus: largeMove }).mode,
    ).toBe('globe');
  });

  it('provides a stable render projection signature and local up normal', () => {
    const projection = createFlatSurfaceProjection(createLocalTangentFrame({ x: 0, y: 0, z: 1 }));
    expect(projection.signature).toBe(
      createFlatSurfaceProjection(createLocalTangentFrame({ x: 0, y: 0, z: 1 })).signature,
    );
    expect(projection.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(projection.transform({ x: 0, y: 0, z: 1 }, 1)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

function dot(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number },
): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
