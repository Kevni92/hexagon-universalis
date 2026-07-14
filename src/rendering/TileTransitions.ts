import type { TileModifier, TileType } from '@/data/tileCatalog';
import { TILE_PROFILES } from '@/data/tileCatalog';
import type { DetailInstance, DetailType } from './TileDetails';

export type TransitionCompatibility = 'compatible' | 'limited' | 'excluded';
export type TransitionLod = 0 | 1 | 2 | 3;

export interface TransitionCell {
  readonly cellId: string;
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
  readonly elevationMeters: number;
  readonly landFraction: number;
}

export interface SharedEdge2d {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

export interface TransitionProfile {
  readonly edgeId: string;
  readonly compatibility: TransitionCompatibility;
  readonly sourceCellId: string;
  readonly targetCellId: string;
  readonly detailType: DetailType | null;
  readonly density: number;
  readonly reason: string;
}

export interface TransitionDetail extends DetailInstance {
  readonly edgeId: string;
  readonly ownerCellId: string;
}

const WATER = new Set<TileType>(['deepSea', 'ocean', 'shelfWater', 'coastalWater', 'iceWater']);
const FOREST = new Set<TileType>([
  'temperateMixedForest',
  'borealForest',
  'tundraWoodland',
  'mediterraneanWoodland',
  'tropicalRainforest',
  'tropicalDryForest',
  'subtropicalForest',
  'mangrove',
]);
const OPEN_LAND = new Set<TileType>(['temperateGrassland', 'cropland', 'savanna', 'steppe']);
const LOD_BUDGET: Readonly<Record<TransitionLod, number>> = { 0: 0, 1: 2, 2: 6, 3: 10 };

export function transitionEdgeId(firstCellId: string, secondCellId: string): string {
  return [firstCellId, secondCellId].sort().join('::');
}

/** Eine gemeinsame Kante wird genau durch die lexikografisch erste Zell-ID geplant. */
export function ownsTransitionEdge(cellId: string, neighborCellId: string): boolean {
  return cellId.localeCompare(neighborCellId) < 0;
}

export function createTransitionProfile(
  source: TransitionCell,
  target: TransitionCell,
): TransitionProfile {
  const edgeId = transitionEdgeId(source.cellId, target.cellId);
  const excluded = exclusionReason(source, target);
  if (excluded !== null) return profile(edgeId, source, target, 'excluded', null, 0, excluded);

  if (FOREST.has(source.tileType) && OPEN_LAND.has(target.tileType))
    return profile(
      edgeId,
      source,
      target,
      'compatible',
      primaryDetail(source.tileType),
      1,
      'forest-open-land',
    );
  if (source.tileType === 'borealForest' && ['tundra', 'tundraWoodland'].includes(target.tileType))
    return profile(edgeId, source, target, 'limited', 'lowConifer', 0.65, 'taiga-tundra');
  if (
    (source.tileType === 'temperateGrassland' && target.tileType === 'steppe') ||
    (source.tileType === 'steppe' && target.tileType === 'semiDesert')
  )
    return profile(edgeId, source, target, 'limited', 'grass', 0.55, 'grass-arid');
  if (source.tileType === 'desert' && ['semiDesert', 'bareRock'].includes(target.tileType))
    return profile(edgeId, source, target, 'limited', 'rock', 0.55, 'desert-rock');
  if (isMountain(source) && !isMountain(target))
    return profile(edgeId, source, target, 'limited', 'rock', 0.7, 'mountain-foothill');
  if (isSnow(source) && (isMountain(target) || target.tileType === 'tundra'))
    return profile(edgeId, source, target, 'limited', 'ice', 0.45, 'snow-alpine');
  if (
    source.tileType === 'wetland' &&
    (OPEN_LAND.has(target.tileType) || FOREST.has(target.tileType))
  )
    return profile(edgeId, source, target, 'compatible', 'lowShrub', 0.7, 'wetland-margin');
  return profile(edgeId, source, target, 'limited', null, 0, 'no-detail-rule');
}

/**
 * Erzeugt Punkte in einem inneren Randband der Zielzelle. Die Kante muss in
 * lokalen Zielzellkoordinaten liegen; der Zellmittelpunkt ist (0, 0).
 */
export function createEdgeTransitionDetails(
  source: TransitionCell,
  target: TransitionCell,
  edge: SharedEdge2d,
  lod: TransitionLod,
): readonly TransitionDetail[] {
  const transition = createTransitionProfile(source, target);
  if (transition.detailType === null || transition.compatibility === 'excluded') return [];
  const count = Math.min(LOD_BUDGET[lod], Math.round(LOD_BUDGET[lod] * transition.density));
  return Array.from({ length: count }, (_, index) => {
    const hash = stableHash(`${transition.edgeId}:${target.cellId}:${lod}:${index}`);
    const along = 0.15 + (hash % 700) / 1000;
    const edgeX = edge.start.x + (edge.end.x - edge.start.x) * along;
    const edgeY = edge.start.y + (edge.end.y - edge.start.y) * along;
    const inward = 0.1 + ((hash >>> 10) % 120) / 1000;
    return {
      edgeId: transition.edgeId,
      ownerCellId: target.cellId,
      detailType: transition.detailType as DetailType,
      index,
      x: edgeX * (1 - inward),
      y: edgeY * (1 - inward),
      rotation: ((hash >>> 20) % 628) / 100,
      scale: 0.65 + ((hash >>> 4) % 45) / 100,
    };
  });
}

export function transitionDetailBudget(lod: TransitionLod): number {
  return LOD_BUDGET[lod];
}

function exclusionReason(source: TransitionCell, target: TransitionCell): string | null {
  if (WATER.has(target.tileType)) return 'no-vegetation-in-water';
  if (target.modifiers.includes('glacier')) return 'no-details-on-glacier';
  if (
    (source.tileType === 'desert' && isSnow(target)) ||
    (target.tileType === 'desert' && isSnow(source))
  )
    return 'desert-ice-incompatible';
  return null;
}

function isMountain(cell: TransitionCell): boolean {
  return (
    cell.tileType === 'bareRock' ||
    cell.modifiers.includes('mountains') ||
    cell.modifiers.includes('highMountains')
  );
}

function isSnow(cell: TransitionCell): boolean {
  return (
    cell.tileType === 'iceWater' ||
    cell.modifiers.includes('snowCover') ||
    cell.modifiers.includes('glacier')
  );
}

function primaryDetail(tileType: TileType): DetailType {
  return (TILE_PROFILES[tileType].details[0] ?? 'tree') as DetailType;
}

function profile(
  edgeId: string,
  source: TransitionCell,
  target: TransitionCell,
  compatibility: TransitionCompatibility,
  detailType: DetailType | null,
  density: number,
  reason: string,
): TransitionProfile {
  return {
    edgeId,
    compatibility,
    sourceCellId: source.cellId,
    targetCellId: target.cellId,
    detailType,
    density,
    reason,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
