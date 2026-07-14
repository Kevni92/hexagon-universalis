import type { EarthCellData } from '@/data/earthModel';
import type { TerrainClass } from '@/data/terrain';
import { TERRAIN_PALETTE } from '@/data/terrain';

export interface CellInfoViewModel {
  readonly title: string;
  readonly rows: readonly { label: string; value: string }[];
}

export interface SourceViewModel {
  readonly formatVersion: string;
  readonly sources: readonly { name: string; version: string; attribution: string }[];
}

const TERRAIN_LABELS: Readonly<Record<TerrainClass, string>> = {
  deepWater: 'Tiefsee',
  shallowWater: 'Flachwasser',
  coast: 'Küste/Strand',
  grassland: 'Grasland/Savanne',
  forest: 'Wald',
  shrubland: 'Buschland/Steppe',
  desert: 'Wüste/karg',
  wetland: 'Feuchtgebiet',
  cropland: 'Ackerland',
  settlement: 'Siedlung',
  snowIce: 'Schnee/Eis',
  highland: 'Hochland',
  mountain: 'Gebirge',
};

export function cellInfoViewModel(
  cell: EarthCellData | null,
  cellType: 'hexagon' | 'pentagon' | null,
  neighborCount = 0,
): CellInfoViewModel {
  if (cell === null || cellType === null)
    return {
      title: 'Keine Zelle ausgewählt',
      rows: [{ label: 'Hinweis', value: 'Klicke eine sichtbare Zelle an.' }],
    };
  return {
    title: cell.cellId,
    rows: [
      { label: 'Typ', value: cellType === 'pentagon' ? 'Pentagon' : 'Hexagon' },
      { label: 'Position', value: `${cell.latitude.toFixed(2)}°, ${cell.longitude.toFixed(2)}°` },
      { label: 'Höhe', value: `${formatMeters(cell.elevationMeters)} m` },
      {
        label: 'Bereich',
        value: `${formatMeters(cell.elevationMinMeters)} bis ${formatMeters(cell.elevationMaxMeters)} m`,
      },
      { label: 'Status', value: cell.isCoast ? 'Küste' : cell.isLand ? 'Land' : 'Wasser' },
      {
        label: 'Terrain',
        value: TERRAIN_LABELS[cell.terrainClass as TerrainClass] ?? cell.terrainClass,
      },
      { label: 'Landanteil', value: `${Math.round(cell.landFraction * 100)} %` },
      { label: 'Nachbarn', value: String(neighborCount) },
    ],
  };
}

export function terrainLegend(): readonly { key: TerrainClass; label: string; color: string }[] {
  return (Object.keys(TERRAIN_PALETTE) as TerrainClass[]).map((key) => ({
    key,
    label: TERRAIN_LABELS[key],
    color: TERRAIN_PALETTE[key],
  }));
}

export function sourceViewModel(
  formatVersion: number,
  sources: readonly { name: string; version: string; attribution: string }[],
): SourceViewModel {
  return {
    formatVersion: `Format v${formatVersion}`,
    sources: sources.map(({ name, version, attribution }) => ({ name, version, attribution })),
  };
}

function formatMeters(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
}
