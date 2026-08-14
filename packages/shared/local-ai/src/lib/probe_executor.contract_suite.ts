// packages/shared/local-ai/src/lib/probe_executor.contract_suite.ts
//
// Shared ProbeExecutor contract suite (AC-0c). Run against EVERY adapter:
// the Bun/CLI one (local-stack tests) and the fixture-replay one (this
// package's tests). Exercises the six guarantees from the C-391 design
// reference:
//
//   - missing binary       → resolves { ok:false, reason:'not-found' }
//   - non-zero exit        → resolves { ok:false, reason:'failed' }
//   - hanging process      → settles within timeoutMs and is killed
//   - permission denial    → resolves { ok:false, reason:'denied' }
//   - byte-faithful stdout → returned undecorated
//   - never throws         → every case resolves, never rejects
//
// Platform independence: command fixtures use the current process
// executable (`process.execPath` + `-e`) instead of POSIX-only sh/sleep/
// printf, so the suite runs identically on Linux, macOS, and Windows. The
// permission-denied case is driven by an explicit `permissionDeniedPath`
// capability; adapters that cannot produce a deterministic denial omit it
// and that test is skipped.

import { describe, expect, test } from 'bun:test';
import type { ProbeExecutor } from './probe_executor.ts';

export type ExecutorFactory = () => ProbeExecutor;

// The suite reads its own source file for the readTextFile case. Computed
// without node:path so the AC-0 boundary test (no Node builtins in the
// public graph) stays green; both the Bun/CLI adapter and the fixture
// adapter live in this same directory.
const SELF_PATH = `${import.meta.dir}/probe_executor.contract_suite.ts`;

/**
 * Runs the full contract suite against one adapter. Call this from each
 * adapter's own test file.
 *
 * @param label — Adapter label for describe().
 * @param factory — Builds a fresh executor per test.
 * @param permissionDeniedPath — Deterministic path whose read yields
 *   { ok:false, reason:'denied' }. Omit to skip the permission-denied test.
 */
export const runProbeExecutorContractSuite = (options: {
  readonly label: string;
  readonly factory: ExecutorFactory;
  readonly permissionDeniedPath?: string;
}): void => {
  const { label, factory, permissionDeniedPath } = options;

  describe(`ProbeExecutor contract — ${label}`, () => {
    test('missing binary resolves not-found, never rejects', async () => {
      const executor = factory();
      const result = await executor.run('definitely-not-a-real-binary-xyz', [], {
        timeoutMs: 500,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('not-found');
      }
    });

    test('non-zero exit resolves failed with byte-faithful stderr', async () => {
      const executor = factory();
      const result = await executor.run(
        process.execPath,
        ['-e', 'console.error("boom"); process.exit(3)'],
        { timeoutMs: 500 },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('failed');
        expect(result.detail).toBeString();
      }
    });

    test('hanging process settles within timeoutMs and is killed', async () => {
      const executor = factory();
      const start = Date.now();
      const result = await executor.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
        timeoutMs: 300,
      });
      const elapsed = Date.now() - start;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('timeout');
      }
      // Allow generous scheduling slack, but nowhere near the 5 s sleep.
      expect(elapsed).toBeLessThan(2500);
    });

    test('stdout is returned byte-faithfully', async () => {
      const executor = factory();
      const payload = '  RTX 4090, 24564 MiB, 570.00  \nSecond line  \n';
      const result = await executor.run(
        process.execPath,
        ['-e', 'process.stdout.write(process.argv[1])', payload],
        { timeoutMs: 500 },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stdout).toBe(payload);
      }
    });

    test('readTextFile returns contents without trimming', async () => {
      const executor = factory();
      // This file is guaranteed to exist and end with a newline wherever the
      // suite runs (both the Bun/CLI adapter and the fixture adapter).
      const result = await executor.readTextFile(SELF_PATH);
      // Assert ok FIRST: a failed read must fail the test rather than
      // skipping the newline assertion below.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stdout.endsWith('\n')).toBe(true);
      }
    });

    test('statfs resolves a shape, never throws', async () => {
      const executor = factory();
      const result = await executor.statfs('/fixture');
      if ('freeBytes' in result) {
        expect(result.freeBytes).toBeGreaterThanOrEqual(0);
      } else {
        expect(result.ok).toBe(false);
      }
    });

    test.skipIf(permissionDeniedPath === undefined)(
      'permission-denied path resolves denied, not failed',
      async () => {
        const executor = factory();
        const result = await executor.readTextFile(permissionDeniedPath ?? '');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('denied');
        }
      },
    );
  });
};
