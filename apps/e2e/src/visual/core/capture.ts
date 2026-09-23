// apps/e2e/src/visual/core/capture.ts
// Playwright screenshot capture orchestration for visual test suites.
//
// Reads declarative VisualTestSuite configs, launches Chromium,
// navigates to the configured route with search params, waits for
// the engine/canvas to be ready, and captures screenshots.
//
// Capture is always sequential — parallel capture risks corrupting
// the single WebGL context shared by Chromium headless.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';

import { DEFAULT_LANCZOS_SIZE, optimizePng, resizeLanczos, toBase64DataUri } from '@scripts/ai';
import { chromium, type Locator, type Page } from 'playwright';
import type { TSchema } from 'typebox';
import { assertGpuRendererName } from './gpu_renderer_guard.ts';

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
  /**
   * C-529: crop the FULL scrollable page instead of the viewport.
   *
   * A target taller than the viewport cannot be captured by a viewport clip —
   * Playwright silently truncates the crop rather than failing, which hides the
   * lower half of the surface from the evaluator (a 200%-text settings card is
   * 1116px tall in a 720px viewport). Opt in here when the whole element must be
   * judged; leave it unset to keep the existing viewport-clip pixels.
   */
  fullPageClip?: boolean;
  /** Size of the clip region in pixels. Default: 256. */
  clipSize?: number;
  /**
   * Optional async hook executed after navigation and engine ready,
   * before screenshot capture. Use for interactive setup: clicking
   * buttons, filling forms, dragging items, etc.
   */
  setupHook?: (page: Page) => Promise<void>;
  /**
   * CSS selectors for DOM elements that should be masked before
   * screenshot capture. Elements matching these selectors are covered
   * with a solid #000 rectangle to hide non-deterministic content
   * (streaming text, AI typing indicators, particle overlays).
   *
   * Contract: C-217 — E2E visual test stabilisation
   */
  mask?: string[];
  /**
   * C-378: boolean schema fields that must be `true` for the case to
   * pass, regardless of the score. Enforced in evaluate.ts — a generous
   * score can no longer paper over a headline field (e.g.
   * `overheadOccludesPlayer`).
   */
  requiredTrueFields?: string[];
  /**
   * C-527: boolean schema fields that must be `false` for the case to pass,
   * regardless of the score.
   *
   * The mirror of `requiredTrueFields`, and required wherever a *defect flag*
   * is a hard gate: a field named `missingCriticalAction` must FAIL the case
   * when it is true, so listing it in `requiredTrueFields` inverts the gate
   * and makes a correct UI impossible to pass.
   */
  requiredFalseFields?: string[];
  /**
   * Minimum AI score for this case to pass. Defaults to the framework
   * threshold (80) — set higher (e.g. 90) for headline claims that must not
   * pass on a marginal render.
   */
  minScore?: number;
};

/** A suite of related visual test cases targeting the same route. */
export type VisualTestSuite = {
  /** Unique identifier for this suite. */
  id: string;
  /** Route path (e.g. '/dev/sandbox/map'). */
  route: string;
  /**
   * Which dev server the route lives on (C-396: the hub is an SSR app on
   * its own port). Defaults to the client.
   */
  app?: 'client' | 'hub';
  /** How to wait for the engine/canvas before capturing. */
  waitCondition: 'pixi_loaded' | 'game_ready' | 'hub_ready';
  /**
   * A selector this suite's own page renders, used instead of the shared
   * `waitCondition` heuristics.
   *
   * 🔴 `hub_ready` means "the hub *catalog* grid is up" — it polls for
   * `catalog-asset-grid`, which no other hub route renders. A hub suite on a
   * non-catalog route therefore has no honest way to say "my page is ready"
   * with the three built-in conditions, and would time out waiting for a grid
   * it never shows. Declaring a selector keeps the wait specific to the route
   * being captured instead of widening a shared helper for one suite.
   */
  waitSelector?: string;
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
  /** C-378: boolean schema fields that must be true for this case to pass. */
  requiredTrueFields?: string[];
  /** C-527: boolean schema fields that must be FALSE for this case to pass. */
  requiredFalseFields?: string[];
  /** Per-case minimum AI score (defaults to the framework threshold). */
  minScore?: number;
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
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    // Prefer the historically pinned revision, but never point at a path that
    // does not exist: a stale hard-coded revision makes `chromium.launch()`
    // fail outright ("executable doesn't exist") even though the toolchain
    // ships a perfectly good browser. Fall back to whichever `chromium-<rev>`
    // is actually present, and otherwise return undefined so Playwright
    // resolves the browser from its own browsers.json revision.
    const pinned = `${browsersPath}/chromium-1217/chrome-linux64/chrome`;
    if (existsSync(pinned)) {
      return pinned;
    }
    try {
      const chromiumDir = readdirSync(browsersPath).find((entry) => entry.startsWith('chromium-'));
      if (chromiumDir) {
        const candidate = `${browsersPath}/${chromiumDir}/chrome-linux64/chrome`;
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Unreadable browsers path — fall through to Playwright's resolution.
    }
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
    () => (window as any).__PIXI_LOADED__ === true || (window as any).__GAME_READY__ === true, // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
    undefined,
    { timeout },
  );

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
};

