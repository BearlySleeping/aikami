// apps/frontend/client/src/lib/views/gallery/style_profile_editor_composition.ts
//
// Production wiring for the style profile editor. This is the only module in
// the feature that imports the style-profile singleton; the ViewModel receives
// it as a typed capability.

import { styleProfileService } from '$services';
import {
  createStyleProfileEditorViewModel,
  type StyleProfileEditorViewModelInterface,
  type StyleProfileEditorViewModelOptions,
} from './style_profile_editor_view_model.svelte';

/**
 * Builds the style-profile-editor ViewModel wired to the production
 * style-profile singleton.
 */
export const getStyleProfileEditorViewModel = (
  options: Omit<StyleProfileEditorViewModelOptions, 'styleProfile'>,
): StyleProfileEditorViewModelInterface =>
  createStyleProfileEditorViewModel({ ...options, styleProfile: styleProfileService });
