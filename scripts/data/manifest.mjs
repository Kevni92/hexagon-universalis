import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SHA256 = /^[a-f0-9]{64}$/i;

export async function loadManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function validateManifest(manifest) {
  if (manifest?.manifestVersion !== 1) throw new Error('manifestVersion muss 1 sein.');
  if (manifest?.outputFormatVersion !== 1) throw new Error('outputFormatVersion muss 1 sein.');
  if (manifest?.coordinateReferenceSystem !== 'EPSG:4326')
    throw new Error('Das Manifest muss EPSG:4326 verwenden.');
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0)
    throw new Error('Das Manifest enthält keine Quellen.');

  const ids = new Set();
  for (const source of manifest.sources) {
    for (const field of [
      'id',
      'name',
      'publisher',
      'version',
      'downloadUrl',
      'license',
      'attribution',
    ]) {
      if (typeof source[field] !== 'string' || source[field].trim() === '')
        throw new Error(`Quelle ${source.id ?? '<unbekannt>'} benötigt ${field}.`);
    }
    if (ids.has(source.id)) throw new Error(`Doppelte Quellen-ID: ${source.id}.`);
    ids.add(source.id);
    if (!Array.isArray(source.expectedFiles) || source.expectedFiles.length === 0)
      throw new Error(`Quelle ${source.id} benötigt expectedFiles.`);
    if (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256))
      throw new Error(`Quelle ${source.id} benötigt eine SHA-256-Prüfsumme der Rohdatei.`);
    if (!Array.isArray(source.processing) || source.processing.length === 0)
      throw new Error(`Quelle ${source.id} benötigt Verarbeitungsschritte.`);
  }
  return manifest;
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export function fingerprintManifest(manifest) {
  const canonical = JSON.stringify(sortKeys(manifest));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

if (process.argv[1]?.endsWith('manifest.mjs')) {
  const path = process.argv[2] ?? 'data/sources.json';
  try {
    validateManifest(await loadManifest(path));
    console.log(`Manifest gültig: ${path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
