import type { TileModifier, TileType } from '../data/tileCatalog';
import {
  createGeodesicTopology,
  type CellType,
  type GeodesicTopology,
  type Vector3,
} from '../topology/geodesic';
import { createSeededNoise3D, hashText } from './seededNoise';
import { ContinentalStructure, type ContinentalStructureDiagnostics } from './continentalStructure';
import { MountainStructure, type MountainStructureDiagnostics } from './mountainStructure';
import { deriveHydrology, type ProceduralLake, type ProceduralWaterFeature } from './hydrology';

export const PROCEDURAL_WORLD_FORMAT_VERSION = 1 as const;
export const PROCEDURAL_WORLD_GENERATOR_VERSION = '1.1.0';

export type ProceduralDensityProfileId = 'low' | 'standard' | 'high' | 'ultra';

export interface ProceduralDensityProfile {
  readonly id: ProceduralDensityProfileId;
  readonly frequency: number;
  readonly cellCount: number;
}

export const PROCEDURAL_DENSITY_PROFILES: Readonly<
  Record<ProceduralDensityProfileId, ProceduralDensityProfile>
> = {
  low: { id: 'low', frequency: 4, cellCount: 162 },
  standard: { id: 'standard', frequency: 8, cellCount: 642 },
  high: { id: 'high', frequency: 16, cellCount: 2562 },
  ultra: { id: 'ultra', frequency: 16, cellCount: 2562 },
};

export interface ProceduralWorldConfig {
  readonly seed: string;
  readonly density: ProceduralDensityProfileId;
  readonly landFraction: number;
  readonly continentScale: number;
  readonly elevationVariation: number;
  readonly climateScale: number;
  readonly mountainStrength: number;
}

export const DEFAULT_PROCEDURAL_WORLD_CONFIG: ProceduralWorldConfig = {
  seed: 'hexagon-universalis',
  density: 'standard',
  landFraction: 0.38,
  continentScale: 1.35,
  elevationVariation: 0.32,
  climateScale: 2.4,
  mountainStrength: 0.42,
};

export type ProceduralSurface = 'land' | 'water';
export type ProceduralReliefBand =
  'deepSea' | 'oceanFloor' | 'shallowWater' | 'lowland' | 'hills' | 'mountains' | 'highMountains';
export type ProceduralQualityFlag = 'coast-derived' | 'polar-climate';
export type ProceduralMacroRegion = 'continent' | 'island' | 'ocean' | 'ocean-basin';

export interface ProceduralWorldCell {
  readonly cellId: string;
  readonly center: Vector3;
  readonly neighborIds: readonly string[];
  readonly cellType: CellType;
  readonly elevation: number;
  readonly surface: ProceduralSurface;
  readonly isCoast: boolean;
  readonly temperature: number;
  readonly moisture: number;
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
  readonly relief: ProceduralReliefBand;
  readonly qualityFlags: readonly ProceduralQualityFlag[];
  readonly macroRegion: ProceduralMacroRegion;
  readonly isShelf: boolean;
  readonly isInlandBasin: boolean;
  readonly mountainRangeId: string | null;
  readonly mountainInfluence: number;
  readonly flowToCellId: string | null;
  readonly catchmentId: string | null;
  readonly flowAccumulation: number;
  readonly waterFeature: ProceduralWaterFeature;
  readonly lakeId: string | null;
  readonly lakeLevel: number | null;
  readonly isLakeOutlet: boolean;
}

export interface ProceduralWorld {
  readonly formatVersion: typeof PROCEDURAL_WORLD_FORMAT_VERSION;
  readonly generatorVersion: string;
  readonly config: ProceduralWorldConfig;
  readonly frequency: number;
  readonly cellCount: number;
  readonly fingerprint: string;
  readonly macroStructure: ContinentalStructureDiagnostics;
  readonly mountainStructure: MountainStructureDiagnostics;
  readonly lakes: readonly ProceduralLake[];
  readonly cells: readonly ProceduralWorldCell[];
}

interface RawCellFields {
  readonly cellId: string;
  readonly center: Vector3;
  readonly neighborIds: readonly string[];
  readonly cellType: CellType;
  readonly rawElevation: number;
  readonly rawTemperature: number;
  readonly rawMoisture: number;
  readonly macroRegion: ProceduralMacroRegion;
  readonly macroLandSupport: number;
  readonly basinInfluence: number;
  readonly mountainRangeId: string | null;
  readonly mountainInfluence: number;
  readonly mountainType: string | null;
}

