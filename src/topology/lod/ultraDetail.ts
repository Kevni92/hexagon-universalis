import { createGeodesicTopology, type Vector3, type GeodesicCell } from '@/topology/geodesic';
import { createCellId, createLevelId } from './identifiers';
import type { WorldLodChunkAddress, WorldLodLevelName } from './sevenLevelArchitecture';
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
const GLOBAL_LEVEL = createLevelId('global');
const CHUNK_ROWS = 24;
const CHUNK_COLUMNS = 20;

export interface DetailChunkProfile {
  readonly worldLevel: Exclude<WorldLodLevelName, 'global'>;
  readonly frequency: number;
  readonly rows: number;
  readonly columns: number;
}

export const ULTRA_DETAIL_CHUNK_PROFILE: DetailChunkProfile = {
  worldLevel: 'detail',
  frequency: ULTRA_DETAIL_FREQUENCY,
  rows: CHUNK_ROWS,
  columns: CHUNK_COLUMNS,
};

export const ULTRA_INTERMEDIATE_CHUNK_PROFILES: Readonly<
  Record<Exclude<WorldLodLevelName, 'global' | 'detail'>, DetailChunkProfile>
> = {
  continental: { worldLevel: 'continental', frequency: 13, rows: 16, columns: 32 },
  macroregional: { worldLevel: 'macroregional', frequency: 21, rows: 16, columns: 32 },
  regional: { worldLevel: 'regional', frequency: 34, rows: 16, columns: 32 },
  subregional: { worldLevel: 'subregional', frequency: 55, rows: 16, columns: 32 },
  local: { worldLevel: 'local', frequency: 89, rows: 16, columns: 32 },
};

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
  private readonly fullUnitsByProfile = new Map<string, VisibleUnit>();
  private readonly metadata = new Map<
    string,
    { readonly focusKey: string; readonly profileKey: string }
  >();
  private readyUnits: readonly VisibleUnit[] = [];
  private readyKey = '';
  private readyProfileKey = '';
  private pendingKey = '';
  private requestToken = 0;
  private revisionValue = 0;

  public get cachedChunkCount(): number {
    return this.chunks.size;
  }

  public get revision(): number {
    return this.revisionValue;
  }

  public clear(): void {
    this.chunks.clear();
    this.fullUnitsByProfile.clear();
    this.metadata.clear();
    this.readyUnits = [];
    this.readyKey = '';
    this.readyProfileKey = '';
    this.pendingKey = '';
    this.requestToken += 1;
  }

  public units(
    addresses: readonly WorldLodChunkAddress[],
    focus: Vector3,
    profile: DetailChunkProfile = ULTRA_DETAIL_CHUNK_PROFILE,
  ): readonly VisibleUnit[] {
    return addresses.map((address, index) =>
      this.getOrCreate(address, focus, index, addresses.length, profile),
    );
  }

  /** Hält den letzten vollständigen Satz sichtbar, während der nächste Satz streamt. */
  public request(
    addresses: readonly WorldLodChunkAddress[],
    focus: Vector3,
    profile: DetailChunkProfile = ULTRA_DETAIL_CHUNK_PROFILE,
  ): readonly VisibleUnit[] {
    const key = requestKey(addresses, focus, profile);
    const profileKey = profileIdentity(profile);
    if (key === this.readyKey) return this.readyUnits;

    if (this.readyProfileKey !== profileKey || this.readyUnits.length === 0) {
      const units = this.units(addresses, focus, profile);
      this.activate(key, profileKey, units);
      return units;
    }

    if (this.pendingKey !== key) {
      this.pendingKey = key;
      const token = ++this.requestToken;
      void this.warm(addresses, focus, undefined, undefined, profile).then(() => {
        if (token !== this.requestToken || this.pendingKey !== key) return;
        this.activate(key, profileKey, this.units(addresses, focus, profile));
        this.pendingKey = '';
      });
    }
    return this.readyUnits;
  }

  public activate(key: string, profileKey: string, units: readonly VisibleUnit[]): void {
    this.readyKey = key;
    this.readyProfileKey = profileKey;
    this.readyUnits = units;
    this.revisionValue += 1;
  }

  public activateReady(
    addresses: readonly WorldLodChunkAddress[],
    focus: Vector3,
    profile: DetailChunkProfile = ULTRA_DETAIL_CHUNK_PROFILE,
  ): readonly VisibleUnit[] {
    const units = this.units(addresses, focus, profile);
    this.activate(requestKey(addresses, focus, profile), profileIdentity(profile), units);
    return units;
  }

  public fullUnit(profile: DetailChunkProfile): VisibleUnit {
    const profileKey = profileIdentity(profile);
    const cached = this.fullUnitsByProfile.get(profileKey);
    if (cached !== undefined) return cached;
    const key = `lvl${levelDepth(profile.worldLevel)}-${profile.worldLevel}/full`;
    // f34 is the highest complete intermediate topology. f55+ remains
    // chunk-addressed and is never materialized as one full sphere.
    const topology = createGeodesicTopology(profile.frequency);
    const cells = topology.cells.map((cell, index) => {
      const formattedId = `${key}/c${index}`;
      const lodCell: LodCell = {
        id: createCellId(GLOBAL_LEVEL, index, null),
        formattedId,
        cell,
        parentIndex: null,
      };
      return lodCell;
    });
    const unit: VisibleUnit = {
      key,
      level: profile.worldLevel === 'local' ? 2 : 1,
      worldLevel: profile.worldLevel,
      cells,
      cellIds: cells.map((cell) => cell.formattedId),
    };
    this.fullUnitsByProfile.set(profileKey, unit);
    return unit;
  }

  public async warm(
    addresses: readonly WorldLodChunkAddress[],
    focus: Vector3,
    onProgress?: (progress: UltraDetailProgress) => void,
    onChunkReady?: (unit: VisibleUnit) => void,
    profile: DetailChunkProfile = ULTRA_DETAIL_CHUNK_PROFILE,
  ): Promise<void> {
    const total = addresses.length;
    onProgress?.({ completed: 0, total });
    for (const [index, address] of addresses.entries()) {
      const unit = this.getOrCreate(address, focus, index, addresses.length, profile);
      onChunkReady?.(unit);
      onProgress?.({ completed: index + 1, total });
      await yieldToBrowser();
    }
  }

  private getOrCreate(
    address: WorldLodChunkAddress,
    focus: Vector3,
    ordinal: number,
    chunkCount: number,
    profile: DetailChunkProfile,
  ): VisibleUnit {
    const focusKey = vectorKey(focus);
    const profileKey = profileIdentity(profile);
    const cached = this.chunks.get(address.chunkKey);
    const cachedMetadata = this.metadata.get(address.chunkKey);
    if (
      cached !== undefined &&
      cachedMetadata?.focusKey === focusKey &&
      cachedMetadata.profileKey === profileKey
    )
      return cached;

    const unit = createChunkUnit(address, focus, ordinal, chunkCount, profile);
    this.chunks.set(address.chunkKey, unit);
    this.metadata.set(address.chunkKey, { focusKey, profileKey });
    this.prune();
    return unit;
  }

  private prune(): void {
    const maximumCachedChunks = ULTRA_DETAIL_MAX_ACTIVE_CHUNKS * 2;
    while (this.chunks.size > maximumCachedChunks) {
      const oldest = this.chunks.keys().next().value;
      if (oldest === undefined) break;
      this.chunks.delete(oldest);
      this.metadata.delete(oldest);
    }
  }
}

