import { describe, expect, it } from 'vitest';

import { createLodFocusDiagnostics } from '@/topology/lod/diagnostics';
import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { CameraState } from '@/topology/lod/selection';
import { ProceduralWorldLod } from '@/world/proceduralWorldLod';

describe('prozeduraler LOD-Kamerafokus', () => {
  it('liefert für denselben Kamera- und Weltzustand identische Units und Fokusdiagnosen', () => {
    const world = new ProceduralWorldLod({ seed: 'fgh', density: 'standard' });
    const state = camera({ x: 0, y: 0, z: 1 }, 1.2);

    const first = world.update(state);
    const second = world.update(state);

    expect(unitSignature(second)).toEqual(unitSignature(first));
    expect(createLodFocusDiagnostics(state, second)).toEqual(
      createLodFocusDiagnostics(state, first),
    );
  });

  it('behält Fokus und Volltopologie bei einer reinen Zoomsequenz räumlich stabil', () => {
    const world = new ProceduralWorldLod({ seed: 'fgh', density: 'standard' });
    const samples = [1.2, 1.21, 1.22, 1.21, 1.2].map((distance) => {
      const state = camera({ x: 0, y: 0, z: 1 }, distance);
      const units = world.update(state);
      return {
        maximumLevel: Math.max(...units.map((unit) => unit.level)),
        diagnostics: createLodFocusDiagnostics(state, units),
      };
    });
    const reference = samples[0];
    expect(reference).toBeDefined();
    if (reference === undefined) return;

    for (const sample of samples) {
      expect(sample.maximumLevel).toBe(2);
      expect(sample.diagnostics.focusDirection).toEqual(reference.diagnostics.focusDirection);
      expect(sample.diagnostics.regionalParentIds).toEqual(reference.diagnostics.regionalParentIds);
      expect(sample.diagnostics.localParentIds).toEqual(reference.diagnostics.localParentIds);
      expect(sample.diagnostics.finestAngularDistance).not.toBeNull();
      expect(sample.diagnostics.finestAngularDistance ?? Infinity).toBeLessThan(0.2);
    }
  });

  it('verschiebt den diagnostizierten Fokus nachvollziehbar mit einer echten Rotation', () => {
    const world = new ProceduralWorldLod({ seed: 'fgh', density: 'standard' });
    const frontState = camera({ x: 0, y: 0, z: 1 }, 1.2);
    const frontDiagnostics = createLodFocusDiagnostics(frontState, world.update(frontState));

    const rotatedState = camera(normalize({ x: 0.65, y: 0.1, z: 0.75 }), 1.2);
    const rotatedDiagnostics = createLodFocusDiagnostics(rotatedState, world.update(rotatedState));

    expect(rotatedDiagnostics.focusDirection.x).toBeGreaterThan(frontDiagnostics.focusDirection.x);
    expect(rotatedDiagnostics.finestUnitKeys).toEqual(frontDiagnostics.finestUnitKeys);
    expect(rotatedDiagnostics.finestCellCount).toBe(frontDiagnostics.finestCellCount);
    expect(rotatedDiagnostics.finestAngularDistance ?? Infinity).toBeLessThan(0.2);
  });
});

function camera(
  direction: { readonly x: number; readonly y: number; readonly z: number },
  distance: number,
): CameraState {
  const normalized = normalize(direction);
  return {
    position: {
      x: normalized.x * distance,
      y: normalized.y * distance,
      z: normalized.z * distance,
    },
    forward: { x: -normalized.x, y: -normalized.y, z: -normalized.z },
    fovY: (45 * Math.PI) / 180,
    aspect: 4 / 3,
    viewportHeight: 800,
    sphereRadius: 1,
  };
}

function unitSignature(units: readonly VisibleUnit[]): readonly string[] {
  return units
    .flatMap((unit) =>
      unit.cells.map((_cell, index) => `${unit.level}:${unit.key}:${visibleCellId(unit, index)}`),
    )
    .sort();
}

function normalize(vector: { readonly x: number; readonly y: number; readonly z: number }) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
