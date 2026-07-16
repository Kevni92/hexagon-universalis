import { TILE_PROFILES, type TileModifier, type TileType } from '@/data/tileCatalog';
import type { Vector3 } from '@/topology/geodesic';
import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { QualityProfile } from '@/topology/lod/profiles';
import { cameraFocusDirection, type CameraState } from '@/topology/lod/selection';
import { SevenLevelWorldLodRuntime } from '@/topology/lod/sevenLevelRuntime';
import { WORLD_LOD_LEVELS, type WorldLodLevelName } from '@/topology/lod/sevenLevelArchitecture';
import {
  ULTRA_DETAIL_CELL_COUNT,
  ULTRA_DETAIL_MAX_ACTIVE_CHUNKS,
  ULTRA_DETAIL_CHUNK_PROFILE,
  ULTRA_GLOBAL_PROFILE,
  ULTRA_INTERACTIVE_MAX_LEVEL,
  ULTRA_PRELOAD_STAGE_WORK,
  ULTRA_INTERMEDIATE_CHUNK_PROFILES,
  UltraDetailChunkCache,
  type UltraDetailProgress,
} from '@/topology/lod/ultraDetail';
import {
  createProceduralWorldAtFrequency,
  createProceduralWorld,
  normalizeProceduralWorldConfig,
  PROCEDURAL_DENSITY_PROFILES,
  type ProceduralDensityProfileId,
  type ProceduralWorld,
  type ProceduralWorldCell,
  type ProceduralWorldConfig,
} from './proceduralWorld';
import { ProceduralWorldLodController } from './proceduralWorldLodController';
import { createSeededNoise3D, type SeededNoise3D } from './seededNoise';

export type ProceduralWorldLodLevel = WorldLodLevelName;
export type ProceduralCellColor = (cell: ProceduralWorldCell) => string;

const REFERENCE_INDEX_LATITUDE_BINS = 64;
const REFERENCE_INDEX_LONGITUDE_BINS = 128;
const referenceSpatialIndices = new WeakMap<
  readonly ProceduralWorldCell[],
  ReferenceSpatialIndex
>();

interface ReferenceSpatialIndex {
  readonly bins: ReadonlyMap<string, readonly ProceduralWorldCell[]>;
}

export interface ProceduralLodBudgetProfile {
  readonly density: ProceduralDensityProfileId;
  readonly quality: QualityProfile;
  readonly levelCellCounts: Readonly<
    Record<'global' | 'regional' | 'local', number> &
      Partial<Record<'continental' | 'macroregional' | 'subregional' | 'detail', number>>
  >;
  readonly maxActiveCells: number;
  readonly maxDrawCalls: number;
  readonly generationBudgetMs: number;
}

const level = (
  frequency: number,
  refineAbovePx: number,
  coarsenBelowPx: number,
  maxActiveChunks: number,
) => ({ frequency, refineAbovePx, coarsenBelowPx, maxActiveChunks });

export const PROCEDURAL_LOD_PROFILES: Readonly<
  Record<ProceduralDensityProfileId, ProceduralLodBudgetProfile>
> = {
  low: {
    density: 'low',
    quality: {
      name: 'procedural-low',
      levels: {
        global: level(4, Infinity, 0, 1),
        regional: level(8, 70, 66, 1),
        local: level(16, 70, 52, 1),
      },
    },
    levelCellCounts: { global: 162, regional: 642, local: 2562 },
    maxActiveCells: 2562,
    maxDrawCalls: 1,
    generationBudgetMs: 40,
  },
  standard: {
    density: 'standard',
    quality: {
      name: 'procedural-standard',
      levels: {
        global: level(8, Infinity, 0, 1),
        regional: level(16, 35, 34, 1),
        local: level(32, 55, 40, 1),
      },
    },
    levelCellCounts: { global: 642, regional: 2562, local: 10242 },
    maxActiveCells: 10242,
    maxDrawCalls: 1,
    generationBudgetMs: 90,
  },
  high: {
    density: 'high',
    quality: {
      name: 'procedural-high',
      levels: {
        global: level(16, Infinity, 0, 1),
        regional: level(24, 18, 17, 1),
        local: level(32, 28, 20, 1),
      },
    },
    levelCellCounts: { global: 2562, regional: 5762, local: 10242 },
    maxActiveCells: 10242,
    maxDrawCalls: 1,
    generationBudgetMs: 180,
  },
  ultra: {
    density: 'ultra',
    quality: {
      name: 'procedural-ultra-experimental',
      levels: {
        global: level(16, Infinity, 0, 1),
        regional: level(24, 18, 17, 1),
        local: level(32, 28, 20, 1),
      },
    },
    levelCellCounts: {
      global: 642,
      continental: 1_692,
      macroregional: 4_412,
      regional: 11_562,
      subregional: 30_252,
      local: 79_212,
      detail: ULTRA_DETAIL_CELL_COUNT,
    },
    maxActiveCells: 16_384,
    maxDrawCalls: ULTRA_DETAIL_MAX_ACTIVE_CHUNKS + 1,
    generationBudgetMs: 250,
  },
};

