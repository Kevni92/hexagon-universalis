import { describe, expect, it } from 'vitest';

import {
  EARTH_ACCEPTANCE_BUDGETS,
  validateEarthAcceptanceSnapshot,
} from '@/rendering/EarthAcceptance';

describe('multi-LOD earth acceptance budgets', () => {
  it('accepts bounded runtime resources and requests', () => {
    expect(() =>
      validateEarthAcceptanceSnapshot({
        activeChunks: 12,
        activeCells: 642,
        geometries: 12,
        textures: 0,
        dataRequests: 4,
      }),
    ).not.toThrow();
  });

  it('rejects unbounded chunks, resources, and parallel requests', () => {
    expect(() =>
      validateEarthAcceptanceSnapshot({
        activeChunks: EARTH_ACCEPTANCE_BUDGETS.maxDesktopChunks + 1,
        activeCells: 1,
        geometries: 1,
        textures: 0,
        dataRequests: 1,
      }),
    ).toThrow(/Chunks/);
    expect(() =>
      validateEarthAcceptanceSnapshot({
        activeChunks: 1,
        activeCells: 1,
        geometries: 1,
        textures: 0,
        dataRequests: 5,
      }),
    ).toThrow(/Requestbudget/);
  });
});
