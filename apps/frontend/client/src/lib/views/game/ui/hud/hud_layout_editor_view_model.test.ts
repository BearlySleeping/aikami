// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.test.ts
//
// C-528 AC-2/AC-3 — the editor ViewModel routes every input device through the
// same command machine, previews the DRAFT (never the committed snapshot), and
// asks before discarding unsaved changes.

import { describe, expect, test } from 'bun:test';
import { HUD_DEFAULT_PRESET_ID } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import {
  applyHudEditorCommand,
  createHudEditorState,
  type HudEditorCommand,
  type HudEditorState,
} from '$lib/utils/hud/hud_layout_state.ts';
import {
  createHudLayoutEditorViewModel,
  type HudEditorPreferenceCapabilities,
  type HudLayoutEditorViewModelInterface,
} from './hud_layout_editor_view_model.svelte';

const basePreferences = (): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: HUD_DEFAULT_PRESET_ID,
  overrides: [],
});

/** A stand-in for HudPreferenceService that applies the same pure commands. */
const createHudFixture = (): HudEditorPreferenceCapabilities & {
  readonly committedSnapshot: () => HudUserPreferences;
} => {
  let state: HudEditorState = createHudEditorState(basePreferences());
  const fixture = {
    get preferences() {
      return state.committed;
    },
    get draft() {
      return state.draft;
    },
    get isDirty() {
      return JSON.stringify(state.draft) !== JSON.stringify(state.committed);
    },
    get canUndo() {
      return state.undoStack.length > 0;
    },
    get canRedo() {
      return state.redoStack.length > 0;
    },
    isEditorEnabled: true,
    recoveryNotice: undefined as string | undefined,
    beginEdit(): void {
      state = createHudEditorState(state.committed);
    },
    dispatch(command: HudEditorCommand): void {
      state = applyHudEditorCommand(state, command);
    },
    save(): void {
      state = applyHudEditorCommand(state, { kind: 'save' });
    },
    cancel(): void {
      state = applyHudEditorCommand(state, { kind: 'cancel' });
    },
    exportPreset(): unknown {
      return { schemaVersion: 1, id: 'custom', name: 'x', widgets: [] };
    },
    importPreset(): { reason: string } | undefined {
      return undefined;
    },
    committedSnapshot: () => state.committed,
  };
  return fixture;
};

const createVm = (
  overrides: Partial<Parameters<typeof createHudLayoutEditorViewModel>[0]> = {},
): {
  viewModel: HudLayoutEditorViewModelInterface;
  hud: ReturnType<typeof createHudFixture>;
  closes: number[];
} => {
  const hud = createHudFixture();
  const closes: number[] = [];
  const viewModel = createHudLayoutEditorViewModel({
    className: 'HudLayoutEditorViewModel',
    hud,
    view: { viewport: { width: 1920, height: 1080 }, textScale: 1 },
    capabilities: ['party', 'time', 'audio-library'],
    dormantWidgetIds: [],
    onClose: () => closes.push(1),
    ...overrides,
  });
  return { viewModel, hud, closes };
};

