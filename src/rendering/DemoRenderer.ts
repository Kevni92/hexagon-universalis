import * as THREE from 'three';

const MAX_PIXEL_RATIO = 2;

export class DemoRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly geometry = new THREE.IcosahedronGeometry(1, 2);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x4f8cff,
    flatShading: true,
    roughness: 0.72,
    metalness: 0.08,
  });
  private readonly testBody = new THREE.Mesh(this.geometry, this.material);
  private readonly resizeObserver: ResizeObserver;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  public constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x07111f);
    this.camera.position.set(0, 0, 3.4);

    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x142033, 2.4));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 2, 4);
    this.scene.add(keyLight, this.testBody);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  public start(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.resizeObserver.disconnect();
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly renderFrame = (time: number): void => {
    const deltaSeconds = Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;

    this.testBody.rotation.y += deltaSeconds * 0.28;
    this.testBody.rotation.x += deltaSeconds * 0.08;
    this.renderer.render(this.scene, this.camera);

    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
