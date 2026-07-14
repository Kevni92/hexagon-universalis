export type ReliefMode = 'accurate' | 'game';

export interface ReliefProfile {
  readonly mode: ReliefMode;
  readonly baseRadius: number;
  readonly maxLandElevationMeters: number;
  readonly maxOceanDepthMeters: number;
  readonly maxLandLift: number;
  readonly maxOceanDrop: number;
}

export const RELIEF_PROFILES: Readonly<Record<ReliefMode, ReliefProfile>> = {
  accurate: {
    mode: 'accurate',
    baseRadius: 1,
    maxLandElevationMeters: 9000,
    maxOceanDepthMeters: 11000,
    maxLandLift: 0.035,
    maxOceanDrop: 0.008,
  },
  game: {
    mode: 'game',
    baseRadius: 1,
    maxLandElevationMeters: 9000,
    maxOceanDepthMeters: 11000,
    maxLandLift: 0.12,
    maxOceanDrop: 0.025,
  },
};

export function elevationToRadius(
  elevationMeters: number,
  profile: ReliefProfile = RELIEF_PROFILES.accurate,
): number {
  validateProfile(profile);
  if (!Number.isFinite(elevationMeters)) throw new RangeError('Höhe muss endlich sein.');
  if (elevationMeters === 0) return profile.baseRadius;
  if (elevationMeters > 0) {
    const clamped = Math.min(elevationMeters, profile.maxLandElevationMeters);
    const normalized =
      Math.log1p(clamped / 1000) / Math.log1p(profile.maxLandElevationMeters / 1000);
    return profile.baseRadius + normalized * profile.maxLandLift;
  }
  const clamped = Math.min(-elevationMeters, profile.maxOceanDepthMeters);
  const normalized = Math.log1p(clamped / 1000) / Math.log1p(profile.maxOceanDepthMeters / 1000);
  return profile.baseRadius - normalized * profile.maxOceanDrop;
}

export function cellElevation(
  elevationMeters: number,
  elevationMaxMeters: number,
  maxContribution = 0.35,
): number {
  if (!Number.isFinite(elevationMeters) || !Number.isFinite(elevationMaxMeters))
    throw new RangeError('Zellhöhen müssen endlich sein.');
  if (elevationMaxMeters < elevationMeters)
    throw new RangeError('elevationMaxMeters darf nicht kleiner als elevationMeters sein.');
  if (!Number.isFinite(maxContribution) || maxContribution < 0 || maxContribution > 1)
    throw new RangeError('maxContribution muss zwischen 0 und 1 liegen.');
  return elevationMeters + (elevationMaxMeters - elevationMeters) * maxContribution;
}

function validateProfile(profile: ReliefProfile): void {
  if (
    profile.baseRadius <= 0 ||
    profile.maxLandElevationMeters <= 0 ||
    profile.maxOceanDepthMeters <= 0 ||
    profile.maxLandLift < 0 ||
    profile.maxOceanDrop < 0
  )
    throw new RangeError('Reliefprofil enthält ungültige Grenzwerte.');
}
