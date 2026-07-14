import type { EarthTileLevel } from './tilePyramid';
import {
  assignPoliticalCell,
  POLITICAL_REFERENCE_DATE,
  type PoliticalCell,
  type PoliticalOverlap,
  type PoliticalPolity,
} from './political1815';

export interface PoliticalLodChunk {
  readonly formatVersion: 1;
  readonly referenceDate: typeof POLITICAL_REFERENCE_DATE;
  readonly level: EarthTileLevel;
  readonly chunkId: string;
  readonly topologyFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cells: readonly PoliticalCell[];
}

export interface WeightedPoliticalCell {
  readonly cell: PoliticalCell;
  readonly weight: number;
}

export function aggregatePoliticalChildren(
  parentCellId: string,
  children: readonly WeightedPoliticalCell[],
  minimumRetainedFraction = 0.01,
): PoliticalCell {
  if (children.length === 0) return assignPoliticalCell(parentCellId, []);
  if (children.some(({ weight }) => !Number.isFinite(weight) || weight <= 0))
    throw new RangeError('Politische Kindgewichte muessen positiv und endlich sein.');
  const totalWeight = children.reduce((sum, child) => sum + child.weight, 0);
  const totals = new Map<string, number>();
  for (const { cell, weight } of children)
    for (const overlap of cell.overlaps)
      totals.set(overlap.polityId, (totals.get(overlap.polityId) ?? 0) + overlap.fraction * weight);
  const overlaps: PoliticalOverlap[] = [...totals]
    .map(([polityId, weighted]) => ({ polityId, fraction: weighted / totalWeight }))
    .filter(({ fraction }) => fraction >= minimumRetainedFraction)
    .sort((left, right) => left.polityId.localeCompare(right.polityId));
  return assignPoliticalCell(parentCellId, overlaps);
}

export function validatePoliticalLodChunk(
  chunk: PoliticalLodChunk,
  topologyFingerprint: string,
  sourceFingerprint: string,
): void {
  if (chunk.formatVersion !== 1 || chunk.referenceDate !== POLITICAL_REFERENCE_DATE)
    throw new Error('Nicht unterstuetzter politischer Multi-LOD-Artefaktstand.');
  if (chunk.topologyFingerprint !== topologyFingerprint)
    throw new Error('Politischer Chunk und Erdtopologie stimmen nicht ueberein.');
  if (chunk.sourceFingerprint !== sourceFingerprint)
    throw new Error('Politischer Chunk und Erdquellen stimmen nicht ueberein.');
  if (!chunk.chunkId.startsWith(levelPrefix(chunk.level)))
    throw new Error(`Politische Chunk-ID passt nicht zur Ebene ${chunk.level}.`);
  const ids = new Set<string>();
  for (const cell of chunk.cells) {
    if (ids.has(cell.cellId)) throw new Error(`Doppelte politische Zell-ID: ${cell.cellId}.`);
    ids.add(cell.cellId);
    if (!cell.cellId.startsWith(levelPrefix(chunk.level)))
      throw new Error(`Politische Zell-ID passt nicht zur Ebene ${chunk.level}: ${cell.cellId}.`);
  }
}

/** Waehlt LOD-spezifische Grenzen, ohne wichtige Souveraenitaetsgrenzen zu verlieren. */
export function politicalBorderVisibleAtLevel(
  type: 'sovereign' | 'membership',
  level: EarthTileLevel,
): boolean {
  return type === 'sovereign' || level !== 'global';
}

export function resolvePoliticalHierarchy(
  polity: PoliticalPolity,
  polities: readonly PoliticalPolity[],
): { readonly sovereign: PoliticalPolity; readonly parent: PoliticalPolity | null } {
  const byId = new Map(polities.map((candidate) => [candidate.polityId, candidate]));
  const sovereign =
    (polity.sovereignPolityId === undefined ? polity : byId.get(polity.sovereignPolityId)) ??
    polity;
  const parent =
    polity.parentPolityId === undefined ? null : (byId.get(polity.parentPolityId) ?? null);
  return { sovereign, parent };
}

function levelPrefix(level: EarthTileLevel): string {
  return `${level === 'global' ? 'lvl0' : level === 'regional' ? 'lvl1' : 'lvl2'}-${level}/`;
}