export interface ProceduralLodCell {
  readonly cellId: string;
  readonly sourceCellId: string;
  readonly level: ProceduralWorldLodLevel;
  readonly elevation: number;
  readonly surface: ProceduralWorldCell['surface'];
  readonly isCoast: boolean;
  readonly temperature: number;
  readonly moisture: number;
  readonly tileType: TileType;
  readonly modifiers: readonly TileModifier[];
  readonly relief: ProceduralWorldCell['relief'];
}

export interface ProceduralLodCacheStats {
  readonly projectedCells: number;
  readonly generation: number;
  readonly cachedTopologies: number;
  readonly topologyBuilds: number;
}

/**
 * Verbindet das deterministische Referenz-Weltmodell mit der selektiven
 * Geodäsie. Jede LOD-Zelle wird ausschließlich über ihre räumliche Position
 * auf die nächstgelegene Referenzprobe abgebildet; lokale Indizes beeinflussen
 * die Fachwerte nicht. So bleiben Datumsgrenze, Pole und gemeinsame Zentren
 * über alle drei Stufen stabil.
 */
export class ProceduralWorldLod {
  private configValue: ProceduralWorldConfig;
  private referenceWorld: ProceduralWorld;
  private controller: ProceduralWorldLodController;
  private readonly projectedById = new Map<string, ProceduralLodCell>();
  private readonly colorsById = new Map<string, string>();
  private readonly projectionKeysById = new Map<string, string>();
  private readonly ultraDetailCache = new UltraDetailChunkCache();
  private refinementNoise: SeededNoise3D;
  private ultraRuntime: SevenLevelWorldLodRuntime | null = null;
  private activeLevelValue: ProceduralWorldLodLevel = 'global';
  private activeFrequencyValue = 0;
  private generation = 1;
  private disposed = false;

  public constructor(
    config: Partial<ProceduralWorldConfig> = {},
    private readonly colorForCell: ProceduralCellColor = defaultProceduralCellColor,
  ) {
    this.configValue = normalizeProceduralWorldConfig(config);
    this.referenceWorld = this.createReferenceWorld(this.configValue);
    this.refinementNoise = createSeededNoise3D(`${this.configValue.seed}:lod-refinement`);
    this.controller = new ProceduralWorldLodController(this.profile.quality);
    this.ultraRuntime =
      this.configValue.density === 'ultra'
        ? new SevenLevelWorldLodRuntime({
            platform: 'desktop',
            refineAbovePx: 18,
            coarsenBelowPx: 12,
            maxLevel: ULTRA_INTERACTIVE_MAX_LEVEL,
          })
        : null;
    this.activeFrequencyValue = this.profile.quality.levels.global.frequency;
  }

  public get config(): ProceduralWorldConfig {
    return this.configValue;
  }

  public get profile(): ProceduralLodBudgetProfile {
    return PROCEDURAL_LOD_PROFILES[this.configValue.density];
  }

  public get fingerprint(): string {
    return this.referenceWorld.fingerprint;
  }

  public get sourceCells(): readonly ProceduralWorldCell[] {
    return this.referenceWorld.cells;
  }

  public get activeLevel(): ProceduralWorldLodLevel {
    return this.activeLevelValue;
  }

  public get activeFrequency(): number {
    return this.activeFrequencyValue;
  }

  public get streamingRevision(): number {
    return this.ultraDetailCache.revision;
  }

  public get cellColors(): ReadonlyMap<string, string> {
    return this.colorsById;
  }

  public get cacheStats(): ProceduralLodCacheStats {
    return {
      projectedCells: this.projectedById.size,
      generation: this.generation,
      cachedTopologies: this.disposed ? 0 : this.controller.cacheStats.cachedTopologies,
      topologyBuilds: this.controller.cacheStats.topologyBuilds,
    };
  }

