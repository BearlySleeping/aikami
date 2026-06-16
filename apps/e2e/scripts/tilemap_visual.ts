// apps/e2e/scripts/tilemap_visual.ts
// C-135: Tilemap Visual Verification — standalone smoke test
//
// Launches headless Chromium, renders a 10×10 test tilemap using
// PixiJS v8 WebGL, captures a screenshot, and optionally runs AI
// evaluation.
//
// Usage:
//   bun run apps/e2e/scripts/tilemap_visual.ts
//   bun run apps/e2e/scripts/tilemap_visual.ts --capture-only
//   bun run apps/e2e/scripts/tilemap_visual.ts --eval-only
//
// Does NOT require a dev server — self-contained HTML page.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { evaluateScreenshot } from './shared/ai_eval';
import { toBase64DataUri } from './shared/screenshot';

// ── Nix Chromium path for WebGL rendering ─────────────────

const NIX_CHROMIUM =
  '/nix/store/g6hsiv17rfp7xycpgypx1r8kdvrk1jrn-playwright-chromium/chrome-linux64/chrome';

// ── Paths ────────────────────────────────────────────────

const _REPO_ROOT = resolve(import.meta.dirname, '../../..');
const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = join(E2E_DIR, 'test-results', 'tilemap-visual');
const SCREENSHOT_FILE = 'tilemap-10x10.png';
const SCREENSHOT_PATH = join(SCREENSHOT_DIR, SCREENSHOT_FILE);
const REPORT_PATH = join(SCREENSHOT_DIR, 'report.json');

// ── CLI args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');

// ── 10×10 Tiled JSON map ─────────────────────────────────

const TEST_MAP = {
  width: 10,
  height: 10,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [
    {
      firstgid: 1,
      name: 'test',
      image: 'test_tileset.png',
      imagewidth: 64,
      imageheight: 64,
      tilewidth: 32,
      tileheight: 32,
      columns: 2,
      tilecount: 4,
    },
  ],
  layers: [
    {
      name: 'ground',
      width: 10,
      height: 10,
      data: [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1,
        2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2,
        2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1,
      ],
      visible: true,
      type: 'tilelayer',
    },
    {
      name: 'collision',
      width: 10,
      height: 10,
      data: [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1,
        1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1,
      ],
      visible: true,
      type: 'tilelayer',
    },
  ],
};

// ── Inline PixiJS v8 tilemap renderer ────────────────────

/**
 * Generates a self-contained HTML page that renders a tilemap
 * using PixiJS v8 from jsDelivr CDN.
 */
const buildTilemapHtml = (): string => {
  const mapJson = JSON.stringify(TEST_MAP);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>C-135 Tilemap Visual Test</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; display: flex; justify-content: center; align-items: center; height: 100vh; }
  #game-canvas { width: 800px; height: 600px; }
</style>
</head>
<body>
<canvas id="game-canvas"></canvas>
<script type="importmap">
{
  "imports": {
    "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs"
  }
}
</script>
<script type="module">
  import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

  // ── Test map data ──────────────────────────
  const MAP = ${mapJson};

  // ── Color palette for tile types ───────────
  const TILE_COLORS = {
    0: 0x000000,   // empty (transparent)
    1: 0x1a472a,   // floor — dark green
    2: 0x4a3728,   // wall — brown
  };

  // ── Create PixiJS app ─────────────────────
  const canvas = document.getElementById('game-canvas');
  const app = new Application();
  await app.init({
    canvas,
    width: 800,
    height: 600,
    backgroundColor: 0x1a1a2e,
    antialias: false,
    preference: 'webgl',
    preserveDrawingBuffer: true,
  });

  // ── Build tile textures ───────────────────
  // Create a tiny 32x32 texture per tile color
  const tileTextures = new Map();
  for (const [gid, color] of Object.entries(TILE_COLORS)) {
    if (Number(gid) === 0) continue;
    const gfx = new Graphics();
    gfx.rect(0, 0, 32, 32);
    gfx.fill(color);
    // Add subtle 1px border to detect seam bleeding
    gfx.rect(0.5, 0.5, 31, 31);
    gfx.stroke({ width: 1, color: 0x000000, alpha: 0.15 });
    const texture = app.renderer.generateTexture(gfx);
    tileTextures.set(Number(gid), texture);
    gfx.destroy();
  }

  // ── Render map layers ─────────────────────
  const mapContainer = new Container();
  mapContainer.label = 'tilemap';

  // Calculate centering offset
  const mapPixelWidth = MAP.width * MAP.tilewidth;
  const mapPixelHeight = MAP.height * MAP.tileheight;
  const offsetX = Math.floor((800 - mapPixelWidth) / 2);
  const offsetY = Math.floor((600 - mapPixelHeight) / 2);

  for (const layer of MAP.layers) {
    if (layer.name === 'collision') continue;
    if (!layer.visible) continue;

    const layerContainer = new Container();
    layerContainer.label = layer.name;

    for (let row = 0; row < layer.height; row++) {
      for (let col = 0; col < layer.width; col++) {
        const index = row * layer.width + col;
        const gid = layer.data[index];
        if (gid === 0) continue;

        const texture = tileTextures.get(gid);
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = offsetX + col * MAP.tilewidth;
        sprite.y = offsetY + row * MAP.tileheight;
        sprite.width = MAP.tilewidth;
        sprite.height = MAP.tileheight;
        layerContainer.addChild(sprite);
      }
    }

    mapContainer.addChild(layerContainer);
  }

  app.stage.addChild(mapContainer);

  // Signal that rendering is complete
  window.__PIXI_LOADED__ = true;
  console.log('[tilemap] Rendered', MAP.width, 'x', MAP.height, 'tilemap');
