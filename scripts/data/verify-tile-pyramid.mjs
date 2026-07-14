import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { sha256 } from './tile-pyramid.mjs';

const RAW_EXTENSIONS = new Set(['.gpkg', '.nc', '.shp', '.tif', '.tiff', '.zip']);
const MAX_COMPRESSED_BYTES = 8_000_000;
const MAX_CHUNKS = 2_000;

export async function verifyTilePyramid(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.levels?.join(',') !== 'global,regional,local')
    throw new Error('Ungültiges Bootstrap-Manifest.');
  if (
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length === 0 ||
    manifest.chunks.length > MAX_CHUNKS
  )
    throw new Error('Chunkanzahl liegt außerhalb des Budgets.');
  const chunkIds = new Set();
  let totalBytes = 0;
  for (const entry of manifest.chunks) {
    if (chunkIds.has(entry.chunkId)) throw new Error(`Doppelte Chunk-ID: ${entry.chunkId}.`);
    chunkIds.add(entry.chunkId);
    const bytes = await readFile(join(directory, entry.path));
    if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.sha256)
      throw new Error(`Prüfsumme oder Größe stimmt nicht: ${entry.chunkId}.`);
    totalBytes += bytes.byteLength;
    const chunk = JSON.parse(gunzipSync(bytes).toString('utf8'));
    if (
      chunk.chunkId !== entry.chunkId ||
      chunk.level !== entry.level ||
      chunk.cells.length !== entry.cellCount ||
      chunk.topologyFingerprint !== manifest.topologyFingerprint ||
      chunk.sourceFingerprint !== manifest.sourceFingerprint
    )
      throw new Error(`Chunkmetadaten stimmen nicht mit dem Index überein: ${entry.chunkId}.`);
  }
  if (totalBytes > MAX_COMPRESSED_BYTES)
    throw new Error(`Komprimierte Pyramide überschreitet ${MAX_COMPRESSED_BYTES} Bytes.`);
  const files = await walk(directory);
  const rawFiles = files.filter((path) => RAW_EXTENSIONS.has(extname(path).toLowerCase()));
  if (rawFiles.length > 0)
    throw new Error(`Rohdaten im Produktionsartefakt: ${rawFiles.join(', ')}.`);
  return { chunkCount: manifest.chunks.length, totalBytes };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

async function runCli() {
  const directory = resolve(process.argv[2] ?? 'public/data/earth/v1');
  const result = await verifyTilePyramid(directory);
  console.log(`Tile-Pyramide gültig: ${result.chunkCount} Chunks, ${result.totalBytes} Bytes gzip`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
