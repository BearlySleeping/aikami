// apps/e2e/scripts/lpc_smoke.ts
// C-073: LPC Visual Smoke Pipeline — captures screenshots and runs AI evaluation.
//
// Assumes PWA dev server (localhost:5274) is already running.
// For the full lifecycle script (start PWA → capture → evaluate → stop), use:
//   bun run apps/e2e/scripts/run_lpc_smoke_full.ts
//
// Usage:
//   bun run apps/e2e/scripts/lpc_smoke.ts
//   bun run apps/e2e/scripts/lpc_smoke.ts --capture-only   (skip AI evaluation)
//   bun run apps/e2e/scripts/lpc_smoke.ts --eval-only      (skip Playwright capture)
//   bun run apps/e2e/scripts/lpc_smoke.ts --recapture      (force re-capture, skip cache)

import { $ } from 'bun';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Configuration ──────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = join(E2E_DIR, 'test-results', 'lpc-visual');
const VALIDATION_SCRIPT = join(REPO_ROOT, 'scripts/src/lib/ops/validate_lpc_visuals.ts');
const PWA_PORT = 5274;

// ── Parse args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');
const recapture = args.includes('--recapture');

/** Check whether existing screenshots are present in the output dir. */
const hasExistingScreenshots = (): boolean =>
  existsSync(SCREENSHOT_DIR) && readdirSync(SCREENSHOT_DIR).some((f) => f.endsWith('.png'));

// ── Health check ───────────────────────────────────────────

const checkPwaRunning = async (): Promise<boolean> => {
  try {
    const res = await fetch(`http://localhost:${PWA_PORT}/`, { signal: AbortSignal.timeout(2000) });
    return true; // Any response (even 404) means the server is up
  } catch {
    return false;
  }
};

// ── Step 1: Playwright capture ─────────────────────────────

if (!evalOnly) {
  const skipCapture = hasExistingScreenshots() && !recapture;

  if (skipCapture) {
    console.log('📸 Step 1/2: Screenshots already exist — skipping capture.');
    console.log('   Use --recapture to force re-capture.\n');
  } else {
    console.log('📸 Step 1/2: Capturing LPC visual screenshots...\n');

    if (!(await checkPwaRunning())) {
      console.error(`❌ PWA dev server not reachable at http://localhost:${PWA_PORT}/`);
      console.error('   Start it first:');
      console.error('     bun moon run pwa:dev');
      console.error('   Or run the full lifecycle script:');
      console.error('     bun run apps/e2e/scripts/run_lpc_smoke_full.ts');
      process.exit(1);
    }

    const result = await $`bunx playwright test --project=pwa-visual`.cwd(E2E_DIR).nothrow();

    if (result.exitCode !== 0) {
      console.log('⚠️  Playwright capture had failures.');
    }

    // Verify screenshots were written
    if (existsSync(SCREENSHOT_DIR)) {
      const files = readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith('.png'));
      console.log(`\n   ${files.length} screenshot(s) written to ${SCREENSHOT_DIR}`);
      for (const f of files) {
        console.log(`   • ${f}`);
      }
    } else {
      console.log('\n⚠️  Screenshot directory not found. Check PWA dev server is running.');
    }

    console.log();
  }
}

// ── Step 2: AI evaluation ──────────────────────────────────

if (!captureOnly) {
  console.log('🔍 Step 2/2: Running AI visual evaluation...\n');

  // Bun $ inherits the parent process env — OPENROUTER_API_KEY must be set
  const result = await $`bun run ${VALIDATION_SCRIPT}`.cwd(REPO_ROOT).nothrow();

  if (result.exitCode !== 0) {
    console.log('\n⚠️  Some configurations scored below threshold.');
    process.exit(1);
  }
}

console.log('\n✅ LPC smoke pipeline complete.');
console.log(`   Screenshots: ${SCREENSHOT_DIR}`);
console.log(`   Report:      ${join(SCREENSHOT_DIR, 'report.json')}`);
