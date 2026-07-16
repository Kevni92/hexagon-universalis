import type { Vector3 } from '@/topology/geodesic';
import type { MountainRange } from './mountainStructure';

export const PROCEDURAL_CLIMATE_VERSION = 1 as const;

export const PROCEDURAL_CLIMATE_THRESHOLDS = {
  maxDistanceHops: 12,
  temperatureAltitudeFactor: 0.34,
  temperaturePolarFactor: 0.32,
  temperatureWaterModeration: 0.025,
  moistureRawFactor: 0.42,
  moistureCoastFactor: 0.13,
  moistureWaterFactor: 0.12,
  moistureCatchmentFactor: 0.1,
  moistureOrographicFactor: 0.08,
  moistureRainShadowFactor: 0.24,
  moistureInlandBasinPenalty: 0.14,
  wetlandMoisture: 0.68,
  rainforestTemperature: 0.72,
  rainforestMoisture: 0.54,
  forestMoisture: 0.48,
  borealMoisture: 0.48,
  desertMoisture: 0.32,
  semiDesertMoisture: 0.42,
} as const;

export interface ClimateCellInput {
  readonly cellId: string;
  readonly center: Vector3;
  readonly neighborIds: readonly string[];
  readonly elevation: number;
  readonly surface: 'land' | 'water';
  readonly macroRegion: 'continent' | 'island' | 'ocean' | 'ocean-basin';
  readonly isInlandBasin: boolean;
  readonly mountainRangeId: string | null;
  readonly mountainInfluence: number;
  readonly rawTemperature: number;
  readonly rawMoisture: number;
  readonly flowAccumulation: number;
  readonly waterFeature: 'land' | 'ocean' | 'lake';
  readonly isLakeOutlet: boolean;
}

export interface ClimateCellResult {
  readonly temperature: number;
  readonly moisture: number;
  readonly coastDistance: number;
  readonly waterProximity: number;
  readonly rainShadow: number;
}

export interface ProceduralClimateDiagnostics {
  readonly version: typeof PROCEDURAL_CLIMATE_VERSION;
  readonly thresholds: typeof PROCEDURAL_CLIMATE_THRESHOLDS;
  readonly cellCount: number;
  readonly meanTemperature: number;
  readonly meanMoisture: number;
  readonly wetClimateCells: number;
  readonly rainShadowCells: number;
  readonly lakeCells: number;
  readonly outletCells: number;
  readonly biomeCounts: Readonly<Record<string, number>>;
}

export interface ProceduralClimateResult {
  readonly cells: ReadonlyMap<string, ClimateCellResult>;
  readonly diagnostics: ProceduralClimateDiagnostics;
}

/**
 * Leitet Klima ausschließlich aus stabilen Weltkoordinaten und Weltfeldern ab.
 * Nachbarschaftsdistanzen werden nur für Wasserzugang verwendet; dadurch bleiben
 * die Werte bei wechselnder LOD-Auflösung an gemeinsamen Referenzproben gleich.
 */
