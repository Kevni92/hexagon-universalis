import type { Vector3 } from '@/topology/geodesic';
import type { ContinentalStructureDiagnostics, ContinentalSeed } from './continentalStructure';
import { createSeededNoise3D, hashSeed, type SeededNoise3D } from './seededNoise';

export type MountainRangeType = 'continental-margin' | 'inland-fold' | 'highland' | 'island-arc';

export interface MountainRange {
  readonly id: string;
  readonly type: MountainRangeType;
  readonly center: Vector3;
  readonly axis: Vector3;
  readonly normal: Vector3;
  readonly start: Vector3;
  readonly end: Vector3;
  readonly lengthRadians: number;
  readonly widthRadians: number;
  readonly strength: number;
}

export interface MountainStructureDiagnostics {
  readonly version: 1;
  readonly ranges: readonly MountainRange[];
}

export interface MountainFieldSample {
  readonly rangeId: string | null;
  readonly rangeType: MountainRangeType | null;
  readonly influence: number;
  readonly ridgeVariation: number;
}

/** Deterministisches, geodätisches Reliefgerüst für zusammenhängende Ketten. */
export class MountainStructure {
  public readonly diagnostics: MountainStructureDiagnostics;
  private readonly detailNoise: SeededNoise3D;

  public constructor(seed: string, continental: ContinentalStructureDiagnostics) {
    this.diagnostics = {
      version: 1,
      ranges: [
        ...continental.majorContinents.map((seedPoint, index) =>
          createRange(
            seed,
            seedPoint,
            index,
            index < 2 ? 'continental-margin' : index === 4 ? 'highland' : 'inland-fold',
          ),
        ),
        ...continental.islandGroups
          .slice(0, 3)
          .map((seedPoint, index) =>
            createRange(seed, seedPoint, index + continental.majorContinents.length, 'island-arc'),
          ),
      ],
    };
    this.detailNoise = createSeededNoise3D(`${seed}:mountain-detail`);
  }

  public sample(point: Vector3, landSupport: number): MountainFieldSample {
    const normalized = normalize(point);
    const landGate = smoothstep(clamp((landSupport - 0.02) / 0.28, 0, 1));
    let strongest: { range: MountainRange; influence: number } | null = null;
    for (const range of this.diagnostics.ranges) {
      const influence = rangeInfluence(normalized, range) * landGate;
      if (strongest === null || influence > strongest.influence) strongest = { range, influence };
    }
    if (strongest === null || strongest.influence <= 0) {
      return { rangeId: null, rangeType: null, influence: 0, ridgeVariation: 0 };
    }
    const detail =
      (this.detailNoise.fbm(normalized.x * 4.2, normalized.y * 4.2, normalized.z * 4.2, 3, 2, 0.5) +
        1) /
      2;
    return {
      rangeId: strongest.range.id,
      rangeType: strongest.range.type,
      influence: strongest.influence,
      ridgeVariation: 0.78 + detail * 0.22,
    };
  }
}

function createRange(
  seed: string,
  source: ContinentalSeed,
  index: number,
  type: MountainRangeType,
): MountainRange {
  const variation = (suffix: string): number =>
    hashSeed(`${seed}:mountain:${source.id}:${suffix}`) / 0xffffffff;
  const axis = tangentDirection(source.center, variation('orientation') * Math.PI * 2);
  const roundedAxis = roundVector(axis);
  const normal = roundVector(normalize(cross(source.center, roundedAxis)));
  const lengthRadians = clamp(
    (type === 'island-arc' ? 0.62 : type === 'highland' ? 1.25 : 1.55) +
      variation('length') * (type === 'island-arc' ? 0.42 : 0.85),
    0.5,
    2.5,
  );
  const widthRadians = clamp(
    (type === 'island-arc' ? 0.09 : type === 'highland' ? 0.2 : 0.14) + variation('width') * 0.1,
    0.07,
    0.3,
  );
  const strength =
    (type === 'highland' ? 0.72 : type === 'continental-margin' ? 0.84 : 0.68) +
    variation('strength') * 0.16;
  const halfLength = lengthRadians / 2;
  return {
    id: `range-${index}`,
    type,
    center: source.center,
    axis: roundedAxis,
    normal,
    start: roundVector(rotate(source.center, roundedAxis, -halfLength)),
    end: roundVector(rotate(source.center, roundedAxis, halfLength)),
    lengthRadians: round(lengthRadians),
    widthRadians: round(widthRadians),
    strength: round(strength),
  };
}

function rangeInfluence(point: Vector3, range: MountainRange): number {
  const along = Math.abs(Math.atan2(dot(point, range.axis), dot(point, range.center)));
  if (along > range.lengthRadians / 2) return 0;
  const across = Math.asin(clamp(Math.abs(dot(point, range.normal)), 0, 1));
  return (
    range.strength *
    smoothstep(1 - along / (range.lengthRadians / 2)) *
    smoothstep(1 - across / range.widthRadians)
  );
}

function tangentDirection(center: Vector3, angle: number): Vector3 {
  const reference = Math.abs(center.y) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const first = normalize(cross(reference, center));
  const second = normalize(cross(center, first));
  return normalize(add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle))));
}

function rotate(point: Vector3, axis: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return normalize(
    add(
      add(scale(point, cosine), scale(cross(axis, point), sine)),
      scale(axis, dot(axis, point) * (1 - cosine)),
    ),
  );
}

function smoothstep(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function add(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError('Reliefvektor darf nicht null sein.');
  return scale(vector, 1 / length);
}

function round(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundVector(vector: Vector3): Vector3 {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
