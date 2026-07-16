import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYABLE_LATITUDE_CONFIG,
  PlayableLatitudeController,
} from '@/topology/lod/playableLatitude';

const north = (degrees: number) => ({
  x: 0,
  y: Math.sin((degrees * Math.PI) / 180),
  z: Math.cos((degrees * Math.PI) / 180),
});

describe('spielbarer Breitengradbereich', () => {
  it('keeps valid latitudes unchanged and treats north/south symmetrically', () => {
    const controller = new PlayableLatitudeController();
    expect(controller.evaluate(north(40)).withinPlayableRange).toBe(true);
    expect(controller.evaluate(north(-40)).withinPlayableRange).toBe(true);
    expect(controller.evaluate(north(79)).boundary).toBe('north');
    expect(controller.evaluate(north(-79)).boundary).toBe('south');
  });

  it('clamps an over-limit focus deterministically without NaN near either pole', () => {
    const controller = new PlayableLatitudeController({ maxLatitudeDegrees: 75 });
    for (const focus of [north(89.999), north(-89.999), { x: 0, y: 1, z: 0 }]) {
      const clamped = controller.clampFocus(focus);
      expect(Object.values(clamped).every(Number.isFinite)).toBe(true);
      expect(Math.abs(Math.asin(clamped.y))).toBeCloseTo((75 * Math.PI) / 180, 10);
    }
  });

  it('uses an entry hysteresis while allowing a flat view to stay at the outer edge', () => {
    const controller = new PlayableLatitudeController(DEFAULT_PLAYABLE_LATITUDE_CONFIG);
    expect(controller.evaluate(north(77.5)).flatAllowed).toBe(false);
    expect(controller.evaluate(north(77.5), true).flatAllowed).toBe(true);
    expect(controller.evaluate(north(78.1), true).flatAllowed).toBe(false);
  });

  it('rejects invalid limits and hysteresis values', () => {
    expect(() => new PlayableLatitudeController({ maxLatitudeDegrees: 90 })).toThrow(RangeError);
    expect(() => new PlayableLatitudeController({ maxLatitudeDegrees: 0 })).toThrow(RangeError);
    expect(() => new PlayableLatitudeController({ hysteresisDegrees: -1 })).toThrow(RangeError);
    expect(
      () => new PlayableLatitudeController({ maxLatitudeDegrees: 10, hysteresisDegrees: 10 }),
    ).toThrow(RangeError);
  });
});
