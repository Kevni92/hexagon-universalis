import { describe, expect, it } from 'vitest';

import {
  aggregatePoliticalChildren,
  politicalBorderVisibleAtLevel,
  resolvePoliticalHierarchy,
  validatePoliticalLodChunk,
  type PoliticalLodChunk,
} from '@/data/PoliticalMultiLod';
import { assignPoliticalCell, POLITICAL_REFERENCE_DATE } from '@/data/political1815';

describe('political multi-LOD data', () => {
  it('aggregates dominant and minority entities deterministically into parents', () => {
    const children = [
      { cell: assignPoliticalCell('child-b', [{ polityId: 'small', fraction: 1 }]), weight: 1 },
      { cell: assignPoliticalCell('child-a', [{ polityId: 'large', fraction: 1 }]), weight: 9 },
    ];
    const parent = aggregatePoliticalChildren('lvl0-global/root/c0', children);
    expect(parent.dominantPolityId).toBe('large');
    expect(parent.overlaps).toContainEqual({ polityId: 'small', fraction: 0.1 });
    expect(aggregatePoliticalChildren('lvl0-global/root/c0', [...children].reverse())).toEqual(
      parent,
    );
  });

  it('requires political chunks to match earth fingerprints and hierarchy level', () => {
    const chunk: PoliticalLodChunk = {
      formatVersion: 1 as const,
      referenceDate: POLITICAL_REFERENCE_DATE,
      level: 'regional' as const,
      chunkId: 'lvl1-regional/chunk-parent',
      topologyFingerprint: 'topology',
      sourceFingerprint: 'source',
      cells: [assignPoliticalCell('lvl1-regional/p0/c1', [{ polityId: 'a', fraction: 1 }])],
    };
    expect(() => validatePoliticalLodChunk(chunk, 'topology', 'source')).not.toThrow();
    expect(() => validatePoliticalLodChunk(chunk, 'other', 'source')).toThrow(/topologie/i);
  });

  it('keeps sovereign borders globally and reveals memberships when zoomed', () => {
    expect(politicalBorderVisibleAtLevel('sovereign', 'global')).toBe(true);
    expect(politicalBorderVisibleAtLevel('membership', 'global')).toBe(false);
    expect(politicalBorderVisibleAtLevel('membership', 'regional')).toBe(true);
  });

  it('resolves sovereignty and regional parent information for the HUD', () => {
    const empire = {
      polityId: 'empire',
      displayName: 'Empire',
      historicalName: 'Empire',
      type: 'empire' as const,
      memberships: [],
      uncertainty: 'documented' as const,
    };
    const region = {
      polityId: 'region',
      displayName: 'Region',
      historicalName: 'Region',
      type: 'confederation' as const,
      memberships: [],
      uncertainty: 'documented' as const,
    };
    const duchy = {
      polityId: 'duchy',
      displayName: 'Duchy',
      historicalName: 'Duchy',
      type: 'duchy' as const,
      sovereignPolityId: 'empire',
      parentPolityId: 'region',
      memberships: [],
      uncertainty: 'documented' as const,
    };
    expect(resolvePoliticalHierarchy(duchy, [duchy, empire, region])).toEqual({
      sovereign: empire,
      parent: region,
    });
  });
});
