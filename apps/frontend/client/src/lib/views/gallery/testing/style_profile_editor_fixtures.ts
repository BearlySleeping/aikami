// apps/frontend/client/src/lib/views/gallery/testing/style_profile_editor_fixtures.ts
//
// Feature-owned test doubles for the style-profile-editor ViewModel.
// Operations are not defaulted to success: an unconfigured call throws, so a
// test cannot pass by accident on a silent no-op.

import type { ImageStyleProfile } from '@aikami/types';
import type { StyleProfileCapabilities } from '../style_profile_editor_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** A built-in style profile with sensible defaults. */
export const createStyleProfile = (
  overrides: Partial<ImageStyleProfile> = {},
): ImageStyleProfile => ({
  id: 'default',
  name: 'Default',
  isBuiltIn: true,
  promptGrammar: 'naturalLanguage',
  positiveTags: '',
  negativeTags: '',
  perImageTags: {},
  ...overrides,
});

/** Style-profile capability with an empty catalog until overridden. */
export const createStyleProfileCapabilities = (
  overrides: Partial<StyleProfileCapabilities> = {},
): StyleProfileCapabilities => ({
  profiles: [],
  activeProfile: undefined,
  activeProfileId: '',
  setActiveProfile: () => unconfigured('setActiveProfile'),
  cloneProfile: () => unconfigured('cloneProfile'),
  saveProfile: () => unconfigured('saveProfile'),
  deleteProfile: () => unconfigured('deleteProfile'),
  ...overrides,
});
