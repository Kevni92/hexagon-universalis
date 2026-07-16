import type { Vector3 } from '@/topology/geodesic';
import type { WorldLodLevelName } from './sevenLevelArchitecture';

export type WorldLodProjectionMode = 'globe' | 'flat';

export interface LocalTangentFrame {
  readonly center: Vector3;
  readonly east: Vector3;
  readonly north: Vector3;
  readonly up: Vector3;
  readonly radius: number;
}

export interface WorldLodProjectionState {
  readonly mode: WorldLodProjectionMode;
  readonly levelName: WorldLodLevelName;
  readonly frame: LocalTangentFrame | null;
  readonly generation: number;
  readonly reason:
    | 'level-change'
    | 'focus-recenter'
    | 'projection-hysteresis'
    | 'latitude-limit'
    | 'configuration-change';
}

export interface WorldLodSurfaceProjection {
  readonly mode: 'flat';
  readonly frame: LocalTangentFrame;
  readonly signature: string;
  readonly normal: Vector3;
  transform(point: Vector3, surfaceRadius: number): Vector3;
}

export interface WorldLodProjectionUpdate {
  readonly levelName: WorldLodLevelName;
  readonly projectedCellSizePx: number;
  readonly focus: Vector3;
  readonly radius?: number;
}

export interface WorldLodProjectionConfig {
  readonly enterCellSizePx: number;
  readonly exitCellSizePx: number;
  readonly recenterAngleRadians: number;
  readonly safetyRadiusRadians: number;
}

export const DEFAULT_WORLD_LOD_PROJECTION_CONFIG: WorldLodProjectionConfig = {
  enterCellSizePx: 32,
  exitCellSizePx: 24,
  recenterAngleRadians: degreesToRadians(6),
  safetyRadiusRadians: degreesToRadians(14),
};

const WORLD_NORTH: Vector3 = { x: 0, y: 1, z: 0 };
const WORLD_EAST: Vector3 = { x: 1, y: 0, z: 0 };
const FLAT_NORMAL: Vector3 = { x: 0, y: 0, z: 1 };

export function createLocalTangentFrame(focus: Vector3, radius = 1): LocalTangentFrame {
  assertFiniteVector(focus, 'Fokus');
  if (!Number.isFinite(radius) || radius <= 0)
    throw new RangeError('Projektionsradius muss endlich und positiv sein.');

  const up = normalize(focus, 'Fokus');
  const reference = Math.abs(dot(WORLD_NORTH, up)) > 0.985 ? WORLD_EAST : WORLD_NORTH;
  const east = normalize(cross(reference, up), 'Ostachse');
  const north = normalize(cross(up, east), 'Nordachse');
  return { center: up, east, north, up, radius };
}

/**
 * Projects a point on the sphere into local east/north coordinates. The
 * surface plane is z=0; relief is added by `projectSurfacePoint`.
 */
export function projectLocalTangentPoint(point: Vector3, frame: LocalTangentFrame): Vector3 {
  assertFiniteVector(point, 'Projektionspunkt');
  const normalizedPoint = normalize(point, 'Projektionspunkt');
  const alignment = clamp(dot(frame.up, normalizedPoint), -1, 1);
  const theta = Math.acos(alignment);
  if (theta <= Number.EPSILON) return { x: 0, y: 0, z: 0 };

  const projectedAxis = subtract(normalizedPoint, scale(frame.up, alignment));
  // The antipode has no unique tangent direction. It is outside the normal
  // flat validity radius, but still receives a deterministic fallback so a
  // full diagnostic topology cannot produce NaN/Infinity or abort a frame.
  const axis =
    Math.hypot(projectedAxis.x, projectedAxis.y, projectedAxis.z) <= Number.EPSILON
      ? frame.east
      : normalize(projectedAxis, 'Projektionsachse');
  return {
    x: theta * dot(axis, frame.east) * frame.radius,
    y: theta * dot(axis, frame.north) * frame.radius,
    z: 0,
  };
}

/** Adds the radial relief offset to a point in the local render frame. */
export function projectSurfacePoint(
  point: Vector3,
  frame: LocalTangentFrame,
  surfaceRadius: number,
): Vector3 {
  if (!Number.isFinite(surfaceRadius) || surfaceRadius <= 0)
    throw new RangeError('Oberflächenradius muss endlich und positiv sein.');
  const local = projectLocalTangentPoint(point, frame);
  return { x: local.x, y: local.y, z: surfaceRadius - frame.radius };
}

/** Inverse mapping for focus navigation and diagnostics, not world sampling. */
export function inverseProjectLocalTangentPoint(
  point: Pick<Vector3, 'x' | 'y'>,
  frame: LocalTangentFrame,
): Vector3 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError('Lokale Projektionskoordinaten müssen endlich sein.');
  const distance = Math.hypot(point.x, point.y);
  const theta = distance / frame.radius;
  if (distance <= Number.EPSILON) return frame.up;
  const axis = normalize(
    add(scale(frame.east, point.x / distance), scale(frame.north, point.y / distance)),
    'Inverse Projektionsachse',
  );
  return normalize(
    add(scale(frame.up, Math.cos(theta)), scale(axis, Math.sin(theta))),
    'Inverser Projektionspunkt',
  );
}