interface ClassifiedCellFields extends RawCellFields {
  readonly elevation: number;
  readonly surface: ProceduralSurface;
  readonly isShelf: boolean;
  readonly isInlandBasin: boolean;
}

export function normalizeProceduralWorldConfig(
  config: Partial<ProceduralWorldConfig> = {},
): ProceduralWorldConfig {
  const normalized: ProceduralWorldConfig = {
    ...DEFAULT_PROCEDURAL_WORLD_CONFIG,
    ...config,
    seed: (config.seed ?? DEFAULT_PROCEDURAL_WORLD_CONFIG.seed).trim(),
  };
  validateProceduralWorldConfig(normalized);
  return normalized;
}

export function createProceduralWorld(
  config: Partial<ProceduralWorldConfig> = {},
): ProceduralWorld {
  const normalized = normalizeProceduralWorldConfig(config);
  const profile = PROCEDURAL_DENSITY_PROFILES[normalized.density];
  return createProceduralWorldFromTopology(normalized, createGeodesicTopology(profile.frequency));
}

/**
 * Erzeugt für experimentelle Ultra-Welten eine feinere fachliche Referenz-
 * probe als die sichtbare Legacy-Dichte. Die Runtime materialisiert weiterhin
 * nur sichtbare Chunks, bekommt aber echte Zwischenhöhen statt mehrfach
 * wiederverwendeter f16-Werte.
 */
export function createProceduralWorldAtFrequency(
  config: Partial<ProceduralWorldConfig>,
  frequency: number,
): ProceduralWorld {
  const normalized = normalizeProceduralWorldConfig(config);
  if (frequency < 1 || !Number.isInteger(frequency))
    throw new RangeError('Referenzfrequenz muss eine positive Ganzzahl sein.');
  return buildProceduralWorld(normalized, createGeodesicTopology(frequency));
}

export function createProceduralWorldFromTopology(
  config: Partial<ProceduralWorldConfig>,
  topology: GeodesicTopology,
): ProceduralWorld {
  const normalized = normalizeProceduralWorldConfig(config);
  const profile = PROCEDURAL_DENSITY_PROFILES[normalized.density];
  if (topology.frequency !== profile.frequency || topology.cells.length !== profile.cellCount)
    throw new RangeError(
      `Topologie passt nicht zum Dichteprofil ${profile.id}: erwartet f=${profile.frequency} mit ${profile.cellCount} Zellen.`,
    );

  return buildProceduralWorld(normalized, topology);
}

function buildProceduralWorld(
  normalized: ProceduralWorldConfig,
  topology: GeodesicTopology,
): ProceduralWorld {
  const macroStructure = new ContinentalStructure(normalized.seed, normalized.continentScale);
  const mountainStructure = new MountainStructure(normalized.seed, macroStructure.diagnostics);
  const rawCells = createRawFields(normalized, topology, macroStructure, mountainStructure);
  const elevationThreshold = quantile(
    rawCells.map((cell) => cell.rawElevation),
    1 - normalized.landFraction,
  );
  const minimumElevation = Math.min(...rawCells.map((cell) => cell.rawElevation));
  const maximumElevation = Math.max(...rawCells.map((cell) => cell.rawElevation));
  const initialSurfaces = new Map(
    rawCells.map(
      (cell) => [cell.cellId, cell.rawElevation >= elevationThreshold ? 'land' : 'water'] as const,
    ),
  );
  const surfaces = removeIsolatedSurfaces(rawCells, initialSurfaces);
  const classified = rawCells.map((cell) => {
    const isLand = surfaces.get(cell.cellId) === 'land';
    return {
      ...cell,
      elevation: round(
        isLand
          ? normalizePositive(cell.rawElevation, elevationThreshold, maximumElevation)
          : -normalizePositive(
              elevationThreshold - cell.rawElevation,
              0,
              elevationThreshold - minimumElevation,
            ),
      ),
      surface: isLand ? 'land' : 'water',
      isShelf:
        Math.abs(cell.rawElevation - elevationThreshold) <= 0.09 &&
        cell.macroLandSupport > elevationThreshold - 0.12,
      isInlandBasin: isLand && cell.basinInfluence >= 0.42 && cell.macroRegion !== 'island',
    } satisfies ClassifiedCellFields;
  });
  const surfacesById = new Map(classified.map((cell) => [cell.cellId, cell.surface]));
  const cells = classified.map((cell) => classifyCell(cell, surfacesById));
  const hydrology = deriveHydrology(
    normalized.seed,
    cells.map((cell) => ({
      cellId: cell.cellId,
      center: cell.center,
      neighborIds: cell.neighborIds,
      elevation: cell.elevation,
      surface: cell.surface,
      macroRegion: cell.macroRegion,
      isInlandBasin: cell.isInlandBasin,
    })),
  );
  const hydrologicCells = cells.map((cell) => ({
    ...cell,
    ...(hydrology.cells.get(cell.cellId) ?? {
      flowToCellId: null,
      catchmentId: null,
      flowAccumulation: 0,
      waterFeature: 'ocean' as const,
      lakeId: null,
      lakeLevel: null,
      isLakeOutlet: false,
    }),
  }));
  const worldWithoutFingerprint = {
    formatVersion: PROCEDURAL_WORLD_FORMAT_VERSION,
    generatorVersion: PROCEDURAL_WORLD_GENERATOR_VERSION,
    config: normalized,
    frequency: topology.frequency,
    cellCount: hydrologicCells.length,
    macroStructure: macroStructure.diagnostics,
    mountainStructure: mountainStructure.diagnostics,
    lakes: hydrology.lakes,
    cells: hydrologicCells,
  };
  return {
    ...worldWithoutFingerprint,
    fingerprint: fingerprintWorld(worldWithoutFingerprint),
  };
}

