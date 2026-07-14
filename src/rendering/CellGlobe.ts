import * as THREE from 'three';

import type { GeodesicTopology, Vector3 } from '@/topology/geodesic';

export interface CellGlobeGeometryData {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly cellIds: readonly string[];
  readonly triangleCount: number;
}

const CELL_GAP_FACTOR = 0.985;

export function createCellGlobeGeometryData(
  topology: GeodesicTopology,
  radius = topology.radius,
): CellGlobeGeometryData {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new RangeError('radius muss größer als 0 sein.');

  const positions: number[] = [];
  const normals: number[] = [];
  const cellIds: string[] = [];

  for (const cell of topology.cells) {
    for (let index = 0; index < cell.boundary.length; index += 1) {
      const nextIndex = (index + 1) % cell.boundary.length;
      const first = scale(at(cell.boundary, index), CELL_GAP_FACTOR);
      const second = scale(at(cell.boundary, nextIndex), CELL_GAP_FACTOR);
      const center = cell.center;
      const normal = triangleNormal(center, first, second);
      const triangle = dot(normal, center) >= 0 ? [center, first, second] : [center, second, first];
      for (const vertex of triangle) {
        positions.push(vertex.x * radius, vertex.y * radius, vertex.z * radius);
        normals.push(vertex.x, vertex.y, vertex.z);
      }
      cellIds.push(cell.id);
    }
  }

  return { positions, normals, cellIds, triangleCount: cellIds.length };
}

export function createCellGlobeMesh(
  topology: GeodesicTopology,
  radius = topology.radius,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const data = createCellGlobeGeometryData(topology, radius);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8cff,
    flatShading: true,
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'cell-globe';
  mesh.userData.cellIds = data.cellIds;
  mesh.userData.triangleCount = data.triangleCount;
  return mesh;
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
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
