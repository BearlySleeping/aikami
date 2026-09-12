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
