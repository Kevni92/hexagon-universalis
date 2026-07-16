import * as THREE from 'three';

import type { GeodesicTopology, Vector3 } from '@/topology/geodesic';
import type { TerrainClass } from '@/data/terrain';
import type { WorldLodSurfaceProjection } from '@/topology/lod/projection';
import { terrainColor } from './TerrainVisuals';

export interface CellGlobeGeometryData {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly cellIds: readonly string[];
  readonly colors: readonly number[];
  readonly triangleCount: number;
  readonly topTriangleCount: number;
  readonly sideTriangleCount: number;
}

export type CellSurfaceMode = 'spherical' | 'tangent-plane';
export type CellSurfaceRadius = (position: Vector3, cellId: string) => number;

export interface CellPodiumOptions {
  readonly baseRadius: number;
  readonly sideColorFactor?: number;
}

interface ResolvedCellPodiumOptions {
  readonly baseRadius: number;
  readonly sideColorFactor: number;
}

type Rgb = readonly [number, number, number];

interface GeometryBuffers {
  readonly positions: number[];
  readonly normals: number[];
  readonly cellIds: string[];
  readonly colors: number[];
}

export function createCellGlobeGeometryData(
  topology: GeodesicTopology,
  radius = topology.radius,
  cellColors?: ReadonlyMap<string, string>,
  surfaceMode: CellSurfaceMode = 'spherical',
  surfaceRadius?: CellSurfaceRadius,
  podiumOptions?: CellPodiumOptions,
  surfaceProjection?: WorldLodSurfaceProjection,
): CellGlobeGeometryData {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new RangeError('radius muss größer als 0 sein.');

  const podium = resolvePodiumOptions(podiumOptions);
  if (podium !== undefined && (surfaceMode !== 'spherical' || surfaceProjection !== undefined))
    throw new RangeError('Podestgeometrie unterstützt nur sphärische Zellflächen.');
  const buffers: GeometryBuffers = {
    positions: [],
    normals: [],
    cellIds: [],
    colors: [],
  };
  let topTriangleCount = 0;
  let sideTriangleCount = 0;

  for (const cell of topology.cells) {
    const topColor =
      cellColors === undefined ? undefined : hexToRgb(cellColors.get(cell.id) ?? '#173b68');
    const sideColor =
      topColor === undefined || podium === undefined
        ? undefined
        : shadeRgb(topColor, podium.sideColorFactor);
    const topNormal =
      surfaceProjection?.normal ??
      (surfaceMode === 'tangent-plane' || podium !== undefined ? cell.center : undefined);
    const topVertexNormal = topNormal === undefined ? normalize : (): Vector3 => topNormal;
    const topCenter = surfaceVertex(
      cell.center,
      cell.id,
      radius,
      surfaceRadius,
      podium?.baseRadius,
      surfaceProjection,
    );
    const topBoundary = cell.boundary.map((boundary) =>
      surfaceVertex(
        surfacePoint(boundary, cell.center, surfaceMode),
        cell.id,
        radius,
        surfaceRadius,
        podium?.baseRadius,
        surfaceProjection,
      ),
    );

    for (let index = 0; index < topBoundary.length; index += 1) {
      const nextIndex = (index + 1) % topBoundary.length;
      appendTriangle(
        buffers,
        topCenter,
        at(topBoundary, index),
        at(topBoundary, nextIndex),
        topNormal ?? cell.center,
        cell.id,
        topColor,
        topVertexNormal,
      );
      topTriangleCount += 1;
    }

    if (podium === undefined) continue;
    const baseBoundary = cell.boundary.map((boundary) =>
      scale(normalize(boundary), podium.baseRadius),
    );
    for (let index = 0; index < topBoundary.length; index += 1) {
      const nextIndex = (index + 1) % topBoundary.length;
      const topFirst = at(topBoundary, index);
      const topSecond = at(topBoundary, nextIndex);
      const baseFirst = at(baseBoundary, index);
      const baseSecond = at(baseBoundary, nextIndex);
      const outward = edgeOutwardNormal(
        cell.center,
        at(cell.boundary, index),
        at(cell.boundary, nextIndex),
      );
      appendTriangle(buffers, topFirst, baseFirst, baseSecond, outward, cell.id, sideColor);
      appendTriangle(buffers, topFirst, baseSecond, topSecond, outward, cell.id, sideColor);
      sideTriangleCount += 2;
    }
  }

  return {
    ...buffers,
    triangleCount: buffers.cellIds.length,
    topTriangleCount,
    sideTriangleCount,
  };
}

