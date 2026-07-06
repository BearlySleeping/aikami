// .pi/runners/test_healer.ts
/**
 * Self-Healing Visual Test Harness (C-303).
 *
 * Autonomous visual regression testing runner that:
 * 1. Executes visual test suites via Moon
 * 2. Intercepts Playwright layout exceptions and screenshot differences
 * 3. Parses mismatch indicators (expected/actual/diff image paths)
 * 4. Enforces a strict two-strike anti-loop threshold
 * 5. Generates structured healing context payload (.pi/healing_context.json)
 * 6. Dispatches herdr workspace alerts on persistent failure
 *
 * Usage:
 *   bun run .pi/runners/test_healer.ts <moon-target>
 *   bun run .pi/runners/test_healer.ts test:loop_escalation
 *
 * Exit codes:
 *   0   — All tests passed
 *   1   — First failure (transient, retry triggered)
 *   255 — Second failure (persistent loop, escalation triggered)
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// ── Types ──────────────────────────────────────────────────

/** A single visual mismatch detected in test output. */
export type VisualMismatchDiff = {
  testFile: string;
  testName: string;
  expectedSnapshotPath: string | null;
  actualSnapshotPath: string | null;
  differenceDiffPath: string | null;
  rawErrorOutput: string;
};

/** Structured healing context generated on persistent failure. */
export type StructuredHealingContext = {
  timestamp: string;
  moonTargetTask: string;
  totalAttemptsCount: number;
  visualMismatches: VisualMismatchDiff[];
  diagnosticMetrics: {
    suspectedComponent: string;
    layoutParameters: string[];
    viewportWidth: number;
    viewportHeight: number;
  };
};

// ── Constants ──────────────────────────────────────────────

const HEALING_CONTEXT_PATH = '.pi/healing_context.json';
const PREVIOUS_FAILURE_PATH = '.pi/previous_visual_failure.json';

// ── ANSI stripping ─────────────────────────────────────────

/**
 * Strip ANSI escape sequences from a string.
 * Prevents terminal escape codes from corrupting regex pattern matching.
 */
const stripAnsi = (text: string): string =>
  text.replace(
    new RegExp(
      [
        '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
        '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
      ].join('|'),
      'g',
    ),
    '',
  );

// ── Pattern matchers ───────────────────────────────────────

const MISMATCH_PATTERNS = {
  /** Playwright screenshot comparison failure */
  screenshotMismatch: /Screenshot comparison failed/i,
  /** Expected snapshot path */
  expectedPath: /Expected:\s*(.+\.png)/i,
  /** Actual snapshot path */
  actualPath: /Received:\s*(.+\.png)/i,
  /** Diff image path */
  diffPath: /Diff:\s*(.+\.png)/i,
  /** Test file + name from runner output */
  testIdentifier: /(?:FAIL|✗)\s+(.+?)\s+>\s+(.+?)\s/i,
  /** Viewport dimensions from test config */
  viewport: /viewport[^\d]*(\d+)\s*[×x]\s*(\d+)/i,
  /** Component name from test description */
  componentName: /component[:\s]+(\w+)/i,
};

// ── Output parsing ─────────────────────────────────────────

/**
 * Parse visual test output for mismatch signatures.
 * Extracts file paths, test names, and layout metadata.
 */
const _parseMismatches = (output: string): VisualMismatchDiff[] => {
  const clean = stripAnsi(output);
  const mismatches: VisualMismatchDiff[] = [];

  // Split output into test-level blocks
  const blocks = clean.split(/(?=(?:FAIL|✗)\s)/);

  for (const block of blocks) {
    if (!MISMATCH_PATTERNS.screenshotMismatch.test(block)) {
      continue;
    }

    const testMatch = MISMATCH_PATTERNS.testIdentifier.exec(block);

    mismatches.push({
      testFile: testMatch?.[1]?.trim() ?? 'unknown',
      testName: testMatch?.[2]?.trim() ?? 'unknown',
      expectedSnapshotPath: MISMATCH_PATTERNS.expectedPath.exec(block)?.[1]?.trim() ?? null,
      actualSnapshotPath: MISMATCH_PATTERNS.actualPath.exec(block)?.[1]?.trim() ?? null,
      differenceDiffPath: MISMATCH_PATTERNS.diffPath.exec(block)?.[1]?.trim() ?? null,
      rawErrorOutput: block.trim(),
    });
  }

  return mismatches;
};

