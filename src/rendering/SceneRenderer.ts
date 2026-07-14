import * as THREE from 'three';

import { GlobeControls } from '@/input/GlobeControls';
import { createGeodesicTopology } from '@/topology/geodesic';

import { createCellGlobeMesh } from './CellGlobe';

const MAX_PIXEL_RATIO = 2;
const CAMERA = { fov: 45, near: 0.1, far: 100, z: 3.4 } as const;

export interface RendererErrorTarget {
  show(message: string): void;
}

export class SceneRenderer {
  public readonly scene = new THREE.Scene();
  public readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  public readonly world = new THREE.Group();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: GlobeControls;
  private readonly cellGlobe: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver | null;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private disposed = false;

  public constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07111f);
    this.camera.position.set(0, 0, CAMERA.z);
    this.scene.add(this.createHemisphereLight(), this.createKeyLight(), this.world);

    this.cellGlobe = createCellGlobeMesh(createGeodesicTopology());
    this.world.add(this.cellGlobe);
    this.controls = new GlobeControls(this.world, this.camera, this.renderer.domElement);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeObserver = null;
      window.addEventListener('resize', this.resize);
    }
    this.resize();
  }

  public start(): void {
    if (this.disposed || this.animationFrameId !== null) return;

    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    if (this.resizeObserver === null) window.removeEventListener('resize', this.resize);

    this.world.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly createHemisphereLight = (): THREE.HemisphereLight =>
    new THREE.HemisphereLight(0xbfdcff, 0x142033, 2.4);

  private readonly createKeyLight = (): THREE.DirectionalLight => {
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(3, 2, 4);
    return light;
  };

  private readonly renderFrame = (time: number): void => {
    if (this.disposed) return;
    const deltaSeconds = Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;
    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private readonly resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}
