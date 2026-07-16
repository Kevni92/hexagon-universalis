import type { Vector3, GeodesicCell } from '@/topology/geodesic';
import { createCellId, createLevelId } from './identifiers';
import type { WorldLodChunkAddress } from './sevenLevelArchitecture';
import type { LodCell } from './hierarchy';
import type { VisibleUnit } from './WorldLod';

export const ULTRA_DETAIL_FREQUENCY = 144;
export const ULTRA_DETAIL_CELL_COUNT = 10 * ULTRA_DETAIL_FREQUENCY ** 2 + 2;
export const ULTRA_DETAIL_CHUNK_CELL_COUNT = 480;
export const ULTRA_DETAIL_MAX_ACTIVE_CHUNKS = 32;

// The generic legacy CellId contract still models three render levels. Ultra
// keeps its own level-qualified formatted IDs while reusing the local numeric
// identity for the renderer-facing LodCell object.
const DETAIL_LEVEL = createLevelId('local');
const CHUNK_ROWS = 24;
const CHUNK_COLUMNS = 20;
// Der Radius wird aus der mittleren f144-Zellfläche abgeleitet. Der frühere
// Wert war zu klein und ließ zwischen den lokalen Hexen den Substratkörper
// durchscheinen.
const HEX_RADIUS = 0.00485;
// Flat-top layout: columns tile through a half-cell y offset, which keeps the
// shared edges coherent when a chunk is projected onto the local tangent.
const HEX_X_STEP = 1.5 * HEX_RADIUS;
const HEX_Y_STEP = Math.sqrt(3) * HEX_RADIUS;
const CHUNK_WIDTH = CHUNK_COLUMNS * HEX_X_STEP;
const CHUNK_HEIGHT = CHUNK_ROWS * HEX_Y_STEP;

export interface UltraDetailProgress {
  readonly completed: number;
  readonly total: number;
}

/**
 * Erzeugt nur die 480 Zellen eines adressierten Detail-Chunks. Die globale
 * f144-Zellzahl bleibt eine Adressierungsgröße; die vollständige Kugel wird
 * nie materialisiert. Die lokale hexagonale Abtastung wird deterministisch
 * über den sphärischen Fokus und den Chunk-Schlüssel abgeleitet.
 */
export class UltraDetailChunkCache {
  private readonly chunks = new Map<string, VisibleUnit>();

  public get cachedChunkCount(): number {
    return this.chunks.size;
  }

  public clear(): void {
    this.chunks.clear();
  }

  public units(addresses: readonly WorldLodChunkAddress[], focus: Vector3): readonly VisibleUnit[] {
    return addresses.map((address, index) => this.getOrCreate(address, focus, index));
  }

  public async warm(
    addresses: readonly WorldLodChunkAddress[],
    focus: Vector3,
    onProgress?: (progress: UltraDetailProgress) => void,
    onChunkReady?: (unit: VisibleUnit) => void,
  ): Promise<void> {
    const total = addresses.length;
    onProgress?.({ completed: 0, total });
    for (const [index, address] of addresses.entries()) {
      const unit = this.getOrCreate(address, focus, index);
      onChunkReady?.(unit);
      onProgress?.({ completed: index + 1, total });
      await yieldToBrowser();
    }
  }

  private getOrCreate(address: WorldLodChunkAddress, focus: Vector3, ordinal: number): VisibleUnit {
    const cached = this.chunks.get(address.chunkKey);
    if (cached !== undefined) return cached;

    const unit = createChunkUnit(address, focus, ordinal);
    this.chunks.set(address.chunkKey, unit);
    return unit;
  }
}

