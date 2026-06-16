// apps/e2e/scripts/map_sandbox_eval.ts
// Map & Zoning Sandbox — visual evaluation with sprite rendering checks.
//
// Validates that entities render as LPC sprites (not tinted rectangles)
// by checking for APPEARANCE_CHANGED events and sampling canvas pixel colors.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const SCREENSHOT_DIR = resolve(import.meta.dirname, '../test-results/map-sandbox');
const BASE_URL = 'http://localhost:5274';
const MAP_SANDBOX_URL = `${BASE_URL}/dev/sandbox/map?skip-onboarding`;

const CHROMIUM_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1217/chrome-linux64/chrome`
  : undefined;

// Tint colors for rectangles (should NOT be dominant)
const RECT_GREEN = { r: 0, g: 255, b: 136 }; // Player tint 0xff88
const RECT_GOLD = { r: 255, g: 204, b: 0 }; // NPC tint 0xffcc00
const RECT_WHITE = { r: 255, g: 255, b: 255 }; // Prop tint 0xffffff

const colorDistance = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

const waitForEngineReady = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      for (const l of document.querySelectorAll('span')) {
        if (l.textContent?.includes('Running')) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 30_000 },
  );
};

const waitForZone = async (page: import('playwright').Page, zoneName: string): Promise<void> => {
  await page.waitForFunction(
    (name) => {
      for (const l of document.querySelectorAll('span')) {
        if (l.textContent?.includes(name)) {
          return true;
        }
      }
      return false;
    },
    zoneName,
    { timeout: 30_000 },
  );
};

/**
 * Collects console logs matching a pattern.
 */
const collectConsoleLogs = (page: import('playwright').Page, pattern: RegExp): string[] => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (pattern.test(text)) {
      logs.push(text);
    }
  });
  return logs;
};

// ── Main ───────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('[map-sandbox-eval] Launching browser...');
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const results: string[] = [];
  let failed = false;

  const testZone = async (zone: 'a' | 'b'): Promise<void> => {
    console.log(`\n[map-sandbox-eval] === Zone ${zone.toUpperCase()} ===`);
    const page = await context.newPage();

    // Collect LPC-related logs
    const diagnosticLogs = collectConsoleLogs(page, /appearance-changed|lpc-loaded|lpc-load-error/);

    await page.goto(`${MAP_SANDBOX_URL}&zone=${zone}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });

    // Check 1: Canvas
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await canvas.boundingBox();
    const hasCanvas = box !== null && box.width > 0 && box.height > 0;
    console.log(`  canvas: ${box?.width ?? 0}×${box?.height ?? 0}  ${hasCanvas ? '✅' : '❌'}`);
    results.push(`zone_${zone} canvas: ${hasCanvas ? 'PASS' : 'FAIL'}`);
    if (!hasCanvas) {
      failed = true;
    }

    // Check 2: Engine running
    await waitForEngineReady(page);
    const engineRunning = await page.evaluate(() => {
      for (const l of document.querySelectorAll('span')) {
        if (l.textContent?.includes('Running')) {
          return true;
        }
      }
      return false;
    });
    console.log(`  engine: ${engineRunning ? '✅' : '❌'}`);
    results.push(`zone_${zone} engine: ${engineRunning ? 'PASS' : 'FAIL'}`);

    // Check 3: Zone indicator
    await waitForZone(page, `sandbox_zone_${zone}`);
    console.log(`  zone indicator: ✅`);

    // Wait extra time for LPC textures to load (async PixiJS Assets.load)
    await page.waitForTimeout(3000);

    // Check 4: LPC texture loading (appearance-changed + lpc-loaded)
    const appearanceChanges = diagnosticLogs.filter((l) => l.includes('appearance-changed'));
    const lpcLoaded = diagnosticLogs.filter((l) => l.includes('lpc-loaded'));
    const lpcErrors = diagnosticLogs.filter((l) => l.includes('lpc-load-error'));
    console.log(`  appearance-changed: ${appearanceChanges.length} events`);
    console.log(`  lpc-loaded: ${lpcLoaded.length} entities`);
    const hasAppearance = appearanceChanges.length > 0;
    const hasLpcLoaded = lpcLoaded.length > 0;
    const hasLpcErrors = lpcErrors.length > 0;
    results.push(`zone_${zone} appearance: ${hasAppearance ? 'PASS' : 'FAIL'}`);
    results.push(`zone_${zone} lpc-loaded: ${hasLpcLoaded ? 'PASS' : 'FAIL'}`);
    if (!hasAppearance) {
      failed = true;
    }
    if (!hasLpcLoaded) {
      failed = true;
    }
    if (hasLpcErrors) {
      console.log(`  LPC load errors: ❌ (${lpcErrors.length})`);
      for (const e of lpcErrors.slice(0, 3)) {
        console.log(`    ${e.slice(0, 120)}`);
      }
      results.push(`zone_${zone} lpc-errors: FAIL`);
      failed = true;
    } else {
      console.log(`  LPC load errors: ✅`);
      results.push(`zone_${zone} lpc-errors: PASS`);
    }

    // Check 6: Screenshot + rectangle color detection
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, `zone_${zone}.png`), fullPage: true });

    // Sample few pixels across the canvas to check if any match rectangle tints
    const canvasPixels = await page.evaluate(() => {
      const cvs = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cvs) {
        return null;
      }
      // Create a temporary 2d canvas to read the WebGL canvas
      const tmp = document.createElement('canvas');
      tmp.width = cvs.width;
      tmp.height = cvs.height;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) {
        return null;
      }
      tmpCtx.drawImage(cvs, 0, 0);
      const samples: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];
      const w = cvs.width,
        h = cvs.height;
      for (let i = 0; i < 20; i++) {
        const x = Math.floor(Math.random() * w);
        const y = Math.floor(Math.random() * h);
        const d = tmpCtx.getImageData(x, y, 1, 1).data;
        samples.push({ x, y, r: d[0], g: d[1], b: d[2] });
      }
      return samples;
    });

    if (canvasPixels) {
      let greenCount = 0,
        goldCount = 0,
        whiteCount = 0;
      for (const px of canvasPixels) {
        if (colorDistance(px, RECT_GREEN) < 30) {
          greenCount++;
        }
        if (colorDistance(px, RECT_GOLD) < 30) {
          goldCount++;
        }
        if (colorDistance(px, RECT_WHITE) < 5) {
          whiteCount++;
        }
      }
      const hasRectangles = greenCount > 2 || goldCount > 2; // green=player, gold=NPC
      console.log(
        `  rectangle detection: green=${greenCount} gold=${goldCount} white=${whiteCount} (${hasRectangles ? '❌ still rectangles' : '✅ no tint rectangles'})`,
      );
      results.push(`zone_${zone} rectangles: ${hasRectangles ? 'FAIL' : 'PASS'}`);
      if (hasRectangles) {
        failed = true;
      }
    } else {
      console.log(`  rectangle detection: no canvas pixels ❌`);
      results.push(`zone_${zone} rectangles: FAIL`);
      failed = true;
    }

    // Show entity count
    const entityInfo = await page.evaluate(() => {
      const spans = document.querySelectorAll('span');
      for (const s of spans) {
        if (s.textContent?.includes('visible')) {
          return s.textContent;
        }
      }
      return 'unknown';
    });
    console.log(`  entity info: ${entityInfo}`);

    await page.close();
  };

  try {
    await testZone('a');
    await testZone('b');

    console.log('\n[map-sandbox-eval] ===== RESULTS =====');
    for (const r of results) {
      console.log(`  ${r}`);
    }
    console.log(`\n  screenshots: ${SCREENSHOT_DIR}/`);
    if (failed) {
      console.log('\n[map-sandbox-eval] ❌ SOME CHECKS FAILED');
      process.exitCode = 1;
    } else {
      console.log('\n[map-sandbox-eval] ✅ ALL CHECKS PASSED');
    }
  } catch (err) {
    console.error('[map-sandbox-eval] Error:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
};

main();
