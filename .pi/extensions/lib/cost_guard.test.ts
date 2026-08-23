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
  'PI_THINK_REPETITION_THRESHOLD',
  'PI_CYCLE_THRESHOLD',
  'PI_LOOP_THRESHOLD',
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

  /** A turn whose narration lives in `thinking` blocks, as DeepSeek emits. */
  const thinkingTurn = (options: { thinking: string; command?: string; usage?: unknown }) => ({
    message: {
      content: [
        { type: 'thinking', thinking: options.thinking },
        ...(options.command
          ? [{ type: 'toolCall', name: 'bash', arguments: { command: options.command } }]
          : []),
      ],
      ...(options.usage === undefined ? { usage: { input: 10, output: 10 } } : {}),
    },
  });

  return { pi, calls, emit, turn, thinkingTurn };
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

/**
 * Blind spots found on 2026-08-23, when a session alternated two identical
 * tool calls for 26 cycles and then emitted 169,607 characters of reasoning
 * repeating one sentence 177 times — and the guard did not fire once, because
 * every check it owns reads `text` blocks and counts only consecutive repeats.
 */
describe('cost guard sees reasoning blocks', () => {
  test('halts on a repeating A-B-A-B cycle of tool calls', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    const a = {
      message: {
        content: [{ type: 'toolCall', name: 'bash', arguments: { c: 1 } }],
        usage: { input: 10, output: 10 },
      },
    };
    const b = {
      message: {
        content: [{ type: 'toolCall', name: 'read', arguments: { p: 'x' } }],
        usage: { input: 10, output: 10 },
      },
    };
    for (let i = 0; i < 40; i++) {
      await emit('turn_end', i % 2 === 0 ? a : b);
    }

    expect(calls.steer.some((m) => m.includes('LOOP GUARD'))).toBe(true);
    expect(calls.shutdown).toBe(1);
    expect(calls.abort).toBe(1);
  });

  test('does not fire when the two alternating calls differ each time', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    for (let i = 0; i < 60; i++) {
      await emit('turn_end', {
        message: {
          content: [
            {
              type: 'toolCall',
              name: i % 2 === 0 ? 'bash' : 'read',
              arguments: { step: i },
            },
          ],
          usage: { input: 10, output: 10 },
        },
      });
    }

    expect(calls.shutdown).toBe(0);
  });

  test('detects repetition collapse inside thinking blocks', async () => {
    const { pi, calls, emit, thinkingTurn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    // The observed shape: empty text, one sentence repeated far past the
    // reasoning threshold. Two strikes are required before halting.
    const collapsed = 'Actually, let me reconsider the whole thing. '.repeat(60);
    await emit('turn_end', thinkingTurn({ thinking: collapsed }));
    expect(calls.steer.some((m) => m.includes('REPETITION GUARD'))).toBe(true);
    expect(calls.shutdown).toBe(0);

    await emit('turn_end', thinkingTurn({ thinking: collapsed }));
    expect(calls.shutdown).toBe(1);
  });

  test('tolerates the code a healthy turn drafts in its reasoning', async () => {
    // Measured over 27,783 stored reasoning blocks: healthy turns repeat
    // "```typescript" up to 37 times while drafting. That must not trip.
    const { pi, calls, emit, thinkingTurn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    const drafting = '```typescript\nconst value = compute();\n```\n'.repeat(37);
    for (let i = 0; i < 10; i++) {
      await emit('turn_end', thinkingTurn({ thinking: drafting, command: `step-${i}` }));
    }

    expect(calls.shutdown).toBe(0);
    expect(calls.steer).toHaveLength(0);
  });

  test('runs the guards on a turn that reports no usage', async () => {
    // An aborted or interrupted turn carries no usage. The old `if
    // (!usage?.input) return;` sat above every detector, so those turns —
    // exactly the ones a wedged run produces — were never examined.
    const { pi, calls, emit, thinkingTurn } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});

    const collapsed = 'Actually, let me reconsider the whole thing. '.repeat(60);
    await emit('turn_end', thinkingTurn({ thinking: collapsed, usage: null }));
    await emit('turn_end', thinkingTurn({ thinking: collapsed, usage: null }));

    expect(calls.shutdown).toBe(1);
  });
});

