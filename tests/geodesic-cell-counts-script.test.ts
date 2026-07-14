import { describe, expect, it } from 'vitest';

import { createGeodesicTopology } from '@/topology/geodesic';

function formulaCellCount(frequency: number): number {
  return 10 * frequency * frequency + 2;
}

describe('geodesic cell count formula', () => {
  it.each([1, 2, 3, 4])('matches the materialized topology at frequency %i', (frequency) => {
    const topology = createGeodesicTopology(frequency);
    expect(topology.cells).toHaveLength(formulaCellCount(frequency));
  });

  it.each([
    [8, 642],
    [16, 2562],
    [32, 10242],
  ])(
    'matches the documented reference counts used in the ADR for frequency %i',
    (frequency, expected) => {
      expect(formulaCellCount(frequency)).toBe(expected);
    },
  );
});
