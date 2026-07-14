import { describe, expect, it } from 'vitest';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  validateEarthTileChunk,
  validateEarthTilePyramidManifest,
  type EarthTileChunk,
  type EarthTilePyramidManifest,
} from '@/data/tilePyramid';

const pipelineModule = fileURLToPath(new URL('../scripts/data/tile-pyramid.mjs', import.meta.url));
const verifyModule = fileURLToPath(
  new URL('../scripts/data/verify-tile-pyramid.mjs', import.meta.url),
);
const inputPath = fileURLToPath(new URL('../data/pyramid/reference-input.json', import.meta.url));
const productionDirectory = fileURLToPath(new URL('../public/data/earth/v1', import.meta.url));

describe('multi-level earth tile pyramid', () => {
  it('builds identical compressed chunks and checksums from identical inputs', async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), 'earth-pyramid-a-'));
    const secondDirectory = await mkdtemp(join(tmpdir(), 'earth-pyramid-b-'));
    try {
      const { buildTilePyramid } = await import(pipelineModule);
      const first = (await buildTilePyramid({
        inputPath,
        outputDirectory: firstDirectory,
      })) as EarthTilePyramidManifest;
      const second = (await buildTilePyramid({
        inputPath,
        outputDirectory: secondDirectory,
      })) as EarthTilePyramidManifest;
      expect(second).toEqual(first);
      for (const chunk of first.chunks) {
        const firstBytes = await readFile(join(firstDirectory, chunk.path));
        const secondBytes = await readFile(join(secondDirectory, chunk.path));
        expect(secondBytes).toEqual(firstBytes);
      }
    } finally {
      await Promise.all([
        rm(firstDirectory, { recursive: true, force: true }),
        rm(secondDirectory, { recursive: true, force: true }),
      ]);
    }
  });

  it('indexes all levels with unique hierarchy-qualified chunks and valid fingerprints', async () => {
    const manifest = await loadManifest();
    expect(() => validateEarthTilePyramidManifest(manifest)).not.toThrow();
    expect(new Set(manifest.chunks.map((chunk) => chunk.chunkId)).size).toBe(
      manifest.chunks.length,
    );
    expect(manifest.chunks.filter((chunk) => chunk.level === 'global')).toHaveLength(1);
    expect(
      manifest.chunks
        .filter((chunk) => chunk.level === 'local')
        .every((chunk) => chunk.chunkId.includes('lvl1-regional')),
    ).toBe(true);
  });

  it('recognizes required real-world reference regions on every level', async () => {
    const cells = await loadAllCells();
    for (const level of ['lvl0-global', 'lvl1-regional', 'lvl2-local']) {
      const levelCells = cells.filter((cell) => cell.cellId.startsWith(level));
      expect(findNear(levelCells, 27.9881, 86.925).elevationMaxMeters).toBeGreaterThan(8_000);
      expect(findNear(levelCells, 46.8, 9.8).elevationMeters).toBeGreaterThan(1_500);
      expect(findNear(levelCells, 23.4, 13).terrainClass).toBe('desert');
      expect(findNear(levelCells, -3.1, -60).terrainClass).toBe('forest');
      expect(findNear(levelCells, -82, 20).terrainClass).toBe('snowIce');
      expect(findNear(levelCells, 72, -40).terrainClass).toBe('snowIce');
      expect(findNear(levelCells, 0, 179.8).landFraction).toBe(0);
    }
  });

  it('keeps coasts, poles and antimeridian values valid and parent-consistent', async () => {
    const cells = await loadAllCells();
    const coastalCells = cells.filter((cell) => Math.abs(cell.latitude - 51.2) < 0.01);
    expect(coastalCells).toHaveLength(3);
    expect(coastalCells.every((cell) => cell.landFraction === 0.5)).toBe(true);
    expect(coastalCells.every((cell) => cell.terrainFractions.length === 2)).toBe(true);
    const datelineCells = cells.filter((cell) => Math.abs(cell.latitude) < 0.01);
    expect(datelineCells).toHaveLength(3);
    expect(datelineCells.every((cell) => cell.longitude === 179.8)).toBe(true);
    expect(cells.every((cell) => cell.latitude >= -90 && cell.latitude <= 90)).toBe(true);
  });

  it('verifies production checksums, budgets and absence of raw GIS files', async () => {
    const { verifyTilePyramid } = await import(verifyModule);
    const result = (await verifyTilePyramid(productionDirectory)) as {
      chunkCount: number;
      totalBytes: number;
    };
    expect(result.chunkCount).toBeGreaterThan(2);
    expect(result.totalBytes).toBeLessThan(8_000_000);
  });

  it('rejects invalid cell ranges, fingerprints and summary totals', async () => {
    const manifest = await loadManifest();
    const chunk = (await loadChunk(manifest.chunks[0]?.path ?? '')) as EarthTileChunk;
    expect(() =>
      validateEarthTileChunk(chunk, manifest.topologyFingerprint, manifest.sourceFingerprint),
    ).not.toThrow();
    expect(() =>
      validateEarthTileChunk({
        ...chunk,
        cells: [{ ...chunk.cells[0]!, landFraction: 2 }],
      }),
    ).toThrow(/Landanteil/);
    expect(() =>
      validateEarthTilePyramidManifest({
        ...manifest,
        summaries: manifest.summaries.map((summary, index) =>
          index === 0 ? { ...summary, compressedBytes: summary.compressedBytes + 1 } : summary,
        ),
      }),
    ).toThrow(/Größenzusammenfassung/);
  });
});

async function loadManifest(): Promise<EarthTilePyramidManifest> {
  return JSON.parse(
    await readFile(join(productionDirectory, 'manifest.json'), 'utf8'),
  ) as EarthTilePyramidManifest;
}

async function loadAllCells(): Promise<EarthTileChunk['cells']> {
  const manifest = await loadManifest();
  const chunks = await Promise.all(manifest.chunks.map((entry) => loadChunk(entry.path)));
  return chunks.flatMap((chunk) => chunk.cells);
}

async function loadChunk(path: string): Promise<EarthTileChunk> {
  const compressed = await readFile(join(productionDirectory, path));
  return JSON.parse(gunzipSync(compressed).toString('utf8')) as EarthTileChunk;
}

function findNear(
  cells: EarthTileChunk['cells'],
  latitude: number,
  longitude: number,
): EarthTileChunk['cells'][number] {
  const cell = cells.find(
    (candidate) =>
      Math.abs(candidate.latitude - latitude) < 0.01 &&
      longitudeDistance(candidate.longitude, longitude) < 0.01,
  );
  if (cell === undefined) throw new Error(`Referenzzelle fehlt: ${latitude}, ${longitude}.`);
  return cell;
}

function longitudeDistance(first: number, second: number): number {
  return Math.abs(((((first - second + 540) % 360) + 360) % 360) - 180);
}
