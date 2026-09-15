// packages/shared/constants/src/lib/game/theme.ts
//
// C-529 — the trusted registry for the declarative theme profile: the bounded
// v1 limits, the semantic token allowlist, the shipped built-in theme
// identities and the appearance/selection storage keys.
//
// This module is inert, data-only metadata. It contains no executable strings,
// no component references and no remote URLs, so a theme validator can run in
// the client, in the Hub and in the CLI from this single source without
// importing a single view or service module.
//
// 🔴 The token allowlist is the security boundary. A theme may only assign the
// tokens named here, and only values whose declared `type` matches. Anything a
// theme cannot name, it cannot affect.
//
// Contract: C-529 Declarative theme runtime and creator tools.

// ── Profile + API compatibility ────────────────────────────────────────────

/** Aikami theme profile version understood by this build. */
export const THEME_PROFILE_VERSION = 1;

/** Aikami theme API version implemented by this build (`major.minor`). */
export const THEME_API_VERSION = '1.0';

/** Major version of {@link THEME_API_VERSION}. A larger major is refused. */
export const THEME_API_MAJOR = 1;

/** Manifest envelope kind — the only accepted `kind` value. */
export const THEME_PACKAGE_KIND = 'aikami-theme';

/** Package manifest schema version understood by this build. */
export const THEME_PACKAGE_SCHEMA_VERSION = 1;

/** Appearance/selection schema version understood by this build. */
export const THEME_SELECTION_SCHEMA_VERSION = 1;

/** Variant identifiers a token file may declare. */
export const THEME_VARIANTS = ['light', 'dark'] as const;

// ── Appearance modes ───────────────────────────────────────────────────────

/**
 * Player-selectable appearance modes.
 *
 * Deliberately separate from a theme id: `system` follows the OS, `light` and
 * `dark` are explicit choices. A custom theme id is never an appearance mode.
 */
export const APPEARANCE_MODES = ['system', 'light', 'dark'] as const;

/** Appearance mode used when no stored selection exists. */
export const DEFAULT_APPEARANCE_MODE = 'system';

// ── Built-in themes ────────────────────────────────────────────────────────

/** Shipped default theme. Generated from the built-in token source. */
export const BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE = 'obsidian-chronicle';

/** Theme id used when nothing else is selected. */
export const DEFAULT_THEME_ID = BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE;

/** Every theme id this build ships and trusts. */
export const BUILTIN_THEME_IDS = [BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE] as const;

/** Version string the shipped built-in themes report. */
export const BUILTIN_THEME_VERSION = '1.0.0';

/** Human-readable name of the shipped default theme. */
export const BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE = 'Obsidian Chronicle';

/** Identifier shape accepted for a theme id: bounded, no path/URL characters. */
export const THEME_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';

/** Semantic-version shape accepted for a theme version. */
export const THEME_VERSION_PATTERN = '^\\d+\\.\\d+\\.\\d+$';

/** Theme API range shape accepted in a manifest (`>=1.0 <2.0`, `1.x`, ...). */
export const THEME_API_RANGE_PATTERN = '^[<>=^~*0-9.x -]{1,32}$';

/** Canonical package-relative path shape. No traversal, no absolute paths. */
export const THEME_PACKAGE_PATH_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$';

// ── Storage keys ───────────────────────────────────────────────────────────

/** The committed appearance/theme selection (mode + theme id/version). */
export const THEME_SELECTION_STORAGE_KEY = 'aikami:theme:selection';

/** Last-known-good theme bytes that boot when the active pointer is corrupt. */
export const THEME_LAST_GOOD_STORAGE_KEY = 'aikami:theme:last-good';

// ── Directive 10 — bounded v1 limits ───────────────────────────────────────

/** Compressed theme archive ceiling (10 MiB). */
export const THEME_MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

/** Expanded total ceiling (25 MiB). */
export const THEME_MAX_EXPANDED_BYTES = 25 * 1024 * 1024;

