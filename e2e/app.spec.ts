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
    'Prozedurale Testwelt – künstliche Geografie',
  );
  const canvas = page.locator('canvas.viewport-canvas');
  await expect(canvas).toHaveAttribute('data-lod-level', 'global');

  await canvas.hover();
  await page.mouse.wheel(0, -400);
  await expect(canvas).toHaveAttribute('data-lod-level', 'regional');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeGreaterThan(2);
  await page.mouse.wheel(0, -650);
  await expect(canvas).toHaveAttribute('data-lod-level', 'local', { timeout: 15_000 });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-camera-distance')))
    .toBeLessThan(1.5);
  await page.mouse.wheel(0, 3_000);
  await expect(canvas).toHaveAttribute('data-lod-level', 'global');

  expect(pageErrors).toEqual([]);
});
