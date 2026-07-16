import type { Vector3 } from '@/topology/geodesic';
import { hashText } from './seededNoise';
import type { ProceduralMacroRegion, ProceduralSurface } from './proceduralWorld';

export type ProceduralWaterFeature = 'land' | 'ocean' | 'lake';

export interface HydrologyCellInput {
  readonly cellId: string;
  readonly center: Vector3;
  readonly neighborIds: readonly string[];
  readonly elevation: number;
  readonly surface: ProceduralSurface;
  readonly macroRegion: ProceduralMacroRegion;
  readonly isInlandBasin: boolean;
}

export interface HydrologyCellResult {
  readonly flowToCellId: string | null;
  readonly catchmentId: string | null;
  readonly flowAccumulation: number;
  readonly waterFeature: ProceduralWaterFeature;
  readonly lakeId: string | null;
  readonly lakeLevel: number | null;
  readonly isLakeOutlet: boolean;
}

export interface ProceduralLake {
  readonly lakeId: string;
  readonly sinkCellId: string;
  readonly cellIds: readonly string[];
  readonly areaCells: number;
  readonly waterLevel: number;
  readonly outletCellId: string | null;
  readonly endorheic: boolean;
}

export interface HydrologyResult {
  readonly cells: ReadonlyMap<string, HydrologyCellResult>;
  readonly lakes: readonly ProceduralLake[];
}

const MIN_LAKE_CELLS = 3;
const LAKE_LEVEL_OFFSET = 0.11;

/**
 * Berechnet deterministische Abflusskanten und Senkenseen über den fachlichen
 * Nachbarschaften. Es gibt keine globale Rasterprojektion und keinen Zufall.
 */
