import * as THREE from 'three';

import { GlobeControls } from '@/input/GlobeControls';
import { createGeodesicTopology } from '@/topology/geodesic';
import { createTileShowcaseWorld, tileShowcaseCellColors } from '@/data/tileShowcase';
import { WorldLodController } from '@/topology/lod/WorldLod';
import { DESKTOP_QUALITY_PROFILE, type QualityProfile } from '@/topology/lod/profiles';
import { EarthChunkRuntime, type EarthRuntimeStatus } from '@/data/EarthChunkRuntime';
import { EarthWorldModel } from '@/data/EarthWorldModel';
import { ProceduralWorldLod, type ProceduralWorldLodLevel } from '@/world/proceduralWorldLod';

import { createCellGlobeMesh } from './CellGlobe';
import { ChunkRenderer } from './ChunkRenderer';
import { computeLocalCameraState } from './CameraFrame';

const MAX_PIXEL_RATIO = 2;
const CAMERA = { fov: 45, near: 0.1, far: 100, z: 3.4 } as const;
const SHOWCASE_TOPOLOGY_FREQUENCY = 2;
const PROCEDURAL_MIN_CAMERA_DISTANCE = 1.18;

export type WorldMode = 'earth' | 'demo' | 'lod' | 'procedural';

export interface RendererErrorTarget {
  show(message: string): void;
}

export class SceneRenderer {
  public readonly scene = new THREE.Scene();
  public readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  public readonly world = new THREE.Group();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: GlobeControls;
  private readonly cellGlobe: THREE.Mesh | null;
  private readonly chunkRenderer: ChunkRenderer | null;
  private readonly worldLod: WorldLodController | null;
  private readonly proceduralWorldLod: ProceduralWorldLod | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly earthRuntime: EarthChunkRuntime | null;
  private readonly earthModel = new EarthWorldModel();
  private visibleUnits: readonly import('@/topology/lod/WorldLod').VisibleUnit[] = [];
  private requestedDataKey = '';
  public readonly ready: Promise<void>;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private disposed = false;

  public constructor(
    private readonly container: HTMLElement,
    worldMode: WorldMode = 'earth',
    lodQualityProfile: QualityProfile = DESKTOP_QUALITY_PROFILE,
    onEarthStatus?: (status: EarthRuntimeStatus) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07111f);
    this.camera.position.set(0, 0, CAMERA.z);
    this.scene.add(this.createHemisphereLight(), this.createKeyLight(), this.world);