  public update(camera: CameraState): readonly VisibleUnit[] {
    this.assertActive();
    let units: readonly VisibleUnit[];
    if (this.ultraRuntime !== null) {
      const frame = this.ultraRuntime.update(camera);
      const profile =
        frame.level.name === 'global'
          ? ULTRA_GLOBAL_PROFILE
          : frame.level.name === 'detail'
            ? ULTRA_DETAIL_CHUNK_PROFILE
            : ULTRA_INTERMEDIATE_CHUNK_PROFILES[frame.level.name];
      units =
        frame.level.frequency <= 89
          ? [this.ultraDetailCache.fullUnit(profile)]
          : this.ultraDetailCache.request(
              frame.activeChunks,
              cameraFocusDirection(camera),
              profile,
            );
      const displayedLevel = units[0]?.worldLevel ?? frame.level.name;
      this.activeLevelValue = displayedLevel;
      this.activeFrequencyValue = worldLevelFrequency(displayedLevel);
    } else {
      units = this.controller.update(camera);
      const maximumLevel = Math.min(2, Math.max(...units.map((unit) => unit.level)));
      this.activeLevelValue = levelName(maximumLevel as 0 | 1 | 2);
      const qualityLevel =
        this.activeLevelValue === 'global'
          ? 'global'
          : this.activeLevelValue === 'local'
            ? 'local'
            : 'regional';
      this.activeFrequencyValue = this.profile.quality.levels[qualityLevel].frequency;
    }
    this.projectUnits(units);
    return units;
  }

  private projectUnits(units: readonly VisibleUnit[]): void {
    for (const unit of units) {
      for (const [index, lodCell] of unit.cells.entries()) {
        const id = visibleCellId(unit, index);
        const projectionKey = `${lodCell.cell.center.x.toFixed(5)},${lodCell.cell.center.y.toFixed(5)},${lodCell.cell.center.z.toFixed(5)}`;
        if (this.projectedById.has(id) && this.projectionKeysById.get(id) === projectionKey)
          continue;
        const source = this.sampleAt(lodCell.cell.center);
        const projected: ProceduralLodCell = {
          cellId: id,
          sourceCellId: source.cellId,
          level: unit.worldLevel ?? levelName(unit.level),
          elevation: this.refinedElevation(source.elevation, lodCell.cell.center, unit.worldLevel),
          surface: source.surface,
          isCoast: source.isCoast,
          temperature: source.temperature,
          moisture: source.moisture,
          tileType: source.tileType,
          modifiers: source.modifiers,
          relief: source.relief,
        };
        this.projectedById.set(id, projected);
        this.colorsById.set(id, this.colorForCell(source));
        this.projectionKeysById.set(id, projectionKey);
      }
    }
  }

  public async prepare(
    _camera: CameraState,
    onProgress?: (progress: UltraDetailProgress) => void,
  ): Promise<readonly VisibleUnit[]> {
    this.assertActive();
    if (this.configValue.density !== 'ultra' || this.ultraRuntime === null) {
      onProgress?.({ completed: 1, total: 1 });
      await yieldToBrowser();
      return [];
    }

    const profile = ultraProfile(ULTRA_INTERACTIVE_MAX_LEVEL);
    onProgress?.({ completed: 0, total: 1 });
    await yieldToBrowser();
    const unit = this.ultraDetailCache.fullUnit(profile);
    this.projectUnits([unit]);
    onProgress?.({ completed: 1, total: 1 });
    return [unit];
  }

  /** Baut alle interaktiven Ultra-Stufen vor dem ersten Zoom vor. */
  public async prepareAll(
    _camera: CameraState,
    onProgress?: (progress: UltraDetailProgress) => void,
  ): Promise<readonly VisibleUnit[]> {
    this.assertActive();
    if (this.configValue.density !== 'ultra' || this.ultraRuntime === null) {
      onProgress?.({ completed: 1, total: 1 });
      await yieldToBrowser();
      return [];
    }

    const prepared: VisibleUnit[] = [];
    let completed = 0;
    onProgress?.({ completed, total: ULTRA_PRELOAD_STAGE_WORK });
    const maximumDepth =
      WORLD_LOD_LEVELS.find((level) => level.name === ULTRA_INTERACTIVE_MAX_LEVEL)?.depth ?? 0;

    for (const level of WORLD_LOD_LEVELS.filter((candidate) => candidate.depth <= maximumDepth)) {
      const profile = ultraProfile(level.name);
      const unit = this.ultraDetailCache.fullUnit(profile);
      prepared.push(unit);
      this.projectUnits([unit]);
      completed += 1;
      onProgress?.({ completed, total: ULTRA_PRELOAD_STAGE_WORK });
      await yieldToBrowser();
    }

    return prepared;
  }