export function createFlatSurfaceProjection(frame: LocalTangentFrame): WorldLodSurfaceProjection {
  const signature = [frame.center.x, frame.center.y, frame.center.z, frame.radius]
    .map((value) => value.toFixed(8))
    .join(',');
  return {
    mode: 'flat',
    frame,
    signature,
    normal: FLAT_NORMAL,
    transform: (point, surfaceRadius) => projectSurfacePoint(point, frame, surfaceRadius),
  };
}

export function angularDistance(first: Vector3, second: Vector3): number {
  return Math.acos(
    clamp(dot(normalize(first, 'Erster Punkt'), normalize(second, 'Zweiter Punkt')), -1, 1),
  );
}

export function isWithinProjectionRadius(
  point: Vector3,
  frame: LocalTangentFrame,
  radiusRadians = DEFAULT_WORLD_LOD_PROJECTION_CONFIG.safetyRadiusRadians,
): boolean {
  if (!Number.isFinite(radiusRadians) || radiusRadians < 0)
    throw new RangeError('Projektionsgültigkeitsradius muss endlich und nichtnegativ sein.');
  return angularDistance(point, frame.center) <= radiusRadians;
}

export class WorldLodProjectionController {
  private readonly config: WorldLodProjectionConfig;
  private state: WorldLodProjectionState = {
    mode: 'globe',
    levelName: 'global',
    frame: null,
    generation: 0,
    reason: 'level-change',
  };

  public constructor(config: Partial<WorldLodProjectionConfig> = {}) {
    this.config = { ...DEFAULT_WORLD_LOD_PROJECTION_CONFIG, ...config };
    if (
      this.config.enterCellSizePx <= 0 ||
      this.config.exitCellSizePx <= 0 ||
      this.config.exitCellSizePx >= this.config.enterCellSizePx ||
      this.config.recenterAngleRadians <= 0 ||
      this.config.safetyRadiusRadians < this.config.recenterAngleRadians
    )
      throw new RangeError('Ungültige Globe-/Flat-Projektionsbudgets.');
  }

  public get current(): WorldLodProjectionState {
    return this.state;
  }

  public update(input: WorldLodProjectionUpdate): WorldLodProjectionState {
    const radius = input.radius ?? 1;
    assertFiniteVector(input.focus, 'Projektionsfokus');
    if (!Number.isFinite(input.projectedCellSizePx) && input.projectedCellSizePx !== Infinity)
      throw new RangeError('Projizierte Zellgröße muss endlich oder Infinity sein.');
    const focus = normalize(input.focus, 'Projektionsfokus');
    const flatLevel = input.levelName === 'local' || input.levelName === 'detail';
    const wantsFlat = flatLevel && input.projectedCellSizePx >= this.config.enterCellSizePx;
    const canStayFlat = flatLevel && input.projectedCellSizePx >= this.config.exitCellSizePx;

    if (this.state.mode === 'globe' && wantsFlat) {
      return this.commit(
        'flat',
        input.levelName,
        createLocalTangentFrame(focus, radius),
        'level-change',
      );
    }
    if (this.state.mode === 'flat' && !canStayFlat) {
      return this.commit('globe', input.levelName, null, 'projection-hysteresis');
    }
    if (this.state.levelName !== input.levelName) {
      if (this.state.mode === 'flat' && flatLevel) {
        return this.commit(
          'flat',
          input.levelName,
          createLocalTangentFrame(focus, radius),
          'level-change',
        );
      }
      return this.commit('globe', input.levelName, null, 'level-change');
    }
    if (this.state.mode === 'flat' && this.state.frame !== null) {
      if (angularDistance(this.state.frame.center, focus) > this.config.recenterAngleRadians) {
        return this.commit(
          'flat',
          input.levelName,
          createLocalTangentFrame(focus, radius),
          'focus-recenter',
        );
      }
    }
    return this.state;
  }

  public focusKey(focus: Vector3): string {
    const normalized = normalize(focus, 'Projektionsfokus');
    const latitude = Math.asin(clamp(normalized.y, -1, 1));
    const longitude = Math.atan2(normalized.x, normalized.z);
    const step = this.config.recenterAngleRadians;
    return `${Math.round(latitude / step)}:${Math.round(longitude / step)}`;
  }

  public reset(): void {
    this.state = {
      mode: 'globe',
      levelName: 'global',
      frame: null,
      generation: 0,
      reason: 'configuration-change',
    };
  }

  private commit(
    mode: WorldLodProjectionMode,
    levelName: WorldLodLevelName,
    frame: LocalTangentFrame | null,
    reason: WorldLodProjectionState['reason'],
  ): WorldLodProjectionState {
    this.state = {
      mode,
      levelName,
      frame,
      generation: this.state.generation + 1,
      reason,
    };
    return this.state;
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function assertFiniteVector(vector: Vector3, label: string): void {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite))
    throw new RangeError(`${label} muss endlich sein.`);
}

function normalize(vector: Vector3, label: string): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError(`${label} darf nicht null sein.`);
  return scale(vector, 1 / length);
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

function subtract(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
