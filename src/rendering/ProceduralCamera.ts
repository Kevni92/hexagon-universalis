import { PROCEDURAL_RELIEF_PROFILE } from './ProceduralTerrain';

export const PROCEDURAL_CAMERA_RANGE = {
  minDistance: 1.2,
  maxDistance: 3.4,
} as const;

/** Anteil der Viewporthöhe, den der projizierte Kugeldurchmesser belegt. */
export function projectedSphereHeightFraction(
  distance: number,
  fovDegrees: number,
  sphereRadius = 1,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(fovDegrees) ||
    !Number.isFinite(sphereRadius) ||
    distance <= sphereRadius ||
    fovDegrees <= 0 ||
    fovDegrees >= 180 ||
    sphereRadius <= 0
  )
    throw new RangeError('Kamera- und Kugelparameter sind ungültig.');

  const angularRadius = Math.asin(sphereRadius / distance);
  const halfFov = (fovDegrees * Math.PI) / 360;
  return Math.tan(angularRadius) / Math.tan(halfFov);
}

export function proceduralNearSurfaceClearance(nearPlane: number): number {
  if (!Number.isFinite(nearPlane) || nearPlane < 0)
    throw new RangeError('Near Plane muss endlich und nicht negativ sein.');
  const maximumSurfaceRadius =
    PROCEDURAL_RELIEF_PROFILE.baseRadius + PROCEDURAL_RELIEF_PROFILE.maxLandLift;
  return PROCEDURAL_CAMERA_RANGE.minDistance - maximumSurfaceRadius - nearPlane;
}
