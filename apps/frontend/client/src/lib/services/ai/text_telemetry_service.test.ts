// apps/frontend/client/src/lib/services/ai/text_telemetry_service.test.ts
//
// Contract tests for the rolling text telemetry buffer (C-507, issue #382).
//
// The properties pinned here are the ones that make the buffer trustworthy:
// percentiles appear only when the sample count supports them, cache hits stay
// separated by layer, token provenance survives, and a cost total is withheld
// rather than silently under-reporting.

import { beforeEach, describe, expect, test } from 'bun:test';
import { estimateTextCostUsd, estimateTextTokens, TEXT_PRICING_VERSION } from '@aikami/constants';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

const baseSpan = {
  task: 'narration' as const,
  provider: 'openrouter',
  model: 'test/model',
  mode: 'byok',
  streamed: true,
  totalMs: 100,
  promptTokens: 10,
  completionTokens: 20,
  tokenSource: 'estimated' as const,
  ok: true,
};

describe('TextTelemetryService', () => {
  beforeEach(() => {
    textTelemetryService.clear();
  });

  test('records spans newest-first', () => {
    textTelemetryService.record({ ...baseSpan, model: 'first' });
    textTelemetryService.record({ ...baseSpan, model: 'second' });
    expect(textTelemetryService.spans[0].model).toBe('second');
    expect(textTelemetryService.spans[1].model).toBe('first');
  });

  test('caps the ring buffer at 100 spans', () => {
    for (let index = 0; index < 150; index++) {
      textTelemetryService.record({ ...baseSpan, totalMs: index });
    }
    expect(textTelemetryService.spans).toHaveLength(100);
  });

  test('summarizes count, median, tokens, and errors', () => {
    textTelemetryService.record({ ...baseSpan, totalMs: 100 });
    textTelemetryService.record({ ...baseSpan, totalMs: 200 });
    textTelemetryService.record({ ...baseSpan, totalMs: 300, ok: false });

    const summary = textTelemetryService.summary;
    expect(summary.count).toBe(3);
    expect(summary.medianTotalMs).toBe(200);
    expect(summary.totalTokens).toBe(90);
    expect(summary.errorCount).toBe(1);
  });

  test('empty buffer reports a zeroed summary with absent percentiles', () => {
    const summary = textTelemetryService.summary;
    expect(summary.count).toBe(0);
    expect(summary.medianTotalMs).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.byTask).toEqual([]);
    // A percentile over zero samples is not zero, it is absent.
    expect(summary.latency).toEqual({ count: 0, p50Ms: 0 });
    expect(summary.counters.calls).toBe(0);
    expect(summary.unpricedCount).toBe(0);
  });

  test('summarizes per-task latency so envelope extraction is measurable alone', () => {
    textTelemetryService.record({ ...baseSpan, task: 'dialogue', totalMs: 2000, ttftMs: 400 });
    textTelemetryService.record({ ...baseSpan, task: 'envelope', totalMs: 300, ttftMs: undefined });
    textTelemetryService.record({ ...baseSpan, task: 'envelope', totalMs: 500, ttftMs: undefined });

    const byTask = textTelemetryService.summary.byTask;
    const envelope = byTask.find((entry) => entry.task === 'envelope');
    const dialogue = byTask.find((entry) => entry.task === 'dialogue');

    expect(envelope).toEqual({
      task: 'envelope',
      count: 2,
      medianTotalMs: 400,
      errorCount: 0,
      latency: { count: 2, p50Ms: 400 },
    });
    expect(dialogue?.medianTtftMs).toBe(400);
  });

  test('clear empties the buffer', () => {
    textTelemetryService.record(baseSpan);
    textTelemetryService.clear();
    expect(textTelemetryService.spans).toHaveLength(0);
  });
});

describe('TextTelemetryService — latency percentiles', () => {
  beforeEach(() => {
    textTelemetryService.clear();
  });

  test('withholds p95/p99 below the minimum sample count', () => {
    for (const totalMs of [10, 20, 30]) {
      textTelemetryService.record({ ...baseSpan, totalMs });
    }
    const { latency } = textTelemetryService.summary;
    expect(latency.count).toBe(3);
    expect(latency.p50Ms).toBe(20);
    expect(latency.p95Ms).toBeUndefined();
    expect(latency.p99Ms).toBeUndefined();
  });

  test('publishes p95/p99 once the sample count supports them', () => {
    for (let index = 1; index <= 10; index++) {
      textTelemetryService.record({ ...baseSpan, totalMs: index * 10 });
    }
    const { latency } = textTelemetryService.summary;
    expect(latency.count).toBe(10);
    expect(latency.p50Ms).toBe(55);
    expect(latency.p95Ms).toBe(100);
    expect(latency.p99Ms).toBe(100);
  });

  test('a percentile names a real sample rather than an interpolated one', () => {
    for (const totalMs of [5, 7, 11, 13, 400, 900]) {
      textTelemetryService.record({ ...baseSpan, totalMs });
    }
    const { latency } = textTelemetryService.summary;
    expect(latency.p50Ms).toBe(12);
    expect(latency.p95Ms).toBe(900);
  });
});