export function validateProceduralWorldConfig(config: ProceduralWorldConfig): void {
  if (config.seed.length < 1 || config.seed.length > 128)
    throw new RangeError('Seed muss zwischen 1 und 128 Zeichen lang sein.');
  if (!Object.hasOwn(PROCEDURAL_DENSITY_PROFILES, config.density))
    throw new RangeError(`Unbekanntes Dichteprofil: ${String(config.density)}.`);
  assertRange(config.landFraction, 0.2, 0.75, 'Landanteil');
  assertRange(config.continentScale, 0.5, 4, 'Kontinent-Skalierung');
  assertRange(config.elevationVariation, 0, 1, 'Höhenvariation');
  assertRange(config.climateScale, 0.5, 8, 'Klima-Skalierung');
  assertRange(config.mountainStrength, 0, 1, 'Gebirgsstärke');
}

function removeIsolatedSurfaces(
  cells: readonly RawCellFields[],
  surfaces: ReadonlyMap<string, ProceduralSurface>,
): Map<string, ProceduralSurface> {
  const repaired = new Map(surfaces);
  for (const cell of cells) {
    const surface = repaired.get(cell.cellId);
    if (surface === undefined) continue;
    if (cell.neighborIds.some((neighborId) => repaired.get(neighborId) === surface)) continue;
    repaired.set(cell.cellId, surface === 'land' ? 'water' : 'land');
  }
  return repaired;
}

