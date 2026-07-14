import { describe, expect, it } from 'vitest';

import { cellIdFromTriangle } from '@/input/CellPicking';
import { ChunkRenderer } from '@/rendering/ChunkRenderer';
import { createChunkForParent, createGlobalPatch } from '@/topology/lod/hierarchy';

describe('picking across multi-LOD chunk meshes', () => {
  it('resolves the correct global (hierarchical) cell ID from a chunk mesh triangle', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(2);
    const target = patch.cells[3];
    if (target === undefined) throw new Error('missing cell');

    renderer.update([{ key: 'unit-target', level: 0, cells: [target] }]);
    const mesh = renderer.meshes[0];
    if (mesh === undefined) throw new Error('missing mesh');

    const cellIds = mesh.userData.cellIds as readonly string[];
    // Jedes Dreieck der einzelligen Chunk-Geometrie referenziert dieselbe,
    // vollständig hierarchische CellId.
    for (let triangleIndex = 0; triangleIndex < cellIds.length; triangleIndex += 1) {
      expect(cellIdFromTriangle(triangleIndex, cellIds)).toBe(target.formattedId);
    }
  });

  it('resolves distinct correct IDs when multiple chunks are active simultaneously', () => {
    const renderer = new ChunkRenderer();
    const patch = createGlobalPatch(2);
    const [first, second] = patch.cells;
    if (first === undefined || second === undefined) throw new Error('missing cells');

    renderer.update([
      { key: 'unit-a', level: 0, cells: [first] },
      { key: 'unit-b', level: 0, cells: [second] },
    ]);

    const meshA = renderer.meshes.find((mesh) => mesh.name === 'unit-a');
    const meshB = renderer.meshes.find((mesh) => mesh.name === 'unit-b');
    if (meshA === undefined || meshB === undefined) throw new Error('missing meshes');

    const idsA = meshA.userData.cellIds as readonly string[];
    const idsB = meshB.userData.cellIds as readonly string[];
    expect(cellIdFromTriangle(0, idsA)).toBe(first.formattedId);
    expect(cellIdFromTriangle(0, idsB)).toBe(second.formattedId);
    expect(cellIdFromTriangle(0, idsA)).not.toBe(cellIdFromTriangle(0, idsB));
  });

  it('active cell IDs stay resolvable after a chunk is replaced by finer children', () => {
    const renderer = new ChunkRenderer();
    const globalPatch = createGlobalPatch(2);
    const parent = globalPatch.cells[0];
    if (parent === undefined) throw new Error('missing parent');
    const parentCenters = globalPatch.cells.map((cell) => cell.cell.center);

    renderer.update([{ key: parent.formattedId, level: 0, cells: [parent] }]);
    expect(renderer.activeCellIds.has(parent.formattedId)).toBe(true);

    const chunk = createChunkForParent('regional', 1, parent, parentCenters, 4);
    renderer.update([{ key: chunk.formattedId, level: 1, cells: chunk.cells }]);

    expect(renderer.activeCellIds.has(parent.formattedId)).toBe(false);
    for (const cell of chunk.cells) expect(renderer.activeCellIds.has(cell.formattedId)).toBe(true);
  });
});