function createChunkUnit(
  address: WorldLodChunkAddress,
  focus: Vector3,
  ordinal: number,
): VisibleUnit {
  const frame = tangentFrame(focus);
  const offset = chunkOffset(ordinal);
  const chunkHash = hashText(address.chunkKey);
  const cells: LodCell[] = [];

  for (let row = 0; row < CHUNK_ROWS; row += 1) {
    for (let column = 0; column < CHUNK_COLUMNS; column += 1) {
      const index = row * CHUNK_COLUMNS + column;
      const localX = offset.x + (column - (CHUNK_COLUMNS - 1) / 2) * HEX_X_STEP;
      const localY =
        offset.y +
        (row - (CHUNK_ROWS - 1) / 2) * HEX_Y_STEP +
        (column % 2 === 0 ? 0 : HEX_Y_STEP / 2);
      const cellCenter = project(frame, localX, localY);
      const cellId = createCellId(
        DETAIL_LEVEL,
        chunkHash * ULTRA_DETAIL_CHUNK_CELL_COUNT + index,
        chunkHash,
      );
      const formattedId = formatUltraCellId(chunkHash, index);
      const boundary = Array.from({ length: 6 }, (_value, boundaryIndex) => {
        const angle = (boundaryIndex * Math.PI) / 3;
        return project(
          frame,
          localX + Math.cos(angle) * HEX_RADIUS,
          localY + Math.sin(angle) * HEX_RADIUS,
        );
      });
      const neighborIds = neighborIndices(row, column)
        .map((neighborIndex) => {
          return formatUltraCellId(chunkHash, neighborIndex);
        })
        .filter((neighborId) => neighborId !== formattedId);
      const cell: GeodesicCell = {
        id: formattedId,
        center: cellCenter,
        boundary,
        neighborIds,
        type: 'hexagon',
      };
      cells.push({ id: cellId, formattedId, cell, parentIndex: chunkHash });
    }
  }

  const key = address.chunkKey;
  return {
    key,
    level: 3,
    cells,
    cellIds: cells.map((cell) => `${key}/${cell.formattedId}`),
  };
}

function formatUltraCellId(chunkHash: number, index: number): string {
  return `lvl6-detail/p${chunkHash}/c${index}`;
}

function neighborIndices(row: number, column: number): readonly number[] {
  const candidates =
    column % 2 === 0
      ? [
          [row, column - 1],
          [row - 1, column - 1],
          [row - 1, column],
          [row, column + 1],
          [row + 1, column],
          [row + 1, column - 1],
        ]
      : [
          [row - 1, column - 1],
          [row, column - 1],
          [row - 1, column],
          [row, column + 1],
          [row + 1, column + 1],
          [row + 1, column],
        ];
  return candidates
    .filter(
      ([candidateRow, candidateColumn]) =>
        candidateRow !== undefined &&
        candidateColumn !== undefined &&
        candidateRow >= 0 &&
        candidateRow < CHUNK_ROWS &&
        candidateColumn >= 0 &&
        candidateColumn < CHUNK_COLUMNS,
    )
    .map(([candidateRow, candidateColumn]) => candidateRow! * CHUNK_COLUMNS + candidateColumn!);
}

function chunkOffset(ordinal: number): { readonly x: number; readonly y: number } {
  const column = ordinal % 4;
  const row = Math.floor(ordinal / 4);
  return {
    x: (column - 1.5) * CHUNK_WIDTH,
    y: (row - 3.5) * CHUNK_HEIGHT,
  };
}

interface TangentFrame {
  readonly up: Vector3;
  readonly east: Vector3;
  readonly north: Vector3;
}

function tangentFrame(focus: Vector3): TangentFrame {
  const up = normalize(focus);
  const reference = Math.abs(up.y) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const east = normalize(cross(reference, up));
  return { up, east, north: normalize(cross(up, east)) };
}

function project(frame: TangentFrame, x: number, y: number): Vector3 {
  const distance = Math.hypot(x, y);
  if (distance === 0) return frame.up;
  const tangent = normalize(add(scale(frame.east, x), scale(frame.north, y)));
  return normalize(add(scale(frame.up, Math.cos(distance)), scale(tangent, Math.sin(distance))));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 0) throw new RangeError('Ein Detailvektor darf nicht null sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function add(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
