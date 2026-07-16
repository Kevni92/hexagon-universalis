export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type CellType = 'hexagon' | 'pentagon';

export interface GeodesicCell {
  readonly id: string;
  readonly center: Vector3;
  readonly boundary: readonly Vector3[];
  readonly neighborIds: readonly string[];
  readonly type: CellType;
}

export interface GeodesicTopology {
  readonly frequency: number;
  readonly radius: number;
  readonly cells: readonly GeodesicCell[];
  readonly cellsById: ReadonlyMap<string, GeodesicCell>;
}

interface Face {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const DEFAULT_FREQUENCY = 2;
// Complete intermediate topology is still practical through f34. Higher
// levels stay chunk-addressed and are never materialized as one sphere.
const MAX_FREQUENCY = 34;

const ICOSAHEDRON_VERTICES: readonly Vector3[] = (
  [
    [-1, GOLDEN_RATIO, 0],
    [1, GOLDEN_RATIO, 0],
    [-1, -GOLDEN_RATIO, 0],
    [1, -GOLDEN_RATIO, 0],
    [0, -1, GOLDEN_RATIO],
    [0, 1, GOLDEN_RATIO],
    [0, -1, -GOLDEN_RATIO],
    [0, 1, -GOLDEN_RATIO],
    [GOLDEN_RATIO, 0, -1],
    [GOLDEN_RATIO, 0, 1],
    [-GOLDEN_RATIO, 0, -1],
    [-GOLDEN_RATIO, 0, 1],
  ] as readonly (readonly [number, number, number])[]
).map(([x, y, z]) => normalize({ x, y, z }));

const ICOSAHEDRON_FACES: readonly Face[] = [
  { a: 0, b: 11, c: 5 },
  { a: 0, b: 5, c: 1 },
  { a: 0, b: 1, c: 7 },
  { a: 0, b: 7, c: 10 },
  { a: 0, b: 10, c: 11 },
  { a: 1, b: 5, c: 9 },
  { a: 5, b: 11, c: 4 },
  { a: 11, b: 10, c: 2 },
  { a: 10, b: 7, c: 6 },
  { a: 7, b: 1, c: 8 },
  { a: 3, b: 9, c: 4 },
  { a: 3, b: 4, c: 2 },
  { a: 3, b: 2, c: 6 },
  { a: 3, b: 6, c: 8 },
  { a: 3, b: 8, c: 9 },
  { a: 4, b: 9, c: 5 },
  { a: 2, b: 4, c: 11 },
  { a: 6, b: 2, c: 10 },
  { a: 8, b: 6, c: 7 },
  { a: 9, b: 8, c: 1 },
];

export function createGeodesicTopology(frequency = DEFAULT_FREQUENCY): GeodesicTopology {
  validateFrequency(frequency);

  const vertices: Vector3[] = [];
  const vertexIds = new Map<string, number>();
  const triangles: Triangle[] = [];
  const edgePoints = new Map<string, number>();

  const addVertex = (position: Vector3, key: string): number => {
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push(normalize(position));
    vertexIds.set(key, index);
    return index;
  };

  const pointOnEdge = (first: number, second: number, step: number): number => {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    const reverse = first !== low;
    const edgeKey = `${low}:${high}:${reverse ? frequency - step : step}`;
    const existing = edgePoints.get(edgeKey);
    if (existing !== undefined) return existing;
    const actualStep = reverse ? frequency - step : step;
    const position = lerp(
      at(ICOSAHEDRON_VERTICES, low),
      at(ICOSAHEDRON_VERTICES, high),
      actualStep / frequency,
    );
    const index = addVertex(position, `edge:${edgeKey}`);
    edgePoints.set(edgeKey, index);
    return index;
  };

  const pointFor = (faceIndex: number, face: Face, a: number, b: number, c: number): number => {
    if (a === frequency) return addVertex(at(ICOSAHEDRON_VERTICES, face.a), `vertex:${face.a}`);
    if (b === frequency) return addVertex(at(ICOSAHEDRON_VERTICES, face.b), `vertex:${face.b}`);
    if (c === frequency) return addVertex(at(ICOSAHEDRON_VERTICES, face.c), `vertex:${face.c}`);
    if (a === 0) return pointOnEdge(face.b, face.c, c);
    if (b === 0) return pointOnEdge(face.a, face.c, c);
    if (c === 0) return pointOnEdge(face.a, face.b, b);
    return addVertex(
      weightedAverage(
        at(ICOSAHEDRON_VERTICES, face.a),
        at(ICOSAHEDRON_VERTICES, face.b),
        at(ICOSAHEDRON_VERTICES, face.c),
        a,
        b,
        c,
      ),
      `face:${faceIndex}:${a}:${b}:${c}`,
    );
  };

  ICOSAHEDRON_FACES.forEach((face, faceIndex) => {
    const oriented = orientFace(face);
    for (let a = 0; a < frequency; a += 1) {
      for (let b = 0; b < frequency - a; b += 1) {
        const c = frequency - a - b;
        const first = [
          pointFor(faceIndex, oriented, a, b, c),
          pointFor(faceIndex, oriented, a + 1, b, c - 1),
          pointFor(faceIndex, oriented, a, b + 1, c - 1),
        ];
        triangles.push(orientTriangle(first, vertices));
        if (c > 1) {
          const second = [
            pointFor(faceIndex, oriented, a + 1, b, c - 1),
            pointFor(faceIndex, oriented, a + 1, b + 1, c - 2),
            pointFor(faceIndex, oriented, a, b + 1, c - 1),
          ];
          triangles.push(orientTriangle(second, vertices));
        }
      }
    }
  });

  const centers = triangles.map(({ a, b, c }) =>
    normalize(average(at(vertices, a), at(vertices, b), at(vertices, c))),
  );
  const incidentTriangles = vertices.map(() => [] as number[]);
  const neighborSets = vertices.map(() => new Set<number>());
  triangles.forEach((triangle, index) => {
    at(incidentTriangles, triangle.a).push(index);
    at(incidentTriangles, triangle.b).push(index);
    at(incidentTriangles, triangle.c).push(index);
    addNeighbor(neighborSets, triangle.a, triangle.b);
    addNeighbor(neighborSets, triangle.a, triangle.c);
    addNeighbor(neighborSets, triangle.b, triangle.c);
  });

  const cells = vertices.map((center, index) => {
    const orderedTriangles = [...at(incidentTriangles, index)].sort(
      (left, right) =>
        angleAround(center, at(centers, left)) - angleAround(center, at(centers, right)),
    );
    const boundary = orderedTriangles.map((triangleIndex) => at(centers, triangleIndex));
    const neighborIds = [...at(neighborSets, index)]
      .sort((left, right) => left - right)
      .map((neighbor) => cellId(neighbor));
    return {
      id: cellId(index),
      center,
      boundary,
      neighborIds,
      type: neighborIds.length === 5 ? 'pentagon' : 'hexagon',
    } satisfies GeodesicCell;
  });

  return { frequency, radius: 1, cells, cellsById: new Map(cells.map((cell) => [cell.id, cell])) };
}

export function cellId(index: number): string {
  return `cell-${index.toString(36).padStart(4, '0')}`;
}

function validateFrequency(frequency: number): void {
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > MAX_FREQUENCY) {
    throw new RangeError(`frequency muss eine ganze Zahl zwischen 1 und ${MAX_FREQUENCY} sein.`);
  }
}

