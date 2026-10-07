// apps/frontend/client/src/lib/services/ai/text_telemetry_recorder.test.ts
import { expect, test } from 'bun:test';
import type { TextAttemptObservation } from '@aikami/types';
import { recordTextCall } from './text_telemetry_recorder.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

const attempt = (cachedTokens?: number): TextAttemptObservation => ({
  kind: 'structured',
  transport: 'buffered-json',
  outcome: 'completed',
  usage: {
    inputTokens: 10,
    outputTokens: 2,
    ...(cachedTokens === undefined ? {} : { cachedTokens, cachedSource: 'provider' }),
  },
});

test('cached provenance requires a count from every attempt, including explicit zero', () => {
  for (const [attempts, expected] of [
    [[attempt(3), attempt()], 'unknown'],
    [[attempt(3), { kind: 'structured', transport: 'buffered-json' }], 'unknown'],
    [[attempt(3), attempt(0)], 'provider'],
  ] as const) {
    textTelemetryService.clear();
    recordTextCall({
      start: performance.now(),
      startedAt: new Date().toISOString(),
      streamed: false,
      promptChars: 0,
      completionChars: 0,
      ok: true,
      attempts,
    });
    expect(textTelemetryService.spans[0]?.cachedSource).toBe(expected);
  }
});
