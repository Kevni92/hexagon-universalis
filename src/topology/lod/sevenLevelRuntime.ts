import { cameraFocusDirection, type CameraState } from './selection';
import {
  createWorldLodLevelId,
  formatWorldLodLevelId,
  WORLD_LOD_CHUNK_CELL_TARGET,
  WORLD_LOD_LEVELS,
  WORLD_LOD_PLATFORM_BUDGETS,
  worldLodCellCount,
  worldLodLevel,
  type WorldLodChunkAddress,
  type WorldLodLevelDefinition,
  type WorldLodLevelName,
  type WorldLodPlatform,
  type WorldLodPlatformBudget,
} from './sevenLevelArchitecture';

export interface SevenLevelRuntimeConfig {
  readonly platform: WorldLodPlatform;
  readonly refineAbovePx: number;
  readonly coarsenBelowPx: number;
  readonly maxLevel: WorldLodLevelName;
}

export interface SevenLevelRuntimeFrame {
  readonly level: WorldLodLevelDefinition;
  readonly projectedCellSizePx: number;
  readonly activeChunks: readonly WorldLodChunkAddress[];
  readonly maxActiveCells: number;
  readonly estimatedActiveCells: number;
  readonly budget: WorldLodPlatformBudget;
}

const DEFAULT_RUNTIME_CONFIG: SevenLevelRuntimeConfig = {
  platform: 'desktop',
  refineAbovePx: 42,
  coarsenBelowPx: 28,
  maxLevel: 'detail',
};

/**
 * Runtime-Auswahl für ADR 0002/#97: pro Frame wird genau eine der sieben
 * Weltauflösungen aktiv. Chunk-Adressen bleiben projektionsneutral und werden
 * aus Fokuspunkt, Plattformbudget und Stufendichte abgeleitet; Geometrie- und
 * Projektionsmaterialisierung kann diese Adressen danach in Globe oder Flat
 * auflösen.
 */
export class SevenLevelWorldLodRuntime {
  private activeLevelName: WorldLodLevelName = 'global';

  public constructor(private readonly config: Partial<SevenLevelRuntimeConfig> = {}) {}

  public update(camera: CameraState): SevenLevelRuntimeFrame {
    const runtimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...this.config };
    const budget = WORLD_LOD_PLATFORM_BUDGETS[runtimeConfig.platform];
    const level = this.nextLevel(camera, runtimeConfig);
    const projectedCellSize = projectedMeanCellSizePx(level, camera);
    const activeChunks = selectActiveChunkAddresses(level, camera, budget);
    const estimatedActiveCells = level.chunked
      ? Math.min(
          worldLodCellCount(level.frequency),
          activeChunks.length * WORLD_LOD_CHUNK_CELL_TARGET,
        )
      : worldLodCellCount(level.frequency);

    return {
      level,
      projectedCellSizePx: projectedCellSize,
      activeChunks,
      maxActiveCells: budget.levels[level.name].maxActiveCells,
      estimatedActiveCells,
      budget,
    };
  }

  public reset(level: WorldLodLevelName = 'global'): void {
    this.activeLevelName = worldLodLevel(level).name;
  }

  private nextLevel(camera: CameraState, config: SevenLevelRuntimeConfig): WorldLodLevelDefinition {
    let currentIndex = WORLD_LOD_LEVELS.findIndex((level) => level.name === this.activeLevelName);
    if (currentIndex < 0) currentIndex = 0;

    const maximumIndex = WORLD_LOD_LEVELS.findIndex((level) => level.name === config.maxLevel);
    const cappedIndex = maximumIndex < 0 ? WORLD_LOD_LEVELS.length - 1 : maximumIndex;

    while (currentIndex < cappedIndex) {
      const current = WORLD_LOD_LEVELS[currentIndex]!;
      if (projectedMeanCellSizePx(current, camera) <= config.refineAbovePx) break;
      currentIndex += 1;
    }

    while (currentIndex > 0) {
      const previous = WORLD_LOD_LEVELS[currentIndex - 1]!;
      if (projectedMeanCellSizePx(previous, camera) >= config.coarsenBelowPx) break;
      currentIndex -= 1;
    }

    this.activeLevelName = WORLD_LOD_LEVELS[currentIndex]!.name;
    return WORLD_LOD_LEVELS[currentIndex]!;
  }
}

export function projectedMeanCellSizePx(
  level: WorldLodLevelDefinition,
  camera: CameraState,
): number {
  const focus = cameraFocusDirection(camera);
  const distance = Math.hypot(
    camera.position.x - focus.x * camera.sphereRadius,
    camera.position.y - focus.y * camera.sphereRadius,
    camera.position.z - focus.z * camera.sphereRadius,
  );
  if (distance <= 0) return Infinity;
  const meanAngularRadius = Math.sqrt((4 * Math.PI) / worldLodCellCount(level.frequency)) / 2;
  const focalLengthPx = camera.viewportHeight / (2 * Math.tan(camera.fovY / 2));
  return ((meanAngularRadius * camera.sphereRadius) / distance) * focalLengthPx;
}

export function selectActiveChunkAddresses(
  level: WorldLodLevelDefinition,
  camera: CameraState,
  budget: WorldLodPlatformBudget,
): readonly WorldLodChunkAddress[] {
  const levelId = createWorldLodLevelId(level.name);
  if (!level.chunked) return [{ level: levelId, chunkKey: 'root', parentKey: null }];

  const focus = cameraFocusDirection(camera);
  const levelBudget = budget.levels[level.name];
  const chunkCount = Math.max(
    1,
    Math.min(
      levelBudget.maxActiveChunks,
      Math.ceil(levelBudget.maxActiveCells / WORLD_LOD_CHUNK_CELL_TARGET),
    ),
  );
  const focusKey = focusChunkKey(level, focus);
  const parentKey = parentChunkKey(level, focus);
  return Array.from({ length: chunkCount }, (_value, offset) => ({
    level: levelId,
    chunkKey: offset === 0 ? focusKey : `${focusKey}/ring-${offset}`,
    parentKey,
  }));
}

function focusChunkKey(
  level: WorldLodLevelDefinition,
  focus: { x: number; y: number; z: number },
): string {
  const latitude = Math.asin(clamp(focus.y, -1, 1));
  const longitude = Math.atan2(focus.x, focus.z);
  const bands = Math.max(
    1,
    Math.round(Math.sqrt(worldLodCellCount(level.frequency) / WORLD_LOD_CHUNK_CELL_TARGET)),
  );
  const rows = bands * 2;
  const columns = bands * 4;
  const row = clampIndex(Math.floor(((latitude + Math.PI / 2) / Math.PI) * rows), rows);
  const column = clampIndex(Math.floor(((longitude + Math.PI) / (2 * Math.PI)) * columns), columns);
  return `${formatWorldLodLevelId(createWorldLodLevelId(level.name))}/b${row}/q${column}`;
}

function parentChunkKey(
  level: WorldLodLevelDefinition,
  focus: { x: number; y: number; z: number },
): string | null {
  const parent = WORLD_LOD_LEVELS[level.depth - 1];
  if (parent === undefined) return null;
  return parent.chunked ? focusChunkKey(parent, focus) : 'root';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampIndex(value: number, length: number): number {
  return Math.min(length - 1, Math.max(0, value));
}