  public projectedCell(cellId: string): ProceduralLodCell | undefined {
    return this.projectedById.get(cellId);
  }

  public sampleAt(center: Vector3): ProceduralWorldCell {
    this.assertActive();
    return nearestWorldCell(center, this.referenceWorld.cells);
  }

  /**
   * Seed-/Parameterwechsel behalten die Geometrie- und Hysterese-Caches;
   * nur fachliche Projektionen werden ersetzt. Ein Dichtewechsel erzeugt
   * zusätzlich den Topologiecontroller mit dem passenden Budget neu.
   */
  public reconfigure(config: Partial<ProceduralWorldConfig>): void {
    this.assertActive();
    const next = normalizeProceduralWorldConfig({
      ...this.configValue,
      ...config,
    });
    if (JSON.stringify(next) === JSON.stringify(this.configValue)) return;
    const densityChanged = next.density !== this.configValue.density;
    const nextReferenceWorld = this.createReferenceWorld(next);
    this.configValue = next;
    this.referenceWorld = nextReferenceWorld;
    this.refinementNoise = createSeededNoise3D(`${next.seed}:lod-refinement`);
    this.projectedById.clear();
    this.colorsById.clear();
    this.projectionKeysById.clear();
    this.ultraDetailCache.clear();
    this.generation += 1;
    if (densityChanged) {
      this.controller = new ProceduralWorldLodController(this.profile.quality);
      this.ultraRuntime =
        next.density === 'ultra'
          ? new SevenLevelWorldLodRuntime({
              platform: 'desktop',
              refineAbovePx: 18,
              coarsenBelowPx: 12,
              maxLevel: ULTRA_INTERACTIVE_MAX_LEVEL,
            })
          : null;
    }
    this.activeLevelValue = 'global';
    this.activeFrequencyValue = this.profile.quality.levels.global.frequency;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.reset();
    this.projectedById.clear();
    this.colorsById.clear();
    this.projectionKeysById.clear();
    this.ultraDetailCache.clear();
  }

  private createReferenceWorld(config: ProceduralWorldConfig): ProceduralWorld {
    return config.density === 'ultra'
      ? createProceduralWorldAtFrequency(config, 21)
      : createProceduralWorld(config);
  }

  private refinedElevation(
    elevation: number,
    center: Vector3,
    worldLevel: WorldLodLevelName | undefined,
  ): number {
    if (worldLevel === undefined || worldLevel === 'global') return elevation;
    const amplitude = {
      continental: 0.012,
      macroregional: 0.022,
      regional: 0.035,
      subregional: 0.052,
      local: 0.075,
      detail: 0.11,
    }[worldLevel];
    const fine = this.refinementNoise.fbm(
      center.x * 24,
      center.y * 24,
      center.z * 24,
      4,
      2.05,
      0.52,
    );
    const micro = this.refinementNoise.fbm(center.x * 80, center.y * 80, center.z * 80, 3, 2, 0.5);
    return Math.min(1, Math.max(-1, elevation + (fine * 0.72 + micro * 0.28) * amplitude));
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('ProceduralWorldLod wurde bereits disposed.');
  }
}

export function validateProceduralLodProfiles(): void {
  for (const [density, profile] of Object.entries(PROCEDURAL_LOD_PROFILES)) {
    const frequencies = Object.values(profile.quality.levels).map((entry) => entry.frequency);
    if (!(frequencies[0]! < frequencies[1]! && frequencies[1]! < frequencies[2]!))
      throw new RangeError(`LOD-Frequenzen für ${density} müssen streng ansteigen.`);
    if (
      density !== 'ultra' &&
      profile.levelCellCounts.global !==
        PROCEDURAL_DENSITY_PROFILES[density as ProceduralDensityProfileId].cellCount
    )
      throw new RangeError(`Globale Zellzahl passt nicht zum Dichteprofil ${density}.`);
    const finestLevel = Math.max(...Object.values(profile.levelCellCounts));
    const expectedActiveCells =
      density === 'ultra'
        ? profile.maxActiveCells
        : Math.max(...Object.values(profile.levelCellCounts));
    if (profile.maxActiveCells !== expectedActiveCells)
      throw new RangeError(`Ungültiges aktives Zellbudget für ${density}.`);
    if (density !== 'ultra' && profile.maxDrawCalls !== 1)
      throw new RangeError(`Ungültiges Draw-Call-Budget für ${density}.`);
    if (density !== 'ultra' && finestLevel > 10_242)
      throw new RangeError(`Ungültiges Laufzeitbudget für ${density}.`);
    if (density === 'ultra' && profile.levelCellCounts.detail !== ULTRA_DETAIL_CELL_COUNT)
      throw new RangeError('Ultra muss die f144-Adressierungszellzahl verwenden.');
  }
}

