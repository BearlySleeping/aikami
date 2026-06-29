// apps/e2e/src/visual/core/capture.ts
// Playwright screenshot capture orchestration for visual test suites.
//
// Reads declarative VisualTestSuite configs, launches Chromium,
// navigates to the configured route with search params, waits for
// the engine/canvas to be ready, and captures screenshots.
//
// Capture is always sequential — parallel capture risks corrupting
// the single WebGL context shared by Chromium headless.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';
import { chromium, type Page } from 'playwright';
import type { TSchema } from 'typebox';

// ── Types ─────────────────────────────────────────────────────

/** A single visual test case definition. */
export type VisualTestCase<T extends TSchema = TSchema> = {
  /** Human-readable name for this case. */
  name: string;
  /** Query parameters to append to the base URL. */
  searchParams?: Record<string, string>;
  /** Natural-language evaluation prompt. */
  prompt: string;
  /** TypeBox schema for structured AI output. */
  schema: T;
  /** CSS selector for the canvas element. Defaults to 'canvas'. */
  canvasSelector?: string;
  /**
   * When set, clips the screenshot to this element's bounding box
   * instead of the default 256×256 center-crop around the canvas.
   * Use 'canvas' to capture only the rendered game surface.
   */
  screenshotSelector?: string;
  /** Size of the clip region in pixels. Default: 256. */
  clipSize?: number;
  /**
   * Optional async hook executed after navigation and engine ready,
   * before screenshot capture. Use for interactive setup: clicking
   * buttons, filling forms, dragging items, etc.
   */
  setupHook?: (page: Page) => Promise<void>;
};

/** A suite of related visual test cases targeting the same route. */
export type VisualTestSuite = {
  /** Unique identifier for this suite. */
  id: string;
  /** Route path (e.g. '/dev/sandbox/map'). */
  route: string;
  /** How to wait for the engine/canvas before capturing. */
  waitCondition: 'pixi_loaded' | 'game_ready';
  /** Test cases in this suite. */
  cases: VisualTestCase[];
  /**
   * If true, injects the Playwright auth state cache (`.auth/user.json`)
   * into the browser context so protected routes can be accessed.
   * Requires the Playwright `setup` project to have been run first.
   * Default: false.
   */
  requiresAuth?: boolean;
};

/** Result of capturing a single test case. */
export type CaptureResult = {
  /** Case name. */
  name: string;
  /** Full file path of the saved screenshot. */
  filepath: string;
  /** Base64-encoded data URI of the screenshot. */
  base64DataUri: string;
  /** The prompt associated with this case. */
  prompt: string;
  /** The TypeBox schema associated with this case. */
  schema: TSchema;
  /** Error message if capture failed. */
  error?: string;
};

// ── Path resolution ──────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '../../..');
const SCREENSHOT_DIR = resolve(E2E_DIR, 'test-results', 'visual');

// ── Nix Chromium path ────────────────────────────────────────

const NIX_CHROMIUM =
  '/nix/store/bs60izw1bkvppiz6nf2m2ncgz3jshdsv-playwright-browsers/chromium-1217/chrome-linux64/chrome';

const getChromiumPath = (): string | undefined => {
  if (existsSync(NIX_CHROMIUM)) {
    return NIX_CHROMIUM;
  }
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1217/chrome-linux64/chrome`;
  }
  return undefined;
};

// ── Wait helpers ──────────────────────────────────────────────

/**
 * Waits for the PixiJS canvas to finish initializing.
 *
 * Checks `window.__PIXI_LOADED__` or `window.__GAME_READY__` signals,
 * then flushes one animation frame to ensure the WebGL canvas has composited.
 */
const _waitForPixiLoaded = async (page: Page, timeout = 15_000): Promise<void> => {
  await page.waitForFunction(
    () =>
      (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true ||
      (window as unknown as Record<string, unknown>).__GAME_READY__ === true,
    undefined,
    { timeout },
  );

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
};

/**
 * Waits for the game engine to be ready by polling the DOM.
 *
 * Checks for common engine-ready indicators (data-testid, text content).
 */
const _waitForGameReady = async (page: Page, timeout = 20_000): Promise<void> => {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="game-ready"]');
      if (el) {
        return true;
      }

      for (const span of document.querySelectorAll('span, h2')) {
        const text = span.textContent ?? '';
        if (
          text.includes('Engine Running') ||
          text.includes('Running') ||
          text.includes('INITIALIZING SUBSYSTEMS')
        ) {
          return true;
        }
      }

      return false;
    },
    undefined,
    { timeout },
  );
};

/**
 * Waits for canvas element to be visible on the page.
 */
const _waitForCanvas = async (page: Page, timeout = 20_000): Promise<void> => {
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout });
};

// ── Image optimization ────────────────────────────────────────

/**
 * Optimizes a PNG screenshot using ImageMagick.
 *
 * Strips metadata and reduces to 256-color palette PNG for smaller
 * payloads when sending to AI vision APIs.
 */
const _optimizePng = async (filepath: string): Promise<void> => {
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
const _toBase64DataUri = (filepath: string): string => {
  const buf = readFileSync(filepath);
  const b64 = buf.toString('base64');
  return `data:image/png;base64,${b64}`;
};

// ── URL builder ───────────────────────────────────────────────

/**
 * Builds the full URL for a suite route using EMULATOR_PORTS.
 *
 * Appends searchParams from the test case to the URL query string.
 */
const _buildUrl = (suites: { route: string; searchParams?: Record<string, string> }): string => {
  const base = `http://localhost:${EMULATOR_PORTS.client}${suites.route}`;

  if (!suites.searchParams || Object.keys(suites.searchParams).length === 0) {
    return base;
  }

  const params = new URLSearchParams(suites.searchParams);
  return `${base}?${params.toString()}`;
};

