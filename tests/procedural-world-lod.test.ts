import { describe, expect, it } from 'vitest';

import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import { estimateCellRadius } from '@/topology/lod/hierarchy';
import type { CameraState } from '@/topology/lod/selection';
import { PROCEDURAL_LOD_PROFILES, ProceduralWorldLod } from '@/world/proceduralWorldLod';

function camera(distance: number, viewportHeight = 800): CameraState {
  return {
    position: { x: 0, y: 0, z: distance },
    forward: { x: 0, y: 0, z: -1 },
    fovY: (45 * Math.PI) / 180,
    aspect: 4 / 3,
    viewportHeight,
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
    expect(PROCEDURAL_LOD_PROFILES.ultra.levelCellCounts).toEqual({
      global: 642,
      continental: 1692,
      macroregional: 4412,
      regional: 11562,
      subregional: 30252,
      local: 79212,
      detail: 207362,
    });
    expect(PROCEDURAL_LOD_PROFILES.ultra.maxActiveCells).toBe(16384);
    expect(PROCEDURAL_LOD_PROFILES.ultra.maxDrawCalls).toBe(33);

    for (const profile of Object.values(PROCEDURAL_LOD_PROFILES)) {
      const { global, regional, local } = profile.quality.levels;
      expect(global.frequency).toBeLessThan(regional.frequency);
      expect(regional.frequency).toBeLessThan(local.frequency);
      expect(profile.maxActiveCells).toBeLessThanOrEqual(
        profile.levelCellCounts.detail ?? profile.levelCellCounts.local,
      );
    }
  });

  it('materialisiert Ultra beim Zoomen ohne Frequenzen oberhalb des Geodesic-Limits', () => {
    const world = new ProceduralWorldLod({ seed: 'ultra-zoom-regression', density: 'ultra' });

    expect(() => world.update(camera(2.8))).not.toThrow();
    const detail = world.update(camera(1.2));

    expect(new Set(detail.map((unit) => unit.level))).toEqual(new Set([3]));
    expect(cellsAtLevel(detail, 3)).toHaveLength(32 * 480);
  });

  it('materialisiert Zwischenstufen als vollständige Kugeltopologie statt als lokales Band', () => {
    const world = new ProceduralWorldLod({ seed: 'ultra-chunk-centering', density: 'ultra' });
    const units = world.update(camera(2.2));
    const cells = units.flatMap((unit) => unit.cells);
    expect(['continental', 'macroregional', 'regional', 'subregional', 'local']).toContain(
      world.activeLevel,
    );
    expect(units).toHaveLength(1);
    expect(cells.length).toBeGreaterThan(10_000);
  });

  it('verwendet für Ultra eine feinere Referenzwelt und erzeugt stufenabhängige Höhen', async () => {
    const world = new ProceduralWorldLod({ seed: 'ultra-height-resolution', density: 'ultra' });

    expect(world.sourceCells).toHaveLength(10 * 21 ** 2 + 2);
    await world.prepare(camera(1.2));
    const detail = world.update(camera(1.2));
    const elevations = detail
      .flatMap((unit) =>
        unit.cells.map((_cell, index) => world.projectedCell(visibleCellId(unit, index))),
      )
      .filter((cell): cell is NonNullable<typeof cell> => cell !== undefined)
      .map((cell) => cell.elevation);

    expect(new Set(detail.map((unit) => unit.worldLevel))).toEqual(new Set(['detail']));
    expect(Math.max(...elevations) - Math.min(...elevations)).toBeGreaterThan(0.05);
  });

  it('bereitet Ultra-Detail-Chunks vor dem Zoom mit Fortschritt vor', async () => {
    const world = new ProceduralWorldLod({ seed: 'ultra-preload', density: 'ultra' });
    const progress: Array<{ completed: number; total: number }> = [];

    await world.prepare(camera(1.2), (entry) => progress.push(entry));

    expect(progress[0]).toEqual({ completed: 0, total: 32 });
    expect(progress.at(-1)).toEqual({ completed: 32, total: 32 });
    expect(world.cacheStats.projectedCells).toBe(32 * 480);
    expect(world.update(camera(1.2))).toHaveLength(32);
  });

  it('erreicht mit denselben Generatorparametern alle drei benannten Weltstufen', () => {
    const world = new ProceduralWorldLod({
      seed: 'lod-reference',
      density: 'standard',
    });

    const global = world.update(camera(3.4));
    expect(new Set(global.map((unit) => unit.level))).toEqual(new Set([0]));
    expect(global).toHaveLength(1);
    expect(global[0]?.cells).toHaveLength(642);

    const regional = world.update(camera(2.8));
    expect(new Set(regional.map((unit) => unit.level))).toEqual(new Set([1]));
    expect(regional).toHaveLength(1);
    expect(cellsAtLevel(regional, 1)).toHaveLength(2562);

    const regionalOnly = world.update(camera(2.2));
    expect(new Set(regionalOnly.map((unit) => unit.level))).toEqual(new Set([1]));

    const local = world.update(camera(1.2));
    expect(new Set(local.map((unit) => unit.level))).toEqual(new Set([2]));
    expect(local).toHaveLength(1);
    expect(cellsAtLevel(local, 2)).toHaveLength(10242);
    expect(meanRadius(regional, 1)).toBeLessThan(meanRadius(global, 0));
    expect(meanRadius(local, 2)).toBeLessThan(meanRadius(regional, 1));
    expect(world.update(camera(3.4))[0]?.level).toBe(0);
    expect(world.config.seed).toBe('lod-reference');
    expect(world.fingerprint).toMatch(/^pw1-[0-9a-f]{8}$/);
  });

  it('verwendet viewportweit genau eine vollständige Zellauflösung', () => {
    const world = new ProceduralWorldLod({ seed: 'exclusive-lod', density: 'standard' });

    for (const [distance, expectedLevel, expectedCells] of [
      [10, 0, 642],
      [2.8, 1, 2562],
      [1.2, 2, 10242],
    ] as const) {
      const units = world.update(camera(distance));
      expect(units).toHaveLength(1);
      expect(units[0]?.level).toBe(expectedLevel);
      expect(units[0]?.cells).toHaveLength(expectedCells);
    }
  });

  it('schaltet unabhängig von der Viewporthöhe bei denselben Kameradistanzen', () => {
    for (const viewportHeight of [640, 720, 800, 1080]) {
      const world = new ProceduralWorldLod({ density: 'standard' });
      expect(world.update(camera(3.4, viewportHeight))[0]?.level).toBe(0);
      expect(world.update(camera(2.8, viewportHeight))[0]?.level).toBe(1);
      expect(world.update(camera(1.2, viewportHeight))[0]?.level).toBe(2);
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
    const units = world.update(camera(1.2));
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
    expect(world.cacheStats).toMatchObject({ projectedCells: 0, generation: 2 });
    expect(world.fingerprint).not.toBe(firstFingerprint);
    const sameDensityIds = world
      .update(camera(10))
      .flatMap((unit) => unit.cells.map((_cell, index) => visibleCellId(unit, index)));
    expect(sameDensityIds).toEqual(firstIds);

    world.reconfigure({ density: 'standard' });
    expect(world.cacheStats).toMatchObject({ projectedCells: 0, generation: 3 });
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

  it('hält höchstens drei Volltopologien samt Projektionen und leert sie beim Dispose', () => {
    const world = new ProceduralWorldLod({ density: 'standard' });
    for (let cycle = 0; cycle < 4; cycle += 1)
      for (const distance of [3.4, 2.8, 1.2]) world.update(camera(distance));

    expect(world.cacheStats.cachedTopologies).toBe(3);
    expect(world.cacheStats.topologyBuilds).toBe(3);
    expect(world.cacheStats.projectedCells).toBe(
      Object.values(world.profile.levelCellCounts).reduce((sum, count) => sum + count, 0),
    );

    world.dispose();
    expect(world.cacheStats.projectedCells).toBe(0);
    expect(world.cacheStats.cachedTopologies).toBe(0);
    expect(world.cellColors.size).toBe(0);
    expect(() => world.update(camera(10))).toThrow(/disposed/);
  });
});

function cellsAtLevel(units: readonly VisibleUnit[], level: 0 | 1 | 2 | 3) {
  return units.filter((unit) => unit.level === level).flatMap((unit) => unit.cells);
}

function meanRadius(units: readonly VisibleUnit[], level: 0 | 1 | 2 | 3): number {
  const cells = cellsAtLevel(units, level);
  return cells.reduce((sum, cell) => sum + estimateCellRadius(cell.cell), 0) / cells.length;
}
