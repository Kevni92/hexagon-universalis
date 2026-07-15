import { TILE_PROFILES, type TileModifier, type TileType } from '@/data/tileCatalog';
import type { Vector3 } from '@/topology/geodesic';
import type { ProceduralWorldCell } from '@/world/proceduralWorld';
import type { ProceduralWorldLodLevel } from '@/world/proceduralWorldLod';

import { elevationToRadius, type ReliefProfile } from './Relief';

export const PROCEDURAL_RELIEF_PROFILE: ReliefProfile = {
  mode: 'game',
  baseRadius: 1,
  maxLandElevationMeters: 9000,
  maxOceanDepthMeters: 11000,
  maxLandLift: 0.065,
  maxOceanDrop: 0.018,
};

const LOD_SURFACE_OFFSET: Readonly<Record<ProceduralWorldLodLevel, number>> = {
  global: 0,
  regional: 0.003,
  local: 0.006,
};

const FOREST_TYPES = new Set<TileType>([
  'temperateMixedForest',
  'borealForest',
  'tundraWoodland',
  'mediterraneanWoodland',
  'tropicalRainforest',
  'tropicalDryForest',
  'subtropicalForest',
  'mangrove',
]);
const WATER_TYPES = new Set<TileType>([
  'deepSea',
  'ocean',
  'shelfWater',
  'coastalWater',
  'iceWater',
]);
const OPEN_LAND_TYPES = new Set<TileType>(['temperateGrassland', 'steppe', 'savanna']);
const DRY_TYPES = new Set<TileType>(['desert', 'semiDesert']);

export interface ProceduralTerrainDiagnostics {
  readonly terrainTypes: readonly TileType[];
  readonly reliefBands: readonly ProceduralWorldCell['relief'][];
  readonly groups: readonly string[];
  readonly minimumRadius: number;
  readonly maximumRadius: number;
}

export function proceduralElevationMeters(elevation: number): number {
  if (!Number.isFinite(elevation)) throw new RangeError('Prozedurale Höhe muss endlich sein.');
  const clamped = Math.min(1, Math.max(-1, elevation));
  return clamped >= 0 ? clamped * 9000 : clamped * 11000;
}

export function proceduralSurfaceRadius(
  elevation: number,
  level: ProceduralWorldLodLevel,
): number {
  return (
    elevationToRadius(proceduralElevationMeters(elevation), PROCEDURAL_RELIEF_PROFILE) +
    LOD_SURFACE_OFFSET[level]
  );
}

export function proceduralTileColor(cell: Pick<ProceduralWorldCell, 'tileType' | 'modifiers'>): string {
  let color = TILE_PROFILES[cell.tileType].color;
  if (cell.modifiers.includes('glacier')) return blendHex(color, '#e5f8ff', 0.78);
  if (cell.modifiers.includes('snowCover')) color = blendHex(color, '#f1f5f2', 0.58);
  if (cell.modifiers.includes('highMountains')) color = blendHex(color, '#d7d2c8', 0.34);
  else if (cell.modifiers.includes('mountains')) color = blendHex(color, '#a49c8e', 0.2);
  else if (cell.modifiers.includes('hills')) color = blendHex(color, '#6f765b', 0.1);
  if (cell.modifiers.includes('wet')) color = blendHex(color, '#245f58', 0.18);
  return color;
}

export function proceduralTerrainDiagnostics(
  cells: readonly ProceduralWorldCell[],
): ProceduralTerrainDiagnostics {
  const terrainTypes = [...new Set(cells.map((cell) => cell.tileType))].sort();
  const reliefBands = [...new Set(cells.map((cell) => cell.relief))].sort();
  const groups = new Set<string>();
  for (const cell of cells) {
    if (WATER_TYPES.has(cell.tileType)) groups.add('water');
    if (cell.isCoast || cell.modifiers.includes('coastal')) groups.add('coast');
    if (OPEN_LAND_TYPES.has(cell.tileType)) groups.add('open-land');
    if (FOREST_TYPES.has(cell.tileType)) groups.add('forest');
    if (DRY_TYPES.has(cell.tileType)) groups.add('dry');
    if (
      cell.tileType === 'tundra' ||
      cell.tileType === 'tundraWoodland' ||
      cell.tileType === 'iceWater' ||
      cell.modifiers.includes('snowCover') ||
      cell.modifiers.includes('glacier')
    )
      groups.add('cold');
    if (cell.tileType === 'wetland' || cell.tileType === 'mangrove') groups.add('wetland');
    groups.add(reliefGroup(cell.relief));
  }
  const radii = cells.map((cell) => proceduralSurfaceRadius(cell.elevation, 'global'));
  return {
    terrainTypes,
    reliefBands,
    groups: [...groups].sort(),
    minimumRadius: Math.min(...radii),
    maximumRadius: Math.max(...radii),
  };
}

export function normalizeDirection(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Richtung muss endlich sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function reliefGroup(relief: ProceduralWorldCell['relief']): string {
  return (
    {
      deepSea: 'deep-sea',
      oceanFloor: 'ocean-floor',
      shallowWater: 'shallow-water',
      lowland: 'lowland',
      hills: 'hills',
      mountains: 'mountains',
      highMountains: 'high-mountains',
    } as const
  )[relief];
}

function blendHex(first: string, second: string, amount: number): string {
  const left = parseHex(first);
  const right = parseHex(second);
  const channel = (index: number): number =>
    Math.round(left[index]! + (right[index]! - left[index]!) * amount);
  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseHex(color: string): readonly [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new RangeError(`Ungültige Hex-Farbe: ${color}.`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}
