export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedPointer {
  readonly x: number;
  readonly y: number;
}

export interface CellPickingCallbacks {
  readonly onHoverChange?: (cellId: string | null) => void;
  readonly onSelectionChange?: (cellId: string | null) => void;
}

export function normalizePointer(
  point: PointerPoint,
  bounds: { left: number; top: number; width: number; height: number },
): NormalizedPointer {
  if (bounds.width <= 0 || bounds.height <= 0)
    throw new RangeError('Canvasabmessungen müssen positiv sein.');
  return {
    x: ((point.x - bounds.left) / bounds.width) * 2 - 1,
    y: -((point.y - bounds.top) / bounds.height) * 2 + 1,
  };
}

export function cellIdFromTriangle(
  triangleIndex: number,
  cellIds: readonly string[],
): string | null {
  if (!Number.isInteger(triangleIndex) || triangleIndex < 0) return null;
  return cellIds[triangleIndex] ?? null;
}

export class CellPickingState {
  public hoveredCellId: string | null = null;
  public selectedCellId: string | null = null;

  private readonly clickThresholdSquared: number;
  private pointerDown: PointerPoint | null = null;
  private dragging = false;
  private disposed = false;

  public constructor(
    private readonly callbacks: CellPickingCallbacks = {},
    clickThreshold = 6,
  ) {
    if (!Number.isFinite(clickThreshold) || clickThreshold < 0)
      throw new RangeError('Klickschwelle muss nichtnegativ und endlich sein.');
    this.clickThresholdSquared = clickThreshold * clickThreshold;
  }

  public handlePointerDown(point: PointerPoint): void {
    if (this.disposed) return;
    this.pointerDown = point;
    this.dragging = false;
  }

  public handlePointerMove(point: PointerPoint): boolean {
    if (this.disposed || this.pointerDown === null) return false;
    const dx = point.x - this.pointerDown.x;
    const dy = point.y - this.pointerDown.y;
    if (dx * dx + dy * dy > this.clickThresholdSquared) this.dragging = true;
    return this.dragging;
  }

  public handlePointerUp(cellId: string | null): boolean {
    if (this.disposed) return false;
    const isClick = this.pointerDown !== null && !this.dragging;
    this.pointerDown = null;
    this.dragging = false;
    if (isClick) this.select(cellId);
    return isClick;
  }

  public cancelPointer(): void {
    this.pointerDown = null;
    this.dragging = false;
  }

  public setHover(cellId: string | null): void {
    if (this.disposed || this.hoveredCellId === cellId) return;
    this.hoveredCellId = cellId;
    this.callbacks.onHoverChange?.(cellId);
  }

  public invalidateSelection(validCellIds: ReadonlySet<string>): void {
    if (this.selectedCellId !== null && !validCellIds.has(this.selectedCellId)) this.select(null);
  }

  public dispose(): void {
    this.disposed = true;
    this.pointerDown = null;
    this.hoveredCellId = null;
    this.selectedCellId = null;
  }

  private select(cellId: string | null): void {
    if (this.selectedCellId === cellId) return;
    this.selectedCellId = cellId;
    this.callbacks.onSelectionChange?.(cellId);
  }
}