/** Maximum entries in one archive. */
export const THEME_MAX_ENTRIES = 128;

/** Maximum manifest size (256 KiB). */
export const THEME_MAX_MANIFEST_BYTES = 256 * 1024;

/** Maximum aggregate token JSON size (512 KiB). */
export const THEME_MAX_TOKENS_JSON_BYTES = 512 * 1024;

/** Maximum alias chain depth before rejection. */
export const THEME_MAX_ALIAS_DEPTH = 16;

/** Maximum resolved tokens in one variant. */
export const THEME_MAX_RESOLVED_TOKENS = 512;

/** Maximum declared asset entries in one manifest. */
export const THEME_MAX_ASSETS = 64;

/** Maximum bytes for one WOFF2 font asset (2 MiB). */
export const THEME_MAX_FONT_BYTES = 2 * 1024 * 1024;

/** Maximum number of WOFF2 font assets in one package. */
export const THEME_MAX_FONT_FILES = 2;

/** Maximum width or height of a raster ornament/preview asset. */
export const THEME_MAX_RASTER_DIMENSION = 2048;

/** Maximum decoded pixels across all raster assets. */
export const THEME_MAX_RASTER_PIXELS = 8_000_000;

/** Accepted raster media types. */
export const THEME_RASTER_MEDIA_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;

/** Accepted font media type — the only font container this profile accepts. */
export const THEME_FONT_MEDIA_TYPE = 'font/woff2';

// ── Directive 14 — contrast gates ──────────────────────────────────────────

/** Minimum contrast for essential normal text. */
export const THEME_CONTRAST_NORMAL_TEXT_MIN = 4.5;

/** Minimum contrast for large text and control boundaries. */
export const THEME_CONTRAST_LARGE_TEXT_MIN = 3;

/** Minimum contrast for primary text under the high-contrast override. */
export const THEME_CONTRAST_HIGH_CONTRAST_MIN = 7;

// ── Token allowlist ────────────────────────────────────────────────────────

/** Value kinds the v1 profile can validate and serialize. */
export const THEME_TOKEN_TYPES = [
  'color',
  'dimension',
  'duration',
  'fontFamily',
  'fontWeight',
] as const;

/** Editor groupings (Directive 8) — presentation metadata, not behavior. */
export const THEME_TOKEN_GROUPS = [
  'surface',
  'text',
  'accent',
  'status',
  'focus',
  'ornament',
  'type',
  'borders',
  'motion',
] as const;

export type ThemeTokenType = (typeof THEME_TOKEN_TYPES)[number];
export type ThemeTokenGroup = (typeof THEME_TOKEN_GROUPS)[number];

/**
 * One entry in the semantic token allowlist.
 *
 * `cssVariable` is the custom property the token compiles to. Every color
 * token additionally registers a Tailwind `--color-*` alias in the generated
 * `@theme` block so the existing utility API (`bg-base-100`, `text-primary`,
 * ...) keeps working.
 */
export type ThemeTokenDefinition = {
  /** Stable dotted token id used in a token file. */
  readonly id: string;
  /** Custom property this token compiles to. */
  readonly cssVariable: string;
  /** Declared value kind. A token file may not change this. */
  readonly type: ThemeTokenType;
  /** Editor grouping. */
  readonly group: ThemeTokenGroup;
  /** Human-readable label for the creator UI. */
  readonly label: string;
};

