import type { Vector3 } from '@/topology/geodesic';
import {
  createChunkForParent,
  createGlobalPatch,
  type LodCell,
  type LodChunk,
  type LodPatch,
} from './hierarchy';
import type { QualityProfile } from './profiles';
import {
  cameraFocusDirection,
  isCellVisible,
  projectedCellSizePx,
  RefinementController,
  selectFocusedCandidateKeys,
  type CameraState,
  type FocusSelectionCandidate,
} from './selection';

/**
 * Ein materialisierbares Element der sichtbaren Welt: entweder eine einzelne
 * Level-0-Zelle (immer resident, nicht gechunkt) oder ein Level-1/2-Chunk.
 * Der Renderer konsumiert ausschließlich Listen dieses Typs – nie eine
 * einzelne Welt-Topologie – und baut daraus Geometrie pro Chunk.
 */
export interface VisibleUnit {
  readonly key: string;
  readonly level: 0 | 1 | 2;
  readonly cells: readonly LodCell[];
  /** Optional voll qualifizierte IDs, wenn die lokale Elternkette mehr als einen Index umfasst. */
  readonly cellIds?: readonly string[];
}

export function visibleCellId(unit: VisibleUnit, index: number): string {
  return unit.cellIds?.[index] ?? unit.cells[index]?.formattedId ?? '';
}

interface RefinementEntry extends FocusSelectionCandidate {
  readonly cell: LodCell;
  readonly sizePx: number;
}

const LOD_REFERENCE_VIEWPORT_HEIGHT = 720;

/**
 * Orchestriert Multi-Level-Auswahl: hält das immer resident gehaltene
 * Level-0-Patch, entscheidet je Level-0-Zelle per Hysterese, ob sie durch
 * ihre Level-1-Kinder ersetzt wird, und rekursiv je Level-1-Zelle, ob sie
 * durch Level-2-Kinder ersetzt wird. Erzeugt/verwirft Kind-Chunks
 * differenziell und cached bereits erzeugte Chunks, damit wiederholtes
 * Zoomen keine wiederholte Neuberechnung erzwingt.
 */
export class WorldLodController {
  private readonly globalPatch: LodPatch;
  private readonly regionalController: RefinementController;
  private readonly localController: RefinementController;
  private readonly regionalChunkCache = new Map<number, LodChunk>();
  private readonly localChunkCache = new Map<string, LodChunk>();
  private regionalFocusSelection = new Set<number>();
  private localFocusSelection = new Set<number>();

  public constructor(private readonly profile: QualityProfile) {
    this.globalPatch = createGlobalPatch(profile.levels.global.frequency);
    this.regionalController = new RefinementController(profile.levels.regional);
    this.localController = new RefinementController(profile.levels.local);
  }

  public get globalCells(): readonly LodCell[] {
    return this.globalPatch.cells;
  }

