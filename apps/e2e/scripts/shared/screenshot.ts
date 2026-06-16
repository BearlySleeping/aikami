// apps/e2e/scripts/shared/screenshot.ts
// Shared screenshot capture utilities for visual testing scripts.
//
// Handles Playwright canvas capture, image optimization via
// ImageMagick, and base64 encoding for AI evaluation.

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';

// ── Path resolution ──────────────────────────────────────────

const _REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const E2E_DIR = resolve(import.meta.dirname, '../..');

/** Default output directory for visual test screenshots. */
export const DEFAULT_SCREENSHOT_DIR = resolve(E2E_DIR, 'test-results', 'visual');

// ── Types ─────────────────────────────────────────────────────

export type CaptureOptions = {
  /** Playwright page to capture from. */
  page: Page;
  /** Output filename (e.g. 'sandbox-character.png'). */
  filename: string;
  /** Output directory. Defaults to DEFAULT_SCREENSHOT_DIR. */
  outputDir?: string;
  /** CSS selector for the canvas element. Defaults to 'canvas'. */
  canvasSelector?: string;
  /** Maximum wait time for PixiJS to load (ms). Default: 15_000. */
  loadTimeout?: number;
  /** Size of the clip region in pixels. Default: 256. */
  clipSize?: number;
  /** Whether to optimize the image with ImageMagick. Default: true. */
  optimize?: boolean;
};

// ── Public API ────────────────────────────────────────────────

/**
 * Waits for the PixiJS canvas to finish initializing.
 *
 * Checks `window.__PIXI_LOADED__` or `window.__GAME_READY__` signals.
 * After the signal, flushes one animation frame to ensure the WebGL
 * canvas has composited.
 */
export const waitForPixiLoaded = async (page: Page, timeout = 15_000): Promise<void> => {
  await page.waitForFunction(
    () =>
      (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true ||
      (window as unknown as Record<string, unknown>).__GAME_READY__ === true,
    undefined,
    { timeout },
  );

  // Flush one rAF so the WebGL canvas composites the final frame
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
};

/**
 * Waits for the game engine to be ready by polling the DOM.
 *
 * Checks for the "Engine Running" or "isGameReady" indicator.
 * Useful when PixiJS doesn't set __PIXI_LOADED__.
 */
export const waitForEngineReady = async (page: Page, timeout = 20_000): Promise<void> => {
  const deadline = Date.now() + timeout;
  let ready = false;

  while (Date.now() < deadline && !ready) {
    ready = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="game-ready"]');
      if (el) {
        return true;
      }
      // Fallback: check engine running indicator text
      const labels = document.querySelectorAll('span');
      for (const label of labels) {
        if (label.textContent?.includes('Engine Running')) {
          return true;
        }
      }
      return false;
    });
    if (!ready) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
};

/**
 * Captures a cropped screenshot centered on the canvas element.
 *
 * Uses page-level `.screenshot()` with a `clip` rectangle for tight
 * character close-ups. The clip is positioned in page coordinates
 * centered on the canvas element.
 *
 * @returns The full file path of the saved screenshot.
 */
export const captureCanvas = async (options: CaptureOptions): Promise<string> => {
  const {
    page,
    filename,
    outputDir = DEFAULT_SCREENSHOT_DIR,
    canvasSelector = 'canvas',
    loadTimeout = 15_000,
    clipSize = 256,
    optimize = true,
  } = options;

  mkdirSync(outputDir, { recursive: true });
  const filepath = resolve(outputDir, filename);

  await waitForPixiLoaded(page, loadTimeout);

  // Try bounding-box clip first
  const canvas = page.locator(canvasSelector).first();
  const box = await canvas.boundingBox();

  if (box && box.width > 0 && box.height > 0) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.screenshot({
      path: filepath,
      clip: {
        x: Math.max(0, Math.floor(cx - clipSize / 2)),
        y: Math.max(0, Math.floor(cy - clipSize / 2)),
        width: clipSize,
        height: clipSize,
      },
    });
  } else {
    // Fallback: full page
    await page.screenshot({ path: filepath, fullPage: true });
  }

  // Optimize with ImageMagick if available
  if (optimize) {
    await optimizePng(filepath);
  }

  return filepath;
};

/**
 * Optimizes a PNG screenshot using ImageMagick.
 *
 * Strips metadata, reduces to 256-color palette PNG for smaller
 * payloads when sending to AI vision APIs.
 */
export const optimizePng = async (filepath: string): Promise<void> => {
  try {
    const { $ } = await import('bun');
    await $`convert ${filepath} -strip -colors 256 PNG8:${filepath}`.quiet().nothrow();
  } catch {
    // ImageMagick not available — skip optimization
  }
};

/**
 * Reads a PNG file and returns its base64-encoded data URI.
 */
export const toBase64DataUri = (filepath: string): string => {
  const buf = readFileSync(filepath);
  const b64 = buf.toString('base64');
  return `data:image/png;base64,${b64}`;
};

/**
 * Creates the screenshot output directory if it doesn't exist.
 */
export const ensureScreenshotDir = (dir = DEFAULT_SCREENSHOT_DIR): string => {
  mkdirSync(dir, { recursive: true });
  return dir;
};
