import { describe, expect, it } from 'vitest';

import {
  projectedMeanCellSizePx,
  selectActiveChunkAddresses,
  SevenLevelWorldLodRuntime,
} from '@/topology/lod/sevenLevelRuntime';
import {
  WORLD_LOD_LEVELS,
  WORLD_LOD_PLATFORM_BUDGETS,
  worldLodCellCount,
} from '@/topology/lod/sevenLevelArchitecture';
import type { CameraState } from '@/topology/lod/selection';

function camera(distance: number): CameraState {
  return {
    position: { x: 0, y: 0, z: distance },
    forward: { x: 0, y: 0, z: -1 },
    fovY: (45 * Math.PI) / 180,
    viewportHeight: 800,
    sphereRadius: 1,
    aspect: 16 / 9,
  };
}

describe('SevenLevelWorldLodRuntime', () => {
  it('selects exactly one of seven ordered levels per frame', () => {
    const runtime = new SevenLevelWorldLodRuntime();
    const far = runtime.update(camera(10));
    const mid = runtime.update(camera(2.4));
    const near = runtime.update(camera(1.06));

    expect(WORLD_LOD_LEVELS.map((level) => level.name)).toContain(far.level.name);
    expect(WORLD_LOD_LEVELS.map((level) => level.name)).toContain(mid.level.name);
    expect(WORLD_LOD_LEVELS.map((level) => level.name)).toContain(near.level.name);
    expect(far.level.depth).toBeLessThanOrEqual(mid.level.depth);
    expect(mid.level.depth).toBeLessThanOrEqual(near.level.depth);
    expect(new Set([far.level.name, mid.level.name, near.level.name]).size).toBeGreaterThan(1);
  });

  it('keeps hysteresis when the camera oscillates inside the refinement window', () => {
    const runtime = new SevenLevelWorldLodRuntime({ refineAbovePx: 55, coarsenBelowPx: 35 });
    const refined = runtime.update(camera(1.2)).level;
    const stillRefined = runtime.update(camera(1.3)).level;

    expect(stillRefined.depth).toBeGreaterThanOrEqual(refined.depth);
  });

  it('caps active detail chunks and cells by platform budget', () => {
    const runtime = new SevenLevelWorldLodRuntime({ platform: 'mobile' });
    const frame = runtime.update(camera(1.01));

    expect(frame.activeChunks.length).toBeLessThanOrEqual(
      WORLD_LOD_PLATFORM_BUDGETS.mobile.maxActiveChunks,
    );
    expect(frame.estimatedActiveCells).toBeLessThanOrEqual(frame.maxActiveCells);
    expect(frame.estimatedActiveCells).toBeLessThan(worldLodCellCount(144));
  });

  it('derives projection-neutral chunk addresses around the focus point', () => {
    const detail = WORLD_LOD_LEVELS.find((level) => level.name === 'detail');
    expect(detail).toBeDefined();
    if (detail === undefined) return;

    const chunks = selectActiveChunkAddresses(
      detail,
      camera(1.05),
      WORLD_LOD_PLATFORM_BUDGETS.desktop,
    );

    expect(chunks).toHaveLength(32);
    expect(chunks[0]?.level).toEqual({ name: 'detail', depth: 6 });
    expect(chunks[0]?.chunkKey).toMatch(/^lvl6-detail\/b\d+\/q\d+$/);
    expect(chunks[0]?.parentKey).toMatch(/^lvl5-local\/b\d+\/q\d+$/);
    expect(new Set(chunks.map((chunk) => chunk.chunkKey)).size).toBe(chunks.length);
  });

  it('projects finer levels to smaller mean cell sizes', () => {
    const sizes = WORLD_LOD_LEVELS.map((level) => projectedMeanCellSizePx(level, camera(2)));

    for (let index = 1; index < sizes.length; index += 1)
      expect(sizes[index]).toBeLessThan(sizes[index - 1]!);
  });
});