export function deriveHydrology(
  seed: string,
  cells: readonly HydrologyCellInput[],
): HydrologyResult {
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const flowTo = new Map<string, string | null>();
  for (const cell of cells) {
    if (cell.surface === 'water') {
      flowTo.set(cell.cellId, null);
      continue;
    }
    const lowerNeighbors = cell.neighborIds
      .map((neighborId) => cellsById.get(neighborId))
      .filter(
        (neighbor): neighbor is HydrologyCellInput =>
          neighbor !== undefined && neighbor.elevation < cell.elevation - 0.000001,
      )
      .sort(
        (first, second) =>
          first.elevation - second.elevation || first.cellId.localeCompare(second.cellId),
      );
    flowTo.set(cell.cellId, lowerNeighbors[0]?.cellId ?? null);
  }

  const accumulation = new Map<string, number>();
  for (const cell of cells) if (cell.surface === 'land') accumulation.set(cell.cellId, 1);
  const descending = cells
    .filter((cell) => cell.surface === 'land')
    .sort(
      (first, second) =>
        second.elevation - first.elevation || first.cellId.localeCompare(second.cellId),
    );
  for (const cell of descending) {
    const targetId = flowTo.get(cell.cellId);
    if (targetId === null || targetId === undefined) continue;
    const target = cellsById.get(targetId);
    if (target?.surface !== 'land') continue;
    accumulation.set(
      targetId,
      (accumulation.get(targetId) ?? 1) + (accumulation.get(cell.cellId) ?? 1),
    );
  }

  const terminalCache = new Map<string, string | null>();
  const terminalFor = (cellId: string): string | null => {
    const cached = terminalCache.get(cellId);
    if (cached !== undefined) return cached;
    const targetId = flowTo.get(cellId);
    if (targetId === undefined || targetId === null) {
      terminalCache.set(cellId, cellId);
      return cellId;
    }
    const target = cellsById.get(targetId);
    const terminal = target?.surface === 'land' ? terminalFor(targetId) : null;
    terminalCache.set(cellId, terminal);
    return terminal;
  };

  const sinkGroups = new Map<string, string[]>();
  for (const cell of cells) {
    if (cell.surface !== 'land') continue;
    const sinkId = terminalFor(cell.cellId);
    if (sinkId === null) continue;
    const group = sinkGroups.get(sinkId) ?? [];
    group.push(cell.cellId);
    sinkGroups.set(sinkId, group);
  }

  // Makrobecken können über eine flache Schwelle bereits zum Ozean entwässern.
  // Ihre tiefsten zusammenhängenden Landnachbarn bleiben trotzdem gültige
  // lokale See-Kandidaten und verhindern, dass Hydrologie nur von einem
  // zufälligen Einzel-Senkenpunkt abhängt.
  for (const cell of cells) {
    if (cell.surface !== 'land' || !cell.isInlandBasin || sinkGroups.has(cell.cellId)) continue;
    const basinGroup = [
      cell,
      ...cell.neighborIds
        .map((neighborId) => cellsById.get(neighborId))
        .filter(
          (neighbor): neighbor is HydrologyCellInput =>
            neighbor !== undefined && neighbor.surface === 'land',
        ),
    ]
      .sort(
        (first, second) =>
          first.elevation - second.elevation || first.cellId.localeCompare(second.cellId),
      )
      .map((candidate) => candidate.cellId);
    sinkGroups.set(cell.cellId, basinGroup);
  }

  const lakes: ProceduralLake[] = [];
  const lakeByCell = new Map<string, { lake: ProceduralLake; level: number }>();
  for (const [sinkId, group] of sinkGroups) {
    const sink = cellsById.get(sinkId);
    if (sink === undefined || !sink.isInlandBasin || group.length < MIN_LAKE_CELLS) continue;
    let waterLevel = Math.min(1, sink.elevation + LAKE_LEVEL_OFFSET);
    let flooded = group
      .map((cellId) => cellsById.get(cellId))
      .filter(
        (cell): cell is HydrologyCellInput => cell !== undefined && cell.elevation <= waterLevel,
      )
      .sort(
        (first, second) =>
          first.elevation - second.elevation || first.cellId.localeCompare(second.cellId),
      );
    if (flooded.length < MIN_LAKE_CELLS) {
      const sortedGroup = group
        .map((cellId) => cellsById.get(cellId))
        .filter((cell): cell is HydrologyCellInput => cell !== undefined)
        .sort(
          (first, second) =>
            first.elevation - second.elevation || first.cellId.localeCompare(second.cellId),
        );
      const third = sortedGroup[MIN_LAKE_CELLS - 1];
      if (third === undefined) continue;
      waterLevel = Math.min(1, Math.max(waterLevel, third.elevation + 0.005));
      flooded = sortedGroup.slice(0, MIN_LAKE_CELLS);
    }
    const lakeId = stableLakeId(seed, sink.center);
    const floodedIds = flooded.map((cell) => cell.cellId);
    if (floodedIds.some((cellId) => lakeByCell.has(cellId))) continue;
    const floodedSet = new Set(floodedIds);
    const outlet = flooded
      .flatMap((cell) => cell.neighborIds.map((neighborId) => cellsById.get(neighborId)))
      .filter(
        (cell): cell is HydrologyCellInput =>
          cell !== undefined &&
          cell.surface === 'land' &&
          !floodedSet.has(cell.cellId) &&
          cell.elevation >= waterLevel,
      )
      .sort(
        (first, second) =>
          first.elevation - second.elevation || first.cellId.localeCompare(second.cellId),
      )[0];
    const lake: ProceduralLake = {
      lakeId,
      sinkCellId: sinkId,
      cellIds: floodedIds,
      areaCells: floodedIds.length,
      waterLevel,
      outletCellId: outlet?.cellId ?? null,
      endorheic: outlet === undefined,
    };
    lakes.push(lake);
    for (const cellId of floodedIds) lakeByCell.set(cellId, { lake, level: waterLevel });
  }

  lakes.sort((first, second) => first.lakeId.localeCompare(second.lakeId));
  const result = new Map<string, HydrologyCellResult>();
  for (const cell of cells) {
    if (cell.surface === 'water') {
      result.set(cell.cellId, {
        flowToCellId: null,
        catchmentId: null,
        flowAccumulation: 0,
        waterFeature: 'ocean',
        lakeId: null,
        lakeLevel: null,
        isLakeOutlet: false,
      });
      continue;
    }
    const lake = lakeByCell.get(cell.cellId);
    const sinkId = terminalFor(cell.cellId);
    const lakeId = lake?.lake.lakeId ?? null;
    const terminal = sinkId === null ? (flowTo.get(cell.cellId) ?? null) : sinkId;
    result.set(cell.cellId, {
      flowToCellId: flowTo.get(cell.cellId) ?? null,
      catchmentId: lakeId ?? (terminal === null ? null : `catchment-${terminal}`),
      flowAccumulation: accumulation.get(cell.cellId) ?? 1,
      waterFeature: lake === undefined ? 'land' : 'lake',
      lakeId,
      lakeLevel: lake?.level ?? null,
      isLakeOutlet: lake?.lake.outletCellId === cell.cellId,
    });
  }
  return { cells: result, lakes };
}

function stableLakeId(seed: string, center: Vector3): string {
  const key = [center.x, center.y, center.z].map((value) => Math.round(value * 12)).join(':');
  return `lake-${hashText(`${seed}:lake:${key}`)}`;
}
