import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const FORMAT_VERSION = 1;
export const LEVELS = ['global', 'regional', 'local'];

const LEVEL_PREFIX = {
  global: 'lvl0-global',
  regional: 'lvl1-regional',
  local: 'lvl2-local',
};

export function canonicalJson(value) {
  return `${JSON.stringify(sortValue(value))}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function aggregateCell(input) {
  if (!Array.isArray(input.samples) || input.samples.length === 0)
    throw new Error(`Zelle ${input.cellId} besitzt keine Samples.`);
  const samples = [...input.samples].sort(compareSamples);
  let totalWeight = 0;
  let landSum = 0;
  const terrainWeights = new Map();
  const riverClasses = new Set();
  const missing = new Set();
  let hasPoliticalBorder = false;

  for (const sample of samples) {
    const weight = sample.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0)
      throw new Error(`Ungültiges Gewicht in ${input.cellId}.`);
    if (!Number.isFinite(sample.elevationMeters)) missing.add('missing-elevation');
    if (!Number.isFinite(sample.landFraction) || sample.landFraction < 0 || sample.landFraction > 1)
      throw new Error(`Ungültiger Landanteil in ${input.cellId}.`);
    if (typeof sample.terrainClass !== 'string' || sample.terrainClass === '')
      missing.add('missing-land-cover');
    totalWeight += weight;
    landSum += sample.landFraction * weight;
    if (sample.terrainClass)
      terrainWeights.set(
        sample.terrainClass,
        (terrainWeights.get(sample.terrainClass) ?? 0) + weight,
      );
    for (const riverClass of sample.riverClasses ?? []) riverClasses.add(riverClass);
    hasPoliticalBorder ||= sample.hasPoliticalBorder === true;
    for (const flag of sample.missing ?? []) missing.add(flag);
  }

  if (samples.every((sample) => sample.riverClasses === undefined))
    missing.add('missing-hydrography');
  if (samples.every((sample) => sample.hasPoliticalBorder === undefined))
    missing.add('missing-political-data');
  const validElevations = samples.filter((sample) => Number.isFinite(sample.elevationMeters));
  if (validElevations.length === 0)
    throw new Error(`Zelle ${input.cellId} besitzt keine gültige Höhe.`);
  const elevationWeight = validElevations.reduce((sum, sample) => sum + (sample.weight ?? 1), 0);
  const elevationMeters =
    validElevations.reduce(
      (sum, sample) => sum + sample.elevationMeters * (sample.weight ?? 1),
      0,
    ) / elevationWeight;
  const elevations = validElevations.map((sample) => ({
    value: sample.elevationMeters,
    weight: sample.weight ?? 1,
  }));
  const terrainTotal = [...terrainWeights.values()].reduce((sum, value) => sum + value, 0);
  if (terrainTotal === 0) throw new Error(`Zelle ${input.cellId} besitzt keine Landbedeckung.`);
  const terrainFractions = [...terrainWeights]
    .map(([terrainClass, weight]) => ({ terrainClass, fraction: round(weight / terrainTotal, 8) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.terrainClass.localeCompare(right.terrainClass),
    );
  normalizeFractions(terrainFractions);

  return {
    cellId: input.cellId,
    parentCellId: input.parentCellId ?? null,
    latitude: round(input.latitude, 8),
    longitude: normalizeLongitude(input.longitude),
    sampleCount: samples.length,
    elevationMeters: round(elevationMeters, 2),
    elevationMinMeters: Math.min(...validElevations.map((sample) => sample.elevationMeters)),
    elevationMaxMeters: Math.max(...validElevations.map((sample) => sample.elevationMeters)),
    elevationP10Meters: round(weightedQuantile(elevations, 0.1), 2),
    elevationP90Meters: round(weightedQuantile(elevations, 0.9), 2),
    landFraction: round(landSum / totalWeight, 8),
    terrainClass: terrainFractions[0].terrainClass,
    terrainFractions,
    riverClasses: [...riverClasses].sort(),
    hasPoliticalBorder,
    qualityFlags: missing.size === 0 ? ['complete'] : [...missing].sort(),
  };
}

export function validateHierarchy(cells) {
  const ids = new Set(cells.map((cell) => cell.cellId));
  if (ids.size !== cells.length) throw new Error('Zell-IDs sind nicht eindeutig.');
  for (const cell of cells) {
    const level = levelFromId(cell.cellId);
    if (level === 'global' && cell.parentCellId !== null)
      throw new Error(`Globale Zelle darf keine Elternzelle besitzen: ${cell.cellId}.`);
    if (level !== 'global' && !ids.has(cell.parentCellId))
      throw new Error(`Elternzelle fehlt für ${cell.cellId}: ${cell.parentCellId}.`);
    if (level === 'regional' && levelFromId(cell.parentCellId) !== 'global')
      throw new Error(`Regionalzelle benötigt globale Elternzelle: ${cell.cellId}.`);
    if (level === 'local' && levelFromId(cell.parentCellId) !== 'regional')
      throw new Error(`Lokalzelle benötigt regionale Elternzelle: ${cell.cellId}.`);
  }
}

export function validateParentAggregates(cells, tolerance = 0.15) {
  const childrenByParent = new Map();
  for (const cell of cells) {
    if (cell.parentCellId === null) continue;
    const children = childrenByParent.get(cell.parentCellId) ?? [];
    children.push(cell);
    childrenByParent.set(cell.parentCellId, children);
  }
  const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
  for (const [parentId, children] of childrenByParent) {
    const parent = byId.get(parentId);
    const landMean = children.reduce((sum, child) => sum + child.landFraction, 0) / children.length;
    if (Math.abs(parent.landFraction - landMean) > tolerance)
      throw new Error(
        `Landanteil von ${parentId} weicht um mehr als ${tolerance} von den Kindern ab.`,
      );
    const elevationMean =
      children.reduce((sum, child) => sum + child.elevationMeters, 0) / children.length;
    const elevationTolerance = Math.max(
      500,
      Math.abs(parent.elevationMaxMeters - parent.elevationMinMeters),
    );
    if (Math.abs(parent.elevationMeters - elevationMean) > elevationTolerance)
      throw new Error(`Höhenmittel von ${parentId} ist nicht kindkonsistent.`);
  }
}

export async function buildTilePyramid({ inputPath, outputDirectory }) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  validateInput(input);
  const cells = input.cells
    .map(aggregateCell)
    .sort((left, right) => left.cellId.localeCompare(right.cellId));
  validateHierarchy(cells);
  validateParentAggregates(cells, input.parentTolerance ?? 0.15);
  const topologyFingerprint = sha256(canonicalJson(input.topology));
  const sourceFingerprint = sha256(canonicalJson(input.sources));
  const chunks = groupChunks(cells);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const index = [];
  for (const group of chunks) {
    const chunk = {
      formatVersion: FORMAT_VERSION,
      level: group.level,
      chunkId: group.chunkId,
      topologyFingerprint,
      sourceFingerprint,
      cells: group.cells,
    };
    const compressed = gzipSync(canonicalJson(chunk), { level: 9, mtime: 0 });
    const path = `${group.chunkId}.json.gz`;
    const absolutePath = join(outputDirectory, ...path.split('/'));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, compressed);
    index.push({
      level: group.level,
      chunkId: group.chunkId,
      path: toPosix(relative(outputDirectory, absolutePath)),
      encoding: 'gzip',
      byteLength: compressed.byteLength,
      sha256: sha256(compressed),
      cellCount: group.cells.length,
    });
  }

  const summaries = LEVELS.map((level) => {
    const levelChunks = index.filter((chunk) => chunk.level === level);
    return {
      level,
      chunkCount: levelChunks.length,
      cellCount: levelChunks.reduce((sum, chunk) => sum + chunk.cellCount, 0),
      compressedBytes: levelChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    };
  });
  const manifest = {
    formatVersion: FORMAT_VERSION,
    datasetVersion: input.datasetVersion,
    topologyFingerprint,
    sourceFingerprint,
    levels: LEVELS,
    chunks: index,
    summaries,
  };
  await writeFile(join(outputDirectory, 'manifest.json'), canonicalJson(manifest));
  await writeFile(join(outputDirectory, 'sizes.json'), canonicalJson({ summaries }));
  await mkdir(join(outputDirectory, 'debug'), { recursive: true });
  for (const level of LEVELS)
    await writeFile(
      join(outputDirectory, 'debug', `${level}.svg`),
      createDebugSvg(
        level,
        cells.filter((cell) => levelFromId(cell.cellId) === level),
      ),
    );
  return manifest;
}

function groupChunks(cells) {
  const groups = new Map();
  for (const cell of cells) {
    const level = levelFromId(cell.cellId);
    const chunkId = level === 'global' ? 'lvl0-global/root' : chunkIdFromCell(cell);
    const current = groups.get(chunkId) ?? { level, chunkId, cells: [] };
    current.cells.push(cell);
    groups.set(chunkId, current);
  }
  return [...groups.values()].sort(
    (left, right) =>
      LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level) ||
      left.chunkId.localeCompare(right.chunkId),
  );
}

function chunkIdFromCell(cell) {
  const level = levelFromId(cell.cellId);
  const prefix = LEVEL_PREFIX[level];
  const parentPath = cell.parentCellId.replaceAll('/', '__');
  return `${prefix}/chunk-${parentPath}`;
}

function levelFromId(cellId) {
  if (typeof cellId !== 'string') throw new Error(`Ungültige Zell-ID: ${cellId}.`);
  if (cellId.startsWith('lvl0-global/')) return 'global';
  if (cellId.startsWith('lvl1-regional/')) return 'regional';
  if (cellId.startsWith('lvl2-local/')) return 'local';
  throw new Error(`Unbekannte Zell-ID-Ebene: ${cellId}.`);
}

function weightedQuantile(values, quantile) {
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = total * quantile;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }
  return sorted.at(-1).value;
}

function normalizeFractions(fractions) {
  const sum = fractions.reduce((total, item) => total + item.fraction, 0);
  fractions[0].fraction = round(fractions[0].fraction + (1 - sum), 8);
}

function normalizeLongitude(value) {
  if (!Number.isFinite(value)) throw new Error('Längengrad muss endlich sein.');
  return round(((((value + 180) % 360) + 360) % 360) - 180, 8);
}

function compareSamples(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  return value;
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function validateInput(input) {
  if (
    input?.datasetVersion === undefined ||
    !Array.isArray(input.cells) ||
    input.cells.length === 0
  )
    throw new Error('Pyramideneingabe benötigt datasetVersion und cells.');
  if (input.topology === undefined || !Array.isArray(input.sources) || input.sources.length === 0)
    throw new Error('Pyramideneingabe benötigt Topologie- und Quellenmetadaten.');
  const presentLevels = new Set(input.cells.map((cell) => levelFromId(cell.cellId)));
  if (LEVELS.some((level) => !presentLevels.has(level)))
    throw new Error('Pyramideneingabe muss alle drei Referenzstufen enthalten.');
}

function createDebugSvg(level, cells) {
  const colors = {
    deepWater: '#173b68',
    shallowWater: '#2f82aa',
    coast: '#c6a36a',
    forest: '#2d7047',
    desert: '#c9a66b',
    snowIce: '#e8f4ff',
    highland: '#85755b',
    mountain: '#66584c',
  };
  const points = cells
    .map((cell) => {
      const x = round(cell.longitude + 180, 3);
      const y = round(90 - cell.latitude, 3);
      const color = colors[cell.terrainClass] ?? '#8eb85a';
      return `  <circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${cell.cellId}: ${cell.terrainClass}, ${cell.elevationMeters} m</title></circle>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" role="img" aria-label="${level} earth tile debug map">
  <rect width="360" height="180" fill="#d9edf5"/>
  <path d="M0 90H360M180 0V180" stroke="#ffffff" stroke-width="0.5"/>
${points}
</svg>\n`;
}

async function runCli() {
  const inputPath = resolve(process.argv[2] ?? 'data/pyramid/reference-input.json');
  const outputDirectory = resolve(process.argv[3] ?? 'public/data/earth/v1');
  const manifest = await buildTilePyramid({ inputPath, outputDirectory });
  console.log(`Tile-Pyramide erzeugt: ${outputDirectory}`);
  for (const summary of manifest.summaries)
    console.log(
      `${summary.level}: ${summary.chunkCount} Chunks, ${summary.cellCount} Zellen, ${summary.compressedBytes} Bytes gzip`,
    );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
