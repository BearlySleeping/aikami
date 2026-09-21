// apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_composition.ts
//
// Production wiring for the NPC schedule editor. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { npcScheduleService, textGenerationService } from '$services';
import {
  createScheduleEditorViewModel,
  type ScheduleEditorViewModelInterface,
} from './schedule_editor_view_model.svelte';

/**
 * Builds the schedule-editor ViewModel wired to the production schedule and
 * text-generation singletons.
 */
export const getScheduleEditorViewModel = (
  options: BaseViewModelOptions,
): ScheduleEditorViewModelInterface =>
  createScheduleEditorViewModel({
    ...options,
    schedules: npcScheduleService,
    generation: textGenerationService,
  });
