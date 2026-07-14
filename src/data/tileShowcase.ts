import type { GeodesicTopology } from '@/topology/geodesic';
import { TILE_TYPES, type TileModifier, type TileType } from '@/data/tileCatalog';
import { tileDetailProfile } from './tileShowcaseProfiles';

export interface ShowcaseCell {
  readonly cellId: string;
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
}
export interface TileShowcaseWorld {
  readonly isRealEarth: false;
  readonly label: 'Tile-Demo – keine reale Erde';
  readonly frequency: number;
  readonly cells: readonly ShowcaseCell[];
  readonly counts: ReadonlyMap<TileType, number>;
}

export function createTileShowcaseWorld(
  topology: GeodesicTopology,
  tileTypes: readonly TileType[] = TILE_TYPES,
): TileShowcaseWorld {
  if (tileTypes.length === 0 || topology.cells.length < tileTypes.length)
    throw new RangeError(
      'Die Showcase-Zellzahl muss mindestens so groß wie die Tile-Typenliste sein.',
    );
  const cells = topology.cells.map((cell, index) => {
    const type = tileTypes[index % tileTypes.length];
    if (type === undefined) throw new Error('Showcase-Typ fehlt.');
    return { cellId: cell.id, tileType: type, modifiers: tileDetailProfile(type, index) };
  });
  const counts = new Map<TileType, number>(tileTypes.map((type) => [type, 0]));
  for (const cell of cells) counts.set(cell.tileType, (counts.get(cell.tileType) ?? 0) + 1);
  return {
    isRealEarth: false,
    label: 'Tile-Demo – keine reale Erde',
    frequency: topology.frequency,
    cells,
    counts,
  };
}