/**
 * Mid-stream detection.
 *
 * `turn_end` fires only once a turn is complete, so a collapsing generation
 * ran unchecked until it exhausted maxTokens. On 2026-08-23 one reached
 * 298,477 characters and the user's Ctrl+C is what ended it — the guard then
 * reported "x192" to a session that was already dead.
 */
describe('cost guard mid-stream collapse detection', () => {
  const streaming = (thinking: string) => ({
    message: { role: 'assistant', content: [{ type: 'thinking', thinking }] },
  });

  test('aborts a collapsing generation while it is still streaming', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});
    await emit('message_start', {});

    // Grow the buffer the way a collapse does, one chunk at a time.
    let thinking = '';
    for (let i = 0; i < 400 && calls.abort === 0; i++) {
      thinking += 'Actually, let me reconsider the whole thing. ';
      await emit('message_update', streaming(thinking));
    }

    expect(calls.abort).toBe(1);
    expect(calls.steer.some((m) => m.includes('REPETITION GUARD'))).toBe(true);
    // Cut off within the first scan window — the real collapse reached 298,477.
    expect(thinking.length).toBeLessThan(12000);
  });

  test('does not scan or fire on a healthy streaming message', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});
    await emit('message_start', {});

    // Genuinely varied prose — each sentence differs, as real reasoning does.
    let thinking = '';
    for (let i = 0; i < 400; i++) {
      thinking += `The caller at index ${i} passes a ${i % 2 === 0 ? 'string' : 'number'} `;
      thinking += `so the branch taken there resolves to case ${i * 7}. `;
      await emit('message_update', streaming(thinking));
    }

    expect(thinking.length).toBeGreaterThan(30000);
    expect(calls.abort).toBe(0);
    expect(calls.shutdown).toBe(0);
  });

  test('tolerates code drafted inside a streaming reasoning block', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});
    await emit('message_start', {});

    let thinking = '';
    for (let i = 0; i < 37; i++) {
      thinking += '```typescript\nconst value = compute();\n```\n';
      await emit('message_update', streaming(thinking));
    }

    expect(calls.abort).toBe(0);
  });

  test('ignores non-assistant messages', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('message_start', {});
    await emit('message_update', {
      message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(50000) }] },
    });
    expect(calls.abort).toBe(0);
  });
});

describe('cost guard strike accounting across the stream boundary', () => {
  const streaming = (thinking: string) => ({
    message: { role: 'assistant', content: [{ type: 'thinking', thinking }] },
  });

  test('one collapse counts one strike, even though turn_end sees it again', async () => {
    const { pi, calls, emit } = harness();
    costGuard(pi as never);
    await emit('session_start', {});
    await emit('before_agent_start', {});
    await emit('message_start', {});

    let thinking = '';
    for (let i = 0; i < 400 && calls.abort === 0; i++) {
      thinking += 'Actually, let me reconsider the whole thing. ';
      await emit('message_update', streaming(thinking));
    }
    expect(calls.abort).toBe(1);

    // The aborted partial still arrives at turn_end. It must not be scored
    // a second time, or the first collapse would halt instead of steering.
    await emit('turn_end', {
      message: { content: [{ type: 'thinking', thinking }], usage: { input: 10, output: 10 } },
    });
    expect(calls.shutdown).toBe(0);

    // A second, separate collapse is what halts.
    await emit('message_start', {});
    let next = '';
    for (let i = 0; i < 400 && calls.shutdown === 0; i++) {
      next += 'Actually, let me reconsider the whole thing. ';
      await emit('message_update', streaming(next));
    }
    expect(calls.shutdown).toBe(1);
  });
});