describe('TextTelemetryService — counters', () => {
  beforeEach(() => {
    textTelemetryService.clear();
  });

  test('counts deadline overruns, cancellations and fallbacks', () => {
    textTelemetryService.record({ ...baseSpan, deadlineExceeded: true, totalMs: 4_000 });
    textTelemetryService.record({
      ...baseSpan,
      ok: false,
      errorCode: 'cancelled',
      totalMs: 200,
    });
    textTelemetryService.record({ ...baseSpan, ok: false, errorCode: 'fallback', totalMs: 300 });

    const { counters } = textTelemetryService.summary;
    expect(counters.calls).toBe(3);
    expect(counters.deadlineExceeded).toBe(1);
    expect(counters.cancelled).toBe(1);
    expect(counters.fallbacks).toBe(1);
  });

  test('keeps cache hits separated by layer', () => {
    textTelemetryService.record({ ...baseSpan, cacheLayer: 'in-flight-dedup' });
    textTelemetryService.record({ ...baseSpan, cacheLayer: 'exact-result' });
    textTelemetryService.record({ ...baseSpan, cacheLayer: 'provider-prompt-cache' });
    textTelemetryService.record({ ...baseSpan });

    // A provider prompt-prefix cache is not a saved call, and neither is a
    // local response-cache hit. Merging them would credit a mechanism that
    // saved nothing.
    expect(textTelemetryService.summary.counters.cacheHits).toEqual({
      none: 1,
      'in-flight-dedup': 1,
      'exact-result': 1,
      'provider-prompt-cache': 1,
    });
  });

  test('records the deepest local queue observed', () => {
    textTelemetryService.record({ ...baseSpan, queueDepth: 3 });
    textTelemetryService.record({ ...baseSpan, queueDepth: 7 });
    textTelemetryService.record({ ...baseSpan, queueDepth: 1 });
    expect(textTelemetryService.summary.counters.maxQueueDepth).toBe(7);
  });
});

describe('TextTelemetryService — token provenance and cost', () => {
  beforeEach(() => {
    textTelemetryService.clear();
  });

  test('keeps provider-reported counts distinct from estimates', () => {
    textTelemetryService.record({
      ...baseSpan,
      provider: 'local-qwen3',
      model: 'local-qwen3',
      promptTokens: 111,
      completionTokens: 222,
      tokenSource: 'provider',
      cachedTokens: 50,
    });
    textTelemetryService.record({ ...baseSpan });

    // Newest first, so the estimate recorded last is at index 0.
    const [estimated, reported] = textTelemetryService.spans;
    expect(reported.tokenSource).toBe('provider');
    expect(reported.cachedTokens).toBe(50);
    expect(estimated.tokenSource).toBe('estimated');
    expect(estimated.cachedTokens).toBeUndefined();
  });

  test('publishes a cost total only when every span is priced', () => {
    textTelemetryService.record({
      ...baseSpan,
      provider: 'local-qwen3',
      model: 'local-qwen3',
      promptTokens: 4_000,
      completionTokens: 4_000,
    });

    const summary = textTelemetryService.summary;
    expect(summary.unpricedCount).toBe(0);
    expect(summary.estimatedCostUsd).toBe(0);
    expect(summary.pricingVersion).toBe(TEXT_PRICING_VERSION);
  });

  test('withholds the total rather than under-reporting an unpriced model', () => {
    textTelemetryService.record({ ...baseSpan, model: 'unpriced/model' });

    const summary = textTelemetryService.summary;
    // A partial sum that looks complete is worse than no sum at all.
    expect(summary.estimatedCostUsd).toBeUndefined();
    expect(summary.unpricedCount).toBe(1);
    expect(summary.pricingVersion).toBeUndefined();
  });
});

describe('estimateTextTokens', () => {
  test('approximates four characters per token', () => {
    expect(estimateTextTokens(0)).toBe(0);
    expect(estimateTextTokens(4)).toBe(1);
    expect(estimateTextTokens(10)).toBe(3);
  });
});

describe('estimateTextCostUsd', () => {
  test('treats an on-device route as costing nothing regardless of the model', () => {
    expect(
      estimateTextCostUsd({
        provider: 'local-qwen3',
        model: 'qwen3-0.6b',
        inputTokens: 900,
        outputTokens: 900,
      }),
    ).toEqual({ usd: 0, source: 'local', pricingVersion: undefined });
  });
});