/** One entry in the explicit allowlist. */
export const THEME_TOKEN_REGISTRY = [
  // ── Surface ──
  {
    id: 'color.base-100',
    cssVariable: '--ui-base-100',
    type: 'color',
    group: 'surface',
    label: 'Base surface',
  },
  {
    id: 'color.base-200',
    cssVariable: '--ui-base-200',
    type: 'color',
    group: 'surface',
    label: 'Raised surface',
  },
  {
    id: 'color.base-300',
    cssVariable: '--ui-base-300',
    type: 'color',
    group: 'surface',
    label: 'Border surface',
  },
  {
    id: 'color.panel',
    cssVariable: '--ui-panel',
    type: 'color',
    group: 'surface',
    label: 'Panel',
  },
  {
    id: 'color.elevated',
    cssVariable: '--ui-elevated',
    type: 'color',
    group: 'surface',
    label: 'Elevated panel',
  },
  {
    id: 'color.ink',
    cssVariable: '--ui-ink',
    type: 'color',
    group: 'surface',
    label: 'Ink wash',
  },

  // ── Text ──
  {
    id: 'color.base-content',
    cssVariable: '--ui-base-content',
    type: 'color',
    group: 'text',
    label: 'Body text',
  },
  {
    id: 'color.muted-content',
    cssVariable: '--ui-muted-content',
    type: 'color',
    group: 'text',
    label: 'Muted text',
  },
  {
    id: 'color.primary-content',
    cssVariable: '--ui-primary-content',
    type: 'color',
    group: 'text',
    label: 'On primary',
  },
  {
    id: 'color.secondary-content',
    cssVariable: '--ui-secondary-content',
    type: 'color',
    group: 'text',
    label: 'On secondary',
  },
  {
    id: 'color.accent-content',
    cssVariable: '--ui-accent-content',
    type: 'color',
    group: 'text',
    label: 'On accent',
  },
  {
    id: 'color.neutral-content',
    cssVariable: '--ui-neutral-content',
    type: 'color',
    group: 'text',
    label: 'On neutral',
  },
  {
    id: 'color.info-content',
    cssVariable: '--ui-info-content',
    type: 'color',
    group: 'text',
    label: 'On info',
  },
  {
    id: 'color.success-content',
    cssVariable: '--ui-success-content',
    type: 'color',
    group: 'text',
    label: 'On success',
  },
  {
    id: 'color.warning-content',
    cssVariable: '--ui-warning-content',
    type: 'color',
    group: 'text',
    label: 'On warning',
  },
  {
    id: 'color.error-content',
    cssVariable: '--ui-error-content',
    type: 'color',
    group: 'text',
    label: 'On error',
  },

  // ── Accent ──
  {
    id: 'color.primary',
    cssVariable: '--ui-primary',
    type: 'color',
    group: 'accent',
    label: 'Primary accent',
  },
  {
    id: 'color.secondary',
    cssVariable: '--ui-secondary',
    type: 'color',
    group: 'accent',
    label: 'Secondary accent',
  },
  {
    id: 'color.accent',
    cssVariable: '--ui-accent',
    type: 'color',
    group: 'accent',
    label: 'Highlight accent',
  },
  {
    id: 'color.neutral',
    cssVariable: '--ui-neutral',
    type: 'color',
    group: 'accent',
    label: 'Neutral accent',
  },

  // ── Status ──
  {
    id: 'color.info',
    cssVariable: '--ui-info',
    type: 'color',
    group: 'status',
    label: 'Info',
  },
  {
    id: 'color.success',
    cssVariable: '--ui-success',
    type: 'color',
    group: 'status',
    label: 'Success',
  },
  {
    id: 'color.warning',
    cssVariable: '--ui-warning',
    type: 'color',
    group: 'status',
    label: 'Warning',
  },
  {
    id: 'color.error',
    cssVariable: '--ui-error',
    type: 'color',
    group: 'status',
    label: 'Danger',
  },

  // ── Focus ──
  {
    id: 'color.focus-ring',
    cssVariable: '--ui-focus-ring',
    type: 'color',
    group: 'focus',
    label: 'Focus ring',
  },

  // ── Ornament ──
  {
    id: 'color.brass',
    cssVariable: '--ui-brass',
    type: 'color',
    group: 'ornament',
    label: 'Ornament metal',
  },

  // ── Type ──
  {
    id: 'font.body',
    cssVariable: '--ui-font-body',
    type: 'fontFamily',
    group: 'type',
    label: 'Body font role',
  },
  {
    id: 'font.display',
    cssVariable: '--ui-font-display',
    type: 'fontFamily',
    group: 'type',
    label: 'Display font role',
  },
  {
    id: 'font.mono',
    cssVariable: '--ui-font-mono',
    type: 'fontFamily',
    group: 'type',
    label: 'Mono font role',
  },
  {
    id: 'weight.body',
    cssVariable: '--ui-weight-body',
    type: 'fontWeight',
    group: 'type',
    label: 'Body weight',
  },
  {
    id: 'weight.medium',
    cssVariable: '--ui-weight-medium',
    type: 'fontWeight',
    group: 'type',
    label: 'Medium weight',
  },
  {
    id: 'weight.strong',
    cssVariable: '--ui-weight-strong',
    type: 'fontWeight',
    group: 'type',
    label: 'Strong weight',
  },

  // ── Borders / corners / metrics ──
  {
    id: 'border.width',
    cssVariable: '--ui-border',
    type: 'dimension',
    group: 'borders',
    label: 'Border width',
  },
  {
    id: 'radius.selector',
    cssVariable: '--ui-radius-selector',
    type: 'dimension',
    group: 'borders',
    label: 'Selector radius',
  },
  {
    id: 'radius.field',
    cssVariable: '--ui-radius-field',
    type: 'dimension',
    group: 'borders',
    label: 'Field radius',
  },
  {
    id: 'radius.box',
    cssVariable: '--ui-radius-box',
    type: 'dimension',
    group: 'borders',
    label: 'Box radius',
  },
  {
    id: 'size.selector',
    cssVariable: '--ui-size-selector',
    type: 'dimension',
    group: 'borders',
    label: 'Selector unit',
  },
  {
    id: 'size.field',
    cssVariable: '--ui-size-field',
    type: 'dimension',
    group: 'borders',
    label: 'Field unit',
  },

  // ── Motion ──
  {
    id: 'duration.enter',
    cssVariable: '--ui-duration-enter',
    type: 'duration',
    group: 'motion',
    label: 'Enter duration',
  },
  {
    id: 'duration.exit',
    cssVariable: '--ui-duration-exit',
    type: 'duration',
    group: 'motion',
    label: 'Exit duration',
  },
] as const satisfies readonly ThemeTokenDefinition[];

