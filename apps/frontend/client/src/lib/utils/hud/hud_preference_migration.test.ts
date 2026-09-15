// apps/frontend/client/src/lib/utils/hud/hud_preference_migration.test.ts
//
// C-528 AC-6 — legacy encodings must survive exactly once, and an unknown
// future schema must never be treated as corrupt.

import { describe, expect, test } from 'bun:test';
import { HUD_MIGRATION_MARKER_KEY, HUD_PREFERENCES_STORAGE_KEY } from '@aikami/constants';
import {
  defaultHudPreferences,
  HUD_MIGRATION_KEYS,
  hasHudLegacyValues,
  isKnownHudPreferenceVersion,
  migrateHudLegacyPreferences,
} from './hud_preference_migration.ts';

const NOW = '2026-09-14T00:00:00.000Z';

const migrate = (snapshot: Parameters<typeof migrateHudLegacyPreferences>[0]) =>
  migrateHudLegacyPreferences(snapshot, NOW);

const overrideFor = (outcome: ReturnType<typeof migrateHudLegacyPreferences>, widgetId: string) =>
  outcome.preferences.overrides.find((widget) => widget.widgetId === widgetId);

describe('C-528 AC-6 legacy migration', () => {
  test('an absent quest-overlay key writes no override at all', () => {
    const outcome = migrate({});
    expect(outcome.preferences).toEqual(defaultHudPreferences());
    expect(outcome.migratedKeys).toEqual([]);
  });

  test("quest-overlay '0' is an explicit compact choice and survives", () => {
    const outcome = migrate({ questOverlayVisible: '0' });
    expect(overrideFor(outcome, 'objective')).toMatchObject({
      visibility: 'contextual',
      density: 'compact',
    });
    expect(outcome.migratedKeys).toEqual([HUD_MIGRATION_KEYS.legacyQuestOverlay]);
  });

  test("quest-overlay '1' restores the expanded card", () => {
    const outcome = migrate({ questOverlayVisible: '1' });
    expect(overrideFor(outcome, 'objective')).toMatchObject({
      visibility: 'always',
      density: 'comfortable',
    });
  });

  test('the music player maps both explicit values', () => {
    expect(overrideFor(migrate({ musicPlayerVisible: '1' }), 'music-player')?.visibility).toBe(
      'always',
    );
    expect(overrideFor(migrate({ musicPlayerVisible: '0' }), 'music-player')?.visibility).toBe(
      'hidden',
    );
    expect(overrideFor(migrate({}), 'music-player')).toBeUndefined();
  });

  test('clock absence means off and is not reported as a lost explicit choice', () => {
    const absent = migrate({});
    expect(overrideFor(absent, 'clock')).toBeUndefined();
    expect(absent.migratedKeys).not.toContain(HUD_MIGRATION_KEYS.legacyClockHud);

    const present = migrate({ clockHudVisible: '1' });
    expect(overrideFor(present, 'clock')?.visibility).toBe('always');
    expect(present.migratedKeys).toContain(HUD_MIGRATION_KEYS.legacyClockHud);
  });

  test('the marker is versioned and records only the keys actually honoured', () => {
    const outcome = migrate({ questOverlayVisible: '0', musicPlayerVisible: '1' });
    expect(outcome.marker).toEqual({
      schemaVersion: 1,
      migratedAt: NOW,
      legacyKeys: [HUD_MIGRATION_KEYS.legacyQuestOverlay, HUD_MIGRATION_KEYS.legacyMusicPlayer],
    });
  });

  test('migration is repeatable — the same input always gives the same snapshot', () => {
    const first = migrate({ questOverlayVisible: '0', clockHudVisible: '1' });
    const second = migrate({ questOverlayVisible: '0', clockHudVisible: '1' });
    expect(second.preferences).toEqual(first.preferences);
  });

  test('an unrelated legacy value is left alone', () => {
    const outcome = migrate({ questOverlayVisible: 'yes' });
    expect(outcome.preferences.overrides).toEqual([]);
    expect(outcome.migratedKeys).toEqual([]);
  });

  test('detects whether there is anything to migrate', () => {
    expect(hasHudLegacyValues({})).toBe(false);
    expect(hasHudLegacyValues({ clockHudVisible: '0' })).toBe(true);
  });
});

describe('C-528 AC-6 stored-version detection', () => {
  test('recognises the current version', () => {
    expect(isKnownHudPreferenceVersion(JSON.stringify(defaultHudPreferences()))).toBe(true);
  });

  test('a future version is unknown, not corrupt', () => {
    expect(
      isKnownHudPreferenceVersion('{"schemaVersion":2,"selectedPresetId":"x","overrides":[]}'),
    ).toBe(false);
  });

  test('garbage is unknown', () => {
    expect(isKnownHudPreferenceVersion('not json')).toBe(false);
    expect(isKnownHudPreferenceVersion('null')).toBe(false);
  });

  test('the storage keys are the documented ones', () => {
    expect(HUD_MIGRATION_KEYS.preferences).toBe(HUD_PREFERENCES_STORAGE_KEY);
    expect(HUD_MIGRATION_KEYS.marker).toBe(HUD_MIGRATION_MARKER_KEY);
  });
});
