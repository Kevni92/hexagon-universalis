import { expect, test } from '@playwright/test';

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
    await page.mouse.wheel(0, -200); // hineinzoomen, verfeinert Chunks
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 400); // wieder herauszoomen, vergröbert Chunks
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

  await canvas.dispatchEvent('wheel', { deltaY: -400 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'regional');
  await expect(lodOutput).toHaveText('Regional');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeGreaterThan(2);
  await canvas.dispatchEvent('wheel', { deltaY: -650 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'local', { timeout: 15_000 });
  await expect(lodOutput).toHaveText('Lokal');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeLessThan(1.5);
  await canvas.dispatchEvent('wheel', { deltaY: 3_000 });
  await expect(canvas).toHaveAttribute('data-lod-level', 'global');

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
