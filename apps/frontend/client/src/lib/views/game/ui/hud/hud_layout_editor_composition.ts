// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_composition.ts
//
// Production wiring for the HUD layout editor. This is the only module in the
// feature that imports the `$services` singleton and the measured view state;
// the ViewModel receives both as typed capabilities.

import { HUD_WIDGET_CAPABILITIES } from '@aikami/constants';
import { featureFlags } from '@aikami/frontend/configs';
import { gameOverlayService, hudPreferenceService } from '$services';
import { hudViewState } from '$views/game/ui/hud_view_state.svelte.ts';
import {
  createHudLayoutEditorViewModel,
  type HudLayoutEditorViewModelInterface,
  type HudLayoutEditorViewModelOptions,
} from './hud_layout_editor_view_model.svelte';

/**
 * C-528 Migration & Rollback — apply the customization kill switch once, when
 * the editor's wiring loads.
 *
 * Disabling customization falls back to the shipped safe layout and leaves the
 * stored snapshot, unrelated preferences and every save untouched. The switch is
 * a build/environment flag (`PUBLIC_HUD_CUSTOMIZATION=0`), never a player
 * setting, so a rollback can never be mistaken for a player choice.
 */
hudPreferenceService.setEditorEnabled(featureFlags.hudCustomization);

/**
 * Builds the HUD editor ViewModel wired to the production preference authority
 * and the measured viewport. Save and Cancel both return to the pause menu
 * through the ONE overlay router.
 */
export const getHudLayoutEditorViewModel = (
  options: Omit<
    HudLayoutEditorViewModelOptions,
    'hud' | 'view' | 'capabilities' | 'dormantWidgetIds' | 'onClose'
  >,
): HudLayoutEditorViewModelInterface =>
  createHudLayoutEditorViewModel({
    ...options,
    hud: hudPreferenceService,
    view: hudViewState,
    capabilities: [...HUD_WIDGET_CAPABILITIES],
    dormantWidgetIds: hudPreferenceService.dormantWidgetIds,
    onClose: () => gameOverlayService.closeHudEditor(),
  });
