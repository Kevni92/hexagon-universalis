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
