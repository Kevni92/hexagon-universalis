import * as THREE from 'three';

import type { GeodesicTopology, Vector3 } from '@/topology/geodesic';
import type { TerrainClass } from '@/data/terrain';
import { terrainColor } from './TerrainVisuals';

export interface CellGlobeGeometryData {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly cellIds: readonly string[];
  readonly colors: readonly number[];
  readonly triangleCount: number;
}

export type CellSurfaceMode = 'spherical' | 'tangent-plane';
export type CellSurfaceRadius = (position: Vector3, cellId: string) => number;

export function createCellGlobeGeometryData(
  topology: GeodesicTopology,
  radius = topology.radius,
  cellColors?: ReadonlyMap<string, string>,
  surfaceMode: CellSurfaceMode = 'spherical',
  surfaceRadius?: CellSurfaceRadius,
): CellGlobeGeometryData {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new RangeError('radius muss größer als 0 sein.');

  const positions: number[] = [];
  const normals: number[] = [];
  const cellIds: string[] = [];
  const colors: number[] = [];

  for (const cell of topology.cells) {
    for (let index = 0; index < cell.boundary.length; index += 1) {
      const nextIndex = (index + 1) % cell.boundary.length;
      const center = cell.center;
      const first = surfacePoint(at(cell.boundary, index), center, surfaceMode);
      const second = surfacePoint(at(cell.boundary, nextIndex), center, surfaceMode);
      const normal = triangleNormal(center, first, second);
      const triangle = dot(normal, center) >= 0 ? [center, first, second] : [center, second, first];
      for (const vertex of triangle) {
        const vertexRadius = resolvedRadius(vertex, cell.id, radius, surfaceRadius);
        positions.push(vertex.x * vertexRadius, vertex.y * vertexRadius, vertex.z * vertexRadius);
        const vertexNormal = surfaceMode === 'tangent-plane' ? center : normalize(vertex);
        normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z);
        if (cellColors !== undefined)
          colors.push(...hexToRgb(cellColors.get(cell.id) ?? '#173b68'));
      }
      cellIds.push(cell.id);
    }
  }

  return { positions, normals, cellIds, colors, triangleCount: cellIds.length };
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
  return mesh;
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

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError('Oberflächenpunkt muss endlich sein.');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
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

function hexToRgb(color: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
