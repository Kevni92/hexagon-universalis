import type { Vector3 } from '@/topology/geodesic';
import type { LodCell } from './hierarchy';
import type { LevelQualityConfig } from './profiles';

/** Minimale Kameraparameter, die für Culling und die LOD-Größenmetrik nötig sind. */
export interface CameraState {
  /** Kameraposition in Weltkoordinaten (gleicher Raum wie Zellzentren, Kugelradius 1). */
  readonly position: Vector3;
  /** Blickrichtung (normalisiert), von der Kamera weg. */
  readonly forward: Vector3;
  /** Vertikales Sichtfeld in Radiant. */
  readonly fovY: number;
  /** Viewport-Höhe in Pixel. */
  readonly viewportHeight: number;
  /** Kugelradius der Welt (Weltkoordinaten). */
  readonly sphereRadius: number;
  /**
   * Seitenverhältnis Breite/Höhe des Viewports. Optional; wird für die
   * Sichtkegelprüfung genutzt, damit auf breiten Viewports Zellen am
   * linken/rechten Rand nicht fälschlich verworfen werden. Fehlt der Wert,
   * wird 1 (quadratisch) angenommen.
   */
  readonly aspect?: number;
}

/** Kandidat für eine budgetierte, fokuszentrierte Parent-Auswahl. */
export interface FocusSelectionCandidate {
  readonly key: number;
  /** Skalarprodukt von Zellzentrum und zentralem Fokuspunkt; größer liegt näher an der Bildmitte. */
  readonly focusAlignment: number;
  /** Mittlerer Winkelradius der Elternzelle auf der Einheitskugel. */
  readonly angularRadius: number;
  /** Projizierte Größe als deterministischer sekundärer Sortierschlüssel. */
  readonly projectedSizePx: number;
}

const DEFAULT_FOCUS_SWITCH_HYSTERESIS_FACTOR = 0.18;

/**
 * Bestimmt den vom zentralen Kamerastrahl getroffenen Punkt auf der Kugel und
 * liefert dessen normalisierte Richtung im selben lokalen Weltkoordinatensystem
 * wie die LOD-Zellzentren. Der Fokus ist dadurch unabhängig von der
 * Kameradistanz und bleibt beim reinen Zoomen räumlich stabil.
 */
export function cameraFocusDirection(camera: CameraState): Vector3 {
  const forward = normalizeOrNull(camera.forward);
  const cameraDirection = normalizeOrNull(camera.position);
  if (forward === null) return cameraDirection ?? { x: 0, y: 0, z: 1 };

  if (Number.isFinite(camera.sphereRadius) && camera.sphereRadius > 0) {
    const linear = 2 * dot(camera.position, forward);
    const constant = dot(camera.position, camera.position) - camera.sphereRadius ** 2;
    const discriminant = linear * linear - 4 * constant;
    if (discriminant >= 0) {
      const root = Math.sqrt(Math.max(0, discriminant));
      const near = (-linear - root) / 2;
      const far = (-linear + root) / 2;
      const distance = near >= 0 ? near : far >= 0 ? far : null;
      if (distance !== null) {
        const hit = normalizeOrNull(add(camera.position, scale(forward, distance)));
        if (hit !== null) return hit;
      }
    }
  }

  // Defensiver Fallback für einen Strahl, der die Kugel nicht trifft: der dem
  // Ursprung nächste Punkt des Vorwärtsstrahls bleibt ebenfalls zoomstabil.
  const closestDistance = Math.max(0, -dot(camera.position, forward));
  return (
    normalizeOrNull(add(camera.position, scale(forward, closestDistance))) ??
    cameraDirection ??
    scale(forward, -1)
  );
}

/**
 * Begrenzt verfeinerungswillige Eltern auf das Chunkbudget und priorisiert
 * räumlich die Bildmitte. Bereits aktive Eltern bleiben innerhalb eines kleinen,
 * aus ihrem Zellwinkel abgeleiteten Hysteresebands erhalten. Dadurch wechselt
 * die Auswahl erst klar hinter einer räumlichen Zellgrenze, statt an nahezu
 * gleich bewerteten Kandidaten zu flackern.
 */
