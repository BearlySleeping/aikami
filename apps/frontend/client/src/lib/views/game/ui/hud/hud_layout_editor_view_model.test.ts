// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.test.ts
//
// C-528 AC-2/AC-3 — the editor ViewModel routes every input device through the
// same command machine, previews the DRAFT (never the committed snapshot), and
// asks before discarding unsaved changes.

import { describe, expect, test } from 'bun:test';
import { HUD_DEFAULT_PRESET_ID } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import { HUD_ANCHOR_ORDER } from '$lib/utils/hud/hud_layout_policy.ts';
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
  visibilityToggles: number[];
} => {
  const hud = createHudFixture();
  const closes: number[] = [];
  const visibilityToggles: number[] = [];
  const viewModel = createHudLayoutEditorViewModel({
    className: 'HudLayoutEditorViewModel',
    hud,
    visibility: {
      isHudTemporarilyHidden: false,
      toggleHudTemporarilyHidden: () => visibilityToggles.push(1),
    },
    view: { viewport: { width: 1920, height: 1080 }, textScale: 1 },
    capabilities: ['party', 'time', 'audio-library'],
    dormantWidgetIds: [],
    onClose: () => closes.push(1),
    ...overrides,
  });
  return { viewModel, hud, closes, visibilityToggles };
};

