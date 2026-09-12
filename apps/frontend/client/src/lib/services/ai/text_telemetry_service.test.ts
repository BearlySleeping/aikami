// apps/frontend/client/src/lib/services/ai/text_telemetry_service.test.ts
//
// Contract tests for the rolling text telemetry buffer (C-507).

import { beforeEach, describe, expect, test } from 'bun:test';
import { estimateTextTokens } from '@aikami/constants';
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

  test('empty buffer reports a zeroed summary', () => {
    expect(textTelemetryService.summary).toEqual({
      count: 0,
      medianTotalMs: 0,
      totalTokens: 0,
      errorCount: 0,
      byTask: [],
    });
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
      medianTtftMs: undefined,
      errorCount: 0,
    });
    expect(dialogue?.medianTtftMs).toBe(400);
  });

  test('clear empties the buffer', () => {
    textTelemetryService.record(baseSpan);
    textTelemetryService.clear();
    expect(textTelemetryService.spans).toHaveLength(0);
  });
});

describe('estimateTextTokens', () => {
  test('approximates four characters per token', () => {
    expect(estimateTextTokens(0)).toBe(0);
    expect(estimateTextTokens(4)).toBe(1);
    expect(estimateTextTokens(10)).toBe(3);
  });
});
