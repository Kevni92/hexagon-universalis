import type { TileModifier, TileType } from '@/data/tileCatalog';
import { TILE_PROFILES } from '@/data/tileCatalog';

export type DetailType =
  | 'deciduousTree'
  | 'conifer'
  | 'lowConifer'
  | 'tropicalTree'
  | 'tree'
  | 'shrub'
  | 'lowShrub'
  | 'lowTree'
  | 'rock'
  | 'grass'
  | 'building'
  | 'ice';
export interface DetailInstance {
  readonly detailType: DetailType;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}
export interface DetailInput {
  readonly cellId: string;
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
  readonly count?: number;
}

const EXCLUDED_TYPES = new Set<TileType>([
  'deepSea',
  'ocean',
  'shelfWater',
  'coastalWater',
  'iceWater',
  'bareRock',
]);

export function createTileDetails(input: DetailInput): readonly DetailInstance[] {
  const profile = TILE_PROFILES[input.tileType];
  const count = input.count ?? 4;
  if (!Number.isInteger(count) || count < 0 || count > 100)
    throw new RangeError('Detailanzahl muss zwischen 0 und 100 liegen.');
  if (
    EXCLUDED_TYPES.has(input.tileType) ||
    input.modifiers.includes('glacier') ||
    input.modifiers.includes('highMountains')
  )
    return [];
  const detailType = profile.details[0] as DetailType | undefined;
  if (detailType === undefined) return [];
  return Array.from({ length: count }, (_, index) => {
    const hash = stableHash(`${input.cellId}:${input.tileType}:${detailType}:${index}`);
    return {
      detailType,
      index,
      x: ((hash % 1000) / 1000 - 0.5) * 0.7,
      y: (((hash >>> 10) % 1000) / 1000 - 0.5) * 0.7,
      rotation: ((hash >>> 20) % 628) / 100,
      scale: 0.7 + ((hash >>> 4) % 60) / 100,
    };
  });
}

export function detailTypeBudgets(): Readonly<Record<DetailType, number>> {
  return {
    deciduousTree: 200,
    conifer: 200,
    lowConifer: 150,
    tropicalTree: 300,
    tree: 200,
    shrub: 250,
    lowShrub: 250,
    lowTree: 150,
    rock: 200,
    grass: 500,
    building: 100,
    ice: 150,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
