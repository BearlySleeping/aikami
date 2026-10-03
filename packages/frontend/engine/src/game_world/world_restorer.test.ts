// packages/frontend/engine/src/game_world/world_restorer.test.ts
//
// The restorer exists because there are TWO restores with different contracts.
// The one that matters for correctness here: a recovery that used the PUBLIC
// `restoreWorld` would bump the transition generation and abandon itself
// mid-restore, leaving a half-restored world behind.

import { describe, expect, test } from 'bun:test';
import { SceneTransitionRunner } from './scene_transition.ts';
import { makePreparedScene } from './testing/scene_transition_harness.ts';
import { WorkerSession } from './worker_session.ts';
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

describe('WorldRestorer — against a real WorkerSession', () => {
  // The unit tests above pin the sequencing with injected functions. These
  // pin the actual collaborator chain: a real WorkerSession, a real
  // SceneTransitionRunner, and the real worker messages the worker would see.

  const makeSession = () => {
    const messages: Record<string, unknown>[] = [];
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      onmessageerror: null,
      posted: [] as Array<{ message: Record<string, unknown> }>,
      postMessage(message: Record<string, unknown>) {
        this.posted.push({ message });
        messages.push(message);
      },
      terminate() {},
    };
    const session = new WorkerSession({
      // guard-ignore lint/type-safety/casting: the fake implements only the transport surface
      workerFactory: () => worker as unknown as Worker,
      onMessage: () => {},
      onFailure: () => {},
    });
    const start = async (): Promise<void> => {
      await session.start({ canvasWidth: 1, canvasHeight: 1, buffers: [] });
    };
    const reply = (message: Record<string, unknown>): void => {
      worker.onmessage?.({ data: message } as MessageEvent);
    };
    return { session, worker, start, reply, messages };
  };

  test('capturing a checkpoint asks the worker for a full-world snapshot', async () => {
    const harness = makeSession();
    await harness.start();

    const pending = harness.session.request({
      message: { type: 'REQUEST_SNAPSHOT', scope: 'world' },
      expect: 'SNAPSHOT_RESPONSE',
    });
    const requestId = (harness.worker.posted.at(-1)?.message.requestId ?? 0) as number;
    harness.reply({ type: 'SNAPSHOT_RESPONSE', requestId, payload: '{"entities":42}' });

    expect(await pending).toMatchObject({ payload: '{"entities":42}' });
    const snapshotPost = harness.messages.find((message) => message.type === 'REQUEST_SNAPSHOT');
    // 'world', not the player-scoped save scope: recovery also restores NPCs.
    expect(snapshotPost?.scope).toBe('world');
  });

  test('a worker that never answers fails the checkpoint instead of hanging', async () => {
    const harness = makeSession();
    await harness.start();

    const restorer = new WorldRestorer({
      requestSnapshot: async () => {
        const response = await harness.session.request({
          message: { type: 'REQUEST_SNAPSHOT', scope: 'world' },
          expect: 'SNAPSHOT_RESPONSE',
          timeoutMs: 20,
        });
        return response.payload ?? '';
      },
      requestRestore: async () => {},
      clearRenderEntries: () => {},
      resetNpcDiagnostics: () => {},
      resetInterpolationHistory: () => {},
      invalidateInFlight: () => {},
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    });

    // A timeout is reported as "no checkpoint", which makes the caller abandon
    // the switch before anything is destroyed.
    expect(await restorer.captureCheckpoint()).toBeUndefined();
  });

  test('rehydrating a real transition does not supersede it', async () => {
    const harness = makeSession();
    await harness.start();

    let invalidations = 0;
    // The runner is never loaded here, so its generation is exactly the two
    // invalidations below.
    const generationBefore = 2;
    const runner = new SceneTransitionRunner({
      prepare: async () => makePreparedScene(),
      render: async () => true,
      postLoadMap: async () => {},
      resetSurface: () => {},
      installScene: () => {},
      onDiscontinuity: () => {},
      captureCheckpoint: async () => 'cp',
      restoreCheckpoint: async (payload) => {
        // The real chain: post LOAD_GAME to the worker and await its reply.
        await harness.session.request({
          message: { type: 'LOAD_GAME', payload },
          expect: 'ENGINE_READY',
        });
      },
      setRunning: () => {},
      setInputLocked: () => {},
      emitMapLoaded: () => {},
      emitMapEntered: () => {},
      emitError: () => {},
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    });
    // Move the generation the recovery would run under.
    runner.invalidateInFlight();
    runner.invalidateInFlight();
    expect(runner.generation).toBe(generationBefore);

    const restorer = new WorldRestorer({
      requestSnapshot: async () => '{}',
      requestRestore: (payload) =>
        harness.session
          .request({ message: { type: 'LOAD_GAME', payload }, expect: 'ENGINE_READY' })
          .then(() => undefined),
      clearRenderEntries: () => {},
      resetNpcDiagnostics: () => {},
      resetInterpolationHistory: () => {},
      invalidateInFlight: () => {
        invalidations++;
      },
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    });

    // The restore posts its own correlated request; reply to exactly that one.
    const rehydrating = restorer.rehydrate('cp');
    const requestId = (harness.worker.posted.at(-1)?.message.requestId ?? 0) as number;
    harness.reply({ type: 'ENGINE_READY', requestId });
    await rehydrating;

    // This is the whole point: the recovery's restore left the runner alone.
    expect(invalidations).toBe(0);
    expect(runner.generation).toBe(generationBefore);
    const loadGame = harness.messages.filter((message) => message.type === 'LOAD_GAME');
    expect(loadGame).toHaveLength(1);
    expect(loadGame[0]?.payload).toBe('cp');
  });
});