</script>
</body>
</html>`;
};

// ── Step 1: Capture ───────────────────────────────────────

if (!evalOnly) {
  console.log('📸 Step 1/2: Capturing tilemap visual screenshot...\n');

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined,
  });
  const page = await browser.newPage();

  try {
    // Set viewport to match canvas size
    await page.setViewportSize({ width: 800, height: 600 });

    // Load the self-contained HTML page
    const html = buildTilemapHtml();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Wait for PixiJS to signal readiness
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__PIXI_LOADED__ === true,
      undefined,
      { timeout: 15_000 },
    );

    // Extra frames for WebGL to composite
    await page.waitForTimeout(500);

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`   ✅ Screenshot saved: ${SCREENSHOT_PATH}\n`);
  } catch (error) {
    console.error('   ❌ Capture failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// ── Step 2: AI evaluation ─────────────────────────────────

if (!captureOnly) {
  console.log('🔍 Step 2/2: Running AI visual evaluation...\n');

  if (!existsSync(SCREENSHOT_PATH)) {
    console.error(`❌ Screenshot not found: ${SCREENSHOT_PATH}`);
    console.error('   Run without --eval-only to capture first.');
    process.exit(1);
  }

  const imageDataUri = toBase64DataUri(SCREENSHOT_PATH);

  const tilemapPrompt = [
    'This is a screenshot of a 10x10 tilemap from a game engine visual test (C-135).',
    'The map has a border of darker wall tiles and lighter floor tiles in the interior.',
    'Rate this image on a scale of 0 to 100 based on:',
    '- Is a 10x10 grid of tiles visible on the dark background?',
    '- Are there no visible gaps/seams between adjacent tiles (no "seam bleeding")?',
    '- Is the grid centered on the canvas?',
    '- Do the wall tiles (darker) form a clear border around lighter floor tiles?',
    '- Are there exactly 10 columns and 10 rows of tiles?',
    '',
    'Return ONLY a JSON object matching this schema:',
    '{"score": number, "gridVisible": boolean, "noSeamBleeding": boolean, "notes": string, "issues": string[]}',
  ].join('\n');

  try {
    const result = await evaluateScreenshot({
      imageDataUri,
      prompt: tilemapPrompt,
    });

    console.log(`   Score: ${result.score}/100`);
    console.log(`   Grid visible: ${result.gridVisible}`);
    console.log(`   No seam bleeding: ${result.noSeamBleeding}`);
    console.log(`   Notes: ${result.notes}`);
    if (result.issues && result.issues.length > 0) {
      console.log('   Issues:');
      for (const issue of result.issues) {
        console.log(`     - ${issue}`);
      }
    }

    // Save report
    writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2));

    if (result.score < 50) {
      console.log('\n⚠️  Score below threshold (50).');
      process.exit(1);
    }
  } catch (error) {
    console.error('   ❌ AI evaluation failed:', error);
    process.exit(1);
  }
}

console.log('\n✅ Tilemap visual smoke complete.');
console.log(`   Screenshot: ${SCREENSHOT_PATH}`);
if (!captureOnly) {
  console.log(`   Report:     ${REPORT_PATH}`);
}
