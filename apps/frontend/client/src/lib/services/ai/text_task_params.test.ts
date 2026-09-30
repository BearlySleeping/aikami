// apps/frontend/client/src/lib/services/ai/text_task_params.test.ts
//
// Unit tests for task-preset parameter merging (cap semantics).

import { describe, expect, test } from 'bun:test';
import { DEFAULT_TEXT_PARAMS, TEXT_TASK_PRESETS } from '@aikami/constants';
import type { TextParams } from '@aikami/types';
import { mergeTaskPresetParams } from './text_task_params.ts';

const params = (overrides: Partial<TextParams> = {}): TextParams => ({
  ...DEFAULT_TEXT_PARAMS,
  ...overrides,
});

describe('mergeTaskPresetParams', () => {
  test('applies the narration preset when no task is given', () => {
    const base = params({ maxTokens: 500, temperature: 0.1 });
    const merged = mergeTaskPresetParams({ params: base });
    // Task-less calls resolve to the active (narration) provider.
    expect(merged.temperature).toBe(TEXT_TASK_PRESETS.narration.temperature);
    expect(merged.maxTokens).toBe(Math.min(500, TEXT_TASK_PRESETS.narration.maxTokens));
    expect(merged.topP).toBe(base.topP);
  });

  test('caps maxTokens at the smaller of connection and task budget', () => {
    const task = 'narration';
    const preset = TEXT_TASK_PRESETS[task];

    expect(mergeTaskPresetParams({ params: params({ maxTokens: 256 }), task })?.maxTokens).toBe(
      256,
    );
    expect(mergeTaskPresetParams({ params: params({ maxTokens: 99_999 }), task })?.maxTokens).toBe(
      preset.maxTokens,
    );
  });

  test('uses the task temperature', () => {
    const merged = mergeTaskPresetParams({
      params: params({ temperature: 0.1 }),
      task: 'combat-intent',
    });
    expect(merged?.temperature).toBe(TEXT_TASK_PRESETS['combat-intent'].temperature);
  });

  test('falls back to defaults when connection params are absent', () => {
    const merged = mergeTaskPresetParams({ task: 'summarization' });
    expect(merged?.maxTokens).toBe(
      Math.min(DEFAULT_TEXT_PARAMS.maxTokens, TEXT_TASK_PRESETS.summarization.maxTokens),
    );
    expect(merged?.temperature).toBe(TEXT_TASK_PRESETS.summarization.temperature);
  });

  test('a zero connection maxTokens uses the task budget', () => {
    const merged = mergeTaskPresetParams({ params: params({ maxTokens: 0 }), task: 'narration' });
    expect(merged?.maxTokens).toBe(TEXT_TASK_PRESETS.narration.maxTokens);
  });
});

describe('mergeTaskPresetParams — reasoning is not a connection param', () => {
  test('the task preference is the ONLY owner, and mergeTaskPresetParams never carries it', () => {
    // The regression this pins: reasoning is a property of the CALL, not of the
    // saved connection. If it ever reappears on `TextParams`, a stored
    // connection could switch the fix back off without the user ever having
    // configured anything — and nothing in the settings UI can set it, so no
    // user would understand why it stopped working.
    expect('reasoning' in mergeTaskPresetParams({ task: 'envelope' })).toBe(false);
    expect('reasoning' in mergeTaskPresetParams({ task: 'dialogue' })).toBe(false);
    expect('reasoning' in mergeTaskPresetParams({})).toBe(false);
  });

  test('the task presets still declare the preference', () => {
    expect(TEXT_TASK_PRESETS.envelope.reasoning).toBe('none');
  });

  test('merging leaves the connection params key-free of reasoning', () => {
    // `mergeTaskPresetParams` spreads the connection, so a stored value WOULD
    // survive into the merged object. That is harmless because the adapter
    // reads the resolution's own field, never `params.reasoning` — pinned in
    // @aikami/frontend-ai-gateway ("the preference cannot be smuggled in
    // through the connection params"). This test documents that the reason it
    // is harmless is NOT that the merge filters the key.
    //
    // The result is read through an untyped view on purpose: `TextParams` does
    // not declare `reasoning`, so a typed property access here is a type error
    // that `bun test` (which strips types) and `client:typecheck` (which does
    // not cover `*.test.ts`) would both miss.
    const smuggled = params({ reasoning: 'none' } as Record<string, unknown> as TextParams);
    const merged: Record<string, unknown> = mergeTaskPresetParams({
      params: smuggled,
      task: 'narration',
    });
    expect(merged.reasoning).toBe('none');
  });

  test('no player-facing narrative task opts out of reasoning', () => {
    for (const task of ['narration', 'dialogue', 'combat-narration', 'combat-ai'] as const) {
      expect(TEXT_TASK_PRESETS[task].reasoning).toBeUndefined();
    }
  });
});
