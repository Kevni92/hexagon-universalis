import * as THREE from 'three';

import type { GeodesicCell, Vector3 } from '@/topology/geodesic';
import type { LodCell } from '@/topology/lod/hierarchy';
import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { ProceduralLodCell, ProceduralWorldLodLevel } from '@/world/proceduralWorldLod';

import {
  createTileDetails,
  detailTypeBudgets,
  type DetailInstance,
  type DetailType,
} from './TileDetails';
import {
  createEdgeTransitionDetails,
  ownsTransitionEdge,
  type SharedEdge2d,
  type TransitionCell,
  type TransitionLod,
} from './TileTransitions';
import { proceduralElevationMeters, proceduralSurfaceRadius } from './ProceduralTerrain';

export interface ProceduralDetailPlacement extends DetailInstance {
  readonly cellId: string;
  readonly level: ProceduralWorldLodLevel;
  readonly center: Vector3;
  readonly cellRadius: number;
  readonly elevation: number;
  readonly transition: boolean;
}

export type ProceduralCellLookup = (cellId: string) => ProceduralLodCell | undefined;

interface ProjectedEntry {
  readonly lodCell: LodCell;
  readonly cellId: string;
  readonly projected: ProceduralLodCell;
  readonly cellRadius: number;
}

const DETAIL_COLORS: Readonly<Record<DetailType, number>> = {
  deciduousTree: 0x3f7d42,
  conifer: 0x254f38,
  lowConifer: 0x496a4d,
  tropicalTree: 0x16734b,
  tree: 0x3d7650,
  shrub: 0x647a43,
  lowShrub: 0x71845c,
  lowTree: 0x3f7259,
  rock: 0x756d63,
  grass: 0x92a755,
  building: 0xb27a62,
  ice: 0xcbeaf3,
};

export function createProceduralDetailPlan(
  units: readonly VisibleUnit[],
  projectedCell: ProceduralCellLookup,
): readonly ProceduralDetailPlacement[] {
  const budgets = detailTypeBudgets();
  const used = new Map<DetailType, number>();
  const placements: ProceduralDetailPlacement[] = [];
  const append = (
    detail: DetailInstance,
    entry: ProjectedEntry,
    level: ProceduralWorldLodLevel,
    transition: boolean,
  ): void => {
    const count = used.get(detail.detailType) ?? 0;
    if (count >= budgets[detail.detailType]) return;
    used.set(detail.detailType, count + 1);
    placements.push({
      ...detail,
      cellId: entry.cellId,
      level,
      center: entry.lodCell.cell.center,
      cellRadius: entry.cellRadius,
      elevation: entry.projected.elevation,
      transition,
    });
  };

  for (const unit of [...units].sort((left, right) => left.key.localeCompare(right.key))) {
    const level = levelName(unit.level);
    if (level === 'global') continue;
    const entries = unit.cells
      .map((lodCell, index) => {
        const cellId = visibleCellId(unit, index);
        const projected = projectedCell(cellId);
        return projected === undefined
          ? undefined
          : {
              lodCell,
              cellId,
              projected,
              cellRadius: meanCellRadius(lodCell.cell),
            };
      })
      .filter((entry): entry is ProjectedEntry => entry !== undefined)
      .sort((left, right) => left.cellId.localeCompare(right.cellId));
    const byTopologyId = new Map(entries.map((entry) => [entry.lodCell.cell.id, entry] as const));

    for (const entry of entries) {
      const count = level === 'regional' ? 1 : 3;
      for (const detail of createTileDetails({
        cellId: entry.cellId,
        tileType: entry.projected.tileType,
        modifiers: entry.projected.modifiers,
        count,
      }))
        append(detail, entry, level, false);
    }

    const transitionLod: TransitionLod = level === 'regional' ? 1 : 3;
    for (const source of entries) {
      for (const neighborTopologyId of source.lodCell.cell.neighborIds) {
        const target = byTopologyId.get(neighborTopologyId);
        if (target === undefined || !ownsTransitionEdge(source.cellId, target.cellId)) continue;
        const targetEdge = sharedEdgeInCell(target.lodCell.cell, source.lodCell.cell);
        const sourceEdge = sharedEdgeInCell(source.lodCell.cell, target.lodCell.cell);
        if (targetEdge !== null)
          for (const detail of createEdgeTransitionDetails(
            transitionCell(source),
            transitionCell(target),
            targetEdge,
            transitionLod,
          ))
            append(detail, target, level, true);
        if (sourceEdge !== null)
          for (const detail of createEdgeTransitionDetails(
            transitionCell(target),
            transitionCell(source),
            sourceEdge,
            transitionLod,
          ))
            append(detail, source, level, true);
      }
    }
  }

  return placements;
}

