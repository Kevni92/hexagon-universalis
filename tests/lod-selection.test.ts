import { describe, expect, it } from 'vitest';

import {
  cameraFocusDirection,
  isCellVisible,
  isFrontFacing,
  isInFrustum,
  nextRefinementState,
  projectedCellSizePx,
  RefinementController,
  selectFocusedCandidateKeys,
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

describe('cameraFocusDirection', () => {
  it('liefert beim reinen Zoomen denselben zentralen Kugelpunkt', () => {
    const far = cameraFocusDirection(camera({ position: { x: 0, y: 0, z: 4 } }));
    const near = cameraFocusDirection(camera({ position: { x: 0, y: 0, z: 1.2 } }));

    expect(near.x).toBeCloseTo(far.x, 12);
    expect(near.y).toBeCloseTo(far.y, 12);
    expect(near.z).toBeCloseTo(far.z, 12);
    expect(near).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('folgt einem seitlich gedrehten zentralen Kamerastrahl', () => {
    const direction = normalize({ x: 0.12, y: 0, z: -1 });
    const focus = cameraFocusDirection(camera({ forward: direction }));

    expect(Math.hypot(focus.x, focus.y, focus.z)).toBeCloseTo(1, 12);
    expect(focus.x).toBeGreaterThan(0);
    expect(focus.z).toBeGreaterThan(0);
  });
});

describe('selectFocusedCandidateKeys', () => {
  it('priorisiert die Bildmitte vor einer seitlich größeren projizierten Zelle', () => {
    const selected = selectFocusedCandidateKeys(
      [
        { key: 4, focusAlignment: 0.999, angularRadius: 0.1, projectedSizePx: 20 },
        { key: 9, focusAlignment: 0.95, angularRadius: 0.1, projectedSizePx: 200 },
      ],
      new Set(),
      1,
    );

    expect([...selected]).toEqual([4]);
  });

  it('behält einen aktiven Parent bei kleinen Fokusbewegungen innerhalb der räumlichen Hysterese', () => {
    const nearBoundary = selectFocusedCandidateKeys(
      [
        {
          key: 1,
          focusAlignment: Math.cos(0.051),
          angularRadius: 0.1,
          projectedSizePx: 100,
        },
        {
          key: 2,
          focusAlignment: Math.cos(0.05),
          angularRadius: 0.1,
          projectedSizePx: 100,
        },
      ],
      new Set([1]),
      1,
    );
    expect([...nearBoundary]).toEqual([1]);

    const clearCrossing = selectFocusedCandidateKeys(
      [
        {
          key: 1,
          focusAlignment: Math.cos(0.051),
          angularRadius: 0.1,
          projectedSizePx: 100,
        },
        {
          key: 2,
          focusAlignment: Math.cos(0.01),
          angularRadius: 0.1,
          projectedSizePx: 100,
        },
      ],
      new Set([1]),
      1,
    );
    expect([...clearCrossing]).toEqual([2]);
  });

  it('entscheidet identische Bewertungen deterministisch über den stabilen Schlüssel', () => {
    const selected = selectFocusedCandidateKeys(
      [
        { key: 8, focusAlignment: 0.9, angularRadius: 0.1, projectedSizePx: 50 },
        { key: 3, focusAlignment: 0.9, angularRadius: 0.1, projectedSizePx: 50 },
      ],
      new Set(),
      1,
    );

    expect([...selected]).toEqual([3]);
  });
});

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

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
