// apps/frontend/client/src/lib/views/settings/settings_sections.ts
//
// Typed registry of all settings sections and the groups they belong to.
// Drives the group tab bar + section sub-nav in SettingsViewModel.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsGroupId = 'play' | 'ai' | 'content' | 'data';

export type SettingsContext = 'page' | 'pause' | 'onboarding';

export type SettingsGroup = {
  /** Unique group identifier. */
  id: SettingsGroupId;
  /** Display label shown in the group tab bar. */
  label: string;
};

export type SettingsSection = {
  /** Unique section identifier — matches existing sub-tab IDs where applicable. */
  id: string;
  /** Display label shown in the sub-nav. */
  label: string;
  /** Which group tab this section is nested under. */
  group: SettingsGroupId;
  /** Which UI contexts this section is available in. */
  contexts: readonly SettingsContext[];
  /** Heroicon name for the tab icon (used as a lookup key by the view). */
  icon: string;
  /** Optional capability key for badge display (e.g. 'ai', 'connection'). */
  capabilityKey?: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
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
    id: 'connections',
    label: 'Connections',
    group: 'ai',
    contexts: ['page'],
    icon: 'link',
    capabilityKey: 'connection',
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

  // ── Data ─────────────────────────────────────────────────────────────
  {
    id: 'export',
    label: 'Export & Data',
    group: 'data',
    contexts: ['page'],
    icon: 'download',
  },
] as const satisfies readonly SettingsSection[];
