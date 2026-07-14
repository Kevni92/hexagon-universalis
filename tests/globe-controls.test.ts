import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { GlobeControls, normalizeWheelDelta } from '@/input/GlobeControls';

interface TestEvent {
  pointerId?: number;
  pointerType?: string;
  button?: number;
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  deltaMode?: number;
  preventDefault?: () => void;
}

class FakeElement {
  public readonly style = {} as CSSStyleDeclaration;
  private readonly listeners = new Map<string, EventListener[]>();

  public addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    );
  }

  public dispatch(type: string, event: TestEvent): void {
    this.listeners
      .get(type)
      ?.forEach((listener) => listener({ ...event, type } as unknown as Event));
  }

  public listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

function createControls(options?: ConstructorParameters<typeof GlobeControls>[3]): {
  camera: THREE.PerspectiveCamera;
  element: FakeElement;
  controls: GlobeControls;
  world: THREE.Group;
} {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const element = new FakeElement();
  const world = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.4);
  const controls = new GlobeControls(world, camera, element as unknown as HTMLElement, options);
  return { camera, controls, element, world };
}

describe('GlobeControls', () => {
  it('rotates rightward drag in a stable, bounded pitch range', () => {
    const { controls, element, world } = createControls({ inertia: false });

    element.dispatch('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 0 });
    expect(world.rotation.y).toBeGreaterThan(0);

    element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: -10_000 });
    expect(Math.abs(world.rotation.x)).toBeLessThan(Math.PI / 2);
    controls.dispose();
  });

  it('clamps wheel and pinch zoom to both distance limits', () => {
    const { camera, controls, element } = createControls();
    const preventDefault = vi.fn();

    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault });
    expect(camera.position.z).toBe(2.2);
    element.dispatch('wheel', { deltaY: 1_000_000, deltaMode: 0, preventDefault });
    expect(camera.position.z).toBe(8);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 })).toBe(32);
    controls.dispose();
  });

  it('handles pinch distance and pointer cancellation without stuck input', () => {
    const { controls, element, world } = createControls({ inertia: false });

    element.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    element.dispatch('pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 0,
      clientY: 100,
    });
    element.dispatch('pointermove', { pointerId: 2, clientX: 0, clientY: 200 });
    expect(world.rotation.y).toBe(0);
    element.dispatch('pointercancel', { pointerId: 1 });
    const before = world.quaternion.clone();
    element.dispatch('pointermove', { pointerId: 2, clientX: 100, clientY: 200 });
    expect(world.quaternion.angleTo(before)).toBe(0);

    controls.dispose();
    expect(element.listenerCount('pointerdown')).toBe(0);
    expect(element.listenerCount('wheel')).toBe(0);
  });

  it('applies time-based inertia with decreasing velocity', () => {
    const { controls, element, world } = createControls({ damping: 8 });

    element.dispatch('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    element.dispatch('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
    element.dispatch('pointerup', { pointerId: 1 });
    const first = world.rotation.y;
    controls.update(0.016);
    const second = world.rotation.y;
    controls.update(0.016);
    const third = world.rotation.y;

    expect(second - first).toBeGreaterThan(third - second);
    controls.dispose();
  });
});
