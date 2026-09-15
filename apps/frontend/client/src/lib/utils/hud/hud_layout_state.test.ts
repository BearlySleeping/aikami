// apps/frontend/client/src/lib/utils/hud/hud_layout_state.test.ts
//
// C-528 — the transactional edit model.
//
// The contract's AC-2 ("each input method can reach the same valid
// configuration") and AC-3 ("Cancel restores the exact prior snapshot") are
// proven here, against the pure command machine every input device feeds.

import { describe, expect, test } from 'bun:test';
import { HUD_DEFAULT_PRESET_ID } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import {
  applyHudEditorCommand,
  applyHudPreset,
  createHudEditorState,
  effectiveHudWidgetPreference,
  exportHudPreset,
  type HudEditorCommand,
  type HudEditorState,
  hudEditorCanRedo,
  hudEditorCanUndo,
  hudEditorIsDirty,
  importHudPreset,
  isHudAnchorAllowed,
  resetHudLayout,
  setHudWidgetOverride,
} from './hud_layout_state.ts';

const committed = (): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: HUD_DEFAULT_PRESET_ID,
  overrides: [],
});

const run = (state: HudEditorState, commands: readonly HudEditorCommand[]): HudEditorState =>
  commands.reduce((current, command) => applyHudEditorCommand(current, command), state);

describe('C-528 AC-2 editor input parity', () => {
  // The three devices produce different COMMANDS for the same intent; the
  // resulting configuration must be identical.
  const pointer: readonly HudEditorCommand[] = [
    { kind: 'set-anchor', widgetId: 'objective', anchor: 'bottom-end' },
    { kind: 'set-scale', widgetId: 'objective', scale: 1.25 },
    { kind: 'set-density', widgetId: 'objective', density: 'comfortable' },
    { kind: 'set-visibility', widgetId: 'objective', visibility: 'always' },
  ];
  const keyboard: readonly HudEditorCommand[] = [
    { kind: 'set-anchor', widgetId: 'objective', anchor: 'bottom-end' },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'set-density', widgetId: 'objective', density: 'comfortable' },
    { kind: 'set-visibility', widgetId: 'objective', visibility: 'always' },
  ];
  const gamepad: readonly HudEditorCommand[] = [
    { kind: 'set-anchor', widgetId: 'objective', anchor: 'bottom-end' },
    { kind: 'set-scale', widgetId: 'objective', scale: 1.2 },
    { kind: 'nudge-scale', widgetId: 'objective', delta: 0.05 },
    { kind: 'set-density', widgetId: 'objective', density: 'comfortable' },
    { kind: 'set-visibility', widgetId: 'objective', visibility: 'always' },
  ];

  test('pointer, keyboard and gamepad reach the same configuration', () => {
    const fromPointer = run(createHudEditorState(committed()), pointer);
    const fromKeyboard = run(createHudEditorState(committed()), keyboard);
    const fromGamepad = run(createHudEditorState(committed()), gamepad);
    expect(fromPointer.draft).toEqual(fromKeyboard.draft);
    expect(fromGamepad.draft).toEqual(fromKeyboard.draft);
  });

  test('unsaved preview never mutates the committed snapshot', () => {
    const state = run(createHudEditorState(committed()), pointer);
    expect(state.committed).toEqual(committed());
    expect(hudEditorIsDirty(state)).toBe(true);
  });

  test('a widget cannot be anchored to a region reserved for required actions', () => {
    expect(isHudAnchorAllowed('objective', 'bottom-center')).toBe(false);
    expect(isHudAnchorAllowed('hotbar', 'bottom-center')).toBe(true);
    const state = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'set-anchor',
      widgetId: 'objective',
      anchor: 'bottom-center',
    });
    expect(effectiveHudWidgetPreference(state.draft, 'objective')?.anchor).toBe('bottom-start');
  });

  test('anchor cycling only visits anchors the widget supports', () => {
    let state = createHudEditorState(committed());
    const visited = new Set<string>();
    for (let step = 0; step < 8; step += 1) {
      state = applyHudEditorCommand(state, {
        kind: 'move-anchor',
        widgetId: 'hotbar',
        direction: 1,
      });
      const anchor = effectiveHudWidgetPreference(state.draft, 'hotbar')?.anchor;
      if (anchor) {
        visited.add(anchor);
      }
    }
    expect(visited).toEqual(new Set(['bottom-center', 'bottom-start', 'bottom-end']));
  });

  test('a required surface cannot be hidden by any command', () => {
    const state = applyHudEditorCommand(createHudEditorState(committed()), {
      kind: 'set-visibility',
      widgetId: 'menu',
      visibility: 'hidden',
    });
    expect(effectiveHudWidgetPreference(state.draft, 'menu')?.visibility).toBe('always');
  });
});

