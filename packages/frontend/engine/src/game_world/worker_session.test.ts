// packages/frontend/engine/src/game_world/worker_session.test.ts

import { describe, expect, test } from 'bun:test';
import type { WorkerMessage } from '../worker/worker_protocol.ts';
import {
  type HeartbeatEvent,
  type WorkerFailure,
  WorkerSession,
  type WorkerSessionOptions,
} from './worker_session.ts';

/** Minimal fake Worker capturing posts and exposing send/emit hooks. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: Array<{ message: Record<string, unknown>; transfer?: Transferable[] }> = [];
  terminated = false;
  throwOnPost = false;

  postMessage(message: Record<string, unknown>, transfer?: Transferable[]): void {
    if (this.throwOnPost) {
      throw new Error('DataCloneError');
    }
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  crash(message: string): void {
    this.onerror?.({
      message,
      filename: 'worker.js',
      lineno: 1,
      colno: 1,
      error: new Error(message),
    } as unknown as ErrorEvent);
  }
}

type Harness = {
  session: WorkerSession;
  worker: FakeWorker;
  messages: WorkerMessage[];
  failures: WorkerFailure[];
  heartbeats: HeartbeatEvent[];
};

const makeHarness = (options?: Partial<WorkerSessionOptions>): Harness => {
  const worker = new FakeWorker();
  const messages: WorkerMessage[] = [];
  const failures: WorkerFailure[] = [];
  const heartbeats: HeartbeatEvent[] = [];
  const session = new WorkerSession({
    // guard-ignore lint/type-safety/casting: fake test double implements only the surface the session touches
    workerFactory: () => worker as unknown as Worker,
    onMessage: (message) => messages.push(message),
    onFailure: (failure) => failures.push(failure),
    onHeartbeat: (event) => heartbeats.push(event),
    heartbeatIntervalMs: 5,
    requestTimeoutMs: 40,
    now: () => performance.now(),
    ...options,
  });
  return { session, worker, messages, failures, heartbeats };
};

const start = async (session: WorkerSession): Promise<void> => {
  await session.start({ canvasWidth: 1, canvasHeight: 1, buffers: [new ArrayBuffer(12)] });
};

const lastRequestId = (worker: FakeWorker): number => {
  const message = worker.posted.at(-1)?.message;
  const requestId = message?.requestId;
  if (typeof requestId !== 'number') {
    throw new Error('no requestId posted');
  }
  return requestId;
};

describe('WorkerSession — startup', () => {
  test('starts one worker and transfers the initial buffers', async () => {
    const { session, worker } = makeHarness();
    await start(session);
    await start(session); // second call is a no-op

    expect(session.worker).toBeDefined();
    const initPosts = worker.posted.filter((p) => p.message.type === 'INITIALIZE_ENGINE');
    expect(initPosts).toHaveLength(1);
    expect(initPosts[0]?.transfer).toHaveLength(1);
  });

  test('INITIALIZE_ENGINE carries the buffers in the payload, not only the transfer list', async () => {
    // Regression: a transferable that is not reachable from the message is
    // detached but never delivered. The worker destructures `buffers` from
    // the message and calls `buffers.length`, so a transfer-only buffer list
    // threw "Worker handler error: Cannot read properties of undefined" and
    // left the worker with no world — every later LOAD_MAP then failed with
    // "Cannot load map: world not initialized".
    const { session, worker } = makeHarness();
    await start(session);

    const init = worker.posted.find((p) => p.message.type === 'INITIALIZE_ENGINE');
    expect(init).toBeDefined();
    expect(Array.isArray(init?.message.buffers)).toBe(true);
    expect(init?.message.buffers).toHaveLength(1);
    // The payload buffers must be the very same objects that were transferred,
    // otherwise the worker receives detached copies. Identity, not deep
    // equality: two distinct ArrayBuffers can compare equal by content while
    // only one of them is actually reachable from the message.
    const payloadBuffers = init?.message.buffers as ArrayBuffer[];
    const transferredBuffers = (init?.transfer ?? []) as ArrayBuffer[];
    expect(payloadBuffers[0]).toBe(transferredBuffers[0]);
  });

  test('concurrent start calls share one worker', async () => {
    const { session, worker } = makeHarness();
    await Promise.all([start(session), start(session)]);
    expect(worker.posted.filter((p) => p.message.type === 'INITIALIZE_ENGINE')).toHaveLength(1);
  });
});

describe('WorkerSession — request correlation', () => {
  test('resolves the matching response exactly once', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({
      message: { type: 'REQUEST_SNAPSHOT', scope: 'player' },
      expect: 'SNAPSHOT_RESPONSE',
    });
    const requestId = lastRequestId(worker);
    worker.emit({ type: 'SNAPSHOT_RESPONSE', payload: '{"ok":true}', requestId });

    const response = await promise;
    expect(response.type).toBe('SNAPSHOT_RESPONSE');
    if (response.type === 'SNAPSHOT_RESPONSE') {
      expect(response.payload).toBe('{"ok":true}');
    }
  });

  test('rejects a correlated SNAPSHOT_RESPONSE error', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({
      message: { type: 'REQUEST_SNAPSHOT', scope: 'player' },
      expect: 'SNAPSHOT_RESPONSE',
    });
    worker.emit({ type: 'SNAPSHOT_RESPONSE', error: 'boom', requestId: lastRequestId(worker) });

    await expect(promise).rejects.toThrow('boom');
  });

  test('a late reply for a settled request never settles a newer one', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const first = session.request({
      message: { type: 'LOAD_GAME', payload: 'a' },
      expect: 'ENGINE_READY',
    });
    const firstId = lastRequestId(worker);
    worker.emit({ type: 'ENGINE_READY', requestId: firstId });
    await first;

    const second = session.request({
      message: { type: 'LOAD_GAME', payload: 'b' },
      expect: 'ENGINE_READY',
    });
    const secondId = lastRequestId(worker);

    // Late reply for the first (already settled) request.
    worker.emit({ type: 'ENGINE_READY', requestId: firstId });
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondSettled).toBe(false);

    worker.emit({ type: 'ENGINE_READY', requestId: secondId });
    await second;
  });

  test('times out a request that never gets a reply', async () => {
    const { session } = makeHarness({ requestTimeoutMs: 15 });
    await start(session);

    await expect(
      session.request({
        message: { type: 'LOAD_GAME', payload: 'x' },
        expect: 'ENGINE_READY',
      }),
    ).rejects.toThrow('did not respond');
  });
});

describe('WorkerSession — failure and disposal', () => {
  test('worker crash rejects every pending request', async () => {
    const { session, worker, failures } = makeHarness();
    await start(session);

    const promise = session.request({
      message: { type: 'LOAD_MAP' },
      expect: 'MAP_LOADED',
    });
    worker.crash('kaboom');

    await expect(promise).rejects.toThrow('Worker crashed');
    expect(failures.some((failure) => failure.kind === 'error')).toBe(true);
  });

  test('synchronous postMessage failure rejects the request', async () => {
    const { session, worker, failures } = makeHarness();
    await start(session);
    worker.throwOnPost = true;

    await expect(
      session.request({
        message: { type: 'REQUEST_SNAPSHOT', scope: 'player' },
        expect: 'SNAPSHOT_RESPONSE',
      }),
    ).rejects.toThrow('Failed to post');
    expect(failures.some((failure) => failure.kind === 'post')).toBe(true);
  });

  test('terminate rejects pending requests and prevents restart', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({
      message: { type: 'LOAD_GAME', payload: 'x' },
      expect: 'ENGINE_READY',
    });
    session.terminate();

    await expect(promise).rejects.toThrow('disposed');
    expect(worker.terminated).toBe(true);
    expect(session.worker).toBeUndefined();
    await expect(start(session)).rejects.toThrow('disposed');
  });

  test('terminate is idempotent', async () => {
    const { session } = makeHarness();
    await start(session);
    session.terminate();
    expect(() => session.terminate()).not.toThrow();
  });
});

describe('WorkerSession — buffer recycling and heartbeat', () => {
  test('recycles a non-empty buffer and ignores empty ones', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    session.recycleBuffer(new ArrayBuffer(8));
    session.recycleBuffer(new ArrayBuffer(0));
    session.recycleBuffer(undefined);

    const recycled = worker.posted.filter((p) => p.message.type === 'RECYCLE_BUFFER');
    expect(recycled).toHaveLength(1);
    expect(recycled[0]?.transfer).toHaveLength(1);
  });

  test('escalates a stalled simulation with RESET_TICK_LOOP', async () => {
    const { session, worker, heartbeats } = makeHarness({ heartbeatIntervalMs: 5 });
    await start(session);
    session.startHeartbeat();

    worker.emit({ type: 'STATE_UPDATE', ack: { tickCount: 7, writableBufferCount: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(heartbeats.some((event) => event.kind === 'stall')).toBe(true);
    expect(worker.posted.some((p) => p.message.type === 'RESET_TICK_LOOP')).toBe(true);
    session.stopHeartbeat();
  });
});

describe('WorkerSession — correlated ENGINE_ERROR settles the request', () => {
  test('rejects immediately instead of waiting out the timeout', async () => {
    // Regression: `_settle` required the message type to be listed in
    // `expect`, so a correlated ENGINE_ERROR was dropped and the caller waited
    // the full timeout before failing with a generic "did not respond". A
    // missing `buffers` field in INITIALIZE_ENGINE surfaced that way as a 15s
    // "worker may have crashed" instead of the real error.
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({ message: { type: 'LOAD_MAP' }, expect: 'MAP_LOADED' });
    // The worker reports a failure for this very request.
    worker.emit({
      type: 'ENGINE_ERROR',
      message: 'Cannot load map: world not initialized',
      requestId: 1,
    });

    await expect(promise).rejects.toThrow('Cannot load map: world not initialized');
  });

  test('a late ENGINE_ERROR for an already-settled request is ignored', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({ message: { type: 'LOAD_MAP' }, expect: 'MAP_LOADED' });
    worker.emit({ type: 'MAP_LOADED', requestId: 1 });
    await expect(promise).resolves.toMatchObject({ type: 'MAP_LOADED' });

    // Must not throw out of the message handler.
    expect(() =>
      worker.emit({ type: 'ENGINE_ERROR', message: 'late', requestId: 1 }),
    ).not.toThrow();
  });

  test('an uncorrelated ENGINE_ERROR does not settle an unrelated request', async () => {
    const { session, worker } = makeHarness();
    await start(session);

    const promise = session.request({ message: { type: 'LOAD_MAP' }, expect: 'MAP_LOADED' });
    // No requestId — belongs to some other operation (e.g. INITIALIZE_ENGINE).
    worker.emit({ type: 'ENGINE_ERROR', message: 'unrelated failure' });

    // Still pending: it must not be rejected by an unrelated error.
    worker.emit({ type: 'MAP_LOADED', requestId: 1 });
    await expect(promise).resolves.toMatchObject({ type: 'MAP_LOADED' });
  });
});
