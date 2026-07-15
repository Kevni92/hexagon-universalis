export type WorldLodPlatform = 'desktop' | 'mobile';

export type WorldLodProjectionCapability = 'globe-only' | 'globe-or-flat';

export const WORLD_LOD_CHUNK_CELL_TARGET = 512;
export const WORLD_LOD_BYTES_PER_VERTEX = 36;
export const WORLD_LOD_MIB = 1024 * 1024;

export const WORLD_LOD_LEVELS = [
  {
    name: 'global',
    depth: 0,
    frequency: 8,
    projection: 'globe-only',
    chunked: false,
  },
  {
    name: 'continental',
    depth: 1,
    frequency: 13,
    projection: 'globe-only',
    chunked: true,
  },
  {
    name: 'macroregional',
    depth: 2,
    frequency: 21,
    projection: 'globe-only',
    chunked: true,
  },
  {
    name: 'regional',
    depth: 3,
    frequency: 34,
    projection: 'globe-only',
    chunked: true,
  },
  {
    name: 'subregional',
    depth: 4,
    frequency: 55,
    projection: 'globe-only',
    chunked: true,
  },
  {
    name: 'local',
    depth: 5,
    frequency: 89,
    projection: 'globe-or-flat',
    chunked: true,
  },
  {
    name: 'detail',
    depth: 6,
    frequency: 144,
    projection: 'globe-or-flat',
    chunked: true,
  },
] as const;

export type WorldLodLevelName = (typeof WORLD_LOD_LEVELS)[number]['name'];
export type WorldLodLevelDefinition = (typeof WORLD_LOD_LEVELS)[number];

export interface WorldLodLevelId {
  readonly name: WorldLodLevelName;
  readonly depth: number;
}

export interface WorldLodChunkAddress {
  /** Fachliche Level-/Chunkadresse, unabhängig von Globe- oder Flat-Projektion. */
  readonly level: WorldLodLevelId;
  readonly chunkKey: string;
  readonly parentKey: string | null;
}

export interface WorldLodLevelBudget {
  readonly maxActiveChunks: number;
  readonly maxActiveCells: number;
}

export interface WorldLodPlatformBudget {
  readonly maxActiveCells: number;
  readonly maxActiveChunks: number;
  readonly maxVisibleTriangles: number;
  readonly maxGpuBufferBytes: number;
  readonly maxCpuWorkingSetBytes: number;
  readonly maxCachedChunks: number;
  readonly generationSliceMs: number;
  readonly maxChunkGenerationMs: number;
  readonly maxDrawCalls: number;
  readonly maxMaterials: number;
  readonly levels: Readonly<Record<WorldLodLevelName, WorldLodLevelBudget>>;
}

const DESKTOP_CHUNK_LIMITS = {
  global: 1,
  continental: 8,
  macroregional: 12,
  regional: 16,
  subregional: 24,
  local: 32,
  detail: 32,
} satisfies Record<WorldLodLevelName, number>;

const MOBILE_CHUNK_LIMITS = {
  global: 1,
  continental: 4,
  macroregional: 6,
  regional: 8,
  subregional: 10,
  local: 12,
  detail: 12,
} satisfies Record<WorldLodLevelName, number>;

export const WORLD_LOD_PLATFORM_BUDGETS: Readonly<
  Record<WorldLodPlatform, WorldLodPlatformBudget>
> = {
  desktop: createPlatformBudget(DESKTOP_CHUNK_LIMITS, 16_384, 48, 96, 64, 4, 40),
  mobile: createPlatformBudget(MOBILE_CHUNK_LIMITS, 6_144, 16, 48, 24, 2, 60),
};

export function worldLodCellCount(frequency: number): number {
  assertPositiveInteger(frequency, 'frequency');
  return 10 * frequency ** 2 + 2;
}

/** Anzahl der Polygonkanten aller Hexagone und Pentagone einer Volltopologie. */
export function worldLodEdgeCount(frequency: number): number {
  assertPositiveInteger(frequency, 'frequency');
  return 60 * frequency ** 2;
}

/** Worst-Case-Dreieckszahl mit reliefbehafteter Deck- und Seitengeometrie. */
export function worldLodReliefTriangleCount(frequency: number): number {
  return worldLodEdgeCount(frequency) * 3;
}

/** Konservative GPU-Schätzung: nicht indexierte Positionen, Normalen und Farben. */
export function estimateWorldLodReliefGpuBytes(frequency: number): number {
  return worldLodReliefTriangleCount(frequency) * 3 * WORLD_LOD_BYTES_PER_VERTEX;
}

export function createWorldLodLevelId(name: WorldLodLevelName): WorldLodLevelId {
  const level = worldLodLevel(name);
  return { name: level.name, depth: level.depth };
}

export function formatWorldLodLevelId(level: WorldLodLevelId): string {
  const definition = WORLD_LOD_LEVELS[level.depth];
  if (definition?.name !== level.name)
    throw new RangeError(`Ungültige Welt-LOD-ID: lvl${level.depth}-${level.name}`);
  return `lvl${level.depth}-${level.name}`;
}

export function worldLodLevel(name: WorldLodLevelName): WorldLodLevelDefinition {
  const level = WORLD_LOD_LEVELS.find((candidate) => candidate.name === name);
  if (level === undefined) throw new RangeError(`Unbekannte Welt-LOD-Stufe: ${name}`);
  return level;
}

function createPlatformBudget(
  chunkLimits: Readonly<Record<WorldLodLevelName, number>>,
  maxActiveCells: number,
  gpuMiB: number,
  cpuMiB: number,
  maxCachedChunks: number,
  generationSliceMs: number,
  maxChunkGenerationMs: number,
): WorldLodPlatformBudget {
  const levels = Object.fromEntries(
    WORLD_LOD_LEVELS.map((level) => [
      level.name,
      {
        maxActiveChunks: chunkLimits[level.name],
        maxActiveCells: level.chunked
          ? Math.min(
              worldLodCellCount(level.frequency),
              chunkLimits[level.name] * WORLD_LOD_CHUNK_CELL_TARGET,
            )
          : worldLodCellCount(level.frequency),
      },
    ]),
  ) as Record<WorldLodLevelName, WorldLodLevelBudget>;
  const maxActiveChunks = Math.max(...Object.values(chunkLimits));
  return {
    maxActiveCells,
    maxActiveChunks,
    maxVisibleTriangles: maxActiveCells * 18,
    maxGpuBufferBytes: gpuMiB * WORLD_LOD_MIB,
    maxCpuWorkingSetBytes: cpuMiB * WORLD_LOD_MIB,
    maxCachedChunks,
    generationSliceMs,
    maxChunkGenerationMs,
    maxDrawCalls: maxActiveChunks + 1,
    maxMaterials: maxActiveChunks + 1,
    levels,
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(`${label} muss eine positive ganze Zahl sein: ${value}`);
}