export class ProceduralDetailRenderer {
  public readonly group = new THREE.Group();

  private meshes: THREE.InstancedMesh[] = [];
  private signature = '';
  private disposed = false;

  public constructor() {
    this.group.name = 'procedural-details';
  }

  public get activeInstanceCount(): number {
    return this.meshes.reduce((sum, mesh) => sum + mesh.count, 0);
  }

  public get activeDrawCallCount(): number {
    return this.meshes.length;
  }

  public update(
    units: readonly VisibleUnit[],
    projectedCell: ProceduralCellLookup,
    worldFingerprint: string,
  ): void {
    if (this.disposed) throw new Error('ProceduralDetailRenderer wurde bereits disposed.');
    const nextSignature = `${worldFingerprint}:${units
      .map(
        (unit) =>
          `${unit.key}:${unit.cells.map((_cell, index) => visibleCellId(unit, index)).join(',')}`,
      )
      .join('|')}`;
    if (nextSignature === this.signature) return;
    this.signature = nextSignature;
    this.disposeMeshes();
    if (!('InstancedMesh' in THREE)) return;

    const byType = new Map<DetailType, ProceduralDetailPlacement[]>();
    for (const placement of createProceduralDetailPlan(units, projectedCell)) {
      const entries = byType.get(placement.detailType) ?? [];
      entries.push(placement);
      byType.set(placement.detailType, entries);
    }
    for (const [detailType, placements] of byType) {
      const mesh = this.createMesh(detailType, placements);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeMeshes();
    this.group.clear();
  }

  private createMesh(
    detailType: DetailType,
    placements: readonly ProceduralDetailPlacement[],
  ): THREE.InstancedMesh {
    const geometry = geometryForDetail(detailType);
    const material = new THREE.MeshStandardMaterial({
      color: DETAIL_COLORS[detailType],
      roughness: detailType === 'ice' ? 0.4 : 0.9,
      metalness: 0,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = `procedural-detail-${detailType}`;
    mesh.frustumCulled = true;
    mesh.raycast = () => {};
    const object = new THREE.Object3D();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const tangentX = new THREE.Vector3();
    const tangentY = new THREE.Vector3();
    const align = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const reference = new THREE.Vector3();

    placements.forEach((placement, index) => {
      direction.set(placement.center.x, placement.center.y, placement.center.z).normalize();
      reference.set(0, Math.abs(direction.y) < 0.92 ? 1 : 0, Math.abs(direction.y) < 0.92 ? 0 : 1);
      tangentX.crossVectors(reference, direction).normalize();
      tangentY.crossVectors(direction, tangentX).normalize();
      direction
        .addScaledVector(tangentX, placement.x * placement.cellRadius * 0.72)
        .addScaledVector(tangentY, placement.y * placement.cellRadius * 0.72)
        .normalize();
      const objectScale = placement.cellRadius * detailScale(detailType) * placement.scale;
      const radius =
        proceduralSurfaceRadius(placement.elevation, placement.level) + objectScale * 0.45;
      object.position.copy(direction).multiplyScalar(radius);
      align.setFromUnitVectors(worldUp, direction);
      spin.setFromAxisAngle(direction, placement.rotation);
      object.quaternion.copy(align).multiply(spin);
      object.scale.setScalar(objectScale);
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.cellIds = placements.map((placement) => placement.cellId);
    mesh.userData.transitionCount = placements.filter((placement) => placement.transition).length;
    return mesh;
  }

  private disposeMeshes(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
    this.meshes = [];
  }
}

function transitionCell(entry: ProjectedEntry): TransitionCell {
  return {
    cellId: entry.cellId,
    tileType: entry.projected.tileType,
    modifiers: entry.projected.modifiers,
    elevationMeters: proceduralElevationMeters(entry.projected.elevation),
    landFraction: entry.projected.surface === 'land' ? 1 : 0,
  };
}

function sharedEdgeInCell(target: GeodesicCell, neighbor: GeodesicCell): SharedEdge2d | null {
  const matches = target.boundary
    .map((point) => ({ point, distance: nearestDistance(point, neighbor.boundary) }))
    .filter((entry) => entry.distance < 1e-5)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 2)
    .map((entry) => entry.point);
  const [first, second] = matches;
  if (first === undefined || second === undefined) return null;
  const scale = meanCellRadius(target);
  const frame = tangentFrame(target.center);
  return {
    start: localPoint(first, target.center, frame.x, frame.y, scale),
    end: localPoint(second, target.center, frame.x, frame.y, scale),
  };
}

function tangentFrame(center: Vector3): { readonly x: Vector3; readonly y: Vector3 } {
  const reference = Math.abs(center.y) < 0.92 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const x = normalize(cross(reference, center));
  return { x, y: normalize(cross(center, x)) };
}

function localPoint(
  point: Vector3,
  center: Vector3,
  tangentX: Vector3,
  tangentY: Vector3,
  scale: number,
): { readonly x: number; readonly y: number } {
  const offset = {
    x: point.x - center.x,
    y: point.y - center.y,
    z: point.z - center.z,
  };
  return { x: dot(offset, tangentX) / scale, y: dot(offset, tangentY) / scale };
}

function meanCellRadius(cell: GeodesicCell): number {
  return (
    cell.boundary.reduce(
      (sum, point) =>
        sum + Math.hypot(point.x - cell.center.x, point.y - cell.center.y, point.z - cell.center.z),
      0,
    ) / cell.boundary.length
  );
}

function nearestDistance(point: Vector3, candidates: readonly Vector3[]): number {
  return Math.min(
    ...candidates.map((candidate) =>
      Math.hypot(point.x - candidate.x, point.y - candidate.y, point.z - candidate.z),
    ),
  );
}

function geometryForDetail(detailType: DetailType): THREE.BufferGeometry {
  if (detailType === 'rock') return new THREE.DodecahedronGeometry(0.45, 0);
  if (detailType === 'building') return new THREE.BoxGeometry(0.55, 0.8, 0.55);
  if (detailType === 'ice') return new THREE.OctahedronGeometry(0.5, 0);
  if (detailType === 'grass') return new THREE.ConeGeometry(0.12, 0.65, 4);
  if (detailType === 'shrub' || detailType === 'lowShrub')
    return new THREE.DodecahedronGeometry(detailType === 'lowShrub' ? 0.3 : 0.4, 0);
  return new THREE.ConeGeometry(
    detailType === 'lowConifer' || detailType === 'lowTree' ? 0.3 : 0.38,
    detailType === 'lowConifer' || detailType === 'lowTree' ? 0.8 : 1.1,
    detailType === 'deciduousTree' || detailType === 'tropicalTree' ? 6 : 5,
  );
}

function detailScale(detailType: DetailType): number {
  if (detailType === 'grass') return 0.34;
  if (detailType === 'rock' || detailType === 'ice') return 0.42;
  if (detailType === 'building') return 0.5;
  if (detailType === 'shrub' || detailType === 'lowShrub') return 0.38;
  return 0.48;
}

function levelName(level: 0 | 1 | 2): ProceduralWorldLodLevel {
  return (['global', 'regional', 'local'] as const)[level];
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

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
