export const EARTH_ACCEPTANCE_BUDGETS = {
  firstVisibleMilliseconds: 5_000,
  interactiveMilliseconds: 8_000,
  maxArtifactBytes: 8_000_000,
  maxConcurrentRequests: 4,
  maxCachedChunks: 24,
  maxDesktopChunks: 53,
  maxMobileChunks: 23,
  maxTextures: 0,
} as const;

export interface EarthAcceptanceSnapshot {
  readonly activeChunks: number;
  readonly activeCells: number;
  readonly geometries: number;
  readonly textures: number;
  readonly dataRequests: number;
}

export function validateEarthAcceptanceSnapshot(
  snapshot: EarthAcceptanceSnapshot,
  mobile = false,
): void {
  const chunkBudget = mobile
    ? EARTH_ACCEPTANCE_BUDGETS.maxMobileChunks
    : EARTH_ACCEPTANCE_BUDGETS.maxDesktopChunks;
  if (snapshot.activeChunks < 1 || snapshot.activeChunks > chunkBudget)
    throw new Error(`Aktive Chunks ausserhalb des Budgets: ${snapshot.activeChunks}.`);
  if (snapshot.activeCells < 1) throw new Error('Keine sichtbaren Erdzellen materialisiert.');
  if (snapshot.geometries > chunkBudget)
    throw new Error(`Geometriebudget ueberschritten: ${snapshot.geometries}.`);
  if (snapshot.textures > EARTH_ACCEPTANCE_BUDGETS.maxTextures)
    throw new Error(`Texturbudget ueberschritten: ${snapshot.textures}.`);
  if (snapshot.dataRequests > EARTH_ACCEPTANCE_BUDGETS.maxConcurrentRequests)
    throw new Error(`Requestbudget ueberschritten: ${snapshot.dataRequests}.`);
}
