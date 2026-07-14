import { describe, expect, it } from 'vitest';

import {
  assignPoliticalCell,
  derivePoliticalBorders,
  POLITICAL_REFERENCE_DATE,
  validatePoliticalArtifact,
} from '@/data/political1815';

const polities = [
  {
    polityId: 'austria',
    historicalName: 'Kaisertum Österreich',
    displayName: 'Österreich',
    type: 'empire' as const,
    memberships: ['german-confederation'],
    uncertainty: 'documented' as const,
  },
  {
    polityId: 'prussia',
    historicalName: 'Königreich Preußen',
    displayName: 'Preußen',
    type: 'kingdom' as const,
    memberships: ['german-confederation'],
    uncertainty: 'documented' as const,
  },
  {
    polityId: 'german-confederation',
    historicalName: 'Deutscher Bund',
    displayName: 'Deutscher Bund',
    type: 'confederation' as const,
    memberships: [],
    uncertainty: 'documented' as const,
  },
];

describe('1815 political snapshot', () => {
  it('assigns dominant polity independently of overlap input order', () => {
    const first = assignPoliticalCell('cell-a', [
      { polityId: 'prussia', fraction: 0.4 },
      { polityId: 'austria', fraction: 0.6 },
    ]);
    const second = assignPoliticalCell('cell-a', [
      { polityId: 'austria', fraction: 0.6 },
      { polityId: 'prussia', fraction: 0.4 },
    ]);
    expect(first).toEqual(second);
    expect(first.dominantPolityId).toBe('austria');
    expect(first.qualityFlag).toBe('mixed');
  });

  it('deduplicates political borders and leaves same-polity edges out', () => {
    const cells = [
      assignPoliticalCell('a', [{ polityId: 'austria', fraction: 1 }]),
      assignPoliticalCell('b', [{ polityId: 'prussia', fraction: 1 }]),
      assignPoliticalCell('c', [{ polityId: 'prussia', fraction: 1 }]),
    ];
    const borders = derivePoliticalBorders(
      cells,
      [
        ['a', 'b'],
        ['b', 'a'],
        ['b', 'c'],
      ],
      new Map([
        ['austria', ['german-confederation']],
        ['prussia', ['german-confederation']],
      ]),
    );
    expect(borders).toHaveLength(1);
    expect(borders[0]?.edgeId).toBe('a|b');
  });

  it('validates the exact reference date and political references', () => {
    const artifact = {
      formatVersion: 1 as const,
      referenceDate: POLITICAL_REFERENCE_DATE,
      topologyFingerprint: 'topology',
      sourceFingerprint: 'source',
      polities,
      cells: [assignPoliticalCell('cell-a', [{ polityId: 'austria', fraction: 1 }])],
      borders: [],
    } as const;
    expect(() => validatePoliticalArtifact(artifact)).not.toThrow();
    const wrongDate = { ...artifact, referenceDate: '1815-11-20' } as unknown as typeof artifact;
    expect(() => validatePoliticalArtifact(wrongDate)).toThrow();
    expect(() => assignPoliticalCell('cell-x', [{ polityId: 'austria', fraction: 1.1 }])).toThrow(
      RangeError,
    );
  });
});
