import { describe, expect, it, vi } from 'vitest';

import { createGeodesicTopology } from '@/topology/geodesic';
import {
  createProceduralWorld,
  createProceduralWorldFromTopology,
  DEFAULT_PROCEDURAL_WORLD_CONFIG,
  normalizeProceduralWorldConfig,
  PROCEDURAL_DENSITY_PROFILES,
} from '@/world/proceduralWorld';
import { createSeededNoise3D } from '@/world/seededNoise';

describe('prozedurales Weltmodell', () => {
  it('erzeugt für dieselbe Konfiguration byte-identische Welten', () => {
    const first = createProceduralWorld({
      seed: 'reference-alpha',
      density: 'low',
    });
    const second = createProceduralWorld({
      seed: 'reference-alpha',
      density: 'low',
    });

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.fingerprint).toMatch(/^pw1-[0-9a-f]{8}$/);
  });

  it('ändert bei einem anderen Seed einen signifikanten Anteil der Zellen', () => {
    const first = createProceduralWorld({
      seed: 'reference-alpha',
      density: 'low',
    });
    const second = createProceduralWorld({
      seed: 'reference-beta',
      density: 'low',
    });
    const changed = first.cells.filter((cell, index) => {
      const other = second.cells[index];
      return (
        other === undefined ||
        cell.tileType !== other.tileType ||
        Math.abs(cell.elevation - other.elevation) > 0.08
      );
    });

    expect(changed.length / first.cellCount).toBeGreaterThan(0.35);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('bleibt unabhängig von der Iterationsreihenfolge der Topologie', () => {
    const topology = createGeodesicTopology(PROCEDURAL_DENSITY_PROFILES.low.frequency);
    const reversed = { ...topology, cells: [...topology.cells].reverse() };

    expect(
      createProceduralWorldFromTopology({ seed: 'order-stable', density: 'low' }, reversed),
    ).toEqual(createProceduralWorld({ seed: 'order-stable', density: 'low' }));
  });

  it('verwendet kein Math.random innerhalb der Weltgenerierung', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random darf nicht verwendet werden.');
    });

    expect(() => createProceduralWorld({ density: 'low' })).not.toThrow();
    random.mockRestore();
  });

  it('validiert Seed, Dichte und Generatorparameter', () => {
    expect(() => normalizeProceduralWorldConfig({ seed: '   ' })).toThrow(RangeError);
    expect(() => normalizeProceduralWorldConfig({ density: 'unknown' as never })).toThrow(
      RangeError,
    );
    expect(() => normalizeProceduralWorldConfig({ landFraction: 0.1 })).toThrow(RangeError);
    expect(() => normalizeProceduralWorldConfig({ continentScale: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => normalizeProceduralWorldConfig({ climateScale: 20 })).toThrow(RangeError);
    expect(() => normalizeProceduralWorldConfig({ mountainStrength: -1 })).toThrow(RangeError);
  });

  it('weist unterstützte Dichten und tatsächliche Zellzahlen korrekt aus', () => {
    for (const density of ['low', 'standard', 'ultra'] as const) {
      const world = createProceduralWorld({ density });
      const profile = PROCEDURAL_DENSITY_PROFILES[density];
      expect(world.frequency).toBe(profile.frequency);
      expect(world.cellCount).toBe(profile.cellCount);
      expect(world.cells).toHaveLength(profile.cellCount);
    }
  });

  it('liefert nur endliche serialisierbare Zellwerte in dokumentierten Bereichen', () => {
    const world = createProceduralWorld({ density: 'standard' });
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);

    for (const cell of world.cells) {
      expect(cell.elevation).toBeGreaterThanOrEqual(-1);
      expect(cell.elevation).toBeLessThanOrEqual(1);
      expect(cell.temperature).toBeGreaterThanOrEqual(0);
      expect(cell.temperature).toBeLessThanOrEqual(1);
      expect(cell.moisture).toBeGreaterThanOrEqual(0);
      expect(cell.moisture).toBeLessThanOrEqual(1);
      expect(Object.values(cell.center).every(Number.isFinite)).toBe(true);
    }
  });

  it('erzeugt kohärentere Nachbarwerte als Werte auf der gegenüberliegenden Kugelseite', () => {
    const world = createProceduralWorld({ density: 'standard' });
    const cellsById = new Map(world.cells.map((cell) => [cell.cellId, cell]));
    const neighborDifferences: number[] = [];
    const oppositeDifferences: number[] = [];

    for (const [index, cell] of world.cells.entries()) {
      for (const neighborId of cell.neighborIds) {
        const neighbor = cellsById.get(neighborId);
        if (neighbor !== undefined)
          neighborDifferences.push(Math.abs(cell.elevation - neighbor.elevation));
      }
      if (index % 12 !== 0) continue;
      const opposite = world.cells.reduce((furthest, candidate) =>
        dot(cell.center, candidate.center) < dot(cell.center, furthest.center)
          ? candidate
          : furthest,
      );
      oppositeDifferences.push(Math.abs(cell.elevation - opposite.elevation));
    }

    expect(average(neighborDifferences)).toBeLessThan(average(oppositeDifferences));
  });

  it('deckt im Standardprofil alle verpflichtenden Terrain- und Höhenklassen ab', () => {
    const world = createProceduralWorld(DEFAULT_PROCEDURAL_WORLD_CONFIG);
    const tileTypes = new Set(world.cells.map((cell) => cell.tileType));
    const relief = new Set(world.cells.map((cell) => cell.relief));
    const modifiers = new Set(world.cells.flatMap((cell) => cell.modifiers));

    expect(tileTypes.has('deepSea')).toBe(true);
    expect(tileTypes.has('coastalWater')).toBe(true);
    expect([...tileTypes].some((type) => type === 'sandCoast' || type === 'rockyCoast')).toBe(true);
    expect(
      [...tileTypes].some((type) =>
        ['temperateMixedForest', 'borealForest', 'tropicalRainforest'].includes(type),
      ),
    ).toBe(true);
    expect([...tileTypes].some((type) => type === 'desert' || type === 'semiDesert')).toBe(true);
    expect(tileTypes.has('tundra')).toBe(true);
    expect([...tileTypes].some((type) => type === 'wetland' || type === 'mangrove')).toBe(true);
    expect([...tileTypes].some((type) => type === 'iceWater' || modifiers.has('glacier'))).toBe(
      true,
    );
    expect(relief).toEqual(
      new Set([
        'deepSea',
        'oceanFloor',
        'shallowWater',
        'lowland',
        'hills',
        'mountains',
        'highMountains',
      ]),
    );
  });

  it('liefert reproduzierbare Referenz-Fingerprints für zwei Seeds und Dichten', () => {
    const fingerprints = {
      alphaLow: createProceduralWorld({
        seed: 'reference-alpha',
        density: 'low',
      }).fingerprint,
      alphaStandard: createProceduralWorld({
        seed: 'reference-alpha',
        density: 'standard',
      }).fingerprint,
      betaLow: createProceduralWorld({ seed: 'reference-beta', density: 'low' }).fingerprint,
      betaStandard: createProceduralWorld({
        seed: 'reference-beta',
        density: 'standard',
      }).fingerprint,
    };

    expect(fingerprints).toEqual({
      alphaLow: 'pw1-245f9efa',
      alphaStandard: 'pw1-f493331d',
      betaLow: 'pw1-59ec331e',
      betaStandard: 'pw1-5fa17418',
    });
  });
});

describe('seeded sphärisches Noise', () => {
  it('ist seedstabil und an Datumsgrenze sowie Polen endlich', () => {
    const first = createSeededNoise3D('seam-reference');
    const second = createSeededNoise3D('seam-reference');
    const epsilon = 0.000001;

    expect(first.sample(-2, epsilon, 0.25)).toBe(second.sample(-2, epsilon, 0.25));
    expect(first.sample(-2, epsilon, 0.25)).toBeCloseTo(first.sample(-2, -epsilon, 0.25), 4);
    expect(first.fbm(0, 4, 0)).toBeTypeOf('number');
    expect(first.fbm(0, -4, 0)).toBeTypeOf('number');
  });
});

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(
  first: { readonly x: number; readonly y: number; readonly z: number },
  second: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