describe('C-528 editor ViewModel — input parity (AC-2)', () => {
  test('pointer drag and keyboard anchor moves reach the same configuration', () => {
    const pointer = createVm();
    pointer.viewModel.beginDrag('objective');
    pointer.viewModel.dropOnAnchor('bottom-end');

    const keyboard = createVm();
    keyboard.viewModel.selectWidget('objective');
    // Right/left cycle through the anchors this widget supports.
    for (let step = 0; step < 4; step += 1) {
      keyboard.viewModel.handleKeyDown({
        key: 'ArrowRight',
        preventDefault: () => {},
      } as KeyboardEvent);
    }

    const pointerAnchor = pointer.viewModel.widgetRows.find(
      (row) => row.widgetId === 'objective',
    )?.anchor;
    const keyboardAnchor = keyboard.viewModel.widgetRows.find(
      (row) => row.widgetId === 'objective',
    )?.anchor;
    expect(pointerAnchor).toBe('bottom-end');
    expect(keyboardAnchor).toBe(pointerAnchor);
  });

  test('gamepad actions produce the same draft as the pointer and keyboard', () => {
    const pointer = createVm();
    pointer.viewModel.selectWidget('hotbar');
    pointer.viewModel.nudgeSelectedScale(0.05);
    pointer.viewModel.nudgeSelectedScale(0.05);

    const pad = createVm();
    pad.viewModel.selectWidget('hotbar');
    pad.viewModel.handleGamepadAction('scale-up');
    pad.viewModel.handleGamepadAction('scale-up');

    const pointerScale = pointer.viewModel.widgetRows.find(
      (row) => row.widgetId === 'hotbar',
    )?.scale;
    const padScale = pad.viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.scale;
    expect(pointerScale).toBe(1.1);
    expect(padScale).toBe(pointerScale);
  });

  test('Tab stays inside the editor while selecting the adjacent widget', () => {
    const { viewModel } = createVm();
    const before = viewModel.selectedWidgetId;
    let prevented = false;
    viewModel.handleKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => {
        prevented = true;
      },
    } as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(viewModel.selectedWidgetId).not.toBe(before);
  });

  test('uppercase V cycles visibility through the shared command path', () => {
    const { viewModel } = createVm();
    viewModel.selectWidget('objective');
    const before = viewModel.selectedRow?.visibility;
    viewModel.handleKeyDown({ key: 'V', preventDefault: () => {} } as KeyboardEvent);
    expect(viewModel.selectedRow?.visibility).not.toBe(before);
  });

  test('the preview shows the draft, not the committed snapshot', () => {
    const { viewModel, hud } = createVm();
    viewModel.selectWidget('clock');
    viewModel.dispatch({
      kind: 'set-visibility',
      widgetId: 'clock',
      visibility: 'always',
    });
    expect(viewModel.previewLayout.widgets.some((widget) => widget.widgetId === 'clock')).toBe(
      true,
    );
    expect(hud.committedSnapshot().overrides).toEqual([]);
  });

  test('the preview never applies the overlay-hidden policy', () => {
    const { viewModel } = createVm();
    viewModel.setPreviewContext('combat');
    // The editor is a paused surface: the preview must still show the layout.
    expect(viewModel.previewLayout.widgets.length).toBeGreaterThan(0);
  });
});

describe('C-528 editor ViewModel — transactional editing (AC-3)', () => {
  test('Cancel restores the prior snapshot and closes the overlay', () => {
    const { viewModel, hud, closes } = createVm();
    viewModel.selectWidget('hotbar');
    viewModel.nudgeSelectedScale(0.2);
    expect(viewModel.isDirty).toBe(true);

    viewModel.cancel();
    expect(viewModel.isDirty).toBe(false);
    expect(hud.committedSnapshot().overrides).toEqual([]);
    expect(closes).toHaveLength(1);
  });

  test('Save commits and closes the overlay', () => {
    const { viewModel, hud, closes } = createVm();
    viewModel.selectWidget('hotbar');
    viewModel.nudgeSelectedScale(0.2);
    viewModel.save();
    expect(hud.committedSnapshot().overrides.some((widget) => widget.scale === 1.2)).toBe(true);
    expect(closes).toHaveLength(1);
  });

  test('closing with unsaved changes asks first', () => {
    const { viewModel, closes } = createVm();
    viewModel.selectWidget('hotbar');
    viewModel.nudgeSelectedScale(0.2);

    viewModel.requestClose();
    expect(viewModel.confirmingDiscard).toBe(true);
    expect(closes).toHaveLength(0);

    viewModel.cancelDiscard();
    expect(viewModel.confirmingDiscard).toBe(false);
    expect(closes).toHaveLength(0);

    viewModel.requestClose();
    viewModel.confirmDiscard();
    expect(closes).toHaveLength(1);
  });

  test('an unchanged editor closes without a confirmation', () => {
    const { viewModel, closes } = createVm();
    viewModel.requestClose();
    expect(viewModel.confirmingDiscard).toBe(false);
    expect(closes).toHaveLength(1);
  });

  test('Undo and redo are exposed to the editor controls', () => {
    const { viewModel } = createVm();
    viewModel.selectWidget('hotbar');
    viewModel.nudgeSelectedScale(0.2);
    expect(viewModel.canUndo).toBe(true);
    viewModel.dispatch({ kind: 'undo' });
    expect(viewModel.canRedo).toBe(true);
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.scale).toBe(1);
  });

  test('a required widget is offered no way to be hidden', () => {
    const { viewModel } = createVm();
    viewModel.selectWidget('menu');
    viewModel.cycleSelectedVisibility();
    viewModel.cycleSelectedVisibility();
    viewModel.cycleSelectedVisibility();
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'menu')?.visibility).toBe('always');
  });

  test('a dormant widget is labelled unavailable rather than removed', () => {
    const { viewModel } = createVm({ capabilities: ['party', 'time'] });
    const music = viewModel.widgetRows.find((row) => row.widgetId === 'music-player');
    expect(music?.dormant).toBe(true);
  });
});
