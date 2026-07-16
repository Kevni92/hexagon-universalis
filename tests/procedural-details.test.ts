import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  createProceduralDetailPlan,
  ProceduralDetailRenderer,
} from '@/rendering/ProceduralDetails';
import { detailTypeBudgets, type DetailType } from '@/rendering/TileDetails';
import { createGlobalPatch } from '@/topology/lod/hierarchy';
import { visibleCellId, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { ProceduralLodCell } from '@/world/proceduralWorldLod';

function unit(level: 0 | 1 | 2, count = 24): VisibleUnit {
  return {
    key: `test-level-${level}`,
    level,
    cells: createGlobalPatch(4).cells.slice(0, count),
  };
}

function lookupFor(
  unitValue: VisibleUnit,
  tileType: ProceduralLodCell['tileType'] = 'temperateMixedForest',
  modifiers: ProceduralLodCell['modifiers'] = [],
  surface: ProceduralLodCell['surface'] = 'land',
): (cellId: string) => ProceduralLodCell | undefined {
  const values = new Map(
    unitValue.cells.map((_cell, index) => {
      const cellId = visibleCellId(unitValue, index);
      return [
        cellId,
        {
          cellId,
          sourceCellId: `source-${index}`,
          level: unitValue.level === 2 ? 'local' : unitValue.level === 1 ? 'regional' : 'global',
          elevation: surface === 'land' ? 0.32 : -0.4,
          surface,
          isCoast: false,
          temperature: 0.5,
          moisture: 0.65,
          tileType,
          modifiers,
          relief: surface === 'land' ? 'hills' : 'oceanFloor',
        } satisfies ProceduralLodCell,
      ] as const;
    }),
  );
  return (cellId) => values.get(cellId);
}

describe('prozedurale Detaildarstellung', () => {
  it('rendert global keine Einzelobjekte und erhöht die Basisdichte im lokalen LOD', () => {
    const global = unit(0);
    const regional = unit(1);
    const local = unit(2);

    expect(createProceduralDetailPlan([global], lookupFor(global))).toHaveLength(0);
    const regionalPlan = createProceduralDetailPlan([regional], lookupFor(regional));
    const localPlan = createProceduralDetailPlan([local], lookupFor(local));

    expect(regionalPlan).toHaveLength(0);
    expect(localPlan.length).toBeGreaterThan(0);
    expect(localPlan.every((detail) => detail.level === 'local')).toBe(true);
  });

  it('bleibt für dieselben Zellen deterministisch und hält die Detailtypbudgets ein', () => {
    const local = unit(2, 162);
    const lookup = lookupFor(local);
    const first = createProceduralDetailPlan([local], lookup);
    const second = createProceduralDetailPlan([local], lookup);
    const budgets = detailTypeBudgets();

    expect(first).toEqual(second);
    for (const detailType of Object.keys(budgets) as DetailType[]) {
      expect(first.filter((detail) => detail.detailType === detailType).length).toBeLessThanOrEqual(
        budgets[detailType],
      );
    }
  });

  it('erzeugt keine Details auf Wasser, Gletschern oder ausgeschlossenen Hochgebirgsflächen', () => {
    const local = unit(2);

    expect(
      createProceduralDetailPlan([local], lookupFor(local, 'ocean', [], 'water')),
    ).toHaveLength(0);
    expect(
      createProceduralDetailPlan([local], lookupFor(local, 'tundra', ['glacier'])),
    ).toHaveLength(0);
    expect(
      createProceduralDetailPlan(
        [local],
        lookupFor(local, 'temperateMixedForest', ['highMountains']),
      ),
    ).toHaveLength(0);
  });

  it('bündelt Instanzen nach Detailtyp, blockiert Picking und gibt Ressourcen frei', () => {
    const local = unit(2);
    const renderer = new ProceduralDetailRenderer();

    renderer.update([local], lookupFor(local), 'test-fingerprint');

    expect(renderer.activeInstanceCount).toBeGreaterThan(0);
    expect(renderer.activeDrawCallCount).toBe(1);
    const mesh = renderer.group.children[0] as THREE.InstancedMesh;
    const intersections: THREE.Intersection[] = [];
    mesh.raycast({} as THREE.Raycaster, intersections);
    expect(intersections).toHaveLength(0);

    renderer.dispose();
    expect(renderer.activeInstanceCount).toBe(0);
    expect(renderer.activeDrawCallCount).toBe(0);
    expect(renderer.group.children).toHaveLength(0);
  });

  it('blendet denselben lokalen Detailzustand aus und ohne Neubau wieder ein', () => {
    const local = unit(2);
    const global = unit(0);
    const renderer = new ProceduralDetailRenderer();
    const lookup = lookupFor(local);

    renderer.update([local], lookup, 'stable-world');
    const mesh = renderer.group.children[0];
    const localInstances = renderer.activeInstanceCount;
    renderer.update([global], lookup, 'stable-world');
    expect(renderer.activeInstanceCount).toBe(0);
    expect(renderer.activeDrawCallCount).toBe(0);
    expect(renderer.cacheStats).toMatchObject({ cachedStates: 1, detailBuilds: 1 });

    renderer.update([local], lookup, 'stable-world');
    expect(renderer.group.children[0]).toBe(mesh);
    expect(renderer.activeInstanceCount).toBe(localInstances);
    expect(renderer.cacheStats).toMatchObject({ detailBuilds: 1, detailDisposals: 0 });

    renderer.update([global], lookup, 'changed-world');
    expect(renderer.cacheStats.cachedStates).toBe(0);
    expect(renderer.cacheStats.detailDisposals).toBeGreaterThan(0);
  });
});
