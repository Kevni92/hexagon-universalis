import { describe, expect, it } from 'vitest';

import type { CameraState } from '@/topology/lod/selection';
import { createProceduralWorld } from '@/world/proceduralWorld';
import { ProceduralWorldLod } from '@/world/proceduralWorldLod';

describe('Abnahme der prozeduralen Testwelt', () => {
  it('enthält im Standardseed alle verpflichtenden Terrain- und Reliefgruppen', () => {
    const world = createProceduralWorld();
    const tileTypes = new Set(world.cells.map((cell) => cell.tileType));
    const relief = new Set(world.cells.map((cell) => cell.relief));

    expect(tileTypes.has('deepSea')).toBe(true);
    expect(tileTypes.has('coastalWater')).toBe(true);
    expect([...tileTypes].some((type) => ['sandCoast', 'rockyCoast'].includes(type))).toBe(true);
    expect(
      [...tileTypes].some((type) =>
        ['temperateMixedForest', 'borealForest', 'tropicalRainforest'].includes(type),
      ),
    ).toBe(true);
    expect([...tileTypes].some((type) => ['desert', 'semiDesert'].includes(type))).toBe(true);
    expect(tileTypes.has('tundra')).toBe(true);
    expect([...tileTypes].some((type) => ['wetland', 'mangrove'].includes(type))).toBe(true);
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

  it('liefert stabile Fachwerte für die benannten Weltstufen', () => {
    const first = new ProceduralWorldLod({ seed: 'acceptance-seed', density: 'standard' });
    const second = new ProceduralWorldLod({ seed: 'acceptance-seed', density: 'standard' });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.update(camera(3.4))).toHaveLength(1);
    expect(first.activeLevel).toBe('global');
    expect(first.update(camera(2.8))[0]?.level).toBe(1);
    expect(first.update(camera(1.2))[0]?.level).toBe(2);
  });
});

function camera(distance: number): CameraState {
  return {
    position: { x: 0, y: 0, z: distance },
    forward: { x: 0, y: 0, z: -1 },
    fovY: (45 * Math.PI) / 180,
    aspect: 4 / 3,
    viewportHeight: 720,
    sphereRadius: 1,
  };
}
