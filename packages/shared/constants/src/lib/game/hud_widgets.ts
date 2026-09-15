// packages/shared/constants/src/lib/game/hud_widgets.ts
//
// C-528 — the trusted HUD widget registry and the four shipped layout presets.
//
// The player HUD used to be a set of per-widget booleans scattered across the
// overlay router, so nothing could answer "what widgets exist", "which of them
// may be hidden", "how small may this widget get" or "what does the Minimal
// preset actually mean". This module is that answer: inert, data-only metadata
// that C-529/C-530 can validate an uploaded preset against without importing a
// single client module.
//
// 🔴 Metadata only — no executable strings, no component references, no remote
// URLs. Trusted view composition stays client-side under `views/game/ui/`.

/**
 * Stable, namespaced-enough widget identifiers.
 *
 * Order here is the registry order and the fallback `order` seed; it is NOT
 * the resolved layout order (that comes from the preset/override `order`).
 */
export const HUD_WIDGET_IDS = [
  'system-notice',
  'menu',
  'player-status',
  'interaction',
  'hotbar',
  'objective',
  'party-status',
  'autosave',
  'clock',
  'onboarding-hint',
  'music-player',
] as const;

/** Named placement regions. Logical start/end — mirrored for RTL by the view. */
export const HUD_ANCHORS = [
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-center',
  'bottom-end',
] as const;

/** Player-selectable visibility policies for an eligible optional widget. */
export const HUD_VISIBILITIES = ['always', 'contextual', 'hidden'] as const;

/** Supported widget densities. */
export const HUD_DENSITIES = ['compact', 'comfortable'] as const;

/** Lowest allowed widget scale (80%). Effective text/hit-target minima still win. */
export const HUD_SCALE_MIN = 0.8;

/** Highest allowed widget scale (150%). */
export const HUD_SCALE_MAX = 1.5;

/** Step used by the editor's scale control and the keyboard/controller parity path. */
export const HUD_SCALE_STEP = 0.05;

/** Upper bound on widgets in one preset — bounds untrusted imported data. */
export const HUD_MAX_WIDGETS = 24;

/** Persisted preference schema version understood by this build. */
export const HUD_PREFERENCE_SCHEMA_VERSION = 1;

/** Atomic committed snapshot of the player's HUD intent. */
export const HUD_PREFERENCES_STORAGE_KEY = 'aikami:hud:preferences';

/** One-shot marker recording that the legacy keys were mapped into the snapshot. */
export const HUD_MIGRATION_MARKER_KEY = 'aikami:hud:migration';

/** Temporary Hide HUD flag — session-scoped, never a persisted preference. */
export const HUD_HIDDEN_STORAGE_KEY = 'aikami:hud:temporarily-hidden';

// ── Legacy owners (C-527) that this contract migrates exactly once ──────────

/** `'0'` is an explicit false and must survive migration. */
export const LEGACY_QUEST_OVERLAY_VISIBLE_KEY = 'aikami:quest-overlay:visible';

/** Written as `'0'`/`'1'`; absence means the new default. */
export const LEGACY_MUSIC_PLAYER_VISIBLE_KEY = 'aikami:music-player:visible';

/** Written only as `'1'`; absence means off and is NOT a lost explicit choice. */
export const LEGACY_CLOCK_HUD_VISIBLE_KEY = 'aikami:clock-hud:visible';

/** The preset a new player starts on. */
export const HUD_DEFAULT_PRESET_ID = 'adventure';

/** Sentinel preset id used when the stored/selected preset cannot be resolved. */
export const HUD_SAFE_PRESET_ID = 'adventure';

/** Shipped preset identifiers, in presentation order. */
export const HUD_PRESET_IDS = ['adventure', 'minimal', 'tactical', 'readable'] as const;

/**
 * Reserved regions that ordinary hide policies may never vacate.
 *
 * `system-notice` (save failure / disconnection) and `menu` (recovery
 * navigation) are required widgets, and `bottom-center` carries the contextual
 * interaction prompt that gates required combat actions.
 */
export const HUD_REQUIRED_WIDGET_IDS = ['system-notice', 'menu'] as const;

