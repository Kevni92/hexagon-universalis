import { describe, expect, it } from 'vitest';

import { visibleCellId } from '@/topology/lod/WorldLod';
import type { CameraState } from '@/topology/lod/selection';
import { ProceduralWorldLod } from '@/world/proceduralWorldLod';

function camera(distance: number): CameraState {
  return {
    position: { x: 0, y: 0, z: distance },
    forward: { x: 0, y: 0, z: -1 },
    fovY: (45 * Math.PI) / 180,
    aspect: 4 / 3,
    viewportHeight: 800,
    sphereRadius: 1,
  };
}

describe('visuelle ProceduralWorldLod-Projektion', () => {
  it('übernimmt Relief und Modifikatoren unverändert aus der räumlichen Referenzprobe', () => {
    const world = new ProceduralWorldLod({ seed: 'visual-values', density: 'standard' });
    const units = world.update(camera(1.35));
    const sourceById = new Map(world.sourceCells.map((cell) => [cell.cellId, cell]));

    for (const unit of units) {
      for (const [index] of unit.cells.entries()) {
        const projected = world.projectedCell(visibleCellId(unit, index));
        expect(projected).toBeDefined();
        if (projected === undefined) continue;
        const source = sourceById.get(projected.sourceCellId);
        expect(source).toBeDefined();
        expect(projected.relief).toBe(source?.relief);
        expect(projected.modifiers).toEqual(source?.modifiers);
        expect(projected.elevation).toBe(source?.elevation);
      }
    }
  });

  it('liefert für ein bekanntes Referenzzentrum exakt dieselbe fachliche Zelle', () => {
    const world = new ProceduralWorldLod({ seed: 'sample-reference', density: 'low' });
    const source = world.sourceCells[0];
    if (source === undefined) throw new Error('missing source cell');

    expect(world.sampleAt(source.center)).toEqual(source);
  });
});
