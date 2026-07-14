export interface ElevationSample {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMeters: number;
  readonly landFraction: number;
  readonly weight?: number;
}

export interface ElevationAggregate {
  readonly elevationMeters: number;
  readonly elevationMinMeters: number;
  readonly elevationMaxMeters: number;
  readonly landFraction: number;
  readonly isLand: boolean;
  readonly isWater: boolean;
  readonly isCoast: boolean;
}

export interface ElevationThresholds {
  readonly land: number;
  readonly water: number;
}

const DEFAULT_THRESHOLDS: ElevationThresholds = { land: 0.6, water: 0.4 };

export function aggregateElevationSamples(
  samples: readonly ElevationSample[],
  thresholds: ElevationThresholds = DEFAULT_THRESHOLDS,
): ElevationAggregate {
  if (samples.length === 0) throw new RangeError('Mindestens ein Höhensample ist erforderlich.');
  if (thresholds.water < 0 || thresholds.land > 1 || thresholds.water > thresholds.land) {
    throw new RangeError('Land-/Wasserschwellen müssen zwischen 0 und 1 und geordnet sein.');
  }

  let totalWeight = 0;
  let weightedElevation = 0;
  let weightedLandFraction = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    validateSample(sample);
    const weight = sample.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0)
      throw new RangeError('Sample-Gewichte müssen positiv und endlich sein.');
    totalWeight += weight;
    weightedElevation += sample.elevationMeters * weight;
    weightedLandFraction += sample.landFraction * weight;
    minimum = Math.min(minimum, sample.elevationMeters);
    maximum = Math.max(maximum, sample.elevationMeters);
  }

  const landFraction = weightedLandFraction / totalWeight;
  return {
    elevationMeters: weightedElevation / totalWeight,
    elevationMinMeters: minimum,
    elevationMaxMeters: maximum,
    landFraction,
    isLand: landFraction >= thresholds.land,
    isWater: landFraction <= thresholds.water,
    isCoast: landFraction > thresholds.water && landFraction < thresholds.land,
  };
}

export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) throw new RangeError('Längengrad muss endlich sein.');
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function longitudeDistance(first: number, second: number): number {
  return Math.abs(normalizeLongitude(first - second));
}

function validateSample(sample: ElevationSample): void {
  if (!Number.isFinite(sample.latitude) || sample.latitude < -90 || sample.latitude > 90)
    throw new RangeError('Sample-Breite liegt außerhalb von -90 bis 90.');
  if (longitudeDistance(sample.longitude, sample.longitude) !== 0)
    throw new RangeError('Sample-Längengrad ist ungültig.');
  if (!Number.isFinite(sample.elevationMeters))
    throw new RangeError('Sample-Höhe muss endlich sein.');
  if (!Number.isFinite(sample.landFraction) || sample.landFraction < 0 || sample.landFraction > 1)
    throw new RangeError('Sample-Landanteil muss zwischen 0 und 1 liegen.');
}
