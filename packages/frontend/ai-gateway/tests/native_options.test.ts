// packages/frontend/ai-gateway/tests/native_options.test.ts
//
// Effective `TextParams` → Ollama native `options` (issue #382).
//
// The two properties under test both come from measured facts, not from taste
// (see `docs/research/audits/382-native-transport-plan.md`):
//
//   1. Before this, `buildGenerationParams` returned `{}` for Ollama, so every
//      configured limit was silently UNHONOURED on the native route.
//   2. Ollama 0.34.3 answers **200 to an option it does not understand** — a
//      probe carrying `totally_made_up_option: 5` succeeded silently. Support
//      therefore CANNOT be discovered from the provider, and the only honest
//      mechanism is an allow-list of measured fields plus an explicit report of
//      what was left out.
//
// A field that is sent and ignored is worse than a field that is not sent,
// because the configuration then reads as active while behaving as default.

import { describe, expect, test } from 'bun:test';
import type { TextParams } from '@aikami/types';
import { buildNativeOptions, resolveNativeMaxTokens } from '../src/index.ts';

const params = (overrides?: Partial<TextParams>): TextParams => ({
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.1,
  presencePenalty: 0,
  maxTokens: 1024,
  contextSize: 4096,
  ...overrides,
});

describe('native options — measured allow-list', () => {
  test('maps the fields with a measured native spelling', () => {
    const report = buildNativeOptions({ params: params() });

    expect(report.options).toEqual({
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      num_predict: 1024,
      temperature: 0.7,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      top_p: 0.9,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      top_k: 40,
      // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
      repeat_penalty: 1.1,
    });
    // Both are named rather than silently dropped, which is the whole point of
    // the report: a caller can be told which configured settings are NOT in
    // effect on this surface.
    expect(report.unmapped).toEqual(['contextSize', 'presencePenalty']);
    expect(report.rejected).toEqual([]);
  });

  test('OMITS and REPORTS fields with no native spelling, rather than approximating', () => {
    const report = buildNativeOptions({ params: params({ presencePenalty: 0.7 }) });

    // OpenAI's `presence_penalty` is not a native Ollama option. Substituting
    // the repetition penalty for it would change generation behaviour under a
    // name that claims otherwise, and the provider would answer 200 either way.
    expect('presence_penalty' in report.options).toBe(false);
    expect(report.unmapped).toContain('presencePenalty');
    // It is NAMED, so a caller can be told "this setting is not in effect".
    expect(report.mapped.map(([field]) => field)).not.toContain('presencePenalty');
  });

  test('omits contextSize by default, because num_ctx is a residency decision', () => {
    const report = buildNativeOptions({ params: params() });
    // Sending `num_ctx` on every call reallocates the KV cache on requests that
    // did not need it. Opt-in keeps residency policy unchanged.
    expect('num_ctx' in report.options).toBe(false);
    expect(report.unmapped).toContain('contextSize');

    const opted = buildNativeOptions({ params: params(), includeContextSize: true });
    expect(opted.options.num_ctx).toBe(4096);
  });

  test('reports an out-of-range value as REJECTED, which is a different defect', () => {
    const report = buildNativeOptions({ params: params({ topP: 4.5 }) });

    // An unmapped field is a platform limitation; a rejected value is bad
    // config. Collapsing them would hide a user's typo.
    expect('top_p' in report.options).toBe(false);
    expect(report.rejected).toContain('topP');
  });

  test('never ROUNDS a continuous knob — temperature 0.7 must stay 0.7', () => {
    // Flooring this to 0 would make generation greedy and deterministic: a
    // change in creative output that would look like a performance fix.
    const report = buildNativeOptions({ params: params() });
    expect(report.options.temperature).toBe(0.7);
    expect(report.options.top_p).toBe(0.9);
    expect(report.options.repeat_penalty).toBe(1.1);
  });

  test('rounds only the COUNT parameters, which must be whole', () => {
    const report = buildNativeOptions({ params: params({ topK: 40.7, maxTokens: 1024 }) });
    expect(report.options.top_k).toBe(40);
    expect(report.options.num_predict).toBe(1024);
  });

  test('sends nothing, and reports nothing, when the connection has no params', () => {
    const report = buildNativeOptions();
    expect(report.options).toEqual({});
    expect(report.mapped).toEqual([]);
    expect(report.unmapped).toEqual([]);
  });
});

describe('native options — the token cap', () => {
  test('keeps min(connection cap, task cap); neither may widen the other', () => {
    expect(resolveNativeMaxTokens({ connectionCap: 400, taskCap: 1024 })).toBe(400);
    expect(resolveNativeMaxTokens({ connectionCap: 1024, taskCap: 400 })).toBe(400);
    expect(resolveNativeMaxTokens({ connectionCap: 400, taskCap: 400 })).toBe(400);
  });

  test('uses whichever single cap is present', () => {
    expect(resolveNativeMaxTokens({ connectionCap: 512 })).toBe(512);
    expect(resolveNativeMaxTokens({ taskCap: 256 })).toBe(256);
  });

  test('sends NO cap when none is configured', () => {
    // The honest "no cap" answer. The provider default then applies, which is
    // exactly the pre-change behaviour.
    expect(resolveNativeMaxTokens({})).toBeUndefined();
    const report = buildNativeOptions({ params: params({ maxTokens: undefined as never }) });
    expect(report.options.num_predict).toBeUndefined();
  });

  test('refuses to send a nonsensical cap rather than silently widening it', () => {
    // Returning the valid side would quietly discard the user's 0 and send
    // 1024, which is the opposite of what a zero means.
    expect(resolveNativeMaxTokens({ connectionCap: 0, taskCap: 1024 })).toBeUndefined();
    expect(resolveNativeMaxTokens({ connectionCap: -5 })).toBeUndefined();
    expect(resolveNativeMaxTokens({ connectionCap: 1.5 })).toBeUndefined();
  });

  test('applies the narrower cap and echoes it back for attribution', () => {
    const report = buildNativeOptions({ params: params({ maxTokens: 1024 }), taskCap: 400 });

    expect(report.options.num_predict).toBe(400);
    // Surfaced so a `done_reason: "length"` truncation can be attributed to this
    // decision rather than guessed at from a short output.
    expect(report.effectiveMaxTokens).toBe(400);
  });

  test('a cap that was never in effect can now truncate a reasoning model', () => {
    // `num_predict` bounds TOTAL generated tokens, and on a reasoning model
    // that budget is shared with the thinking channel. Turning a limit on that
    // used to be ignored can therefore shorten an answer that previously
    // completed — which the provider reports as `done_reason: "length"`.
    // This is the behaviour change the report has to measure, not assume.
    const report = buildNativeOptions({ params: params({ maxTokens: 400 }), taskCap: 400 });
    expect(report.effectiveMaxTokens).toBe(400);
    // The cap is applied, not silently dropped, so the risk is visible.
    expect(report.mapped).toContainEqual(['maxTokens', 'num_predict']);
  });
});
