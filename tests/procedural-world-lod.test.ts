import { describe, expect, it } from 'vitest';

import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import { estimateCellRadius } from '@/topology/lod/hierarchy';
import type { CameraState } from '@/topology/lod/selection';
import { PROCEDURAL_LOD_PROFILES, ProceduralWorldLod } from '@/world/proceduralWorldLod';

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

describe('ProceduralWorldLod', () => {
  it('ordnet jeder Dichte streng steigende Global-, Regional- und Lokal-Frequenzen zu', () => {
    expect(PROCEDURAL_LOD_PROFILES.low.levelCellCounts).toEqual({
      global: 162,
      regional: 642,
      local: 2562,
    });
    expect(PROCEDURAL_LOD_PROFILES.standard.levelCellCounts).toEqual({
      global: 642,
      regional: 2562,
      local: 10242,
    });
    expect(PROCEDURAL_LOD_PROFILES.high.levelCellCounts).toEqual({
      global: 2562,
      regional: 5762,
      local: 10242,
    });

    for (const profile of Object.values(PROCEDURAL_LOD_PROFILES)) {
      const { global, regional, local } = profile.quality.levels;
      expect(global.frequency).toBeLessThan(regional.frequency);
      expect(regional.frequency).toBeLessThan(local.frequency);
      expect(profile.maxDrawCalls).toBe(3);
    }
  });

  it('erreicht mit denselben Generatorparametern alle drei benannten Weltstufen', () => {
    const world = new ProceduralWorldLod({
      seed: 'lod-reference',
      density: 'standard',
    });

    const global = world.update(camera(10));
    expect(new Set(global.map((unit) => unit.level))).toEqual(new Set([0]));
    expect(global).toHaveLength(1);
    expect(global[0]?.cells).toHaveLength(642);

    const regional = world.update(camera(2.8));
    expect(new Set(regional.map((unit) => unit.level))).toEqual(new Set([0, 1]));
    expect(cellsAtLevel(regional, 0).length).toBeLessThan(642);
    expect(cellsAtLevel(regional, 1).length).toBeGreaterThan(0);
    expect(cellsAtLevel(regional, 1).length).toBeLessThan(2562);

    const regionalOnly = world.update(camera(2.2));
    expect(new Set(regionalOnly.map((unit) => unit.level))).toEqual(new Set([0, 1]));

    const local = world.update(camera(1.18));
    expect(new Set(local.map((unit) => unit.level))).toEqual(new Set([0, 1, 2]));
    expect(cellsAtLevel(local, 2).length).toBeGreaterThan(0);
    expect(cellsAtLevel(local, 2).length).toBeLessThan(10242);
    expect(meanRadius(regional, 1)).toBeLessThan(meanRadius(global, 0));
    expect(meanRadius(local, 2)).toBeLessThan(meanRadius(local, 1));
    expect(world.config.seed).toBe('lod-reference');
    expect(world.fingerprint).toMatch(/^pw1-[0-9a-f]{8}$/);
  });

  it('ersetzt Elternflächen hierarchisch statt Global-, Regional- und Lokalflächen zu überlagern', () => {
    const world = new ProceduralWorldLod({
      seed: 'exclusive-lod',
      density: 'standard',
    });
    const units = world.update(camera(1.18));
    const globalIndices = new Set(cellsAtLevel(units, 0).map((cell) => cell.id.index));

    for (const regionalCell of cellsAtLevel(units, 1)) {
      if (regionalCell.parentIndex !== null)
        expect(globalIndices.has(regionalCell.parentIndex)).toBe(false);
    }

    for (const localUnit of units.filter((unit) => unit.level === 2)) {
      const match = /\/g(\d+)\/p(\d+)$/.exec(localUnit.key);
      expect(match).not.toBeNull();
      const globalParent = Number.parseInt(match?.[1] ?? '-1', 10);
      const regionalParent = Number.parseInt(match?.[2] ?? '-1', 10);
      expect(globalIndices.has(globalParent)).toBe(false);
      expect(
        cellsAtLevel(units, 1).some(
          (cell) => cell.parentIndex === globalParent && cell.id.index === regionalParent,
        ),
      ).toBe(false);
    }
  });

  it('liefert für dieselben räumlichen Referenzproben stufenübergreifend identische Fachwerte', () => {
    const world = new ProceduralWorldLod({
      seed: 'shared-position',
      density: 'standard',
    });
    const seen = new Map<
      string,
      {
        elevation: number;
        surface: string;
        temperature: number;
        moisture: number;
      }
    >();
    let sharedSamples = 0;

    for (const distance of [10, 2.8, 2.2]) {
      const units = world.update(camera(distance));
      for (const unit of units) {
        for (const [index] of unit.cells.entries()) {
          const projected = world.projectedCell(visibleCellId(unit, index));
          expect(projected).toBeDefined();
          if (projected === undefined) continue;
          const values = {
            elevation: projected.elevation,
            surface: projected.surface,
            temperature: projected.temperature,
            moisture: projected.moisture,
          };
          const previous = seen.get(projected.sourceCellId);
          if (previous !== undefined) {
            expect(values).toEqual(previous);
            sharedSamples += 1;
          } else seen.set(projected.sourceCellId, values);
        }
      }
    }

    expect(sharedSamples).toBeGreaterThan(0);
  });

  it('verwendet voll qualifizierte lokale IDs ohne doppelt sichtbare Picking-Flächen', () => {
    const world = new ProceduralWorldLod({ density: 'standard' });
    const units = world.update(camera(1.18));
    const ids = units.flatMap((unit) =>
      unit.cells.map((_cell, index) => visibleCellId(unit, index)),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('lvl2-local/')).every((id) => /\/c\d+$/.test(id))).toBe(
      true,
    );
  });

  it('invalidiert bei Seedwechsel nur Fachprojektionen und bei Dichtewechsel auch die Topologie', () => {
    const world = new ProceduralWorldLod({ seed: 'before', density: 'low' });
    const firstUnits = world.update(camera(10));
    const firstIds = firstUnits.flatMap((unit) =>
      unit.cells.map((_cell, index) => visibleCellId(unit, index)),
    );
    const firstFingerprint = world.fingerprint;

    world.reconfigure({ seed: 'after' });
    expect(world.cacheStats).toEqual({ projectedCells: 0, generation: 2 });
    expect(world.fingerprint).not.toBe(firstFingerprint);
    const sameDensityIds = world
      .update(camera(10))
      .flatMap((unit) => unit.cells.map((_cell, index) => visibleCellId(unit, index)));
    expect(sameDensityIds).toEqual(firstIds);

    world.reconfigure({ density: 'standard' });
    expect(world.cacheStats).toEqual({ projectedCells: 0, generation: 3 });
    expect(world.profile.levelCellCounts.global).toBe(642);
  });

  it('behält bei einer ungültigen Neukonfiguration die bisherige gültige Welt atomar bei', () => {
    const world = new ProceduralWorldLod({
      seed: 'valid-world',
      density: 'standard',
    });
    const fingerprint = world.fingerprint;

    expect(() => world.reconfigure({ seed: '' })).toThrow(/Seed/);
    expect(world.config.seed).toBe('valid-world');
    expect(world.fingerprint).toBe(fingerprint);
    expect(world.cacheStats.generation).toBe(1);
  });

  it('pruned Projektionen beim Schwenken und leert alle Ressourcen beim Dispose', () => {
    const world = new ProceduralWorldLod({ density: 'standard' });
    for (const position of [
      { x: 0, y: 0, z: 2.2 },
      { x: 2.2, y: 0, z: 0 },
      { x: 0, y: 2.2, z: 0 },
    ]) {
      world.update({
        ...camera(2.2),
        position,
        forward: { x: -position.x, y: -position.y, z: -position.z },
      });
      expect(world.cacheStats.projectedCells).toBeLessThanOrEqual(world.profile.maxActiveCells);
    }

    world.dispose();
    expect(world.cacheStats.projectedCells).toBe(0);
    expect(world.cellColors.size).toBe(0);
    expect(() => world.update(camera(10))).toThrow(/disposed/);
  });
});

function cellsAtLevel(units: readonly VisibleUnit[], level: 0 | 1 | 2) {
  return units.filter((unit) => unit.level === level).flatMap((unit) => unit.cells);
}

function meanRadius(units: readonly VisibleUnit[], level: 0 | 1 | 2): number {
  const cells = cellsAtLevel(units, level);
  return cells.reduce((sum, cell) => sum + estimateCellRadius(cell.cell), 0) / cells.length;
}
