export const POLITICAL_REFERENCE_DATE = '1815-06-09';

export type PolityType =
  | 'empire'
  | 'kingdom'
  | 'grandDuchy'
  | 'duchy'
  | 'principality'
  | 'freeCity'
  | 'confederation'
  | 'dependent';

export interface PoliticalPolity {
  readonly polityId: string;
  readonly historicalName: string;
  readonly displayName: string;
  readonly type: PolityType;
  readonly sovereignPolityId?: string;
  readonly parentPolityId?: string;
  readonly memberships: readonly string[];
  readonly uncertainty: 'documented' | 'uncertain';
}

export interface PoliticalOverlap {
  readonly polityId: string;
  readonly fraction: number;
}

export interface PoliticalCell {
  readonly cellId: string;
  readonly dominantPolityId: string | null;
  readonly overlaps: readonly PoliticalOverlap[];
  readonly isPoliticalBorderCell: boolean;
  readonly qualityFlag: 'complete' | 'mixed' | 'unassigned' | 'uncertain';
}

export interface PoliticalBorder {
  readonly edgeId: string;
  readonly firstCellId: string;
  readonly secondCellId: string;
  readonly firstPolityId: string;
  readonly secondPolityId: string;
  readonly type: 'sovereign' | 'membership';
}

export interface PoliticalArtifact {
  readonly formatVersion: 1;
  readonly referenceDate: typeof POLITICAL_REFERENCE_DATE;
  readonly topologyFingerprint: string;
  readonly sourceFingerprint: string;
  readonly polities: readonly PoliticalPolity[];
  readonly cells: readonly PoliticalCell[];
  readonly borders: readonly PoliticalBorder[];
}

export function assignPoliticalCell(
  cellId: string,
  overlaps: readonly PoliticalOverlap[],
): PoliticalCell {
  const normalized = [...overlaps].sort((first, second) =>
    first.polityId.localeCompare(second.polityId),
  );
  if (
    normalized.some(
      (overlap) =>
        !Number.isFinite(overlap.fraction) || overlap.fraction < 0 || overlap.fraction > 1,
    )
  )
    throw new RangeError(`Ungültiger politischer Flächenanteil für ${cellId}.`);
  const total = normalized.reduce((sum, overlap) => sum + overlap.fraction, 0);
  if (total > 1.000001)
    throw new RangeError(`Politische Flächenanteile überschreiten 100 % für ${cellId}.`);
  const dominant = normalized.reduce<PoliticalOverlap | null>(
    (best, current) => (best === null || current.fraction > best.fraction ? current : best),
    null,
  );
  return {
    cellId,
    dominantPolityId: dominant?.polityId ?? null,
    overlaps: normalized,
    isPoliticalBorderCell: normalized.filter((overlap) => overlap.fraction > 0).length > 1,
    qualityFlag: dominant === null ? 'unassigned' : normalized.length > 1 ? 'mixed' : 'complete',
  };
}

export function derivePoliticalBorders(
  cells: readonly PoliticalCell[],
  neighborPairs: readonly [string, string][],
  membershipByPolity: ReadonlyMap<string, readonly string[]>,
): readonly PoliticalBorder[] {
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const borders: PoliticalBorder[] = [];
  const seen = new Set<string>();
  for (const [firstId, secondId] of neighborPairs) {
    const first = cellsById.get(firstId);
    const second = cellsById.get(secondId);
    if (
      first === undefined ||
      second === undefined ||
      first.dominantPolityId === null ||
      second.dominantPolityId === null ||
      first.dominantPolityId === second.dominantPolityId
    )
      continue;
    const edgeId = [firstId, secondId].sort().join('|');
    if (seen.has(edgeId)) continue;
    seen.add(edgeId);
    const firstMemberships = membershipByPolity.get(first.dominantPolityId) ?? [];
    const secondMemberships = membershipByPolity.get(second.dominantPolityId) ?? [];
    const type = firstMemberships.some((membership) => secondMemberships.includes(membership))
      ? 'membership'
      : 'sovereign';
    borders.push({
      edgeId,
      firstCellId: firstId,
      secondCellId: secondId,
      firstPolityId: first.dominantPolityId,
      secondPolityId: second.dominantPolityId,
      type,
    });
  }
  return borders.sort((first, second) => first.edgeId.localeCompare(second.edgeId));
}

export function validatePoliticalArtifact(artifact: PoliticalArtifact): void {
  if (artifact.formatVersion !== 1 || artifact.referenceDate !== POLITICAL_REFERENCE_DATE)
    throw new Error('Nicht unterstützter politischer 1815-Artefaktstand.');
  const polityIds = new Set(artifact.polities.map((polity) => polity.polityId));
  if (polityIds.size !== artifact.polities.length)
    throw new Error('Politische IDs müssen eindeutig sein.');
  for (const polity of artifact.polities) {
    if (polity.sovereignPolityId !== undefined && !polityIds.has(polity.sovereignPolityId))
      throw new Error(`Unbekannte Souveränitätsreferenz: ${polity.sovereignPolityId}.`);
    if (polity.parentPolityId !== undefined && !polityIds.has(polity.parentPolityId))
      throw new Error(`Unbekannte Elternreferenz: ${polity.parentPolityId}.`);
    if (polity.memberships.some((membership) => !polityIds.has(membership)))
      throw new Error(`Unbekannte Mitgliedschaft für ${polity.polityId}.`);
  }
  for (const cell of artifact.cells) {
    if (cell.dominantPolityId !== null && !polityIds.has(cell.dominantPolityId))
      throw new Error(`Unbekannte Zell-Polity: ${cell.cellId}.`);
    assignPoliticalCell(cell.cellId, cell.overlaps);
  }
}
