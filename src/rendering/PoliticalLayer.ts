import type { PoliticalArtifact, PoliticalBorder, PoliticalCell } from '@/data/political1815';
import type { Vector3 } from '@/topology/geodesic';
import type { EarthTileLevel } from '@/data/tilePyramid';
import { politicalBorderVisibleAtLevel } from '@/data/PoliticalMultiLod';

export interface PoliticalLayerOptions {
  readonly cellFill: boolean;
  readonly sovereignBorders: boolean;
  readonly membershipBorders: boolean;
}

export interface PoliticalBorderSegment {
  readonly edgeId: string;
  readonly type: PoliticalBorder['type'];
  readonly start: Vector3;
  readonly end: Vector3;
}

export const DEFAULT_POLITICAL_LAYER_OPTIONS: PoliticalLayerOptions = {
  cellFill: false,
  sovereignBorders: true,
  membershipBorders: false,
};

export function validatePoliticalLayerArtifact(
  artifact: PoliticalArtifact,
  topologyFingerprint: string,
  cellCount: number,
): void {
  if (artifact.topologyFingerprint !== topologyFingerprint)
    throw new Error('Politischer Layer gehört zu einer anderen Topologie.');
  if (artifact.cells.length !== cellCount)
    throw new Error('Politischer Layer enthält eine unerwartete Zellanzahl.');
}

export function politicalCellColors(
  cells: readonly PoliticalCell[],
  waterCellIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const cell of cells) {
    if (cell.dominantPolityId !== null && !waterCellIds.has(cell.cellId))
      colors.set(cell.cellId, colorForPolity(cell.dominantPolityId));
  }
  return colors;
}

export function politicalBorderSegments(
  artifact: PoliticalArtifact,
  centers: ReadonlyMap<string, Vector3>,
  options: PoliticalLayerOptions = DEFAULT_POLITICAL_LAYER_OPTIONS,
  level: EarthTileLevel = 'local',
): readonly PoliticalBorderSegment[] {
  return artifact.borders
    .filter(
      (border) =>
        politicalBorderVisibleAtLevel(border.type, level) &&
        (border.type === 'sovereign' ? options.sovereignBorders : options.membershipBorders),
    )
    .flatMap((border) => {
      const start = centers.get(border.firstCellId);
      const end = centers.get(border.secondCellId);
      return start === undefined || end === undefined
        ? []
        : [{ edgeId: border.edgeId, type: border.type, start, end }];
    });
}

export function colorForPolity(polityId: string): string {
  const hash = stableHash(polityId);
  const hue = hash % 360;
  return `hsl(${hue} 55% 52%)`;
}

export class PoliticalLayerState {
  public enabled = false;
  public options: PoliticalLayerOptions = { ...DEFAULT_POLITICAL_LAYER_OPTIONS };
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  public setOptions(next: Partial<PoliticalLayerOptions>): void {
    this.options = { ...this.options, ...next };
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
