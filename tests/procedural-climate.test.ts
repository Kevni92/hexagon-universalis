import { describe, expect, it } from 'vitest';

import { createProceduralWorld } from '@/world/proceduralWorld';

describe('prozedurales Klima und Biome', () => {
  it('ist deterministisch, serialisierbar und diagnostizierbar', () => {
    const first = createProceduralWorld({ seed: 'climate-reference', density: 'standard' });
    const second = createProceduralWorld({ seed: 'climate-reference', density: 'standard' });

    expect(first.climate).toEqual(second.climate);
    expect(JSON.parse(JSON.stringify(first.climate))).toEqual(first.climate);
    expect(first.climate.version).toBe(1);
    expect(first.climate.cellCount).toBe(first.cellCount);
    for (const cell of first.cells) {
      expect(
        [
          cell.temperature,
          cell.moisture,
          cell.coastDistance,
          cell.waterProximity,
          cell.rainShadow,
        ].every(Number.isFinite),
      ).toBe(true);
    }
  });

  it('macht KÃ¼sten und Seen im Mittel feuchter als kontinentale InnenrÃ¤ume', () => {
    const world = createProceduralWorld({ seed: 'climate-water', density: 'standard' });
    const land = world.cells.filter((cell) => cell.surface === 'land');
    const coastal = land.filter((cell) => cell.isCoast);
    const inland = land.filter((cell) => !cell.isCoast && cell.coastDistance > 0.35);
    const lakeCells = land.filter((cell) => cell.waterFeature === 'lake');

    expect(coastal.length).toBeGreaterThan(0);
    expect(inland.length).toBeGreaterThan(0);
    expect(average(coastal.map((cell) => cell.moisture))).toBeGreaterThan(
      average(inland.map((cell) => cell.moisture)),
    );
    expect(lakeCells.length).toBe(world.climate.lakeCells);
    expect(lakeCells.every((cell) => cell.waterProximity > 0.5)).toBe(true);
  });

  it('bildet HÃ¶hen-, Pol- und Regenschatteneffekte ab', () => {
    const world = createProceduralWorld({ seed: 'climate-relief', density: 'standard' });
    const land = world.cells.filter((cell) => cell.surface === 'land');
    const polar = land.filter((cell) => Math.abs(cell.center.y) > 0.72);
    const equatorial = land.filter((cell) => Math.abs(cell.center.y) < 0.28);
    const high = land.filter((cell) => cell.elevation > 0.55);
    const low = land.filter((cell) => cell.elevation >= 0 && cell.elevation < 0.2);
    const mountainCells = land.filter((cell) => cell.mountainInfluence > 0.25);

    expect(average(polar.map((cell) => cell.temperature))).toBeLessThan(
      average(equatorial.map((cell) => cell.temperature)),
    );
    expect(average(high.map((cell) => cell.temperature))).toBeLessThan(
      average(low.map((cell) => cell.temperature)),
    );
    expect(mountainCells.length).toBeGreaterThan(0);
    expect(Math.max(...mountainCells.map((cell) => cell.rainShadow))).toBeGreaterThan(0.05);
    expect(world.climate.rainShadowCells).toBeGreaterThan(0);
  });
});

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
