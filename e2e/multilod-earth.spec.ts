import { expect, test } from '@playwright/test';

type Diagnostics = NonNullable<
  ReturnType<NonNullable<Window['__hexagonUniversalis']>['diagnostics']>
>;

const diagnostics = async (page: import('@playwright/test').Page): Promise<Diagnostics> =>
  page.evaluate(() => {
    const value = window.__hexagonUniversalis?.diagnostics();
    if (value === null || value === undefined) throw new Error('Runtime diagnostics unavailable.');
    return value;
  });

test('real earth bootstrap exposes versioned reference geography under the Pages base path', async ({
  page,
  request,
}) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto('/hexagon-universalis/');
  await expect(page.getByTestId('app-status')).toContainText('2026.07-reference-v1');

  const manifestResponse = await request.get('/hexagon-universalis/data/earth/v1/manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    datasetVersion: string;
    topologyFingerprint: string;
    sourceFingerprint: string;
    chunks: { level: string; path: string }[];
  };
  const global = manifest.chunks.find((chunk) => chunk.level === 'global');
  if (global === undefined) throw new Error('global chunk missing');
  const chunkResponse = await request.get(`/hexagon-universalis/data/earth/v1/${global.path}`);
  expect(chunkResponse.ok()).toBe(true);
  const chunk = JSON.parse((await chunkResponse.body()).toString('utf8')) as {
    cells: { terrainClass: string; elevationMaxMeters: number; landFraction: number }[];
  };
  const reference = {
    datasetVersion: manifest.datasetVersion,
    fingerprints: [manifest.topologyFingerprint, manifest.sourceFingerprint],
    terrain: chunk.cells.map((cell) => cell.terrainClass),
    highest: Math.max(...chunk.cells.map((cell) => cell.elevationMaxMeters)),
    hasOcean: chunk.cells.some((cell) => cell.landFraction === 0),
  };

  expect(reference.datasetVersion).toBe('2026.07-reference-v1');
  expect(reference.fingerprints.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  expect(reference.terrain).toEqual(
    expect.arrayContaining(['mountain', 'desert', 'forest', 'snowIce', 'deepWater', 'coast']),
  );
  expect(reference.highest).toBeGreaterThan(8_000);
  expect(reference.hasOcean).toBe(true);
  expect((await diagnostics(page)).worldMode).toBe('earth');
  expect(errors).toEqual([]);
});

test('zoom refinement remains inside chunk, request, and GPU resource budgets', async ({
  page,
}) => {
  await page.goto('/hexagon-universalis/');
  await expect(page.getByTestId('app-status')).toContainText('sind bereit');
  const canvas = page.locator('canvas.viewport-canvas');
  await canvas.hover();

  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, -2_000);
    await page.waitForTimeout(150);
    const refined = await diagnostics(page);
    expect(refined.activeChunkCount).toBeGreaterThan(0);
    expect(refined.activeChunkCount).toBeLessThanOrEqual(53);
    expect(refined.resources.geometries).toBeLessThanOrEqual(53);
    expect(refined.resources.textures).toBe(0);
    expect(refined.dataStatus?.activeRequests ?? 0).toBeLessThanOrEqual(4);
    await page.mouse.wheel(0, 2_000);
    await page.waitForTimeout(150);
  }

  const coarse = await diagnostics(page);
  expect(coarse.activeChunkCount).toBeGreaterThan(0);
  expect(coarse.activeChunkCount).toBeLessThanOrEqual(53);
  expect(coarse.dataStatus?.cachedChunks ?? 0).toBeLessThanOrEqual(24);
});

test('circular dragging stays north-up and cannot cross a pole', async ({ page }) => {
  await page.goto('/hexagon-universalis/');
  const canvas = page.locator('canvas.viewport-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('canvas bounds unavailable');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (const [x, y] of [
    [80, 0],
    [80, 80],
    [0, 80],
    [-80, 0],
    [0, -2_000],
  ] as const)
    await page.mouse.move(center.x + x, center.y + y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const state = await diagnostics(page);
  expect(Math.abs(state.orientation.latitudeDegrees)).toBeLessThanOrEqual(85.001);
  expect(state.orientation.rollDegrees).toBe(0);
  expect(Number.isFinite(state.cameraDistance)).toBe(true);
});

test('a missing data chunk leaves the geometry fallback interactive with a controlled status', async ({
  page,
}) => {
  await page.route('**/data/earth/v1/lvl0-global/root.json.gz', (route) =>
    route.fulfill({ status: 404, body: 'missing bootstrap chunk' }),
  );
  await page.goto('/hexagon-universalis/');
  const canvas = page.locator('canvas.viewport-canvas');
  await expect(page.getByTestId('app-status')).toContainText('konnte nicht geladen werden');
  await expect(canvas).toBeVisible();
  await canvas.hover();
  await page.mouse.wheel(0, -400);
  const state = await diagnostics(page);
  expect(state.dataStatus?.phase).toBe('degraded');
  expect(state.activeCellCount).toBeGreaterThan(0);
});

test('the showcase remains explicitly separate from the real earth runtime', async ({ page }) => {
  await page.goto('/hexagon-universalis/?world=demo');
  await expect(page.getByTestId('app-status')).toHaveText('Tile-Demo – keine reale Erde');
  const state = await diagnostics(page);
  expect(state.worldMode).toBe('demo');
  expect(state.dataStatus).toBeNull();
});
