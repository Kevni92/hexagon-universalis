import { describe, expect, it } from 'vitest';

import { ChunkRenderer } from '@/rendering/ChunkRenderer';
import { createGlobalPatch } from '@/topology/lod/hierarchy';
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

  it('applies relief podiums per stable picking cell without adding draw calls', () => {
    const units = unitsFromPatchCells(2);
    const liftedCellId = units[0]?.cells[0]?.formattedId;
    if (liftedCellId === undefined) throw new Error('missing lifted cell');
    const renderer = new ChunkRenderer(1, undefined, (_position, _level, cellId) =>
      cellId === liftedCellId ? 1.08 : 0.98,
    );

    renderer.update(units);

    expect(renderer.activeChunkCount).toBe(2);
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
    expect(renderer.activeChunkCount).toBe(1);
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
      visibleSubset.map((cell, index) => ({ key: `k${index}`, level: 0 as const, cells: [cell] })),
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
});
