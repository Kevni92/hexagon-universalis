import * as THREE from 'three';

import { GlobeControls } from '@/input/GlobeControls';
import { createGeodesicTopology } from '@/topology/geodesic';
import { createTileShowcaseWorld, tileShowcaseCellColors } from '@/data/tileShowcase';
import { createLodFocusDiagnostics } from '@/topology/lod/diagnostics';
import { WorldLodController } from '@/topology/lod/WorldLod';
import { DESKTOP_QUALITY_PROFILE, type QualityProfile } from '@/topology/lod/profiles';
import { EarthChunkRuntime, type EarthRuntimeStatus } from '@/data/EarthChunkRuntime';
import { EarthWorldModel } from '@/data/EarthWorldModel';
import { ProceduralWorldLod, type ProceduralWorldLodLevel } from '@/world/proceduralWorldLod';
import type { ProceduralWorldConfig } from '@/world/proceduralWorld';

import { createCellGlobeMesh } from './CellGlobe';
import { ChunkRenderer } from './ChunkRenderer';
import { computeLocalCameraState } from './CameraFrame';
import { ProceduralDetailRenderer } from './ProceduralDetails';
import { PROCEDURAL_CAMERA_RANGE } from './ProceduralCamera';
import {
  proceduralSurfaceRadius,
  proceduralTerrainDiagnostics,
  proceduralTileColor,
} from './ProceduralTerrain';

const MAX_PIXEL_RATIO = 2;
const CAMERA = { fov: 45, near: 0.1, far: 100, z: 3.4 } as const;
const SHOWCASE_TOPOLOGY_FREQUENCY = 2;
const PROCEDURAL_LEVELS = ['global', 'regional', 'local'] as const;

export type WorldMode = 'earth' | 'demo' | 'lod' | 'procedural';

export interface RendererErrorTarget {
  show(message: string): void;
}

export interface ProceduralRendererState {
  readonly config: ProceduralWorldConfig;
  readonly fingerprint: string;
  readonly lodLevel: ProceduralWorldLodLevel;
  readonly frequency: number;
  readonly cellCount: number;
}

export interface ProceduralRendererOptions {
  readonly config?: Partial<ProceduralWorldConfig>;
  readonly onStateChange?: (state: ProceduralRendererState) => void;
}

export interface ProceduralRuntimeStats {
  readonly lodUpdates: number;
  readonly cachedTopologies: number;
  readonly topologyBuilds: number;
  readonly cachedChunkMeshes: number;
  readonly geometryBuilds: number;
  readonly geometryDisposals: number;
  readonly cachedDetailStates: number;
  readonly detailBuilds: number;
  readonly detailDisposals: number;
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
  private readonly proceduralDetails: ProceduralDetailRenderer | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly earthRuntime: EarthChunkRuntime | null;
  private readonly earthModel = new EarthWorldModel();
  private visibleUnits: readonly import('@/topology/lod/WorldLod').VisibleUnit[] = [];
  private requestedDataKey = '';
  public readonly ready: Promise<void>;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private disposed = false;
  private proceduralRequestId = 0;
  private lastProceduralStateKey = '';
  private lastProceduralDiagnosticsFingerprint = '';
  private lastLodInputKey = '';
  private lodUpdateCount = 0;

  public constructor(
    private readonly container: HTMLElement,
    worldMode: WorldMode = 'earth',
    lodQualityProfile: QualityProfile = DESKTOP_QUALITY_PROFILE,
    onEarthStatus?: (status: EarthRuntimeStatus) => void,
    private readonly proceduralOptions: ProceduralRendererOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07111f);
    this.camera.position.set(0, 0, CAMERA.z);
    // Keep the key light in camera space. The camera orbits around the
    // north-stable globe, so a scene-fixed key light would appear to sweep
    // across the surface during every drag.
    this.camera.add(this.createKeyLight());
    this.scene.add(this.createHemisphereLight(), this.world, this.camera);

