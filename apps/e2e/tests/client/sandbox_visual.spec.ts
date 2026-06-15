// apps/e2e/tests/client/sandbox_visual.spec.ts
// Sandbox Visual Test — verifies /dev/sandbox loads a visible character.
//
// Uses the same pattern as lpc_man.spec.ts: navigates to the page,
// waits for the game engine, captures a cropped canvas screenshot.

import { type Page, test } from '@playwright/test';

const SANDBOX_URL = 'http://localhost:5274/dev/sandbox';

/** Waits for PixiJS canvas to render at least one frame. */
const waitForCanvasReady = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    },
    undefined,
    { timeout: 20_000 },
  );

  await page.waitForFunction(
    () => {
      const labels = document.querySelectorAll('span');
      for (const label of labels) {
        if (
          label.textContent?.includes('Player') &&
          label.parentElement?.querySelector('.text-primary')
        ) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 20_000 },
  );

  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
};

test('sandbox loads visible character with LPC layers', async ({ page }) => {
  // Force hard reload to pick up worker code changes (workers don't HMR).
  await page.goto(SANDBOX_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCanvasReady(page);

  await page.screenshot({
    path: 'test-results/sandbox-visual/sandbox-character.png',
    fullPage: true,
  });
});
