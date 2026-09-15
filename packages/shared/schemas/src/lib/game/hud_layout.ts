// packages/shared/schemas/src/lib/game/hud_layout.ts
//
// C-528 — runtime schemas for the exchangeable HUD preset format and the
// device-local HUD preference snapshot.
//
// Both are UNTRUSTED input: a preset can arrive from a file the player picked,
// and the snapshot can arrive from a previous build or a hand-edited
// localStorage value. TypeBox is therefore the only validator, and the parser
// helpers below are the only entry points that produce these types.
//
// 🔴 Data-only: bounded strings, bounded arrays, no scripts/styles/URLs.

import { HUD_MAX_WIDGETS, HUD_SCALE_MAX, HUD_SCALE_MIN } from '@aikami/constants';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

/** Widget identifier accepted from untrusted data: bounded, no path/URL characters. */
export const HUD_WIDGET_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';

/** Placement anchor. */
export const HudAnchorSchema = Type.Union(
  [
    Type.Literal('top-start'),
    Type.Literal('top-end'),
    Type.Literal('bottom-start'),
    Type.Literal('bottom-center'),
    Type.Literal('bottom-end'),
  ],
  { description: 'Named placement region' },
);

/** Visibility policy for an eligible optional widget. */
export const HudVisibilitySchema = Type.Union(
  [Type.Literal('always'), Type.Literal('contextual'), Type.Literal('hidden')],
  { description: 'always | contextual | hidden' },
);

/** Widget density. */
export const HudDensitySchema = Type.Union([Type.Literal('compact'), Type.Literal('comfortable')], {
  description: 'compact | comfortable',
});

/** One widget's persisted preference. */
export const HudWidgetPreferenceSchema = Type.Object(
  {
    widgetId: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: HUD_WIDGET_ID_PATTERN,
      description: 'Registry widget id; unknown optional ids stay dormant',
    }),
    visibility: HudVisibilitySchema,
    anchor: HudAnchorSchema,
    order: Type.Integer({ minimum: 0, maximum: 64, description: 'Stack order inside the anchor' }),
    density: HudDensitySchema,
    scale: Type.Number({
      minimum: HUD_SCALE_MIN,
      maximum: HUD_SCALE_MAX,
      description: 'Requested scale; effective text/hit-target minima win',
    }),
  },
  { additionalProperties: false },
);

/** A named, shareable layout preset. */
export const HudLayoutPresetSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1, { description: 'Preset format version' }),
    id: Type.String({ minLength: 1, maxLength: 64, pattern: HUD_WIDGET_ID_PATTERN }),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    widgets: Type.Array(HudWidgetPreferenceSchema, { maxItems: HUD_MAX_WIDGETS }),
  },
  { additionalProperties: false },
);

/** The device-local snapshot: one selected preset plus per-widget overrides. */
export const HudUserPreferencesSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1, { description: 'Snapshot format version' }),
    selectedPresetId: Type.String({ minLength: 1, maxLength: 64, pattern: HUD_WIDGET_ID_PATTERN }),
    overrides: Type.Array(HudWidgetPreferenceSchema, { maxItems: HUD_MAX_WIDGETS }),
  },
  { additionalProperties: false },
);

/** The one-shot legacy migration marker. */
export const HudMigrationMarkerSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    migratedAt: Type.String({ minLength: 1, maxLength: 40 }),
    legacyKeys: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 }),
  },
  { additionalProperties: false },
);

export type HudWidgetPreference = Static<typeof HudWidgetPreferenceSchema>;
export type HudLayoutPreset = Static<typeof HudLayoutPresetSchema>;
export type HudUserPreferences = Static<typeof HudUserPreferencesSchema>;
export type HudMigrationMarker = Static<typeof HudMigrationMarkerSchema>;
export type HudVisibility = Static<typeof HudVisibilitySchema>;
export type HudAnchor = Static<typeof HudAnchorSchema>;
export type HudDensity = Static<typeof HudDensitySchema>;

/**
 * Rejects a widget list containing the same id twice.
 *
 * A duplicate id has no defined meaning — two rows would both claim the same
 * slot and the resolver's order would become input-order dependent — so it is
 * rejected rather than silently de-duplicated.
 */
const hasDuplicateWidgetIds = (widgets: readonly { widgetId: string }[]): boolean => {
  const seen = new Set<string>();
  for (const widget of widgets) {
    if (seen.has(widget.widgetId)) {
      return true;
    }
    seen.add(widget.widgetId);
  }
  return false;
};

/**
 * Parses an untrusted value into a HUD preset.
 *
 * Returns `undefined` — never throws, never coerces — when the value is not a
 * bounded, duplicate-free preset with finite in-range numbers.
 */
export const parseHudLayoutPreset = (value: unknown): HudLayoutPreset | undefined => {
  if (!Value.Check(HudLayoutPresetSchema, value)) {
    return undefined;
  }
  const preset = value as HudLayoutPreset;
  if (hasDuplicateWidgetIds(preset.widgets)) {
    return undefined;
  }
  return preset;
};

/** Parses an untrusted value into the device-local HUD snapshot. */
export const parseHudUserPreferences = (value: unknown): HudUserPreferences | undefined => {
  if (!Value.Check(HudUserPreferencesSchema, value)) {
    return undefined;
  }
  const preferences = value as HudUserPreferences;
  if (hasDuplicateWidgetIds(preferences.overrides)) {
    return undefined;
  }
  return preferences;
};

/** Parses an untrusted value into a migration marker. */
export const parseHudMigrationMarker = (value: unknown): HudMigrationMarker | undefined => {
  if (!Value.Check(HudMigrationMarkerSchema, value)) {
    return undefined;
  }
  return value as HudMigrationMarker;
};

/** Parses untrusted JSON text into a HUD preset. */
export const parseHudLayoutPresetJson = (raw: string): HudLayoutPreset | undefined => {
  try {
    return parseHudLayoutPreset(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses untrusted JSON text into the device-local HUD snapshot. */
export const parseHudUserPreferencesJson = (raw: string): HudUserPreferences | undefined => {
  try {
    return parseHudUserPreferences(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/** Parses untrusted JSON text into a migration marker. */
export const parseHudMigrationMarkerJson = (raw: string): HudMigrationMarker | undefined => {
  try {
    return parseHudMigrationMarker(JSON.parse(raw));
  } catch {
    return undefined;
  }
};
