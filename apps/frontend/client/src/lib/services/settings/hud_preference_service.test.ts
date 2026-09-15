// apps/frontend/client/src/lib/services/settings/hud_preference_service.test.ts
//
// C-528 AC-3/AC-6/AC-7/AC-8 — the HUD preference authority.
//
// 🔴 Why the imports below are DYNAMIC with a distinct specifier.
//
// The regressions this guards are all about what happens at CONSTRUCTION: a
// snapshot restored from storage, a legacy migration that must run exactly
// once, and a corrupt/future snapshot that must not be destructively rewritten.
// Bun isolates each test FILE, so a static import would be evaluated before any
// `localStorage.setItem` and every assertion would be vacuous. Each scenario
// therefore imports the module through a fresh specifier, which is a genuine
// first evaluation of that module instance.
//
// (Do not add a static import of the service here.)

import { describe, expect, test } from 'bun:test';
import {
  HUD_MIGRATION_MARKER_KEY,
  HUD_PREFERENCES_STORAGE_KEY,
  LEGACY_CLOCK_HUD_VISIBLE_KEY,
  LEGACY_MUSIC_PLAYER_VISIBLE_KEY,
  LEGACY_QUEST_OVERLAY_VISIBLE_KEY,
} from '@aikami/constants';
import type { HudPreferenceServiceInterface } from './hud_preference_service.svelte.ts';

const loadService = async (scenario: string): Promise<HudPreferenceServiceInterface> => {
  const module = await import(`./hud_preference_service.svelte.ts?scenario=${scenario}`);
  return (module as { hudPreferenceService: HudPreferenceServiceInterface }).hudPreferenceService;
};

const resetStorage = (): void => {
  localStorage.clear();
  sessionStorage.clear();
};

describe('C-528 AC-6 construction-time restore', () => {
  test('a freshly constructed service adopts a valid stored snapshot', async () => {
    resetStorage();
    localStorage.setItem(
      HUD_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        selectedPresetId: 'tactical',
        overrides: [
          {
            widgetId: 'clock',
            visibility: 'always',
            anchor: 'top-end',
            order: 3,
            density: 'compact',
            scale: 1.2,
          },
        ],
      }),
    );
    const service = await loadService('valid-snapshot');
    expect(service.preferences.selectedPresetId).toBe('tactical');
    expect(service.preferences.overrides).toHaveLength(1);
    expect(service.recoveryNotice).toBeUndefined();
  });

  test('a fresh install migrates the legacy keys once and commits the marker', async () => {
    resetStorage();
    localStorage.setItem(LEGACY_QUEST_OVERLAY_VISIBLE_KEY, '0');
    localStorage.setItem(LEGACY_MUSIC_PLAYER_VISIBLE_KEY, '1');

    const service = await loadService('legacy-migration');
    const objective = service.preferences.overrides.find(
      (widget) => widget.widgetId === 'objective',
    );
    expect(objective).toMatchObject({ visibility: 'contextual', density: 'compact' });
    expect(service.preferences.overrides.some((widget) => widget.widgetId === 'music-player')).toBe(
      true,
    );

    // The marker is committed with the values…
    const marker = localStorage.getItem(HUD_MIGRATION_MARKER_KEY);
    expect(marker).toBeTruthy();
    // …and the legacy keys are left intact for the rollback window.
    expect(localStorage.getItem(LEGACY_QUEST_OVERLAY_VISIBLE_KEY)).toBe('0');
    expect(localStorage.getItem(LEGACY_MUSIC_PLAYER_VISIBLE_KEY)).toBe('1');
  });

  test('the clock key is only honoured when explicitly on', async () => {
    resetStorage();
    const withoutClock = await loadService('clock-absent');
    expect(withoutClock.preferences.overrides.some((widget) => widget.widgetId === 'clock')).toBe(
      false,
    );

    resetStorage();
    localStorage.setItem(LEGACY_CLOCK_HUD_VISIBLE_KEY, '1');
    const withClock = await loadService('clock-present');
    expect(withClock.preferences.overrides.some((widget) => widget.widgetId === 'clock')).toBe(
      true,
    );
  });

  test('migration does not run again once the marker exists', async () => {
    resetStorage();
    localStorage.setItem(LEGACY_QUEST_OVERLAY_VISIBLE_KEY, '0');
    localStorage.setItem(
      HUD_MIGRATION_MARKER_KEY,
      JSON.stringify({ schemaVersion: 1, migratedAt: '2026-09-14T00:00:00.000Z', legacyKeys: [] }),
    );
    const service = await loadService('marker-present');
    expect(service.preferences.overrides).toEqual([]);
  });

  test('corrupt stored data falls back safely without rewriting it', async () => {
    resetStorage();
    const corrupt =
      '{"schemaVersion":1,"selectedPresetId":"adventure","overrides":[{"widgetId":"hotbar"}]}';
    localStorage.setItem(HUD_PREFERENCES_STORAGE_KEY, corrupt);

    const service = await loadService('corrupt');
    expect(service.preferences.selectedPresetId).toBe('adventure');
    expect(service.recoveryNotice).toContain('could not be read');
    expect(localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY)).toBe(corrupt);
  });

  test('a snapshot from a newer build is retained byte-for-byte', async () => {
    resetStorage();
    const future = JSON.stringify({ schemaVersion: 2, selectedPresetId: 'future', overrides: [] });
    localStorage.setItem(HUD_PREFERENCES_STORAGE_KEY, future);

    const service = await loadService('future-version');
    expect(service.recoveryNotice).toContain('newer version');
    expect(localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY)).toBe(future);
  });

  test('an unrelated stored preference is untouched by construction', async () => {
    resetStorage();
    localStorage.setItem('aikami:motion:preference', 'reduce');
    await loadService('unrelated');
    expect(localStorage.getItem('aikami:motion:preference')).toBe('reduce');
  });
});

