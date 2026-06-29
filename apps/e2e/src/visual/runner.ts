// apps/e2e/src/visual/runner.ts
// AI Visual Testing Framework — CLI entry point.
//
// Dynamically loads all *.visual.ts suite files from suites/,
// captures screenshots sequentially (to protect WebGL context),
// evaluates non-cached images in parallel via OpenRouter, and
// generates a static HTML report.
//
// Usage:
//   bun run apps/e2e/src/visual/runner.ts
//   bun run apps/e2e/src/visual/runner.ts --capture-only
//   bun run apps/e2e/src/visual/runner.ts --eval-only
//   bun run apps/e2e/src/visual/runner.ts --suite map
//
// Assumes the PWA dev server (EMULATOR_PORTS.client) is running.
// Requires OPENROUTER_API_KEY env var for AI evaluation.

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMULATOR_PORTS } from '@aikami/constants';
import type { CaptureResult, VisualTestSuite } from './core/capture';
import { captureSuite } from './core/capture';
import { type EvaluateResult, evaluateImage } from './core/evaluate';
import { buildReportEntry, generateReport, type ReportEntry } from './core/report';

// ── CLI flags ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const evalOnly = args.includes('--eval-only');
const suiteFilter = args.find((a) => a.startsWith('--suite='))?.split('=')[1];

/** Maximum concurrent OpenRouter API calls to avoid 429 rate limits. */
const MAX_CONCURRENT_EVALS = 5;

// ── Dynamic suite loading ─────────────────────────────────────

const SUITES_DIR = resolve(import.meta.dirname, 'suites');

/**
 * Discovers and loads all visual test suite files from the suites directory.
 *
 * Each file must export a `VisualTestSuite` (either named or default).
 * Files matching the pattern `*.visual.ts` are loaded.
 */
const loadSuites = async (): Promise<VisualTestSuite[]> => {
  const suites: VisualTestSuite[] = [];

  if (!readdirSync(SUITES_DIR, { recursive: false })) {
    return suites;
  }

  const files = readdirSync(SUITES_DIR).filter((f) => f.endsWith('.visual.ts'));

  for (const file of files) {
    const modulePath = resolve(SUITES_DIR, file);

    try {
      // Dynamic import of the suite module.
      // Suites use `export default defineConfig(...)` — the default export
      // may be a static VisualTestSuite or a function that returns one.
      const mod = (await import(modulePath)) as {
        default?:
          | VisualTestSuite
          | ((options: { env: typeof process.env }) => VisualTestSuite | Promise<VisualTestSuite>);
      };

      let suite: VisualTestSuite | undefined;
      const raw = mod.default;

      if (!raw) {
        // Fallback: look for named exports (legacy pattern)
        for (const key of Object.keys(mod)) {
          const value = (mod as Record<string, unknown>)[key];
          if (
            value &&
            typeof value === 'object' &&
            'id' in (value as Record<string, unknown>) &&
            'cases' in (value as Record<string, unknown>)
          ) {
            suite = value as VisualTestSuite;
            break;
          }
        }
      } else if (typeof raw === 'function') {
        // Dynamic config function — execute with env context
        suite = await raw({ env: process.env });
      } else {
        // Static config object
        suite = raw;
      }

      if (suite) {
        if (suiteFilter && suite.id !== suiteFilter) {
          continue;
        }

        suites.push(suite);
        console.log(
          `[runner] Loaded suite: ${suite.id} (${suite.cases.length} cases) from ${file}`,
        );
      }
    } catch (error) {
      console.error(`[runner] Failed to load suite from ${file}:`, (error as Error).message);
    }
  }

  return suites;
};

// ── Pre-flight check ──────────────────────────────────────────

/**
 * Checks that the PWA dev server is reachable before running any suites.
 *
 * Exits with code 1 if the server is unreachable, printing clear
 * instructions on how to start it.
 */
