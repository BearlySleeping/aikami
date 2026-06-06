// apps/frontend/pwa/tests/lpc_visual.spec.ts

import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// LPC Visual Testing Harness — C-050
//
// Navigates the isolated component-lite route with predefined layer
// combinations to capture reference screenshots for AI visual validation.
//
// Screenshots land in: test-results/lpc-visual/
// ---------------------------------------------------------------------------

/** Base path for the LPC lite route. */
const LPC_LITE_BASE = '/dev/lpc/component-lite';

/** Output directory for captured screenshots (Playwright project-relative). */
const SCREENSHOT_DIR = join('test-results', 'lpc-visual');

/** Maximum time to wait for PixiJS to render (ms). */
const PIXI_LOAD_TIMEOUT = 15000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a URL for the LPC lite route from layer slotDefIndex:variantIndex pairs.
 *
 * @param options - Configuration for the test URL.
 * @returns A full pathname + search string.
 */
const buildLpcUrl = (options: {
  layers: Array<{ slotDefIndex: number; variantIndex: number }>;
  paletteOverrides?: Record<string, string>;
  state?: number;
  direction?: number;
  frame?: number;
  zoom?: number;
}): string => {
  const params = new URLSearchParams();

  for (let i = 0; i < options.layers.length; i++) {
    const layer = options.layers[i];
    if (layer === undefined) {
      continue;
    }
    params.set(`l${i}`, `${layer.slotDefIndex}:${layer.variantIndex}`);
  }

  if (options.paletteOverrides) {
    for (const [key, hex] of Object.entries(options.paletteOverrides)) {
      params.set(`p${key}`, hex);
    }
  }

  if (options.state !== undefined) {
    params.set('state', String(options.state));
  }
  if (options.direction !== undefined) {
    params.set('dir', String(options.direction));
  }
  if (options.frame !== undefined) {
    params.set('frame', String(options.frame));
  }
  if (options.zoom !== undefined) {
    params.set('zoom', String(options.zoom));
  }

  return `${LPC_LITE_BASE}?${params.toString()}`;
};

/**
 * Waits for the PixiJS canvas to finish rendering.
 *
 * Polls `window.__PIXI_LOADED__` which is set by the lite route's
 * `$effect` after the character container is added to the stage.
 */
const waitForPixiLoaded = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true,
    undefined,
    { timeout: PIXI_LOAD_TIMEOUT },
  );

  // Extra frame to ensure canvas flush
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('LPC Visual Testing Harness', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress noisy console logs during visual tests
    page.on('console', () => {});
  });

  // -----------------------------------------------------------------------
  // TC1: Bare body only
  // -----------------------------------------------------------------------

  test('bare body — single body layer at default zoom', async ({ page }) => {
    const url = buildLpcUrl({
      layers: [{ slotDefIndex: 0, variantIndex: 0 }], // body: humanoid male light
      frame: 0,
      zoom: 1,
    });

    await page.goto(url);
    await waitForPixiLoaded(page);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'bare-body.png'),
      fullPage: true,
    });

    // Verify canvas rendered (non-empty)
    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // TC2: Body + Head
  // -----------------------------------------------------------------------

  test('body + head — two layers, default state', async ({ page }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 }, // body: humanoid male light
        { slotDefIndex: 1, variantIndex: 0 }, // head: human male light
      ],
      frame: 0,
      zoom: 1,
    });

    await page.goto(url);
    await waitForPixiLoaded(page);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'body-head.png'),
      fullPage: true,
    });
  });

  // -----------------------------------------------------------------------
  // TC3: Heavily layered knight
  // -----------------------------------------------------------------------

  test('full knight — body + head + hair + plate armor + greaves + boots + sword + shield', async ({
    page,
  }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 }, // body: humanoid male light
        { slotDefIndex: 1, variantIndex: 0 }, // head: human male light
        { slotDefIndex: 2, variantIndex: 0 }, // hair: mohawk
        { slotDefIndex: 3, variantIndex: 3 }, // torso: plate armor
        { slotDefIndex: 4, variantIndex: 0 }, // legs: plate greaves
        { slotDefIndex: 5, variantIndex: 1 }, // feet: plate boots
        { slotDefIndex: 6, variantIndex: 0 }, // weapon: broadsword
        { slotDefIndex: 6, variantIndex: 3 }, // weapon: shield (second weapon layer)
      ],
      frame: 0,
      zoom: 1,
    });

    await page.goto(url);
    await waitForPixiLoaded(page);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'full-knight.png'),
      fullPage: true,
    });
  });

  // -----------------------------------------------------------------------
  // TC4: Tinted hair / eyes — palette colour override
  // -----------------------------------------------------------------------

  test('tinted hair — body + head + hair with colour override at zoom 2', async ({ page }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 }, // body: humanoid male light
        { slotDefIndex: 1, variantIndex: 0 }, // head: human male light
        { slotDefIndex: 2, variantIndex: 3 }, // hair: short crop
      ],
      paletteOverrides: {
        // Override hair palette index 64 (primary hair color) to bright pink
        '2:64': 'FF44AA',
        '2:65': 'FF66CC',
        '2:66': 'CC2288',
        // Override body palette index 8 (eye color) to bright green
        '0:8': '44FF44',
      },
      frame: 0,
      zoom: 2,
    });

    await page.goto(url);
    await waitForPixiLoaded(page);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'tinted-hair-zoom2.png'),
      fullPage: true,
    });
  });

  // -----------------------------------------------------------------------
  // TC5: Zoom scaling validation — same config at different zoom levels
  // -----------------------------------------------------------------------

  test('zoom scaling — knight at 0.5x, 1x, 2x, 3x', async ({ page }) => {
    const knightLayers = [
      { slotDefIndex: 0, variantIndex: 0 },
      { slotDefIndex: 1, variantIndex: 0 },
      { slotDefIndex: 3, variantIndex: 3 }, // plate armor
      { slotDefIndex: 4, variantIndex: 0 }, // plate greaves
    ];

    for (const zoomLevel of [0.5, 1, 2, 3]) {
      const url = buildLpcUrl({
        layers: knightLayers,
        frame: 0,
        zoom: zoomLevel,
      });

      await page.goto(url);
      await waitForPixiLoaded(page);

      await page.screenshot({
        path: join(SCREENSHOT_DIR, `knight-zoom-${String(zoomLevel).replace('.', 'p')}.png`),
        fullPage: true,
      });
    }
  });

  // -----------------------------------------------------------------------
  // TC6: Animation frame verification — walk cycle at different frames
  // -----------------------------------------------------------------------

  test('walk cycle — key frames at facing-down', async ({ page }) => {
    const playerLayers = [
      { slotDefIndex: 0, variantIndex: 0 }, // body
      { slotDefIndex: 1, variantIndex: 0 }, // head
      { slotDefIndex: 2, variantIndex: 2 }, // hair: curly afro
      { slotDefIndex: 3, variantIndex: 0 }, // torso: chainmail
      { slotDefIndex: 4, variantIndex: 0 }, // legs: plate greaves
    ];

    // State=Walk (2), Direction=Down (2)
    for (const frameIdx of [0, 2, 4, 6, 8]) {
      const url = buildLpcUrl({
        layers: playerLayers,
        state: 2, // Walk
        direction: 2, // Down
        frame: frameIdx,
        zoom: 1,
      });

      await page.goto(url);
      await waitForPixiLoaded(page);

      await page.screenshot({
        path: join(SCREENSHOT_DIR, `walk-frame-${frameIdx}.png`),
        fullPage: true,
      });
    }
  });
});
