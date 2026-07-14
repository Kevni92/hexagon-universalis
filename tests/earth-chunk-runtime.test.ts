import { describe, expect, it, vi } from 'vitest';

import { EarthChunkRuntime } from '@/data/EarthChunkRuntime';
import { EarthWorldModel } from '@/data/EarthWorldModel';
import type { EarthTileChunk, EarthTilePyramidManifest } from '@/data/tilePyramid';

const fingerprint = 'a'.repeat(64);
const sourceFingerprint = 'b'.repeat(64);

const chunk: EarthTileChunk = {
  formatVersion: 1,
  level: 'global',
  chunkId: 'lvl0-global/root',
  topologyFingerprint: fingerprint,
  sourceFingerprint,
  cells: [
    {
      cellId: 'lvl0-global/root/c0',
      parentCellId: null,
      latitude: 23,
      longitude: 13,
      sampleCount: 1,
      elevationMeters: 300,
      elevationMinMeters: 300,
      elevationMaxMeters: 300,
      elevationP10Meters: 300,
      elevationP90Meters: 300,
      landFraction: 1,
      terrainClass: 'desert',
      terrainFractions: [{ terrainClass: 'desert', fraction: 1 }],
      riverClasses: [],
      hasPoliticalBorder: false,
      qualityFlags: ['complete'],
    },
  ],
};

const chunkText = JSON.stringify(chunk);
const manifest: EarthTilePyramidManifest = {
  formatVersion: 1,
  datasetVersion: 'test-v1',
  topologyFingerprint: fingerprint,
  sourceFingerprint,
  levels: ['global', 'regional', 'local'],
  chunks: [
    {
      level: 'global',
      chunkId: chunk.chunkId,
      path: 'lvl0-global/root.json.gz',
      encoding: 'gzip',
      byteLength: chunkText.length,
      sha256: 'c'.repeat(64),
      cellCount: 1,
    },
  ],
  summaries: [
    { level: 'global', chunkCount: 1, cellCount: 1, compressedBytes: chunkText.length },
    { level: 'regional', chunkCount: 0, cellCount: 0, compressedBytes: 0 },
    { level: 'local', chunkCount: 0, cellCount: 0, compressedBytes: 0 },
  ],
};

describe('EarthChunkRuntime', () => {
  it('loads and validates the manifest before the global bootstrap chunk', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('manifest.json')) return Response.json(manifest);
      return new Response(chunkText, { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const runtime = new EarthChunkRuntime({
      baseUrl: 'https://example.test/earth/v1/',
      fetch: fetcher,
    });

    const loaded = await runtime.loadBootstrap();

    expect(loaded).toEqual(chunk);
    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      '/earth/v1/manifest.json',
      '/earth/v1/lvl0-global/root.json.gz',
    ]);
    expect(runtime.status.phase).toBe('ready');
    expect(runtime.status.datasetVersion).toBe('test-v1');
  });

  it('reuses cached chunks and reports missing manifest entries without a request', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) =>
      String(input).endsWith('manifest.json') ? Response.json(manifest) : new Response(chunkText),
    ) as unknown as typeof fetch;
    const runtime = new EarthChunkRuntime({ baseUrl: 'https://example.test/', fetch: fetcher });
    await runtime.loadBootstrap();
    await runtime.requireChunks([chunk.chunkId]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(runtime.requireChunks(['lvl1-regional/missing'])).rejects.toThrow(/Manifest/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects incompatible manifests with a controlled error status', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...manifest, formatVersion: 99 }),
    ) as unknown as typeof fetch;
    const runtime = new EarthChunkRuntime({ baseUrl: 'https://example.test/', fetch: fetcher });

    await expect(runtime.loadBootstrap()).rejects.toThrow(/Version/);
    expect(runtime.status.phase).toBe('error');
  });
});

describe('EarthWorldModel', () => {
  it('keeps loaded data serializable and maps real terrain to renderer colors', () => {
    const model = new EarthWorldModel();
    model.applyChunk(chunk);

    expect(model.get('lvl0-global/root/c0')?.terrainClass).toBe('desert');
    expect(model.cellColors().get('lvl0-global/root/c0')).toBe('#c9a66b');
    expect(JSON.parse(JSON.stringify(model.toJSON()))).toEqual(chunk.cells);
  });
});
