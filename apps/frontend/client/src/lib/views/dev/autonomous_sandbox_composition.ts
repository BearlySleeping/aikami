// apps/frontend/client/src/lib/views/dev/autonomous_sandbox_composition.ts
//
// Production wiring for the autonomous NPC behavior sandbox. This is the only
// module in the feature that imports the `$services` singletons and the child
// schedule-editor composition; the ViewModel receives typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { autonomousMessageService, idleDetectionService, npcScheduleService } from '$services';
import { getScheduleEditorViewModel } from '../settings/autonomous/schedule_editor_composition.ts';
import {
  type AutonomousSandboxViewModelInterface,
  createAutonomousSandboxViewModel,
} from './autonomous_sandbox_view_model.svelte';

/**
 * Builds the autonomous sandbox ViewModel wired to the idle, poller, schedule,
 * and schedule-editor singletons.
 */
export const getAutonomousSandboxViewModel = (
  options: BaseViewModelOptions,
): AutonomousSandboxViewModelInterface =>
  createAutonomousSandboxViewModel({
    ...options,
    idle: idleDetectionService,
    autonomousMessages: autonomousMessageService,
    schedules: npcScheduleService,
    scheduleEditor: getScheduleEditorViewModel({ className: 'ScheduleEditorViewModel' }),
  });
