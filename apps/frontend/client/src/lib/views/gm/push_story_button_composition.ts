// apps/frontend/client/src/lib/views/gm/push_story_button_composition.ts
//
// Production wiring for the Push Story button. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as a
// typed capability.

import { narrativeDirectorService } from '$services';
import {
  createPushStoryButtonViewModel,
  type PushStoryButtonViewModelInterface,
  type PushStoryButtonViewModelOptions,
} from './push_story_button_view_model.svelte';

/**
 * Builds the Push Story button ViewModel wired to the production narrative
 * director singleton.
 */
export const getPushStoryButtonViewModel = (
  options: Omit<PushStoryButtonViewModelOptions, 'narrative'>,
): PushStoryButtonViewModelInterface =>
  createPushStoryButtonViewModel({ ...options, narrative: narrativeDirectorService });
