import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  GlobeControls,
  normalizeWheelDelta,
  rotationScaleForDistance,
} from '@/input/GlobeControls';

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
  it('orbits the camera on drag while keeping the world north-up', () => {
    const { camera, controls, element, world } = createControls({ inertia: false });

    element.dispatch('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 0 });
    expect(camera.position.x).toBeLessThan(0);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);

    element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: -10_000 });
    const latitude = Math.asin(camera.position.y / camera.position.length());
    expect(Math.abs(latitude)).toBeLessThan(Math.PI / 2);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    controls.dispose();
  });

  it('clamps wheel and pinch zoom to both distance limits', () => {
    const { camera, controls, element } = createControls();
    const preventDefault = vi.fn();

    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault });
    expect(camera.position.length()).toBeCloseTo(2.2);
    element.dispatch('wheel', { deltaY: 1_000_000, deltaMode: 0, preventDefault });
    expect(camera.position.length()).toBeCloseTo(8);
    expect(camera.position.y).toBeCloseTo(0);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 })).toBe(32);
    controls.dispose();
  });

  it('supports a safe close-up distance for the procedural world', () => {
    const { camera, controls, element } = createControls({ minDistance: 1.18 });

    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault: vi.fn() });

    expect(camera.position.length()).toBeCloseTo(1.18);
    expect(camera.position.y).toBeGreaterThan(0);
    controls.dispose();
  });

  it('slows rotation with surface distance in procedural close-up views', () => {
    expect(rotationScaleForDistance(3.4)).toBe(1);
    expect(rotationScaleForDistance(2.2)).toBeCloseTo(0.5);
    expect(rotationScaleForDistance(1.18)).toBe(0.08);

    const { camera, controls, element, world } = createControls({
      inertia: false,
      minDistance: 1.18,
      zoomAdaptiveRotation: true,
    });
    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault: vi.fn() });
    expect(camera.position.length()).toBeCloseTo(1.18);
    element.dispatch('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 0 });

    expect(camera.position.x).toBeLessThan(0);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
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
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    element.dispatch('pointercancel', { pointerId: 1 });
    const before = world.quaternion.clone();
    element.dispatch('pointermove', { pointerId: 2, clientX: 100, clientY: 200 });
    expect(world.quaternion.angleTo(before)).toBe(0);

    controls.dispose();
    expect(element.listenerCount('pointerdown')).toBe(0);
    expect(element.listenerCount('wheel')).toBe(0);
  });

  it('applies time-based inertia with decreasing velocity', () => {
    const { camera, controls, element, world } = createControls({ damping: 8 });

    element.dispatch('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    element.dispatch('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
    element.dispatch('pointerup', { pointerId: 1 });
    const first = Math.atan2(camera.position.x, camera.position.z);
    controls.update(0.016);
    const second = Math.atan2(camera.position.x, camera.position.z);
    controls.update(0.016);
    const third = Math.atan2(camera.position.x, camera.position.z);

    expect(Math.abs(second - first)).toBeGreaterThan(Math.abs(third - second));
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    controls.dispose();
  });

  it('adds a smooth, bounded tilt only in the close-up zoom range', () => {
    const { camera, controls, element } = createControls({
      inertia: false,
      maxDistance: 4,
      nearTilt: 0.2,
      nearTiltStart: 0.5,
    });

    expect(camera.position.y).toBeCloseTo(0);
    element.dispatch('wheel', { deltaY: -500, deltaMode: 0, preventDefault: vi.fn() });
    const intermediateTilt = Math.asin(camera.position.y / camera.position.length());
    expect(intermediateTilt).toBeGreaterThan(0);
    expect(intermediateTilt).toBeLessThan(0.2);

    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault: vi.fn() });
    const closeTilt = Math.asin(camera.position.y / camera.position.length());
    expect(closeTilt).toBeCloseTo(0.2);
    controls.dispose();
  });

  it('keeps the northward close-up tilt stable across small zoom corrections', () => {
    const { camera, controls, element } = createControls({
      inertia: false,
      minDistance: 1.2,
      maxDistance: 3.4,
    });

    element.dispatch('wheel', { deltaY: -1_000_000, deltaMode: 0, preventDefault: vi.fn() });
    const closeTilt = Math.asin(camera.position.y / camera.position.length());
    element.dispatch('wheel', { deltaY: 20, deltaMode: 0, preventDefault: vi.fn() });
    const correctedTilt = Math.asin(camera.position.y / camera.position.length());

    expect(closeTilt).toBeCloseTo(THREE.MathUtils.degToRad(10));
    expect(correctedTilt).toBeCloseTo(closeTilt);
    expect(correctedTilt).toBeGreaterThan(0);
    controls.dispose();
  });
});
