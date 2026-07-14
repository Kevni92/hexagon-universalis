import type { ResolutionLevelName } from './identifiers';

/**
 * Konfigurierbares Qualitätsprofil je Zielplattform. Legt für jede
 * Auflösungsstufe (global/regional/local) die Patch-Frequenz sowie die
 * Pixelschwellen fest, ab denen eine Elternzelle durch ihre feinere
 * Kind-Ebene ersetzt wird (Auswahlregel gemäß ADR 0001,
 * "Auswahl-, Übergangs- und Picking-Strategie").
 *
 * `refineAbovePx` / `coarsenBelowPx`: Hysterese-Paar. Eine Elternzelle wird
 * verfeinert, sobald ihre projizierte Größe (Pixel) `refineAbovePx`
 * überschreitet; ein bereits verfeinerter Chunk wird erst wieder vergröbert,
 * wenn die Elterngröße unter `coarsenBelowPx` fällt. `refineAbovePx >
 * coarsenBelowPx` ist Pflicht (sonst kein Hysterese-Fenster, siehe
 * `validateQualityProfile`).
 */
export interface LevelQualityConfig {
  readonly frequency: number;
  readonly refineAbovePx: number;
  readonly coarsenBelowPx: number;
  readonly maxActiveChunks: number;
}

export interface QualityProfile {
  readonly name: string;
  readonly levels: Readonly<Record<ResolutionLevelName, LevelQualityConfig>>;
}

/** Desktop-Profil: großzügigere Chunkbudgets, siehe ADR-Budgettabelle. */
export const DESKTOP_QUALITY_PROFILE: QualityProfile = {
  name: 'desktop',
  levels: {
    global: { frequency: 8, refineAbovePx: Infinity, coarsenBelowPx: 0, maxActiveChunks: 1 },
    regional: { frequency: 8, refineAbovePx: 140, coarsenBelowPx: 100, maxActiveChunks: 12 },
    local: { frequency: 4, refineAbovePx: 220, coarsenBelowPx: 160, maxActiveChunks: 40 },
  },
};

/** Mobiles Profil: kleinere Patch-Frequenzen und Chunkbudgets. */
export const MOBILE_QUALITY_PROFILE: QualityProfile = {
  name: 'mobile',
  levels: {
    global: { frequency: 4, refineAbovePx: Infinity, coarsenBelowPx: 0, maxActiveChunks: 1 },
    regional: { frequency: 4, refineAbovePx: 180, coarsenBelowPx: 130, maxActiveChunks: 6 },
    local: { frequency: 2, refineAbovePx: 260, coarsenBelowPx: 190, maxActiveChunks: 16 },
  },
};

export const QUALITY_PROFILES: Readonly<Record<string, QualityProfile>> = {
  desktop: DESKTOP_QUALITY_PROFILE,
  mobile: MOBILE_QUALITY_PROFILE,
};

export function validateQualityProfile(profile: QualityProfile): void {
  for (const [name, config] of Object.entries(profile.levels)) {
    if (name !== 'global' && config.refineAbovePx <= config.coarsenBelowPx)
      throw new RangeError(
        `Ungültiges Hysterese-Fenster für Ebene ${name}: refineAbovePx muss größer als coarsenBelowPx sein.`,
      );
    if (!Number.isInteger(config.frequency) || config.frequency < 1)
      throw new RangeError(`Ungültige Patch-Frequenz für Ebene ${name}.`);
    if (!Number.isInteger(config.maxActiveChunks) || config.maxActiveChunks < 0)
      throw new RangeError(`Ungültiges maxActiveChunks für Ebene ${name}.`);
  }
}

validateQualityProfile(DESKTOP_QUALITY_PROFILE);
validateQualityProfile(MOBILE_QUALITY_PROFILE);