/** Every token id the allowlist accepts. */
export const THEME_TOKEN_IDS = THEME_TOKEN_REGISTRY.map((token) => token.id);

/** Lookup by token id. */
export const THEME_TOKEN_BY_ID: ReadonlyMap<string, ThemeTokenDefinition> = new Map(
  THEME_TOKEN_REGISTRY.map((token) => [token.id, token]),
);

/** Lookup by custom property name. */
export const THEME_TOKEN_BY_CSS_VARIABLE: ReadonlyMap<string, ThemeTokenDefinition> = new Map(
  THEME_TOKEN_REGISTRY.map((token) => [token.cssVariable, token]),
);

/** Root attribute marking the game shell / preview root as a theme scope. */
export const THEME_SCOPE_ATTRIBUTE = 'data-aikami-theme-scope';

/** Scope attribute carrying the resolved variant (`light` | `dark`). */
export const THEME_SCOPE_VARIANT_ATTRIBUTE = 'data-aikami-variant';

/** Root attribute carrying the resolved variant for the trusted app chrome. */
export const THEME_ROOT_ATTRIBUTE = 'data-theme';

/** Element id of the injected `<style>` holding an installed custom theme. */
export const THEME_INJECTED_STYLE_ID = 'aikami-theme-scope-style';

/** Asset slots a v1 package may declare. */
export const THEME_ASSET_SLOTS = ['preview', 'ornament', 'font'] as const;

export type ThemeAssetSlot = (typeof THEME_ASSET_SLOTS)[number];
