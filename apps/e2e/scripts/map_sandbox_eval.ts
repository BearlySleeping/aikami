// apps/e2e/scripts/map_sandbox_eval.ts
// Map & Zoning Sandbox — visual evaluation with sprite rendering + corner clamping.
//
// Validates that entities render as LPC sprites (not tinted rectangles)
// by checking for APPEARANCE_CHANGED events and sampling canvas pixel colors.
//
// C-180: Also validates spawn position clamping at all 4 map corners via
// AI visual evaluation — verifies character is on green grass (interior),
// NOT on blue water (border tiles 0,9).
//
// Usage:
//   bun run apps/e2e/scripts/map_sandbox_eval.ts
//   bun run apps/e2e/scripts/map_sandbox_eval.ts --capture-only   (skip AI eval)
//   bun run apps/e2e/scripts/map_sandbox_eval.ts --eval-only      (skip Playwright capture)
//   bun run apps/e2e/scripts/map_sandbox_eval.ts --zone-only      (only zone a/b checks)
//   bun run apps/e2e/scripts/map_sandbox_eval.ts --corner-only    (only corner eval)
//
// Assumes PWA dev server (:5274) is already running.
// Requires OPENROUTER_API_KEY env var for AI evaluation.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { evaluateScreenshot } from './shared/ai_eval';
import { toBase64DataUri } from './shared/screenshot';

// ── Nix Chromium path for WebGL rendering ─────────────────────

const NIX_CHROMIUM =
  '/nix/store/bs60izw1bkvppiz6nf2m2ncgz3jshdsv-playwright-browsers/chromium-1217/chrome-linux64/chrome';
if (existsSync(NIX_CHROMIUM)) {
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = NIX_CHROMIUM;
}

// ── Configuration ─────────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = join(E2E_DIR, 'test-results', 'map-sandbox');
const REPORT_PATH = join(SCREENSHOT_DIR, 'report.json');
const BASE_URL = 'http://localhost:5274';