const checkClientRunning = async (): Promise<void> => {
  const url = `http://localhost:${EMULATOR_PORTS.client}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok || response.status < 500) {
      console.log(`[runner] ✅ Client dev server reachable at ${url}`);
      return;
    }
  } catch {
    // fall through to error
  }

  console.error(`[runner] ❌ Client dev server unreachable at ${url}`);
  console.error('[runner]');
  console.error('[runner] Start the client before running visual tests:');
  console.error('[runner]   bun moon run client:dev');
  console.error('[runner]   or: tmux_session start client');
  process.exit(1);
};

// ── Entry point ────────────────────────────────────────────────

const main = async (): Promise<void> => {
  console.log('[runner] Aikami AI Visual Testing Framework\n');

  await checkClientRunning();

  const suites = await loadSuites();

  if (suites.length === 0) {
    console.log('[runner] No visual test suites found.');
    console.log(`[runner] Suites directory: ${SUITES_DIR}`);
    console.log('[runner] Place *.visual.ts files in suites/ to run tests.');
    process.exit(0);
  }

  // ── Step 1: Capture ─────────────────────────────────────────
  const allCaptures: CaptureResult[] = [];

  if (!evalOnly) {
    console.log('[runner] 📸 Step 1: Capturing screenshots...\n');

    for (const suite of suites) {
      console.log(`[runner]   Suite "${suite.id}" — capturing ${suite.cases.length} cases...`);
      const results = await captureSuite(suite);

      let successCount = 0;
      for (const r of results) {
        if (!r.error) {
          successCount++;
        }
      }

      console.log(`[runner]   ✅ ${successCount}/${results.length} captured successfully\n`);
      allCaptures.push(...results);
    }
  }

  // ── Step 2: Evaluate ────────────────────────────────────────
  const allEvalResults: Array<{ capture: CaptureResult; evaluate: EvaluateResult }> = [];

  if (!captureOnly) {
    console.log('[runner] 🤖 Step 2: Evaluating screenshots via AI...\n');

    if (allCaptures.length === 0) {
      console.log(
        '[runner]   No captures to evaluate. Run without --capture-only first, or use --eval-only with existing screenshots.',
      );
    } else {
      // Separate captures into cached (skip) and non-cached (evaluate)
      const evalPromises: Array<Promise<{ capture: CaptureResult; evaluate: EvaluateResult }>> = [];

      for (const capture of allCaptures) {
        if (capture.error) {
          // Capture failed — skip evaluation
          allEvalResults.push({
            capture,
            evaluate: {
              caseName: capture.name,
              passed: false,
              error: `Capture failed: ${capture.error}`,
              fromCache: false,
            },
          });
          continue;
        }

        evalPromises.push(
          (async () => {
            console.log(`[runner]   Evaluating: ${capture.name}...`);
            const evaluate = await evaluateImage({
              imageDataUri: capture.base64DataUri,
              prompt: capture.prompt,
              schema: capture.schema,
            });

            if (evaluate.passed) {
              const cacheLabel = evaluate.fromCache ? ' (📦 cached)' : '';
              console.log(`[runner]     ✅ ${evaluate.score ?? '?'}/100${cacheLabel}`);
            } else if (evaluate.score !== undefined) {
              console.log(`[runner]     ❌ ${evaluate.score}/100 (below threshold)`);
            } else {
              console.log(`[runner]     ❌ ${evaluate.error ?? 'Unknown error'}`);
            }

            return { capture, evaluate };
          })(),
        );
      }

      // Run evaluations with bounded concurrency to avoid OpenRouter 429 rate limits.
      // Process in chunks of MAX_CONCURRENT_EVALS at a time.
      for (let i = 0; i < evalPromises.length; i += MAX_CONCURRENT_EVALS) {
        const chunk = evalPromises.slice(i, i + MAX_CONCURRENT_EVALS);
        const results = await Promise.all(chunk);
        allEvalResults.push(...results);
      }
    }

    console.log();
  }

  // ── Step 3: Report ──────────────────────────────────────────
  console.log('[runner] 📊 Step 3: Generating report...\n');

  const reportEntries: ReportEntry[] = [];

  for (const { capture, evaluate } of allEvalResults) {
    reportEntries.push(buildReportEntry({ capture, evaluate }));
  }

  // If we only captured (no eval), still show captures in the report
  if (captureOnly) {
    for (const capture of allCaptures) {
      reportEntries.push({
        name: capture.name,
        screenshotPath: capture.filepath ? (capture.filepath.split('/').pop() ?? '') : '',
        prompt: capture.prompt,
        passed: !capture.error,
        error: capture.error,
        fromCache: false,
      });
    }
  }

  const reportPath = generateReport({ entries: reportEntries });

  console.log(`[runner] Report saved: ${reportPath}`);

  // ── Summary ──────────────────────────────────────────────────
  const total = reportEntries.length;
  const passed = reportEntries.filter((e) => e.passed).length;
  const failed = total - passed;
  const cached = reportEntries.filter((e) => e.fromCache).length;

  console.log(`\n[runner] ═══════════════════════════════════`);
  console.log(`[runner]   Total:  ${total}`);
  console.log(`[runner]   Passed: ${passed}`);
  console.log(`[runner]   Failed: ${failed}`);
  console.log(`[runner]   Cached: ${cached}`);
  console.log(`[runner] ═══════════════════════════════════`);

  if (failed > 0) {
    console.log(`\n[runner] ❌ ${failed} evaluation(s) failed.`);
    process.exitCode = 1;
  } else if (captureOnly) {
    console.log(
      `\n[runner] ✅ All captures succeeded. Run without --capture-only for AI evaluation.`,
    );
  } else {
    console.log(`\n[runner] ✅ All evaluations passed!`);
  }
};

main().catch((error) => {
  console.error('[runner] Fatal error:', error);
  process.exit(1);
});
