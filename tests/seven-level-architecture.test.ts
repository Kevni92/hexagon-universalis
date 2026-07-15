import { describe, expect, it } from 'vitest';

import {
  estimateWorldLodReliefGpuBytes,
  formatWorldLodLevelId,
  WORLD_LOD_LEVELS,
  WORLD_LOD_PLATFORM_BUDGETS,
  worldLodCellCount,
  worldLodEdgeCount,
  worldLodReliefTriangleCount,
  createWorldLodLevelId,
} from '@/topology/lod/sevenLevelArchitecture';

describe('seven-level world LOD architecture', () => {
  it('defines seven ordered levels with the target frequencies and cell counts', () => {
    expect(WORLD_LOD_LEVELS.map((level) => level.name)).toEqual([
      'global',
      'continental',
      'macroregional',
      'regional',
      'subregional',
      'local',
      'detail',
    ]);
    expect(WORLD_LOD_LEVELS.map((level) => level.frequency)).toEqual([8, 13, 21, 34, 55, 89, 144]);
    expect(WORLD_LOD_LEVELS.map((level) => worldLodCellCount(level.frequency))).toEqual([
      642, 1692, 4412, 11562, 30252, 79212, 207362,
    ]);
    expect(WORLD_LOD_LEVELS.map((level) => level.depth)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps the highest full topology outside the runtime materialization budget', () => {
    const detail = WORLD_LOD_PLATFORM_BUDGETS.desktop.levels.detail;
    expect(worldLodCellCount(144)).toBe(207362);
    expect(detail.maxActiveCells).toBe(16384);
    expect(detail.maxActiveCells).toBeLessThan(worldLodCellCount(144));
    expect(WORLD_LOD_PLATFORM_BUDGETS.mobile.levels.detail.maxActiveCells).toBe(6144);
  });

  it('derives edge, relief triangle and raw GPU size estimates reproducibly', () => {
    expect(worldLodEdgeCount(8)).toBe(3840);
    expect(worldLodReliefTriangleCount(144)).toBe(3732480);
    expect(estimateWorldLodReliefGpuBytes(144)).toBe(403107840);
  });

  it('provides projection-neutral, collision-resistant level identifiers', () => {
    const ids = WORLD_LOD_LEVELS.map((level) =>
      formatWorldLodLevelId(createWorldLodLevelId(level.name)),
    );
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual([
      'lvl0-global',
      'lvl1-continental',
      'lvl2-macroregional',
      'lvl3-regional',
      'lvl4-subregional',
      'lvl5-local',
      'lvl6-detail',
    ]);
  });

  it('caps active chunks, materials, geometry and generation work per platform', () => {
    const desktop = WORLD_LOD_PLATFORM_BUDGETS.desktop;
    const mobile = WORLD_LOD_PLATFORM_BUDGETS.mobile;
    expect(desktop.maxActiveChunks).toBe(32);
    expect(desktop.maxDrawCalls).toBe(33);
    expect(desktop.maxMaterials).toBe(33);
    expect(desktop.maxGpuBufferBytes).toBe(48 * 1024 * 1024);
    expect(desktop.generationSliceMs).toBe(4);
    expect(mobile.maxActiveChunks).toBe(12);
    expect(mobile.maxDrawCalls).toBe(13);
    expect(mobile.maxGpuBufferBytes).toBe(16 * 1024 * 1024);
    expect(mobile.generationSliceMs).toBe(2);
    for (const budget of [desktop, mobile]) {
      expect(budget.maxVisibleTriangles).toBe(budget.maxActiveCells * 18);
      expect(budget.maxCachedChunks).toBeGreaterThan(0);
      expect(budget.levels.detail.maxActiveCells).toBeLessThan(worldLodCellCount(144));
    }
  });
});
