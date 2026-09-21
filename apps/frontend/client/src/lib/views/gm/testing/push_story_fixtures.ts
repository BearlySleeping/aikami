// apps/frontend/client/src/lib/views/gm/testing/push_story_fixtures.ts
//
// Feature-owned test doubles for the Push Story button ViewModel. Operations are
// not defaulted to success: an unconfigured call throws.

import type { PushStoryCapabilities } from '../push_story_button_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Narrative-director capability whose push throws until overridden. */
export const createPushStoryCapabilities = (
  overrides: Partial<PushStoryCapabilities> = {},
): PushStoryCapabilities => ({
  pushStory: () => unconfigured('pushStory'),
  ...overrides,
});
