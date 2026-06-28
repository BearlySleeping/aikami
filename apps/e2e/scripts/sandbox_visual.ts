// apps/e2e/scripts/sandbox_visual.ts
// Sandbox Visual Smoke Test — orchestrates Playwright capture + AI evaluation.
//
// Verifies that /dev/sandbox loads a visible character on the game canvas.
//
// Usage:
//   bun run apps/e2e/scripts/sandbox_visual.ts
//   bun run apps/e2e/scripts/sandbox_visual.ts --capture-only   (skip AI evaluation)
//   bun run apps/e2e/scripts/sandbox_visual.ts --eval-only      (skip Playwright capture)
//
// Assumes PWA dev server (:5274) is already running.

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { evaluateScreenshot } from './shared/ai_eval';
import { toBase64DataUri } from './shared/screenshot';

// Nix flake provides Playwright browsers at a fixed store path.
// Use the full Chromium (not headless_shell) for WebGL rendering.
const NIX_CHROMIUM =
  '/nix/store/bs60izw1bkvppiz6nf2m2ncgz3jshdsv-playwright-browsers/chromium-1217/chrome-linux64/chrome';
if (existsSync(NIX_CHROMIUM)) {
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = NIX_CHROMIUM;
}

// ── Configuration ─────────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = join(E2E_DIR, 'test-results', 'sandbox-visual');
const SCREENSHOT_FILE = 'sandbox-character.png';
const SCREENSHOT_PATH = join(SCREENSHOT_DIR, SCREENSHOT_FILE);
const REPORT_PATH = join(SCREENSHOT_DIR, 'report.json');

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');

// ── Step 1: Playwright capture ────────────────────────────────

if (!evalOnly) {
  console.log('📸 Step 1/2: Capturing sandbox screenshot via Playwright...\n');

  // Use the same Playwright test infrastructure as lpc_smoke.
  // Run the client-visual project which matches sandbox_visual.spec.ts.
  const result = await $`bunx playwright test --project=client-visual --grep sandbox`
    .cwd(E2E_DIR)
    .nothrow();

  if (result.exitCode !== 0) {
    console.log('⚠️  Playwright capture had failures.');
  }

  if (existsSync(SCREENSHOT_PATH)) {
    console.log(`   ✅ Screenshot saved: ${SCREENSHOT_PATH}`);
  } else {
    console.log('   ❌ Screenshot file not found after capture.');
    console.log('   Check that the PWA dev server is running on :5274');
  }

  console.log();
}

// ── Step 2: AI evaluation ─────────────────────────────────────

if (!captureOnly) {
  console.log('🔍 Step 2/2: Running AI visual evaluation...\n');

  if (!existsSync(SCREENSHOT_PATH)) {
    console.error(`❌ Screenshot not found: ${SCREENSHOT_PATH}`);
    console.error('   Run without --eval-only to capture first.');
    process.exit(1);
  }

  const imageDataUri = toBase64DataUri(SCREENSHOT_PATH);

  const sandboxPrompt = [
    'This is a screenshot from the Aikami game engine sandbox (/dev/sandbox).',
    'Rate this image on a scale of 0 to 100 based on:',
    '- Is there a visible pixel-art LPC character with full layers (body, head, hair, legs)?',
    '- Is the character approximately centered on the canvas?',
    '- Is the dark background visible?',
    '- Is there a toolbar bar at the top?',
    '',
    'Return ONLY a JSON object matching this schema:',
    '{"score": number, "characterVisible": boolean, "notes": string, "issues": string[]}',
  ].join('\n');

  try {
    const result = await evaluateScreenshot({
      imageDataUri,
      prompt: sandboxPrompt,
    });

    console.log(`   Score: ${result.score}/100`);
    console.log(`   Character visible: ${result.characterVisible}`);
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

console.log('\n✅ Sandbox visual smoke complete.');
console.log(`   Screenshot: ${SCREENSHOT_PATH}`);
if (!captureOnly) {
  console.log(`   Report:     ${REPORT_PATH}`);
}
