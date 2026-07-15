import { expect, test, type Locator } from '@playwright/test';

// Die Suite erzeugt pro Test einen WebGL-Kontext. Parallele Software-Renderer
// konkurrieren in CI um denselben GPU-Prozess und verfälschen LOD-Zeitlimits.
test.describe.configure({ mode: 'serial' });

type ProceduralLod = 'global' | 'regional' | 'local';

async function zoomUntilLod(
  canvas: Locator,
  target: ProceduralLod,
  deltaY: number,
  maxSteps = 8,
): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if ((await canvas.getAttribute('data-lod-level')) === target) return;
    await canvas.dispatchEvent('wheel', { deltaY });
    await canvas.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await expect(canvas).toHaveAttribute('data-lod-level', target, {
    timeout: 15_000,
  });
}

async function readProceduralRenderState(canvas: Locator): Promise<{
  readonly lodLevel: string | null;
  readonly detailInstances: number;
  readonly detailDrawCalls: number;
  readonly renderDrawCalls: number;
}> {
  return {
    lodLevel: await canvas.getAttribute('data-lod-level'),
    detailInstances: Number(await canvas.getAttribute('data-detail-instances')),
    detailDrawCalls: Number(await canvas.getAttribute('data-detail-draw-calls')),
    renderDrawCalls: Number(await canvas.getAttribute('data-render-draw-calls')),
  };
}

test('production app loads a usable globe viewport', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/');
  await expect(page).toHaveTitle('Hexagon Universalis');
  await expect(page.getByTestId('app-status')).toBeVisible();
  await expect(page.getByTestId('globe-viewport')).toBeVisible();
  await expect(page.locator('canvas.viewport-canvas')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('desktop and mobile viewport do not overflow horizontally', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible();
});

test('demo world is opt-in via query parameter and clearly labeled', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await expect(page.getByTestId('app-status')).toContainText(
    'Erdaten 2026.07-reference-v1 sind bereit',
  );

  await page.goto('/?world=demo');
  await expect(page.getByTestId('app-status')).toHaveText('Tile-Demo – keine reale Erde');
  await expect(page.locator('canvas.viewport-canvas')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('lod world renders the selective multi-level chunk pipeline without console errors', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/?world=lod');
  await expect(page.getByTestId('app-status')).toHaveText('Multi-LOD-Testszene bereit');
  await expect(page.locator('canvas.viewport-canvas')).toHaveCount(1);

  const canvas = page.locator('canvas.viewport-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20);
    await page.mouse.up();
    await canvas.hover();
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 400);
  }

  await expect(page.getByTestId('app-status')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('globe canvas accepts pointer and wheel interaction', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas.viewport-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10);
  await page.mouse.up();
  await canvas.hover();
  await page.mouse.wheel(0, 120);
  await expect(page.getByTestId('app-status')).toBeVisible();
});

test('procedural world reaches Global, Regional and Lokal without console errors', async ({
  page,
}) => {
  test.slow();
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/?world=procedural');
  await expect(page.getByTestId('app-status')).toHaveText(
    'Prozedurale Testwelt – keine reale Erde',
  );
  const canvas = page.locator('canvas.viewport-canvas');
  const lodOutput = page.getByTestId('procedural-lod');
  await expect(canvas).toHaveAttribute('data-lod-level', 'global');
  await expect(lodOutput).toHaveText('Global');

  await zoomUntilLod(canvas, 'regional', -400);
  await expect(lodOutput).toHaveText('Regional');
  await expect(page.getByTestId('procedural-frequency')).toHaveText('f=16');
  await expect(page.getByTestId('procedural-cell-count')).toHaveText('2.562');
  await expect(canvas).toHaveAttribute('data-lod-finest-cell-count', '2562');
  await expect(canvas).toHaveAttribute('data-detail-instances', '0');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeGreaterThan(2);
  await zoomUntilLod(canvas, 'local', -400);
  await expect(lodOutput).toHaveText('Lokal');
  await expect(page.getByTestId('procedural-frequency')).toHaveText('f=32');
  await expect(page.getByTestId('procedural-cell-count')).toHaveText('10.242');
  await expect(canvas).toHaveAttribute('data-lod-finest-cell-count', '10242');
  await expect(canvas).toHaveAttribute('data-detail-instances', /^[1-9]\d*$/);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeLessThan(1.5);
  await canvas.dispatchEvent('wheel', { deltaY: 3_000 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'global');

  expect(pageErrors).toEqual([]);
});

test('close-up camera tilts smoothly while dragging stays north-up', async ({ page }) => {
  test.slow();
  await page.goto('/?world=procedural');
  const canvas = page.locator('canvas.viewport-canvas');

  await expect(canvas).toHaveAttribute('data-camera-tilt', '0.0000');
  await expect(canvas).toHaveAttribute('data-north-up', 'true');
  await zoomUntilLod(canvas, 'local', -400);
  const closeTilt = Number(await canvas.getAttribute('data-camera-tilt'));
  expect(closeTilt).toBeGreaterThan(0.1);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-north-up', 'true');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-tilt')))
    .toBeGreaterThan(0.1);
});

