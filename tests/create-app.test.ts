// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/rendering/SceneRenderer', () => {
  class SceneRenderer {
    public static instances: { worldMode: string }[] = [];
    public constructor(_container: HTMLElement, worldMode: 'earth' | 'demo' = 'earth') {
      SceneRenderer.instances.push({ worldMode });
    }
    public start = vi.fn();
    public dispose = vi.fn();
  }
  return { SceneRenderer };
});

import { createApp, resolveWorldMode } from '@/app/createApp';
import { SceneRenderer } from '@/rendering/SceneRenderer';

describe('resolveWorldMode', () => {
  it('defaults to earth when no world parameter is present', () => {
    expect(resolveWorldMode('')).toBe('earth');
    expect(resolveWorldMode('?foo=bar')).toBe('earth');
  });

  it('activates the demo world only for the exact demo value', () => {
    expect(resolveWorldMode('?world=demo')).toBe('demo');
    expect(resolveWorldMode('?world=other')).toBe('earth');
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
    expect(status?.textContent).toBe('Three.js-Testszene bereit');
    expect((SceneRenderer as unknown as { instances: { worldMode: string }[] }).instances).toEqual([
      { worldMode: 'earth' },
    ]);
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
