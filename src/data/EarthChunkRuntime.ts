import {
  validateEarthTileChunk,
  validateEarthTilePyramidManifest,
  type EarthTileChunk,
  type EarthTileChunkIndexEntry,
  type EarthTilePyramidManifest,
} from './tilePyramid';

export type EarthRuntimePhase = 'idle' | 'manifest' | 'bootstrap' | 'ready' | 'degraded' | 'error';

export interface EarthRuntimeStatus {
  readonly phase: EarthRuntimePhase;
  readonly datasetVersion: string | null;
  readonly activeRequests: number;
  readonly cachedChunks: number;
  readonly message: string;
}

export interface EarthChunkRuntimeOptions {
  readonly baseUrl?: string;
  readonly maxConcurrentRequests?: number;
  readonly maxCachedChunks?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = `${import.meta.env.BASE_URL}data/earth/v1/`;

/**
 * Browserseitiger Loader fuer die statische, versionierte Tile-Pyramide.
 * Manifest und globaler Bootstrap werden strikt priorisiert; Detailanfragen
 * sind generationengebunden, begrenzt parallel und koennen abgebrochen werden.
 */
export class EarthChunkRuntime {
  private readonly baseUrl: string;
  private readonly maxConcurrentRequests: number;
  private readonly maxCachedChunks: number;
  private readonly fetcher: typeof fetch;
  private readonly cache = new Map<string, EarthTileChunk>();
  private readonly pending = new Map<string, Promise<EarthTileChunk>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly listeners = new Set<(status: EarthRuntimeStatus) => void>();
  private manifestValue: EarthTilePyramidManifest | null = null;
  private manifestPromise: Promise<EarthTilePyramidManifest> | null = null;
  private activeRequests = 0;
  private generation = 0;
  private disposed = false;
  private statusValue: EarthRuntimeStatus = {
    phase: 'idle',
    datasetVersion: null,
    activeRequests: 0,
    cachedChunks: 0,
    message: 'Erdaten noch nicht geladen.',
  };

  public constructor(options: EarthChunkRuntimeOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 4;
    this.maxCachedChunks = options.maxCachedChunks ?? 24;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (!Number.isInteger(this.maxConcurrentRequests) || this.maxConcurrentRequests < 1)
      throw new RangeError('maxConcurrentRequests muss mindestens 1 sein.');
    if (!Number.isInteger(this.maxCachedChunks) || this.maxCachedChunks < 1)
      throw new RangeError('maxCachedChunks muss mindestens 1 sein.');
  }

  public get status(): EarthRuntimeStatus {
    return this.statusValue;
  }

  public get manifest(): EarthTilePyramidManifest | null {
    return this.manifestValue;
  }

  public subscribe(listener: (status: EarthRuntimeStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.statusValue);
    return () => this.listeners.delete(listener);
  }

  public async loadBootstrap(): Promise<EarthTileChunk> {
    this.assertActive();
    const manifest = await this.loadManifest();
    const global = manifest.chunks.find((entry) => entry.level === 'global');
    if (global === undefined)
      throw this.fail('Das Erdmanifest enthaelt keinen globalen Bootstrap.');
    this.setStatus('bootstrap', 'Globale Erd-Basis wird geladen.');
    const chunk = await this.loadEntry(global);
    this.setStatus('ready', `Erdaten ${manifest.datasetVersion} sind bereit.`);
    return chunk;
  }

  public async loadManifest(): Promise<EarthTilePyramidManifest> {
    this.assertActive();
    if (this.manifestValue !== null) return this.manifestValue;
    if (this.manifestPromise !== null) return this.manifestPromise;
    this.setStatus('manifest', 'Erdmanifest wird geprueft.');
    this.manifestPromise = this.fetchJson<EarthTilePyramidManifest>('manifest.json')
      .then((manifest) => {
        validateEarthTilePyramidManifest(manifest);
        this.manifestValue = manifest;
        return manifest;
      })
      .catch((error: unknown) => {
        throw this.fail(
          error instanceof Error ? error.message : 'Erdmanifest konnte nicht geladen werden.',
        );
      });
    return this.manifestPromise;
  }

  /** Ersetzt die aktuelle Detail-Anforderungsmenge und ignoriert veraltete Ergebnisse. */
  public async requireChunks(chunkIds: readonly string[]): Promise<readonly EarthTileChunk[]> {
    const manifest = await this.loadManifest();
    const generation = ++this.generation;
    const required = new Set(chunkIds);
    for (const [chunkId, controller] of this.abortControllers)
      if (!required.has(chunkId)) controller.abort();

    const entries = chunkIds.map((chunkId) => {
      const entry = manifest.chunks.find((candidate) => candidate.chunkId === chunkId);
      if (entry === undefined) throw new Error(`Chunk fehlt im Manifest: ${chunkId}.`);
      return entry;
    });
    const chunks = await mapConcurrent(entries, this.maxConcurrentRequests, (entry) =>
      this.loadEntry(entry),
    );
    return generation === this.generation ? chunks : [];
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
    this.pending.clear();
    this.cache.clear();
    this.listeners.clear();
  }

