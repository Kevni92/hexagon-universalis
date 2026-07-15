import { expect, test, type Locator } from '@playwright/test';

type LodFocusState = {
  readonly focusDirection: string | null;
  readonly regionalParents: string | null;
  readonly localParents: string | null;
  readonly finestUnitKeys: string | null;
  readonly finestCellCount: number;
  readonly focusAngle: number;
};

async function zoomUntilLocal(canvas: Locator): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    if ((await canvas.getAttribute('data-lod-level')) === 'local') return;
    await canvas.dispatchEvent('wheel', { deltaY: -400 });
    await canvas.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await expect(canvas).toHaveAttribute('data-lod-level', 'local', { timeout: 20_000 });
}

async function readFocusState(canvas: Locator): Promise<LodFocusState> {
  return {
    focusDirection: await canvas.getAttribute('data-lod-focus-direction'),
    regionalParents: await canvas.getAttribute('data-lod-regional-parents'),
    localParents: await canvas.getAttribute('data-lod-local-parents'),
    finestUnitKeys: await canvas.getAttribute('data-lod-finest-unit-keys'),
    finestCellCount: Number(await canvas.getAttribute('data-lod-finest-cell-count')),
    focusAngle: Number(await canvas.getAttribute('data-lod-focus-angle')),
  };
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
  await zoomUntilLocal(canvas);
  await expect(canvas).toHaveAttribute('data-lod-local-parents', /\d+:\d+/);

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

  for (const deltaY of [20, 20, -20, -20]) {
    await canvas.dispatchEvent('wheel', { deltaY });
    await canvas.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(canvas).toHaveAttribute('data-lod-level', 'local');
    const current = await readFocusState(canvas);
    expect(current.focusDirection).toBe(reference.focusDirection);
    expect(current.regionalParents).toBe(reference.regionalParents);
    expect(current.localParents).toBe(reference.localParents);
    expect(current.finestUnitKeys).toBe(reference.finestUnitKeys);
    expect(current.finestCellCount).toBe(reference.finestCellCount);
    expect(current.focusAngle).toBeLessThan(0.2);
  }

  await testInfo.attach('issue-88-high-local-zoom-end', {
    body: await page.screenshot({ clip: box }),
    contentType: 'image/png',
  });
  expect(pageErrors).toEqual([]);
});
