import { describe, expect, it } from 'vitest';

import { cellInfoViewModel, sourceViewModel, terrainLegend } from '@/ui/EarthHud';

const cell = {
  cellId: 'cell-0001',
  latitude: 48.1,
  longitude: 11.5,
  elevationMeters: 1234,
  elevationMinMeters: 1000,
  elevationMaxMeters: 1500,
  landFraction: 1,
  isLand: true,
  isWater: false,
  isCoast: false,
  terrainClass: 'forest',
  sourceFlags: ['fixture'],
} as const;

describe('earth HUD view models', () => {
  it('provides an accessible empty state and formats selected cells', () => {
    expect(cellInfoViewModel(null, null).title).toBe('Keine Zelle ausgewählt');
    const model = cellInfoViewModel(cell, 'hexagon', 6);
    expect(model.rows.map((row) => row.label)).toContain('Höhe');
    expect(model.rows.find((row) => row.label === 'Höhe')?.value).toContain('1.234');
    expect(model.rows.find((row) => row.label === 'Typ')?.value).toBe('Hexagon');
  });

  it('derives every legend entry from the shared palette', () => {
    expect(terrainLegend()).toHaveLength(13);
    expect(terrainLegend().find((entry) => entry.key === 'forest')?.color).toBe('#2d7047');
  });

  it('keeps source metadata in a presentation model', () => {
    expect(sourceViewModel(1, [{ name: 'GEBCO', version: '2024', attribution: 'GEBCO' }])).toEqual({
      formatVersion: 'Format v1',
      sources: [{ name: 'GEBCO', version: '2024', attribution: 'GEBCO' }],
    });
  });
});
