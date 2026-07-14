import type { TerrainClass } from '@/data/terrain';

export type TileType =
  | 'deepSea'
  | 'ocean'
  | 'shelfWater'
  | 'coastalWater'
  | 'sandCoast'
  | 'rockyCoast'
  | 'iceWater'
  | 'temperateGrassland'
  | 'steppe'
  | 'savanna'
  | 'tundra'
  | 'desert'
  | 'semiDesert'
  | 'bareRock'
  | 'cropland'
  | 'wetland'
  | 'settlement'
  | 'temperateMixedForest'
  | 'borealForest'
  | 'tundraWoodland'
  | 'mediterraneanWoodland'
  | 'tropicalRainforest'
  | 'tropicalDryForest'
  | 'subtropicalForest'
  | 'mangrove';
export type TileModifier =
  'hills' | 'mountains' | 'highMountains' | 'snowCover' | 'glacier' | 'coastal' | 'wet';
export interface TileProfile {
  readonly id: TileType;
  readonly label: string;
  readonly description: string;
  readonly color: string;
  readonly roughness: number;
  readonly details: readonly string[];
}
export interface VisualTile {
  readonly type: TileType;
  readonly modifiers: readonly TileModifier[];
}
const profile = (
  id: TileType,
  label: string,
  color: string,
  details: readonly string[] = [],
): TileProfile => ({
  id,
  label,
  description: `${label} – datenbasierter visueller Tile-Typ`,
  color,
  roughness: 0.9,
  details,
});
export const TILE_PROFILES: Readonly<Record<TileType, TileProfile>> = {
  deepSea: profile('deepSea', 'Tiefsee', '#102e5b'),
  ocean: profile('ocean', 'Offener Ozean', '#235b88'),
  shelfWater: profile('shelfWater', 'Schelfwasser', '#347f9e'),
  coastalWater: profile('coastalWater', 'Küstenwasser', '#4fabc2'),
  sandCoast: profile('sandCoast', 'Sandküste', '#c6a36a', ['grass']),
  rockyCoast: profile('rockyCoast', 'Felsküste', '#77736b', ['rock']),
  iceWater: profile('iceWater', 'Eiswasser', '#a8d8e8', ['ice']),
  temperateGrassland: profile('temperateGrassland', 'Gemäßigtes Grasland', '#8eb85a', ['grass']),
  steppe: profile('steppe', 'Steppe', '#a6a65b', ['grass']),
  savanna: profile('savanna', 'Savanne', '#b7ad55', ['grass']),
  tundra: profile('tundra', 'Tundra', '#9fa98a', ['lowShrub']),
  desert: profile('desert', 'Wüste', '#c9a66b', ['rock']),
  semiDesert: profile('semiDesert', 'Halbwüste', '#b99a66', ['rock']),
  bareRock: profile('bareRock', 'Karge Felsfläche', '#66584c', ['rock']),
  cropland: profile('cropland', 'Ackerland', '#b4a64a', ['grass']),
  wetland: profile('wetland', 'Feuchtgebiet', '#4f8c72', ['lowShrub']),
  settlement: profile('settlement', 'Siedlung', '#b65f55', ['building']),
  temperateMixedForest: profile('temperateMixedForest', 'Mitteleuropäischer Mischwald', '#2d7047', [
    'deciduousTree',
  ]),
  borealForest: profile('borealForest', 'Borealer Nadelwald', '#28533f', ['conifer']),
  tundraWoodland: profile('tundraWoodland', 'Waldtundra', '#58705b', ['lowConifer']),
  mediterraneanWoodland: profile('mediterraneanWoodland', 'Mediterraner Wald', '#537b45', [
    'shrub',
  ]),
  tropicalRainforest: profile('tropicalRainforest', 'Tropischer Regenwald', '#165c3a', [
    'tropicalTree',
  ]),
  tropicalDryForest: profile('tropicalDryForest', 'Tropischer Trockenwald', '#3f783f', [
    'tropicalTree',
  ]),
  subtropicalForest: profile('subtropicalForest', 'Subtropischer Wald', '#347052', ['tree']),
  mangrove: profile('mangrove', 'Mangrove', '#286b5c', ['lowTree']),
};
export const TILE_TYPES = Object.keys(TILE_PROFILES) as TileType[];
export interface TileMappingInput {
  readonly terrain: TerrainClass;
  readonly elevationMeters: number;
  readonly landFraction: number;
  readonly isCoast: boolean;
}
export function mapToVisualTile(input: TileMappingInput): VisualTile {
  if (!Number.isFinite(input.elevationMeters) || input.landFraction < 0 || input.landFraction > 1)
    throw new RangeError('Tile-Mappingwerte sind ungültig.');
  if (input.landFraction === 0)
    return {
      type:
        input.elevationMeters <= -4000
          ? 'deepSea'
          : input.elevationMeters <= -200
            ? 'ocean'
            : input.elevationMeters <= -50
              ? 'shelfWater'
              : 'coastalWater',
      modifiers: [],
    };
  const type =
    (
      {
        grassland: 'temperateGrassland',
        forest: 'temperateMixedForest',
        shrubland: 'steppe',
        desert: 'desert',
        wetland: 'wetland',
        cropland: 'cropland',
        settlement: 'settlement',
        snowIce: 'tundra',
        highland: 'bareRock',
        mountain: 'bareRock',
        coast: 'sandCoast',
        shallowWater: 'coastalWater',
        deepWater: 'ocean',
      } as const
    )[input.terrain] ?? 'bareRock';
  const modifiers: TileModifier[] = input.isCoast ? ['coastal'] : [];
  if (input.elevationMeters >= 4500) modifiers.push('highMountains', 'snowCover');
  else if (input.elevationMeters >= 1500) modifiers.push('mountains');
  else if (input.elevationMeters >= 500) modifiers.push('hills');
  return { type, modifiers };
}
