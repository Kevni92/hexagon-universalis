import { describe, expect, it } from 'vitest';

import {
  PROCEDURAL_CAMERA_RANGE,
  proceduralNearSurfaceClearance,
  projectedSphereHeightFraction,
} from '@/rendering/ProceduralCamera';

describe('prozeduraler Kameramaßstab', () => {
  it('zeigt am äußersten Zoom die vollständige Kugel groß, aber ohne Beschnitt', () => {
    const fill = projectedSphereHeightFraction(PROCEDURAL_CAMERA_RANGE.maxDistance, 45);

    expect(fill).toBeGreaterThan(0.7);
    expect(fill).toBeLessThan(0.8);
  });

  it('hält an der Nahgrenze zusätzlich zur Near Plane Abstand zum Maximalrelief', () => {
    expect(proceduralNearSurfaceClearance(0.1)).toBeGreaterThan(0.03);
  });

  it('weist ungültige Projektionsparameter ab', () => {
    expect(() => projectedSphereHeightFraction(1, 45)).toThrow(RangeError);
    expect(() => projectedSphereHeightFraction(3.4, 0)).toThrow(RangeError);
    expect(() => proceduralNearSurfaceClearance(Number.NaN)).toThrow(RangeError);
  });
});
