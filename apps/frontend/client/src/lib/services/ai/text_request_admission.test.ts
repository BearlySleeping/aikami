// apps/frontend/client/src/lib/services/ai/text_request_admission.test.ts
//
// Deterministic tests for the inference admission gate (issue #382).
//
// The gate is driven through REAL task ids, not a hand-passed priority: the
// service never chooses priority itself, it derives it from the task, and a
// test that injected the class directly would never notice that derivation
// breaking.
//
// Every timing assertion here runs on FAKE TIMERS. The quiet window is the
// whole mechanism, and a test that sleeps for it would be slow, flaky, and —
// worst of all — would still pass if the timer were never armed at all. With
// fake timers, "background was NOT admitted after 1 499 ms" is an assertion,
// not a hope.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig-override tsconfig.test.json \
//     src/lib/services/ai/text_request_admission.test.ts

import type { AiModeResolution } from '@aikami/types';
import {
  createServiceInferenceAdmission,
  type ServiceInferenceAdmission,
  type TextAdmissionClock,
} from './text_request_admission.ts';

/**
 * The two routes the domain tests distinguish, expressed the way production
 * expresses them — as RESOLVED ROUTINGS, because that is what the service hands
 * the gate. Naming domains as opaque strings here would let the key derivation
 * rot without a single test noticing.
 */
const OLLAMA: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  model: 'ornith-1.5:9b',
  endpoint: 'http://127.0.0.1:11434/api/chat',
};
const OTHER_DEVICE: AiModeResolution = {
  capability: 'text',
  mode: 'byok',
  provider: 'openrouter',
  model: 'some/model',
  endpoint: 'https://api.openrouter.ai',
};

let admission: ServiceInferenceAdmission;

/**
 * A hand-driven clock.
 *
 * The quiet window IS the mechanism, so the tests must be able to stop exactly
 * one millisecond short of it and assert that nothing was admitted. Sleeping
 * for 1 000 ms per assertion would be slow and would still not prove the timer
 * was armed rather than merely slow.
 */
const fakeClock = (): TextAdmissionClock & { advance(ms: number): void; pending(): number } => {
  let current = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => current,
    setTimer(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: current + Math.max(0, ms), callback });
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    /** Advances the clock, firing every timer whose deadline has passed. */
    advance(ms: number) {
      const target = current + ms;
      // Ordered by deadline, and same-deadline timers keep insertion order, so
      // the sequence a real event loop would see is the one reproduced here.
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        const next = due[0];
        if (next === undefined) {
          break;
        }
        timers.delete(next[0]);
        current = next[1].at;
        next[1].callback();
      }
      current = target;
    },
  };
};

let clock: ReturnType<typeof fakeClock>;

/**
 * A fresh gate with a 1 000 ms quiet window, on the fake clock.
 *
 * `quietWindowMs` is set through the global seam the service reads, because
 * that seam IS the production policy input — driving the gate's own option
 * instead would test a different configuration than the one that ships.
 */
const build = (quietWindowMs = 1_000): ServiceInferenceAdmission => {
  clock = fakeClock();
  (globalThis as Record<string, unknown>).__text_admission_quiet_window_ms = quietWindowMs;
  return createServiceInferenceAdmission({ clock });
};

/** A signal a test can abort on demand. */
const signal = (): AbortSignal => new AbortController().signal;

beforeEach(() => {
  admission = build();
});

