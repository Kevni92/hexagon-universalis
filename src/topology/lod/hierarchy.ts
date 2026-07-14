import {
  createGeodesicTopology,
  type GeodesicCell,
  type GeodesicTopology,
  type Vector3,
} from '@/topology/geodesic';
import {
  createCellId,
  createChunkId,
  formatCellId,
  formatChunkId,
  type CellId,
  type ChunkId,
  type LevelId,
  type ResolutionLevelName,
} from './identifiers';

/**
 * Eine Zelle einer hierarchischen Auflösungsstufe: kombiniert die reine
 * Geodäsie-Zelle (`GeodesicCell`) mit ihrer hierarchischen `CellId` und –
 * sofern nicht Level 0 – dem Index ihrer Elternzelle auf der nächsthöheren
 * Ebene. Nachbarschaften bleiben lokale Patch-Indizes (kompatibel zu
 * `GeodesicCell.neighborIds`), da Nachbarschaft nur innerhalb eines Patches
 * definiert ist.
 */
export interface LodCell {
  readonly id: CellId;
  readonly formattedId: string;
  readonly cell: GeodesicCell;
  readonly parentIndex: number | null;
}

/**
 * Eine vollständige, unabhängig generierte Patch-Topologie einer Ebene
 * (Level 0: die gesamte Kugel; Level 1/2: das Kind-Patch einer einzelnen
 * Elternzelle, bevor die Nicht-Kinder verworfen werden).
 */
export interface LodPatch {
  readonly level: LevelId;
  readonly parentIndex: number | null;
  readonly topology: GeodesicTopology;
  readonly cells: readonly LodCell[];
  readonly cellsById: ReadonlyMap<string, LodCell>;
}

/**
 * Ein Chunk: alle Zellen eines Kind-Patches, deren Zentrum per
 * Nächste-Zentren-Zuordnung tatsächlich der Elternzelle zugeordnet ist (siehe
 * ADR 0001, "Umgang mit Kind-Pentagonen"). Level 0 wird nicht gechunkt.
 */
export interface LodChunk {
  readonly id: ChunkId;
  readonly formattedId: string;
  readonly level: LevelId;
  readonly parentIndex: number;
  /** Zentrum der Elternzelle auf der nächsthöheren Ebene (für Culling/LOD). */
  readonly parentCenter: Vector3;
  /** Ungefährer Weltradius der Elternzelle (für die LOD-Größenmetrik). */
  readonly parentCellRadius: number;
  readonly cells: readonly LodCell[];
  readonly cellsById: ReadonlyMap<string, LodCell>;
}

/** Großkreisabstand (Radiant) zweier normalisierter 3D-Einheitsvektoren. */
export function greatCircleAngle(first: Vector3, second: Vector3): number {
  const clampedDot = Math.min(1, Math.max(-1, dot(first, second)));
  return Math.acos(clampedDot);
}

/**
 * Ordnet ein Kind-Zentrum der nächstgelegenen Elternzelle zu
 * (Großkreisabstand, reine 3D-Vektor-Operation gemäß ADR 0001 –
 * funktioniert unabhängig von Datumsgrenze und Polnähe).
 */
export function nearestParentIndex(
  childCenter: Vector3,
  parentCenters: readonly Vector3[],
): number {
  if (parentCenters.length === 0) throw new RangeError('parentCenters darf nicht leer sein.');
  let bestIndex = 0;
  let bestAngle = Infinity;
  parentCenters.forEach((parentCenter, index) => {
    const angle = greatCircleAngle(childCenter, parentCenter);
    if (angle < bestAngle) {
      bestAngle = angle;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** Erzeugt die vollständig materialisierte Level-0-Patch-Topologie ("global"). */
export function createGlobalPatch(frequency: number): LodPatch {
  const level: LevelId = { name: 'global', depth: 0 };
  const topology = createGeodesicTopology(frequency);
  const cells: LodCell[] = topology.cells.map((cell, index) => {
    const id = createCellId(level, index, null);
    return { id, formattedId: formatCellId(id), cell, parentIndex: null };
  });
  return { level, parentIndex: null, topology, cells, cellsById: mapById(cells) };
}

/**
 * Erzeugt das vollständige (noch nicht auf den Elternbereich beschränkte)
 * Kind-Patch für eine einzelne Elternzelle der nächstniedrigeren Ebene. Dies
 * ist eine eigenständige, vollständige Mini-Kugel-Topologie mit eigenen 12
 * Pentagonen (siehe ADR "Umgang mit Kind-Pentagonen").
 */
export function createChildPatch(
  levelName: ResolutionLevelName,
  depth: number,
  parentIndex: number,
  frequency: number,
): LodPatch {
  const level: LevelId = { name: levelName, depth };
  const topology = createGeodesicTopology(frequency);
  const cells: LodCell[] = topology.cells.map((cell, index) => {
    const id = createCellId(level, index, parentIndex);
    return { id, formattedId: formatCellId(id), cell, parentIndex };
  });
  return { level, parentIndex, topology, cells, cellsById: mapById(cells) };
}

/**
 * Materialisiert einen Chunk aus einem vollständigen Kind-Patch: Nur die
 * Zellen, deren Zentrum per Nächste-Zentren-Zuordnung tatsächlich der
 * gegebenen Elternzelle zugeordnet ist, werden übernommen; alle anderen
 * (einschließlich der meisten der 12 Patch-Pentagone) werden verworfen.
 */
export function materializeChunk(
  patch: LodPatch,
  parentCellIndex: number,
  parentCenters: readonly Vector3[],
  parentCenter: Vector3,
  parentCellRadius: number,
): LodChunk {
  if (patch.parentIndex === null || patch.level.depth === 0)
    throw new RangeError('Level 0 wird nicht gechunkt.');
  const assignedCells = patch.cells.filter(
    (lodCell) => nearestParentIndex(lodCell.cell.center, parentCenters) === parentCellIndex,
  );
  const id = createChunkId(patch.level, parentCellIndex);
  return {
    id,
    formattedId: formatChunkId(id),
    level: patch.level,
    parentIndex: parentCellIndex,
    parentCenter,
    parentCellRadius,
    cells: assignedCells,
    cellsById: mapById(assignedCells),
  };
}

/**
 * Bequemlichkeitsfunktion: erzeugt direkt den Chunk für eine gegebene
 * Elternzelle, ohne dass der Aufrufer das volle Patch separat verwalten muss.
 * Nützlich für selektives Laden (Phase 4/5): nur die tatsächlich sichtbaren
 * Elternzellen erzeugen ein Kind-Patch.
 */
export function createChunkForParent(
  levelName: ResolutionLevelName,
  depth: number,
  parentCell: LodCell,
  allParentCenters: readonly Vector3[],
  frequency: number,
): LodChunk {
  const patch = createChildPatch(levelName, depth, parentCell.id.index, frequency);
  const parentCellRadius = estimateCellRadius(parentCell.cell);
  return materializeChunk(
    patch,
    parentCell.id.index,
    allParentCenters,
    parentCell.cell.center,
    parentCellRadius,
  );
}

/** Schätzt den Weltradius (in Kugel-Einheiten) einer Zelle aus ihrer Grenze. */
export function estimateCellRadius(cell: GeodesicCell): number {
  if (cell.boundary.length === 0) return 0;
  const angles = cell.boundary.map((point) => greatCircleAngle(cell.center, point));
  return angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
}

function mapById(cells: readonly LodCell[]): ReadonlyMap<string, LodCell> {
  return new Map(cells.map((lodCell) => [lodCell.formattedId, lodCell]));
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
