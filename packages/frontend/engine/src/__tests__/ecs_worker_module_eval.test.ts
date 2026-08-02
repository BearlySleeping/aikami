// packages/frontend/engine/src/__tests__/ecs_worker_module_eval.test.ts
//
// Smoke test: verifies that every module in the ECS worker's import
// graph can be statically evaluated without throwing.
//
// This catches module-level side-effects that crash the worker before
// error handlers are registered — the exact class of bug that caused
// the silent worker failure fixed by ecs_worker_bootstrap.ts.
//
// If this test fails, one of the 56 modules imported by the worker
// throws during module evaluation. Check the thrown error's stack trace.
//
// Bun's module loader evaluates all static imports synchronously,
// so a `throw` at module level surfaces here as a test failure.
import { describe, expect, test } from 'bun:test';

describe('ECS worker — module evaluation smoke test', () => {
  test('all 56 static imports evaluate without throwing', async () => {
    // Dynamic import to avoid poisoning the test runner's module cache.
    // Bun evaluates all transitive static imports when the module loads.
    // If any import throws, the dynamic import rejects with that error.
    let error: Error | undefined;

    try {
      await import('../worker/ecs_worker.ts');
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }

    expect(error).toBeUndefined();
  });
});