  /**
   * Berechnet die aktuell sichtbare, stabile Liste von Materialisierungs-
   * einheiten für die gegebene Kamera. Deterministisch für dieselbe Kamera
   * und denselben internen Hysterese-Zustand.
   *
   * Ablauf je Ebene: (1) sichtbare Elternzellen sammeln, (2) Hysterese je
   * Elternzelle auswerten, (3) unter allen verfeinerungswilligen Eltern die
   * dem zentralen Kamerastrahl nächsten bis zum `maxActiveChunks`-Budget
   * auswählen und nur diese durch ihre Kind-Chunks ersetzen. Nicht
   * verfeinerte Level-0-Zellen werden zu **einer** gebündelten Unit (ein
   * Mesh/Material), nie eine Unit pro Zelle (ADR: "kein Mesh und kein
   * Material pro Zelle").
   */
  public update(camera: CameraState): readonly VisibleUnit[] {
    const units: VisibleUnit[] = [];
    const focusDirection = cameraFocusDirection(camera);
    const globalParentCenters = this.globalPatch.cells.map((lodCell) => lodCell.cell.center);

    // Ebene 0: sichtbare globale Zellen + Hysterese; Budget-Auswahl der zu verfeinernden Eltern.
    const visibleGlobal: RefinementEntry[] = this.globalPatch.cells
      .filter((globalCell) => isCellVisible(globalCell.cell.center, camera))
      .map((globalCell) => {
        const angularRadius = estimateAngularRadius(globalCell);
        const sizePx = projectedCellSizePx(
          globalCell.cell.center,
          angularRadius * camera.sphereRadius,
          camera,
        );
        return {
          cell: globalCell,
          key: globalCell.id.index,
          sizePx,
          projectedSizePx: sizePx,
          angularRadius,
          focusAlignment: clampDot(globalCell.cell.center, focusDirection),
        };
      });

    const refinedGlobal = this.selectRefinedParents(
      visibleGlobal,
      this.regionalController,
      this.profile.levels.regional.maxActiveChunks,
      this.regionalFocusSelection,
    );

    const activeRegionalParents = new Set<number>();
    const activeLocalParents = new Set<string>();
    const activeLocalHashes = new Set<number>();
    const coarseGlobalCells: LodCell[] = [];
    let remainingLocalChunkBudget = this.profile.levels.local.maxActiveChunks;

    for (const entry of visibleGlobal) {
      const globalCell = entry.cell;
      if (!refinedGlobal.has(globalCell.id.index)) {
        coarseGlobalCells.push(globalCell);
        continue;
      }

      const regionalChunk = this.getOrCreateRegionalChunk(globalCell, globalParentCenters);
      if (regionalChunk.cells.length === 0) {
        // Keine Kind-Zellen zugeordnet (defensiv): unverfeinert lassen.
        coarseGlobalCells.push(globalCell);
        continue;
      }
      activeRegionalParents.add(globalCell.id.index);

      remainingLocalChunkBudget -= this.appendRegionalUnits(
        globalCell,
        regionalChunk,
        camera,
        focusDirection,
        units,
        activeLocalParents,
        activeLocalHashes,
        remainingLocalChunkBudget,
      );
    }

    // Alle nicht verfeinerten Level-0-Zellen werden zu genau EINER Unit gebündelt.
    if (coarseGlobalCells.length > 0)
      units.push({ key: 'lvl0-global/root', level: 0, cells: coarseGlobalCells });

    this.regionalFocusSelection = new Set(activeRegionalParents);
    this.localFocusSelection = new Set(activeLocalHashes);
    this.regionalController.prune(activeRegionalParents);
    this.localController.prune(activeLocalHashes);
    this.pruneRegionalCache(activeRegionalParents);
    this.pruneLocalCache(activeLocalParents);

    return units;
  }

  /**
   * Verarbeitet ein verfeinertes Regional-Patch: entscheidet je Regional-Zelle
   * per Hysterese + Budget, ob sie durch ihr Level-2-Kind-Chunk ersetzt wird.
   * Nicht ersetzte Regional-Zellen werden zu einer einzigen gebündelten
   * Level-1-Unit zusammengefasst.
   */
  private appendRegionalUnits(
    globalCell: LodCell,
    regionalChunk: LodChunk,
    camera: CameraState,
    focusDirection: Vector3,
    units: VisibleUnit[],
    activeLocalParents: Set<string>,
    activeLocalHashes: Set<number>,
    remainingLocalChunkBudget: number,
  ): number {
    const regionalParentCenters = regionalChunk.cells.map((lodCell) => lodCell.cell.center);

    const visibleRegional: RefinementEntry[] = regionalChunk.cells
      .filter((regionalCell) => isCellVisible(regionalCell.cell.center, camera))
      .map((regionalCell) => {
        const key = hashParentKey(globalCell.id.index, regionalCell.id.index);
        const angularRadius = estimateAngularRadius(regionalCell);
        const sizePx = projectedCellSizePx(
          regionalCell.cell.center,
          angularRadius * camera.sphereRadius,
          camera,
        );
        return {
          cell: regionalCell,
          key,
          sizePx,
          projectedSizePx: sizePx,
          angularRadius,
          focusAlignment: clampDot(regionalCell.cell.center, focusDirection),
        };
      });

    const refinedRegional = this.selectRefinedParents(
      visibleRegional,
      this.localController,
      remainingLocalChunkBudget,
      this.localFocusSelection,
    );

    // Nicht sichtbare Regional-Zellen bleiben Teil des gebündelten Level-1-Rests
    // (kein Loch beim Ebenenwechsel), verbrauchen aber kein local-Budget.
    const coarseRegionalCells: LodCell[] = regionalChunk.cells.filter(
      (regionalCell) => !isCellVisible(regionalCell.cell.center, camera),
    );
    let activeLocalChunkCount = 0;

    for (const entry of visibleRegional) {
      const regionalCell = entry.cell;
      const localKey = `${globalCell.id.index}:${regionalCell.id.index}`;
      const localHash = entry.key;

      if (!refinedRegional.has(localHash)) {
        coarseRegionalCells.push(regionalCell);
        continue;
      }

      const localChunk = this.getOrCreateLocalChunk(regionalCell, regionalParentCenters, localKey);
      if (localChunk.cells.length === 0) {
        coarseRegionalCells.push(regionalCell);
        continue;
      }
      activeLocalParents.add(localKey);
      activeLocalHashes.add(localHash);
      activeLocalChunkCount += 1;
      const qualifiedPrefix = `lvl2-local/g${globalCell.id.index}/p${regionalCell.id.index}`;
      units.push({
        key: qualifiedPrefix,
        level: 2,
        cells: localChunk.cells,
        cellIds: localChunk.cells.map((cell) => `${qualifiedPrefix}/c${cell.id.index}`),
      });
    }

    if (coarseRegionalCells.length === regionalChunk.cells.length) {
      // Kein einziges Level-2-Kind aktiv: gesamten Regional-Chunk als eine Unit rendern.
      units.push({ key: regionalChunk.formattedId, level: 1, cells: regionalChunk.cells });
    } else if (coarseRegionalCells.length > 0) {
      units.push({
        key: `${regionalChunk.formattedId}/rest`,
        level: 1,
        cells: coarseRegionalCells,
      });
    }

    return activeLocalChunkCount;
  }

