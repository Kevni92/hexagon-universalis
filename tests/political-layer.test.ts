import { describe, expect, it } from 'vitest';

import {
  politicalBorderSegments,
  politicalCellColors,
  PoliticalLayerState,
  validatePoliticalLayerArtifact,
} from '@/rendering/PoliticalLayer';
import { assignPoliticalCell, POLITICAL_REFERENCE_DATE } from '@/data/political1815';
import { politicalInfoViewModel } from '@/ui/EarthHud';

const artifact = {
  formatVersion: 1 as const,
  referenceDate: POLITICAL_REFERENCE_DATE,
  topologyFingerprint: 'topology',
  sourceFingerprint: 'source',
  polities: [
    {
      polityId: 'a',
      historicalName: 'A',
      displayName: 'A',
      type: 'kingdom' as const,
      memberships: [],
      uncertainty: 'documented' as const,
    },
  ],
  cells: [
    assignPoliticalCell('a', [{ polityId: 'a', fraction: 1 }]),
    assignPoliticalCell('b', [{ polityId: 'a', fraction: 1 }]),
  ],
  borders: [
    {
      edgeId: 'a|b',
      firstCellId: 'a',
      secondCellId: 'b',
      firstPolityId: 'a',
      secondPolityId: 'a',
      type: 'sovereign' as const,
    },
  ],
} as const;

describe('political layer', () => {
  it('validates topology and cell-count compatibility', () => {
    expect(() => validatePoliticalLayerArtifact(artifact, 'topology', 2)).not.toThrow();
    expect(() => validatePoliticalLayerArtifact(artifact, 'other', 2)).toThrow();
    expect(() => validatePoliticalLayerArtifact(artifact, 'topology', 3)).toThrow();
  });

  it('keeps political colors deterministic and excludes water cells', () => {
    const colors = politicalCellColors(artifact.cells, new Set(['b']));
    expect(colors.get('a')).toBe(colors.get('a'));
    expect(colors.has('b')).toBe(false);
  });

  it('filters borders and keeps layer toggles independent', () => {
    const segments = politicalBorderSegments(
      artifact,
      new Map([
        ['a', { x: 1, y: 0, z: 0 }],
        ['b', { x: 0, y: 1, z: 0 }],
      ]),
    );
    expect(segments).toHaveLength(1);
    const state = new PoliticalLayerState();
    state.setOptions({ cellFill: true, sovereignBorders: false });
    expect(state.options).toEqual({
      cellFill: true,
      sovereignBorders: false,
      membershipBorders: false,
    });
  });

  it('exposes historical cell data for the HUD', () => {
    expect(
      politicalInfoViewModel(artifact.cells[0] ?? null, artifact.polities[0] ?? null).map(
        (row) => row.label,
      ),
    ).toContain('Referenzdatum');
  });
});