// ── Public API ────────────────────────────────────────────────

/**
 * Captures screenshots for all test cases in a {@link VisualTestSuite}.
 *
 * Launches a single Chromium instance per suite and captures all cases
 * sequentially to protect the WebGL rendering context.
 *
 * @returns Array of capture results (one per test case).
 */
export const captureSuite = async (suite: VisualTestSuite): Promise<CaptureResult[]> => {
  const results: CaptureResult[] = [];
  const chromiumPath = getChromiumPath();

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
  });

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1280, height: 720 },
  };

  // Inject auth state if the suite requires it
  if (suite.requiresAuth) {
    const authFile = resolve(E2E_DIR, '.auth', 'user.json');
    if (existsSync(authFile)) {
      contextOptions.storageState = authFile;
    } else {
      console.warn(
        `[capture] Suite "${suite.id}" requires auth but ${authFile} not found — continuing without auth`,
      );
    }
  }

  const context = await browser.newContext(contextOptions);

  try {
    for (const testCase of suite.cases) {
      try {
        const url = _buildUrl({
          route: suite.route,
          searchParams: testCase.searchParams,
        });

        const page = await context.newPage();
        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000,
          });

          // Only wait for canvas if the suite expects PixiJS rendering.
          // DOM-only pages (boot screen, settings, etc.) have no canvas.
          if (suite.waitCondition === 'pixi_loaded') {
            await _waitForCanvas(page);
            await _waitForPixiLoaded(page);
          } else {
            await _waitForGameReady(page);
          }

          // Extra frames for WebGL/tilemap compositing
          await page.waitForTimeout(2000);

          // Run the optional setup hook for interactive state.
          // Re-wait for page stability afterward since hooks may
          // navigate, reload, or trigger state changes.
          if (testCase.setupHook) {
            await testCase.setupHook(page);
            await page.waitForTimeout(2000);

            if (suite.waitCondition === 'pixi_loaded') {
              await _waitForPixiLoaded(page);
            } else {
              await _waitForGameReady(page);
            }
          }

          const sanitizedName = testCase.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
          const filename = `${suite.id}_${sanitizedName}.png`;
          const filepath = join(SCREENSHOT_DIR, filename);

          const canvasSelector = testCase.canvasSelector ?? 'canvas';
          const clipSize = testCase.clipSize ?? 256;
          const screenshotSelector = testCase.screenshotSelector;

          // Try bounding-box clip, fall back to full page if no element found.
          let usedClip = false;
          try {
            // When screenshotSelector is set, clip to that element's exact bounds.
            // Otherwise clip a 256×256 region centered on the canvas element.
            const targetSelector = screenshotSelector ?? canvasSelector;
            const target = page.locator(targetSelector).first();
            const box = await target.boundingBox({ timeout: 3000 });

            if (box && box.width > 0 && box.height > 0) {
              if (screenshotSelector) {
                // Clip to the target element's exact bounding box
                await page.screenshot({
                  path: filepath,
                  clip: {
                    x: Math.max(0, Math.floor(box.x)),
                    y: Math.max(0, Math.floor(box.y)),
                    width: Math.floor(box.width),
                    height: Math.floor(box.height),
                  },
                });
              } else {
                // Default: 256×256 center-crop around the canvas
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
              }
              usedClip = true;
            }
          } catch {
            // Element not found or not visible — fall through to full page
          }

          if (!usedClip) {
            await page.screenshot({ path: filepath, fullPage: true });
          }

          await _optimizePng(filepath);

          const base64DataUri = _toBase64DataUri(filepath);

          results.push({
            name: testCase.name,
            filepath,
            base64DataUri,
            prompt: testCase.prompt,
            schema: testCase.schema,
          });
        } finally {
          await page.close();
        }
      } catch (error) {
        results.push({
          name: testCase.name,
          filepath: '',
          base64DataUri: '',
          prompt: testCase.prompt,
          schema: testCase.schema,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  return results;
};

/**
 * Ensures the screenshot output directory exists.
 */
export const ensureScreenshotDir = (): string => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return SCREENSHOT_DIR;
};