export function terrainClassesToCellColors(
  terrainClasses: ReadonlyMap<string, TerrainClass>,
): ReadonlyMap<string, string> {
  return new Map(
    [...terrainClasses].map(([cellId, terrainClass]) => [
      cellId,
      terrainColor(terrainClass, cellId),
    ]),
  );
}

export function createCellGlobeMesh(
  topology: GeodesicTopology,
  radius = topology.radius,
  cellColors?: ReadonlyMap<string, string>,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const data = createCellGlobeGeometryData(topology, radius, cellColors);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  if (cellColors !== undefined)
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: cellColors !== undefined ? 0xffffff : 0x4f8cff,
    flatShading: false,
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.FrontSide,
    vertexColors: cellColors !== undefined,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'cell-globe';
  mesh.userData.cellIds = data.cellIds;
  mesh.userData.triangleCount = data.triangleCount;
  mesh.userData.topTriangleCount = data.topTriangleCount;
  mesh.userData.sideTriangleCount = data.sideTriangleCount;
  return mesh;
}

function appendTriangle(
  buffers: GeometryBuffers,
  first: Vector3,
  second: Vector3,
  third: Vector3,
  expectedNormal: Vector3,
  cellId: string,
  color?: Rgb,
  vertexNormal?: (vertex: Vector3) => Vector3,
): void {
  const triangle =
    dot(triangleNormal(first, second, third), expectedNormal) >= 0
      ? ([first, second, third] as const)
      : ([first, third, second] as const);
  const faceNormal = normalize(triangleNormal(triangle[0], triangle[1], triangle[2]));
  for (const vertex of triangle) {
    buffers.positions.push(vertex.x, vertex.y, vertex.z);
    const normal = vertexNormal?.(vertex) ?? faceNormal;
    buffers.normals.push(normal.x, normal.y, normal.z);
    if (color !== undefined) buffers.colors.push(...color);
  }
  buffers.cellIds.push(cellId);
}

function surfacePoint(boundary: Vector3, center: Vector3, surfaceMode: CellSurfaceMode): Vector3 {
  if (surfaceMode === 'spherical') return boundary;
  const planeOffset = 1 - dot(boundary, center);
  return {
    x: boundary.x + center.x * planeOffset,
    y: boundary.y + center.y * planeOffset,
    z: boundary.z + center.z * planeOffset,
  };
}

function surfaceVertex(
  point: Vector3,
  cellId: string,
  fallbackRadius: number,
  surfaceRadius?: CellSurfaceRadius,
  baseRadius?: number,
  surfaceProjection?: WorldLodSurfaceProjection,
): Vector3 {
  const vertexRadius = resolvedRadius(point, cellId, fallbackRadius, surfaceRadius);
  if (baseRadius !== undefined && vertexRadius <= baseRadius)
    throw new RangeError(`Podestbasis muss unter der Oberfläche von Zelle ${cellId} liegen.`);
  return surfaceProjection?.transform(normalize(point), vertexRadius) ?? scale(point, vertexRadius);
}

function resolvedRadius(
  vertex: Vector3,
  cellId: string,
  fallback: number,
  surfaceRadius?: CellSurfaceRadius,
): number {
  const value = surfaceRadius?.(normalize(vertex), cellId) ?? fallback;
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`Ungültiger Oberflächenradius für Zelle ${cellId}.`);
  return value;
}

function resolvePodiumOptions(options?: CellPodiumOptions): ResolvedCellPodiumOptions | undefined {
  if (options === undefined) return undefined;
  const sideColorFactor = options.sideColorFactor ?? 0.62;
  if (!Number.isFinite(options.baseRadius) || options.baseRadius <= 0)
    throw new RangeError('Podestbasis muss größer als 0 sein.');
  if (!Number.isFinite(sideColorFactor) || sideColorFactor <= 0 || sideColorFactor > 1)
    throw new RangeError('Seitenfarbfaktor muss größer als 0 und höchstens 1 sein.');
  return { baseRadius: options.baseRadius, sideColorFactor };
}

function edgeOutwardNormal(center: Vector3, first: Vector3, second: Vector3): Vector3 {
  const midpoint = normalize(add(normalize(first), normalize(second)));
  const tangent = subtract(midpoint, scale(center, dot(midpoint, center)));
  return normalize(tangent);
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError('Oberflächenpunkt muss endlich sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function add(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  };
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
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

function triangleNormal(first: Vector3, second: Vector3, third: Vector3): Vector3 {
  return cross(subtract(second, first), subtract(third, first));
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Index außerhalb des Bereichs: ${index}.`);
  return item;
}

function shadeRgb(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function hexToRgb(color: string): Rgb {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
