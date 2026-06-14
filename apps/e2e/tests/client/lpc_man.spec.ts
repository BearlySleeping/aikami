import { test, type Page } from '@playwright/test';

const URL = 'http://localhost:5274/dev/lpc?l0=1%3A3&l1=0%3A94&l2=2%3A18&l3=3%3A1&l4=6%3A110&l5=7%3A30&l6=8%3A16&zoom=0.7&visual-testing=true';

const waitForPixiLoaded = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true,
    undefined,
    { timeout: 15000 },
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
};

test('man with orange buzzcut', async ({ page }) => {
  await page.goto(URL);
  await waitForPixiLoaded(page);

  // Crop to the canvas element centered on the character
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();

  if (box) {
    const size = 256;
    const clip = {
      x: box.x + box.width / 2 - size / 2,
      y: box.y + box.height / 2 - size / 2,
      width: size,
      height: size,
    };
    await page.screenshot({
      path: 'test-results/lpc-visual/man-debug.png',
      clip,
    });
  } else {
    await page.screenshot({
      path: 'test-results/lpc-visual/man-debug.png',
      fullPage: true,
    });
  }
});
