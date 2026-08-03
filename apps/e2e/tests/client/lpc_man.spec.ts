import { type Page, test } from '@playwright/test';

// C-372: extended with zero-console-error + zero-failed-LPC-request assertions
// to guard the manifest-resolved production path (no decodeAudioData failures,
// no /src/lib/assets/ references, no failed /game-data/lpc/ fetches).

const URL =
  'http://localhost:5274/dev/lpc?l0=1%3A3&l1=0%3A94&l2=2%3A18&l3=3%3A1&l4=6%3A110&l5=7%3A30&l6=8%3A16&zoom=0.7&visual-testing=true';

const waitForPixiLoaded = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true,
    undefined,
    { timeout: 15000 },
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
};

test('man with orange buzzcut', async ({ page }) => {
  // ── C-372: failure/error tracking ────────────────────────────────────
  const consoleErrors: string[] = [];
  const failedLpcRequests: string[] = [];
  const srcLibAssetRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('/game-data/lpc/')) {
      failedLpcRequests.push(url);
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400 && url.includes('/game-data/lpc/')) {
      failedLpcRequests.push(`${url} :: HTTP ${res.status()}`);
    }
    if (url.includes('/src/lib/assets/')) {
      srcLibAssetRequests.push(url);
    }
  });

  await page.goto(URL);
  await waitForPixiLoaded(page);

  // C-372: the LPC character must compose — the canvas must contain
  // non-background pixels (WebGL readPixels; a blank canvas reads 0).
  // readPixels is timing-sensitive (preserveDrawingBuffer: false), so poll
  // for up to ~3s until the composited frame is visible.
  const nonBackgroundPixels = await page.evaluate(async () => {
    const countPixels = (): number => {
      const canvas = document.querySelector('canvas');
      if (!canvas) {
        return -1;
      }
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] ?? 0;
          const g = pixels[i + 1] ?? 0;
          const b = pixels[i + 2] ?? 0;
          // Skip fully-transparent and background-color (0x0d0d1a) pixels
          if (!(r === 0 && g === 0 && b === 0) && !(r === 13 && g === 13 && b === 26)) {
            count++;
          }
        }
        return count;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const a = data[i + 3] ?? 0;
          if (a > 0 && !(r === 13 && g === 13 && b === 26)) {
            count++;
          }
        }
        return count;
      }
      return -1;
    };

    for (let attempt = 0; attempt < 12; attempt++) {
      const count = countPixels();
      if (count > 100) {
        return count;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return countPixels();
  });

  test.expect(nonBackgroundPixels, 'canvas must render LPC layers').toBeGreaterThan(100);
  // C-372: the page must be console-error-free. Assert the complete error
  // collection is empty (not just decode/404 substrings) so unrelated
  // TypeError / manifest-resolver errors also fail the test.
  test.expect(consoleErrors, 'no console errors').toEqual([]);
  test.expect(failedLpcRequests, 'no failed /game-data/lpc/ requests').toEqual([]);
  test.expect(srcLibAssetRequests, 'no /src/lib/assets/ requests').toEqual([]);

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
