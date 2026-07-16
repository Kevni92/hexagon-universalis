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

type ProceduralWorkState = {
  readonly lodUpdates: number;
  readonly cachedTopologies: number;
  readonly topologyBuilds: number;
  readonly cachedChunkMeshes: number;
  readonly geometryBuilds: number;
  readonly geometryDisposals: number;
  readonly cachedDetailStates: number;
  readonly detailBuilds: number;
  readonly detailDisposals: number;
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

async function readWorkState(canvas: Locator): Promise<ProceduralWorkState> {
  return canvas.evaluate((element) => {
    const dataset = (element as HTMLCanvasElement).dataset;
    return {
      lodUpdates: Number(dataset.lodUpdates),
      cachedTopologies: Number(dataset.lodCachedTopologies),
      topologyBuilds: Number(dataset.lodTopologyBuilds),
      cachedChunkMeshes: Number(dataset.chunkCachedMeshes),
      geometryBuilds: Number(dataset.chunkGeometryBuilds),
      geometryDisposals: Number(dataset.chunkGeometryDisposals),
      cachedDetailStates: Number(dataset.detailCachedStates),
      detailBuilds: Number(dataset.detailBuilds),
      detailDisposals: Number(dataset.detailDisposals),
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

test('high-density Lokal-LOD hält stationäre, Rotations- und Zoombudgets ein', async ({
  page,
}, testInfo) => {
  test.slow();
  test.setTimeout(150_000);
  test.skip(testInfo.project.name !== 'chromium', 'Visuelle Regression läuft im Desktop-Chromium.');
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/?world=procedural&seed=fgh&density=high');
  const canvas = page.locator('canvas.viewport-canvas');
  await expect(page.getByTestId('procedural-generation-status')).toHaveText('Welt bereit');
  await expect(canvas).toHaveAttribute('data-world-fingerprint', /.+/, { timeout: 45_000 });

  // Ein einzelner kontrollierter Impuls erreicht die Nahgrenze 1,20,
  // ohne während der teuren High-Density-Materialisierung weitere Frames zu fluten.
  await canvas.dispatchEvent('wheel', { deltaY: -3_000 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'local', { timeout: 45_000 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.20', { timeout: 45_000 });
  await expect(canvas).toHaveAttribute('data-lod-finest-unit-keys', 'lvl2-local/visible', {
    timeout: 45_000,
  });

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const reference = await readFocusState(canvas);
  const warmedWork = await readWorkState(canvas);
  expect(reference.finestCellCount).toBeGreaterThan(0);
  expect(reference.focusAngle).toBeLessThan(0.2);
  expect(warmedWork.cachedTopologies).toBe(3);
  expect(warmedWork.topologyBuilds).toBe(3);
  expect(warmedWork.geometryBuilds).toBe(2);
  expect(warmedWork.detailBuilds).toBe(1);

  await page.waitForTimeout(250);
  expect(await readWorkState(canvas)).toEqual(warmedWork);

  await testInfo.attach('issue-88-high-local-zoom-start', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });

  await canvas.dispatchEvent('wheel', { deltaY: 20 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.24', { timeout: 45_000 });
  expectStableFocus(await readFocusState(canvas), reference);

  await canvas.dispatchEvent('wheel', { deltaY: -20 });
  await expect(canvas).toHaveAttribute('data-camera-distance', '1.20', { timeout: 45_000 });
  expectStableFocus(await readFocusState(canvas), reference);

  const beforeRotation = await readWorkState(canvas);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.44, { steps: 8 });
  await page.mouse.up();
  await canvas.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(await readWorkState(canvas)).toEqual(beforeRotation);

  await testInfo.attach('issue-88-high-local-zoom-end', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });
  expect(pageErrors).toEqual([]);
});
