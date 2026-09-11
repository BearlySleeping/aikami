// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_composition.ts
//
// Production wiring for the in-game settings overlay. The ViewModel takes the
// section-factory capability explicitly; this module supplies the real
// `createSectionViewModelMount` and is the only place the overlay touches the
// production section-construction graph.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { createSectionViewModelMount } from '$lib/views/settings/settings_sections_composition';
import {
  createSettingsOverlayViewModel,
  type SettingsOverlayViewModelInterface,
} from './settings_overlay_view_model.svelte';

export const getSettingsOverlayViewModel = (
  options: BaseViewModelOptions,
): SettingsOverlayViewModelInterface =>
  createSettingsOverlayViewModel({ ...options, createSectionMount: createSectionViewModelMount });
