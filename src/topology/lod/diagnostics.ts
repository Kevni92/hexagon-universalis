import type { Vector3 } from '@/topology/geodesic';
import type { VisibleUnit } from './WorldLod';
import { cameraFocusDirection, type CameraState } from './selection';

export interface LodFocusDiagnostics {
  readonly focusDirection: Vector3;
  readonly regionalParentIds: readonly number[];
  readonly localParentIds: readonly string[];
  readonly finestUnitKeys: readonly string[];
  readonly finestCellCount: number;
  readonly finestCentroid: Vector3 | null;
  readonly finestAngularDistance: number | null;
}

/**
 * Kompakte, serialisierbare Diagnose der räumlichen LOD-Auswahl. Sie verbindet
 * den zentralen Kamerastrahl mit den aktiven Parent-Chunks und dem Schwerpunkt
 * der feinsten sichtbaren Zellen, ohne Rendering- oder Three.js-Abhängigkeit.
 */
export function createLodFocusDiagnostics(
  camera: CameraState,
  units: readonly VisibleUnit[],
): LodFocusDiagnostics {
  const focusDirection = cameraFocusDirection(camera);
  const regionalParentIds = new Set<number>();
  const localParentIds = new Set<string>();

  for (const unit of units) {
    if (unit.level === 1) {
      for (const cell of unit.cells) {
        if (cell.parentIndex !== null) regionalParentIds.add(cell.parentIndex);
      }
      continue;
    }
    if (unit.level !== 2) continue;
    const match = /\/g(\d+)\/p(\d+)$/.exec(unit.key);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    regionalParentIds.add(Number.parseInt(match[1], 10));
    localParentIds.add(`${match[1]}:${match[2]}`);
  }

  const finestLevel = units.reduce<0 | 1 | 2>(
    (maximum, unit) => (unit.level > maximum ? unit.level : maximum),
    0,
  );
  const finestUnits = units.filter((unit) => unit.level === finestLevel);
  const finestCells = finestUnits.flatMap((unit) => unit.cells);
  const finestCentroid = normalizedCentroid(finestCells.map((cell) => cell.cell.center));

  return {
    focusDirection,
    regionalParentIds: [...regionalParentIds].sort((left, right) => left - right),
    localParentIds: [...localParentIds].sort(),
    finestUnitKeys: finestUnits.map((unit) => unit.key).sort(),
    finestCellCount: finestCells.length,
    finestCentroid,
    finestAngularDistance:
      finestCentroid === null ? null : Math.acos(clamp(dot(finestCentroid, focusDirection), -1, 1)),
  };
}

function normalizedCentroid(vectors: readonly Vector3[]): Vector3 | null {
  if (vectors.length === 0) return null;
  const sum = vectors.reduce<Vector3>(
    (total, vector) => ({
      x: total.x + vector.x,
      y: total.y + vector.y,
      z: total.z + vector.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const length = Math.hypot(sum.x, sum.y, sum.z);
  if (!Number.isFinite(length) || length <= 0) return null;
  return { x: sum.x / length, y: sum.y / length, z: sum.z / length };
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
