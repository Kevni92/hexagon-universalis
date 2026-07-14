export type LodLevel = 0 | 1 | 2 | 3;
export type LodQuality = 'low' | 'default';
export interface LodThreshold {
  readonly enter: number;
  readonly exit: number;
}
export interface LodProfile {
  readonly quality: LodQuality;
  readonly thresholds: Readonly<Record<LodLevel, LodThreshold>>;
  readonly maxInstances: Readonly<Record<LodLevel, number>>;
}

export const TILE_LOD_PROFILES: Readonly<Record<LodQuality, LodProfile>> = {
  low: {
    quality: 'low',
    thresholds: {
      0: { enter: Infinity, exit: 18 },
      1: { enter: 16, exit: 20 },
      2: { enter: 8, exit: 10 },
      3: { enter: 3, exit: 5 },
    },
    maxInstances: { 0: 0, 1: 100, 2: 400, 3: 800 },
  },
  default: {
    quality: 'default',
    thresholds: {
      0: { enter: Infinity, exit: 20 },
      1: { enter: 18, exit: 22 },
      2: { enter: 9, exit: 11 },
      3: { enter: 3, exit: 5 },
    },
    maxInstances: { 0: 0, 1: 200, 2: 800, 3: 1600 },
  },
};

export function lodForDistance(
  distance: number,
  profile: LodProfile = TILE_LOD_PROFILES.default,
): LodLevel {
  if (!Number.isFinite(distance) || distance < 0)
    throw new RangeError('Kameraabstand muss endlich und nichtnegativ sein.');
  if (distance <= profile.thresholds[3].enter) return 3;
  if (distance <= profile.thresholds[2].enter) return 2;
  if (distance <= profile.thresholds[1].enter) return 1;
  return 0;
}

export class LodController {
  public level: LodLevel = 0;
  public constructor(public readonly profile: LodProfile = TILE_LOD_PROFILES.default) {}
  public update(distance: number): LodLevel {
    if (!Number.isFinite(distance) || distance < 0)
      throw new RangeError('Kameraabstand muss endlich und nichtnegativ sein.');
    if (this.level > 0 && distance > this.profile.thresholds[this.level].exit)
      this.level = (this.level - 1) as LodLevel;
    else
      while (
        this.level < 3 &&
        distance <= this.profile.thresholds[(this.level + 1) as LodLevel].enter
      )
        this.level = (this.level + 1) as LodLevel;
    return this.level;
  }
}