/** Lets pending microtasks drain without advancing the fake clock. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

// ---------------------------------------------------------------------------
// Interactive is never gated
// ---------------------------------------------------------------------------

describe('admission — interactive is admitted immediately', () => {
  test('an interactive request resolves without any timer advancing', async () => {
    const lease = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });

    // The derived key, asserted as a fact about the derivation: same runtime
    // regardless of which surface or model the route names.
    expect(lease.domain).toBe('ollama|http://127.0.0.1:11434');
    expect(lease.queueMs).toBe(0);
    expect(lease.queueDepth).toBe(0);
    lease.release();
  });

  test('interactive activity is counted while it runs', async () => {
    const lease = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    expect(admission.stats.interactiveActive).toBe(1);
    lease.release();
    expect(admission.stats.interactiveActive).toBe(0);
  });

  test('a pre-aborted caller is rejected without joining a queue', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      admission.acquire({
        routing: OLLAMA,
        task: 'summarization',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(admission.stats.backgroundQueued).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Background is DEFERRED — the MAP_LOADED race
// ---------------------------------------------------------------------------

describe('admission — background never dispatches synchronously', () => {
  test('background is queued even into a completely idle domain', async () => {
    let admitted = false;
    const pending = admission
      .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
      .then((lease) => {
        admitted = true;
        return lease;
      });

    await flush();
    // Nothing is running, nothing has been running — the window still applies.
    // Admitting here is the exact failure #416 measured.
    expect(admitted).toBe(false);
    expect(admission.stats.backgroundQueued).toBe(1);

    clock.advance(999);
    await flush();
    expect(admitted).toBe(false);

    clock.advance(1);
    const admittedLease = await pending;
    expect(admitted).toBe(true);
    expect(admittedLease.queueMs).toBeGreaterThanOrEqual(1_000);
    admittedLease.release();
  });

  test('background is queued while interactive work is active', async () => {
    const foreground = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });

    let admitted = false;
    const pending = admission
      .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
      .then((lease) => {
        admitted = true;
        return lease;
      });

    clock.advance(10_000);
    await flush();
    expect(admitted).toBe(false);

    foreground.release();
    clock.advance(999);
    await flush();
    expect(admitted).toBe(false);

    clock.advance(1);
    (await pending).release();
    expect(admitted).toBe(true);
  });

  test('an interactive arrival during the window RESETS it', async () => {
    let admitted = false;
    const pending = admission
      .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
      .then((lease) => {
        admitted = true;
        return lease;
      });

    // Almost the whole window elapses…
    clock.advance(900);
    await flush();
    expect(admitted).toBe(false);

    // …and the player opens a conversation.
    const foreground = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    foreground.release();

    // The window restarts from the arrival, it is not merely suspended.
    clock.advance(900);
    await flush();
    expect(admitted).toBe(false);

    clock.advance(100);
    (await pending).release();
    expect(admitted).toBe(true);
  });

  test('several interactive arrivals during the window each reset it', async () => {
    const pending = admission.acquire({
      routing: OLLAMA,
      task: 'summarization',
      signal: signal(),
    });

    for (let index = 0; index < 3; index += 1) {
      clock.advance(800);
      await flush();
      const foreground = await admission.acquire({
        routing: OLLAMA,
        task: 'dialogue',
        signal: signal(),
      });
      foreground.release();
    }
    clock.advance(999);
    await flush();
    expect(admission.stats.backgroundActive).toBe(0);

    clock.advance(1);
    (await pending).release();
    expect(admission.stats.backgroundAdmitted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// One background at a time, FIFO
// ---------------------------------------------------------------------------

describe('admission — one background per domain, in FIFO order', () => {
  test('a burst admits exactly one at a time', async () => {
    const order: number[] = [];
    const leases = [0, 1, 2, 3].map((index) =>
      admission
        .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
        .then((lease) => {
          order.push(index);
          return lease;
        }),
    );

    clock.advance(1_000);
    await flush();
    expect(order).toEqual([0]);
    expect(admission.stats.backgroundActive).toBe(1);
    expect(admission.stats.backgroundQueued).toBe(3);

    // The next one only after the previous settles AND another window passes.
    clock.advance(60_000);
    await flush();
    expect(order).toEqual([0]);

    const first = await leases[0];
    first.release();
    clock.advance(999);
    await flush();
    expect(order).toEqual([0]);
    clock.advance(1);
    await flush();
    expect(order).toEqual([0, 1]);

    for (const index of [1, 2, 3]) {
      (await leases[index]).release();
      clock.advance(1_000);
      await flush();
    }
    expect(order).toEqual([0, 1, 2, 3]);
    // Every lease was released, so the domain is genuinely idle again.
    expect(admission.stats.backgroundActive).toBe(0);
    expect(admission.stats.backgroundQueued).toBe(0);
  });

  test('order is FIFO, not LIFO and not arrival-of-timer order', async () => {
    const started: number[] = [];
    const pending = [0, 1, 2].map((index) =>
      admission
        .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
        .then(async (lease) => {
          started.push(index);
          lease.release();
          clock.advance(1_000);
          await flush();
          return lease;
        }),
    );

    for (let round = 0; round < 5; round += 1) {
      clock.advance(1_000);
      await flush();
    }
    await Promise.all(pending);
    expect(started).toEqual([0, 1, 2]);
  });

  test('queue depth reports how many were ahead on entry', async () => {
    const depths: number[] = [];
    const pending = [0, 1, 2, 3].map(() =>
      admission
        .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
        .then((lease) => {
          depths.push(lease.queueDepth);
          return lease;
        }),
    );

    // Nothing has been admitted yet, so each saw exactly the earlier waiters.
    clock.advance(1_000);
    await flush();
    // Entry snapshots: 0, 1, 2, 3.
    expect(depths).toEqual([0]);
    expect(admission.stats.peakQueueDepth).toBe(3);

    for (const promise of pending) {
      (await promise).release();
      clock.advance(1_000);
      await flush();
    }
    expect(depths).toEqual([0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Fairness
// ---------------------------------------------------------------------------

describe('admission — background work drains and is never forgotten', () => {
  test('queued work drains once the domain is quiet', async () => {
    const started: number[] = [];
    const live: Array<{ release: () => void }> = [];
    const pending = [0, 1, 2].map((index) =>
      admission
        .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
        .then((lease) => {
          started.push(index);
          live.push(lease);
          return lease;
        }),
    );

    // Foreground never stops for ~7.5 s. Background must wait — that is the
    // deliberate tradeoff — but must not be dropped.
    for (let index = 0; index < 5; index += 1) {
      const foreground = await admission.acquire({
        routing: OLLAMA,
        task: 'dialogue',
        signal: signal(),
      });
      clock.advance(1_000);
      await flush();
      foreground.release();
      clock.advance(500);
      await flush();
    }
    expect(started).toEqual([]);
    expect(admission.stats.backgroundQueued).toBe(3);

    // Foreground stops. Each request drains, one window apart, and each is
    // released as it lands — otherwise only the first would ever run and the
    // rest would wait forever, which is a test bug rather than a policy one.
    for (let round = 0; round < 12 && live.length < 3; round += 1) {
      clock.advance(1_000);
      await flush();
      live.at(-1)?.release();
    }
    await Promise.all(pending);
    expect(started).toEqual([0, 1, 2]);
    expect(admission.stats.backgroundDropped).toBe(0);
    expect(admission.stats.backgroundQueued).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Independent domains
// ---------------------------------------------------------------------------

describe('admission — contention domains are independent', () => {
  test('a busy domain does not block another', async () => {
    const onA = admission.acquire({ routing: OLLAMA, task: 'summarization', signal: signal() });
    const onB = admission.acquire({
      routing: OTHER_DEVICE,
      task: 'summarization',
      signal: signal(),
    });

    clock.advance(1_000);
    await flush();

    const leaseB = await onB;
    // Both domains are independently quiet, so both admit — that independence
    // is the point of the test, not the count.
    expect(admission.stats.backgroundActive).toBe(2);
    leaseB.release();

    clock.advance(1_000);
    await flush();
    (await onA).release();
    expect(admission.stats.backgroundAdmitted).toBe(2);
  });

  test('interactive activity in one domain does not defer the other', async () => {
    const foreground = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });

    const onB = admission.acquire({
      routing: OTHER_DEVICE,
      task: 'summarization',
      signal: signal(),
    });
    clock.advance(1_000);
    await flush();

    (await onB).release();
    // The busy domain's foreground is untouched by the other domain's drain.
    expect(admission.stats.interactiveActive).toBe(1);
    foreground.release();
    expect(admission.stats.interactiveActive).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cancellation and deadline expiry
// ---------------------------------------------------------------------------

describe('admission — queued requests can be dropped without dispatching', () => {
  test('a caller cancelling while queued never reaches admission', async () => {
    const controller = new AbortController();
    const pending = admission.acquire({
      routing: OLLAMA,
      task: 'summarization',
      signal: controller.signal,
    });

    clock.advance(500);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    clock.advance(10_000);
    await flush();
    expect(admission.stats.backgroundAdmitted).toBe(0);
    expect(admission.stats.backgroundQueued).toBe(0);
    expect(admission.stats.backgroundDropped).toBe(1);
  });

  test('a DEADLINE expiring while queued never reaches admission', async () => {
    // The deadline's own signal is what the request carries, so expiry and
    // caller cancellation take the identical drop path — which is the point:
    // one path, tested once.
    const controller = new AbortController();
    const pending = admission.acquire({
      routing: OLLAMA,
      task: 'summarization',
      signal: controller.signal,
    });

    clock.advance(400);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    clock.advance(10_000);
    await flush();
    expect(admission.stats.backgroundAdmitted).toBe(0);
    expect(admission.stats.backgroundDropped).toBe(1);
  });

  test('dropping the head promotes the next in FIFO order', async () => {
    const started: string[] = [];
    const first = new AbortController();
    const a = admission
      .acquire({ routing: OLLAMA, task: 'summarization', signal: first.signal })
      .then((lease) => {
        started.push('a');
        return lease;
      });
    const b = admission
      .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
      .then((lease) => {
        started.push('b');
        return lease;
      });
    const c = admission.acquire({ routing: OLLAMA, task: 'summarization', signal: signal() });
    c.then(() => started.push('c'));

    first.abort();
    await expect(a).rejects.toThrow();

    clock.advance(1_000);
    await flush();
    (await b).release();
    // The window restarts after the drop, so `c` is not admitted on the same
    // tick — it still owes a quiet window of its own.
    expect(started).toEqual(['b']);
    clock.advance(1_000);
    await flush();
    expect(started).toEqual(['b', 'c']);
  });

  test('cancelling every subscriber releases the whole queue', async () => {
    const controllers = [0, 1, 2].map(() => new AbortController());
    const pending = controllers.map((controller) =>
      admission.acquire({
        routing: OLLAMA,
        task: 'summarization',
        signal: controller.signal,
      }),
    );
    for (const controller of controllers) {
      controller.abort();
    }
    // Every subscriber must have been REJECTED, not merely settled:
    // `Promise.allSettled` resolves for a fulfilled promise too, so asserting
    // only that it resolved would pass with the requests quietly succeeding.
    const outcomes = await Promise.allSettled(pending);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(admission.stats.backgroundQueued).toBe(0);
    clock.advance(10_000);
    await flush();
    expect(admission.stats.backgroundAdmitted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cancelAll / dispose
// ---------------------------------------------------------------------------

describe('admission — cancelAll', () => {
  test('rejects queued requests, clears timers and zeroes the counters', async () => {
    const foreground = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    const queued = [0, 1].map(() =>
      admission.acquire({ routing: OLLAMA, task: 'summarization', signal: signal() }),
    );

    admission.cancelAll();

    const outcomes = await Promise.allSettled(queued);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(admission.stats.backgroundQueued).toBe(0);
    expect(admission.stats.backgroundAdmitted).toBe(0);
    expect(admission.stats.backgroundDropped).toBe(2);

    // No dispatch may happen after cancelAll, however much time passes.
    clock.advance(60_000);
    await flush();
    expect(admission.stats.backgroundAdmitted).toBe(0);

    // A lease from the cancelled generation releasing afterwards must not drive
    // a fresh domain's counters negative.
    foreground.release();
    expect(admission.stats.interactiveActive).toBe(0);
  });

  test('an idle domain is RECLAIMED, not retained for the session', async () => {
    // Keyed by user-controlled provider/endpoint strings, and scanned by
    // `recountTotals` on every acquire and release. Retaining every domain a
    // session ever touched would make that scan grow without bound.
    const first = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    expect(admission.stats.domains).toBe(1);
    first.release();
    expect(admission.stats.domains).toBe(0);

    // The same routing still works afterwards — reclamation must not break the
    // next caller.
    const second = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    expect(admission.stats.domains).toBe(1);
    second.release();
    expect(admission.stats.domains).toBe(0);
  });

  test('a domain with queued work is NOT reclaimed', async () => {
    const foreground = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    const queued = admission.acquire({
      routing: OLLAMA,
      task: 'summarization',
      signal: signal(),
    });
    foreground.release();
    // The window is armed and a waiter exists: this domain is still live.
    expect(admission.stats.domains).toBe(1);

    clock.advance(1_000);
    await flush();
    (await queued).release();
    expect(admission.stats.domains).toBe(0);
  });

  test('the domain can be used again after cancelAll', async () => {
    admission.cancelAll();
    const lease = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    expect(admission.stats.interactiveActive).toBe(1);
    lease.release();
    expect(admission.stats.interactiveActive).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Release paths
// ---------------------------------------------------------------------------

describe('admission — every release path frees the domain', () => {
  test('release is idempotent and never double-counts', async () => {
    const lease = await admission.acquire({
      routing: OLLAMA,
      task: 'dialogue',
      signal: signal(),
    });
    lease.release();
    lease.release();
    expect(admission.stats.interactiveActive).toBe(0);
  });

  test('a settled background lease re-arms the window for the next one', async () => {
    const a = admission.acquire({ routing: OLLAMA, task: 'summarization', signal: signal() });
    const b = admission.acquire({ routing: OLLAMA, task: 'summarization', signal: signal() });

    clock.advance(1_000);
    await flush();
    (await a).release();
    clock.advance(1_000);
    await flush();
    (await b).release();
    expect(admission.stats.backgroundAdmitted).toBe(2);
    expect(admission.stats.backgroundActive).toBe(0);
  });

  test('a zero quiet window still defers by a tick, never synchronously', async () => {
    const gate = build(0);
    let admitted = false;
    const pending = gate
      .acquire({ routing: OLLAMA, task: 'summarization', signal: signal() })
      .then((lease) => {
        admitted = true;
        return lease;
      });
    await flush();
    expect(admitted).toBe(false);
    clock.advance(0);
    await flush();
    expect(admitted).toBe(true);
    (await pending).release();
    gate.cancelAll();
  });
});

// ---------------------------------------------------------------------------
// The contention domain key
//
// Asserted through the GATE, because the key is not a thing callers are given:
// two routes share a contention domain exactly when the gate makes them compete.
// Asserting the string would test a private helper's formatting instead of the
// behaviour the boundary is for.
// ---------------------------------------------------------------------------

describe('textRequestAdmission — contention domain derivation', () => {
  const resolve = (provider: string, endpoint: string, model = 'm'): AiModeResolution => ({
    capability: 'text',
    mode: 'offline',
    provider,
    model,
    endpoint,
  });

  /** Admit one background call on a route and report the domain it ran in. */
  const domainOf = async (routing: AiModeResolution): Promise<string> => {
    const gate = build();
    const lease = await gate.acquire({ routing, task: 'dialogue', signal: signal() });
    const domain = lease.domain;
    lease.release();
    gate.cancelAll();
    return domain;
  };

  test('the same Ollama runtime is ONE domain regardless of model or surface', async () => {
    // The measured failure mode: two models on one endpoint share one GPU, and
    // `/api/chat` vs `/v1/chat/completions` are two shapes into ONE process.
    expect(
      await domainOf(resolve('ollama', 'http://127.0.0.1:11434/api/chat', 'ornith-1.5:9b')),
    ).toBe(
      await domainOf(resolve('ollama', 'http://127.0.0.1:11434/v1/chat/completions', 'qwen3:14b')),
    );
  });

  test('a trailing slash and casing do not fork the domain', async () => {
    expect(await domainOf(resolve('Ollama', 'http://127.0.0.1:11434/'))).toBe(
      await domainOf(resolve('ollama', 'http://127.0.0.1:11434')),
    );
  });

  test('two daemons on different ports are DIFFERENT domains', async () => {
    expect(await domainOf(resolve('ollama', 'http://127.0.0.1:11434'))).not.toBe(
      await domainOf(resolve('ollama', 'http://127.0.0.1:11435')),
    );
  });

  test('two providers never merge, even on one host', async () => {
    // A provider id names a configured route; two routes on one host may be
    // separate daemons, and the boundary is documented rather than assumed.
    expect(await domainOf(resolve('ollama', 'http://127.0.0.1:8080'))).not.toBe(
      await domainOf(resolve('llamacpp', 'http://127.0.0.1:8080')),
    );
  });

  test("the on-device pool is its own domain, never Ollama's", async () => {
    // Both are "local"; only one is the contended GPU. Merging them would
    // serialize a cheap browser path behind a local runtime for no reason.
    expect(await domainOf(resolve('local-qwen3', ''))).not.toBe(
      await domainOf(resolve('ollama', '')),
    );
  });

  test('an unparseable endpoint still yields a stable, distinct key', async () => {
    expect(await domainOf(resolve('custom', 'not-a-url'))).toBe(
      await domainOf(resolve('custom', 'NOT-A-URL/')),
    );
    expect(await domainOf(resolve('custom', 'not-a-url'))).not.toBe(
      await domainOf(resolve('custom', 'other')),
    );
  });

  test('an absent provider normalizes to one conservative bucket', async () => {
    // A route with no provider names no device, so it cannot be shown to be
    // independent of anything. Collapsing it into a single `unknown` domain
    // serializes it rather than risk running it alongside a request it might
    // contend with.
    expect(await domainOf(resolve('', 'http://127.0.0.1:11434'))).toBe(
      await domainOf(resolve('unknown', 'http://127.0.0.1:11434')),
    );
  });
});
