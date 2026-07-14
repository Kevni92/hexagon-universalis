import * as THREE from 'three';

import type { GeodesicCell, GeodesicTopology } from '@/topology/geodesic';
import type { VisibleUnit } from '@/topology/lod/WorldLod';
import { createCellGlobeGeometryData } from './CellGlobe';

/**
 * Rendert eine stabile Liste sichtbarer Zell-Chunks (`VisibleUnit[]`) als
 * ein Three.js-Mesh pro Chunk – kein Mesh und kein Material pro Zelle, kein
 * einzelnes Voll-Welt-Mesh (siehe ADR 0001 / #58 "Rendering-Schnittstelle").
 * `update()` fügt neue Chunks hinzu, entfernt nicht mehr sichtbare Chunks
 * und lässt unveränderte Chunks unangetastet (differenzielles Update).
 * `dispose()` gibt alle Geometrien und Materialien vollständig frei.
 */
export class ChunkRenderer {
  public readonly group = new THREE.Group();

  private readonly meshesByKey = new Map<
    string,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  >();
  private disposed = false;

  public constructor(
    private readonly radius = 1,
    private cellColors?: ReadonlyMap<string, string>,
  ) {
    this.group.name = 'chunk-renderer';
  }

  /** Anzahl aktuell aktiver (gerenderter) Chunks – entspricht der Draw-Call-Zahl dieses Renderers. */
  public get activeChunkCount(): number {
    return this.meshesByKey.size;
  }

  /** Gesamtzahl aktuell materialisierter Zellen über alle aktiven Chunks. */
  public get activeCellCount(): number {
    let total = 0;
    for (const mesh of this.meshesByKey.values())
      total +=
        (mesh.userData.cellIds as readonly string[]).length > 0
          ? new Set(mesh.userData.cellIds as readonly string[]).size
          : 0;
    return total;
  }

  /** Alle aktuell über Chunk-Meshes referenzierten globalen CellIds (für Picking-Validierung). */
  public get activeCellIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const mesh of this.meshesByKey.values())
      for (const id of mesh.userData.cellIds as readonly string[]) ids.add(id);
    return ids;
  }

  public get meshes(): readonly THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] {
    return [...this.meshesByKey.values()];
  }

  /**
   * Differenzielles Update: baut Meshes für neue Units, entfernt Meshes für
   * nicht mehr enthaltene Units, lässt bestehende Units unverändert (stabile
   * Chunk-Identität über `unit.key`).
   */
  public update(units: readonly VisibleUnit[]): void {
    if (this.disposed) throw new Error('ChunkRenderer wurde bereits disposed.');
    const nextKeys = new Set(units.map((unit) => unit.key));

    for (const [key, mesh] of this.meshesByKey) {
      if (nextKeys.has(key)) continue;
      this.disposeMesh(mesh);
      this.meshesByKey.delete(key);
    }

    for (const unit of units) {
      if (this.meshesByKey.has(unit.key)) continue;
      const mesh = this.buildMesh(unit);
      this.meshesByKey.set(unit.key, mesh);
      this.group.add(mesh);
    }
  }

  /** Aktualisiert reale Zellfarben und baut nur die aktuell sichtbaren Chunks neu. */
  public setCellColors(colors: ReadonlyMap<string, string>, units: readonly VisibleUnit[]): void {
    if (this.disposed) return;
    this.cellColors = colors;
    for (const mesh of this.meshesByKey.values()) this.disposeMesh(mesh);
    this.meshesByKey.clear();
    this.update(units);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshesByKey.values()) this.disposeMesh(mesh);
    this.meshesByKey.clear();
    this.group.clear();
  }

  private buildMesh(
    unit: VisibleUnit,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const topology = unitToTopology(unit);
    const data = createCellGlobeGeometryData(topology, this.radius, this.cellColors);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    if (this.cellColors !== undefined)
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: this.cellColors !== undefined ? 0xffffff : 0x4f8cff,
      flatShading: true,
      roughness: 0.72,
      metalness: 0.08,
      side: THREE.FrontSide,
      vertexColors: this.cellColors !== undefined,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = unit.key;
    mesh.userData.cellIds = data.cellIds;
    mesh.userData.triangleCount = data.triangleCount;
    mesh.userData.level = unit.level;
    return mesh;
  }

  private disposeMesh(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

/** Verpackt die Zellen einer VisibleUnit als minimale GeodesicTopology für die bestehende Geometrie-Pipeline. */
function unitToTopology(unit: VisibleUnit): GeodesicTopology {
  const cells: GeodesicCell[] = unit.cells.map((lodCell) => ({
    id: lodCell.formattedId,
    center: lodCell.cell.center,
    boundary: lodCell.cell.boundary,
    neighborIds: lodCell.cell.neighborIds,
    type: lodCell.cell.type,
  }));
  return {
    frequency: 0,
    radius: 1,
    cells,
    cellsById: new Map(cells.map((cell) => [cell.id, cell])),
  };
}
