import type { TileModifier, TileType } from '@/data/tileCatalog';

export function tileDetailProfile(type: TileType, index: number): readonly TileModifier[] {
  const modifiers: TileModifier[] = [];
  if (
    ['temperateMixedForest', 'borealForest', 'tropicalRainforest', 'tundraWoodland'].includes(
      type,
    ) &&
    index % 3 === 0
  )
    modifiers.push('hills');
  if (['borealForest', 'tundra', 'tundraWoodland'].includes(type) && index % 2 === 0)
    modifiers.push('snowCover');
  if (['desert', 'semiDesert'].includes(type) && index % 4 === 0) modifiers.push('mountains');
  if (['sandCoast', 'rockyCoast', 'coastalWater', 'iceWater'].includes(type))
    modifiers.push('coastal');
  return modifiers;
}