/** Reads the live PixiJS renderer name and applies {@link assertGpuRendererName}. */
const _assertGpuRenderer = async (page: Page, mode: 'pixi' | 'dom'): Promise<void> => {
  const renderer = await page.evaluate(() => {
    const app = (window as any).__PIXI_APP__ as { renderer?: { name?: string } } | undefined; // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
    return app?.renderer?.name ?? null;
  });
  assertGpuRendererName(renderer, mode);
};

const _captureRendererMode = async (
  page: Page,
  waitCondition: VisualTestSuite['waitCondition'],
  canvasSelector?: string,
  screenshotSelector?: string,
): Promise<'pixi' | 'dom'> =>
  waitCondition === 'pixi_loaded' ||
  screenshotSelector === (canvasSelector ?? 'canvas') ||
  (await page.locator(canvasSelector ?? 'canvas').count()) > 0
    ? 'pixi'
    : 'dom';

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

      // Persona list / character selection view (C-215)
      const personaList = document.querySelector('[data-testid="persona-list"]');
      if (personaList) {
        return true;
      }

      // Start menu / main menu (C-405 pack-picker visual suite)
      const startMenu = document.querySelector('[data-testid="start-menu"]');
      if (startMenu) {
        return true;
      }

      // Creator Studio (C-513 AC-13), the community browse surface and the
      // Settings page — DOM-only routes with no PixiJS canvas. A visual case may
      // legitimately navigate to Settings in its setup hook, and without this it
      // would wait forever for a canvas that route never renders.
      const domReady = document.querySelector(
        '[data-testid="studio-ready"], [data-testid="community-ready"], [data-testid="settings-interface"]',
      );
      if (domReady) {
        return true;
      }

      // E2E test mode — engine state exposed on window (C-217)
      const engineState = (window as any).__AIKAMI_ENGINE_STATE__ as // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
        | Record<string, unknown>
        | undefined;
      if (engineState?.frozen === true) {
        return true;
      }

      // Canvas-based pages (game sandboxes, combat, map) — wait for
      // a visible canvas element as fallback
      const canvas = document.querySelector('canvas');
      if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        return true;
      }

      // Combat sandbox (C-217) — DOM-based portrait stage, no PixiJS canvas
      const combatStage = document.querySelector('[data-testid="combat-portrait-stage"]');
      if (combatStage) {
        return true;
      }

      // Inventory sandbox (C-218) — DOM-based overlay, no PixiJS canvas
      const invHeader = document.querySelector('h2');
      if (invHeader && invHeader.textContent?.trim() === 'Inventory') {
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
// Delegated to @aikami/utils shared pipeline (C-200 AC-1).
// See packages/shared/utils/src/lib/ai/image_optimizer.ts.

// ── URL builder ───────────────────────────────────────────────

/**
 * Waits for a hub catalog page (C-396) to render: the asset grid for a
 * category page, or the detail container for an asset page.
 */
const _waitForHubReady = async (page: Page, timeout = 30_000): Promise<void> => {
  await page.waitForFunction(
    () =>
      !!document.querySelector('[data-testid="catalog-asset-grid"]') ||
      !!document.querySelector('[data-testid="catalog-asset"]'),
    undefined,
    { timeout },
  );
};
/**
 * Captures a screenshot clipped to a target element.
 *
 * C-529: `page.screenshot({ clip })` rejects a clip that lies entirely outside
 * the viewport ("Clipped area is either empty or outside the resulting image")
 * and silently TRUNCATES one that only partly fits. A target below the fold
 * therefore needs `scrollFirst`, and a target taller than the viewport needs
 * `fullPage` (which crops the scrollable page rather than the viewport).
 *
 * @throws When the target has no usable bounding box or the crop is rejected.
 * The caller logs that reason instead of hiding it behind a full-page fallback —
 * a bare `catch` is what silently downgraded three distinct contexts to
 * byte-identical screenshots.
 */
const _captureClippedScreenshot = async (options: {
  page: Page;
  filepath: string;
  selector: string;
  useExactSelector: boolean;
  clipSize: number;
  mask?: Locator[];
  scrollFirst: boolean;
  fullPage: boolean;
}): Promise<void> => {
  const { page, filepath, selector, useExactSelector, clipSize, mask, scrollFirst, fullPage } =
    options;

  const target = page.locator(selector).first();

  if (scrollFirst) {
    await target.scrollIntoViewIfNeeded({ timeout: 3000 });
  }

  const box = await target.boundingBox({ timeout: 3000 });

  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`"${selector}" has no usable bounding box`);
  }

  const scrollOffset = fullPage
    ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    : { x: 0, y: 0 };

  // When screenshotSelector is set, clip to that element's exact bounds.
  if (useExactSelector) {
    await page.screenshot({
      path: filepath,
      fullPage,
      clip: {
        x: Math.max(0, Math.floor(box.x + scrollOffset.x)),
        y: Math.max(0, Math.floor(box.y + scrollOffset.y)),
        width: Math.floor(box.width),
        height: Math.floor(box.height),
      },
      mask,
    });
    return;
  }

  // Otherwise clip a clipSize×clipSize region centered on the canvas element.
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.screenshot({
    path: filepath,
    fullPage,
    clip: {
      x: Math.max(0, Math.floor(centerX + scrollOffset.x - clipSize / 2)),
      y: Math.max(0, Math.floor(centerY + scrollOffset.y - clipSize / 2)),
      width: clipSize,
      height: clipSize,
    },
    mask,
  });
};

