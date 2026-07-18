import { describe, expect, it } from 'vitest';

import { PROCEDURAL_LOD_PROFILES, ProceduralWorldLod } from '@/world/proceduralWorldLod';
import { ULTRA_DETAIL_CELL_COUNT, ULTRA_INTERACTIVE_MAX_LEVEL } from '@/topology/lod/ultraDetail';
import { worldLodCellCount } from '@/topology/lod/sevenLevelArchitecture';

describe('experimentelles Ultra-Budget', () => {
  it('adressiert f144, materialisiert interaktiv aber höchstens f89', () => {
    expect(PROCEDURAL_LOD_PROFILES.ultra.levelCellCounts.detail).toBe(ULTRA_DETAIL_CELL_COUNT);
    expect(ULTRA_DETAIL_CELL_COUNT).toBe(207_362);
    expect(worldLodCellCount(144)).toBe(207_362);
    expect(ULTRA_INTERACTIVE_MAX_LEVEL).toBe('local');
    expect(PROCEDURAL_LOD_PROFILES.ultra.levelCellCounts.local).toBe(79_212);
  });

  it('hält aktive Zellen, Chunks und Generierungsziel innerhalb des ADR-Budgets', () => {
    const profile = PROCEDURAL_LOD_PROFILES.ultra;
    expect(profile.maxActiveCells).toBe(16_384);
    expect(profile.maxDrawCalls).toBe(33);
    expect(profile.generationBudgetMs).toBe(250);
    expect(new ProceduralWorldLod({ density: 'ultra' }).profile).toEqual(profile);
  });
});