    if (worldMode === 'procedural') {
      this.cellGlobe = null;
      this.worldLod = null;
      const proceduralWorldLod = new ProceduralWorldLod(
        proceduralOptions.config,
        proceduralTileColor,
      );
      this.proceduralWorldLod = proceduralWorldLod;
      this.chunkRenderer = new ChunkRenderer(
        1,
        proceduralWorldLod.cellColors,
        (position, level, cellId) => {
          const elevation =
            proceduralWorldLod.projectedCell(cellId)?.elevation ??
            proceduralWorldLod.sampleAt(position).elevation;
          return proceduralSurfaceRadius(elevation, PROCEDURAL_LEVELS[level]);
        },
        3,
      );
      this.proceduralDetails = new ProceduralDetailRenderer();
      this.world.add(this.chunkRenderer.group, this.proceduralDetails.group);
      this.earthRuntime = null;
    } else if (worldMode === 'lod' || worldMode === 'earth') {
      this.cellGlobe = null;
      this.worldLod = new WorldLodController(lodQualityProfile);
      this.proceduralWorldLod = null;
      this.proceduralDetails = null;
      this.chunkRenderer = new ChunkRenderer();
      this.world.add(this.chunkRenderer.group);
      this.earthRuntime = worldMode === 'earth' ? new EarthChunkRuntime() : null;
    } else {
      this.worldLod = null;
      this.proceduralWorldLod = null;
      this.proceduralDetails = null;
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
      worldMode === 'procedural'
        ? {
            minDistance: PROCEDURAL_CAMERA_RANGE.minDistance,
            maxDistance: PROCEDURAL_CAMERA_RANGE.maxDistance,
            zoomAdaptiveRotation: true,
          }
        : {},
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

  /** Anzahl aktiver Draw Calls der gebündelten Zellflächen. */
  public get activeChunkCount(): number {
    return this.chunkRenderer?.activeChunkCount ?? 0;
  }

  /** Gesamtzahl aktuell materialisierter Zellen. */
  public get activeCellCount(): number {
    return this.chunkRenderer?.activeCellCount ?? 0;
  }

  public get activeDetailInstanceCount(): number {
    return this.proceduralDetails?.activeInstanceCount ?? 0;
  }

  public get activeDetailDrawCallCount(): number {
    return this.proceduralDetails?.activeDrawCallCount ?? 0;
  }

  public get activeResolutionLevel(): ProceduralWorldLodLevel | null {
    if (this.proceduralWorldLod === null || this.visibleUnits.length === 0) return null;
    const depth = Math.max(...this.visibleUnits.map((unit) => unit.level));
    return PROCEDURAL_LEVELS[depth] ?? null;
  }

  public get proceduralRuntimeStats(): ProceduralRuntimeStats | null {
    if (
      this.proceduralWorldLod === null ||
      this.chunkRenderer === null ||
      this.proceduralDetails === null
    )
      return null;
    const topology = this.proceduralWorldLod.cacheStats;
    const chunks = this.chunkRenderer.cacheStats;
    const details = this.proceduralDetails.cacheStats;
    return {
      lodUpdates: this.lodUpdateCount,
      cachedTopologies: topology.cachedTopologies,
      topologyBuilds: topology.topologyBuilds,
      cachedChunkMeshes: chunks.cachedMeshes,
      geometryBuilds: chunks.geometryBuilds,
      geometryDisposals: chunks.geometryDisposals,
      cachedDetailStates: details.cachedStates,
      detailBuilds: details.detailBuilds,
      detailDisposals: details.detailDisposals,
    };
  }

  public get proceduralState(): ProceduralRendererState | null {
    if (this.proceduralWorldLod === null) return null;
    const profile = this.proceduralWorldLod.profile;
    const lodLevel = this.activeResolutionLevel ?? 'global';
    return {
      config: this.proceduralWorldLod.config,
      fingerprint: this.proceduralWorldLod.fingerprint,
      lodLevel,
      frequency: profile.quality.levels[lodLevel].frequency,
      cellCount: profile.levelCellCounts[lodLevel],
    };
  }

  public async regenerateProceduralWorld(
    config: Partial<ProceduralWorldConfig>,
  ): Promise<ProceduralRendererState> {
    if (this.disposed || this.proceduralWorldLod === null || this.chunkRenderer === null)
      throw new Error('Die prozedurale Testwelt ist nicht aktiv.');
    const requestId = ++this.proceduralRequestId;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    if (requestId !== this.proceduralRequestId) {
      const current = this.proceduralState;
      if (current === null) throw new Error('Die prozedurale Testwelt ist nicht aktiv.');
      return current;
    }

    this.proceduralWorldLod.reconfigure(config);
    this.updateLod();
    this.chunkRenderer.setCellColors(this.proceduralWorldLod.cellColors, this.visibleUnits);
    this.publishProceduralWorkDiagnostics();
    const next = this.proceduralState;
    if (next === null) throw new Error('Die prozedurale Testwelt ist nicht aktiv.');
    return next;
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

    this.proceduralDetails?.dispose();
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

  private updateLod(): void {
    if ((this.worldLod === null && this.proceduralWorldLod === null) || this.chunkRenderer === null)
      return;
    const inputKey = this.lodInputKey();
    if (inputKey === this.lastLodInputKey) return;
    this.lastLodInputKey = inputKey;
    this.lodUpdateCount += 1;
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
    if (this.proceduralWorldLod !== null) {
      canvas.dataset.lodLevel = this.activeResolutionLevel ?? 'global';
      const focusDiagnostics = createLodFocusDiagnostics(cameraState, this.visibleUnits);
      canvas.dataset.lodFocusDirection = formatVector(focusDiagnostics.focusDirection);
      canvas.dataset.lodRegionalParents = focusDiagnostics.regionalParentIds.join(',');
      canvas.dataset.lodLocalParents = focusDiagnostics.localParentIds.join(',');
      canvas.dataset.lodFinestUnitKeys = focusDiagnostics.finestUnitKeys.join(',');
      canvas.dataset.lodFinestCellCount = String(focusDiagnostics.finestCellCount);
      canvas.dataset.lodFinestCentroid = formatVector(focusDiagnostics.finestCentroid);
      canvas.dataset.lodFocusAngle = focusDiagnostics.finestAngularDistance?.toFixed(6) ?? '';
    }
    canvas.dataset.cameraDistance = Math.hypot(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    ).toFixed(2);
    canvas.dataset.cameraTilt = Math.atan2(
      this.camera.position.y,
      Math.hypot(this.camera.position.x, this.camera.position.z),
    ).toFixed(4);
    const worldQuaternion = this.world.quaternion;
    canvas.dataset.northUp =
      Math.abs(worldQuaternion.x) + Math.abs(worldQuaternion.y) + Math.abs(worldQuaternion.z) < 1e-6
        ? 'true'
        : 'false';
    if (this.proceduralWorldLod !== null) {
      canvas.dataset.worldFingerprint = this.proceduralWorldLod.fingerprint;
      this.updateProceduralDetailsAndDiagnostics();
      this.emitProceduralState();
      this.publishProceduralWorkDiagnostics();
    }
    this.requestVisibleEarthData();
  }

  private lodInputKey(): string {
    const camera = this.camera;
    const viewportHeight = this.container.clientHeight || 1;
    const common = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
      camera.fov,
      camera.aspect,
      viewportHeight,
    ];
    if (this.proceduralWorldLod !== null)
      return JSON.stringify([...common, this.proceduralWorldLod.fingerprint]);
    return JSON.stringify([
      ...common,
      this.world.quaternion.x,
      this.world.quaternion.y,
      this.world.quaternion.z,
      this.world.quaternion.w,
    ]);
  }

  private publishProceduralWorkDiagnostics(): void {
    const stats = this.proceduralRuntimeStats;
    if (stats === null) return;
    const canvas = this.renderer.domElement;
    canvas.dataset.lodUpdates = String(stats.lodUpdates);
    canvas.dataset.lodCachedTopologies = String(stats.cachedTopologies);
    canvas.dataset.lodTopologyBuilds = String(stats.topologyBuilds);
    canvas.dataset.chunkCachedMeshes = String(stats.cachedChunkMeshes);
    canvas.dataset.chunkGeometryBuilds = String(stats.geometryBuilds);
    canvas.dataset.chunkGeometryDisposals = String(stats.geometryDisposals);
    canvas.dataset.detailCachedStates = String(stats.cachedDetailStates);
    canvas.dataset.detailBuilds = String(stats.detailBuilds);
    canvas.dataset.detailDisposals = String(stats.detailDisposals);
  }

  private updateProceduralDetailsAndDiagnostics(): void {
    const proceduralWorldLod = this.proceduralWorldLod;
    if (proceduralWorldLod === null) return;
    this.proceduralDetails?.update(
      this.visibleUnits,
      (cellId) => proceduralWorldLod.projectedCell(cellId),
      proceduralWorldLod.fingerprint,
    );
    const canvas = this.renderer.domElement;
    canvas.dataset.detailInstances = String(this.activeDetailInstanceCount);
    canvas.dataset.detailDrawCalls = String(this.activeDetailDrawCallCount);
    canvas.dataset.renderDrawCalls = String(this.activeChunkCount + this.activeDetailDrawCallCount);
    if (this.lastProceduralDiagnosticsFingerprint === proceduralWorldLod.fingerprint) return;
    this.lastProceduralDiagnosticsFingerprint = proceduralWorldLod.fingerprint;
    const diagnostics = proceduralTerrainDiagnostics(proceduralWorldLod.sourceCells);
    canvas.dataset.terrainTypes = diagnostics.terrainTypes.join(',');
    canvas.dataset.reliefBands = diagnostics.reliefBands.join(',');
    canvas.dataset.terrainGroups = diagnostics.groups.join(',');
    canvas.dataset.reliefMinimum = diagnostics.minimumRadius.toFixed(6);
    canvas.dataset.reliefMaximum = diagnostics.maximumRadius.toFixed(6);
  }

  private emitProceduralState(): void {
    const state = this.proceduralState;
    if (state === null || this.proceduralOptions.onStateChange === undefined) return;
    const key = `${state.fingerprint}:${state.lodLevel}:${state.config.density}`;
    if (key === this.lastProceduralStateKey) return;
    this.lastProceduralStateKey = key;
    this.proceduralOptions.onStateChange(state);
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

function formatVector(
  vector: { readonly x: number; readonly y: number; readonly z: number } | null,
): string {
  if (vector === null) return '';
  return [vector.x, vector.y, vector.z].map((value) => value.toFixed(6)).join(',');
}
