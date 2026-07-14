import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', () => {
  class Quaternion {
    public x = 0;
    public y = 0;
    public z = 0;
    public w = 1;
    public clone(): Quaternion {
      const copy = new Quaternion();
      Object.assign(copy, this);
      return copy;
    }
    public invert(): this {
      return this;
    }
    public normalize(): this {
      return this;
    }
    public setFromEuler(): this {
      return this;
    }
    public setFromAxisAngle(): this {
      return this;
    }
    public multiplyQuaternions(): this {
      return this;
    }
  }

  class Vector3 {
    public constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
    public clone(): Vector3 {
      return new Vector3(this.x, this.y, this.z);
    }
    public applyQuaternion(): this {
      return this;
    }
    public normalize(): this {
      return this;
    }
    public set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }

  class Object3D {
    public children: Object3D[] = [];
    public rotation = { x: 0, y: 0 };
    public position = new Vector3();
    public quaternion = new Quaternion();
    public add(...objects: Object3D[]): void {
      this.children.push(...objects);
    }
    public traverse(callback: (object: Object3D) => void): void {
      callback(this);
      this.children.forEach((child) => child.traverse(callback));
    }
  }

  class Scene extends Object3D {
    public background: unknown;
  }

  class Group extends Object3D {
    public clear(): void {
      this.children = [];
    }
    public remove(...objects: Object3D[]): void {
      this.children = this.children.filter((child) => !objects.includes(child));
    }
  }

  class Mesh extends Object3D {
    public name = '';
    public userData: Record<string, unknown> = {};
    public constructor(
      public readonly geometry: { dispose: () => void },
      public readonly material: { dispose: () => void },
    ) {
      super();
    }
  }

  class PerspectiveCamera extends Object3D {
    public aspect: number;
    public fov: number;
    public constructor(...args: number[]) {
      super();
      this.fov = args[0] ?? 45;
      this.aspect = args[1] ?? 1;
    }
    public updateProjectionMatrix = vi.fn();
    public lookAt = vi.fn();
  }

  class WebGLRenderer {
    public readonly domElement = {
      addEventListener: vi.fn(),
      className: '',
      remove: vi.fn(),
      removeEventListener: vi.fn(),
      style: {},
    };
    public outputColorSpace = '';
    public constructor() {
      testState.rendererCount += 1;
    }
    public setPixelRatio = vi.fn((ratio: number) => {
      testState.pixelRatio = ratio;
    });
    public setSize = vi.fn((width: number, height: number) => {
      testState.size = [width, height];
    });
    public render = vi.fn();
    public dispose = vi.fn(() => {
      testState.rendererDisposed = true;
    });
  }

  class IcosahedronGeometry {
    public dispose = vi.fn(() => {
      testState.geometryDisposed = true;
    });
  }

  class BufferGeometry {
    public readonly attributes: Record<string, unknown> = {};
    public setAttribute = vi.fn((name: string, attribute: unknown) => {
      this.attributes[name] = attribute;
      return this;
    });
    public computeBoundingSphere = vi.fn();
    public dispose = vi.fn(() => {
      testState.geometryDisposed = true;
    });
  }

  class Float32BufferAttribute {
    public constructor(
      public readonly array: readonly number[],
      public readonly itemSize: number,
    ) {}
  }

  class Material {
    public dispose = vi.fn(() => {
      testState.materialDisposed = true;
    });
  }

  class HemisphereLight extends Object3D {}
  class DirectionalLight extends Object3D {}
  class Color {
    public constructor(...args: number[]) {
      void args;
    }
  }

  return {
    Color,
    BufferGeometry,
    DirectionalLight,
    Float32BufferAttribute,
    FrontSide: 0,
    Group,
    HemisphereLight,
    IcosahedronGeometry,
    MathUtils: {
      degToRad: (degrees: number) => (degrees * Math.PI) / 180,
      radToDeg: (radians: number) => (radians * 180) / Math.PI,
    },
    Mesh,
    MeshStandardMaterial: Material,
    PerspectiveCamera,
    Quaternion,
    Scene,
    SRGBColorSpace: 'srgb',
    Vector3,
    WebGLRenderer,
  };
});

