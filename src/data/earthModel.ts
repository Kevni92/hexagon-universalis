export const EARTH_DATA_FORMAT_VERSION = 1;

export interface EarthCellData {
  readonly cellId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMeters: number;
  readonly elevationMinMeters: number;
  readonly elevationMaxMeters: number;
  readonly landFraction: number;
  readonly isLand: boolean;
  readonly isWater: boolean;
  readonly isCoast: boolean;
  readonly terrainClass: string;
  readonly sourceFlags: readonly string[];
}

export interface EarthDataArtifact {
  readonly formatVersion: number;
  readonly topologyFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cells: readonly EarthCellData[];
}

export function validateEarthDataArtifact(
  artifact: EarthDataArtifact,
  expectedTopologyFingerprint?: string,
): void {
  if (artifact.formatVersion !== EARTH_DATA_FORMAT_VERSION) {
    throw new Error(`Nicht unterstützte Erdformatversion: ${artifact.formatVersion}.`);
  }
  if (
    expectedTopologyFingerprint !== undefined &&
    artifact.topologyFingerprint !== expectedTopologyFingerprint
  ) {
    throw new Error('Das Erdartefakt gehört nicht zur erwarteten Topologie.');
  }

  const ids = new Set<string>();
  for (const cell of artifact.cells) {
    if (ids.has(cell.cellId)) throw new Error(`Doppelte Zell-ID: ${cell.cellId}.`);
    ids.add(cell.cellId);
    if (!Number.isFinite(cell.latitude) || cell.latitude < -90 || cell.latitude > 90)
      throw new Error(`Ungültige Breite für ${cell.cellId}.`);
    if (!Number.isFinite(cell.longitude) || cell.longitude < -180 || cell.longitude > 180)
      throw new Error(`Ungültige Länge für ${cell.cellId}.`);
    if (
      ![cell.elevationMeters, cell.elevationMinMeters, cell.elevationMaxMeters].every(
        Number.isFinite,
      )
    )
      throw new Error(`Ungültige Höhe für ${cell.cellId}.`);
    if (cell.elevationMinMeters > cell.elevationMaxMeters)
      throw new Error(`Höhenbereich invertiert für ${cell.cellId}.`);
    if (!Number.isFinite(cell.landFraction) || cell.landFraction < 0 || cell.landFraction > 1)
      throw new Error(`Ungültiger Landanteil für ${cell.cellId}.`);
    if (cell.isLand && cell.isWater)
      throw new Error(`Zelle kann nicht gleichzeitig Land und Wasser sein: ${cell.cellId}.`);
  }
}