describe('C-528 AC-3/AC-7 editing through the single authority', () => {
  test('the editor session is transactional and Cancel restores the prior snapshot', async () => {
    resetStorage();
    const service = await loadService('editor-session');
    const before = JSON.stringify(service.preferences);

    service.beginEdit();
    service.dispatch({ kind: 'apply-preset', presetId: 'minimal' });
    service.dispatch({ kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 });
    expect(service.isDirty).toBe(true);
    expect(JSON.stringify(service.preferences)).toBe(before);

    service.cancel();
    expect(service.isDirty).toBe(false);
    expect(JSON.stringify(service.preferences)).toBe(before);
  });

  test('Save persists the draft and a fresh construction reads it back', async () => {
    resetStorage();
    const service = await loadService('save-then-reload');
    service.beginEdit();
    service.dispatch({ kind: 'apply-preset', presetId: 'readable' });
    service.save();

    const reloaded = await loadService('save-then-reload-again');
    expect(reloaded.preferences.selectedPresetId).toBe('readable');
  });

  test('Undo is available during an edit session and restores the previous draft', async () => {
    resetStorage();
    const service = await loadService('undo');
    service.beginEdit();
    service.dispatch({ kind: 'apply-preset', presetId: 'minimal' });
    service.dispatch({ kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 });
    expect(service.canUndo).toBe(true);
    service.dispatch({ kind: 'undo' });
    expect(service.draft.overrides.some((widget) => widget.scale === 1.4)).toBe(false);
  });

  test('settings-page edits apply immediately and persist', async () => {
    resetStorage();
    const service = await loadService('immediate');
    service.selectPreset('tactical');
    expect(service.preferences.selectedPresetId).toBe('tactical');
    expect(localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY)).toContain('tactical');

    service.resetWidget('clock');
    service.restoreDefaults();
    expect(service.preferences.selectedPresetId).toBe('adventure');
    expect(service.preferences.overrides).toEqual([]);
  });

  test('temporary Hide HUD never writes to the preference snapshot', async () => {
    resetStorage();
    const service = await loadService('hide-hud');
    const before = localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY);
    service.setHudTemporarilyHidden(true);
    expect(service.isHudTemporarilyHidden).toBe(true);
    expect(localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY)).toBe(before);

    // A reload of the same tab keeps the temporary state; the preferences are
    // still untouched, so restoring is always possible.
    const reloaded = await loadService('hide-hud-reload');
    expect(reloaded.isHudTemporarilyHidden).toBe(true);
    expect(reloaded.preferences.overrides).toEqual([]);
  });
});

describe('C-528 AC-6 rollback switch', () => {
  test('disabling the editor falls back to the safe layout without deleting the snapshot', async () => {
    resetStorage();
    const service = await loadService('rollback');
    service.selectPreset('tactical');
    const stored = localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY);
    expect(stored).toContain('tactical');

    service.setEditorEnabled(false);
    expect(service.preferences.selectedPresetId).toBe('adventure');
    expect(localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY)).toBe(stored);

    // Unrelated preferences survive too.
    expect(service.isHudTemporarilyHidden).toBe(false);
  });
});

describe('C-528 AC-8 import through the authority', () => {
  test('an incompatible preset is rejected with a reason and changes nothing', async () => {
    resetStorage();
    const service = await loadService('import-reject');
    const before = JSON.stringify(service.preferences);
    const failure = service.importPreset({ schemaVersion: 1, id: 'x', name: 'X', widgets: [] });
    expect(failure?.reason).toBe('missing-required-widget');
    expect(JSON.stringify(service.preferences)).toBe(before);

    expect(service.importPreset('nonsense')?.reason).toBe('invalid-preset');
  });

  test('a valid export round-trips back in', async () => {
    resetStorage();
    const service = await loadService('export-round-trip');
    service.selectPreset('readable');
    const exported = service.exportPreset('Shared layout');
    expect(service.importPreset(exported)).toBeUndefined();
    expect(service.preferences.selectedPresetId).toBe('readable');
  });
});
