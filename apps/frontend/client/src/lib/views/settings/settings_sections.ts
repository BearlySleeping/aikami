// apps/frontend/client/src/lib/views/settings/settings_sections.ts
//
// Typed registry of all settings sections and the groups they belong to.
// Drives the group tab bar + section sub-nav in SettingsViewModel.
// Also provides shared per-section ViewModel factory lookup for all mounts.

import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services';
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
  type GameplayViewModelInterface,
  getGameplayViewModel,
} from './gameplay/gameplay_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable identifier used to select and deep-link a top-level settings group. */
export type SettingsGroupId = 'play' | 'ai' | 'content' | 'data' | 'account';

/** Application context that determines whether a settings section is available. */
export type SettingsContext = 'page' | 'pause' | 'onboarding';

/** Platform context for filtering native vs browser controls. */
export type SettingsPlatform = 'web' | 'native';

/** Metadata rendered for a top-level group in the settings navigation shell. */
export type SettingsGroup = {
  /** Unique group identifier. */
  id: SettingsGroupId;
  /** Display label shown in the group tab bar. */
  label: string;
  /** Icon name for the group. */
  icon?: string;
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
  /** Platform availability — omit for all platforms. */
  platforms?: readonly SettingsPlatform[];
  /** Heroicon name used as a lookup key by the grouped tab component. */
  icon: string;
  /** Optional capability key for badge display (e.g. 'ai', 'connection'). */
  capabilityKey?: string;
  /** Search keywords for section search. */
  searchTags?: readonly string[];
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'play', label: 'Play', icon: 'gamepad' },
  { id: 'ai', label: 'AI', icon: 'cpu' },
  { id: 'content', label: 'Content', icon: 'folder' },
  { id: 'data', label: 'Data', icon: 'database' },
  { id: 'account', label: 'Account', icon: 'user' },
] as const satisfies readonly SettingsGroup[];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ── Play ─────────────────────────────────────────────────────────────
  {
    id: 'controls',
    label: 'Controls',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'keyboard',
    searchTags: ['keyboard', 'input', 'key bindings'],
  },
  {
    id: 'audio',
    label: 'Audio',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'speaker',
    searchTags: ['sound', 'volume', 'music', 'voice'],
  },
  {
    id: 'display',
    label: 'Display',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'monitor',
    searchTags: ['screen', 'visual', 'graphics', 'theme'],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'cog',
    searchTags: ['game', 'difficulty', 'rules'],
  },

  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'story-dialogue',
    label: 'Story & Dialogue',
    group: 'ai',
    contexts: ['page'],
    icon: 'chat',
    capabilityKey: 'text',
    searchTags: ['text', 'chat', 'narrative', 'story generation', 'dialog'],
  },
  {
    id: 'artwork',
    label: 'Artwork',
    group: 'ai',
    contexts: ['page'],
    icon: 'image',
    capabilityKey: 'image',
    searchTags: ['image', 'art', 'drawing', 'illustration', 'visual'],
  },
  {
    id: 'read-aloud',
    label: 'Read Aloud',
    group: 'ai',
    contexts: ['page'],
    icon: 'volume',
    capabilityKey: 'voice',
    searchTags: ['voice', 'speech', 'tts', 'narrator', 'audio'],
  },

  // ── Content ──────────────────────────────────────────────────────────
  {
    id: 'agents',
    label: 'Agents',
    group: 'content',
    contexts: ['page'],
    icon: 'users',
    searchTags: ['NPC', 'character', 'AI behavior'],
  },
  {
    id: 'autonomous',
    label: 'Automation',
    group: 'content',
    contexts: ['page'],
    icon: 'refresh',
    searchTags: ['scheduled', 'auto', 'background tasks'],
  },
  {
    id: 'music',
    label: 'Music DJ',
    group: 'content',
    contexts: ['page'],
    icon: 'music',
    searchTags: ['background music', 'playlist', 'audio'],
  },
  {
    id: 'local-resources',
    label: 'Local Resources',
    group: 'content',
    contexts: ['page'],
    platforms: ['web', 'native'],
    icon: 'hard-drive',
    searchTags: ['download', 'storage', 'disk', 'assets', 'models', 'files'],
  },

  // ── Account ──────────────────────────────────────────────────────────
  {
    id: 'account',
    label: 'Account',
    group: 'account',
    contexts: ['page'],
    icon: 'user',
    searchTags: ['profile', 'login', 'user'],
  },

  // ── Data ─────────────────────────────────────────────────────────────
  {
    id: 'export',
    label: 'Export & Data',
    group: 'data',
    contexts: ['page'],
    icon: 'download',
    searchTags: ['backup', 'save', 'privacy', 'credentials'],
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
 * Creates a section ViewModel for the given section ID.
 * Returns undefined if no factory is registered for that section.
 */
export const createSectionViewModel = (
  sectionId: string,
  options?: BaseViewModelOptions,
): BaseViewModelInterface | undefined => createSectionViewModelMount(sectionId, options)?.viewModel;

/**
 * Returns whether a factory exists for the given section ID.
 */
export const hasSectionViewModel = (sectionId: string): boolean =>
  _hasSectionViewModelFactory(sectionId);
