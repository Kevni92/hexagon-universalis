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
    // 'a' bleibt dieselbe Mesh-Instanz (kein unnötiger Rebuild).
    expect(renderer.meshes.find((mesh) => mesh.name === 'a')).toBe(meshA);
  });

  it('draw calls (active chunk count) grow with visible chunks, not with total addressable cells', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(8); // 642 adressierbare Zellen
    const visibleSubset = patch.cells.slice(0, 6);
    renderer.update(
      visibleSubset.map((cell, index) => ({ key: `k${index}`, level: 0 as const, cells: [cell] })),
    );
    expect(renderer.activeChunkCount).toBe(6);
    expect(renderer.activeChunkCount).toBeLessThan(patch.cells.length);
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
