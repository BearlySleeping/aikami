// apps/e2e/tests/pwa/lpc_visual.spec.ts
// C-054 refactored: uses guestUser fixture for visual tests.
//
// LPC Visual Testing Harness — C-050
//
// Navigates the isolated component-lite route with predefined layer
// combinations to capture reference screenshots for AI visual validation.

import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../../src/fixtures';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Base path for the LPC lite route. */
const LPC_LITE_BASE = '/dev/lpc';

/** Output directory for captured screenshots (Playwright project-relative). */
const SCREENSHOT_DIR = join('test-results', 'lpc-visual');

/** Maximum time to wait for PixiJS to render (ms). */
const PIXI_LOAD_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a URL for the LPC lite route from layer slotDefIndex:variantIndex pairs.
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

  // Signal to the PWA that this is a visual-testing capture — disables
  // animations, debug overlays, and other non-deterministic rendering.
  params.set('visual-testing', 'true');

  return `${LPC_LITE_BASE}?${params.toString()}`;
};

/**
 * Waits for the PixiJS canvas to finish rendering.
 */
const waitForPixiLoaded = async (page: Page): Promise<void> => {
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
  test.beforeEach(async ({ guestUser }) => {
    // Suppress noisy console logs during visual tests
    guestUser.on('console', () => {});

    // Hide Vite error overlay — uncaught runtime warnings can spawn a DOM
    // overlay that blocks pointer events and appears in screenshots.
    await guestUser.addStyleTag({
      content: '#vite-error-overlay, vite-error-overlay { display: none !important; }',
    });
  });

  test('bare body — single body layer at default zoom', async ({ guestUser }) => {
    const url = buildLpcUrl({
      layers: [{ slotDefIndex: 0, variantIndex: 0 }],
      frame: 0,
      zoom: 1,
    });

    await guestUser.goto(url);
    await waitForPixiLoaded(guestUser);

    await guestUser.screenshot({
      path: join(SCREENSHOT_DIR, 'bare-body.png'),
      fullPage: true,
    });

    const canvasCount = await guestUser.locator('canvas').count();
    expect(canvasCount).toBeGreaterThan(0);
  });

  test('body + head — two layers, default state', async ({ guestUser }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 },
        { slotDefIndex: 1, variantIndex: 0 },
      ],
      frame: 0,
      zoom: 1,
    });

    await guestUser.goto(url);
    await waitForPixiLoaded(guestUser);

    await guestUser.screenshot({
      path: join(SCREENSHOT_DIR, 'body-head.png'),
      fullPage: true,
    });
  });

  test('full knight — body + head + hair + plate armor + greaves + boots + sword + shield', async ({
    guestUser,
  }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 },
        { slotDefIndex: 1, variantIndex: 0 },
        { slotDefIndex: 2, variantIndex: 0 },
        { slotDefIndex: 3, variantIndex: 3 },
        { slotDefIndex: 4, variantIndex: 0 },
        { slotDefIndex: 5, variantIndex: 1 },
        { slotDefIndex: 6, variantIndex: 0 },
        { slotDefIndex: 6, variantIndex: 3 },
      ],
      frame: 0,
      zoom: 1,
    });

    await guestUser.goto(url);
    await waitForPixiLoaded(guestUser);

    await guestUser.screenshot({
      path: join(SCREENSHOT_DIR, 'full-knight.png'),
      fullPage: true,
    });
  });

  test('tinted hair — body + head + hair with colour override at zoom 2', async ({ guestUser }) => {
    const url = buildLpcUrl({
      layers: [
        { slotDefIndex: 0, variantIndex: 0 },
        { slotDefIndex: 1, variantIndex: 0 },
        { slotDefIndex: 2, variantIndex: 3 },
      ],
      paletteOverrides: {
        '2:64': 'FF44AA',
        '2:65': 'FF66CC',
        '2:66': 'CC2288',
        '0:8': '44FF44',
      },
      frame: 0,
      zoom: 2,
    });

    await guestUser.goto(url);
    await waitForPixiLoaded(guestUser);

    await guestUser.screenshot({
      path: join(SCREENSHOT_DIR, 'tinted-hair-zoom2.png'),
      fullPage: true,
    });
  });

  test('zoom scaling — knight at 0.5x, 1x, 2x, 3x', async ({ guestUser }) => {
    const knightLayers = [
      { slotDefIndex: 0, variantIndex: 0 },
      { slotDefIndex: 1, variantIndex: 0 },
      { slotDefIndex: 3, variantIndex: 3 },
      { slotDefIndex: 4, variantIndex: 0 },
    ];

    for (const zoomLevel of [0.5, 1, 2, 3]) {
      const url = buildLpcUrl({
        layers: knightLayers,
        frame: 0,
        zoom: zoomLevel,
      });

      await guestUser.goto(url);
      await waitForPixiLoaded(guestUser);

      await guestUser.screenshot({
        path: join(SCREENSHOT_DIR, `knight-zoom-${String(zoomLevel).replace('.', 'p')}.png`),
        fullPage: true,
      });
    }
  });

  test('walk cycle — key frames at facing-down', async ({ guestUser }) => {
    const playerLayers = [
      { slotDefIndex: 0, variantIndex: 0 },
      { slotDefIndex: 1, variantIndex: 0 },
      { slotDefIndex: 2, variantIndex: 2 },
      { slotDefIndex: 3, variantIndex: 0 },
      { slotDefIndex: 4, variantIndex: 0 },
    ];

    for (const frameIdx of [0, 2, 4, 6, 8]) {
      const url = buildLpcUrl({
        layers: playerLayers,
        state: 2,
        direction: 2,
        frame: frameIdx,
        zoom: 1,
      });

      await guestUser.goto(url);
      await waitForPixiLoaded(guestUser);

      await guestUser.screenshot({
        path: join(SCREENSHOT_DIR, `walk-frame-${frameIdx}.png`),
        fullPage: true,
      });
    }
  });
});
