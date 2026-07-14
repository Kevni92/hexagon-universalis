import { describe, expect, it } from 'vitest';

import {
  createEdgeTransitionDetails,
  createTransitionProfile,
  ownsTransitionEdge,
  transitionDetailBudget,
  transitionEdgeId,
  type TransitionCell,
} from '@/rendering/TileTransitions';

const cell = (
  cellId: string,
  tileType: TransitionCell['tileType'],
  modifiers: TransitionCell['modifiers'] = [],
): TransitionCell => ({
  cellId,
  tileType,
  modifiers,
  elevationMeters: 100,
  landFraction: 1,
});
const edge = { start: { x: -0.4, y: 0.4 }, end: { x: 0.4, y: 0.4 } } as const;

describe('neighbor terrain transitions', () => {
  it('creates deterministic forest edge trees only on suitable open land', () => {
    const forest = cell('forest', 'temperateMixedForest');
    const grass = cell('grass', 'temperateGrassland');
    const first = createEdgeTransitionDetails(forest, grass, edge, 3);
    expect(first).toEqual(createEdgeTransitionDetails(forest, grass, edge, 3));
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((detail) => detail.detailType === 'deciduousTree')).toBe(true);
    expect(first.every((detail) => detail.ownerCellId === 'grass')).toBe(true);
  });

  it('keeps every point inside the target and in the configured inner edge band', () => {
    const details = createEdgeTransitionDetails(
      cell('wet', 'wetland'),
      cell('open', 'temperateGrassland'),
      edge,
      3,
    );
    expect(details.every(({ x, y }) => Math.abs(x) <= 0.4 && y >= 0.31 && y < 0.37)).toBe(true);
  });

  it('excludes water and implausible desert-to-ice vegetation', () => {
    const forest = cell('forest', 'temperateMixedForest');
    expect(createEdgeTransitionDetails(forest, cell('water', 'ocean'), edge, 3)).toEqual([]);
    expect(
      createTransitionProfile(cell('desert', 'desert'), cell('ice', 'tundra', ['glacier']))
        .compatibility,
    ).toBe('excluded');
  });

  it('identifies a shared edge consistently and assigns one canonical planner', () => {
    expect(transitionEdgeId('b', 'a')).toBe(transitionEdgeId('a', 'b'));
    expect(
      [ownsTransitionEdge('a', 'b'), ownsTransitionEdge('b', 'a')].filter(Boolean),
    ).toHaveLength(1);
  });

  it('emits no individual transitions globally and caps every higher LOD', () => {
    const source = cell('forest', 'temperateMixedForest');
    const target = cell('grass', 'temperateGrassland');
    expect(createEdgeTransitionDetails(source, target, edge, 0)).toEqual([]);
    for (const lod of [1, 2, 3] as const)
      expect(createEdgeTransitionDetails(source, target, edge, lod).length).toBeLessThanOrEqual(
        transitionDetailBudget(lod),
      );
  });
});
