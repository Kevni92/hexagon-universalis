export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export type RiverClass = 'major' | 'regional' | 'detailed';

export interface RiverLine {
  readonly riverId: string;
  readonly order: number;
  readonly points: readonly GeoPoint[];
  readonly cellIds: readonly string[];
}

export function classifyRiver(order: number): RiverClass {
  if (!Number.isInteger(order) || order < 1)
    throw new RangeError('Flussordnung muss eine positive ganze Zahl sein.');
  return order <= 3 ? 'major' : order <= 5 ? 'regional' : 'detailed';
}

export function simplifyRiver(
  points: readonly GeoPoint[],
  toleranceDegrees: number,
): readonly GeoPoint[] {
  if (points.length < 2) throw new RangeError('Eine Flusslinie benötigt mindestens zwei Punkte.');
  if (!Number.isFinite(toleranceDegrees) || toleranceDegrees < 0)
    throw new RangeError('Vereinfachungstoleranz muss nichtnegativ und endlich sein.');
  points.forEach(validatePoint);
  if (points.length <= 2 || toleranceDegrees === 0) return points.map(normalizePoint);
  const keep = new Set<number>([0, points.length - 1]);
  simplifyRange(points, 0, points.length - 1, toleranceDegrees, keep);
  return [...keep]
    .sort((first, second) => first - second)
    .map((index) => normalizePoint(at(points, index)));
}

export function createRiverLine(
  riverId: string,
  order: number,
  points: readonly GeoPoint[],
  cellIds: readonly string[],
): RiverLine {
  if (riverId.trim() === '') throw new RangeError('Fluss-ID darf nicht leer sein.');
  if (cellIds.length === 0)
    throw new RangeError('Fluss muss mindestens einer Zelle zugeordnet sein.');
  return { riverId, order, points: simplifyRiver(points, 0), cellIds: [...new Set(cellIds)] };
}

function simplifyRange(
  points: readonly GeoPoint[],
  start: number,
  end: number,
  tolerance: number,
  keep: Set<number>,
): void {
  let furthest = -1;
  let distance = tolerance;
  for (let index = start + 1; index < end; index += 1) {
    const candidate = perpendicularDistance(at(points, index), at(points, start), at(points, end));
    if (candidate > distance) {
      distance = candidate;
      furthest = index;
    }
  }
  if (furthest >= 0) {
    keep.add(furthest);
    simplifyRange(points, start, furthest, tolerance, keep);
    simplifyRange(points, furthest, end, tolerance, keep);
  }
}

function perpendicularDistance(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const x = longitudeDistance(point.longitude, start.longitude);
  const y = point.latitude - start.latitude;
  const dx = longitudeDistance(end.longitude, start.longitude);
  const dy = end.latitude - start.latitude;
  const denominator = Math.hypot(dx, dy);
  return denominator === 0 ? Math.hypot(x, y) : Math.abs(dy * x - dx * y) / denominator;
}

function longitudeDistance(first: number, second: number): number {
  return Math.abs(((((first - second + 540) % 360) + 360) % 360) - 180);
}

function validatePoint(point: GeoPoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90)
    throw new RangeError('Ungültige Flussbreite.');
  if (!Number.isFinite(point.longitude)) throw new RangeError('Ungültiger Flusslängengrad.');
}

function normalizePoint(point: GeoPoint): GeoPoint {
  const longitude = ((((point.longitude + 180) % 360) + 360) % 360) - 180;
  return {
    latitude: point.latitude,
    longitude: Number(longitude.toFixed(12)),
  };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Index außerhalb des Bereichs: ${index}.`);
  return item;
}
