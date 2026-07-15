import { SceneRenderer, type WorldMode } from '@/rendering/SceneRenderer';
import {
  DEFAULT_PROCEDURAL_WORLD_CONFIG,
  PROCEDURAL_DENSITY_PROFILES,
  type ProceduralDensityProfileId,
  type ProceduralWorldConfig,
} from '@/world/proceduralWorld';
import { ProceduralWorldControls, type ProceduralWorldUiState } from '@/ui/ProceduralWorldControls';

export interface App {
  start(): void;
  dispose(): void;
}

const DEMO_STATUS = 'Tile-Demo – keine reale Erde';
const EARTH_STATUS = 'Versionierte Erddaten werden geladen ...';
const LOD_STATUS = 'Multi-LOD-Testszene bereit';
const PROCEDURAL_STATUS = 'Prozedurale Testwelt – keine reale Erde';

const WORLD_MODES: readonly WorldMode[] = ['earth', 'demo', 'lod', 'procedural'];

export function resolveWorldMode(search: string): WorldMode {
  const requested = new URLSearchParams(search).get('world');
  return WORLD_MODES.find((mode) => mode === requested) ?? 'procedural';
}

export function resolveProceduralWorldConfig(
  search: string,
): Pick<ProceduralWorldConfig, 'seed' | 'density'> {
  const parameters = new URLSearchParams(search);
  const requestedSeed = parameters.get('seed')?.trim();
  const requestedDensity = parameters.get('density');
  return {
    seed:
      requestedSeed !== undefined && requestedSeed.length >= 1 && requestedSeed.length <= 128
        ? requestedSeed
        : DEFAULT_PROCEDURAL_WORLD_CONFIG.seed,
    density:
      requestedDensity !== null && Object.hasOwn(PROCEDURAL_DENSITY_PROFILES, requestedDensity)
        ? (requestedDensity as ProceduralDensityProfileId)
        : DEFAULT_PROCEDURAL_WORLD_CONFIG.density,
  };
}

function statusForWorldMode(worldMode: WorldMode): string {
  if (worldMode === 'demo') return DEMO_STATUS;
  if (worldMode === 'lod') return LOD_STATUS;
  if (worldMode === 'procedural') return PROCEDURAL_STATUS;
  return EARTH_STATUS;
}

export function createApp(root: HTMLElement, locationSearch = window.location.search): App {
  const worldMode = resolveWorldMode(locationSearch);

  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <p class="eyebrow">Projektgrundlage</p>
        <h1>Hexagon Universalis</h1>
      <p id="status" class="status" data-testid="app-status" role="status" aria-live="polite">${statusForWorldMode(worldMode)}</p>
      </header>
      <section class="viewport" data-testid="globe-viewport" aria-label="Interaktive 3D-Testszene"></section>
      ${worldMode === 'procedural' ? '<div class="world-controls-host"></div>' : ''}
    </main>
  `;

  const viewport = root.querySelector<HTMLElement>('.viewport');

  if (viewport === null) {
    throw new Error('Rendering-Container wurde nicht angelegt.');
  }

  let renderer: SceneRenderer | null = null;
  let proceduralControls: ProceduralWorldControls | null = null;
  let latestProceduralState: ProceduralWorldUiState | null = null;

  try {
    renderer = new SceneRenderer(
      viewport,
      worldMode,
      undefined,
      (earthStatus) => {
        const status = root.querySelector<HTMLElement>('#status');
        if (status === null) return;
        status.textContent = earthStatus.message;
        status.classList.toggle('status-error', earthStatus.phase === 'error');
      },
      worldMode === 'procedural'
        ? {
            config: resolveProceduralWorldConfig(locationSearch),
            onStateChange: (state) => {
              latestProceduralState = state;
              proceduralControls?.update(state);
            },
          }
        : undefined,
    );
    if (worldMode === 'procedural') {
      const controlsHost = root.querySelector<HTMLElement>('.world-controls-host');
      const initialState = latestProceduralState ?? renderer.proceduralState;
      if (controlsHost === null || initialState === null)
        throw new Error('Testwelt-Steuerung konnte nicht initialisiert werden.');
      proceduralControls = new ProceduralWorldControls(
        controlsHost,
        initialState,
        async (config) => {
          if (renderer === null) throw new Error('Die 3D-Szene ist nicht verfügbar.');
          const state = await renderer.regenerateProceduralWorld(config);
          updateProceduralUrl(state.config);
          return state;
        },
      );
    }
  } catch (error) {
    const status = root.querySelector<HTMLElement>('#status');
    if (status !== null) {
      status.textContent =
        error instanceof Error && error.message.includes('WebGL')
          ? 'WebGL konnte nicht initialisiert werden. Bitte aktiviere WebGL oder verwende einen aktuellen Browser.'
          : 'Die 3D-Szene konnte nicht initialisiert werden.';
      status.classList.add('status-error');
    }
  }

  return {
    start: () => renderer?.start(),
    dispose: () => {
      proceduralControls?.dispose();
      renderer?.dispose();
      root.replaceChildren();
    },
  };
}

function updateProceduralUrl(config: ProceduralWorldConfig): void {
  const url = new URL(window.location.href);
  url.searchParams.set('world', 'procedural');
  url.searchParams.set('seed', config.seed);
  url.searchParams.set('density', config.density);
  window.history.replaceState(null, '', url);
}
