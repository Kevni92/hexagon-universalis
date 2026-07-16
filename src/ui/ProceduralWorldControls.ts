import {
  PROCEDURAL_DENSITY_PROFILES,
  type ProceduralDensityProfileId,
  type ProceduralWorldConfig,
} from '@/world/proceduralWorld';
import type { ProceduralWorldLodLevel } from '@/world/proceduralWorldLod';

export interface ProceduralWorldUiState {
  readonly config: ProceduralWorldConfig;
  readonly fingerprint: string;
  readonly lodLevel: ProceduralWorldLodLevel;
  readonly frequency: number;
  readonly cellCount: number;
}

export type ProceduralRegenerate = (
  config: Pick<ProceduralWorldConfig, 'seed' | 'density'>,
) => Promise<ProceduralWorldUiState>;

const DENSITY_LABELS: Readonly<Record<ProceduralDensityProfileId, string>> = {
  low: 'Niedrig',
  standard: 'Standard',
  high: 'Hoch',
  ultra: 'Ultra (experimentell)',
};

const LOD_LABELS: Readonly<Record<ProceduralWorldLodLevel, string>> = {
  global: 'Global',
  regional: 'Regional',
  local: 'Lokal',
  detail: 'Detail',
};

export class ProceduralWorldControls {
  private readonly form: HTMLFormElement;
  private readonly seedInput: HTMLInputElement;
  private readonly densitySelect: HTMLSelectElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly lodOutput: HTMLOutputElement;
  private readonly frequencyOutput: HTMLOutputElement;
  private readonly cellCountOutput: HTMLOutputElement;
  private readonly fingerprintOutput: HTMLElement;
  private requestId = 0;
  private disposed = false;

  public constructor(
    private readonly container: HTMLElement,
    initialState: ProceduralWorldUiState,
    private readonly onRegenerate: ProceduralRegenerate,
  ) {
    container.innerHTML = `
      <aside class="world-controls" data-testid="procedural-controls" aria-labelledby="procedural-controls-title">
        <div class="world-controls-heading">
          <div>
            <p class="eyebrow">Testwelt-Steuerung</p>
            <h2 id="procedural-controls-title">Prozedurale Welt</h2>
          </div>
          <span class="artificial-world-badge">Keine reale Erde</span>
        </div>
        <form class="world-controls-form" novalidate>
          <label class="control-field">
            <span>Seed</span>
            <input name="seed" type="text" required minlength="1" maxlength="128" autocomplete="off" spellcheck="false" />
          </label>
          <label class="control-field">
            <span>Hex-Dichte</span>
            <select name="density">
              ${Object.keys(PROCEDURAL_DENSITY_PROFILES)
                .map(
                  (id) =>
                    `<option value="${id}">${DENSITY_LABELS[id as ProceduralDensityProfileId]}</option>`,
                )
                .join('')}
            </select>
          </label>
          <dl class="world-stats" aria-label="Aktive Weltkonfiguration">
            <div><dt>Welt-LOD</dt><dd><output data-testid="procedural-lod"></output></dd></div>
            <div><dt>Frequenz</dt><dd><output data-testid="procedural-frequency"></output></dd></div>
            <div><dt>Zellen</dt><dd><output data-testid="procedural-cell-count"></output></dd></div>
          </dl>
          <button class="regenerate-button" type="submit">Welt neu generieren</button>
          <p class="generation-status" data-testid="procedural-generation-status" role="status" aria-live="polite"></p>
        </form>
        <div class="world-fingerprint">
          <span>Welt-Fingerprint</span>
          <code data-testid="procedural-fingerprint"></code>
        </div>
      </aside>
    `;

    const form = container.querySelector<HTMLFormElement>('form');
    const seedInput = container.querySelector<HTMLInputElement>('input[name="seed"]');
    const densitySelect = container.querySelector<HTMLSelectElement>('select[name="density"]');
    const submitButton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    const status = container.querySelector<HTMLElement>(
      '[data-testid="procedural-generation-status"]',
    );
    const lodOutput = container.querySelector<HTMLOutputElement>('[data-testid="procedural-lod"]');
    const frequencyOutput = container.querySelector<HTMLOutputElement>(
      '[data-testid="procedural-frequency"]',
    );
    const cellCountOutput = container.querySelector<HTMLOutputElement>(
      '[data-testid="procedural-cell-count"]',
    );
    const fingerprintOutput = container.querySelector<HTMLElement>(
      '[data-testid="procedural-fingerprint"]',
    );
    if (
      form === null ||
      seedInput === null ||
      densitySelect === null ||
      submitButton === null ||
      status === null ||
      lodOutput === null ||
      frequencyOutput === null ||
      cellCountOutput === null ||
      fingerprintOutput === null
    )
      throw new Error('Testwelt-Steuerung konnte nicht angelegt werden.');

    this.form = form;
    this.seedInput = seedInput;
    this.densitySelect = densitySelect;
    this.submitButton = submitButton;
    this.status = status;
    this.lodOutput = lodOutput;
    this.frequencyOutput = frequencyOutput;
    this.cellCountOutput = cellCountOutput;
    this.fingerprintOutput = fingerprintOutput;
    this.applyState(initialState, true);
    this.setPhase('ready', 'Welt bereit');
    this.form.addEventListener('submit', this.handleSubmit);
  }

  public update(state: ProceduralWorldUiState): void {
    if (this.disposed) return;
    this.applyState(state, false);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestId += 1;
    this.form.removeEventListener('submit', this.handleSubmit);
    this.container.replaceChildren();
  }

  private readonly handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const seed = this.seedInput.value.trim();
    const density = this.densitySelect.value;
    if (seed.length < 1 || seed.length > 128) {
      this.setPhase('error', 'Der Seed muss zwischen 1 und 128 Zeichen lang sein.');
      this.seedInput.focus();
      return;
    }
    if (!Object.hasOwn(PROCEDURAL_DENSITY_PROFILES, density)) {
      this.setPhase('error', 'Bitte ein unterstütztes Dichteprofil auswählen.');
      this.densitySelect.focus();
      return;
    }

    const requestId = ++this.requestId;
    this.setPhase('generating', 'Welt wird generiert …');
    void Promise.resolve().then(async () => {
      if (this.disposed || requestId !== this.requestId) return;
      try {
        const state = await this.onRegenerate({
          seed,
          density: density as ProceduralDensityProfileId,
        });
        if (this.disposed || requestId !== this.requestId) return;
        this.applyState(state, true);
        this.setPhase('ready', 'Welt bereit');
      } catch (error) {
        if (this.disposed || requestId !== this.requestId) return;
        this.setPhase(
          'error',
          error instanceof Error ? error.message : 'Die Welt konnte nicht generiert werden.',
        );
      }
    });
  };

  private applyState(state: ProceduralWorldUiState, syncInputs: boolean): void {
    if (syncInputs) {
      this.seedInput.value = state.config.seed;
      this.densitySelect.value = state.config.density;
    }
    this.lodOutput.value = LOD_LABELS[state.lodLevel];
    this.frequencyOutput.value = `f=${state.frequency}`;
    this.cellCountOutput.value = new Intl.NumberFormat('de-DE').format(state.cellCount);
    this.fingerprintOutput.textContent = state.fingerprint;
  }

  private setPhase(phase: 'ready' | 'generating' | 'error', message: string): void {
    const panel = this.container.querySelector<HTMLElement>('.world-controls');
    if (panel !== null) panel.dataset.phase = phase;
    this.submitButton.disabled = phase === 'generating';
    this.submitButton.setAttribute('aria-busy', String(phase === 'generating'));
    this.status.textContent = message;
  }
}
