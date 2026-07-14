import type { TerrainClass } from './terrain';

export const EARTH_TILE_PYRAMID_FORMAT_VERSION = 1;

export type EarthTileLevel = 'global' | 'regional' | 'local';

export type EarthDataQualityFlag =
  | 'complete'
  | 'missing-elevation'
  | 'missing-land-cover'
  | 'missing-hydrography'
  | 'missing-political-data';

export interface TerrainFraction {
  readonly terrainClass: TerrainClass;
  readonly fraction: number;
}

export interface EarthTileCell {
  readonly cellId: string;
  readonly parentCellId: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly sampleCount: number;
  readonly elevationMeters: number;
  readonly elevationMinMeters: number;
  readonly elevationMaxMeters: number;
  readonly elevationP10Meters: number;
  readonly elevationP90Meters: number;
  readonly landFraction: number;
  readonly terrainClass: TerrainClass;
  readonly terrainFractions: readonly TerrainFraction[];
  readonly riverClasses: readonly ('major' | 'regional' | 'detailed')[];
  readonly hasPoliticalBorder: boolean;
  readonly qualityFlags: readonly EarthDataQualityFlag[];
}

export interface EarthTileChunk {
  readonly formatVersion: number;
  readonly level: EarthTileLevel;
  readonly chunkId: string;
  readonly topologyFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cells: readonly EarthTileCell[];
}

export interface EarthTileChunkIndexEntry {
  readonly level: EarthTileLevel;
  readonly chunkId: string;
  readonly path: string;
  readonly encoding: 'gzip';
  readonly byteLength: number;
  readonly sha256: string;
  readonly cellCount: number;
}

export interface EarthTileLevelSummary {
  readonly level: EarthTileLevel;
  readonly chunkCount: number;
  readonly cellCount: number;
  readonly compressedBytes: number;
}

export interface EarthTilePyramidManifest {
  readonly formatVersion: number;
  readonly datasetVersion: string;
  readonly topologyFingerprint: string;
  readonly sourceFingerprint: string;
  readonly levels: readonly EarthTileLevel[];
  readonly chunks: readonly EarthTileChunkIndexEntry[];
  readonly summaries: readonly EarthTileLevelSummary[];
}

const LEVEL_ORDER: Readonly<Record<EarthTileLevel, number>> = {
  global: 0,
  regional: 1,
  local: 2,
};

const TERRAIN_CLASSES: ReadonlySet<string> = new Set([
  'deepWater',
  'shallowWater',
  'coast',
  'grassland',
  'forest',
  'shrubland',
  'desert',
  'wetland',
  'cropland',
  'settlement',
  'snowIce',
  'highland',
  'mountain',
]);

const QUALITY_FLAGS: ReadonlySet<string> = new Set([
  'complete',
  'missing-elevation',
  'missing-land-cover',
  'missing-hydrography',
  'missing-political-data',
]);

export function validateEarthTileChunk(
  chunk: EarthTileChunk,
  expectedTopologyFingerprint?: string,
  expectedSourceFingerprint?: string,
): void {
  if (chunk.formatVersion !== EARTH_TILE_PYRAMID_FORMAT_VERSION)
    throw new Error(`Nicht unterstützte Tile-Pyramiden-Version: ${chunk.formatVersion}.`);
  if (
    expectedTopologyFingerprint !== undefined &&
    chunk.topologyFingerprint !== expectedTopologyFingerprint
  )
    throw new Error('Chunk und Topologie-Fingerprint stimmen nicht überein.');
  if (
    expectedSourceFingerprint !== undefined &&
    chunk.sourceFingerprint !== expectedSourceFingerprint
  )
    throw new Error('Chunk und Quellen-Fingerprint stimmen nicht überein.');
  if (chunk.level === 'global' && chunk.chunkId !== 'lvl0-global/root')
    throw new Error('Die globale Ebene muss als lvl0-global/root ausgeliefert werden.');
  if (
    chunk.level !== 'global' &&
    !chunk.chunkId.startsWith(`lvl${LEVEL_ORDER[chunk.level]}-${chunk.level}/`)
  )
    throw new Error(`Chunk-ID passt nicht zur Ebene ${chunk.level}: ${chunk.chunkId}.`);

  const cellIds = new Set<string>();
  for (const cell of chunk.cells) {
    if (cellIds.has(cell.cellId)) throw new Error(`Doppelte Zell-ID: ${cell.cellId}.`);
    cellIds.add(cell.cellId);
    validateCell(cell, chunk.level);
  }
}