const testState = {
  geometryDisposed: false,
  materialDisposed: false,
  observerDisconnected: false,
  observerObserved: false,
  pixelRatio: 0,
  rendererCount: 0,
  rendererDisposed: false,
  size: [0, 0] as [number, number],
};

describe('SceneRenderer', () => {
  beforeEach(() => {
    Object.assign(testState, {
      geometryDisposed: false,
      materialDisposed: false,
      observerDisconnected: false,
      observerObserved: false,
      pixelRatio: 0,
      rendererCount: 0,
      rendererDisposed: false,
      size: [0, 0],
    });

    vi.stubGlobal('window', {
      devicePixelRatio: 3,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(private readonly callback: () => void) {}
        public observe = vi.fn(() => {
          testState.observerObserved = true;
        });
        public disconnect = vi.fn(() => {
          testState.observerDisconnected = true;
        });
        public trigger = (): void => this.callback();
      },
    );
    vi.stubGlobal('performance', { now: vi.fn(() => 100) });
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('initializes one renderer and camera, and resizes to the container', async () => {
    const { SceneRenderer } = await import('@/rendering/SceneRenderer');
    const container = {
      clientWidth: 800,
      clientHeight: 600,
      append: vi.fn(),
    } as unknown as HTMLElement;
    const renderer = new SceneRenderer(container);

    expect(testState.rendererCount).toBe(1);
    expect(testState.observerObserved).toBe(true);
    expect(testState.pixelRatio).toBe(2);
    expect(testState.size).toEqual([800, 600]);
    expect(renderer.camera.aspect).toBeCloseTo(4 / 3);
  });

  it('starts only one loop and disposes all resources', async () => {
    const { SceneRenderer } = await import('@/rendering/SceneRenderer');
    const container = {
      clientWidth: 800,
      clientHeight: 600,
      append: vi.fn(),
    } as unknown as HTMLElement;
    const renderer = new SceneRenderer(container);

    renderer.start();
    renderer.start();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    renderer.dispose();
    renderer.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(testState.observerDisconnected).toBe(true);
    expect(testState.geometryDisposed).toBe(true);
    expect(testState.materialDisposed).toBe(true);
    expect(testState.rendererDisposed).toBe(true);
  });

  it('does not create invalid dimensions for a hidden container', async () => {
    const { SceneRenderer } = await import('@/rendering/SceneRenderer');
    const container = {
      clientWidth: 0,
      clientHeight: 0,
      append: vi.fn(),
    } as unknown as HTMLElement;
    const renderer = new SceneRenderer(container);

    expect(renderer.camera.aspect).toBe(1);
    expect(testState.size).toEqual([0, 0]);
  });

  it('renders the tile showcase world in demo mode without touching the earth globe', async () => {
    const { SceneRenderer } = await import('@/rendering/SceneRenderer');
    const container = {
      clientWidth: 800,
      clientHeight: 600,
      append: vi.fn(),
    } as unknown as HTMLElement;

    const renderer = new SceneRenderer(container, 'demo');

    expect(renderer.world.children).toHaveLength(1);
    const globe = renderer.world.children[0] as unknown as {
      userData: { cellIds: readonly string[] };
    };
    expect(globe.userData.cellIds.length).toBeGreaterThan(0);
  });

  it('renders the selective multi-LOD chunk pipeline in lod mode', async () => {
    const { SceneRenderer } = await import('@/rendering/SceneRenderer');
    const container = {
      clientWidth: 800,
      clientHeight: 600,
      append: vi.fn(),
    } as unknown as HTMLElement;

    const renderer = new SceneRenderer(container, 'lod');

    // Der Chunk-Renderer wird als eine Gruppe in world eingehängt, nicht
    // als ein einzelnes Voll-Welt-Mesh.
    expect(renderer.world.children).toHaveLength(1);
    expect(renderer.activeChunkCount).toBeGreaterThan(0);
    expect(renderer.activeCellCount).toBeGreaterThan(0);

    renderer.dispose();
    expect(renderer.activeChunkCount).toBe(0);
  });
});
