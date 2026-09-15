// apps/frontend/client/src/lib/utils/hud/hud_preference_migration.ts
//
// C-528 — the one-shot mapping from the C-527 legacy visibility keys into the
// HUD preference snapshot.
//
// Pure: the caller supplies the raw stored strings, this module decides what
// they mean. That keeps the three encodings honest in one place and testable
// without a browser:
//
//   aikami:quest-overlay:visible  '0' is an EXPLICIT false and must survive
//   aikami:music-player:visible   '0'/'1'
//   aikami:clock-hud:visible      written only as '1'; absence means off and
//                                 must NOT be reported as a lost explicit choice
//
// Contract: C-528 AC-6, Migration & Rollback.

import {
  HUD_DEFAULT_PRESET_ID,
  HUD_PREFERENCES_STORAGE_KEY,
  LEGACY_CLOCK_HUD_VISIBLE_KEY,
  LEGACY_MUSIC_PLAYER_VISIBLE_KEY,
  LEGACY_QUEST_OVERLAY_VISIBLE_KEY,
} from '@aikami/constants';
import type { HudMigrationMarker, HudUserPreferences } from '@aikami/schemas';
import type { HudWidgetId } from '@aikami/types';
import { setHudWidgetOverride } from './hud_layout_state.ts';

/** The raw values read from the three legacy keys (`undefined` = key absent). */
export type HudLegacySnapshot = {
  readonly questOverlayVisible: string | undefined;
  readonly musicPlayerVisible: string | undefined;
  readonly clockHudVisible: string | undefined;
};

/** The result of mapping the legacy keys. */
export type HudMigrationOutcome = {
  readonly preferences: HudUserPreferences;
  readonly marker: HudMigrationMarker;
  /** Legacy keys that were actually present and honoured. */
  readonly migratedKeys: readonly string[];
};

/** The starting snapshot before migration: the default preset, no overrides. */
export const defaultHudPreferences = (): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: HUD_DEFAULT_PRESET_ID,
  overrides: [],
});

const setOverride = (
  preferences: HudUserPreferences,
  widgetId: HudWidgetId,
  patch: Parameters<typeof setHudWidgetOverride>[0]['patch'],
): HudUserPreferences => setHudWidgetOverride({ preferences, widgetId, patch });

/**
 * Maps the legacy keys onto widget preferences.
 *
 * - The expanded quest card (`'1'`) becomes an always-visible, comfortable
 *   objective. The explicit compact choice (`'0'`) becomes a contextual,
 *   compact objective — an explicit false is preserved, not treated as absent.
 * - The music player maps `'1'`/`'0'` straight to always/hidden.
 * - The clock key is only ever written as `'1'`; absence means off, which is
 *   already the shipped default, so absence writes nothing and is not reported
 *   as a migrated key.
 */
export const migrateHudLegacyPreferences = (
  snapshot: HudLegacySnapshot,
  now: string,
): HudMigrationOutcome => {
  let preferences = defaultHudPreferences();
  const migratedKeys: string[] = [];

  if (snapshot.questOverlayVisible === '1') {
    preferences = setOverride(preferences, 'objective', {
      visibility: 'always',
      density: 'comfortable',
    });
    migratedKeys.push(LEGACY_QUEST_OVERLAY_VISIBLE_KEY);
  } else if (snapshot.questOverlayVisible === '0') {
    preferences = setOverride(preferences, 'objective', {
      visibility: 'contextual',
      density: 'compact',
    });
    migratedKeys.push(LEGACY_QUEST_OVERLAY_VISIBLE_KEY);
  }

  if (snapshot.musicPlayerVisible === '1') {
    preferences = setOverride(preferences, 'music-player', { visibility: 'always' });
    migratedKeys.push(LEGACY_MUSIC_PLAYER_VISIBLE_KEY);
  } else if (snapshot.musicPlayerVisible === '0') {
    preferences = setOverride(preferences, 'music-player', { visibility: 'hidden' });
    migratedKeys.push(LEGACY_MUSIC_PLAYER_VISIBLE_KEY);
  }

  if (snapshot.clockHudVisible === '1') {
    preferences = setOverride(preferences, 'clock', { visibility: 'always' });
    migratedKeys.push(LEGACY_CLOCK_HUD_VISIBLE_KEY);
  }

  return {
    preferences,
    marker: {
      schemaVersion: 1,
      migratedAt: now,
      legacyKeys: migratedKeys,
    },
    migratedKeys,
  };
};

/** Whether there is anything at all to migrate. */
export const hasHudLegacyValues = (snapshot: HudLegacySnapshot): boolean =>
  snapshot.questOverlayVisible !== undefined ||
  snapshot.musicPlayerVisible !== undefined ||
  snapshot.clockHudVisible !== undefined;

/**
 * Whether a stored snapshot declares a schema version this build understands.
 *
 * Used to tell "corrupt" from "written by a newer build": the latter must keep
 * its bytes so a downgrade/upgrade cycle does not destroy the player's layout.
 */
export const isKnownHudPreferenceVersion = (raw: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
    return version === 1;
  } catch {
    return false;
  }
};

/** The storage keys owned by this contract, for diagnostics. */
export const HUD_MIGRATION_KEYS = {
  preferences: HUD_PREFERENCES_STORAGE_KEY,
  marker: 'aikami:hud:migration',
  legacyQuestOverlay: LEGACY_QUEST_OVERLAY_VISIBLE_KEY,
  legacyMusicPlayer: LEGACY_MUSIC_PLAYER_VISIBLE_KEY,
  legacyClockHud: LEGACY_CLOCK_HUD_VISIBLE_KEY,
} as const;
