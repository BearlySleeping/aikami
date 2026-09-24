// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_composition.ts
//
// Production wiring for the HUD layout editor. The ViewModel receives the
// shared configured preference authority and measured view state as typed
// capabilities.

import { HUD_WIDGET_CAPABILITIES } from '@aikami/constants';
import { gameOverlayService } from '$services';
import { hudViewState } from '$views/game/ui/hud_view_state.svelte.ts';
import { configuredHudPreferenceService } from '$views/hud_preference_composition.ts';
import {
  createHudLayoutEditorViewModel,
  type HudLayoutEditorViewModelInterface,
  type HudLayoutEditorViewModelOptions,
} from './hud_layout_editor_view_model.svelte';

/**
 * Builds the HUD editor ViewModel wired to the production preference authority
 * and the measured viewport. Save and Cancel both return to the pause menu
 * through the ONE overlay router.
 */
export const getHudLayoutEditorViewModel = (
  options: Omit<
    HudLayoutEditorViewModelOptions,
    'hud' | 'visibility' | 'view' | 'capabilities' | 'dormantWidgetIds' | 'onClose'
  >,
): HudLayoutEditorViewModelInterface =>
  createHudLayoutEditorViewModel({
    ...options,
    hud: configuredHudPreferenceService,
    visibility: configuredHudPreferenceService,
    view: hudViewState,
    capabilities: [...HUD_WIDGET_CAPABILITIES],
    dormantWidgetIds: configuredHudPreferenceService.dormantWidgetIds,
    onClose: () => gameOverlayService.closeHudEditor(),
  });
