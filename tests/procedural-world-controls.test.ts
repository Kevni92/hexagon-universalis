// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { ProceduralWorldControls, type ProceduralWorldUiState } from '@/ui/ProceduralWorldControls';
import { DEFAULT_PROCEDURAL_WORLD_CONFIG } from '@/world/proceduralWorld';

function state(overrides: Partial<ProceduralWorldUiState> = {}): ProceduralWorldUiState {
  return {
    config: DEFAULT_PROCEDURAL_WORLD_CONFIG,
    fingerprint: 'pw1-12345678',
    lodLevel: 'global',
    frequency: 8,
    cellCount: 642,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('ProceduralWorldControls', () => {
  it('zeigt aktive Konfiguration, Zellzahl und benannte LOD-Stufen zugänglich an', () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const container = document.querySelector<HTMLElement>('#controls');
    if (container === null) throw new Error('missing controls');
    const controls = new ProceduralWorldControls(container, state(), vi.fn());

    expect(container.querySelector('input')?.value).toBe('hexagon-universalis');
    expect(container.querySelector('select')?.value).toBe('standard');
    expect(container.querySelector('[data-testid="procedural-lod"]')?.textContent).toBe('Global');
    expect(container.querySelector('[data-testid="procedural-frequency"]')?.textContent).toBe(
      'f=8',
    );
    expect(container.querySelector('[data-testid="procedural-cell-count"]')?.textContent).toBe(
      '642',
    );
    expect(
      [...container.querySelectorAll('option')].some(
        (option) => option.value === 'ultra' && option.textContent === 'Ultra (experimentell)',
      ),
    ).toBe(true);

    controls.update(state({ lodLevel: 'local' }));
    expect(container.querySelector('[data-testid="procedural-lod"]')?.textContent).toBe('Lokal');
  });

  it('normalisiert den Seed und übernimmt eine erfolgreiche Neugenerierung genau einmal', async () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const container = document.querySelector<HTMLElement>('#controls');
    if (container === null) throw new Error('missing controls');
    const next = state({
      config: { ...DEFAULT_PROCEDURAL_WORLD_CONFIG, seed: 'new-seed', density: 'high' },
      fingerprint: 'pw1-87654321',
      frequency: 16,
      cellCount: 2562,
    });
    const regenerate = vi.fn().mockResolvedValue(next);
    new ProceduralWorldControls(container, state(), regenerate);

    const seed = container.querySelector<HTMLInputElement>('input');
    const density = container.querySelector<HTMLSelectElement>('select');
    const form = container.querySelector<HTMLFormElement>('form');
    if (seed === null || density === null || form === null) throw new Error('missing form');
    seed.value = '  new-seed  ';
    density.value = 'high';
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(container.querySelector('button')?.disabled).toBe(true);
    await flushAsyncWork();

    expect(regenerate).toHaveBeenCalledOnce();
    expect(regenerate).toHaveBeenCalledWith({ seed: 'new-seed', density: 'high' });
    expect(container.querySelector('[data-testid="procedural-fingerprint"]')?.textContent).toBe(
      'pw1-87654321',
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Welt bereit');
  });

  it('fasst schnelle Submit-Ereignisse auf die neueste gültige Konfiguration zusammen', async () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const container = document.querySelector<HTMLElement>('#controls');
    if (container === null) throw new Error('missing controls');
    const regenerate = vi.fn().mockResolvedValue(state());
    new ProceduralWorldControls(container, state(), regenerate);
    const seed = container.querySelector<HTMLInputElement>('input');
    const form = container.querySelector<HTMLFormElement>('form');
    if (seed === null || form === null) throw new Error('missing form');

    seed.value = 'first';
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    seed.value = 'latest';
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();

    expect(regenerate).toHaveBeenCalledOnce();
    expect(regenerate).toHaveBeenCalledWith(expect.objectContaining({ seed: 'latest' }));
  });

  it('meldet ungültige Seeds und entfernt beim Dispose alle Listener', async () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const container = document.querySelector<HTMLElement>('#controls');
    if (container === null) throw new Error('missing controls');
    const regenerate = vi.fn().mockResolvedValue(state());
    const controls = new ProceduralWorldControls(container, state(), regenerate);
    const seed = container.querySelector<HTMLInputElement>('input');
    const form = container.querySelector<HTMLFormElement>('form');
    if (seed === null || form === null) throw new Error('missing form');

    seed.value = '   ';
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/1 und 128/);
    expect(regenerate).not.toHaveBeenCalled();

    controls.dispose();
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    expect(regenerate).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
  });
});
