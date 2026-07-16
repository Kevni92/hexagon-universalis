import { expect, test } from '@playwright/test';

test('mobile viewport does not overflow horizontally', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible();
});