    if (worldMode === 'procedural') {
      this.cellGlobe = null;
      this.worldLod = null;
      this.proceduralWorldLod = new ProceduralWorldLod();
      this.chunkRenderer = new ChunkRenderer(1, this.proceduralWorldLod.cellColors);
      this.world.add(this.chunkRenderer.group);
      this.earthRuntime = null;
    } else if (worldMode === 'lod' || worldMode === 'earth') {
      this.cellGlobe = null;
      this.worldLod = new WorldLodController(lodQualityProfile);
      this.proceduralWorldLod = null;
      this.chunkRenderer = new ChunkRenderer();
      this.world.add(this.chunkRenderer.group);
      this.earthRuntime = worldMode === 'earth' ? new EarthChunkRuntime() : null;
    } else {
      this.worldLod = null;
      this.proceduralWorldLod = null;
      this.chunkRenderer = null;
      this.cellGlobe =
        worldMode === 'demo'
          ? this.createShowcaseGlobe()
          : createCellGlobeMesh(createGeodesicTopology());
      this.world.add(this.cellGlobe);
      this.earthRuntime = null;
    }
    this.controls = new GlobeControls(
      this.world,
      this.camera,
      this.renderer.domElement,
      worldMode === 'procedural' ? { minDistance: PROCEDURAL_MIN_CAMERA_DISTANCE } : {},
    );

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeObserver = null;
      window.addEventListener('resize', this.resize);
    }
    this.resize();
    if ((this.worldLod !== null || this.proceduralWorldLod !== null) && this.chunkRenderer !== null)
      this.updateLod();
    if (this.earthRuntime !== null) {
      if (onEarthStatus !== undefined) this.earthRuntime.subscribe(onEarthStatus);
      this.ready = this.initializeEarth().catch(() => undefined);
    } else this.ready = Promise.resolve();
  }

  /** Anzahl aktiver Draw Calls (Chunks) im LOD-Modus; 0 in den übrigen Modi. */
  public get activeChunkCount(): number {
    return this.chunkRenderer?.activeChunkCount ?? 0;
  }

  /** Gesamtzahl aktuell materialisierter Zellen im LOD-Modus. */
  public get activeCellCount(): number {
    return this.chunkRenderer?.activeCellCount ?? 0;
  }

  public get activeResolutionLevel(): ProceduralWorldLodLevel | null {
    if (this.proceduralWorldLod === null || this.visibleUnits.length === 0) return null;
    const depth = Math.max(...this.visibleUnits.map((unit) => unit.level));
    return (['global', 'regional', 'local'] as const)[depth] ?? null;
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

    // ChunkRenderer verwaltet seine Meshes selbst (differenzieller Cache); explizit disposen,
    // bevor der generische world.traverse-Sweep unten läuft, damit keine Listener/Caches übrig bleiben.
    this.chunkRenderer?.dispose();
    this.proceduralWorldLod?.dispose();
    this.earthRuntime?.dispose();

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

  private readonly createShowcaseGlobe = (): THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  > => {
    const topology = createGeodesicTopology(SHOWCASE_TOPOLOGY_FREQUENCY);
    const showcase = createTileShowcaseWorld(topology);
    return createCellGlobeMesh(topology, topology.radius, tileShowcaseCellColors(showcase));
  };

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
    if ((this.worldLod !== null || this.proceduralWorldLod !== null) && this.chunkRenderer !== null)
      this.updateLod();
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

  /**
   * Berechnet die aktuell sichtbare Chunk-Liste und aktualisiert den
   * `ChunkRenderer` differenziell. Kamera und Sichtkegel werden in das
   * lokale (unrotierte) Koordinatensystem der Welt transformiert, da
   * `GlobeControls` die Kamera fix hält und stattdessen `this.world` rotiert
   * (siehe `GlobeControls.applyRotation`).
   */
  private updateLod(): void {
    if ((this.worldLod === null && this.proceduralWorldLod === null) || this.chunkRenderer === null)
      return;
    const cameraState = computeLocalCameraState({
      worldQuaternion: this.world.quaternion,
      cameraPosition: this.camera.position,
      cameraQuaternion: this.camera.quaternion,
      fovDegrees: this.camera.fov,
      aspect: this.camera.aspect,
      viewportHeight: this.container.clientHeight || 1,
      sphereRadius: 1,
    });

    this.visibleUnits =
      this.proceduralWorldLod?.update(cameraState) ?? this.worldLod?.update(cameraState) ?? [];
    this.chunkRenderer.update(this.visibleUnits);
    const canvas = this.renderer.domElement;
    if (this.proceduralWorldLod !== null)
      canvas.dataset.lodLevel = this.activeResolutionLevel ?? 'global';
    canvas.dataset.cameraDistance = Math.hypot(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    ).toFixed(2);
    this.requestVisibleEarthData();
  }

  private async initializeEarth(): Promise<void> {
    if (this.earthRuntime === null || this.chunkRenderer === null) return;
    const bootstrap = await this.earthRuntime.loadBootstrap();
    if (this.disposed) return;
    this.earthModel.applyChunk(bootstrap);
    this.chunkRenderer.setCellColors(this.earthModel.cellColors(), this.visibleUnits);
    this.requestVisibleEarthData();
  }

  private requestVisibleEarthData(): void {
    const manifest = this.earthRuntime?.manifest;
    if (manifest === null || manifest === undefined || this.chunkRenderer === null) return;
    const requested = new Set<string>();
    for (const unit of this.visibleUnits) {
      if (unit.level === 0) continue;
      const parentIndices = new Set(
        unit.cells
          .map((cell) => cell.id.parentIndex)
          .filter((index): index is number => index !== null),
      );
      for (const entry of manifest.chunks) {
        if (unit.level === 1 && entry.level === 'regional') {
          if ([...parentIndices].some((index) => entry.chunkId.endsWith(`__c${index}`)))
            requested.add(entry.chunkId);
        }
        // Das veroeffentlichte v1-Schema qualifiziert lokale Eltern noch nicht vollstaendig
        // (#67). Bis zur Schemamigration werden alle eindeutigen c<index>-Treffer geladen.
        if (unit.level === 2 && entry.level === 'local') {
          if ([...parentIndices].some((index) => entry.chunkId.endsWith(`__c${index}`)))
            requested.add(entry.chunkId);
        }
      }
    }
    const ids = [...requested].sort();
    const key = ids.join('|');
    if (key === this.requestedDataKey) return;
    this.requestedDataKey = key;
    void this.earthRuntime
      ?.requireChunks(ids)
      .then((chunks) => {
        if (this.disposed || chunks.length === 0 || this.chunkRenderer === null) return;
        for (const chunk of chunks) this.earthModel.applyChunk(chunk);
        this.chunkRenderer.setCellColors(this.earthModel.cellColors(), this.visibleUnits);
      })
      .catch(() => undefined);
  }
}
