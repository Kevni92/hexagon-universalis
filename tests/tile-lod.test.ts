import { describe, expect, it } from 'vitest';
import { LodController, lodForDistance, TILE_LOD_PROFILES } from '@/rendering/TileLod';

describe('tile LOD', () => {
  it('selects four deterministic distance levels', () => {
    expect(lodForDistance(30)).toBe(0);
    expect(lodForDistance(12)).toBe(1);
    expect(lodForDistance(6)).toBe(2);
    expect(lodForDistance(2)).toBe(3);
  });
  it('uses hysteresis to avoid threshold flicker', () => {
    const controller = new LodController();
    expect(controller.update(2)).toBe(3);
    expect(controller.update(4)).toBe(3);
    expect(controller.update(6)).toBe(2);
    expect(controller.update(12)).toBe(1);
    expect(controller.update(23)).toBe(0);
  });
  it('keeps quality budgets explicit', () => {
    expect(TILE_LOD_PROFILES.low.maxInstances[3]).toBeLessThan(
      TILE_LOD_PROFILES.default.maxInstances[3],
    );
  });
});
