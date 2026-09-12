// apps/frontend/client/src/lib/services/ai/text_task_params.ts
//
// Pure task-preset parameter merging. Kept out of the gateway service so the
// precedence rules are unit testable.

import { DEFAULT_TEXT_PARAMS, TEXT_TASK_PRESETS, type TextTask } from '@aikami/constants';
import type { TextParams } from '@aikami/types';

/**
 * Overlays a task preset onto connection params.
 *
 * `maxTokens` is treated as a cap: the effective budget is the smaller of the
 * connection's configured limit and the task's budget, so a task never asks
 * for more output than the model/connection allows (and a user who lowers
 * their connection cap still gets it honored). `temperature` is task-owned —
 * each task encodes its own sampling intent.
 *
 * A task-less call resolves to the active text provider (the narration role),
 * so it gets the narration preset rather than dropping the preset entirely.
 */
export const mergeTaskPresetParams = (options: {
  params?: TextParams;
  task?: TextTask;
}): TextParams => {
  const { params, task } = options;
  const preset = TEXT_TASK_PRESETS[task ?? 'narration'];
  const base = params ?? DEFAULT_TEXT_PARAMS;
  const maxTokens =
    base.maxTokens > 0 ? Math.min(base.maxTokens, preset.maxTokens) : preset.maxTokens;
  return { ...base, maxTokens, temperature: preset.temperature };
};
