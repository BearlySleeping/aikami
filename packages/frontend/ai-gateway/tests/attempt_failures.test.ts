// packages/frontend/ai-gateway/tests/attempt_failures.test.ts
import { expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import { createGatewayDeadline } from '../src/lib/deadline.ts';
import { createAiGatewayError } from '../src/lib/errors.ts';
import type { AiTransportAttemptDraft } from '../src/lib/gateway_types.ts';
import type { NativeStreamOutcome } from '../src/lib/ndjson.ts';
import type { ChatSseOutcome } from '../src/lib/sse.ts';
import { createOpenAiCompatibleTextAdapter } from '../src/lib/text_adapter_openai_compatible.ts';
import {
  type AttemptFacts,
  assertNativeOutcome,
  assertSseOutcome,
} from '../src/lib/text_outcome.ts';

const resolution: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
};
const report = { narrative: '', thinkingChars: 0, frameCount: 0, contentFrameCount: 0 };

for (const callerAbort of [true, false]) {
  test(`native and SSE aborts report ${callerAbort ? 'cancellation' : 'total budget expiry'}`, () => {
    const caller = new AbortController();
    if (callerAbort) {
      caller.abort();
    }
    const deadline = createGatewayDeadline({ callerSignal: caller.signal, deadlineAt: 0 });
    const expected = callerAbort ? 'cancelled' : 'timeout';
    for (const native of [true, false]) {
      const events: AttemptFacts[] = [];
      const options = {
        resolution,
        deadline,
        attempt: { kind: 'narrative' as const, transport: 'ndjson-stream' as const, startedAt: 0 },
        now: () => 10,
        onAttempt: (event: AttemptFacts) => events.push(event),
      };
      let thrown: unknown;
      try {
        if (native) {
          assertNativeOutcome({ ...options, outcome: { kind: 'aborted', report } });
        } else {
          assertSseOutcome({
            ...options,
            outcome: { kind: 'aborted', contentChars: 0, chunkCount: 0 },
          });
        }
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: expected });
      if (!callerAbort) {
        expect(thrown).toMatchObject({ timeoutKind: 'total_budget' });
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: expected, totalMs: 10 });
    }
    deadline.dispose();
  });
}

test('all throwing native and SSE dispositions report one failed attempt', () => {
  const deadline = createGatewayDeadline();
  const nativeOutcomes: NativeStreamOutcome[] = [
    { kind: 'first-content-timeout', report },
    { kind: 'idle-timeout', report },
    { kind: 'provider-error', message: 'unavailable', report },
    { kind: 'truncated', report },
    { kind: 'buffer-overflow', report },
  ];
  const sseKinds: ChatSseOutcome['kind'][] = [
    'first-chunk-timeout',
    'idle-timeout',
    'closed-early',
    'callback-failed',
  ];
  const events: AttemptFacts[] = [];
  const options = {
    resolution,
    deadline,
    attempt: { kind: 'narrative' as const, transport: 'ndjson-stream' as const, startedAt: 0 },
    now: () => 10,
    onAttempt: (event: AttemptFacts) => events.push(event),
  };
  for (const outcome of nativeOutcomes) {
    expect(() => assertNativeOutcome({ ...options, outcome })).toThrow();
  }
  for (const kind of sseKinds) {
    expect(() =>
      assertSseOutcome({
        ...options,
        outcome: {
          kind,
          contentChars: 0,
          chunkCount: 0,
          error: new Error('consumer failed'),
        },
      }),
    ).toThrow();
  }
  expect(events.map((event) => event.outcome)).toEqual([
    'timeout',
    'timeout',
    'error',
    'error',
    'error',
    'timeout',
    'timeout',
    'error',
    'error',
  ]);
  deadline.dispose();
});

for (const structured of [true, false]) {
  for (const code of ['timeout', 'cancelled', 'provider_unreachable'] as const) {
    test(`${structured ? 'structured' : 'narrative'} post rejection reports ${code}`, async () => {
      const failure = createAiGatewayError({
        code,
        capability: 'text',
        mode: 'offline',
        message: code,
      });
      const fetchFn = (async () => {
        throw failure;
      }) as typeof fetch;
      const events: AiTransportAttemptDraft[] = [];
      await expect(
        createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
          resolution,
          signal: new AbortController().signal,
          messages: [],
          ...(structured ? { schema: { type: 'object' }, schemaName: 'Result' } : {}),
          onAttempt: (event) => events.push(event),
        }),
      ).rejects.toMatchObject({ code });
      expect(events).toHaveLength(1);
      expect(events[0]?.outcome).toBe(code === 'provider_unreachable' ? 'error' : code);
    });
  }
}
