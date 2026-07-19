// apps/frontend/client/src/lib/views/settings/settings_sections.ts
//
// Typed registry of all settings sections with metadata for progressive
// disclosure, search, and capability badges. Drives both the tab UI and
// search filtering in SettingsViewModel.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsSectionCategory = 'basic' | 'advanced';

export type SettingsSection = {
  /** Unique section identifier — matches existing sub-tab IDs where applicable. */
  id: string;
  /** Display label shown in the tab bar. */
  label: string;
  /** Which disclosure tier this section belongs to. */
  category: SettingsSectionCategory;
  /** Heroicon name for the tab icon (used as a lookup key by the view). */
  icon: string;
  /** Search keywords for fuzzy matching. */
  keywords: readonly string[];
  /** Optional capability key for badge display (e.g. 'ai', 'connection'). */
  capabilityKey?: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ── Basic sections ──────────────────────────────────────────────────
  {
    id: 'controls',
    label: 'Controls',
    category: 'basic',
    icon: 'keyboard',
    keywords: [
      'controls',
      'keybindings',
      'key',
      'bind',
      'input',
      'move',
      'interact',
      'menu',
      'shortcut',
      'hotkey',
      'keyboard',
      'gamepad',
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    category: 'basic',
    icon: 'speaker',
    keywords: [
      'audio',
      'volume',
      'sound',
      'music',
      'bgm',
      'sfx',
      'loud',
      'quiet',
      'mute',
      'speaker',
      'master',
      'crossfade',
    ],
  },
  {
    id: 'display',
    label: 'Display',
    category: 'basic',
    icon: 'monitor',
    keywords: [
      'display',
      'resolution',
      'fullscreen',
      'window',
      'monitor',
      'screen',
      'size',
      'brightness',
      'hd',
      'qhd',
      'pixels',
    ],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    category: 'basic',
    icon: 'cog',
    keywords: [
      'gameplay',
      'game',
      'options',
      'language',
      'region',
      'accessibility',
      'difficulty',
      'autosave',
      'tutorial',
      'hints',
    ],
  },
  {
    id: 'ai_privacy',
    label: 'AI & Privacy',
    category: 'basic',
    icon: 'shield',
    keywords: [
      'ai',
      'privacy',
      'provider',
      'connect',
      'offline',
      'telemetry',
      'data',
      'model',
      'connection',
      'status',
      'local',
      'api',
    ],
    capabilityKey: 'ai',
  },

  // ── Advanced sections ───────────────────────────────────────────────
  {
    id: 'providers',
    label: 'AI Engine',
    category: 'advanced',
    icon: 'cpu',
    keywords: [
      'ai',
      'engine',
      'provider',
      'text',
      'voice',
      'image',
      'llm',
      'model',
      'generation',
      'parameters',
      'temperature',
      'token',
      'instruct',
      'template',
      'emotion',
      'api key',
      'endpoint',
    ],
    capabilityKey: 'ai',
  },
  {
    id: 'connections',
    label: 'Connections',
    category: 'advanced',
    icon: 'link',
    keywords: ['connections', 'connection', 'link', 'endpoint', 'url', 'server', 'network', 'api'],
    capabilityKey: 'connection',
  },
  {
    id: 'agents',
    label: 'Agents',
    category: 'advanced',
    icon: 'users',
    keywords: [
      'agents',
      'agent',
      'persona',
      'character',
      'npc',
      'editor',
      'list',
      'create',
      'custom',
    ],
  },
  {
    id: 'autonomous',
    label: 'Automation',
    category: 'advanced',
    icon: 'refresh',
    keywords: [
      'automation',
      'autonomous',
      'npc',
      'behavior',
      'ai',
      'background',
      'schedule',
      'automatic',
      'bot',
    ],
  },
  {
    id: 'music',
    label: 'Music DJ',
    category: 'advanced',
    icon: 'music',
    keywords: ['music', 'dj', 'track', 'library', 'scene', 'playlist', 'song', 'bgm', 'override'],
  },
  {
    id: 'export',
    label: 'Export & Data',
    category: 'advanced',
    icon: 'download',
    keywords: ['export', 'data', 'download', 'save', 'import', 'backup', 'file', 'json', 'dump'],
  },
] as const satisfies readonly SettingsSection[];
