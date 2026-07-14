import { describe, expect, it } from 'vitest';

import { TERRAIN_VISUALS, terrainColor } from '@/rendering/TerrainVisuals';
import { TERRAIN_PALETTE } from '@/data/terrain';

describe('terrain visuals', () => {
  it('has one finite material profile for every terrain class', () => {
    expect(Object.keys(TERRAIN_VISUALS).sort()).toEqual(Object.keys(TERRAIN_PALETTE).sort());
    for (const visual of Object.values(TERRAIN_VISUALS)) {
      expect(visual.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.isFinite(visual.roughness)).toBe(true);
      expect(Number.isFinite(visual.metalness)).toBe(true);
    }
  });

  it('derives small deterministic variation from cell ID only', () => {
    const base = terrainColor('forest', 'cell-0001');
    expect(terrainColor('forest', 'cell-0001', true)).toBe(
      terrainColor('forest', 'cell-0001', true),
    );
    expect(terrainColor('forest', 'cell-0001', false)).toBe(base);
    expect(terrainColor('forest', 'cell-0001', true)).not.toBe(
      terrainColor('forest', 'cell-0002', true),
    );
  });
});