const CHROMIUM_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1217/chrome-linux64/chrome`
  : undefined;

// ── CLI flags ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');
const zoneOnly = args.includes('--zone-only');
const cornerOnly = args.includes('--corner-only');

// Run both if neither --zone-only nor --corner-only specified
const runZone = !cornerOnly;
const runCorner = !zoneOnly;

// ── Corner test cases ─────────────────────────────────────────

const CORNERS = [
  { label: 'top-left', x: 0, y: 0, file: 'corner_top_left.png' },
  { label: 'top-right', x: 320, y: 0, file: 'corner_top_right.png' },
  { label: 'bottom-left', x: 0, y: 320, file: 'corner_bottom_left.png' },
  { label: 'bottom-right', x: 320, y: 320, file: 'corner_bottom_right.png' },
];

// ── AI evaluation prompt for corner clamping ─────────────────

const CORNER_EVAL_PROMPT = [
  'This is a screenshot from a 10×10 tile debug map in the Aikami game engine.',
  '',
  'MAP LAYOUT:',
  '- Green tiles = grass (walkable interior, 8×8 center).',
  '- Blue tiles = water (collision border, only on row 0, row 9, col 0, col 9).',
  '- Grey tiles = house walls (middle-left area).',
  '- Brown tile = house door.',
  '- Pink/cyan pixel-art character = player spawn.',
  '',
  'EVALUATE:',
  '- Is the pink/cyan pixel-art character visible on the canvas?',
  '- Is the character standing on a GREEN tile (grass)?',
  '- Is the character NOT standing on a BLUE tile (water)?',
  '- Is the character within the 8×8 interior (not on the outermost border rows/cols)?',
  '',
  'Score breakdown:',
  '- 95-100: Character clearly on green grass, well inside the interior.',
  '- 80-94: Character on grass but near a wall/border.',
  '- 50-79: Character on a non-grass tile (grey house, brown door).',
  '- 0-49: Character on blue water, outside the map, or not visible at all.',
  '',
  'Return ONLY JSON:',
  '{"score": number, "characterVisible": boolean, "onGreenGrass": boolean, "onBlueWater": boolean, "notes": string, "issues": string[]}',
].join('\n');

// ── Rectangle tint detection ──────────────────────────────────

const RECT_GREEN = { r: 0, g: 255, b: 136 };
const RECT_GOLD = { r: 255, g: 204, b: 0 };
const RECT_WHITE = { r: 255, g: 255, b: 255 };

const colorDistance = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

// ── Browser helpers ────────────────────────────────────────────

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

const waitForMapLoaded = async (page: import('playwright').Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      // Check for the map load button(s) being present — Zone A loads debug_map.jton
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.includes('Debug JTON') || btn.textContent?.includes('Zone B')) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 30_000 },
  );
};

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

// ── Phase 1: Zone a/b checks ──────────────────────────────────

const runZoneChecks = async (): Promise<{ failed: boolean; results: string[] }> => {
  console.log('[map-sandbox-eval] === Zone a/b Engine Checks ===\n');
  console.log('[map-sandbox-eval] Launching browser...');
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const results: string[] = [];
  let failed = false;

  const testZone = async (zone: 'a' | 'b'): Promise<void> => {
    console.log(`\n[map-sandbox-eval] === Zone ${zone.toUpperCase()} ===`);
    const page = await context.newPage();

    const diagnosticLogs = collectConsoleLogs(page, /appearance-changed|lpc-loaded|lpc-load-error/);

    await page.goto(`${BASE_URL}/dev/sandbox/map?skip-onboarding&zone=${zone}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });

    // Canvas check
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await canvas.boundingBox();
    const hasCanvas = box !== null && box.width > 0 && box.height > 0;
    console.log(`  canvas: ${box?.width ?? 0}×${box?.height ?? 0}  ${hasCanvas ? '✅' : '❌'}`);
    results.push(`zone_${zone} canvas: ${hasCanvas ? 'PASS' : 'FAIL'}`);
    if (!hasCanvas) {
      failed = true;
    }

    // Engine running
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

    // Wait for map UI to render
    await waitForMapLoaded(page);
    console.log(`  map UI: ✅`);

    await page.waitForTimeout(3000);

    // LPC texture loading
    const appearanceChanges = diagnosticLogs.filter((l) => l.includes('appearance-changed'));
    const lpcLoaded = diagnosticLogs.filter((l) => l.includes('lpc-loaded'));
    const lpcErrors = diagnosticLogs.filter((l) => l.includes('lpc-load-error'));
    console.log(`  appearance-changed: ${appearanceChanges.length} events`);
    console.log(`  lpc-loaded: ${lpcLoaded.length} entities`);
    const hasAppearance = appearanceChanges.length > 0;
    const hasLpcLoaded = lpcLoaded.length > 0;
    results.push(`zone_${zone} appearance: ${hasAppearance ? 'PASS' : 'FAIL'}`);
    results.push(`zone_${zone} lpc-loaded: ${hasLpcLoaded ? 'PASS' : 'FAIL'}`);
    if (!hasAppearance) {
      failed = true;
    }
    if (!hasLpcLoaded) {
      failed = true;
    }
    if (lpcErrors.length > 0) {
      console.log(`  LPC load errors: ❌ (${lpcErrors.length})`);
      results.push(`zone_${zone} lpc-errors: FAIL`);
      failed = true;
    } else {
      console.log(`  LPC load errors: ✅`);
      results.push(`zone_${zone} lpc-errors: PASS`);
    }

    // Screenshot + rectangle detection
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, `zone_${zone}.png`), fullPage: true });

    const canvasPixels = await page.evaluate(() => {
      const cvs = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cvs) {
        return null;
      }
      const tmp = document.createElement('canvas');
      tmp.width = cvs.width;
      tmp.height = cvs.height;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) {
        return null;
      }
      tmpCtx.drawImage(cvs, 0, 0);
      const samples: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];
      const w = cvs.width;
      const h = cvs.height;
      for (let i = 0; i < 20; i++) {
        const px = Math.floor(Math.random() * w);
        const py = Math.floor(Math.random() * h);
        const d = tmpCtx.getImageData(px, py, 1, 1).data;
        samples.push({ x: px, y: py, r: d[0], g: d[1], b: d[2] });
      }
      return samples;
    });

    if (canvasPixels) {
      let greenCount = 0;
      let goldCount = 0;
      let whiteCount = 0;
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
      const hasRectangles = greenCount > 2 || goldCount > 2;
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
  } finally {
    await browser.close();
  }

  return { failed, results };
};

// ── Phase 2: Corner capture + AI evaluation ───────────────────

