// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/rendering/SceneRenderer', () => {
  class SceneRenderer {
    public static instances: { worldMode: string }[] = [];
    public static proceduralConfigs: unknown[] = [];
    public proceduralState: Record<string, unknown> | null;
    public constructor(
      _container: HTMLElement,
      worldMode: 'earth' | 'demo' | 'lod' | 'procedural' = 'earth',
      _quality?: unknown,
      _onEarthStatus?: unknown,
      proceduralOptions?: {
        config?: Record<string, unknown>;
        onStateChange?: (state: unknown) => void;
      },
    ) {
      SceneRenderer.instances.push({ worldMode });
      this.proceduralState =
        worldMode === 'procedural'
          ? {
              config: {
                seed: String(proceduralOptions?.config?.seed ?? 'hexagon-universalis'),
                density: proceduralOptions?.config?.density ?? 'standard',
                landFraction: 0.38,
                continentScale: 1.35,
                elevationVariation: 0.32,
                climateScale: 2.4,
                mountainStrength: 0.42,
              },
              fingerprint: 'pw1-12345678',
              lodLevel: 'global',
              frequency: 8,
              cellCount: 642,
            }
          : null;
      if (worldMode === 'procedural')
        SceneRenderer.proceduralConfigs.push(proceduralOptions?.config);
    }
    public start = vi.fn();
    public dispose = vi.fn();
    public regenerateProceduralWorld = vi.fn(async () => this.proceduralState);
  }
  return { SceneRenderer };
});

import { createApp, resolveProceduralWorldConfig, resolveWorldMode } from '@/app/createApp';
import { SceneRenderer } from '@/rendering/SceneRenderer';

describe('resolveWorldMode', () => {
  it('defaults to earth when no world parameter is present', () => {
    expect(resolveWorldMode('')).toBe('earth');
    expect(resolveWorldMode('?foo=bar')).toBe('earth');
  });

  it('activates the demo world only for the exact demo value', () => {
    expect(resolveWorldMode('?world=demo')).toBe('demo');
    expect(resolveWorldMode('?world=procedural')).toBe('procedural');
    expect(resolveWorldMode('?world=other')).toBe('earth');
  });

  it('starts the explicitly labeled procedural test world', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (root === null) throw new Error('missing root');

    (SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances = [];
    createApp(root, '?world=procedural');

    expect(root.querySelector('#status')?.textContent).toBe(
      'Prozedurale Testwelt – keine reale Erde',
    );
    expect(root.querySelector('[data-testid="procedural-controls"]')).not.toBeNull();
    expect((SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances).toEqual([
      { worldMode: 'procedural' },
    ]);
  });

  it('liest ausschließlich gültige Seed- und Dichtewerte aus der URL', () => {
    expect(resolveProceduralWorldConfig('?world=procedural&seed=%20atlas%20&density=high')).toEqual(
      {
        seed: 'atlas',
        density: 'high',
      },
    );
    expect(resolveProceduralWorldConfig('?seed=&density=unsupported')).toEqual({
      seed: 'hexagon-universalis',
      density: 'standard',
    });
  });
});

describe('createApp', () => {
  it('starts the real earth by default and shows the earth status', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (root === null) throw new Error('missing root');

    (SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances = [];
    createApp(root, '');

    const status = root.querySelector('#status');
    expect(status?.textContent).toBe('Versionierte Erddaten werden geladen ...');
    expect((SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances).toEqual([
      { worldMode: 'earth' },
    ]);
    expect(root.querySelector('[data-testid="procedural-controls"]')).toBeNull();
  });

  it('starts the showcase world and shows the demo status when requested', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.querySelector<HTMLElement>('#app');
    if (root === null) throw new Error('missing root');

    (SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances = [];
    createApp(root, '?world=demo');

    const status = root.querySelector('#status');
    expect(status?.textContent).toBe('Tile-Demo – keine reale Erde');
    expect((SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances).toEqual([
      { worldMode: 'demo' },
    ]);
  });
});