test('procedural terrain exposes relief and complete terrain groups', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/?world=procedural');
  const canvas = page.locator('canvas.viewport-canvas');

  await expect(canvas).toHaveAttribute('data-lod-level', 'global');
  await expect(canvas).toHaveAttribute('data-detail-instances', '0');
  await expect(canvas).toHaveAttribute('data-terrain-groups', /water/);
  await expect(canvas).toHaveAttribute('data-terrain-groups', /coast/);
  await expect(canvas).toHaveAttribute('data-terrain-groups', /forest/);
  await expect(canvas).toHaveAttribute('data-terrain-groups', /dry/);
  await expect(canvas).toHaveAttribute('data-terrain-groups', /cold/);
  await expect(canvas).toHaveAttribute('data-terrain-groups', /wetland/);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-relief-minimum')))
    .toBeLessThan(1);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-relief-maximum')))
    .toBeGreaterThan(1);

  expect(pageErrors).toEqual([]);
});

test('low-density procedural LOD stays within detail and draw-call budgets', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/?world=procedural&density=low');
  const canvas = page.locator('canvas.viewport-canvas');

  await canvas.dispatchEvent('wheel', { deltaY: -400 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'regional');
  await canvas.dispatchEvent('wheel', { deltaY: -400 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'local');
  await expect(canvas).toHaveAttribute('data-detail-instances', /^\d+$/);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-detail-draw-calls')))
    .toBeLessThanOrEqual(12);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-render-draw-calls')))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-render-draw-calls')))
    .toBeLessThanOrEqual(16);

  expect(pageErrors).toEqual([]);
});

test('low-density local relief remains closed from an oblique angle', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Visuelle Abnahme läuft im Desktop-Chromium.');
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/?world=procedural&seed=fgh&density=low');
  const canvas = page.locator('canvas.viewport-canvas');

  await zoomUntilLod(canvas, 'regional', -400);
  await zoomUntilLod(canvas, 'local', -400);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.38, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-lod-level', 'local');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-render-draw-calls')))
    .toBeLessThanOrEqual(16);
  await testInfo.attach('issue-86-low-local-podiums', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });
  expect(pageErrors).toEqual([]);
});

test('low-density relief restores the same render state after a complete LOD cycle', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/?world=procedural&seed=fgh&density=low');
  const canvas = page.locator('canvas.viewport-canvas');

  await canvas.dispatchEvent('wheel', { deltaY: -400 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'regional');
  await canvas.dispatchEvent('wheel', { deltaY: -400 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'local');
  const initialLocalState = await readProceduralRenderState(canvas);
  expect(initialLocalState.renderDrawCalls).toBeGreaterThan(0);
  expect(initialLocalState.renderDrawCalls).toBeLessThanOrEqual(16);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await canvas.dispatchEvent('wheel', { deltaY: 3_000 });
    await expect(canvas).toHaveAttribute('data-lod-level', 'global');
    await expect(canvas).toHaveAttribute('data-detail-instances', '0');
    await canvas.dispatchEvent('wheel', { deltaY: -3_000 });
    await expect(canvas).toHaveAttribute('data-lod-level', 'local');
    await expect.poll(() => readProceduralRenderState(canvas)).toEqual(initialLocalState);
  }
  expect(pageErrors).toEqual([]);
});

test('procedural controls reproduce seeds, validate density and stay inside the viewport', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/?world=procedural&seed=e2e-reference&density=low');

  const controls = page.getByTestId('procedural-controls');
  const seed = page.getByLabel('Seed');
  const density = page.getByLabel('Hex-Dichte');
  const regenerate = page.getByRole('button', { name: 'Welt neu generieren' });
  const fingerprint = page.getByTestId('procedural-fingerprint');
  await expect(controls).toBeVisible();
  await expect(seed).toHaveValue('e2e-reference');
  await expect(density).toHaveValue('low');
  await expect(page.getByTestId('procedural-cell-count')).toHaveText('162');
  const referenceFingerprint = await fingerprint.textContent();
  expect(referenceFingerprint).toMatch(/^pw1-[0-9a-f]{8}$/);

  await seed.fill('e2e-changed');
  await seed.press('Enter');
  await expect(page.getByTestId('procedural-generation-status')).toHaveText('Welt bereit');
  await expect(fingerprint).not.toHaveText(referenceFingerprint!);

  await seed.fill('e2e-reference');
  await regenerate.click();
  await expect(fingerprint).toHaveText(referenceFingerprint!);

  await density.selectOption('standard');
  await regenerate.click();
  await expect(page.getByTestId('procedural-cell-count')).toHaveText('642');
  await expect(page).toHaveURL(/seed=e2e-reference&density=standard/);
  await expect
    .poll(() =>
      controls.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.bottom <= window.innerHeight
        );
      }),
    )
    .toBe(true);

  await page.goto('/');
  await expect(page.getByTestId('procedural-controls')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