  /**
   * Wendet Pixelhysterese je Elternzelle an und begrenzt die tatsächlich
   * verfeinerten Eltern auf `maxActiveChunks`. Die Budgetauswahl folgt dem
   * zentralen Kamerafokus; bereits aktive Kandidaten erhalten zusätzlich eine
   * kleine räumliche Hysterese gegen Flackern an Zellgrenzen.
   */
  private selectRefinedParents(
    candidates: readonly RefinementEntry[],
    controller: RefinementController,
    maxActiveChunks: number,
    previousSelection: ReadonlySet<number>,
  ): ReadonlySet<number> {
    const wantsRefinement = candidates.filter(
      (entry) => controller.update(entry.key, entry.sizePx) === 'refined',
    );
    return selectFocusedCandidateKeys(wantsRefinement, previousSelection, maxActiveChunks);
  }

  /** Setzt den kompletten Hysterese- und Chunk-Cache-Zustand zurück (z. B. bei Profilwechsel). */
  public reset(): void {
    this.regionalController.reset();
    this.localController.reset();
    this.regionalChunkCache.clear();
    this.localChunkCache.clear();
    this.regionalFocusSelection.clear();
    this.localFocusSelection.clear();
  }

  private getOrCreateRegionalChunk(
    globalCell: LodCell,
    globalParentCenters: readonly Vector3[],
  ): LodChunk {
    const cached = this.regionalChunkCache.get(globalCell.id.index);
    if (cached !== undefined) return cached;
    const chunk = createChunkForParent(
      'regional',
      1,
      globalCell,
      globalParentCenters,
      this.profile.levels.regional.frequency,
    );
    this.regionalChunkCache.set(globalCell.id.index, chunk);
    return chunk;
  }

  private getOrCreateLocalChunk(
    regionalCell: LodCell,
    regionalParentCenters: readonly Vector3[],
    localKey: string,
  ): LodChunk {
    const cached = this.localChunkCache.get(localKey);
    if (cached !== undefined) return cached;
    const chunk = createChunkForParent(
      'local',
      2,
      regionalCell,
      regionalParentCenters,
      this.profile.levels.local.frequency,
    );
    this.localChunkCache.set(localKey, chunk);
    return chunk;
  }

  private pruneRegionalCache(activeParentIndices: ReadonlySet<number>): void {
    for (const key of this.regionalChunkCache.keys())
      if (!activeParentIndices.has(key)) this.regionalChunkCache.delete(key);
  }

  private pruneLocalCache(activeKeys: ReadonlySet<string>): void {
    for (const key of this.localChunkCache.keys())
      if (!activeKeys.has(key)) this.localChunkCache.delete(key);
  }
}

