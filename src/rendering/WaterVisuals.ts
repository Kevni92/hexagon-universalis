export type WaterDepthBand = 'coastal' | 'shelf' | 'ocean' | 'deepOcean';

export interface WaterVisual {
  readonly band: WaterDepthBand;
  readonly color: string;
  readonly normalizedDepth: number;
}

export function classifyWaterDepth(elevationMeters: number): WaterDepthBand {
  if (!Number.isFinite(elevationMeters) || elevationMeters >= 0)
    throw new RangeError('Wassertiefe muss eine endliche negative Höhe sein.');
  if (elevationMeters >= -50) return 'coastal';
  if (elevationMeters >= -200) return 'shelf';
  if (elevationMeters >= -4000) return 'ocean';
  return 'deepOcean';
}

export function waterVisual(elevationMeters: number): WaterVisual {
  const band = classifyWaterDepth(elevationMeters);
  const normalizedDepth = Math.min(Math.abs(elevationMeters), 11000) / 11000;
  const colors: Record<WaterDepthBand, string> = {
    coastal: '#4fabc2',
    shelf: '#347f9e',
    ocean: '#235b88',
    deepOcean: '#102e5b',
  };
  return { band, color: colors[band], normalizedDepth };
}

export function isCoastCell(
  landFraction: number,
  hasLandNeighbor: boolean,
  hasWaterNeighbor: boolean,
  thresholds = { water: 0.4, land: 0.6 },
): boolean {
  if (!Number.isFinite(landFraction) || landFraction < 0 || landFraction > 1)
    throw new RangeError('landFraction muss zwischen 0 und 1 liegen.');
  if (thresholds.water < 0 || thresholds.land > 1 || thresholds.water > thresholds.land)
    throw new RangeError('Ungültige Küstenschwellen.');
  return (
    (landFraction > thresholds.water && landFraction < thresholds.land) ||
    (landFraction >= thresholds.land && hasWaterNeighbor) ||
    (landFraction <= thresholds.water && hasLandNeighbor)
  );
}
