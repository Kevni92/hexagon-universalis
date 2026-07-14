const UINT32_MAX = 0xffffffff;

export interface SeededNoise3D {
  sample(x: number, y: number, z: number): number;
  fbm(
    x: number,
    y: number,
    z: number,
    octaves?: number,
    lacunarity?: number,
    gain?: number,
  ): number;
}

export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashText(value: string): string {
  return hashSeed(value).toString(16).padStart(8, '0');
}

export function createSeededNoise3D(seed: string): SeededNoise3D {
  if (seed.length === 0) throw new RangeError('Noise-Seed darf nicht leer sein.');
  const seedHash = hashSeed(seed);

  const sample = (x: number, y: number, z: number): number => {
    assertFiniteCoordinates(x, y, z);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const tz = fade(z - z0);

    const x00 = lerp(lattice(seedHash, x0, y0, z0), lattice(seedHash, x1, y0, z0), tx);
    const x10 = lerp(lattice(seedHash, x0, y1, z0), lattice(seedHash, x1, y1, z0), tx);
    const x01 = lerp(lattice(seedHash, x0, y0, z1), lattice(seedHash, x1, y0, z1), tx);
    const x11 = lerp(lattice(seedHash, x0, y1, z1), lattice(seedHash, x1, y1, z1), tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
  };

  return {
    sample,
    fbm(
      x: number,
      y: number,
      z: number,
      octaves = 5,
      lacunarity = 2,
      gain = 0.5,
    ): number {
      assertFiniteCoordinates(x, y, z);
      if (!Number.isInteger(octaves) || octaves < 1 || octaves > 12)
        throw new RangeError('Noise-Oktaven müssen eine ganze Zahl zwischen 1 und 12 sein.');
      if (!Number.isFinite(lacunarity) || lacunarity <= 1)
        throw new RangeError('Noise-Lacunarity muss größer als 1 sein.');
      if (!Number.isFinite(gain) || gain <= 0 || gain >= 1)
        throw new RangeError('Noise-Gain muss zwischen 0 und 1 liegen.');

      let amplitude = 1;
      let frequency = 1;
      let total = 0;
      let normalization = 0;
      for (let octave = 0; octave < octaves; octave += 1) {
        total += sample(x * frequency, y * frequency, z * frequency) * amplitude;
        normalization += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
      }
      return total / normalization;
    },
  };
}

function lattice(seed: number, x: number, y: number, z: number): number {
  let hash = seed;
  hash ^= Math.imul(x, 0x1f123bb5);
  hash ^= Math.imul(y, 0x5f356495);
  hash ^= Math.imul(z, 0x6c8e9cf5);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / UINT32_MAX) * 2 - 1;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(first: number, second: number, factor: number): number {
  return first + (second - first) * factor;
}

function assertFiniteCoordinates(x: number, y: number, z: number): void {
  if (![x, y, z].every(Number.isFinite))
    throw new RangeError('Noise-Koordinaten müssen endlich sein.');
}
