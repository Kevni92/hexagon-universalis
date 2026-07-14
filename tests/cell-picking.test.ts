import { describe, expect, it, vi } from 'vitest';

import { CellPickingState, cellIdFromTriangle, normalizePointer } from '@/input/CellPicking';

describe('cell picking state', () => {
  it('normalizes canvas coordinates and triangle mappings', () => {
    expect(
      normalizePointer({ x: 150, y: 100 }, { left: 50, top: 50, width: 200, height: 100 }),
    ).toEqual({ x: 0, y: 0 });
    expect(cellIdFromTriangle(1, ['cell-a', 'cell-b'])).toBe('cell-b');
    expect(cellIdFromTriangle(-1, ['cell-a'])).toBeNull();
    expect(cellIdFromTriangle(5, ['cell-a'])).toBeNull();
  });

  it('separates click from drag and retains selection during hover changes', () => {
    const hover = vi.fn();
    const selection = vi.fn();
    const state = new CellPickingState({ onHoverChange: hover, onSelectionChange: selection });
    state.handlePointerDown({ x: 10, y: 10 });
    state.handlePointerMove({ x: 12, y: 12 });
    expect(state.handlePointerUp('cell-a')).toBe(true);
    state.setHover('cell-b');
    expect(state.selectedCellId).toBe('cell-a');
    expect(hover).toHaveBeenCalledWith('cell-b');
    state.handlePointerDown({ x: 10, y: 10 });
    expect(state.handlePointerMove({ x: 30, y: 10 })).toBe(true);
    expect(state.handlePointerUp('cell-c')).toBe(false);
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it('cancels pointers, invalidates stale selection and disposes cleanly', () => {
    const selection = vi.fn();
    const state = new CellPickingState({ onSelectionChange: selection });
    state.handlePointerDown({ x: 0, y: 0 });
    state.cancelPointer();
    expect(state.handlePointerUp('cell-a')).toBe(false);
    state.handlePointerDown({ x: 0, y: 0 });
    state.handlePointerUp('cell-a');
    state.invalidateSelection(new Set(['cell-b']));
    expect(state.selectedCellId).toBeNull();
    state.dispose();
    state.setHover('cell-c');
    expect(selection).toHaveBeenCalledTimes(2);
  });
});