function createChunkUnit(
  address: WorldLodChunkAddress,
  focus: Vector3,
  ordinal: number,
  chunkCount: number,
  profile: DetailChunkProfile,
): VisibleUnit {
  const frame = tangentFrame(focus);
  const hexRadius = hexRadiusFor(profile.frequency);
  const hexXStep = 1.5 * hexRadius;
  const hexYStep = Math.sqrt(3) * hexRadius;
  const offset = chunkOffset(
    ordinal,
    profile.columns * hexXStep,
    profile.rows * hexYStep,
    chunkCount,
  );
  const chunkHash = hashText(address.chunkKey);
  const cells: LodCell[] = [];

  for (let row = 0; row < profile.rows; row += 1) {
    for (let column = 0; column < profile.columns; column += 1) {
      const index = row * profile.columns + column;
      const localX = offset.x + (column - (profile.columns - 1) / 2) * hexXStep;
      const localY =
        offset.y +
        (row - (profile.rows - 1) / 2) * hexYStep +
        (column % 2 === 0 ? 0 : hexYStep / 2);
      const cellCenter = project(frame, localX, localY);
      const cellId = createCellId(
        DETAIL_LEVEL,
        chunkHash * profile.rows * profile.columns + index,
        chunkHash,
      );
      const formattedId = formatUltraCellId(profile.worldLevel, chunkHash, index);
      const boundary = Array.from({ length: 6 }, (_value, boundaryIndex) => {
        const angle = (boundaryIndex * Math.PI) / 3;
        return project(
          frame,
          localX + Math.cos(angle) * hexRadius,
          localY + Math.sin(angle) * hexRadius,
        );
      });
      const neighborIds = neighborIndices(row, column, profile.rows, profile.columns)
        .map((neighborIndex) => {
          return formatUltraCellId(profile.worldLevel, chunkHash, neighborIndex);
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
    level: profile.worldLevel === 'detail' ? 3 : profile.worldLevel === 'local' ? 2 : 1,
    worldLevel: profile.worldLevel,
    cells,
    cellIds: cells.map((cell) => `${key}/${cell.formattedId}`),
  };
}

function formatUltraCellId(
  worldLevel: WorldLodLevelName,
  chunkHash: number,
  index: number,
): string {
  const depth = levelDepth(worldLevel);
  return `lvl${depth}-${worldLevel}/p${chunkHash}/c${index}`;
}

function levelDepth(worldLevel: WorldLodLevelName): number {
  return worldLevel === 'detail'
    ? 6
    : worldLevel === 'local'
      ? 5
      : worldLevel === 'subregional'
        ? 4
        : worldLevel === 'regional'
          ? 3
          : worldLevel === 'macroregional'
            ? 2
            : worldLevel === 'continental'
              ? 1
              : 0;
}

function neighborIndices(
  row: number,
  column: number,
  rows: number,
  columns: number,
): readonly number[] {
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
        candidateRow < rows &&
        candidateColumn >= 0 &&
        candidateColumn < columns,
    )
    .map(([candidateRow, candidateColumn]) => candidateRow! * columns + candidateColumn!);
}

function chunkOffset(
  ordinal: number,
  chunkWidth: number,
  chunkHeight: number,
  chunkCount: number,
): { readonly x: number; readonly y: number } {
  const column = ordinal % 4;
  const row = Math.floor(ordinal / 4);
  const gridRows = Math.ceil(chunkCount / 4);
  return {
    x: (column - 1.5) * chunkWidth,
    y: (row - (gridRows - 1) / 2) * chunkHeight,
  };
}

function hexRadiusFor(frequency: number): number {
  return 0.00485 * (ULTRA_DETAIL_FREQUENCY / frequency);
}

function vectorKey(vector: Vector3): string {
  return [vector.x, vector.y, vector.z].map((value) => Math.round(value * 1000) / 1000).join(',');
}

function profileIdentity(profile: DetailChunkProfile): string {
  return `${profile.worldLevel}:${profile.frequency}:${profile.rows}:${profile.columns}`;
}

function requestKey(
  addresses: readonly WorldLodChunkAddress[],
  focus: Vector3,
  profile: DetailChunkProfile,
): string {
  return `${profileIdentity(profile)}:${vectorKey(focus)}:${addresses
    .map((address) => address.chunkKey)
    .join('|')}`;
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