function createRawFields(
  config: ProceduralWorldConfig,
  topology: GeodesicTopology,
  structure: ContinentalStructure,
  mountainStructure: MountainStructure,
): RawCellFields[] {
  const continentNoise = createSeededNoise3D(`${config.seed}:continent`);
  const detailNoise = createSeededNoise3D(`${config.seed}:detail`);
  const ridgeNoise = createSeededNoise3D(`${config.seed}:ridge`);
  const temperatureNoise = createSeededNoise3D(`${config.seed}:temperature`);
  const moistureNoise = createSeededNoise3D(`${config.seed}:moisture`);
  const coastNoise = createSeededNoise3D(`${config.seed}:coast-shape`);

  return [...topology.cells]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((cell) => {
      const { x, y, z } = cell.center;
      const macro = structure.sample(cell.center);
      const mountain = mountainStructure.sample(cell.center, macro.landSupport);
      const continent = continentNoise.fbm(
        x * config.continentScale,
        y * config.continentScale,
        z * config.continentScale,
        5,
        2.05,
        0.52,
      );
      const detail = detailNoise.fbm(
        x * config.continentScale * 3.7,
        y * config.continentScale * 3.7,
        z * config.continentScale * 3.7,
        4,
        2.1,
        0.48,
      );
      const ridgeSample = ridgeNoise.fbm(
        x * config.continentScale * 2.2,
        y * config.continentScale * 2.2,
        z * config.continentScale * 2.2,
        4,
        2,
        0.5,
      );
      const ridge = Math.pow(1 - Math.abs(ridgeSample), 3);
      const latitudePenalty = Math.abs(y) * 0.06;
      const macroVariation = coastNoise.fbm(x * 2.7, y * 2.7, z * 2.7, 3, 2.05, 0.5) * 0.12;
      const rawElevation =
        macro.landSupport * 0.88 +
        macroVariation +
        continent * 0.05 +
        detail * config.elevationVariation * 0.08 +
        mountain.influence * mountain.ridgeVariation * config.mountainStrength * 0.42 +
        ridge * config.mountainStrength * 0.03 -
        (macro.landSupport <= 0.08 ? macro.basinInfluence * 0.08 : 0) -
        latitudePenalty;
      const latitudeTemperature = 1 - Math.abs(y);
      const rawTemperature =
        latitudeTemperature * 0.76 +
        (temperatureNoise.fbm(
          x * config.climateScale,
          y * config.climateScale,
          z * config.climateScale,
          4,
          2,
          0.5,
        ) +
          1) *
          0.12;
      const rawMoisture =
        (moistureNoise.fbm(
          x * config.climateScale,
          y * config.climateScale,
          z * config.climateScale,
          5,
          2.1,
          0.52,
        ) +
          1) /
        2;
      return {
        cellId: cell.id,
        center: roundVector(cell.center),
        neighborIds: [...cell.neighborIds].sort(),
        cellType: cell.type,
        rawElevation,
        rawTemperature,
        rawMoisture,
        macroRegion:
          macro.basinInfluence >= 0.45
            ? 'ocean-basin'
            : macro.continentInfluence >= macro.islandInfluence && macro.continentInfluence > 0.2
              ? 'continent'
              : macro.islandInfluence > 0.2
                ? 'island'
                : 'ocean',
        macroLandSupport: macro.landSupport,
        basinInfluence: macro.basinInfluence,
        mountainRangeId: mountain.rangeId,
        mountainInfluence: mountain.influence,
        mountainType: mountain.rangeType,
      };
    });
}

type BaseProceduralWorldCell = Omit<
  ProceduralWorldCell,
  | 'flowToCellId'
  | 'catchmentId'
  | 'flowAccumulation'
  | 'waterFeature'
  | 'lakeId'
  | 'lakeLevel'
  | 'isLakeOutlet'
>;

function classifyCell(
  cell: ClassifiedCellFields,
  surfacesById: ReadonlyMap<string, ProceduralSurface>,
): BaseProceduralWorldCell {
  const isCoast = cell.neighborIds.some(
    (neighborId) => surfacesById.get(neighborId) !== cell.surface,
  );
  const coastalMoisture = cell.surface === 'land' && isCoast ? 0.08 : 0;
  const temperature = round(clamp(cell.rawTemperature - Math.max(cell.elevation, 0) * 0.34, 0, 1));
  const moisture = round(clamp(cell.rawMoisture + coastalMoisture, 0, 1));
  const relief = classifyRelief(cell.elevation);
  const visual = classifyVisualTile(
    cell.surface,
    isCoast,
    cell.elevation,
    temperature,
    moisture,
    cell.isShelf,
  );
  const qualityFlags: ProceduralQualityFlag[] = [];
  if (isCoast) qualityFlags.push('coast-derived');
  if (Math.abs(cell.center.y) >= 0.92) qualityFlags.push('polar-climate');
  return {
    cellId: cell.cellId,
    center: cell.center,
    neighborIds: cell.neighborIds,
    cellType: cell.cellType,
    elevation: cell.elevation,
    surface: cell.surface,
    isCoast,
    temperature,
    moisture,
    tileType: visual.tileType,
    modifiers: visual.modifiers,
    relief,
    qualityFlags,
    macroRegion: cell.macroRegion,
    isShelf: cell.isShelf,
    isInlandBasin: cell.isInlandBasin,
    mountainRangeId: cell.surface === 'land' ? cell.mountainRangeId : null,
    mountainInfluence: cell.surface === 'land' ? round(cell.mountainInfluence) : 0,
  };
}

