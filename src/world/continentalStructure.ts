import type { Vector3 } from '@/topology/geodesic';
import { hashSeed } from './seededNoise';

export type ContinentalSeedKind = 'continent' | 'island' | 'basin';

export interface ContinentalSeed {
  readonly id: string;
  readonly kind: ContinentalSeedKind;
  readonly center: Vector3;
  readonly radiusRadians: number;
  readonly strength: number;
}

export interface ContinentalStructureDiagnostics {
  readonly version: 1;
  readonly majorContinents: readonly ContinentalSeed[];
  readonly islandGroups: readonly ContinentalSeed[];
  readonly oceanBasins: readonly ContinentalSeed[];
}

export interface ContinentalFieldSample {
  readonly continentInfluence: number;
  readonly islandInfluence: number;
  readonly basinInfluence: number;
  readonly landSupport: number;
}

const MAJOR_CONTINENT_COUNT = 5;
const ISLAND_GROUP_COUNT = 7;
const OCEAN_BASIN_COUNT = 4;
const UINT32_MAX = 0xffffffff;

/**
 * Seedbasierte Großgeographie auf der Einheitskugel. Die Keime sind fachliche
 * Parameter und damit unabhängig von Zellindex, Frequenz und Renderer.
 */
export class ContinentalStructure {
  public readonly diagnostics: ContinentalStructureDiagnostics;

  public constructor(seed: string, continentScale: number) {
    if (seed.length === 0) throw new RangeError('Makrostruktur-Seed darf nicht leer sein.');
    if (!Number.isFinite(continentScale) || continentScale <= 0)
      throw new RangeError('Makrostruktur-Skalierung muss positiv und endlich sein.');

    this.diagnostics = {
      version: 1,
      majorContinents: createSeeds(seed, 'continent', MAJOR_CONTINENT_COUNT, continentScale),
      islandGroups: createSeeds(seed, 'island', ISLAND_GROUP_COUNT, continentScale),
      oceanBasins: createSeeds(seed, 'basin', OCEAN_BASIN_COUNT, continentScale),
    };
  }

  public sample(point: Vector3): ContinentalFieldSample {
    const normalized = normalize(point);
    const continentInfluence = maximumInfluence(normalized, this.diagnostics.majorContinents);
    const islandInfluence = maximumInfluence(normalized, this.diagnostics.islandGroups);
    const basinInfluence = maximumInfluence(normalized, this.diagnostics.oceanBasins);
    const landSupport = continentInfluence * 0.92 + islandInfluence * 0.68 - basinInfluence * 0.2;
    return { continentInfluence, islandInfluence, basinInfluence, landSupport };
  }
}

function createSeeds(
  seed: string,
  kind: ContinentalSeedKind,
  count: number,
  continentScale: number,
): readonly ContinentalSeed[] {
  return Array.from({ length: count }, (_, index) => {
    const variation = (suffix: string): number =>
      hashToUnit(`${seed}:macro:${kind}:${index}:${suffix}`);
    const latitudeRange = kind === 'basin' ? 62 : kind === 'island' ? 58 : 52;
    const latitude = degreesToRadians((variation('latitude') * 2 - 1) * latitudeRange);
    const longitude = (variation('longitude') * 2 - 1) * Math.PI;
    const radiusBase = kind === 'continent' ? 0.96 : kind === 'island' ? 0.24 : 0.82;
    const radiusVariation = kind === 'continent' ? 0.25 : kind === 'island' ? 0.13 : 0.3;
    const scaleFactor = Math.sqrt(1.35 / continentScale);
    const radiusRadians = clamp(
      (radiusBase + variation('radius') * radiusVariation) * scaleFactor,
      kind === 'island' ? 0.12 : 0.52,
      kind === 'island' ? 0.42 : 1.35,
    );
    const strength =
      kind === 'continent'
        ? 0.92 + variation('strength') * 0.16
        : kind === 'island'
          ? 0.62 + variation('strength') * 0.2
          : 0.42 + variation('strength') * 0.2;
    return {
      id: `${kind}-${index}`,
      kind,
      center: roundVector({
        x: Math.cos(latitude) * Math.sin(longitude),
        y: Math.sin(latitude),
        z: Math.cos(latitude) * Math.cos(longitude),
      }),
      radiusRadians: round(radiusRadians),
      strength: round(strength),
    };
  });
}

function maximumInfluence(point: Vector3, seeds: readonly ContinentalSeed[]): number {
  return seeds.reduce(
    (maximum, seed) =>
      Math.max(
        maximum,
        seed.strength * falloff(angularDistance(point, seed.center), seed.radiusRadians),
      ),
    0,
  );
}

function falloff(distance: number, radius: number): number {
  const remaining = clamp(1 - distance / radius, 0, 1);
  return remaining * remaining * (3 - 2 * remaining);
}

function angularDistance(first: Vector3, second: Vector3): number {
  return Math.acos(clamp(dot(first, second), -1, 1));
}

function hashToUnit(value: string): number {
  return hashSeed(value) / UINT32_MAX;
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError('Makropunkt darf nicht null sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function roundVector(vector: Vector3): Vector3 {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