export function selectFocusedCandidateKeys(
  candidates: readonly FocusSelectionCandidate[],
  previousSelection: ReadonlySet<number>,
  maxActiveChunks: number,
  hysteresisFactor = DEFAULT_FOCUS_SWITCH_HYSTERESIS_FACTOR,
): ReadonlySet<number> {
  const limit = Math.max(0, Math.min(Math.trunc(maxActiveChunks), candidates.length));
  if (limit === 0) return new Set();

  const ordered = [...candidates].sort(compareFocusCandidates);
  const cutoff = ordered[limit - 1];
  if (cutoff === undefined) return new Set();
  const cutoffAngle = Math.acos(clamp(cutoff.focusAlignment, -1, 1));
  const factor = Number.isFinite(hysteresisFactor) ? Math.max(0, hysteresisFactor) : 0;
  const selected = new Set<number>();

  for (const candidate of ordered) {
    if (!previousSelection.has(candidate.key)) continue;
    const candidateAngle = Math.acos(clamp(candidate.focusAlignment, -1, 1));
    const margin = Math.max(candidate.angularRadius, cutoff.angularRadius) * factor;
    if (candidateAngle <= cutoffAngle + margin) selected.add(candidate.key);
    if (selected.size >= limit) return selected;
  }

  for (const candidate of ordered) {
    selected.add(candidate.key);
    if (selected.size >= limit) break;
  }
  return selected;
}

/**
 * Horizont-/Rückseiten-Culling: eine Zelle auf der von der Kamera
 * abgewandten Seite der Kugel ist nicht sichtbar. Reine 3D-Vektor-Prüfung
 * (kein Lat/Lon), funktioniert unabhängig von Datumsgrenze und Polen.
 *
 * Geometrische Herleitung: Für eine Kugel mit Radius `r`, deren Mittelpunkt
 * im Ursprung liegt, und eine Kamera im Abstand `d` vom Mittelpunkt ist ein
 * Oberflächenpunkt mit Zentrumsvektor `c` (normalisiert) genau dann von der
 * Kamera aus sichtbar (nicht durch die Kugel selbst verdeckt), wenn der
 * Winkel zwischen `c` und der Kamerarichtung `d̂ = position/|position|`
 * kleiner als `acos(r/d)` ist (Tangentialwinkel des Sichthorizonts).
 */
export function isFrontFacing(cellCenter: Vector3, camera: CameraState): boolean {
  const distance = length(camera.position);
  if (distance <= camera.sphereRadius) return true; // Kamera innerhalb/auf der Kugel: keine Verdeckung annehmen.
  const cameraDirection = scale(camera.position, 1 / distance);
  const horizonAngle = Math.acos(clamp(camera.sphereRadius / distance, -1, 1));
  const angle = Math.acos(clamp(dot(cellCenter, cameraDirection), -1, 1));
  return angle < horizonAngle;
}

/**
 * Grobe Sichtkegelprüfung: ist das Zentrum der Zelle innerhalb des
 * (leicht aufgeweiteten) Sichtfeldkegels der Kamera? Nutzt den Winkel
 * zwischen Blickrichtung und dem Vektor Kamera→Zelle.
 *
 * Der Kegel wird gegen die **größere** von vertikalem und horizontalem
 * halben FOV geprüft. Auf breiten Viewports (aspect > 1) ist das horizontale
 * FOV größer als `fovY`; würde nur `fovY/2` verwendet, würden Zellen am
 * linken/rechten Rand fälschlich verworfen. Ein Kegel gegen das größere
 * Halb-FOV ist konservativ (verwirft nie eine tatsächlich sichtbare Zelle),
 * auch wenn er in den Bildschirmecken minimal zu großzügig ist.
 */
export function isInFrustum(
  cellCenter: Vector3,
  camera: CameraState,
  fovSlackFactor = 1.15,
): boolean {
  const toCell = subtract(cellCenter, camera.position);
  const toCellDistance = length(toCell);
  if (toCellDistance === 0) return true;
  const toCellDirection = scale(toCell, 1 / toCellDistance);
  const cosAngle = clamp(dot(toCellDirection, camera.forward), -1, 1);
  const angle = Math.acos(cosAngle);
  const halfFovY = camera.fovY / 2;
  const aspect = camera.aspect !== undefined && camera.aspect > 0 ? camera.aspect : 1;
  // Horizontales halbes FOV aus dem vertikalen und dem Seitenverhältnis.
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const halfFov = Math.max(halfFovY, halfFovX) * fovSlackFactor;
  return angle <= halfFov;
}

/** Kombiniert Sichtkegel- und Horizont-Culling für eine einzelne Zelle. */
export function isCellVisible(cellCenter: Vector3, camera: CameraState): boolean {
  return isFrontFacing(cellCenter, camera) && isInFrustum(cellCenter, camera);
}

/**
 * Projizierte Zellgröße in Pixeln: Weltradius der Zelle, projiziert über den
 * Kameraabstand und die Viewport-Höhe/FOV (Standard-Lochkamera-Projektion,
 * `pixelSize = worldSize / distance * (viewportHeight / (2 * tan(fovY/2)))`).
 * Distanz wird über den direkten euklidischen Abstand Kamera→Zellzentrum
 * gebildet (konservative Näherung, kein perspektivischer Tiefenversatz nötig
 * für die reine Auswahlentscheidung).
 */
