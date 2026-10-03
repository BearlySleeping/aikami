// packages/frontend/engine/src/game_world/world_restorer.test.ts
//
// The restorer exists because there are TWO restores with different contracts.
// The one that matters for correctness here: a recovery that used the PUBLIC
// `restoreWorld` would bump the transition generation and abandon itself
// mid-restore, leaving a half-restored world behind.

import { describe, expect, test } from 'bun:test';
import { WorldRestorer, type WorldRestorerDeps } from './world_restorer.ts';

type Harness = {
  restorer: WorldRestorer;
  calls: string[];
  restores: string[];
  invalidateCount: () => number;
  failRestore: (error: Error) => void;
};

const makeRestorer = (
  overrides: Partial<WorldRestorerDeps> & { snapshot?: string } = {},
): Harness => {
  const calls: string[] = [];
  const restores: string[] = [];
  let invalidations = 0;
  let restoreFailure: Error | undefined;

  const restorer = new WorldRestorer({
    requestSnapshot: async (scope) => {
      calls.push(`snapshot:${scope}`);
      return overrides.snapshot ?? '{"playerX":10}';
    },
    requestRestore: async (payload) => {
      calls.push('requestRestore');
      restores.push(payload);
      if (restoreFailure) {
        throw restoreFailure;
      }
    },
    clearRenderEntries: () => calls.push('clearRenderEntries'),
    resetNpcDiagnostics: () => calls.push('resetNpcDiagnostics'),
    resetInterpolationHistory: () => calls.push('resetInterpolationHistory'),
    invalidateInFlight: () => {
      invalidations++;
      calls.push('invalidateInFlight');
    },
    log: { debug: () => {}, warn: () => {}, error: () => {} },
  });

  return {
    restorer,
    calls,
    restores,
    invalidateCount: () => invalidations,
    failRestore: (error) => {
      restoreFailure = error;
    },
  };
};

describe('WorldRestorer — public restore is a discontinuity', () => {
  test('supersedes in-flight work before touching the world', async () => {
    const harness = makeRestorer();

    await harness.restorer.restore('save-1');

    // The invalidation has to come FIRST: a map load that is mid-flight must
    // not install its scene on top of the restored world.
    expect(harness.calls).toEqual([
      'invalidateInFlight',
      'clearRenderEntries',
      'resetNpcDiagnostics',
      'resetInterpolationHistory',
      'requestRestore',
    ]);
    expect(harness.restores).toEqual(['save-1']);
  });
});

describe('WorldRestorer — recovery rehydration', () => {
  test('never invalidates in-flight transitions', async () => {
    const harness = makeRestorer();

    await harness.restorer.rehydrate('checkpoint');

    // This is the whole reason the module exists.
    expect(harness.invalidateCount()).toBe(0);
    expect(harness.calls).not.toContain('invalidateInFlight');
    expect(harness.calls).toEqual([
      'clearRenderEntries',
      'resetNpcDiagnostics',
      'resetInterpolationHistory',
      'requestRestore',
    ]);
  });

  test('clears the old entity set before rehydrating', async () => {
    const harness = makeRestorer();

    await harness.restorer.rehydrate('checkpoint');

    const clearAt = harness.calls.indexOf('clearRenderEntries');
    const requestAt = harness.calls.indexOf('requestRestore');
    expect(clearAt).toBeGreaterThanOrEqual(0);
    expect(clearAt).toBeLessThan(requestAt);
    // Restored entities teleport, so the old interpolation history is stale.
    expect(harness.calls.indexOf('resetInterpolationHistory')).toBeLessThan(requestAt);
  });

  test('propagates a failed restore instead of reporting success', async () => {
    const harness = makeRestorer();
    harness.failRestore(new Error('worker rejected LOAD_GAME'));

    await expect(harness.restorer.rehydrate('checkpoint')).rejects.toThrow(
      'worker rejected LOAD_GAME',
    );
  });
});

describe('WorldRestorer — checkpoint capture', () => {
  test('captures a full-world snapshot', async () => {
    const harness = makeRestorer({ snapshot: '{"playerX":900,"playerHealth":12}' });

    expect(await harness.restorer.captureCheckpoint()).toBe('{"playerX":900,"playerHealth":12}');
    // 'world' — not the player-scoped save scope: recovery needs NPC state too.
    expect(harness.calls).toEqual(['snapshot:world']);
  });

  test('reports an unavailable checkpoint rather than throwing', async () => {
    // The caller turns this into "do not tear the world down".
    const harness = makeRestorer({ snapshot: '' });
    expect(await harness.restorer.captureCheckpoint()).toBeUndefined();
  });

  test('a snapshot failure is swallowed into undefined', async () => {
    const harness = makeRestorer();
    const broken = new WorldRestorer({
      requestSnapshot: async () => {
        throw new Error('worker timed out');
      },
      requestRestore: async () => {},
      clearRenderEntries: () => {},
      resetNpcDiagnostics: () => {},
      resetInterpolationHistory: () => {},
      invalidateInFlight: () => {},
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    });

    expect(await broken.captureCheckpoint()).toBeUndefined();
    expect(harness.calls).toEqual([]);
  });
});