describe('C-528 AC-3 transactional editing', () => {
  test('Cancel restores the exact pre-edit snapshot', () => {
    const before = committed();
    let state = createHudEditorState(before);
    state = run(state, [
      { kind: 'apply-preset', presetId: 'minimal' },
      { kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 },
      { kind: 'reset-widget', widgetId: 'clock' },
    ]);
    expect(hudEditorIsDirty(state)).toBe(true);

    const cancelled = applyHudEditorCommand(state, { kind: 'cancel' });
    expect(cancelled.draft).toEqual(before);
    expect(cancelled.committed).toEqual(before);
    expect(hudEditorIsDirty(cancelled)).toBe(false);
  });

  test('Save commits the draft and clears the history', () => {
    let state = run(createHudEditorState(committed()), [
      { kind: 'apply-preset', presetId: 'tactical' },
      { kind: 'set-scale', widgetId: 'hotbar', scale: 1.3 },
    ]);
    state = applyHudEditorCommand(state, { kind: 'save' });
    expect(state.committed.selectedPresetId).toBe('tactical');
    expect(state.committed).toEqual(state.draft);
    expect(hudEditorCanUndo(state)).toBe(false);
    expect(hudEditorCanRedo(state)).toBe(false);
    expect(hudEditorIsDirty(state)).toBe(false);
  });

  test('Undo and Redo walk the draft without replaying committed state', () => {
    let state = createHudEditorState(committed());
    state = applyHudEditorCommand(state, { kind: 'apply-preset', presetId: 'minimal' });
    const afterPreset = state.draft;
    state = applyHudEditorCommand(state, { kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 });
    expect(hudEditorCanUndo(state)).toBe(true);

    state = applyHudEditorCommand(state, { kind: 'undo' });
    expect(state.draft).toEqual(afterPreset);
    expect(hudEditorCanRedo(state)).toBe(true);

    state = applyHudEditorCommand(state, { kind: 'redo' });
    expect(effectiveHudWidgetPreference(state.draft, 'hotbar')?.scale).toBe(1.4);
    expect(state.committed).toEqual(committed());
  });

  test('per-widget reset affects only the requested widget', () => {
    let state = run(createHudEditorState(committed()), [
      { kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 },
      { kind: 'set-scale', widgetId: 'clock', scale: 1.4 },
    ]);
    state = applyHudEditorCommand(state, { kind: 'reset-widget', widgetId: 'hotbar' });
    expect(effectiveHudWidgetPreference(state.draft, 'hotbar')?.scale).toBe(1);
    expect(effectiveHudWidgetPreference(state.draft, 'clock')?.scale).toBe(1.4);
  });

  test('layout reset returns the shipped safe layout and drops every override', () => {
    let state = run(createHudEditorState(committed()), [
      { kind: 'apply-preset', presetId: 'readable' },
      { kind: 'set-scale', widgetId: 'hotbar', scale: 1.4 },
    ]);
    state = applyHudEditorCommand(state, { kind: 'reset-layout' });
    expect(state.draft).toEqual(resetHudLayout());
    expect(state.draft.overrides).toEqual([]);
  });

  test('Undo on an empty history is a no-op', () => {
    const state = createHudEditorState(committed());
    expect(applyHudEditorCommand(state, { kind: 'undo' })).toEqual(state);
  });
});

describe('C-528 AC-8 preset exchange', () => {
  test('an export carries no accessibility, device or campaign fields', () => {
    const preset = exportHudPreset({
      preferences: applyHudPreset(committed(), 'minimal'),
      id: 'custom',
      name: 'My HUD',
    });
    expect(Object.keys(preset).sort()).toEqual(['id', 'name', 'schemaVersion', 'widgets']);
    for (const widget of preset.widgets) {
      expect(Object.keys(widget).sort()).toEqual([
        'anchor',
        'density',
        'order',
        'scale',
        'visibility',
        'widgetId',
      ]);
    }
  });

  test('an imported preset keeps unknown optional widgets dormant instead of dropping them', () => {
    const preset = exportHudPreset({ preferences: committed(), id: 'custom', name: 'Shared' });
    preset.widgets.push({
      widgetId: 'quest-marker',
      visibility: 'always',
      anchor: 'top-end',
      order: 9,
      density: 'compact',
      scale: 1,
    });
    const result = importHudPreset({ current: committed(), preset });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.dormantWidgetIds).toEqual(['quest-marker']);
    expect(result.preferences.overrides.some((widget) => widget.widgetId === 'quest-marker')).toBe(
      true,
    );
  });

  test('a preset that omits a required surface is rejected with an explanation', () => {
    const preset = exportHudPreset({ preferences: committed(), id: 'custom', name: 'Broken' });
    preset.widgets = preset.widgets.filter((widget) => widget.widgetId !== 'menu');
    const result = importHudPreset({ current: committed(), preset });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('missing-required-widget');
    expect(result.reason === 'missing-required-widget' && result.widgetIds).toEqual(['menu']);
  });

  test('a malformed preset is rejected without throwing', () => {
    expect(importHudPreset({ current: committed(), preset: { schemaVersion: 99 } })).toEqual({
      ok: false,
      reason: 'invalid-preset',
    });
    expect(importHudPreset({ current: committed(), preset: 'not a preset' })).toEqual({
      ok: false,
      reason: 'invalid-preset',
    });
  });
});

describe('C-528 snapshot helpers', () => {
  test('an unknown preset id cannot be selected', () => {
    expect(applyHudPreset(committed(), 'from-a-future-build')).toEqual(committed());
  });

  test('overrides are written once per widget, not appended', () => {
    let preferences = committed();
    for (const scale of [1.1, 1.2, 1.3]) {
      preferences = setHudWidgetOverride({
        preferences,
        widgetId: 'hotbar',
        patch: { scale },
      });
    }
    expect(preferences.overrides).toHaveLength(1);
    expect(preferences.overrides[0]?.scale).toBe(1.3);
  });

  test('out-of-range scales are clamped, not rejected silently', () => {
    const preferences = setHudWidgetOverride({
      preferences: committed(),
      widgetId: 'hotbar',
      patch: { scale: 9 },
    });
    expect(preferences.overrides[0]?.scale).toBe(1.5);
  });
});