function orientFace(face: Face): Face {
  const a = at(ICOSAHEDRON_VERTICES, face.a);
  const b = at(ICOSAHEDRON_VERTICES, face.b);
  const c = at(ICOSAHEDRON_VERTICES, face.c);
  return dot(cross(subtract(b, a), subtract(c, a)), a) >= 0
    ? face
    : { a: face.a, b: face.c, c: face.b };
}

function orientTriangle(indices: number[], vertices: readonly Vector3[]): Triangle {
  const [a, b, c] = indices;
  if (a === undefined || b === undefined || c === undefined)
    throw new Error('Ungültiges Unterteilungsdreieck.');
  return dot(
    cross(subtract(at(vertices, b), at(vertices, a)), subtract(at(vertices, c), at(vertices, a))),
    at(vertices, a),
  ) >= 0
    ? { a, b, c }
    : { a, b: c, c: b };
}

function addNeighbor(sets: Set<number>[], first: number, second: number): void {
  at(sets, first).add(second);
  at(sets, second).add(first);
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Index außerhalb des Bereichs: ${index}.`);
  return item;
}

function angleAround(center: Vector3, point: Vector3): number {
  const reference = Math.abs(center.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const first = normalize(cross(reference, center));
  const second = cross(center, first);
  const projected = subtract(point, scale(center, dot(point, center)));
  return Math.atan2(dot(projected, second), dot(projected, first));
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) throw new Error('Der Nullvektor kann nicht normalisiert werden.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
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
function average(first: Vector3, second: Vector3, third: Vector3): Vector3 {
  return scale(add(add(first, second), third), 1 / 3);
}
function lerp(first: Vector3, second: Vector3, factor: number): Vector3 {
  return add(scale(first, 1 - factor), scale(second, factor));
}
function weightedAverage(
  first: Vector3,
  second: Vector3,
  third: Vector3,
  a: number,
  b: number,
  c: number,
): Vector3 {
  return scale(add(add(scale(first, a), scale(second, b)), scale(third, c)), 1 / (a + b + c));
}
function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
function cross(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}
