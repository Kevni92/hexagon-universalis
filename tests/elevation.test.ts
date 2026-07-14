import { describe, expect, it } from 'vitest';

import { aggregateElevationSamples, longitudeDistance, normalizeLongitude } from '@/data/elevation';

describe('elevation aggregation', () => {
  it('aggregates weighted heights and classifies mixed coastal cells', () => {
    const result = aggregateElevationSamples([
      { latitude: 46, longitude: 10, elevationMeters: 4000, landFraction: 1, weight: 3 },
      { latitude: 46, longitude: 10, elevationMeters: 100, landFraction: 0.2, weight: 1 },
    ]);
    expect(result.elevationMeters).toBe(3025);
    expect(result.elevationMinMeters).toBe(100);
    expect(result.elevationMaxMeters).toBe(4000);
    expect(result.landFraction).toBeCloseTo(0.8);
    expect(result.isLand).toBe(true);
    expect(result.isCoast).toBe(false);
  });

  it('handles antimeridian longitudes without artificial gaps', () => {
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(-540)).toBe(-180);
    expect(longitudeDistance(179.5, -179.5)).toBeCloseTo(1);
  });

  it('rejects invalid samples and thresholds', () => {
    expect(() => aggregateElevationSamples([])).toThrow(RangeError);
    expect(() =>
      aggregateElevationSamples([
        { latitude: 91, longitude: 0, elevationMeters: 0, landFraction: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      aggregateElevationSamples(
        [{ latitude: 0, longitude: 0, elevationMeters: 0, landFraction: 0 }],
        { land: 0.2, water: 0.8 },
      ),
    ).toThrow(RangeError);
  });
});