export function validateEarthTilePyramidManifest(manifest: EarthTilePyramidManifest): void {
  if (manifest.formatVersion !== EARTH_TILE_PYRAMID_FORMAT_VERSION)
    throw new Error(`Nicht unterstützte Tile-Pyramiden-Version: ${manifest.formatVersion}.`);
  if (manifest.datasetVersion.trim() === '')
    throw new Error('datasetVersion darf nicht leer sein.');
  if (!isSha256(manifest.topologyFingerprint) || !isSha256(manifest.sourceFingerprint))
    throw new Error('Manifest-Fingerprints müssen SHA-256-Werte sein.');
  if (manifest.levels.join(',') !== 'global,regional,local')
    throw new Error(
      'Die Pyramide muss global, regional und local in dieser Reihenfolge enthalten.',
    );

  const ids = new Set<string>();
  for (const chunk of manifest.chunks) {
    if (ids.has(chunk.chunkId)) throw new Error(`Doppelte Chunk-ID: ${chunk.chunkId}.`);
    ids.add(chunk.chunkId);
    if (!isSha256(chunk.sha256)) throw new Error(`Ungültige Chunk-Prüfsumme: ${chunk.chunkId}.`);
    if (!Number.isInteger(chunk.byteLength) || chunk.byteLength <= 0)
      throw new Error(`Ungültige Chunk-Größe: ${chunk.chunkId}.`);
    if (!Number.isInteger(chunk.cellCount) || chunk.cellCount <= 0)
      throw new Error(`Ungültige Zellzahl: ${chunk.chunkId}.`);
  }

  for (const level of manifest.levels) {
    const chunks = manifest.chunks.filter((chunk) => chunk.level === level);
    const summary = manifest.summaries.find((candidate) => candidate.level === level);
    if (summary === undefined) throw new Error(`Fehlende Größenzusammenfassung: ${level}.`);
    if (
      summary.chunkCount !== chunks.length ||
      summary.cellCount !== chunks.reduce((sum, chunk) => sum + chunk.cellCount, 0) ||
      summary.compressedBytes !== chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    )
      throw new Error(`Inkonsistente Größenzusammenfassung: ${level}.`);
  }
}

function validateCell(cell: EarthTileCell, level: EarthTileLevel): void {
  if (!cell.cellId.startsWith(`lvl${LEVEL_ORDER[level]}-${level}/`))
    throw new Error(`Zell-ID passt nicht zur Ebene ${level}: ${cell.cellId}.`);
  if (level === 'global' ? cell.parentCellId !== null : cell.parentCellId === null)
    throw new Error(`Ungültige Elternreferenz für ${cell.cellId}.`);
  if (!Number.isFinite(cell.latitude) || cell.latitude < -90 || cell.latitude > 90)
    throw new Error(`Ungültige Breite für ${cell.cellId}.`);
  if (!Number.isFinite(cell.longitude) || cell.longitude < -180 || cell.longitude > 180)
    throw new Error(`Ungültige Länge für ${cell.cellId}.`);
  if (!Number.isInteger(cell.sampleCount) || cell.sampleCount < 1)
    throw new Error(`Ungültige Samplezahl für ${cell.cellId}.`);
  if (
    ![
      cell.elevationMeters,
      cell.elevationMinMeters,
      cell.elevationMaxMeters,
      cell.elevationP10Meters,
      cell.elevationP90Meters,
    ].every(Number.isFinite)
  )
    throw new Error(`Ungültige Höhenwerte für ${cell.cellId}.`);
  if (!(
    cell.elevationMinMeters <= cell.elevationP10Meters &&
    cell.elevationP10Meters <= cell.elevationMeters &&
    cell.elevationMeters <= cell.elevationP90Meters &&
    cell.elevationP90Meters <= cell.elevationMaxMeters
  ))
    throw new Error(`Inkonsistente Höhenstatistik für ${cell.cellId}.`);
  if (!Number.isFinite(cell.landFraction) || cell.landFraction < 0 || cell.landFraction > 1)
    throw new Error(`Ungültiger Landanteil für ${cell.cellId}.`);
  if (!TERRAIN_CLASSES.has(cell.terrainClass))
    throw new Error(`Ungültige Terrainklasse für ${cell.cellId}.`);
  const fractionSum = cell.terrainFractions.reduce((sum, item) => sum + item.fraction, 0);
  if (
    cell.terrainFractions.length === 0 ||
    cell.terrainFractions.some(
      (item) => !TERRAIN_CLASSES.has(item.terrainClass) || item.fraction <= 0 || item.fraction > 1,
    ) ||
    Math.abs(fractionSum - 1) > 1e-6
  )
    throw new Error(`Ungültige Terrainanteile für ${cell.cellId}.`);
  if (cell.qualityFlags.length === 0 || cell.qualityFlags.some((flag) => !QUALITY_FLAGS.has(flag)))
    throw new Error(`Ungültige Qualitätsflags für ${cell.cellId}.`);
  if (cell.qualityFlags.includes('complete') && cell.qualityFlags.length !== 1)
    throw new Error(`complete darf keine weiteren Qualitätsflags begleiten: ${cell.cellId}.`);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