/** The labelled accessible entry that holds widgets collapsed by reflow. */
export const HUD_OVERFLOW_ENTRY_LABEL = 'More HUD';

/** Viewport breakpoints used by the pure reflow policy. */
export const HUD_COMPACT_MAX_WIDTH = 1100;
export const HUD_COMPACT_MAX_HEIGHT = 800;
export const HUD_TOUCH_MAX_WIDTH = 600;

/** Safe content rectangle inset (px) used when computing row capacity. */
export const HUD_SAFE_INSET = 12;

/** Vertical gap (px) between stacked widgets inside one anchor. */
export const HUD_STACK_GAP = 8;

/** Text scale at or above which reflow assumes enlarged text metrics. */
export const HUD_LARGE_TEXT_SCALE = 1.5;

/** Non-exported structural contract the registry satisfies (see @aikami/types for the public alias). */
type HudWidgetDefinitionShape = {
  readonly id: (typeof HUD_WIDGET_IDS)[number];
  readonly label: string;
  readonly description: string;
  /** Priority for reflow packing — lower survives longer. */
  readonly priority: number;
  /** Required widgets can never be hidden and always stay reachable. */
  readonly required: boolean;
  /** Capability key that must be available for the widget to be placed at all. */
  readonly capability: string | undefined;
  readonly defaultAnchor: (typeof HUD_ANCHORS)[number];
  readonly defaultOrder: number;
  /** Measured rendered minimum width (px), at 100% text scale. */
  readonly minWidth: number;
  /** Measured rendered minimum height (px), at 100% text scale. */
  readonly minHeight: number;
  readonly supportedAnchors: readonly (typeof HUD_ANCHORS)[number][];
  readonly supportedDensities: readonly (typeof HUD_DENSITIES)[number][];
};

/**
 * The trusted widget registry.
 *
 * Minimum dimensions are measured from the rendered widgets at 100% text scale
 * and recorded as bounded constants; `hud_widget_registry.test.ts` asserts every
 * entry has finite positive minimums so the schema cannot ship invented numbers.
 */
