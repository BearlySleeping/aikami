// packages/frontend/ai-gateway/tests/native_usage.test.ts
//
// Ollama's native token accounting and phase counters (issue #382 P0).
//
// The rule this file enforces throughout: absence is UNKNOWN and is recorded
// as unknown. A missing counter defaulted to zero would read as "this call
// reused no cache" and "this call took no time to load" — two measurements that
// were never taken.
//
// Measured on Ollama 0.34.3: `prompt_eval_count`, `eval_count` and
// `prompt_eval_cached_count` are all present, and the cached counter is not
// always zero — a warm streamed call reported 18 against a prompt count of 22.
// Current documentation for newer releases describes capabilities this pinned
// runtime may not have; the wire wins.

import { describe, expect, test } from 'bun:test';
import { combineNativeUsage, readNativePhaseTimings, readNativeUsage } from '../src/index.ts';

describe('native usage — counters', () => {
  test('reads both counts and the cached counter when all three are present', () => {
    const usage = readNativeUsage({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 22,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: 314,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_cached_count: 18,
    });

    expect(usage).toEqual({
      inputTokens: 22,
      outputTokens: 314,
      cachedTokens: 18,
      cachedSource: 'provider',
      source: 'provider',
    });
  });

  test('records an ABSENT cached counter as unknown, never as zero', () => {
    const usage = readNativeUsage({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 100,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: 5,
    });

    expect(usage?.cachedSource).toBe('unknown');
    // A zero here would be indistinguishable from a measured absence of reuse.
    expect(usage?.cachedTokens).toBeUndefined();
  });

  test('a cached counter of 0 is a REAL measurement and is kept', () => {
    // The asymmetry matters: an explicit 0 says the runtime measured and found
    // no reuse, which is different from not having looked.
    const usage = readNativeUsage({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 40,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: 2,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_cached_count: 0,
    });

    expect(usage?.cachedTokens).toBe(0);
    expect(usage?.cachedSource).toBe('provider');
  });

  test('reports NOTHING for a partial pair rather than half a total', () => {
    // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
    expect(readNativeUsage({ prompt_eval_count: 22 })).toBeUndefined();
    // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
    expect(readNativeUsage({ eval_count: 314 })).toBeUndefined();
    // A partial count is not a smaller count. Presenting half of a total as the
    // total is the failure this guards.
  });

  test.each([-1, 1.5, Number.NaN, '12', null])('rejects a non-count value %p', (value) => {
    const usage = readNativeUsage({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 10,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: value,
    });
    // A fractional or negative count is a provider bug or a different quantity
    // wearing the same field name.
    expect(usage).toBeUndefined();
  });

  test('rejects a non-object payload', () => {
    expect(readNativeUsage(null)).toBeUndefined();
    expect(readNativeUsage('nope')).toBeUndefined();
    expect(readNativeUsage(undefined)).toBeUndefined();
  });

  test('marks counters from an interrupted stream as PARTIAL', () => {
    const frame = {
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 50,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: 7,
    };
    expect(readNativeUsage(frame)?.partial).toBeUndefined();
    // Known numbers plus an unknown remainder must not be presented as a
    // complete total — that is how a truncated generation looks cheap.
    expect(readNativeUsage(frame, { partial: true })?.partial).toBe(true);
  });

  test('NEVER infers a cached count from timing', () => {
    // A fast prompt can be a cache hit or a tiny prompt. The frame below has
    // durations and no cached counter; guessing would fabricate a saving.
    const usage = readNativeUsage({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_count: 12,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_count: 3,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_duration: 1_000_000,
    });

    expect(usage?.cachedTokens).toBeUndefined();
    expect(usage?.cachedSource).toBe('unknown');
  });
});

describe('native usage — phase timings', () => {
  test('converts nanoseconds to milliseconds exactly once', () => {
    const timings = readNativePhaseTimings({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      load_duration: 2_990_386_631,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      prompt_eval_duration: 60_844_000,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      eval_duration: 6_520_994_000,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      total_duration: 9_575_038_330,
    });

    // Raw nanoseconds here would report prefill as a million times too large.
    expect(timings).toEqual({
      modelLoadMs: 2990,
      prefillMs: 61,
      generationMs: 6521,
      providerTotalMs: 9575,
    });
  });

  test('omits absent counters rather than reporting them as zero', () => {
    const timings = readNativePhaseTimings({});
    expect(timings).toEqual({});
    // "The provider said 0 ms of prefill" and "the provider said nothing about
    // prefill" are different claims.
  });

  test('rejects negative or non-numeric durations', () => {
    expect(
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      readNativePhaseTimings({ load_duration: -1 }).modelLoadMs,
    ).toBeUndefined();
    expect(
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      readNativePhaseTimings({ eval_duration: 'fast' }).generationMs,
    ).toBeUndefined();
  });
});

describe('native usage — combining two attempts on one request', () => {
  const side = (
    over: Partial<{
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
      partial?: boolean;
    }> = {},
  ) => ({
    inputTokens: 100,
    outputTokens: 10,
    ...(over.cachedTokens === undefined ? {} : { cachedTokens: over.cachedTokens }),
    cachedSource: over.cachedTokens === undefined ? ('unknown' as const) : ('provider' as const),
    source: 'provider' as const,
    ...(over.partial === true ? { partial: true } : {}),
  });

  test('sums two provider-reported attempts', () => {
    // Both attempts were billed; keeping only the survivor's numbers
    // under-reports real spend by whatever the discarded one cost.
    expect(
      combineNativeUsage({ first: side({ cachedTokens: 30 }), second: side({ cachedTokens: 20 }) }),
    ).toEqual({
      inputTokens: 200,
      outputTokens: 20,
      cachedTokens: 50,
      cachedSource: 'provider',
      source: 'provider',
    });
  });

  test('degrades cachedSource when only one side reported a cached count', () => {
    const combined = combineNativeUsage({ first: side({ cachedTokens: 30 }), second: side() });
    // A sum with an unknown component is unknown, not provider-reported.
    expect(combined?.cachedSource).toBe('unknown');
    expect(combined?.cachedTokens).toBeUndefined();
  });

  test('partial survives if EITHER side was partial', () => {
    const combined = combineNativeUsage({ first: side(), second: side({ partial: true }) });
    expect(combined?.partial).toBe(true);
  });

  test('returns the single present side unchanged', () => {
    const only = side({ cachedTokens: 5 });
    expect(combineNativeUsage({ first: only })).toEqual(only);
    expect(combineNativeUsage({ second: only })).toEqual(only);
    expect(combineNativeUsage({})).toBeUndefined();
  });
});
