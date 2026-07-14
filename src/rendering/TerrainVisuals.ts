import type { TerrainClass } from '@/data/terrain';

export interface TerrainVisual {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
}

export const TERRAIN_VISUALS: Readonly<Record<TerrainClass, TerrainVisual>> = {
  deepWater: { color: '#173b68', roughness: 0.28, metalness: 0.05 },
  shallowWater: { color: '#2f82aa', roughness: 0.24, metalness: 0.04 },
  coast: { color: '#c6a36a', roughness: 0.86, metalness: 0 },
  grassland: { color: '#8eb85a', roughness: 0.92, metalness: 0 },
  forest: { color: '#2d7047', roughness: 0.9, metalness: 0 },
  shrubland: { color: '#a6a65b', roughness: 0.93, metalness: 0 },
  desert: { color: '#c9a66b', roughness: 0.96, metalness: 0 },
  wetland: { color: '#4f8c72', roughness: 0.78, metalness: 0 },
  cropland: { color: '#b4a64a', roughness: 0.88, metalness: 0 },
  settlement: { color: '#b65f55', roughness: 0.75, metalness: 0.02 },
  snowIce: { color: '#e8f4ff', roughness: 0.62, metalness: 0 },
  highland: { color: '#85755b', roughness: 0.94, metalness: 0 },
  mountain: { color: '#66584c', roughness: 0.95, metalness: 0 },
};

export function terrainColor(
  terrainClass: TerrainClass,
  cellId: string,
  variation = false,
): string {
  const visual = TERRAIN_VISUALS[terrainClass];
  if (!variation) return visual.color;
  const amount = ((stableHash(cellId) % 9) - 4) / 100;
  return adjustHexColor(visual.color, amount);
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function adjustHexColor(color: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return `#${channels
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel * (1 + amount))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
