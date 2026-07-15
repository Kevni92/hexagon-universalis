import { describe, expect, it } from 'vitest';

import {
  proceduralElevationMeters,
  proceduralSurfaceRadius,
  proceduralTerrainDiagnostics,
  proceduralTileColor,
} from '@/rendering/ProceduralTerrain';
import {
  createProceduralWorld,
  DEFAULT_PROCEDURAL_WORLD_CONFIG,
} from '@/world/proceduralWorld';

describe('prozedurales Terrain-Rendering', () => {
  it('bildet Tiefsee bis Hochgebirge monoton und innerhalb des Reliefbudgets ab', () => {
    const elevations = [-1, -0.62, -0.22, 0, 0.2, 0.45, 0.72, 1];
    const radii = elevations.map((elevation) => proceduralSurfaceRadius(elevation, 'global'));

    expect(radii).toEqual([...radii].sort((left, right) => left - right));
    expect(radii[0]).toBeCloseTo(0.982, 6);
    expect(radii.at(-1)).toBeCloseTo(1.065, 6);
    expect(proceduralSurfaceRadius(0.45, 'regional')).toBeGreaterThan(
      proceduralSurfaceRadius(0.45, 'global'),
    );
    expect(proceduralSurfaceRadius(0.45, 'local')).toBeGreaterThan(
      proceduralSurfaceRadius(0.45, 'regional'),
    );
  });

  it('überführt normalisierte Höhen in dokumentierte Meterwerte', () => {
    expect(proceduralElevationMeters(-1)).toBe(-11_000);
    expect(proceduralElevationMeters(-0.5)).toBe(-5_500);
    expect(proceduralElevationMeters(0)).toBe(0);
    expect(proceduralElevationMeters(0.5)).toBe(4_500);
    expect(proceduralElevationMeters(1)).toBe(9_000);
    expect(() => proceduralElevationMeters(Number.NaN)).toThrow(RangeError);
  });

  it('weist für die Standardwelt alle verpflichtenden visuellen Gruppen und Höhenbänder aus', () => {
    const world = createProceduralWorld(DEFAULT_PROCEDURAL_WORLD_CONFIG);
    const diagnostics = proceduralTerrainDiagnostics(world.cells);

    expect(diagnostics.groups).toEqual(
      expect.arrayContaining([
        'water',
        'coast',
        'open-land',
        'forest',
        'dry',
        'cold',
        'wetland',
        'deep-sea',
        'shallow-water',
        'lowland',
        'hills',
        'mountains',
        'high-mountains',
      ]),
    );
    expect(diagnostics.reliefBands).toHaveLength(7);
    expect(diagnostics.minimumRadius).toBeLessThan(1);
    expect(diagnostics.maximumRadius).toBeGreaterThan(1);
  });

  it('leitet Schnee, Eis, Relief und Feuchtigkeit deterministisch aus den Modifikatoren ab', () => {
    const base = proceduralTileColor({ tileType: 'tundra', modifiers: [] });
    const snow = proceduralTileColor({ tileType: 'tundra', modifiers: ['snowCover'] });
    const glacier = proceduralTileColor({
      tileType: 'tundra',
      modifiers: ['snowCover', 'glacier'],
    });
    const mountain = proceduralTileColor({
      tileType: 'temperateGrassland',
      modifiers: ['mountains'],
    });

    expect(proceduralTileColor({ tileType: 'tundra', modifiers: [] })).toBe(base);
    expect(snow).not.toBe(base);
    expect(glacier).not.toBe(snow);
    expect(mountain).not.toBe('#8eb85a');
  });
});
