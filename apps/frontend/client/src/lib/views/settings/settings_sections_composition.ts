// apps/frontend/client/src/lib/views/settings/settings_sections_composition.ts
//
// Production construction for the "simple" settings sections (Audio, Controls,
// Display, Gameplay) used by the pause overlay. Kept separate from
// settings_sections.ts so importing pure section metadata never pulls in the
// application service graph. This is the only module in the pair that may
// import section ViewModel factories.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  getSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './audio/settings_audio_view_model.svelte';
import {
  getSettingsControlsViewModel,
  type SettingsControlsViewModelInterface,
} from './controls/settings_controls_view_model.svelte';
import {
  getSettingsDisplayViewModel,
  type SettingsDisplayViewModelInterface,
} from './display/settings_display_view_model.svelte';
import { getGameplayViewModel } from './gameplay/gameplay_composition.ts';
import type { GameplayViewModelInterface } from './gameplay/gameplay_view_model.svelte';

// ---------------------------------------------------------------------------
// Per-section ViewModel factory lookup
// ---------------------------------------------------------------------------

/** Union of section ViewModel interfaces that a simple mount (pause overlay) needs. */
export type SimpleSectionViewModel =
  | SettingsAudioViewModelInterface
  | SettingsControlsViewModelInterface
  | SettingsDisplayViewModelInterface
  | GameplayViewModelInterface;

/** Typed section mount returned by the shared lazy factory. */
export type SimpleSectionViewModelMount =
  | { id: 'audio'; viewModel: SettingsAudioViewModelInterface }
  | { id: 'controls'; viewModel: SettingsControlsViewModelInterface }
  | { id: 'display'; viewModel: SettingsDisplayViewModelInterface }
  | { id: 'gameplay'; viewModel: GameplayViewModelInterface };

const SECTION_VM_FACTORIES = {
  audio: (options: BaseViewModelOptions): SimpleSectionViewModelMount => ({
    id: 'audio',
    viewModel: getSettingsAudioViewModel(options),
  }),
  controls: (options: BaseViewModelOptions): SimpleSectionViewModelMount => ({
    id: 'controls',
    viewModel: getSettingsControlsViewModel(options),
  }),
  display: (options: BaseViewModelOptions): SimpleSectionViewModelMount => ({
    id: 'display',
    viewModel: getSettingsDisplayViewModel(options),
  }),
  gameplay: (options: BaseViewModelOptions): SimpleSectionViewModelMount => ({
    id: 'gameplay',
    viewModel: getGameplayViewModel(options),
  }),
};

const _hasSectionViewModelFactory = (
  sectionId: string,
): sectionId is keyof typeof SECTION_VM_FACTORIES => Object.hasOwn(SECTION_VM_FACTORIES, sectionId);

/**
 * Creates a typed section mount for the given section ID.
 * Returns undefined if no factory is registered for that section.
 */
export const createSectionViewModelMount = (
  sectionId: string,
  options?: BaseViewModelOptions,
): SimpleSectionViewModelMount | undefined => {
  if (!_hasSectionViewModelFactory(sectionId)) {
    return undefined;
  }
  return SECTION_VM_FACTORIES[sectionId](options ?? { className: 'SectionViewModel' });
};

/**
 * Returns whether a factory exists for the given section ID.
 */
export const hasSectionViewModel = (sectionId: string): boolean =>
  _hasSectionViewModelFactory(sectionId);

/**
 * Creates a section ViewModel for the given section ID.
 * Returns undefined if no factory is registered for that section.
 */
export const createSectionViewModel = (
  sectionId: string,
  options?: BaseViewModelOptions,
): SimpleSectionViewModel | undefined => createSectionViewModelMount(sectionId, options)?.viewModel;