/**
 * Schaltet die prozedurale Testwelt viewportweit zwischen vollständigen
 * Topologien um. Pro Frame existiert genau eine Zellgröße; eine sichtbare
 * Grenze zwischen einem feinen Fokus-Chunk und groben Eltern ist unmöglich.
 * Die Topologien entstehen lazy und bleiben bei Rotation als stabiles Mesh
 * erhalten.
 */
export class UniformViewportWorldLodController {
  private readonly globalPatch: LodPatch;
  private regionalPatch: LodPatch | null = null;
  private localPatch: LodPatch | null = null;
  private readonly regionalController: RefinementController;
  private readonly localController: RefinementController;

  public constructor(private readonly profile: QualityProfile) {
    this.globalPatch = createGlobalPatch(profile.levels.global.frequency);
    this.regionalController = new RefinementController(profile.levels.regional);
    this.localController = new RefinementController(profile.levels.local);
  }

  public update(camera: CameraState): readonly VisibleUnit[] {
    const globalSize = maximumProjectedCellSize(this.globalPatch.cells, camera);
    const regional = this.regionalController.update(0, globalSize) === 'refined';
    if (!regional) {
      this.localController.reset();
      this.regionalPatch = null;
      this.localPatch = null;
      return [this.visibleUnit(0, this.globalPatch.cells)];
    }

    const regionalPatch = this.patchFor(1);
    const regionalSize = maximumProjectedCellSize(regionalPatch.cells, camera);
    const local = this.localController.update(0, regionalSize) === 'refined';
    if (!local) {
      this.localPatch = null;
      return [this.visibleUnit(1, regionalPatch.cells)];
    }

    return [this.visibleUnit(2, this.patchFor(2).cells)];
  }

  private visibleUnit(depth: 0 | 1 | 2, cells: readonly LodCell[]): VisibleUnit {
    const name = (['global', 'regional', 'local'] as const)[depth];
    const prefix = `lvl${depth}-${name}/${depth === 0 ? 'root' : 'visible'}`;
    return {
      key: prefix,
      level: depth,
      cells,
      cellIds: cells.map((cell) => `${prefix}/c${cell.id.index}`),
    };
  }

  public reset(): void {
    this.regionalController.reset();
    this.localController.reset();
    this.regionalPatch = null;
    this.localPatch = null;
  }

  private patchFor(depth: 0 | 1 | 2): LodPatch {
    if (depth === 0) return this.globalPatch;
    if (depth === 1) {
      this.regionalPatch ??= createGlobalPatch(this.profile.levels.regional.frequency);
      return this.regionalPatch;
    }
    this.localPatch ??= createGlobalPatch(this.profile.levels.local.frequency);
    return this.localPatch;
  }
}

function maximumProjectedCellSize(cells: readonly LodCell[], camera: CameraState): number {
  let maximum = 0;
  const viewportScale =
    camera.viewportHeight > 0 ? LOD_REFERENCE_VIEWPORT_HEIGHT / camera.viewportHeight : 1;
  for (const cell of cells) {
    if (!isCellVisible(cell.cell.center, camera)) continue;
    maximum = Math.max(
      maximum,
      projectedCellSizePx(
        cell.cell.center,
        estimateWorldRadius(cell, camera.sphereRadius),
        camera,
      ) * viewportScale,
    );
  }
  return maximum;
}

function estimateAngularRadius(lodCell: LodCell): number {
  const { center, boundary } = lodCell.cell;
  if (boundary.length === 0) return 0;
  const angles = boundary.map((point) => Math.acos(clampDot(center, point)));
  return angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
}

function estimateWorldRadius(lodCell: LodCell, sphereRadius: number): number {
  return estimateAngularRadius(lodCell) * sphereRadius;
}

function clampDot(first: Vector3, second: Vector3): number {
  const value = first.x * second.x + first.y * second.y + first.z * second.z;
  return Math.min(1, Math.max(-1, value));
}

function hashParentKey(globalIndex: number, regionalIndex: number): number {
  // Eindeutiger Integer-Schlüssel für das (global, regional)-Paar innerhalb
  // des lokalen RefinementController; Cantor-Pairing für Kollisionsfreiheit.
  return ((globalIndex + regionalIndex) * (globalIndex + regionalIndex + 1)) / 2 + regionalIndex;
}