function classifyVisualTile(
  surface: ProceduralSurface,
  isCoast: boolean,
  elevation: number,
  temperature: number,
  moisture: number,
  isShelf: boolean,
): {
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
} {
  if (surface === 'water') {
    if (isShelf && !isCoast) return { tileType: 'shelfWater', modifiers: [] };
    if (temperature < 0.13 && elevation > -0.32) return { tileType: 'iceWater', modifiers: [] };
    if (elevation <= -0.62) return { tileType: 'deepSea', modifiers: [] };
    if (elevation <= -0.22) return { tileType: 'ocean', modifiers: [] };
    if (elevation <= -0.07) return { tileType: 'shelfWater', modifiers: [] };
    return { tileType: 'coastalWater', modifiers: [] };
  }

  const modifiers = reliefModifiers(elevation);
  if (isCoast) modifiers.push('coastal');
  if (temperature < 0.13 && (elevation > 0.2 || moisture > 0.58)) {
    modifiers.push('snowCover', 'glacier');
    return { tileType: 'tundra', modifiers: uniqueModifiers(modifiers) };
  }
  if (temperature < 0.24) {
    if (elevation > 0.35) modifiers.push('snowCover');
    return {
      tileType: moisture > 0.58 ? 'tundraWoodland' : 'tundra',
      modifiers: uniqueModifiers(modifiers),
    };
  }
  if (elevation > 0.82) return { tileType: 'bareRock', modifiers: uniqueModifiers(modifiers) };
  if (isCoast && elevation < 0.18)
    return {
      tileType: temperature > 0.42 && moisture < 0.7 ? 'sandCoast' : 'rockyCoast',
      modifiers: uniqueModifiers(modifiers),
    };
  if (moisture > 0.68 && elevation < 0.24) {
    modifiers.push('wet');
    return {
      tileType: temperature > 0.76 ? 'mangrove' : 'wetland',
      modifiers: uniqueModifiers(modifiers),
    };
  }
  if (temperature > 0.72 && moisture > 0.64)
    return {
      tileType: 'tropicalRainforest',
      modifiers: uniqueModifiers(modifiers),
    };
  if (temperature > 0.68 && moisture > 0.45)
    return {
      tileType: 'tropicalDryForest',
      modifiers: uniqueModifiers(modifiers),
    };
  if (temperature > 0.67 && moisture > 0.3)
    return { tileType: 'savanna', modifiers: uniqueModifiers(modifiers) };
  if (temperature > 0.52 && moisture < 0.28)
    return { tileType: 'desert', modifiers: uniqueModifiers(modifiers) };
  if (temperature > 0.44 && moisture < 0.38)
    return { tileType: 'semiDesert', modifiers: uniqueModifiers(modifiers) };
  if (temperature < 0.46 && moisture > 0.58)
    return { tileType: 'borealForest', modifiers: uniqueModifiers(modifiers) };
  if (moisture > 0.56)
    return {
      tileType: 'temperateMixedForest',
      modifiers: uniqueModifiers(modifiers),
    };
  if (moisture < 0.39) return { tileType: 'steppe', modifiers: uniqueModifiers(modifiers) };
  return {
    tileType: 'temperateGrassland',
    modifiers: uniqueModifiers(modifiers),
  };
}

function reliefModifiers(elevation: number): TileModifier[] {
  if (elevation > 0.72) return ['highMountains'];
  if (elevation > 0.45) return ['mountains'];
  if (elevation > 0.2) return ['hills'];
  return [];
}

function classifyRelief(elevation: number): ProceduralReliefBand {
  if (elevation <= -0.62) return 'deepSea';
  if (elevation <= -0.22) return 'oceanFloor';
  if (elevation < 0) return 'shallowWater';
  if (elevation <= 0.2) return 'lowland';
  if (elevation <= 0.45) return 'hills';
  if (elevation <= 0.72) return 'mountains';
  return 'highMountains';
}

function fingerprintWorld(world: Omit<ProceduralWorld, 'fingerprint'>): string {
  const serialized = JSON.stringify(world);
  return `pw${PROCEDURAL_WORLD_FORMAT_VERSION}-${hashText(serialized)}`;
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError('Quantil benötigt mindestens einen Wert.');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)));
  const value = sorted[index];
  if (value === undefined) throw new Error('Quantilindex liegt außerhalb des Wertebereichs.');
  return value;
}

function normalizePositive(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 0;
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

function uniqueModifiers(modifiers: readonly TileModifier[]): readonly TileModifier[] {
  return [...new Set(modifiers)];
}

function roundVector(vector: Vector3): Vector3 {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function round(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${label} muss zwischen ${minimum} und ${maximum} liegen.`);
}
