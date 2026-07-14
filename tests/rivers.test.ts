import { describe, expect, it } from 'vitest';

import { classifyRiver, createRiverLine, simplifyRiver } from '@/data/rivers';

describe('river data preparation', () => {
  it('classifies real source order monotonically', () => {
    expect(classifyRiver(1)).toBe('major');
    expect(classifyRiver(4)).toBe('regional');
    expect(classifyRiver(6)).toBe('detailed');
  });

  it('simplifies deterministically while retaining endpoints and valid coordinates', () => {
    const points = [
      { latitude: 0, longitude: 179 },
      { latitude: 0.01, longitude: 179.1 },
      { latitude: 0, longitude: 179.2 },
    ];
    const simplified = simplifyRiver(points, 0.02);
    expect(simplified).toEqual([
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: 179.2 },
    ]);
    expect(simplifyRiver(points, 0.02)).toEqual(simplified);
  });

  it('deduplicates cell mappings and rejects invalid lines', () => {
    const line = createRiverLine(
      'amazon',
      1,
      [
        { latitude: -3, longitude: -60 },
        { latitude: 0, longitude: -50 },
      ],
      ['cell-a', 'cell-a', 'cell-b'],
    );
    expect(line.cellIds).toEqual(['cell-a', 'cell-b']);
    expect(() => createRiverLine('', 1, line.points, ['cell-a'])).toThrow(RangeError);
    expect(() =>
      simplifyRiver(
        [
          { latitude: 91, longitude: 0 },
          { latitude: 0, longitude: 0 },
        ],
        1,
      ),
    ).toThrow(RangeError);
  });
});