export function projectedCellSizePx(
  cellCenter: Vector3,
  cellWorldRadius: number,
  camera: CameraState,
): number {
  const distance = length(subtract(cellCenter, camera.position));
  if (distance <= 0) return Infinity;
  const focalLengthPx = camera.viewportHeight / (2 * Math.tan(camera.fovY / 2));
  return (cellWorldRadius / distance) * focalLengthPx;
}

/** Hysterese-Zustand einer einzelnen Elternzelle (verfeinert oder nicht). */
export type RefinementState = 'coarse' | 'refined';

/**
 * Hysterese-Entscheidung, mirroring `LodController` aus `TileLod.ts`, aber
 * für den Ebenenwechsel zwischen Zellauflösungen (bewusst als eigener Typ
 * geführt, siehe ADR: `ResolutionLevelName` vs. `LodLevel`).
 */
export function nextRefinementState(
  current: RefinementState,
  projectedSizePx: number,
  config: LevelQualityConfig,
): RefinementState {
  if (current === 'coarse' && projectedSizePx > config.refineAbovePx) return 'refined';
  if (current === 'refined' && projectedSizePx < config.coarsenBelowPx) return 'coarse';
  return current;
}

/** Hält den Hysterese-Zustand pro Elternzellen-Index (innerhalb einer Ebene) persistent. */
export class RefinementController {
  private readonly states = new Map<number, RefinementState>();

  public constructor(private readonly config: LevelQualityConfig) {}

  public update(parentIndex: number, projectedSizePx: number): RefinementState {
    const current = this.states.get(parentIndex) ?? 'coarse';
    const next = nextRefinementState(current, projectedSizePx, this.config);
    this.states.set(parentIndex, next);
    return next;
  }

  public get(parentIndex: number): RefinementState {
    return this.states.get(parentIndex) ?? 'coarse';
  }

  /** Entfernt den Zustand für Elternzellen, die nicht mehr aktiv sind (verhindert unbegrenztes Wachstum). */
  public prune(activeParentIndices: ReadonlySet<number>): void {
    for (const key of this.states.keys())
      if (!activeParentIndices.has(key)) this.states.delete(key);
  }

  public reset(): void {
    this.states.clear();
  }
}

/**
 * Wählt aus einer Menge von Level-n-Zellen jene aus, die sichtbar sind
 * (Frustum + Horizont), begrenzt auf `maxActiveChunks` der größten
 * projizierten Zellen (nächstgelegene/größte zuerst), falls das Budget
 * überschritten wird.
 *
 * Hinweis: `WorldLodController.update` nutzt eine inline-Variante dieser
 * Auswahl-/Budget-Logik (`selectRefinedParents`), um die bereits pro Frame
 * berechneten projizierten Größen nicht doppelt zu berechnen und den
 * Hysterese-Zustand einzubeziehen. Diese eigenständige Funktion bleibt als
 * getestete, wiederverwendbare Grundlage für Auswahl-only-Fälle (z. B.
 * künftige Chunk-Vorabladung) erhalten.
 */
export function selectVisibleCells(
  cells: readonly LodCell[],
  camera: CameraState,
  config: LevelQualityConfig,
): readonly LodCell[] {
  const visible = cells
    .filter((lodCell) => isCellVisible(lodCell.cell.center, camera))
    .map((lodCell) => ({
      lodCell,
      sizePx: projectedCellSizePx(
        lodCell.cell.center,
        estimateWorldRadius(lodCell.cell.boundary, lodCell.cell.center, camera.sphereRadius),
        camera,
      ),
    }))
    .sort((left, right) => right.sizePx - left.sizePx);
  return visible.slice(0, config.maxActiveChunks).map((entry) => entry.lodCell);
}

function compareFocusCandidates(
  left: FocusSelectionCandidate,
  right: FocusSelectionCandidate,
): number {
  if (left.focusAlignment !== right.focusAlignment)
    return right.focusAlignment - left.focusAlignment;
  if (left.projectedSizePx !== right.projectedSizePx)
    return right.projectedSizePx - left.projectedSizePx;
  return left.key - right.key;
}

function estimateWorldRadius(
  boundary: readonly Vector3[],
  center: Vector3,
  sphereRadius: number,
): number {
  if (boundary.length === 0) return 0;
  const angles = boundary.map((point) => Math.acos(clamp(dot(center, point), -1, 1)));
  const meanAngle = angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
  return meanAngle * sphereRadius;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function add(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function normalizeOrNull(vector: Vector3): Vector3 | null {
  const vectorLength = length(vector);
  if (!Number.isFinite(vectorLength) || vectorLength <= 0) return null;
  return scale(vector, 1 / vectorLength);
}

function length(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}
