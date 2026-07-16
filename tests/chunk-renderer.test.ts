import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ChunkRenderer } from '@/rendering/ChunkRenderer';
import { createGlobalPatch } from '@/topology/lod/hierarchy';
import { createFlatSurfaceProjection, createLocalTangentFrame } from '@/topology/lod/projection';
import type { VisibleUnit } from '@/topology/lod/WorldLod';

function unitsFromPatchCells(count: number): VisibleUnit[] {
  const patch = createGlobalPatch(4);
  const cells = patch.cells.slice(0, count);
  return cells.map((cell, index) => ({
    key: `unit-${index}`,
    level: 0 as const,
    cells: [cell],
  }));
}

describe('ChunkRenderer', () => {
  it('creates exactly one mesh per visible unit (no per-cell mesh/material)', () => {
    const renderer = new ChunkRenderer();
    const units = unitsFromPatchCells(5);
    renderer.update(units);
    expect(renderer.activeChunkCount).toBe(5);
    expect(renderer.group.children).toHaveLength(5);
  });

  it('preserves the cellId mapping per chunk mesh for picking', () => {
    const renderer = new ChunkRenderer();
    const units = unitsFromPatchCells(2);
    renderer.update(units);
    for (const mesh of renderer.meshes) {
      const cellIds = mesh.userData.cellIds as readonly string[];
      expect(cellIds.length).toBeGreaterThan(0);
      expect(cellIds.every((id) => typeof id === 'string')).toBe(true);
    }
    expect(renderer.activeCellIds.size).toBe(2);
  });

  it('applies relief podiums with one fixed substrate draw call instead of per-cell meshes', () => {
    const units = unitsFromPatchCells(2);
    const liftedCellId = units[0]?.cells[0]?.formattedId;
    if (liftedCellId === undefined) throw new Error('missing lifted cell');
    const renderer = new ChunkRenderer(1, undefined, (_position, _level, cellId) =>
      cellId === liftedCellId ? 1.08 : 0.98,
    );

    renderer.update(units);

    expect(renderer.activeChunkCount).toBe(3);
    expect(renderer.activeSubstrateDrawCallCount).toBe(1);
    expect(renderer.activeCellIds).toEqual(
      new Set(units.map((unit) => unit.cells[0]!.formattedId)),
    );
    expect(renderer.activeSideTriangleCount).toBeGreaterThan(0);
    const radiiByMesh = new Map(
      renderer.meshes.map((mesh) => {
        const positions = mesh.geometry.getAttribute('position');
        const topVertexCount = Number(mesh.userData.topTriangleCount) * 3;
        const topRadii = Array.from({ length: topVertexCount }, (_, index) =>
          Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
        );
        const allRadii = Array.from({ length: positions.count }, (_, index) =>
          Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
        );
        return [
          mesh.name,
          {
            topMinimum: Math.min(...topRadii),
            topMaximum: Math.max(...topRadii),
            minimum: Math.min(...allRadii),
          },
        ] as const;
      }),
    );
    expect(radiiByMesh.get('unit-0')?.topMinimum).toBeCloseTo(1.08, 6);
    expect(radiiByMesh.get('unit-0')?.topMaximum).toBeCloseTo(1.08, 6);
    expect(radiiByMesh.get('unit-1')?.topMinimum).toBeCloseTo(0.98, 6);
    expect(radiiByMesh.get('unit-1')?.topMaximum).toBeCloseTo(0.98, 6);
    expect(radiiByMesh.get('unit-0')?.minimum).toBeCloseTo(0.975, 6);
    expect(radiiByMesh.get('unit-1')?.minimum).toBeCloseTo(0.975, 6);
  });

  it('keeps local relief vertices radially bounded and adds two side faces per edge', () => {
    const cell = createGlobalPatch(4).cells[0];
    if (cell === undefined) throw new Error('missing local cell');
    const cellId = 'lvl2-local/g0/p0/c0';
    const unit: VisibleUnit = {
      key: 'lvl2-local/g0/p0',
      level: 2,
      cells: [cell],
      cellIds: [cellId],
    };
    const renderer = new ChunkRenderer(1, new Map([[cellId, '#809060']]), () => 1.08);

    renderer.update([unit]);

    const mesh = renderer.meshes[0];
    if (mesh === undefined) throw new Error('missing local mesh');
    const positions = mesh.geometry.getAttribute('position');
    const radii = Array.from({ length: positions.count }, (_, index) =>
      Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
    );
    expect(Math.max(...radii)).toBeLessThanOrEqual(1.080001);
    expect(Math.min(...radii)).toBeCloseTo(0.975, 6);
    expect(mesh.userData.topTriangleCount).toBe(cell.cell.boundary.length);
    expect(mesh.userData.sideTriangleCount).toBe(cell.cell.boundary.length * 2);
    expect(mesh.userData.triangleCount).toBe(cell.cell.boundary.length * 3);
    expect(new Set(mesh.userData.cellIds as readonly string[])).toEqual(new Set([cellId]));
    expect(renderer.activeChunkCount).toBe(2);
  });

  it('reprojects a local chunk into east/north coordinates and hides the globe substrate', () => {
    const cell = createGlobalPatch(4).cells[0];
    if (cell === undefined) throw new Error('missing local cell');
    const renderer = new ChunkRenderer(1, undefined, () => 1);
    const projection = createFlatSurfaceProjection(createLocalTangentFrame(cell.cell.center));

    renderer.update([{ key: 'flat', level: 2, cells: [cell] }], projection);

    const mesh = renderer.meshes[0];
    if (mesh === undefined) throw new Error('missing flat mesh');
    const positions = mesh.geometry.getAttribute('position');
    expect(renderer.activeSubstrateDrawCallCount).toBe(0);
    expect(
      renderer.group.children.find((child) => child.name === 'procedural-planet-substrate'),
    ).toMatchObject({
      visible: false,
    });
    expect(
      Array.from({ length: positions.count }, (_, index) => positions.getZ(index)).some(
        (value) => Math.abs(value) < 1e-6,
      ),
    ).toBe(true);

    renderer.update([{ key: 'flat', level: 2, cells: [cell] }], undefined);
    expect(renderer.meshes[0]).not.toBe(mesh);
    expect(
      renderer.group.children.find((child) => child.name === 'procedural-planet-substrate'),
    ).toMatchObject({
      visible: true,
    });
  });

  it('covers podium seams with a non-pickable substrate below the shared base radius', () => {
    const renderer = new ChunkRenderer(1, undefined, () => 1.04);
    renderer.update(unitsFromPatchCells(1));
    const substrate = renderer.group.children.find(
      (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> =>
        child instanceof THREE.Mesh && child.name === 'procedural-planet-substrate',
    );
    expect(substrate).toBeDefined();
    if (substrate === undefined) throw new Error('missing substrate');

    const positions = substrate.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1)
      expect(
        Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)),
      ).toBeCloseTo(0.974, 5);
    expect(substrate.material.color.getHex()).toBe(0x496a7a);
    const intersections: THREE.Intersection[] = [];
    substrate.raycast(new THREE.Raycaster(), intersections);
    expect(intersections).toEqual([]);

    let disposedGeometry = false;
    let disposedMaterial = false;
    const originalGeometryDispose = substrate.geometry.dispose.bind(substrate.geometry);
    substrate.geometry.dispose = () => {
      disposedGeometry = true;
      originalGeometryDispose();
    };
    const originalMaterialDispose = substrate.material.dispose.bind(substrate.material);
    substrate.material.dispose = () => {
      disposedMaterial = true;
      originalMaterialDispose();
    };
    renderer.dispose();
    expect(disposedGeometry).toBe(true);
    expect(disposedMaterial).toBe(true);
  });

  it('differentially adds and removes chunks without rebuilding unchanged ones', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(4);
    const [a, b, c] = patch.cells;
    if (a === undefined || b === undefined || c === undefined) throw new Error('missing cells');

    renderer.update([
      { key: 'a', level: 0, cells: [a] },
      { key: 'b', level: 0, cells: [b] },
    ]);
    const meshA = renderer.meshes.find((mesh) => mesh.name === 'a');
    expect(meshA).toBeDefined();

    renderer.update([
      { key: 'a', level: 0, cells: [a] },
      { key: 'c', level: 0, cells: [c] },
    ]);
    expect(renderer.activeChunkCount).toBe(2);
    expect(renderer.meshes.find((mesh) => mesh.name === 'b')).toBeUndefined();
    expect(renderer.meshes.find((mesh) => mesh.name === 'a')).toBe(meshA);
  });

  it('draw calls (active chunk count) grow with visible chunks, not with total addressable cells', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(8);
    const visibleSubset = patch.cells.slice(0, 6);
    renderer.update(
      visibleSubset.map((cell, index) => ({
        key: `k${index}`,
        level: 0 as const,
        cells: [cell],
      })),
    );
    expect(renderer.activeChunkCount).toBe(6);
    expect(renderer.activeChunkCount).toBeLessThan(patch.cells.length);
  });

  it('rebuilds a stable bundle key when its cell composition changes', () => {
    const patch = createGlobalPatch(2);
    const renderer = new ChunkRenderer();
    renderer.update([{ key: 'lvl0-global/root', level: 0, cells: patch.cells.slice(0, 6) }]);
    const firstMesh = renderer.meshes[0];

    renderer.update([{ key: 'lvl0-global/root', level: 0, cells: patch.cells.slice(6, 12) }]);

    expect(renderer.meshes[0]).not.toBe(firstMesh);
    expect(renderer.activeCellIds).toEqual(
      new Set(patch.cells.slice(6, 12).map((cell) => cell.formattedId)),
    );
  });

  it('crossfades replaced LOD meshes and disposes the old mesh after the transition', () => {
    const patch = createGlobalPatch(2);
    const first = patch.cells[0];
    const second = patch.cells[1];
    if (first === undefined || second === undefined) throw new Error('missing cells');
    const renderer = new ChunkRenderer(1, undefined, undefined, 0, 0.2);

    renderer.update([{ key: 'first', level: 0, cells: [first] }]);
    renderer.update([{ key: 'second', level: 1, cells: [second] }]);

    expect(renderer.group.children).toHaveLength(2);
    const incoming = renderer.meshes[0];
    if (incoming === undefined) throw new Error('missing incoming mesh');
    expect(incoming.material.opacity).toBe(0);
    renderer.updateTransitions(0.1);
    expect(incoming.material.opacity).toBeGreaterThan(0);
    expect(incoming.material.opacity).toBeLessThan(1);
    renderer.updateTransitions(0.1);
    expect(renderer.group.children).toHaveLength(1);
    expect(incoming.material.opacity).toBe(1);
  });

  it('disposes all geometries and materials and clears the group', () => {
    const renderer = new ChunkRenderer();
    const units = unitsFromPatchCells(4);
    renderer.update(units);
    const meshes = renderer.meshes;
    let disposedGeometries = 0;
    let disposedMaterials = 0;
    for (const mesh of meshes) {
      const originalGeometryDispose = mesh.geometry.dispose.bind(mesh.geometry);
      mesh.geometry.dispose = () => {
        disposedGeometries += 1;
        originalGeometryDispose();
      };
      const originalMaterialDispose = mesh.material.dispose.bind(mesh.material);
      mesh.material.dispose = () => {
        disposedMaterials += 1;
        originalMaterialDispose();
      };
    }

    renderer.dispose();

    expect(disposedGeometries).toBe(4);
    expect(disposedMaterials).toBe(4);
    expect(renderer.activeChunkCount).toBe(0);
    expect(renderer.group.children).toHaveLength(0);
  });

  it('repeated update cycles do not accumulate meshes (no resource leak on repeated zoom)', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(4);
    const [a, b] = patch.cells;
    if (a === undefined || b === undefined) throw new Error('missing cells');

    for (let i = 0; i < 25; i += 1) {
      renderer.update([{ key: 'a', level: 0, cells: [a] }]);
      renderer.update([{ key: 'b', level: 0, cells: [b] }]);
    }
    expect(renderer.activeChunkCount).toBe(1);
    expect(renderer.group.children).toHaveLength(1);
  });

  it('throws when updated after dispose', () => {
    const renderer = new ChunkRenderer();
    renderer.dispose();
    expect(() => renderer.update(unitsFromPatchCells(1))).toThrow();
  });

  it('reuses a bounded cache of three full-world LOD meshes across zoom cycles', () => {
    const renderer = new ChunkRenderer(1, undefined, undefined, 3);
    const patch = createGlobalPatch(4);
    const units = ([0, 1, 2] as const).map((level) => ({
      key: `level-${level}`,
      level,
      cells: patch.cells,
    }));
    const identities = new Map<string, THREE.Mesh>();

    for (const unit of units) {
      renderer.update([unit]);
      identities.set(unit.key, renderer.meshes[0]!);
    }
    for (let cycle = 0; cycle < 10; cycle += 1)
      for (const unit of units) {
        renderer.update([unit]);
        expect(renderer.meshes[0]).toBe(identities.get(unit.key));
      }

    expect(renderer.cacheStats).toEqual({
      cachedMeshes: 2,
      geometryBuilds: 3,
      geometryDisposals: 0,
    });
    renderer.dispose();
    expect(renderer.cacheStats.geometryDisposals).toBe(3);
  });
});