describe('C-528 editor ViewModel — input parity (AC-2)', () => {
  test('toggles temporary HUD visibility from the editor', () => {
    const { viewModel, visibilityToggles } = createVm();

    viewModel.toggleHudTemporarilyHidden();

    expect(visibilityToggles).toEqual([1]);
  });

  test('pointer drag and keyboard anchor moves reach the same configuration', () => {
    const pointer = createVm();
    pointer.viewModel.beginDrag('objective');
    pointer.viewModel.dropOn({ kind: 'region', anchor: 'bottom-end' });

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

  test('the visibility control routes through the same command as the keyboard', () => {
    // The default preset ships the music player `always`, so one step moves it
    // to `contextual`. The claim under test is parity: the button and the
    // keyboard must land on the same value, not a particular value.
    const button = createVm();
    button.viewModel.dispatch({
      kind: 'set-visibility',
      widgetId: 'music-player',
      visibility: 'contextual',
    });
    const keyboard = createVm();
    keyboard.viewModel.selectWidget('music-player');
    keyboard.viewModel.handleKeyDown({ key: 'v', preventDefault: () => {} } as KeyboardEvent);

    const visibilityOf = (vm: HudLayoutEditorViewModelInterface): string | undefined =>
      vm.widgetRows.find((row) => row.widgetId === 'music-player')?.visibility;
    expect(visibilityOf(button.viewModel)).toBe('contextual');
    expect(visibilityOf(keyboard.viewModel)).toBe(visibilityOf(button.viewModel));
  });

  test('a hidden widget is not reachable by a cycling control — removal is explicit', () => {
    // 🔴 Cycling used to include `hidden`, which made one control carry two
    // unrelated decisions AND dead-ended: the override writer strips the
    // patch, so the value never advanced and the control stopped responding.
    const { viewModel } = createVm();
    viewModel.selectWidget('objective');
    for (let press = 0; press < 6; press += 1) {
      viewModel.handleKeyDown({ key: 'v', preventDefault: () => {} } as KeyboardEvent);
    }
    expect(viewModel.selectedRow?.visibility).not.toBe('hidden');
    expect(viewModel.shelfRows).toHaveLength(0);
  });

  test('dropping a widget on its own region is not an edit', () => {
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-center' });
    expect(viewModel.isDirty).toBe(false);
    expect(viewModel.isDragging).toBe(false);
    expect(viewModel.canUndo).toBe(false);
  });

  test('dropping a widget on a reserved region is refused and explains why', () => {
    const { viewModel } = createVm();
    viewModel.beginDrag('objective');
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-center' });
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'objective')?.anchor).toBe(
      'bottom-start',
    );
    expect(viewModel.isDirty).toBe(false);
    expect(viewModel.statusMessage).toBeDefined();
    expect(viewModel.isDragging).toBe(false);
  });

  test('the board marks every region this widget cannot use', () => {
    // 🔴 The board always drew all five regions, but a reserved or absent one
    // refused the drop in silence — indistinguishable from a broken drag. The
    // player now sees which regions are live before committing a drag to one.
    const { viewModel } = createVm();
    viewModel.selectWidget('objective');

    const droppable = viewModel.dropAnchors.filter((drop) => drop.droppable).map((d) => d.anchor);
    // `bottom-center` carries the required interaction/hotbar surfaces.
    expect(droppable).not.toContain('bottom-center');
    expect(droppable).toContain('bottom-end');
    // Every widget row has exactly one verdict per region — none are omitted.
    expect(viewModel.dropAnchors).toHaveLength(HUD_ANCHOR_ORDER.length);
  });

  test('a region that does not exist in this viewport is refused and explained', () => {
    // A touch-class viewport has no `bottom-end`; dropping there used to
    // collapse the widget into the overflow entry with nothing to show for it.
    const { viewModel } = createVm({
      view: { viewport: { width: 390, height: 844 }, textScale: 1 },
    });
    viewModel.selectWidget('music-player');
    const bottomEnd = viewModel.dropAnchors.find((drop) => drop.anchor === 'bottom-end');
    expect(bottomEnd?.allowed).toBe(true);
    expect(bottomEnd?.available).toBe(false);
    expect(bottomEnd?.droppable).toBe(false);

    // Park it somewhere real first, so the refusal is visible as "it did not
    // move" rather than as "it was already there".
    viewModel.beginDrag('music-player');
    viewModel.dropOn({ kind: 'region', anchor: 'top-end' });
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'music-player')?.anchor).toBe(
      'top-end',
    );

    viewModel.beginDrag('music-player');
    const beforeRefusal = JSON.stringify(viewModel.draft);
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-end' });
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'music-player')?.anchor).toBe(
      'top-end',
    );
    // The refusal records nothing: the draft is byte-identical afterwards.
    expect(JSON.stringify(viewModel.draft)).toBe(beforeRefusal);
    expect(viewModel.statusMessage).toContain('window size');
  });

  test('the drag ghost tracks the pointer and clears when the drag ends', () => {
    const { viewModel } = createVm();
    expect(viewModel.draggingLabel).toBeUndefined();
    expect(viewModel.dragPosition).toBeUndefined();

    viewModel.beginDrag('music-player');
    expect(viewModel.draggingLabel).toBe('Music player');
    // No movement yet — no ghost, so a plain click does not flash one.
    expect(viewModel.dragPosition).toBeUndefined();

    viewModel.updateDrag({ x: 10, y: 20, target: { kind: 'region', anchor: 'top-end' } });
    expect(viewModel.dragPosition).toEqual({
      x: 10,
      y: 20,
      target: { kind: 'region', anchor: 'top-end' },
    });

    viewModel.endDrag();
    expect(viewModel.dragPosition).toBeUndefined();
    expect(viewModel.isDragging).toBe(false);
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
    viewModel.handleKeyDown({ key: 'v', preventDefault: () => {} } as KeyboardEvent);
    viewModel.handleKeyDown({ key: 'v', preventDefault: () => {} } as KeyboardEvent);
    viewModel.handleGamepadAction('cycle-visibility');
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'menu')?.visibility).toBe('always');
  });

  test('a dormant widget is labelled unavailable rather than removed', () => {
    const { viewModel } = createVm({ capabilities: ['party', 'time'] });
    const music = viewModel.widgetRows.find((row) => row.widgetId === 'music-player');
    expect(music?.dormant).toBe(true);
  });

  test('the widget list and preview never contain a duplicate widget id', () => {
    const { viewModel } = createVm();
    const rowIds = viewModel.widgetRows.map((row) => row.widgetId);
    expect(new Set(rowIds).size).toBe(rowIds.length);

    viewModel.beginDrag('music-player');
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-end' });
    viewModel.toggleWidgetHidden('music-player');
    const previewIds = viewModel.previewLayout.widgets.map((widget) => widget.widgetId);
    expect(new Set(previewIds).size).toBe(previewIds.length);
  });
});