export const HUD_WIDGET_REGISTRY = [
  {
    id: 'system-notice',
    label: 'System notices',
    description: 'Save failures and disconnection warnings. Always reachable.',
    priority: 0,
    required: true,
    capability: undefined,
    defaultAnchor: 'top-end',
    defaultOrder: 5,
    minWidth: 160,
    minHeight: 32,
    supportedAnchors: ['top-end', 'top-start'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'menu',
    label: 'Menu',
    description: 'Recovery navigation into the management sections.',
    priority: 1,
    required: true,
    capability: undefined,
    defaultAnchor: 'top-end',
    defaultOrder: 4,
    minWidth: 72,
    minHeight: 32,
    supportedAnchors: ['top-end', 'top-start'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'player-status',
    label: 'Player status',
    description: 'Current hit points.',
    priority: 2,
    required: false,
    capability: undefined,
    defaultAnchor: 'top-end',
    defaultOrder: 0,
    minWidth: 120,
    minHeight: 32,
    supportedAnchors: ['top-start', 'top-end', 'bottom-start', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'interaction',
    label: 'Interaction prompt',
    description: 'Contextual prompt for the entity you are standing next to.',
    priority: 3,
    required: false,
    capability: undefined,
    defaultAnchor: 'bottom-center',
    defaultOrder: 1,
    minWidth: 180,
    minHeight: 32,
    supportedAnchors: ['bottom-center', 'bottom-start', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'hotbar',
    label: 'Hotbar',
    description: 'Bound combat and utility actions.',
    priority: 4,
    required: false,
    capability: undefined,
    defaultAnchor: 'bottom-center',
    defaultOrder: 0,
    minWidth: 260,
    minHeight: 48,
    supportedAnchors: ['bottom-center', 'bottom-start', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'objective',
    label: 'Objective',
    description: 'The tracked quest, as a compact tracker or an expanded card.',
    priority: 5,
    required: false,
    capability: undefined,
    defaultAnchor: 'bottom-start',
    defaultOrder: 0,
    minWidth: 200,
    minHeight: 44,
    supportedAnchors: ['bottom-start', 'top-start', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'party-status',
    label: 'Party status',
    description: 'Compact party roster.',
    priority: 6,
    required: false,
    capability: 'party',
    defaultAnchor: 'top-start',
    defaultOrder: 0,
    minWidth: 120,
    minHeight: 40,
    supportedAnchors: ['top-start', 'top-end', 'bottom-start'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'autosave',
    label: 'Autosave indicator',
    description: 'Last automatic save result.',
    priority: 7,
    required: false,
    capability: undefined,
    defaultAnchor: 'top-end',
    defaultOrder: 2,
    minWidth: 88,
    minHeight: 24,
    supportedAnchors: ['top-start', 'top-end', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'clock',
    label: 'Clock and weather',
    description: 'In-world time and weather.',
    priority: 8,
    required: false,
    capability: 'time',
    defaultAnchor: 'top-end',
    defaultOrder: 3,
    minWidth: 88,
    minHeight: 24,
    supportedAnchors: ['top-start', 'top-end', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'onboarding-hint',
    label: 'Onboarding hint',
    description: 'First-run tutorial toast.',
    priority: 9,
    required: false,
    capability: undefined,
    defaultAnchor: 'top-end',
    defaultOrder: 6,
    minWidth: 200,
    minHeight: 32,
    supportedAnchors: ['top-start', 'top-end', 'bottom-start', 'bottom-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
  {
    id: 'music-player',
    label: 'Music player',
    description: 'Optional mini music player.',
    priority: 10,
    required: false,
    capability: 'audio-library',
    defaultAnchor: 'bottom-end',
    defaultOrder: 0,
    minWidth: 220,
    minHeight: 72,
    supportedAnchors: ['bottom-end', 'bottom-start', 'top-end'],
    supportedDensities: ['compact', 'comfortable'],
  },
] as const satisfies readonly HudWidgetDefinitionShape[];

/** Capability keys referenced by the registry, for capability providers. */
export const HUD_WIDGET_CAPABILITIES = ['party', 'time', 'audio-library'] as const;

type HudPresetWidgetShape = {
  readonly widgetId: (typeof HUD_WIDGET_IDS)[number];
  readonly visibility: (typeof HUD_VISIBILITIES)[number];
  readonly anchor: (typeof HUD_ANCHORS)[number];
  readonly order: number;
  readonly density: (typeof HUD_DENSITIES)[number];
  readonly scale: number;
};

type HudPresetDefinitionShape = {
  readonly schemaVersion: typeof HUD_PREFERENCE_SCHEMA_VERSION;
  readonly id: (typeof HUD_PRESET_IDS)[number];
  readonly name: string;
  readonly description: string;
  readonly widgets: readonly HudPresetWidgetShape[];
};

/**
 * The four shipped presets.
 *
 * `adventure` is the default. `minimal` favours the world; `tactical` keeps
 * combat affordances pinned; `readable` enlarges text-bearing widgets. Every
 * preset still leaves `system-notice` and `menu` reachable — the resolver
 * coerces those back to `always` regardless of what a preset claims.
 */
export const HUD_LAYOUT_PRESETS = [
  {
    schemaVersion: HUD_PREFERENCE_SCHEMA_VERSION,
    id: 'adventure',
    name: 'Adventure',
    description: 'Balanced exploration defaults.',
    widgets: [
      {
        widgetId: 'player-status',
        visibility: 'always',
        anchor: 'top-end',
        order: 0,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'party-status',
        visibility: 'contextual',
        anchor: 'top-start',
        order: 0,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'objective',
        visibility: 'contextual',
        anchor: 'bottom-start',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'hotbar',
        visibility: 'always',
        anchor: 'bottom-center',
        order: 0,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'interaction',
        visibility: 'contextual',
        anchor: 'bottom-center',
        order: 1,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'menu',
        visibility: 'always',
        anchor: 'top-end',
        order: 4,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'system-notice',
        visibility: 'always',
        anchor: 'top-end',
        order: 5,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'autosave',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 2,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'clock',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 3,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'onboarding-hint',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 6,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'music-player',
        visibility: 'hidden',
        anchor: 'bottom-end',
        order: 0,
        density: 'compact',
        scale: 1,
      },
    ],
  },
  {
    schemaVersion: HUD_PREFERENCE_SCHEMA_VERSION,
    id: 'minimal',
    name: 'Minimal',
    description: 'Keep the world visible; only what matters right now.',
    widgets: [
      {
        widgetId: 'player-status',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'party-status',
        visibility: 'hidden',
        anchor: 'top-start',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'objective',
        visibility: 'contextual',
        anchor: 'bottom-start',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'hotbar',
        visibility: 'hidden',
        anchor: 'bottom-center',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'interaction',
        visibility: 'contextual',
        anchor: 'bottom-center',
        order: 1,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'menu',
        visibility: 'always',
        anchor: 'top-end',
        order: 4,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'system-notice',
        visibility: 'always',
        anchor: 'top-end',
        order: 5,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'autosave',
        visibility: 'hidden',
        anchor: 'top-end',
        order: 2,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'clock',
        visibility: 'hidden',
        anchor: 'top-end',
        order: 3,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'onboarding-hint',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 6,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'music-player',
        visibility: 'hidden',
        anchor: 'bottom-end',
        order: 0,
        density: 'compact',
        scale: 1,
      },
    ],
  },
  {
    schemaVersion: HUD_PREFERENCE_SCHEMA_VERSION,
    id: 'tactical',
    name: 'Tactical',
    description: 'Combat-forward: actions, status and party always pinned.',
    widgets: [
      {
        widgetId: 'player-status',
        visibility: 'always',
        anchor: 'top-end',
        order: 0,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'party-status',
        visibility: 'always',
        anchor: 'top-start',
        order: 0,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'objective',
        visibility: 'contextual',
        anchor: 'bottom-start',
        order: 0,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'hotbar',
        visibility: 'always',
        anchor: 'bottom-center',
        order: 0,
        density: 'comfortable',
        scale: 1.1,
      },
      {
        widgetId: 'interaction',
        visibility: 'always',
        anchor: 'bottom-center',
        order: 1,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'menu',
        visibility: 'always',
        anchor: 'top-end',
        order: 4,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'system-notice',
        visibility: 'always',
        anchor: 'top-end',
        order: 5,
        density: 'comfortable',
        scale: 1,
      },
      {
        widgetId: 'autosave',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 2,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'clock',
        visibility: 'always',
        anchor: 'top-end',
        order: 3,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'onboarding-hint',
        visibility: 'hidden',
        anchor: 'top-end',
        order: 6,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'music-player',
        visibility: 'hidden',
        anchor: 'bottom-end',
        order: 0,
        density: 'compact',
        scale: 1,
      },
    ],
  },
  {
    schemaVersion: HUD_PREFERENCE_SCHEMA_VERSION,
    id: 'readable',
    name: 'Readable',
    description: 'Larger text-bearing widgets with fewer distractions.',
    widgets: [
      {
        widgetId: 'player-status',
        visibility: 'always',
        anchor: 'top-end',
        order: 0,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'party-status',
        visibility: 'contextual',
        anchor: 'top-start',
        order: 0,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'objective',
        visibility: 'always',
        anchor: 'bottom-start',
        order: 0,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'hotbar',
        visibility: 'contextual',
        anchor: 'bottom-center',
        order: 0,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'interaction',
        visibility: 'always',
        anchor: 'bottom-center',
        order: 1,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'menu',
        visibility: 'always',
        anchor: 'top-end',
        order: 4,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'system-notice',
        visibility: 'always',
        anchor: 'top-end',
        order: 5,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'autosave',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 2,
        density: 'compact',
        scale: 1,
      },
      {
        widgetId: 'clock',
        visibility: 'contextual',
        anchor: 'top-end',
        order: 3,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'onboarding-hint',
        visibility: 'hidden',
        anchor: 'top-end',
        order: 6,
        density: 'comfortable',
        scale: 1.25,
      },
      {
        widgetId: 'music-player',
        visibility: 'hidden',
        anchor: 'bottom-end',
        order: 0,
        density: 'compact',
        scale: 1,
      },
    ],
  },
] as const satisfies readonly HudPresetDefinitionShape[];
