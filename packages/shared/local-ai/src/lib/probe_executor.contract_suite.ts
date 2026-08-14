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

import { describe, expect, test } from 'bun:test';
import type { ProbeExecutor } from './probe_executor.ts';

export type ExecutorFactory = () => ProbeExecutor;

/**
 * Runs the full contract suite against one adapter. Call this from each
 * adapter's own test file.
 *
 * @param label — Adapter label for describe().
 * @param factory — Builds a fresh executor per test.
 */
export const runProbeExecutorContractSuite = (options: {
  readonly label: string;
  readonly factory: ExecutorFactory;
  /** True when the adapter under test can actually spawn processes (Bun/CLI). */
  readonly canSpawn: boolean;
}): void => {
  const { label, factory, canSpawn } = options;

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
      const result = await executor.run('sh', ['-c', 'echo boom >&2; exit 3'], {
        timeoutMs: 500,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('failed');
        expect(result.detail).toBeString();
      }
    });

    test('hanging process settles within timeoutMs and is killed', async () => {
      const executor = factory();
      const start = Date.now();
      const result = await executor.run('sh', ['-c', 'sleep 5'], { timeoutMs: 300 });
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
      const result = await executor.run('printf', ['%s', payload], { timeoutMs: 500 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stdout).toBe(payload);
      }
    });

    test('readTextFile returns contents without trimming', async () => {
      const executor = factory();
      const result = await executor.readTextFile('/fixture/untouched.txt');
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

    if (!canSpawn) {
      return;
    }

    test('permission-denied path resolves denied, not failed', async () => {
      const executor = factory();
      // Use a directory as a file — reading it yields EACCES/EISDIR, which
      // the Bun adapter must map to 'denied'.
      const result = await executor.readTextFile('/proc/1/mem');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('denied');
      }
    });
  });
};
