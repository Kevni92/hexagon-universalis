export type TerrainClass =
  | 'deepWater'
  | 'shallowWater'
  | 'coast'
  | 'grassland'
  | 'forest'
  | 'shrubland'
  | 'desert'
  | 'wetland'
  | 'cropland'
  | 'settlement'
  | 'snowIce'
  | 'highland'
  | 'mountain';

export const ESA_WORLD_COVER_MAPPING: Readonly<Record<number, TerrainClass>> = {
  10: 'forest',
  20: 'shrubland',
  30: 'grassland',
  40: 'cropland',
  50: 'settlement',
  60: 'desert',
  70: 'snowIce',
  80: 'deepWater',
  90: 'wetland',
  95: 'wetland',
  100: 'shrubland',
};

export const TERRAIN_PALETTE: Readonly<Record<TerrainClass, string>> = {
  deepWater: '#173b68',
  shallowWater: '#2f82aa',
  coast: '#c6a36a',
  grassland: '#8eb85a',
  forest: '#2d7047',
  shrubland: '#a6a65b',
  desert: '#c9a66b',
  wetland: '#4f8c72',
  cropland: '#b4a64a',
  settlement: '#b65f55',
  snowIce: '#e8f4ff',
  highland: '#85755b',
  mountain: '#66584c',
};

export interface TerrainInput {
  readonly sourceClass: number;
  readonly elevationMeters: number;
  readonly landFraction: number;
  readonly isCoast: boolean;
}

export function classifyTerrain(input: TerrainInput): TerrainClass {
  const mapped = ESA_WORLD_COVER_MAPPING[input.sourceClass];
  if (!Number.isInteger(input.sourceClass) || mapped === undefined) {
    throw new RangeError(`Unbekannte ESA-WorldCover-Klasse: ${input.sourceClass}.`);
  }
  if (
    !Number.isFinite(input.elevationMeters) ||
    !Number.isFinite(input.landFraction) ||
    input.landFraction < 0 ||
    input.landFraction > 1
  ) {
    throw new RangeError(
      'Terrainwerte müssen endlich sein; landFraction muss zwischen 0 und 1 liegen.',
    );
  }
  if (input.landFraction === 0) return 'deepWater';
  if (input.isCoast && input.landFraction < 0.6) return 'coast';

  if (mapped === 'deepWater') return 'shallowWater';
  if (mapped === 'snowIce') return 'snowIce';
  if (input.elevationMeters >= 4500) return 'mountain';
  if (input.elevationMeters >= 1500) return 'highland';
  return mapped;
}
