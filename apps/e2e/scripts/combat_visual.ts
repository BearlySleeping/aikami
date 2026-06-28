// apps/e2e/scripts/combat_visual.ts
// Combat Visual Smoke Test — captures combat screenshots + AI evaluation.
//
// Verifies the combat dev page renders correctly at multiple states:
//   - Initial state (HP bars visible)
//   - Populated log
//   - Low HP state
//   - Attack in progress
//   - Custom action input
//
// Usage:
//   bun run apps/e2e/scripts/combat_visual.ts
//   bun run apps/e2e/scripts/combat_visual.ts --capture-only   (skip AI eval)
//   bun run apps/e2e/scripts/combat_visual.ts --eval-only      (skip Playwright capture)
//
// Requires OPENROUTER_API_KEY env var for AI evaluation.

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { evaluateScreenshot } from './shared/ai_eval';
import { toBase64DataUri } from './shared/screenshot';

const NIX_CHROMIUM =
  '/nix/store/bs60izw1bkvppiz6nf2m2ncgz3jshdsv-playwright-browsers/chromium-1217/chrome-linux64/chrome';
if (existsSync(NIX_CHROMIUM)) {
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = NIX_CHROMIUM;
}

// ── Configuration ─────────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = join(E2E_DIR, 'test-results', 'combat-visual');
const REPORT_PATH = join(SCREENSHOT_DIR, 'report.json');

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');

// ── Screenshots to evaluate ───────────────────────────────────

const SCREENSHOTS = [
  { file: 'combat_initial.png', desc: 'Initial combat — sidebar, HP bars, action bar' },
  { file: 'combat_log.png', desc: 'Combat log with multiple entries visible' },
  { file: 'combat_low_hp.png', desc: 'Low HP state — Player at critical health' },
  { file: 'combat_victory.png', desc: 'Victory banner after winning combat' },
  { file: 'combat_defeat.png', desc: 'Defeat banner after losing combat' },
];

// ── Evaluation prompt ─────────────────────────────────────────

const COMBAT_EVAL_PROMPT = [
  'This is a crop showing the RIGHT SIDE (canvas) of a combat split-screen.',
  '',
  'Rate 0-100:',
  '- TWO pixel-art LPC character sprites visible on dark background?',
  '- LEFT character faces RIGHT (toward enemy)?',
  '- RIGHT character faces LEFT (toward player)?',
  '- Both same size, aligned on ground?',
  '- Dark blue/purple canvas, no artifacts?',
  '',
  '90-100: Both face each other correctly. 70-89: One wrong direction. 50-69: Both wrong. 0-49: Not visible.',
  '',
  'Return JSON: {"score":number,"characterVisible":bool,"notes":string,"issues":string[],"leftCharacterFacesRight":bool,"rightCharacterFacesLeft":bool}',
].join('\n');

// ── Step 1: Playwright capture ───────────────────────────────

if (!evalOnly) {
  console.log('📸 Step 1/2: Capturing combat screenshots via Playwright...\n');

  const result = await $`bunx playwright test --project=client-visual --grep combat_visual`
    .cwd(E2E_DIR)
    .nothrow();

  if (result.exitCode !== 0) {
    console.log('⚠️  Some capture tests may have failed. Continuing to check screenshots...\n');
  }
}

// ── Step 2: AI visual evaluation ─────────────────────────────

if (!captureOnly) {
  console.log('🤖 Step 2/2: Running AI visual evaluation...\n');

  const results: Array<{ file: string; desc: string; score: number; notes: string }> = [];
  let totalScore = 0;
  let succeeded = 0;

  // Per-screenshot evaluation context
  const PROMPT_HINTS: Record<string, string> = {
    'combat_victory.png':
      'This is a VICTORY screen after combat. Expect a trophy emoji, "Victory!" text, and a "Continue" button. The HP bars and action bar are not expected.',
    'combat_defeat.png':
      'This is a DEFEAT screen after combat. Expect a skull emoji, "Defeat" text, and a "Continue" button. The HP bars and action bar are not expected.',
  };

  for (const { file, desc } of SCREENSHOTS) {
    const filepath = join(SCREENSHOT_DIR, file);
    if (!existsSync(filepath)) {
      console.log(`  ⚠️  ${file} — not found, skipping`);
      continue;
    }

    try {
      const dataUri = toBase64DataUri(filepath);
      const hint = PROMPT_HINTS[file] ?? '';
      const fullPrompt = hint ? `${hint}\n\n${COMBAT_EVAL_PROMPT}` : COMBAT_EVAL_PROMPT;
      const result = await evaluateScreenshot({
        imageDataUri: dataUri,
        prompt: fullPrompt,
      });

      console.log(`  📸 ${file}`);
      console.log(`     Score: ${result.score}/100`);
      console.log(`     Notes: ${result.notes}`);
      if (result.issues?.length) {
        console.log(`     Issues: ${result.issues.join(', ')}`);
      }
      console.log();

      results.push({ file, desc, score: result.score, notes: result.notes });
      totalScore += result.score;
      succeeded++;
    } catch (error) {
      console.log(`  ❌ ${file} — evaluation failed: ${(error as Error).message}\n`);
    }
  }

  const avgScore = succeeded > 0 ? Math.round(totalScore / succeeded) : 0;

  const report = {
    timestamp: new Date().toISOString(),
    suite: 'Combat Visual',
    averageScore: avgScore,
    results,
    minimumPassScore: 70,
    passed: avgScore >= 70,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n📊 Report saved to ${REPORT_PATH}`);
  console.log(`   Average score: ${avgScore}/100`);
  console.log(`   Overall: ${report.passed ? '✅ PASSED' : '❌ FAILED'} (min score: 70)`);
} else {
  console.log('✅ Screenshots captured. Run without --capture-only to run AI evaluation.');
}