// ── Diagnostic extraction ──────────────────────────────────

/**
 * Extract diagnostic metrics from mismatch output.
 */
const _extractDiagnostics = (
  mismatches: VisualMismatchDiff[],
  rawOutput: string,
): StructuredHealingContext['diagnosticMetrics'] => {
  const clean = stripAnsi(rawOutput);

  // Try to identify suspected component from test names
  const suspectedComponent =
    mismatches.map((m) => MISMATCH_PATTERNS.componentName.exec(m.testName)?.[1]).find(Boolean) ??
    'unknown';

  // Collect all layout parameter mentions
  const layoutParams: string[] = [];
  const layoutKeywords = [
    'width',
    'height',
    'padding',
    'margin',
    'flex',
    'grid',
    'position',
    'display',
    'transform',
    'opacity',
  ];

  for (const keyword of layoutKeywords) {
    if (clean.toLowerCase().includes(keyword)) {
      layoutParams.push(keyword);
    }
  }

  const vpMatch = MISMATCH_PATTERNS.viewport.exec(clean);

  return {
    suspectedComponent,
    layoutParameters: layoutParams,
    viewportWidth: vpMatch ? Number.parseInt(vpMatch[1] ?? '1280', 10) : 1280,
    viewportHeight: vpMatch ? Number.parseInt(vpMatch[2] ?? '720', 10) : 720,
  };
};

// ── Failure signature hash ─────────────────────────────────

/**
 * Compute a stable failure signature from mismatched component + test names.
 * Used for two-strike anti-loop detection.
 */
const _computeFailureSignature = (mismatches: VisualMismatchDiff[]): string => {
  const key = mismatches
    .map((m) => `${m.testFile}:${m.testName}`)
    .sort()
    .join('|');

  // Simple hash — Bun's CryptoHasher is designed for incremental use
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const chr = key.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }

  return `vf_${Math.abs(hash).toString(16)}`;
};

// ── Previous failure persistence ───────────────────────────

type PreviousFailure = {
  signature: string;
  timestamp: string;
  target: string;
};

const _readPreviousFailure = (): PreviousFailure | null => {
  if (!existsSync(PREVIOUS_FAILURE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(PREVIOUS_FAILURE_PATH, 'utf-8')) as PreviousFailure;
  } catch {
    return null;
  }
};

const _writePreviousFailure = (failure: PreviousFailure): void => {
  writeFileSync(PREVIOUS_FAILURE_PATH, JSON.stringify(failure, null, 2));
};

const _clearPreviousFailure = (): void => {
  if (existsSync(PREVIOUS_FAILURE_PATH)) {
    unlinkSync(PREVIOUS_FAILURE_PATH);
  }
};

// ── Healing context generation ─────────────────────────────

/**
 * Generate and persist the structured healing context payload.
 */
const _generateHealingContext = (options: {
  target: string;
  attempts: number;
  mismatches: VisualMismatchDiff[];
  rawOutput: string;
}): StructuredHealingContext => {
  const { target, attempts, mismatches, rawOutput } = options;

  const context: StructuredHealingContext = {
    timestamp: new Date().toISOString(),
    moonTargetTask: target,
    totalAttemptsCount: attempts,
    visualMismatches: mismatches,
    diagnosticMetrics: _extractDiagnostics(mismatches, rawOutput),
  };

  writeFileSync(HEALING_CONTEXT_PATH, JSON.stringify(context, null, 2));

  return context;
};

// ── Herdr alert dispatch ───────────────────────────────────

/**
 * Signal a workspace toast/alert via herdr notify.
 */
const _dispatchHerdrAlert = async (message: string): Promise<void> => {
  try {
    const proc = spawn('herdr', ['notify', message], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolveA) => {
      proc.on('close', () => resolveA());
    });
  } catch {
    // herdr notification is best-effort — never block on it
  }
};

// ── Moon task execution ────────────────────────────────────

/**
 * Run a moon task and capture its output.
 */