/**
 * Builds the full URL for a suite route using EMULATOR_PORTS.
 * Builds the full URL for a suite route using EMULATOR_PORTS.
 *
 * Always includes `screenshot=true` as a default query param.
 * Case-level `searchParams` are merged on top and can override defaults.
 */
const _buildUrl = (suites: {
  route: string;
  searchParams?: Record<string, string>;
  app?: 'client' | 'hub';
}): string => {
  const app = suites.app ?? 'client';
  const port = app === 'hub' ? EMULATOR_PORTS.hub : EMULATOR_PORTS.client;
  const base = `http://localhost:${port + Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0)}${suites.route}`;

  // Default: always request screenshot mode so the page suppresses
  // overlays, HUD, and extraneous UI that would contaminate visual diffs.
  const merged = new URLSearchParams({ screenshot: 'true' });

  if (suites.searchParams) {
    for (const [key, value] of Object.entries(suites.searchParams)) {
      merged.set(key, value);
    }
  }

  return `${base}?${merged.toString()}`;
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
    args: [
      // 🔴 WebGL is required for anything that touches the game surface. Without
      // these flags the Pixi engine falls back to Canvas2D and the production
      // combat entry path never mounts (a suite asking for the combat surface
      // then screenshots a world with no combat in it). These are the same
      // flags the Playwright `client`/`game` projects use.
      '--use-gl=angle',
      '--use-angle=gl',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
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
          app: suite.app,
        });

        const page = await context.newPage();
        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000,
          });

          // Only wait for canvas if the suite expects PixiJS rendering.
          // DOM-only pages (boot screen, settings, etc.) have no canvas.
          if (suite.waitSelector) {
            await page.waitForSelector(suite.waitSelector, { timeout: 30_000 });
          } else if (suite.waitCondition === 'pixi_loaded') {
            await _waitForCanvas(page);
            await _waitForPixiLoaded(page);
          } else if (suite.waitCondition === 'hub_ready') {
            await _waitForHubReady(page);
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

            if (suite.waitSelector) {
              await page.waitForSelector(suite.waitSelector, { timeout: 30_000 });
            } else if (suite.waitCondition === 'pixi_loaded') {
              await _waitForPixiLoaded(page);
            } else if (suite.waitCondition === 'hub_ready') {
              await _waitForHubReady(page);
            } else {
              await _waitForGameReady(page);
            }
          }

          // C-548: never capture a Canvas2D fallback — the tilemap is invisible
          // on it and the screenshot would masquerade as valid evidence.
          const mode = await _captureRendererMode(
            page,
            suite.waitCondition,
            testCase.canvasSelector,
            testCase.screenshotSelector,
          );
          await _assertGpuRenderer(page, mode);

          const sanitizedName = testCase.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
          const filename = `${suite.id}_${sanitizedName}.png`;
          const filepath = join(SCREENSHOT_DIR, filename);

          const canvasSelector = testCase.canvasSelector ?? 'canvas';
          const clipSize = testCase.clipSize ?? 256;
          const screenshotSelector = testCase.screenshotSelector;

          // ── C-217: Apply DOM element masking for non-deterministic UI ──
          // Cover elements matching the mask selectors with solid black
          // rectangles so streaming text, AI indicators, and particles
          // don't cause pixel-diff noise between runs.
          let maskLocators: Locator[] | undefined;
          if (testCase.mask && testCase.mask.length > 0) {
            maskLocators = testCase.mask.map((sel) => page.locator(sel));
          }

          // Try a bounding-box clip, falling back to a full-page screenshot only
          // when no crop can be produced at all.
          //
          // C-529: a target below the fold reports a bounding box outside the
          // 1280×720 viewport, and `page.screenshot({ clip })` then throws
          // "Clipped area is either empty or outside the resulting image". The
          // bare `catch` that used to sit here swallowed that and silently fell
          // back to `fullPage: true`, producing byte-identical evidence for three
          // genuinely distinct contexts. Scrolling the target into view fixes the
          // crop, and the reason is now logged instead of hidden.
          const targetSelector = screenshotSelector ?? canvasSelector;
          let usedClip = false;

          // `fullPageClip` cases crop the scrollable page, so no viewport retry
          // applies; everything else retries once with the target scrolled in.
          const clipAttempts = testCase.fullPageClip
            ? [{ scrollFirst: false, fullPage: true }]
            : [
                { scrollFirst: false, fullPage: false },
                { scrollFirst: true, fullPage: false },
              ];

          for (const attempt of clipAttempts) {
            try {
              await _captureClippedScreenshot({
                page,
                filepath,
                selector: targetSelector,
                useExactSelector: screenshotSelector !== undefined,
                clipSize,
                mask: maskLocators,
                ...attempt,
              });
              usedClip = true;
              break;
            } catch (error) {
              console.warn(
                `[capture] "${testCase.name}": clipped screenshot of "${targetSelector}" failed (scrollFirst=${attempt.scrollFirst}, fullPage=${attempt.fullPage}) — ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          if (!usedClip) {
            console.warn(
              `[capture] "${testCase.name}": falling back to a full-page screenshot — this evidence is NOT clipped to "${targetSelector}".`,
            );
            await page.screenshot({ path: filepath, fullPage: true });
          }

          // C-200 AC-1: Optimise + Lanczos resample via shared pipeline.
          // `fit: 'inside'` keeps the aspect ratio — squashing a tall page
          // screenshot into a square makes off-screen controls look clipped.
          await optimizePng({ filepath });
          await resizeLanczos({ filepath, width: DEFAULT_LANCZOS_SIZE, fit: 'inside' });

          const base64DataUri = toBase64DataUri(filepath);

          results.push({
            name: testCase.name,
            filepath,
            base64DataUri,
            prompt: testCase.prompt,
            schema: testCase.schema,
            requiredTrueFields: testCase.requiredTrueFields,
            requiredFalseFields: testCase.requiredFalseFields,
            minScore: testCase.minScore,
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
          requiredTrueFields: testCase.requiredTrueFields,
          requiredFalseFields: testCase.requiredFalseFields,
          minScore: testCase.minScore,
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
