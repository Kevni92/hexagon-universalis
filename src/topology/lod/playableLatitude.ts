import type { Vector3 } from '@/topology/geodesic';

export interface PlayableLatitudeConfig {
  /** Nördliche Grenze in Grad; der Wert ist positiv und kleiner als 90. */
  readonly maxLatitudeDegrees: number;
  /** Symmetrischer Hysteresepuffer für den Eintritt in die Flat-Nahansicht. */
  readonly hysteresisDegrees: number;
}

export interface PlayableLatitudeBounds {
  readonly northRadians: number;
  readonly southRadians: number;
}

export interface PlayableLatitudeState {
  readonly latitudeRadians: number;
  readonly latitudeDegrees: number;
  readonly withinPlayableRange: boolean;
  readonly flatAllowed: boolean;
  readonly boundary: 'north' | 'south' | null;
}

export const DEFAULT_PLAYABLE_LATITUDE_CONFIG: PlayableLatitudeConfig = {
  maxLatitudeDegrees: 78,
  hysteresisDegrees: 1,
};

/**
 * Zentrale, render-unabhängige Gebietsregel für die spielbare Nahansicht.
 * Weltmodell und globale Globe-LOD bleiben von dieser Maske unberührt.
 */
export class PlayableLatitudeController {
  private readonly config: PlayableLatitudeConfig;
  private readonly bounds: PlayableLatitudeBounds;
  private readonly entryBounds: PlayableLatitudeBounds;

  public constructor(config: Partial<PlayableLatitudeConfig> = {}) {
    this.config = { ...DEFAULT_PLAYABLE_LATITUDE_CONFIG, ...config };
    if (
      !Number.isFinite(this.config.maxLatitudeDegrees) ||
      this.config.maxLatitudeDegrees <= 0 ||
      this.config.maxLatitudeDegrees >= 90
    )
      throw new RangeError('Maximaler spielbarer Breitengrad muss zwischen 0 und 90 Grad liegen.');
    if (
      !Number.isFinite(this.config.hysteresisDegrees) ||
      this.config.hysteresisDegrees < 0 ||
      this.config.hysteresisDegrees >= this.config.maxLatitudeDegrees
    )
      throw new RangeError(
        'Breitengrad-Hysterese muss positiv oder null und kleiner als die Grenze sein.',
      );

    this.bounds = {
      northRadians: degreesToRadians(this.config.maxLatitudeDegrees),
      southRadians: degreesToRadians(this.config.maxLatitudeDegrees),
    };
    const entryRadians = degreesToRadians(
      this.config.maxLatitudeDegrees - this.config.hysteresisDegrees,
    );
    this.entryBounds = { northRadians: entryRadians, southRadians: entryRadians };
  }

  public get maxLatitudeDegrees(): number {
    return this.config.maxLatitudeDegrees;
  }

  public get boundsForFlat(): PlayableLatitudeBounds {
    return this.bounds;
  }

  public evaluate(focus: Vector3, currentlyFlat = false): PlayableLatitudeState {
    const normalized = normalize(focus);
    const latitudeRadians = Math.asin(clamp(normalized.y, -1, 1));
    const latitudeDegrees = radiansToDegrees(latitudeRadians);
    const limit = latitudeRadians >= 0 ? this.bounds.northRadians : this.bounds.southRadians;
    const entryLimit =
      latitudeRadians >= 0 ? this.entryBounds.northRadians : this.entryBounds.southRadians;
    const withinPlayableRange = Math.abs(latitudeRadians) <= limit;
    const flatAllowed = currentlyFlat
      ? withinPlayableRange
      : Math.abs(latitudeRadians) <= entryLimit;
    const boundary =
      latitudeRadians > this.bounds.northRadians
        ? 'north'
        : latitudeRadians < -this.bounds.southRadians
          ? 'south'
          : null;
    return { latitudeRadians, latitudeDegrees, withinPlayableRange, flatAllowed, boundary };
  }

  public clampFocus(focus: Vector3): Vector3 {
    const normalized = normalize(focus);
    const latitude = Math.asin(clamp(normalized.y, -1, 1));
    const limit = latitude >= 0 ? this.bounds.northRadians : this.bounds.southRadians;
    if (Math.abs(latitude) <= limit) return normalized;

    const y = Math.sin(Math.sign(latitude) * limit);
    const horizontal = Math.hypot(normalized.x, normalized.z);
    if (horizontal <= Number.EPSILON) return { x: 0, y, z: Math.cos(limit) };
    const horizontalScale = Math.cos(limit) / horizontal;
    return { x: normalized.x * horizontalScale, y, z: normalized.z * horizontalScale };
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Fokus darf nicht null sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