describe('C-528 AC-2 — removing a widget off the HUD', () => {
  test('dragging a widget onto the Hidden shelf removes it', () => {
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'hidden' });

    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.visibility).toBe(
      'hidden',
    );
    expect(viewModel.shelfRows.map((row) => row.widgetId)).toContain('hotbar');
    expect(viewModel.hiddenShelfLabel).toBe('Hidden (1)');
    expect(viewModel.isDirty).toBe(true);
  });

  test('a COMMITTED removal still says what it did', () => {
    // 🔴 Regression: `dispatch` clears the status line so a stale sentence
    // cannot survive a new edit, and the outcome message was being written
    // BEFORE the dispatch — so every committed drop reported nothing at all.
    // Only a refusal escaped it, which is why a test that asserted refusals
    // never saw it.
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'hidden' });
    expect(viewModel.isDirty).toBe(true);
    expect(viewModel.statusMessage).toContain('removed from the HUD');

    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-end' });
    expect(viewModel.statusMessage).toContain('put back');
  });

  test('the shelf is a real destination, not "anywhere off the board"', () => {
    // A release with nothing under the pointer must SAY so. Silence is what
    // made the editor feel broken, and it is what a near-miss drop still does
    // if this ever regresses to a no-op.
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn(undefined);

    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.visibility).not.toBe(
      'hidden',
    );
    expect(viewModel.isDirty).toBe(false);
    expect(viewModel.statusMessage).toContain('Hidden shelf');
  });

  test('pointer, keyboard and controller all remove the same widget', () => {
    const pointer = createVm();
    pointer.viewModel.beginDrag('hotbar');
    pointer.viewModel.dropOn({ kind: 'hidden' });

    const keyboard = createVm();
    keyboard.viewModel.selectWidget('hotbar');
    keyboard.viewModel.handleKeyDown({ key: 'h', preventDefault: () => {} } as KeyboardEvent);

    const pad = createVm();
    pad.viewModel.selectWidget('hotbar');
    pad.viewModel.handleGamepadAction('toggle-hidden');

    const expected = pointer.viewModel.widgetRows.find(
      (row) => row.widgetId === 'hotbar',
    )?.visibility;
    expect(expected).toBe('hidden');
    for (const vm of [keyboard.viewModel, pad.viewModel]) {
      expect(vm.widgetRows.find((row) => row.widgetId === 'hotbar')?.visibility).toBe(expected);
    }
  });

  test('a required widget refuses to be removed and explains why', () => {
    const { viewModel } = createVm();
    viewModel.selectWidget('menu');
    viewModel.toggleWidgetHidden('menu');

    expect(viewModel.widgetRows.find((row) => row.widgetId === 'menu')?.visibility).toBe('always');
    expect(viewModel.isDirty).toBe(false);
    // No phantom history entry: Undo must not be a dead press after a refusal.
    expect(viewModel.canUndo).toBe(false);
    expect(viewModel.statusMessage).toContain('required');
  });

  test('a hidden widget comes back exactly as it was, and in one undo step', () => {
    const { viewModel } = createVm();
    viewModel.selectWidget('hotbar');
    viewModel.toggleWidgetHidden('hotbar');
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.visibility).toBe(
      'hidden',
    );

    viewModel.toggleWidgetHidden('hotbar');
    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.visibility).toBe(
      'always',
    );

    // Two presses, two undos — the round trip is symmetric.
    viewModel.dispatch({ kind: 'undo' });
    viewModel.dispatch({ kind: 'undo' });
    expect(viewModel.isDirty).toBe(false);
  });

  test('dragging a hidden widget back onto a region restores AND places it at once', () => {
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'hidden' });
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'region', anchor: 'bottom-end' });

    const row = viewModel.widgetRows.find((entry) => entry.widgetId === 'hotbar');
    expect(row?.visibility).not.toBe('hidden');
    expect(row?.anchor).toBe('bottom-end');

    // One gesture, one undo: it goes back off the HUD in a single press.
    viewModel.dispatch({ kind: 'undo' });
    expect(viewModel.widgetRows.find((entry) => entry.widgetId === 'hotbar')?.visibility).toBe(
      'hidden',
    );
  });

  test('moving a hidden widget with the arrow keys is refused, not silently applied', () => {
    const { viewModel } = createVm();
    viewModel.beginDrag('hotbar');
    viewModel.dropOn({ kind: 'hidden' });
    const anchorBefore = viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.anchor;

    viewModel.selectWidget('hotbar');
    viewModel.handleKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as KeyboardEvent);

    expect(viewModel.widgetRows.find((row) => row.widgetId === 'hotbar')?.anchor).toBe(
      anchorBefore,
    );
    expect(viewModel.statusMessage).toContain('hidden');
  });

  test('Escape during a drag cancels the drag instead of closing the editor', () => {
    const closes: number[] = [];
    const { viewModel } = createVm({ onClose: () => closes.push(1) });
    viewModel.beginDrag('hotbar');
    viewModel.updateDrag({ x: 10, y: 20, target: { kind: 'hidden' } });

    viewModel.handleKeyDown({ key: 'Escape', preventDefault: () => {} } as KeyboardEvent);

    expect(viewModel.isDragging).toBe(false);
    expect(viewModel.isDirty).toBe(false);
    expect(closes).toHaveLength(0);
  });
});