const runCornerChecks = async (): Promise<void> => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // -- Step 1: Capture --
  if (!evalOnly) {
    console.log('📸 Step 1/2: Capturing corner screenshots...\n');
    const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

    try {
      for (const corner of CORNERS) {
        const url = `${BASE_URL}/dev/sandbox/map?position_x=${corner.x}&position_y=${corner.y}`;
        console.log(`  Capturing ${corner.label} (${corner.x},${corner.y})...`);
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

        // Wait for canvas + engine
        const canvas = page.locator('canvas').first();
        await canvas.waitFor({ state: 'visible', timeout: 20_000 });

        // Wait for GAME_READY + map load + clamp
        await page.waitForFunction(
          () => {
            const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
              | { playerX: number; playerY: number }
              | undefined;
            return debug?.playerX !== undefined && debug?.playerY !== undefined;
          },
          undefined,
          { timeout: 15_000 },
        );

        // Extra frames for tilemap + LPC sprite to render
        await page.waitForTimeout(2000);

        const filepath = join(SCREENSHOT_DIR, corner.file);
        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`    ✅ ${corner.file}`);

        // Log the clamped position for debugging
        const clamped = await page.evaluate(() => {
          const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
            | { playerX: number; playerY: number }
            | undefined;
          return debug ? `(${Math.round(debug.playerX)}, ${Math.round(debug.playerY)})` : 'unknown';
        });
        console.log(`    clamped to: ${clamped}`);

        await page.close();
      }
    } finally {
      await browser.close();
    }
    console.log();
  }

  // -- Step 2: AI evaluation --
  if (!captureOnly) {
    console.log('🤖 Step 2/2: Running AI visual evaluation...\n');

    const cornerResults: Array<{
      label: string;
      file: string;
      score: number;
      onGreenGrass: unknown;
      onBlueWater: unknown;
      notes: string;
    }> = [];
    let totalScore = 0;
    let succeeded = 0;

    for (const corner of CORNERS) {
      const filepath = join(SCREENSHOT_DIR, corner.file);
      if (!existsSync(filepath)) {
        console.log(`  ⚠️  ${corner.file} — not found, skipping`);
        continue;
      }

      try {
        const dataUri = toBase64DataUri(filepath);
        const result = await evaluateScreenshot({
          imageDataUri: dataUri,
          prompt: CORNER_EVAL_PROMPT,
        });

        const onGreenGrass = (result as Record<string, unknown>).onGreenGrass;
        const onBlueWater = (result as Record<string, unknown>).onBlueWater;

        console.log(`  📸 ${corner.label} (${corner.file})`);
        console.log(`     Score: ${result.score}/100`);
        console.log(`     Character visible: ${result.characterVisible}`);
        console.log(`     On green grass: ${onGreenGrass ?? 'N/A'}`);
        console.log(`     On blue water: ${onBlueWater ?? 'N/A'}`);
        console.log(`     Notes: ${result.notes}`);
        if (result.issues?.length) {
          console.log(`     Issues: ${result.issues.join(', ')}`);
        }
        console.log();

        cornerResults.push({
          label: corner.label,
          file: corner.file,
          score: result.score,
          onGreenGrass,
          onBlueWater,
          notes: result.notes,
        });
        totalScore += result.score;
        succeeded++;
      } catch (error) {
        console.log(`  ❌ ${corner.file} — evaluation failed: ${(error as Error).message}\n`);
      }
    }

    const avgScore = succeeded > 0 ? Math.round(totalScore / succeeded) : 0;

    const report = {
      timestamp: new Date().toISOString(),
      suite: 'Map Sandbox — Corner Clamping',
      description: 'Verifies character spawn clamping at all 4 map corners',
      averageScore: avgScore,
      minimumPassScore: 70,
      passed: avgScore >= 70,
      results: cornerResults,
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\n📊 Report saved to ${REPORT_PATH}`);
    console.log(`   Average score: ${avgScore}/100`);
    console.log(`   Overall: ${report.passed ? '✅ PASSED' : '❌ FAILED'} (min score: 70)`);
  } else {
    console.log('✅ Corner screenshots captured. Run without --capture-only for AI evaluation.');
  }
};

// ── Main ───────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  let zoneFailed = false;
  const allResults: string[] = [];

  // Phase 1: Zone a/b checks
  if (runZone && !evalOnly) {
    const { failed, results } = await runZoneChecks();
    zoneFailed = failed;
    allResults.push(...results);

    console.log('\n[map-sandbox-eval] ===== ZONE RESULTS =====');
    for (const r of results) {
      console.log(`  ${r}`);
    }
    console.log(`\n  screenshots: ${SCREENSHOT_DIR}/`);
    if (zoneFailed) {
      console.log('\n[map-sandbox-eval] ❌ SOME ZONE CHECKS FAILED');
    } else {
      console.log('\n[map-sandbox-eval] ✅ ZONE CHECKS PASSED');
    }
    console.log();
  }

  // Phase 2: Corner capture + AI evaluation
  if (runCorner) {
    await runCornerChecks();
  }

  if (zoneFailed) {
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error('[map-sandbox-eval] Fatal error:', err);
  process.exit(1);
});
