export type ResolutionLevelName = 'global' | 'regional' | 'local';

export interface LevelId {
  readonly name: ResolutionLevelName;
  readonly depth: number;
}

export interface CellId {
  readonly level: LevelId;
  readonly index: number;
  readonly parentIndex: number | null;
}

export interface ChunkId {
  readonly level: LevelId;
  readonly parentIndex: number;
}

const LEVEL_DEPTH: Readonly<Record<ResolutionLevelName, number>> = {
  global: 0,
  regional: 1,
  local: 2,
};

const LEVEL_NAME_BY_DEPTH: Readonly<Record<number, ResolutionLevelName>> = {
  0: 'global',
  1: 'regional',
  2: 'local',
};

const LEVEL_ID_PATTERN = /^lvl(\d+)-(global|regional|local)$/;
const CELL_ID_PATTERN = /^lvl(\d+)-(global|regional|local)\/(root|p\d+)\/c(\d+)$/;
const CHUNK_ID_PATTERN = /^lvl(\d+)-(global|regional|local)\/chunk-p(\d+)$/;

export function createLevelId(name: ResolutionLevelName): LevelId {
  return { name, depth: LEVEL_DEPTH[name] };
}

export function formatLevelId(level: LevelId): string {
  return `lvl${level.depth}-${level.name}`;
}

export function parseLevelId(value: string): LevelId {
  const match = LEVEL_ID_PATTERN.exec(value);
  if (match === null) throw new SyntaxError(`Ungültige LevelId: ${value}`);
  const [, depthText, name] = match;
  const depth = Number(depthText);
  const level = createLevelId(name as ResolutionLevelName);
  if (level.depth !== depth) throw new SyntaxError(`LevelId-Tiefe passt nicht zu Name: ${value}`);
  return level;
}

export function createCellId(
  level: LevelId,
  index: number,
  parentIndex: number | null = null,
): CellId {
  validateNonNegativeInteger(index, 'index');
  if (parentIndex !== null) validateNonNegativeInteger(parentIndex, 'parentIndex');
  if (level.depth === 0 && parentIndex !== null)
    throw new RangeError('Zellen der globalen Ebene dürfen keine parentIndex besitzen.');
  if (level.depth > 0 && parentIndex === null)
    throw new RangeError('Zellen unterhalb der globalen Ebene benötigen eine parentIndex.');
  return { level, index, parentIndex };
}

export function formatCellId(cell: CellId): string {
  const parentSegment = cell.parentIndex === null ? 'root' : `p${cell.parentIndex}`;
  return `${formatLevelId(cell.level)}/${parentSegment}/c${cell.index}`;
}

export function parseCellId(value: string): CellId {
  const match = CELL_ID_PATTERN.exec(value);
  if (match === null) throw new SyntaxError(`Ungültige CellId: ${value}`);
  const [, depthText, name, parentSegment = '', indexText] = match;
  const level = createLevelId(name as ResolutionLevelName);
  if (level.depth !== Number(depthText))
    throw new SyntaxError(`CellId-Tiefe passt nicht zu Name: ${value}`);
  const parentIndex = parentSegment === 'root' ? null : Number(parentSegment.slice(1));
  return createCellId(level, Number(indexText), parentIndex);
}

export function createChunkId(level: LevelId, parentIndex: number): ChunkId {
  validateNonNegativeInteger(parentIndex, 'parentIndex');
  if (level.depth === 0) throw new RangeError('Die globale Ebene wird nicht in Chunks unterteilt.');
  return { level, parentIndex };
}

export function formatChunkId(chunk: ChunkId): string {
  return `${formatLevelId(chunk.level)}/chunk-p${chunk.parentIndex}`;
}

export function parseChunkId(value: string): ChunkId {
  const match = CHUNK_ID_PATTERN.exec(value);
  if (match === null) throw new SyntaxError(`Ungültige ChunkId: ${value}`);
  const [, depthText, name, parentIndexText] = match;
  const level = createLevelId(name as ResolutionLevelName);
  if (level.depth !== Number(depthText))
    throw new SyntaxError(`ChunkId-Tiefe passt nicht zu Name: ${value}`);
  return createChunkId(level, Number(parentIndexText));
}

export function levelIdFromDepth(depth: number): LevelId {
  const name = LEVEL_NAME_BY_DEPTH[depth];
  if (name === undefined) throw new RangeError(`Keine Ebene für Tiefe ${depth} definiert.`);
  return createLevelId(name);
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${label} muss eine nichtnegative ganze Zahl sein: ${value}`);
}
