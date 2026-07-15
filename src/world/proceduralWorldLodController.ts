import { WorldLodController, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { QualityProfile } from '@/topology/lod/profiles';
import type { CameraState } from '@/topology/lod/selection';

/**
 * Verwendet die hierarchische Eltern-Kind-Ersetzung des normalen Welt-LOD,
 * hält aber außerhalb verfeinerter Eltern die vollständige Globalstufe als
 * geschlossene Rückfallkugel resident. Dadurch existiert je Raumregion nur
 * eine sichtbare Zellauflösung, ohne Löcher am Horizont.
 */
export class ProceduralWorldLodController {
  private readonly controller: WorldLodController;

  public constructor(profile: QualityProfile) {
    this.controller = new WorldLodController(profile);
  }

  public update(camera: CameraState): readonly VisibleUnit[] {
    const selected = this.controller.update(camera);
    const refinedGlobalParents = globalParentIndices(selected);
    const globalCells = this.controller.globalCells.filter(
      (cell) => !refinedGlobalParents.has(cell.id.index),
    );
    const refinedUnits = selected.filter((unit) => unit.level > 0);
    if (globalCells.length === 0) return refinedUnits;
    return [
      ...refinedUnits,
      {
        key: 'lvl0-global/root',
        level: 0,
        cells: globalCells,
      },
    ];
  }

  public reset(): void {
    this.controller.reset();
  }
}

function globalParentIndices(units: readonly VisibleUnit[]): ReadonlySet<number> {
  const indices = new Set<number>();
  for (const unit of units) {
    if (unit.level === 1) {
      for (const cell of unit.cells) {
        if (cell.parentIndex !== null) indices.add(cell.parentIndex);
      }
      continue;
    }
    if (unit.level !== 2) continue;
    const match = /\/g(\d+)\//.exec(unit.key);
    if (match?.[1] !== undefined) indices.add(Number.parseInt(match[1], 10));
  }
  return indices;
}
