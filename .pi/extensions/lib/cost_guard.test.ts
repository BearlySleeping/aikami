import { afterEach, describe, expect, test } from 'bun:test';
import costGuard from '../cost_guard.ts';

/**
 * Regression cover for the guard's control flow.
 *
 * The bug these exist for: `_halt` had no latch, so once a cap was exceeded
 * the trip condition stayed true on every subsequent turn. The user saw
 * "Shutting down." printed on turn after turn while the session carried on
 * working — and `ctx.shutdown()` alone never stopped the in-flight agent loop,
 * because only `ctx.abort()` cancels the current operation.
 */

const ENV_KEYS = [
  'PI_MAX_TURNS',
  'PI_MAX_RUN_MINUTES',
  'PI_SOFT_SPEND',
  'PI_HARD_SPEND',
  'PI_REPETITION_GUARD',
  'CONTRACT_PIPELINE_ROLE',
  'CONTRACT_PIPELINE_RESULT_PATH',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

/** Build a pi/ctx pair that records what the guard did. */
const harness = () => {
  const handlers = new Map<string, Handler[]>();
  const calls = { notify: [] as string[], steer: [] as string[], abort: 0, shutdown: 0 };

  const pi = {
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    sendUserMessage: (message: string) => calls.steer.push(message),
  };

  const ctx = {
    model: { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ui: { notify: (message: string) => calls.notify.push(message) },
    abort: () => {
      calls.abort += 1;
    },
    shutdown: () => {
      calls.shutdown += 1;
    },
  };

  const emit = async (event: string, payload: unknown) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  };

  // A normal, varied working turn: real tool call, negligible cost.
  const turn = (command: string) => ({
    message: {
      content: [{ type: 'toolCall', name: 'bash', arguments: { command } }],
      usage: { input: 10, output: 10 },
    },
  });

  return { pi, calls, emit, turn };
};

describe('cost guard halt behaviour', () => {
  test('halts exactly once even though the cap stays exceeded', async () => {
    process.env.PI_MAX_TURNS = '3';
    const { pi, calls, emit, turn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    // Well past both the soft (3) and hard (4.5) turn thresholds.
    for (let i = 0; i < 40; i++) {
      await emit('turn_end', turn(`cmd-${i}`));
    }

    const shutdownNotices = calls.notify.filter((n) => n.includes('Shutting down'));
    expect(shutdownNotices).toHaveLength(1);
    expect(calls.shutdown).toBe(1);
  });

  test('aborts the agent loop, not just shutdown', async () => {
    // shutdown() asks pi to exit but does not cancel the running turn; without
    // abort() the session simply continued to the next turn.
    process.env.PI_MAX_TURNS = '3';
    const { pi, calls, emit, turn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    for (let i = 0; i < 20; i++) {
      await emit('turn_end', turn(`cmd-${i}`));
    }

    expect(calls.abort).toBe(1);
    expect(calls.shutdown).toBe(1);
  });

  test('wraps up before halting rather than killing outright', async () => {
    process.env.PI_MAX_TURNS = '4';
    const { pi, calls, emit, turn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    for (let i = 0; i < 4; i++) {
      await emit('turn_end', turn(`cmd-${i}`));
    }
    // At the soft threshold: steered, still alive.
    expect(calls.steer.some((m) => m.includes('RUN BUDGET'))).toBe(true);
    expect(calls.shutdown).toBe(0);
  });

  test('does not fire on a long but healthy run below the cap', async () => {
    // Measured: real sessions reach 821 turns on one prompt. The old 120
    // default killed 23% of them.
    const { pi, calls, emit, turn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    for (let i = 0; i < 800; i++) {
      await emit('turn_end', turn(`cmd-${i}`));
    }

    expect(calls.shutdown).toBe(0);
    expect(calls.abort).toBe(0);
  });

  test('a new user prompt clears the turn budget and the halt latch', async () => {
    process.env.PI_MAX_TURNS = '3';
    const { pi, calls, emit, turn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    for (let i = 0; i < 20; i++) {
      await emit('turn_end', turn(`cmd-${i}`));
    }
    expect(calls.shutdown).toBe(1);

    // A fresh prompt is a new run: budget resets, and a later trip can halt again.
    await emit('before_agent_start', {});
    for (let i = 0; i < 20; i++) {
      await emit('turn_end', turn(`next-${i}`));
    }
    expect(calls.shutdown).toBe(2);
  });
});
