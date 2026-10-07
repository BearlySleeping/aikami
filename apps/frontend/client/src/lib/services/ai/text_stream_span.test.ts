// apps/frontend/client/src/lib/services/ai/text_stream_span.test.ts
import { expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import { createAttemptSink } from './text_attempt_projection.ts';
import { createRequestDeadline } from './text_request_lifetime.ts';
import { createStreamSpan, type StreamObservation } from './text_stream_span.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

test('a resolved stream that fails before attempt reporting counts as dispatched', async () => {
  textTelemetryService.clear();
  const route: AiModeResolution = {
    capability: 'text',
    mode: 'byok',
    provider: 'openrouter',
    model: 'test-model',
    endpoint: 'https://example.test',
  };
  const deadline = createRequestDeadline({ deadlineAt: Date.now() + 1_000 });
  const observation: StreamObservation = {
    start: performance.now(),
    startedAt: new Date().toISOString(),
    resolution: undefined,
    task: undefined,
    ttftMs: undefined,
    promptChars: 1,
    completionChars: 0,
    deadline,
    lease: undefined,
    requestId: 'stream-test',
    attempts: createAttemptSink(),
    dispatched: false,
  };
  const failure = new Error('provider failed');
  const span = createStreamSpan({
    generate: async ({ onResolve }) => {
      onResolve(route);
      throw failure;
    },
    exposeRouting: (resolved) => {
      expect(resolved).toBe(route);
      expect(observation.resolution).toBe(route);
      expect(observation.dispatched).toBe(true);
    },
  });
  try {
    await expect(
      span.dispatch({
        request: {
          messages: [{ role: 'user', content: 'x' }],
          model: undefined,
          endpoint: undefined,
          task: undefined,
          route,
          onChunk: () => {},
          onFirstContent: () => {},
          onCharacters: () => {},
        },
        observation,
        signal: deadline.signal,
      }),
    ).rejects.toThrow(failure);
    span.recordFailure(observation, failure);
    expect(textTelemetryService.spans[0]?.dispatch).toBe('provider');
    expect(textTelemetryService.summary.counters.suppressed).toBe(0);
  } finally {
    deadline.dispose();
  }
});