export function deriveProceduralClimate(
  seed: string,
  cells: readonly ClimateCellInput[],
  mountainRanges: readonly MountainRange[],
): ProceduralClimateResult {
  if (seed.length === 0) throw new RangeError('Klima-Seed darf nicht leer sein.');
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const coastDistanceHops = distanceFrom(cells, (cell) => cell.surface === 'water');
  const waterDistanceHops = distanceFrom(
    cells,
    (cell) => cell.surface === 'water' || cell.waterFeature === 'lake',
  );
  const maxAccumulation = Math.max(...cells.map((cell) => cell.flowAccumulation), 1);
  const results = new Map<string, ClimateCellResult>();

  for (const cell of cells) {
    const coastDistance = normalizedDistance(coastDistanceHops.get(cell.cellId));
    const waterProximity = 1 - normalizedDistance(waterDistanceHops.get(cell.cellId));
    const coastalInfluence = 1 - coastDistance;
    const catchmentWetness =
      cell.surface === 'land' ? Math.log1p(cell.flowAccumulation) / Math.log1p(maxAccumulation) : 0;
    const range = mountainRanges.find((candidate) => candidate.id === cell.mountainRangeId);
    const windward =
      range === undefined ? 0 : clamp(0.5 + dot(cell.center, range.normal) * 1.25, 0, 1);
    const orographicLift = cell.mountainInfluence * windward;
    const rainShadow = clamp(cell.mountainInfluence * (1 - windward) * 0.9, 0, 1);
    const latitude = Math.abs(cell.center.y);
    const elevationCooling =
      Math.max(cell.elevation, 0) * PROCEDURAL_CLIMATE_THRESHOLDS.temperatureAltitudeFactor;
    const polarCooling =
      Math.max(0, latitude - 0.62) * PROCEDURAL_CLIMATE_THRESHOLDS.temperaturePolarFactor;
    const temperature = clamp(
      cell.rawTemperature -
        elevationCooling -
        polarCooling +
        waterProximity * PROCEDURAL_CLIMATE_THRESHOLDS.temperatureWaterModeration,
      0,
      1,
    );
    const inlandBasinPenalty =
      cell.isInlandBasin && waterProximity < 0.35
        ? PROCEDURAL_CLIMATE_THRESHOLDS.moistureInlandBasinPenalty
        : 0;
    const moisture = clamp(
      cell.rawMoisture * PROCEDURAL_CLIMATE_THRESHOLDS.moistureRawFactor +
        coastalInfluence * PROCEDURAL_CLIMATE_THRESHOLDS.moistureCoastFactor +
        waterProximity * PROCEDURAL_CLIMATE_THRESHOLDS.moistureWaterFactor +
        catchmentWetness * PROCEDURAL_CLIMATE_THRESHOLDS.moistureCatchmentFactor +
        orographicLift * PROCEDURAL_CLIMATE_THRESHOLDS.moistureOrographicFactor -
        rainShadow * PROCEDURAL_CLIMATE_THRESHOLDS.moistureRainShadowFactor -
        inlandBasinPenalty,
      0,
      1,
    );
    results.set(cell.cellId, {
      temperature: round(temperature),
      moisture: round(moisture),
      coastDistance: round(coastDistance),
      waterProximity: round(waterProximity),
      rainShadow: round(rainShadow),
    });
  }

  const values = [...results.values()];
  const diagnostics: ProceduralClimateDiagnostics = {
    version: PROCEDURAL_CLIMATE_VERSION,
    thresholds: PROCEDURAL_CLIMATE_THRESHOLDS,
    cellCount: cells.length,
    meanTemperature: round(average(values.map((value) => value.temperature))),
    meanMoisture: round(average(values.map((value) => value.moisture))),
    wetClimateCells: values.filter((value) => value.moisture >= 0.58).length,
    rainShadowCells: values.filter((value) => value.rainShadow >= 0.25).length,
    lakeCells: cells.filter((cell) => cell.waterFeature === 'lake').length,
    outletCells: cells.filter((cell) => cell.isLakeOutlet).length,
    biomeCounts: {},
  };
  return { cells: results, diagnostics };

  function distanceFrom(
    sourceCells: readonly ClimateCellInput[],
    isSource: (cell: ClimateCellInput) => boolean,
  ): Map<string, number> {
    const distances = new Map<string, number>();
    const queue: string[] = [];
    for (const source of sourceCells) {
      if (!isSource(source)) continue;
      distances.set(source.cellId, 0);
      queue.push(source.cellId);
    }
    for (let index = 0; index < queue.length; index += 1) {
      const cellId = queue[index];
      if (cellId === undefined) continue;
      const cell = cellsById.get(cellId);
      if (cell === undefined) continue;
      const nextDistance = (distances.get(cellId) ?? 0) + 1;
      for (const neighborId of [...cell.neighborIds].sort()) {
        if (distances.has(neighborId)) continue;
        distances.set(neighborId, nextDistance);
        queue.push(neighborId);
      }
    }
    return distances;
  }
}

function normalizedDistance(distance: number | undefined): number {
  return Math.min(
    1,
    (distance ?? PROCEDURAL_CLIMATE_THRESHOLDS.maxDistanceHops) /
      PROCEDURAL_CLIMATE_THRESHOLDS.maxDistanceHops,
  );
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function round(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