  private async loadEntry(entry: EarthTileChunkIndexEntry): Promise<EarthTileChunk> {
    const cached = this.cache.get(entry.chunkId);
    if (cached !== undefined) {
      this.cache.delete(entry.chunkId);
      this.cache.set(entry.chunkId, cached);
      return cached;
    }
    const existing = this.pending.get(entry.chunkId);
    if (existing !== undefined) return existing;

    const controller = new AbortController();
    this.abortControllers.set(entry.chunkId, controller);
    const promise = this.fetchChunk(entry, controller.signal).finally(() => {
      this.pending.delete(entry.chunkId);
      this.abortControllers.delete(entry.chunkId);
    });
    this.pending.set(entry.chunkId, promise);
    return promise;
  }

  private async fetchChunk(
    entry: EarthTileChunkIndexEntry,
    signal: AbortSignal,
  ): Promise<EarthTileChunk> {
    this.activeRequests += 1;
    this.publish();
    try {
      const response = await this.fetcher(new URL(entry.path, this.baseUrl), { signal });
      if (!response.ok)
        throw new Error(`Chunk ${entry.chunkId} konnte nicht geladen werden (${response.status}).`);
      const bytes = await response.arrayBuffer();
      const chunk = await decodeGzipJson<EarthTileChunk>(
        bytes,
        response.headers.get('content-encoding'),
      );
      const manifest = this.manifestValue;
      if (manifest === null) throw new Error('Manifest fehlt waehrend der Chunk-Pruefung.');
      validateEarthTileChunk(chunk, manifest.topologyFingerprint, manifest.sourceFingerprint);
      if (chunk.chunkId !== entry.chunkId || chunk.cells.length !== entry.cellCount)
        throw new Error(`Chunk-Inhalt passt nicht zum Manifest: ${entry.chunkId}.`);
      this.cache.set(entry.chunkId, chunk);
      while (this.cache.size > this.maxCachedChunks) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return chunk;
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw error;
      this.setStatus(
        'degraded',
        error instanceof Error ? error.message : `Chunk ${entry.chunkId} ist fehlerhaft.`,
      );
      throw error;
    } finally {
      this.activeRequests -= 1;
      this.publish();
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await this.fetcher(new URL(path, this.baseUrl));
    if (!response.ok) throw new Error(`HTTP ${response.status} fuer ${path}.`);
    return (await response.json()) as T;
  }

  private fail(message: string): Error {
    this.setStatus('error', message);
    return new Error(message);
  }

  private setStatus(phase: EarthRuntimePhase, message: string): void {
    this.statusValue = {
      phase,
      message,
      activeRequests: this.activeRequests,
      cachedChunks: this.cache.size,
      datasetVersion: this.manifestValue?.datasetVersion ?? null,
    };
    this.publish();
  }

  private publish(): void {
    this.statusValue = {
      ...this.statusValue,
      activeRequests: this.activeRequests,
      cachedChunks: this.cache.size,
      datasetVersion: this.manifestValue?.datasetVersion ?? null,
    };
    for (const listener of this.listeners) listener(this.statusValue);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('EarthChunkRuntime wurde bereits disposed.');
  }
}

async function decodeGzipJson<T>(bytes: ArrayBuffer, contentEncoding: string | null): Promise<T> {
  const direct = tryParseJson<T>(new TextDecoder().decode(bytes));
  if (direct !== null || contentEncoding === 'gzip') {
    if (direct === null) throw new Error('Server meldet gzip, lieferte aber kein lesbares JSON.');
    return direct;
  }
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Dieser Browser kann gzip-Chunks nicht dekomprimieren.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  const parsed = tryParseJson<T>(text);
  if (parsed === null) throw new Error('Dekomprimierter Chunk enthaelt kein gueltiges JSON.');
  return parsed;
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        const value = values[index];
        if (value !== undefined) results[index] = await worker(value);
      }
    }),
  );
  return results;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function resolveBaseUrl(value: string): string {
  const base =
    typeof document === 'undefined'
      ? 'http://localhost/'
      : document.baseURI || window.location.href;
  return ensureTrailingSlash(new URL(value, base).toString());
}
