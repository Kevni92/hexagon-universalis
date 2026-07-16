import { TILE_PROFILES, type TileModifier, type TileType } from '@/data/tileCatalog';
import type { Vector3 } from '@/topology/geodesic';
import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { QualityProfile } from '@/topology/lod/profiles';
import type { CameraState } from '@/topology/lod/selection';
import {
  createProceduralWorld,
  normalizeProceduralWorldConfig,
  PROCEDURAL_DENSITY_PROFILES,
  type ProceduralDensityProfileId,
  type ProceduralWorld,
  type ProceduralWorldCell,
  type ProceduralWorldConfig,
} from './proceduralWorld';
import { ProceduralWorldLodController } from './proceduralWorldLodController';

export type ProceduralWorldLodLevel = 'global' | 'regional' | 'local';
export type ProceduralCellColor = (cell: ProceduralWorldCell) => string;

export interface ProceduralLodBudgetProfile {
  readonly density: ProceduralDensityProfileId;
  readonly quality: QualityProfile;
  readonly levelCellCounts: Readonly<Record<ProceduralWorldLodLevel, number>>;
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
        regional: level(55, 18, 17, 24),
        local: level(144, 28, 20, 32),
      },
    },
    levelCellCounts: { global: 2562, regional: 30252, local: 207362 },
    maxActiveCells: 16_384,
    maxDrawCalls: 33,
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
  private generation = 1;
  private disposed = false;

  public constructor(
    config: Partial<ProceduralWorldConfig> = {},
    private readonly colorForCell: ProceduralCellColor = defaultProceduralCellColor,
  ) {
    this.configValue = normalizeProceduralWorldConfig(config);
    this.referenceWorld = createProceduralWorld(this.configValue);
    this.controller = new ProceduralWorldLodController(this.profile.quality);
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
    const units = this.controller.update(camera);
    for (const unit of units) {
      for (const [index, lodCell] of unit.cells.entries()) {
        const id = visibleCellId(unit, index);
        if (this.projectedById.has(id)) continue;
        const source = this.sampleAt(lodCell.cell.center);
        const projected: ProceduralLodCell = {
          cellId: id,
          sourceCellId: source.cellId,
          level: levelName(unit.level),
          elevation: source.elevation,
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
      }
    }
    return units;
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
    const nextReferenceWorld = createProceduralWorld(next);
    this.configValue = next;
    this.referenceWorld = nextReferenceWorld;
    this.projectedById.clear();
    this.colorsById.clear();
    this.generation += 1;
    if (densityChanged) this.controller = new ProceduralWorldLodController(this.profile.quality);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.reset();
    this.projectedById.clear();
    this.colorsById.clear();
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
      profile.levelCellCounts.global !==
      PROCEDURAL_DENSITY_PROFILES[density as ProceduralDensityProfileId].cellCount
    )
      throw new RangeError(`Globale Zellzahl passt nicht zum Dichteprofil ${density}.`);
    const finestLevel = profile.levelCellCounts.local;
    const expectedActiveCells =
      profile.density === 'ultra' ? 16_384 : Math.max(...Object.values(profile.levelCellCounts));
    if (profile.maxActiveCells !== expectedActiveCells)
      throw new RangeError(`Ungültiges aktives Zellbudget für ${density}.`);
    if (profile.density !== 'ultra' && profile.maxDrawCalls !== 1)
      throw new RangeError(`Ungültiges Draw-Call-Budget für ${density}.`);
    if (profile.density === 'ultra' && (finestLevel < 200_000 || profile.maxDrawCalls > 33))
      throw new RangeError(`Ungültiges Laufzeitbudget für ${density}.`);
  }
}

function defaultProceduralCellColor(cell: ProceduralWorldCell): string {
  return TILE_PROFILES[cell.tileType].color;
}

function nearestWorldCell(
  center: Vector3,
  cells: readonly ProceduralWorldCell[],
): ProceduralWorldCell {
  const first = cells[0];
  if (first === undefined) throw new RangeError('Referenzwelt enthält keine Zellen.');
  let nearest = first;
  let nearestDot = dot(center, first.center);
  for (let index = 1; index < cells.length; index += 1) {
    const candidate = cells[index];
    if (candidate === undefined) continue;
    const candidateDot = dot(center, candidate.center);
    if (candidateDot <= nearestDot) continue;
    nearest = candidate;
    nearestDot = candidateDot;
  }
  return nearest;
}

function levelName(level: 0 | 1 | 2): ProceduralWorldLodLevel {
  return (['global', 'regional', 'local'] as const)[level];
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

validateProceduralLodProfiles();
