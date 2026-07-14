import { describe, expect, it } from 'vitest';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateEarthDataArtifact } from '@/data/earthModel';

const manifestModule = fileURLToPath(new URL('../scripts/data/manifest.mjs', import.meta.url));
const fixtureManifest = fileURLToPath(
  new URL('./fixtures/complete-manifest.json', import.meta.url),
);

describe('earth data contracts', () => {
  it('rejects incomplete source checksums and accepts a complete manifest', async () => {
    const { loadManifest, validateManifest } = await import(manifestModule);
    const complete = await loadManifest(fixtureManifest);
    expect(() => validateManifest(complete)).not.toThrow();
    const incomplete = { ...complete, sources: [{ ...complete.sources[0], sha256: null }] };
    expect(() => validateManifest(incomplete)).toThrow(/SHA-256/);
  });

  it('keeps manifest fingerprints deterministic and hashes raw files', async () => {
    const { fingerprintManifest, loadManifest, sha256File } = await import(manifestModule);
    const manifest = await loadManifest(fixtureManifest);
    expect(fingerprintManifest(manifest)).toBe(
      fingerprintManifest(JSON.parse(JSON.stringify(manifest))),
    );
    const bytes = await readFile(fixtureManifest);
    expect(await sha256File(fixtureManifest)).toHaveLength(64);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('validates versioned, finite and uniquely keyed earth cells', () => {
    const artifact = {
      formatVersion: 1,
      topologyFingerprint: 'topology-v1',
      sourceFingerprint: 'sources-v1',
      cells: [
        {
          cellId: 'cell-0001',
          latitude: 48,
          longitude: 11,
          elevationMeters: 500,
          elevationMinMeters: 400,
          elevationMaxMeters: 600,
          landFraction: 1,
          isLand: true,
          isWater: false,
          isCoast: false,
          terrainClass: 'temperate',
          sourceFlags: ['fixture'],
        },
      ],
    } as const;
    expect(() => validateEarthDataArtifact(artifact, 'topology-v1')).not.toThrow();
    expect(() => validateEarthDataArtifact({ ...artifact, formatVersion: 2 })).toThrow();
    expect(() =>
      validateEarthDataArtifact({
        ...artifact,
        cells: [{ ...artifact.cells[0], landFraction: 2 }],
      }),
    ).toThrow();
  });
});