const _runMoonTask = async (
  target: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return new Promise((resolveR) => {
    const proc = spawn('bun', ['moon', 'run', target], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      // Stream progress to parent
      process.stdout.write(text);
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('close', (code) => {
      resolveR({ exitCode: code ?? 1, stdout, stderr });
    });
  });
};

// ── Main ───────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const target = args[0];

  if (!target) {
    console.error('Usage: bun run .pi/runners/test_healer.ts <moon-target>');
    console.error('  e.g. bun run .pi/runners/test_healer.ts apps/e2e:validate');
    console.error('  e.g. bun run .pi/runners/test_healer.ts test:loop_escalation');
    process.exit(1);
  }

  console.log(`[test-healer] Running visual tests: ${target}\n`);

  // ── Attempt 1: Run tests ──────────────────────────────
  const result1 = await _runMoonTask(target);
  const combinedOutput1 = result1.stdout + result1.stderr;

  if (result1.exitCode === 0) {
    console.log('[test-healer] ✅ All visual tests passed on first attempt');
    _clearPreviousFailure();
    process.exit(0);
  }

  // ── Parse mismatches ──────────────────────────────────
  const mismatches1 = _parseMismatches(combinedOutput1);
  const signature1 = _computeFailureSignature(mismatches1);

  console.log(`\n[test-healer] ⚠️  First attempt failed — ${mismatches1.length} mismatch(es)`);
  console.log(`[test-healer]    Signature: ${signature1}`);

  // ── Check for previous persistent failure ─────────────
  const previous = _readPreviousFailure();

  if (previous && previous.signature === signature1 && previous.target === target) {
    // ── Two-strike anti-loop escalation ─────────────────
    console.log('\n[test-healer] 🔴 PERSISTENT LOOP DETECTED');
    console.log(`[test-healer]    Previous failure: ${previous.timestamp}`);
    console.log(`[test-healer]    Same signature: ${signature1}`);

    const context = _generateHealingContext({
      target,
      attempts: 2,
      mismatches: mismatches1,
      rawOutput: combinedOutput1,
    });

    console.log(`[test-healer]    Healing context → ${HEALING_CONTEXT_PATH}`);
    console.log('[test-healer]    Dispatching herdr alert...');

    await _dispatchHerdrAlert(
      `🔴 Visual regression loop — ${context.visualMismatches.length} mismatch(es) in ${context.diagnosticMetrics.suspectedComponent}`,
    );

    console.log('[test-healer]    Exit 255 — escalation triggered\n');
    process.exit(255);
  }

  // ── Store failure for next attempt tracking ───────────
  _writePreviousFailure({
    signature: signature1,
    timestamp: new Date().toISOString(),
    target,
  });

  // ── Attempt 2: Retry with --force (bypass cache) ──────
  console.log('\n[test-healer] 🔄 Retrying with --force (cache bypass)...\n');

  const result2 = await _runMoonTask(`${target} -- --force`);

  if (result2.exitCode === 0) {
    console.log('[test-healer] ✅ Visual tests passed on retry (transient failure)');
    _clearPreviousFailure();
    process.exit(0);
  }

  // ── Second failure — persistent loop ──────────────────
  const combinedOutput2 = result2.stdout + result2.stderr;
  const mismatches2 = _parseMismatches(combinedOutput2);
  const signature2 = _computeFailureSignature(mismatches2);

  console.log(`\n[test-healer] 🔴 PERSISTENT REGRESSION LOOP`);
  console.log(`[test-healer]    Attempt 1 signature: ${signature1}`);
  console.log(`[test-healer]    Attempt 2 signature: ${signature2}`);

  const context = _generateHealingContext({
    target,
    attempts: 2,
    mismatches: mismatches2,
    rawOutput: combinedOutput2,
  });

  console.log(`[test-healer]    Healing context → ${HEALING_CONTEXT_PATH}`);

  await _dispatchHerdrAlert(
    `🔴 Visual regression persistent — ${context.visualMismatches.length} mismatch(es) after retry`,
  );

  _clearPreviousFailure();

  console.log('[test-healer]    Exit 255 — escalation\n');
  process.exit(255);
};

main().catch((error) => {
  console.error('[test-healer] Fatal error:', error);
  process.exit(1);
});
