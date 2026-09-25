// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_placement.test.ts
//
// C-528 AC-2/AC-3 — WHERE a widget lives, as one model.
//
// These are the properties the editor's UX rests on, and every one of them is a
// bug that shipped before: a hidden widget that could not be found again, a
// "removed" widget that had in fact merely gone idle in a preview context, a
// required widget that refused silently, and a restore that cost two undos.

import { describe, expect, test } from 'bun:test';
import { HUD_DEFAULT_PRESET_ID } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import { resolveHudLayout } from '$lib/utils/hud/hud_layout_policy.ts';
import {
  applyHudEditorCommand,
  createHudEditorState,
  effectiveHudWidgetPreference,
} from '$lib/utils/hud/hud_layout_state.ts';
import {
  canHideHudWidget,
  hudEditorDropOutcome,
  hudEditorHiddenShelfLabel,
  hudEditorPlacementRows,
  hudEditorRestoreVisibility,
} from './hud_layout_editor_placement.ts';

const CAPABILITIES = ['party', 'time', 'audio-library'] as const;
const VIEWPORT = { width: 1920, height: 1080 } as const;

const committed = (): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: HUD_DEFAULT_PRESET_ID,
  overrides: [],
});

/** The board as the editor draws it, for the same draft the ViewModel holds. */
const rows = (preferences: HudUserPreferences) =>
  hudEditorPlacementRows({
    preferences,
    layout: resolveHudLayout({
      preferences,
      capabilities: [...CAPABILITIES],
      overlay: 'NONE',
      viewport: VIEWPORT,
      textScale: 1,
      relevantWidgetIds: ['objective', 'interaction', 'party-status', 'clock', 'onboarding-hint'],
    }),
    capabilities: [...CAPABILITIES],
  });

const outcome = (
  preferences: HudUserPreferences,
  target: Parameters<typeof hudEditorDropOutcome>[0]['target'],
  options: { readonly widgetId?: string; readonly remembered?: 'always' | 'contextual' } = {},
) =>
  hudEditorDropOutcome({
    widgetId: options.widgetId ?? 'objective',
    target,
    preferences,
    viewport: VIEWPORT,
    remembered: options.remembered,
  });

describe('C-528 AC-2 — removing a widget is a placement', () => {
  test('a widget is on the board or on the shelf, never both and never neither', () => {
    const { rows: result } = rows(committed());

    for (const row of result) {
      expect(row.visibility).not.toBe('hidden');
    }
    // The shipped adventure preset hides nothing, so the shelf starts empty.
    expect(rows(committed()).shelf).toHaveLength(0);
  });

  test('dropping a widget on the shelf removes it, and the shelf keeps it findable', () => {
    const removed = outcome(committed(), { kind: 'hidden' });
    expect(removed.kind).toBe('command');
    if (removed.kind !== 'command') {
      return;
    }
    expect(removed.command).toEqual({ kind: 'hide-widget', widgetId: 'objective' });

    const next = applyHudEditorCommand(createHudEditorState(committed()), removed.command).draft;
    const after = rows(next);
    expect(after.board.some((row) => row.widgetId === 'objective')).toBe(false);
    expect(after.shelf.map((row) => row.widgetId)).toContain('objective');
    expect(after.rows.some((row) => row.widgetId === 'objective')).toBe(true);
    expect(hudEditorHiddenShelfLabel(after.shelf.length)).toBe('Hidden (1)');
  });

  test('a hidden widget keeps its region, so putting it back is a return not a guess', () => {
    const hidden = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'hide-widget',
      widgetId: 'objective',
    }).draft;

    expect(effectiveHudWidgetPreference(hidden, 'objective')?.anchor).toBe('bottom-start');
    expect(rows(hidden).shelf[0]?.anchor).toBe('bottom-start');
  });

  test('a required widget cannot be removed, and says why', () => {
    expect(canHideHudWidget('menu')).toBe(false);
    expect(canHideHudWidget('system-notice')).toBe(false);
    expect(canHideHudWidget('hotbar')).toBe(true);

    const refused = hudEditorDropOutcome({
      widgetId: 'menu',
      target: { kind: 'hidden' },
      preferences: committed(),
      viewport: VIEWPORT,
      remembered: undefined,
    });
    expect(refused.kind).toBe('refused');
  });

  test('a refused removal records no history, so Undo is never a dead press', () => {
    const state = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'hide-widget',
      widgetId: 'menu',
    });
    expect(state).toEqual(createHudEditorState(committed()));
    expect(state.undoStack).toHaveLength(0);
  });

  test('dragging a hidden widget onto a region restores AND places it in one undo step', () => {
    const hidden = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'hide-widget',
      widgetId: 'objective',
    });
    const restored = outcome(hidden.draft, { kind: 'region', anchor: 'bottom-end' });

    expect(restored.kind).toBe('command');
    if (restored.kind !== 'command') {
      return;
    }
    expect(restored.command.kind).toBe('show-widget');

    // The removal already cost one undo; the restore costs exactly ONE more,
    // because a drag from the shelf onto a region is a single gesture. The
    // step it undoes is the removal itself, so one press puts it back on the
    // shelf rather than half-restoring it.
    const state = applyHudEditorCommand(hidden, restored.command);
    expect(state.undoStack).toHaveLength(2);
    const oneStepBack = applyHudEditorCommand(state, { kind: 'undo' });
    expect(effectiveHudWidgetPreference(oneStepBack.draft, 'objective')?.visibility).toBe('hidden');
    const preference = effectiveHudWidgetPreference(state.draft, 'objective');
    expect(preference?.visibility).not.toBe('hidden');
    expect(preference?.anchor).toBe('bottom-end');
  });
});

