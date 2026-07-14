import { describe, expect, it } from 'vitest';

import {
  isCellVisible,
  isFrontFacing,
  isInFrustum,
  nextRefinementState,
  projectedCellSizePx,
  RefinementController,
  selectVisibleCells,
  type CameraState,
} from '@/topology/lod/selection';
import { createGlobalPatch } from '@/topology/lod/hierarchy';
import type { LevelQualityConfig } from '@/topology/lod/profiles';
import type { Vector3 } from '@/topology/geodesic';

function camera(overrides: Partial<CameraState> = {}): CameraState {
  return {
    position: { x: 0, y: 0, z: 3.4 },
    forward: { x: 0, y: 0, z: -1 },
    fovY: (45 * Math.PI) / 180,
    viewportHeight: 800,
    sphereRadius: 1,
    ...overrides,
  };
}

describe('isFrontFacing (Rückseiten-/Horizont-Culling)', () => {
  it('accepts a cell centered directly towards the camera', () => {
    expect(isFrontFacing({ x: 0, y: 0, z: 1 }, camera())).toBe(true);
  });

  it('rejects a cell on the far side of the sphere', () => {
    expect(isFrontFacing({ x: 0, y: 0, z: -1 }, camera())).toBe(false);
  });

  it('rejects a cell exactly on the visibility horizon and accepts just inside it', () => {
    const cam = camera({ position: { x: 0, y: 0, z: 2 }, sphereRadius: 1 });
    const horizonAngle = Math.acos(1 / 2);
    const justOutside: Vector3 = {
      x: Math.sin(horizonAngle + 0.05),
      y: 0,
      z: Math.cos(horizonAngle + 0.05),
    };
    const justInside: Vector3 = {
      x: Math.sin(horizonAngle - 0.05),
      y: 0,
      z: Math.cos(horizonAngle - 0.05),
    };
    expect(isFrontFacing(justOutside, cam)).toBe(false);
    expect(isFrontFacing(justInside, cam)).toBe(true);
  });
});

describe('isInFrustum', () => {
  it('accepts cells within the view cone and rejects cells well outside it', () => {
    const cam = camera();
    expect(isInFrustum({ x: 0, y: 0, z: 1 }, cam)).toBe(true);
    // Deutlich seitlich der Kamera (Kamera bei z=3.4, Blick auf -z): ein
    // Punkt nahe der Kameraebene liegt weit außerhalb des schmalen 45°-Kegels.
    expect(isInFrustum({ x: 5, y: 5, z: 3.4 }, cam)).toBe(false);
  });

  it('keeps left/right edge cells on wide viewports via the aspect-aware horizontal FOV', () => {
    // Ein Punkt seitlich vom Blickzentrum, dessen horizontaler Winkel größer
    // als fovY/2, aber kleiner als das horizontale halbe FOV eines breiten
    // Viewports ist. Ohne Aspect-Korrektur würde er verworfen.
    const edgeCell: Vector3 = { x: 0.9, y: 0, z: 1 };
    const square = camera({ position: { x: 0, y: 0, z: 2 }, aspect: 1 });
    const wide = camera({ position: { x: 0, y: 0, z: 2 }, aspect: 2.4 });
    expect(isInFrustum(edgeCell, square, 1)).toBe(false);
    expect(isInFrustum(edgeCell, wide, 1)).toBe(true);
  });
});

describe('isCellVisible (combined culling)', () => {
  it('selects visible front-side cells and rejects back-side cells', () => {
    const patch = createGlobalPatch(2);
    const cam = camera();
    const visible = patch.cells.filter((cell) => isCellVisible(cell.cell.center, cam));
    const hidden = patch.cells.filter((cell) => !isCellVisible(cell.cell.center, cam));
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);
    for (const cell of visible) expect(cell.cell.center.z).toBeGreaterThan(0);
  });
});

describe('projectedCellSizePx', () => {
  it('grows as the camera moves closer', () => {
    const far = camera({ position: { x: 0, y: 0, z: 5 } });
    const near = camera({ position: { x: 0, y: 0, z: 2 } });
    const cellCenter: Vector3 = { x: 0, y: 0, z: 1 };
    const sizeFar = projectedCellSizePx(cellCenter, 0.1, far);
    const sizeNear = projectedCellSizePx(cellCenter, 0.1, near);
    expect(sizeNear).toBeGreaterThan(sizeFar);
  });
});

describe('nextRefinementState / RefinementController (Hysterese)', () => {
  const config: LevelQualityConfig = {
    frequency: 8,
    refineAbovePx: 100,
    coarsenBelowPx: 60,
    maxActiveChunks: 12,
  };

  it('refines only once the size exceeds refineAbovePx', () => {
    expect(nextRefinementState('coarse', 99, config)).toBe('coarse');
    expect(nextRefinementState('coarse', 101, config)).toBe('refined');
  });

  it('does not flip back to coarse inside the hysteresis window', () => {
    expect(nextRefinementState('refined', 80, config)).toBe('refined');
    expect(nextRefinementState('refined', 59, config)).toBe('coarse');
  });

  it('prevents flutter across small distance oscillations around a threshold', () => {
    const controller = new RefinementController(config);
    const sizes = [95, 105, 95, 105, 95, 105]; // oszilliert um refineAbovePx=100
    const states = sizes.map((size) => controller.update(0, size));
    // Erste Überschreitung schaltet auf 'refined'; solange sizes über
    // coarsenBelowPx=60 bleiben, darf danach kein weiterer Wechsel erfolgen.
    const refinedFromIndex = states.findIndex((state) => state === 'refined');
    expect(refinedFromIndex).toBeGreaterThanOrEqual(0);
    for (let i = refinedFromIndex; i < states.length; i += 1) expect(states[i]).toBe('refined');
  });

  it('prunes stale parent state so repeated zoom does not accumulate memory', () => {
    const controller = new RefinementController(config);
    controller.update(1, 150);
    controller.update(2, 150);
    expect(controller.get(1)).toBe('refined');
    controller.prune(new Set([2]));
    expect(controller.get(1)).toBe('coarse'); // zurückgesetzt auf Default nach Pruning
    expect(controller.get(2)).toBe('refined');
  });
});

describe('selectVisibleCells', () => {
  it('limits the visible set to maxActiveChunks, preferring the largest projected cells', () => {
    const patch = createGlobalPatch(4);
    const cam = camera();
    const config: LevelQualityConfig = {
      frequency: 4,
      refineAbovePx: 100,
      coarsenBelowPx: 60,
      maxActiveChunks: 5,
    };
    const selected = selectVisibleCells(patch.cells, cam, config);
    expect(selected.length).toBeLessThanOrEqual(5);
    for (const cell of selected) expect(isCellVisible(cell.cell.center, cam)).toBe(true);
  });
});