function defaultProceduralCellColor(cell: ProceduralWorldCell): string {
  return TILE_PROFILES[cell.tileType].color;
}

function ultraProfile(level: import('@/topology/lod/sevenLevelArchitecture').WorldLodLevelName) {
  if (level === 'global') return ULTRA_GLOBAL_PROFILE;
  if (level === 'detail') return ULTRA_DETAIL_CHUNK_PROFILE;
  return ULTRA_INTERMEDIATE_CHUNK_PROFILES[level];
}

function worldLevelFrequency(level: WorldLodLevelName): number {
  return WORLD_LOD_LEVELS.find((candidate) => candidate.name === level)?.frequency ?? 0;
}

function nearestWorldCell(
  center: Vector3,
  cells: readonly ProceduralWorldCell[],
): ProceduralWorldCell {
  const first = cells[0];
  if (first === undefined) throw new RangeError('Referenzwelt enthält keine Zellen.');
  const spatialIndex = referenceSpatialIndex(cells);
  const candidates = indexedCandidates(center, spatialIndex);
  let nearest = first;
  let nearestDot = dot(center, first.center);
  for (const candidate of candidates.length > 0 ? candidates : cells) {
    if (candidate === first) continue;
    if (candidate === undefined) continue;
    const candidateDot = dot(center, candidate.center);
    if (candidateDot <= nearestDot) continue;
    nearest = candidate;
    nearestDot = candidateDot;
  }
  return nearest;
}

function referenceSpatialIndex(cells: readonly ProceduralWorldCell[]): ReferenceSpatialIndex {
  const cached = referenceSpatialIndices.get(cells);
  if (cached !== undefined) return cached;
  const bins = new Map<string, ProceduralWorldCell[]>();
  for (const cell of cells) {
    const key = referenceBinKey(cell.center);
    const bin = bins.get(key);
    if (bin === undefined) bins.set(key, [cell]);
    else bin.push(cell);
  }
  const index: ReferenceSpatialIndex = { bins };
  referenceSpatialIndices.set(cells, index);
  return index;
}

function indexedCandidates(
  center: Vector3,
  index: ReferenceSpatialIndex,
): readonly ProceduralWorldCell[] {
  const { row, column } = referenceBinPosition(center);
  const candidates: ProceduralWorldCell[] = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    const candidateRow = row + rowOffset;
    if (candidateRow < 0 || candidateRow >= REFERENCE_INDEX_LATITUDE_BINS) continue;
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      const candidateColumn =
        (column + columnOffset + REFERENCE_INDEX_LONGITUDE_BINS) % REFERENCE_INDEX_LONGITUDE_BINS;
      const bin = index.bins.get(`${candidateRow}:${candidateColumn}`);
      if (bin !== undefined) candidates.push(...bin);
    }
  }
  return candidates;
}

function referenceBinKey(center: Vector3): string {
  const { row, column } = referenceBinPosition(center);
  return `${row}:${column}`;
}

function referenceBinPosition(center: Vector3): { readonly row: number; readonly column: number } {
  const latitude = Math.asin(Math.min(1, Math.max(-1, center.y)));
  const longitude = Math.atan2(center.x, center.z);
  return {
    row: Math.min(
      REFERENCE_INDEX_LATITUDE_BINS - 1,
      Math.max(0, Math.floor(((latitude + Math.PI / 2) / Math.PI) * REFERENCE_INDEX_LATITUDE_BINS)),
    ),
    column: Math.min(
      REFERENCE_INDEX_LONGITUDE_BINS - 1,
      Math.max(
        0,
        Math.floor(((longitude + Math.PI) / (2 * Math.PI)) * REFERENCE_INDEX_LONGITUDE_BINS),
      ),
    ),
  };
}

function levelName(level: 0 | 1 | 2 | 3): ProceduralWorldLodLevel {
  if (level === 3) return 'detail';
  if (level === 2) return 'local';
  if (level === 1) return 'regional';
  return 'global';
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

validateProceduralLodProfiles();