describe('C-528 AC-2 — "not shown right now" is not "removed"', () => {
  test('a contextual widget idle in the selected fixture stays on the board', () => {
    // `autosave` is contextual in the adventure preset and nothing in the
    // `explore` fixture makes it relevant. It must still be ON THE BOARD,
    // marked inactive — not swept into the shelf with the hidden ones.
    const autosave = rows(committed()).board.find((row) => row.widgetId === 'autosave');
    expect(autosave).toBeDefined();
    expect(autosave?.idleInContext).toBe(true);
    expect(autosave?.visibility).toBe('contextual');
    expect(rows(committed()).shelf.some((row) => row.widgetId === 'autosave')).toBe(false);
  });

  test('a widget missing its capability is marked unavailable, not removed', () => {
    const preferences = committed();
    const result = hudEditorPlacementRows({
      preferences,
      layout: resolveHudLayout({
        preferences,
        capabilities: [],
        overlay: 'NONE',
        viewport: VIEWPORT,
        textScale: 1,
        relevantWidgetIds: [],
      }),
      capabilities: [],
    });
    const musicPlayer = result.board.find((row) => row.widgetId === 'music-player');
    expect(musicPlayer?.dormant).toBe(true);
    expect(result.shelf.some((row) => row.widgetId === 'music-player')).toBe(false);
  });
});

describe('C-528 AC-3 — restoring returns the widget as it was', () => {
  test('the visibility a widget had when it was removed is the one it comes back with', () => {
    const contextual = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'hide-widget',
      widgetId: 'objective',
    }).draft;

    expect(
      hudEditorRestoreVisibility({
        widgetId: 'objective',
        preferences: contextual,
        remembered: 'contextual',
      }),
    ).toBe('contextual');
  });

  test('with no session memory the shipped preset decides, not a hard-coded always', () => {
    // `clock` ships `contextual` in adventure; `hotbar` ships `always`.
    const preferences = committed();
    const clock = hudEditorRestoreVisibility({
      widgetId: 'clock',
      preferences,
      remembered: undefined,
    });
    const hotbar = hudEditorRestoreVisibility({
      widgetId: 'hotbar',
      preferences,
      remembered: undefined,
    });
    expect(clock).toBe('contextual');
    expect(hotbar).toBe('always');
  });

  test('dropping a widget back on its own region is not an edit', () => {
    // The object ships `bottom-center`; re-dropping it there changes nothing,
    // so a stray drop must not append a redundant override.
    // `objective` ships `bottom-start`; re-dropping it there changes nothing.
    const result = outcome(committed(), { kind: 'region', anchor: 'bottom-start' });
    expect(result.kind).toBe('no-change');
  });
});
