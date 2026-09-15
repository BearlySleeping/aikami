// packages/shared/types/src/lib/game/hud_layout.ts
//
// C-528 — HUD layout types.
//
// Persisted shapes are DERIVED from the TypeBox schemas in @aikami/schemas so
// the runtime validator and the static type can never drift. Registry metadata
// is derived from the constant registry itself for the same reason.
//
// Contract: C-528 Player HUD presets and layout editor.

import type {
  HUD_ANCHORS,
  HUD_DENSITIES,
  HUD_LAYOUT_PRESETS,
  HUD_VISIBILITIES,
  HUD_WIDGET_REGISTRY,
} from '@aikami/constants';

export type {
  HudAnchor,
  HudDensity,
  HudLayoutPreset,
  HudMigrationMarker,
  HudUserPreferences,
  HudVisibility,
  HudWidgetPreference,
} from '@aikami/schemas';

/** One trusted registry entry, derived from the registry constant. */
export type HudWidgetDefinition = (typeof HUD_WIDGET_REGISTRY)[number];

/** Stable widget identifier, derived from the registry constant. */
export type HudWidgetId = HudWidgetDefinition['id'];

/** One shipped preset definition, derived from the preset constant. */
export type HudLayoutPresetDefinition = (typeof HUD_LAYOUT_PRESETS)[number];

/** Shipped preset identifier. */
export type HudPresetId = HudLayoutPresetDefinition['id'];

/** Placement region. */
export type HudSlot = (typeof HUD_ANCHORS)[number];

/** Player-selectable visibility policy. */
export type HudVisibilityValue = (typeof HUD_VISIBILITIES)[number];

/** Widget density. */
export type HudDensityValue = (typeof HUD_DENSITIES)[number];
