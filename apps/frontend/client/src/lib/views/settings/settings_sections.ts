// apps/frontend/client/src/lib/views/settings/settings_sections.ts
//
// Typed registry of all settings sections and the groups they belong to.
// Drives the group tab bar + section sub-nav in SettingsViewModel.
// Also provides shared per-section ViewModel factory lookup for all mounts.

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
import {
  getGameplayViewModel,
  type GameplayViewModelInterface,
} from './gameplay/gameplay_view_model.svelte';
import {
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable identifier used to select and deep-link a top-level settings group. */
export type SettingsGroupId = 'play' | 'ai' | 'content' | 'data' | 'account';

/** Application context that determines whether a settings section is available. */
export type SettingsContext = 'page' | 'pause' | 'onboarding';

/** Metadata rendered for a top-level group in the settings navigation shell. */
export type SettingsGroup = {
  /** Unique group identifier. */
  id: SettingsGroupId;
  /** Display label shown in the group tab bar. */
  label: string;
};

/** Registry entry describing a navigable settings section and its availability. */
export type SettingsSection = {
  /** Unique section identifier — matches existing sub-tab IDs where applicable. */
  id: string;
  /** Display label shown in the sub-nav. */
  label: string;
  /** Which group tab this section is nested under. */
  group: SettingsGroupId;
  /** Which UI contexts this section is available in. */
  contexts: readonly SettingsContext[];
  /** Heroicon name used as a lookup key by the grouped tab component. */
  icon: string;
  /** Optional capability key for badge display (e.g. 'ai', 'connection'). */
  capabilityKey?: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'account', label: 'Account' },
  { id: 'play', label: 'Play' },
  { id: 'ai', label: 'AI' },
  { id: 'content', label: 'Content' },
  { id: 'data', label: 'Data' },
] as const satisfies readonly SettingsGroup[];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ── Play ─────────────────────────────────────────────────────────────
  {
    id: 'controls',
    label: 'Controls',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'keyboard',
  },
  {
    id: 'audio',
    label: 'Audio',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'speaker',
  },
  {
    id: 'display',
    label: 'Display',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'monitor',
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'cog',
  },

  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'ai_privacy',
    label: 'AI & Privacy',
    group: 'ai',
    contexts: ['page'],
    icon: 'shield',
    capabilityKey: 'ai',
  },
  {
    id: 'ai',
    label: 'AI',
    group: 'ai',
    contexts: ['page', 'onboarding'],
    icon: 'cpu',
    capabilityKey: 'ai',
  },

  // ── Content ──────────────────────────────────────────────────────────
  {
    id: 'agents',
    label: 'Agents',
    group: 'content',
    contexts: ['page'],
    icon: 'users',
  },
  {
    id: 'autonomous',
    label: 'Automation',
    group: 'content',
    contexts: ['page'],
    icon: 'refresh',
  },
  {
    id: 'music',
    label: 'Music DJ',
    group: 'content',
    contexts: ['page'],
    icon: 'music',
  },

  // ── Account ──────────────────────────────────────────────────────────
  {
    id: 'account',
    label: 'Account',
    group: 'account',
    contexts: ['page'],
    icon: 'user',
  },

  // ── Data ─────────────────────────────────────────────────────────────
  {
    id: 'export',
    label: 'Export & Data',
    group: 'data',
    contexts: ['page'],
    icon: 'download',
  },
] as const satisfies readonly SettingsSection[];

/**
 * Returns the subset of settings sections whose contexts include the given context.
 * Shared by the full Settings page, the pause overlay, and the onboarding screen.
 */
export const sectionsForContext = (context: SettingsContext): readonly SettingsSection[] =>
  SETTINGS_SECTIONS.filter((s) => s.contexts.includes(context));

// ---------------------------------------------------------------------------
// Per-section ViewModel factory lookup
// ---------------------------------------------------------------------------

/** Union of section ViewModel interfaces that a simple mount (pause overlay) needs. */
export type SimpleSectionViewModel =
  | SettingsAudioViewModelInterface
  | SettingsControlsViewModelInterface
  | SettingsDisplayViewModelInterface
  | GameplayViewModelInterface;

const SECTION_VM_FACTORIES: Record<string, (options: BaseViewModelOptions) => BaseViewModelInterface> = {
  audio: (options: BaseViewModelOptions) => getSettingsAudioViewModel(options),
  controls: (options: BaseViewModelOptions) => getSettingsControlsViewModel(options),
  display: (options: BaseViewModelOptions) => getSettingsDisplayViewModel(options),
  gameplay: (options: BaseViewModelOptions) => getGameplayViewModel(options),
};

/**
 * Creates a section ViewModel for the given section ID.
 * Returns undefined if no factory is registered for that section.
 */
export const createSectionViewModel = (
  sectionId: string,
  options?: BaseViewModelOptions,
): BaseViewModelInterface | undefined => {
  const factory = SECTION_VM_FACTORIES[sectionId];
  return factory ? factory(options ?? { className: 'SectionViewModel' }) : undefined;
};

/**
 * Returns whether a factory exists for the given section ID.
 */
export const hasSectionViewModel = (sectionId: string): boolean =>
  sectionId in SECTION_VM_FACTORIES;
