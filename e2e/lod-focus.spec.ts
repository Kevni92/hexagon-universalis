import { expect, test, type Locator } from '@playwright/test';

type LodFocusState = {
  readonly lodLevel: string | undefined;
  readonly cameraDistance: number;
  readonly focusDirection: string | undefined;
  readonly regionalParents: string | undefined;
  readonly localParents: string | undefined;
  readonly finestUnitKeys: string | undefined;
  readonly finestCellCount: number;
  readonly focusAngle: number;
};

async function readFocusState(canvas: Locator): Promise<LodFocusState> {
  return canvas.evaluate((element) => {
    const dataset = (element as HTMLCanvasElement).dataset;
    return {
      lodLevel: dataset.lodLevel,
      cameraDistance: Number(dataset.cameraDistance),
      focusDirection: dataset.lodFocusDirection,
      regionalParents: dataset.lodRegionalParents,
      localParents: dataset.lodLocalParents,
      finestUnitKeys: dataset.lodFinestUnitKeys,
      finestCellCount: Number(dataset.lodFinestCellCount),
      focusAngle: Number(dataset.lodFocusAngle),
    };
  });
}

function expectStableFocus(current: LodFocusState, reference: LodFocusState): void {
  expect(current.lodLevel).toBe('local');
  expect(current.focusDirection).toBe(reference.focusDirection);
  expect(current.regionalParents).toBe(reference.regionalParents);
  expect(current.localParents).toBe(reference.localParents);
  expect(current.finestUnitKeys).toBe(reference.finestUnitKeys);
  expect(current.finestCellCount).toBe(reference.finestCellCount);
  expect(current.focusAngle).toBeLessThan(0.2);
}

test('high-density Lokal-LOD behält bei reinem Zoom den zentralen Parent-Fokus', async ({
  page,
}, testInfo) => {
  test.slow();
  test.skip(testInfo.project.name !== 'chromium', 'Visuelle Regression läuft im Desktop-Chromium.');
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/?world=procedural&seed=fgh&density=high');
  const canvas = page.locator('canvas.viewport-canvas');
  await expect(page.getByTestId('procedural-generation-status')).toHaveText('Welt bereit');
  await expect(canvas).toHaveAttribute('data-world-fingerprint', /.+/, { timeout: 45_000 });

  // Ein einzelner kontrollierter Impuls erreicht die bekannte Nahgrenze 1,18,
  // ohne während der teuren High-Density-Materialisierung weitere Frames zu fluten.
  await canvas.dispatchEvent('wheel', { deltaY: -3_000 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'local', { timeout: 45_000 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.18', { timeout: 45_000 });
  await expect(canvas).toHaveAttribute('data-lod-local-parents', /\d+:\d+/, { timeout: 45_000 });

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const reference = await readFocusState(canvas);
  expect(reference.finestCellCount).toBeGreaterThan(0);
  expect(reference.focusAngle).toBeLessThan(0.2);
  await testInfo.attach('issue-88-high-local-zoom-start', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });

  await canvas.dispatchEvent('wheel', { deltaY: 20 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.22', { timeout: 45_000 });
  expectStableFocus(await readFocusState(canvas), reference);

  await canvas.dispatchEvent('wheel', { deltaY: -20 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.18', { timeout: 45_000 });
  expectStableFocus(await readFocusState(canvas), reference);

  await testInfo.attach('issue-88-high-local-zoom-end', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });
  expect(pageErrors).toEqual([]);
});
