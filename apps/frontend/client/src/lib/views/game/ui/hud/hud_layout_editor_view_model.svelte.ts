// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.svelte.ts
//
// C-528 AC-2/AC-3 — the HUD layout editor ViewModel.
//
// 🔴 The editor has ONE edit path. Pointer drag, keyboard and gamepad all
// produce a `HudEditorCommand` and hand it to the same `dispatch()`; the
// contract's "each method can reach the same valid configuration" is therefore a
// property of the design, not three implementations kept in sync by hand.
//
// 🔴 Every widget lives in exactly one of six places: five board regions, or the
// Hidden shelf. "Remove" is a placement, not a visibility side effect, so the
// decision of what a drop means lives in ONE pure module
// (`hud_layout_editor_placement.ts`) and this file only routes to it. The key
// and button vocabularies are likewise tables in `hud_layout_editor_input.ts`.
//
// The preview is a read-only fixture presentation over a paused session: it
// resolves the DRAFT against a fixture context and renders the real widgets. It
// is not a second engine and not a combat simulator.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { HudVisibility, HudWidgetId } from '@aikami/types';
import type { HudResolvedLayout } from '$lib/utils/hud/hud_layout_policy.ts';
import {
  effectiveHudWidgetPreference,
  type HudEditorCommand,
} from '$lib/utils/hud/hud_layout_state.ts';
import type {
  HudEditorPreferenceCapabilities,
  HudEditorViewportCapabilities,
  HudEditorVisibilityCapabilities,
  HudEditorWidgetRow,
} from './hud_layout_editor_capabilities.ts';
import {
  type HudEditorDropAnchor,
  hudEditorDropAnchors,
} from './hud_layout_editor_drop_anchors.ts';
import {
  createHudEditorGamepadReader,
  HUD_EDITOR_GUARDED_ACTIONS,
  type HudEditorGamepadAction,
  type HudEditorGamepadReader,
  type HudEditorKeyIntent,
  hudEditorKeyIntent,
} from './hud_layout_editor_input.ts';
import {
  createHudLayoutEditorInteractionAdapter,
  type HudLayoutEditorInteractionAdapter,
} from './hud_layout_editor_interaction.ts';
import {
  canHideHudWidget,
  HUD_EDITOR_NOTHING_DROPPED_MESSAGE,
  type HudEditorBoardRow,
  type HudEditorDropOutcome,
  type HudEditorDropTarget,
  type HudEditorPlacementRows,
  hudEditorDropOutcome,
  hudEditorHiddenEditSentence,
  hudEditorHiddenShelfLabel,
  hudEditorPlacementRows,
  hudEditorRestoreVisibility,
  labelFor,
} from './hud_layout_editor_placement.ts';
import {
  HUD_EDITOR_EXPORT_NAME,
  hudEditorExportPresetJson,
  hudEditorImportFailureMessage,
  readHudEditorPresetJson,
} from './hud_layout_editor_presets.ts';
import {
  createHudEditorPreview,
  type HudEditorPreview,
  type HudPreviewContext,
} from './hud_layout_editor_preview.svelte.ts';

export type {
  HudEditorPreferenceCapabilities,
  HudEditorViewportCapabilities,
  HudEditorVisibilityCapabilities,
  HudEditorWidgetRow,
} from './hud_layout_editor_capabilities.ts';
export type { HudEditorGamepadAction } from './hud_layout_editor_input.ts';
export {
  createHudEditorPreview,
  HUD_PREVIEW_CONTEXTS,
  type HudEditorPreview,
  type HudEditorPreviewInput,
  type HudPreviewContext,
} from './hud_layout_editor_preview.svelte.ts';

/**
 * Live pointer state for the drag ghost.
 *
 * `target` is the destination under the pointer right now (resolved by the DOM
 * interaction adapter); the ViewModel only holds the value so the ghost and the
 * highlighted region or shelf can be rendered without view-local state.
 */
export type HudEditorDragPosition = {
  readonly x: number;
  readonly y: number;
  readonly target: HudEditorDropTarget | undefined;
};

export type HudLayoutEditorViewModelOptions = BaseViewModelOptions & {
  readonly hud: HudEditorPreferenceCapabilities;
  readonly visibility: HudEditorVisibilityCapabilities;
  /** Returns to the pause menu after Save or Cancel. */
  readonly onClose: () => void;
  readonly view: HudEditorViewportCapabilities;
  /** Capability keys available this session (drives the dormant badge). */
  readonly capabilities: readonly string[];
  /** Persisted ids this build does not register. */
  readonly dormantWidgetIds: readonly string[];
};

export type HudLayoutEditorViewModelInterface = BaseViewModelInterface & {
  readonly isEditorEnabled: boolean;
  readonly isHudTemporarilyHidden: boolean;
  readonly recoveryNotice: string | undefined;
  readonly widgetRows: readonly HudEditorWidgetRow[];
  readonly dormantWidgetIds: readonly string[];
  readonly selectedWidgetId: HudWidgetId | undefined;
  readonly selectedRow: HudEditorWidgetRow | undefined;
  readonly previewContext: HudPreviewContext;
  readonly previewContexts: readonly HudPreviewContext[];
  readonly previewLayout: HudResolvedLayout;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly confirmingDiscard: boolean;
  readonly statusMessage: string | undefined;
  readonly isDragging: boolean;
  /** The five board regions, annotated with whether this drag may use each. */
  readonly dropAnchors: readonly HudEditorDropAnchor[];
  /** Chips drawn in a region — every widget that is not on the shelf. */
  readonly boardRows: readonly HudEditorBoardRow[];
  /** Chips drawn on the Hidden shelf. Restoring is dragging one back out. */
  readonly shelfRows: readonly HudEditorBoardRow[];
  /** The shelf caption, counting what is on it. */
  readonly hiddenShelfLabel: string;
  /** Whether the dragged widget may be removed at all. */
  readonly canHideDraggedWidget: boolean;
  /** Label of the widget being dragged, for the floating drag ghost. */
  readonly draggingLabel: string | undefined;
  /** Live pointer position + destination while dragging. */
  readonly dragPosition: HudEditorDragPosition | undefined;

  selectWidget(widgetId: HudWidgetId): void;
  selectAdjacentWidget(direction: 1 | -1): void;
  setPreviewContext(context: HudPreviewContext): void;
  dispatch(command: HudEditorCommand): void;
  handleEditorKeyDown(event: KeyboardEvent): void;
  handleWidgetRowKeyDown(event: KeyboardEvent): void;
  /**
   * Forwards one raw pointer event from a drag source to the interaction
   * adapter, which owns the whole pointerdown/move/up/capture protocol.
   */
  handlePointerEvent(event: PointerEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleGamepadAction(action: HudEditorGamepadAction): void;
  toggleHudTemporarilyHidden(): void;
  beginDrag(widgetId: HudWidgetId): void;
  /** Records the pointer position (and destination) for the drag ghost. */
  updateDrag(position: HudEditorDragPosition): void;
  /** `undefined` = released with nothing under the pointer. */
  dropOn(target: HudEditorDropTarget | undefined): void;
  endDrag(): void;
  nudgeSelectedScale(delta: number): void;
  /** Removes or restores one widget, whichever it currently needs. */
  toggleWidgetHidden(widgetId: HudWidgetId): void;
  /** Removes the selection, or restores it if it is already off the HUD. */
  toggleSelectedHidden(): void;
  save(): void;
  cancel(): void;
  requestClose(): void;
  confirmDiscard(): void;
  cancelDiscard(): void;
  importPresetJson(raw: string): void;
  exportPresetJson(): string;
};

/** Scale step used by every input device. */
const SCALE_STEP = 0.05;

class HudLayoutEditorViewModel
  extends BaseViewModel<HudLayoutEditorViewModelOptions>
  implements HudLayoutEditorViewModelInterface
{
  private readonly _hud: HudEditorPreferenceCapabilities;
  private readonly _visibility: HudEditorVisibilityCapabilities;
  private readonly _onClose: () => void;
  private readonly _view: HudEditorViewportCapabilities;
  private readonly _capabilities: readonly string[];
  private readonly _interactionAdapter: HudLayoutEditorInteractionAdapter;
  private readonly _gamepad: HudEditorGamepadReader;
  private readonly _preview: HudEditorPreview;
  /**
   * The visibility each widget had when it was removed, for this session.
   *
   * 🔴 Hide destroys the preference it overwrites, so without this a
   * hide-then-show round trip would return the widget as `always` and quietly
   * change a second setting the player never touched. Session-scoped on
   * purpose: it is an undo buffer for one editing session, not saved state, and
   * the shipped preset's own value is the honest fallback across sessions.
   */
  private readonly _rememberedVisibility = new Map<HudWidgetId, HudVisibility>();

  /**
   * Edit-session revision.
   *
   * 🔴 The draft lives in the preference authority, not here, and this ViewModel
   * is the only reader that must re-render when it changes. Bumping an OWN
   * `$state` counter on every mutation makes the dependency explicit and local,
   * so the template cannot end up bound to a snapshot it never re-reads.
   */
  revision = $state(0);
  selectedWidgetId = $state<HudWidgetId | undefined>(undefined);
  confirmingDiscard = $state(false);
  statusMessage = $state<string | undefined>(undefined);
  isDragging = $state(false);
  dragPosition = $state<HudEditorDragPosition | undefined>(undefined);
  dormantWidgetIds = $state<readonly string[]>([]);

  constructor(options: HudLayoutEditorViewModelOptions) {
    super(options);
    this._hud = options.hud;
    this._visibility = options.visibility;
    this._onClose = options.onClose;
    this._view = options.view;
    this._capabilities = options.capabilities;
    this._interactionAdapter = createHudLayoutEditorInteractionAdapter();
    this._gamepad = createHudEditorGamepadReader({
      onAction: (action) => this.handleGamepadAction(action),
    });
    this._preview = createHudEditorPreview(() => ({
      preferences: this._hud.draft,
      capabilities: this._capabilities,
      viewport: this._view.viewport,
      textScale: this._view.textScale,
    }));
    this.dormantWidgetIds = options.dormantWidgetIds;
    // Opening the editor starts an edit session, so the draft always equals the
    // committed snapshot when the surface appears.
    this._hud.beginEdit();
    this.revision += 1;
    this.selectedWidgetId = this.widgetRows[0]?.widgetId;
  }

  // ── Reads ──

  /** Starts controller polling after the editor has mounted. */
  override async initialize(): Promise<void> {
    this._gamepad.start();
    await super.initialize();
  }

  /** Stops controller polling with the editor lifecycle. */
  override async dispose(): Promise<void> {
    this._gamepad.stop();
    await super.dispose();
  }

  /** @inheritdoc */
  get isEditorEnabled(): boolean {
    return this._hud.isEditorEnabled;
  }

  /** @inheritdoc */
  get isHudTemporarilyHidden(): boolean {
    return this._visibility.isHudTemporarilyHidden;
  }

  /** @inheritdoc */
  get recoveryNotice(): string | undefined {
    return this._hud.recoveryNotice;
  }

  /** @inheritdoc */
  get widgetRows(): readonly HudEditorWidgetRow[] {
    void this.revision;
    return this._placementRows.rows;
  }

  /** @inheritdoc */
  get selectedRow(): HudEditorWidgetRow | undefined {
    void this.revision;
    return this.widgetRows.find((row) => row.widgetId === this.selectedWidgetId);
  }

  /** @inheritdoc */
  get previewContext(): HudPreviewContext {
    return this._preview.context;
  }

  /** @inheritdoc */
  get previewContexts(): readonly HudPreviewContext[] {
    return this._preview.contexts;
  }

  /**
   * The draft resolved against the current fixture context.
   *
   * The fixture never applies the overlay-hidden policy: the editor is a paused
   * surface, so blanking the preview would make it useless.
   */
  get previewLayout(): HudResolvedLayout {
    void this.revision;
    return this._preview.layout;
  }

  toggleHudTemporarilyHidden(): void {
    this._visibility.toggleHudTemporarilyHidden();
  }

  /** @inheritdoc */
  get dropAnchors(): readonly HudEditorDropAnchor[] {
    void this.revision;
    return hudEditorDropAnchors({
      widgetId: this.selectedWidgetId,
      viewport: this._view.viewport,
    });
  }

  /** @inheritdoc */
  get boardRows(): readonly HudEditorBoardRow[] {
    return this._placementRows.board;
  }

  /** @inheritdoc */
  get shelfRows(): readonly HudEditorBoardRow[] {
    return this._placementRows.shelf;
  }

  /** @inheritdoc */
  get hiddenShelfLabel(): string {
    return hudEditorHiddenShelfLabel(this.shelfRows.length);
  }

  /** @inheritdoc */
  get canHideDraggedWidget(): boolean {
    const widgetId = this.selectedWidgetId;
    return widgetId !== undefined && canHideHudWidget(widgetId);
  }

  /**
   * The draft resolved into the editor's three lists: every row in registry
   * order, the board chips, and the shelf chips.
   *
   * Reads the draft rather than the committed snapshot, and never applies the
   * overlay-hidden policy: the editor is a paused surface, so blanking the
   * preview would make it useless.
   */
  private get _placementRows(): HudEditorPlacementRows {
    void this.revision;
    return hudEditorPlacementRows({
      preferences: this._hud.draft,
      layout: this.previewLayout,
      capabilities: this._capabilities,
    });
  }

  /** @inheritdoc */
  get isDirty(): boolean {
    void this.revision;
    return this._hud.isDirty;
  }

  /** @inheritdoc */
  get canUndo(): boolean {
    void this.revision;
    return this._hud.canUndo;
  }

  /** @inheritdoc */
  get canRedo(): boolean {
    void this.revision;
    return this._hud.canRedo;
  }

  /** @inheritdoc */
  get draggingLabel(): string | undefined {
    if (!this.isDragging) {
      return undefined;
    }
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return undefined;
    }
    return this.widgetRows.find((row) => row.widgetId === widgetId)?.label ?? widgetId;
  }

  // ── Actions ──

  /** @inheritdoc */
  selectWidget(widgetId: HudWidgetId): void {
    this.selectedWidgetId = widgetId;
    this.statusMessage = undefined;
  }

  /** @inheritdoc */
  selectAdjacentWidget(direction: 1 | -1): void {
    const rows = this.widgetRows;
    if (rows.length === 0) {
      return;
    }
    const index = rows.findIndex((row) => row.widgetId === this.selectedWidgetId);
    const nextIndex = (index + direction + rows.length) % rows.length;
    this.selectWidget(rows[nextIndex]?.widgetId ?? rows[0].widgetId);
  }

  /** @inheritdoc */
  setPreviewContext(context: HudPreviewContext): void {
    this._preview.setContext(context);
  }

  /** @inheritdoc */
  dispatch(command: HudEditorCommand): void {
    this._hud.dispatch(command);
    this.revision += 1;
    this.statusMessage = undefined;
  }

  /** Routes editor-level keys through the DOM focus policy. */
  handleEditorKeyDown(event: KeyboardEvent): void {
    this._interactionAdapter.handleEditorKeyDown({ event, target: this });
  }

  /** Selects a row from its keyboard activation event. */
  handleWidgetRowKeyDown(event: KeyboardEvent): void {
    this._interactionAdapter.handleWidgetRowKeyDown({ event, target: this });
  }

  /** Forwards a raw pointer event; the adapter owns the drag protocol. */
  handlePointerEvent(event: PointerEvent): void {
    this._interactionAdapter.handlePointerEvent({ event, target: this });
  }

  /**
   * Keyboard parity.
   *
   * The whole point of routing through commands: the keys below produce exactly
   * the commands the pointer produces for the same intent.
   */
  handleKeyDown(event: KeyboardEvent): void {
    const intent = hudEditorKeyIntent(event);
    if (intent === undefined) {
      return;
    }
    // 🔴 Escape is the drag's own undo before it is the modal's close. A drag
    // that closes the editor and discards the session on the same keypress is
    // the most expensive mis-fire this surface can have.
    if (intent === 'close') {
      if (this.isDragging) {
        event.preventDefault();
        this.endDrag();
        this.statusMessage = 'Drag cancelled. Nothing was moved.';
        return;
      }
      this.requestClose();
      return;
    }
    if (intent === 'next-widget' || intent === 'previous-widget') {
      event.preventDefault();
      this.selectAdjacentWidget(intent === 'next-widget' ? 1 : -1);
      return;
    }
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return;
    }
    const guarded = this._guardHiddenWidget(widgetId, HUD_EDITOR_GUARDED_ACTIONS[intent]);
    if (guarded) {
      event.preventDefault();
      this.statusMessage = guarded;
      return;
    }
    this._applyIntent({ intent, widgetId });
    event.preventDefault();
  }

  /**
   * Applies a placement/appearance intent to one widget.
   *
   * 🔴 The single crossing point for every device. A key, a controller button
   * and a row button all arrive here, so "each method can reach the same valid
   * configuration" is one `switch` rather than three that must agree.
   */
  private _applyIntent(options: {
    readonly intent: Exclude<HudEditorKeyIntent, 'next-widget' | 'previous-widget' | 'close'>;
    readonly widgetId: HudWidgetId;
  }): void {
    const { intent, widgetId } = options;
    switch (intent) {
      case 'move-left':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: -1 });
        return;
      case 'move-right':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: 1 });
        return;
      case 'reorder-up':
        this.dispatch({ kind: 'reorder', widgetId, direction: -1 });
        return;
      case 'reorder-down':
        this.dispatch({ kind: 'reorder', widgetId, direction: 1 });
        return;
      case 'scale-up':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: SCALE_STEP });
        return;
      case 'scale-down':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: -SCALE_STEP });
        return;
      case 'cycle-visibility':
        this.dispatch({ kind: 'cycle-visibility', widgetId, direction: 1 });
        return;
      case 'toggle-hidden':
        this.toggleWidgetHidden(widgetId);
        return;
      case 'hide-only':
        // Delete means REMOVE and never means restore. Hiding something already
        // off the HUD reports that and changes nothing, which is why this is
        // not simply `toggleWidgetHidden`.
        this._applyOutcome(this._dropOutcomeFor(widgetId, { kind: 'hidden' }));
    }
  }

  /** Controller parity — the same `_applyIntent`, edge-triggered by the view's poll. */
  handleGamepadAction(action: HudEditorGamepadAction): void {
    if (action === 'next-widget' || action === 'previous-widget') {
      this.selectAdjacentWidget(action === 'next-widget' ? 1 : -1);
      return;
    }
    if (action === 'undo') {
      this.dispatch({ kind: 'undo' });
      return;
    }
    if (action === 'redo') {
      this.dispatch({ kind: 'redo' });
      return;
    }
    if (action === 'confirm') {
      this.save();
      return;
    }
    if (action === 'cancel') {
      this.requestClose();
      return;
    }
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return;
    }
    const guarded = this._guardHiddenWidget(widgetId, HUD_EDITOR_GUARDED_ACTIONS[action]);
    if (guarded) {
      this.statusMessage = guarded;
      return;
    }
    this._applyIntent({ intent: action, widgetId });
  }

  /** Pointer drag start. */
  beginDrag(widgetId: HudWidgetId): void {
    this.selectedWidgetId = widgetId;
    this.isDragging = true;
    this.dragPosition = undefined;
  }

  /** @inheritdoc */
  updateDrag(position: HudEditorDragPosition): void {
    this.dragPosition = position;
  }

  /**
   * Pointer drag — a drag, a keyboard move and a controller move all reach the
   * same command through `hudEditorDropOutcome`.
   *
   * A drag onto the shelf REMOVES the widget; a drag onto a region either moves
   * it or, when it came from the shelf, puts it back in one undo step.
   */
  dropOn(target: HudEditorDropTarget | undefined): void {
    const widgetId = this.selectedWidgetId;
    this.isDragging = false;
    this.dragPosition = undefined;
    if (!widgetId) {
      return;
    }
    if (!target) {
      this.statusMessage = HUD_EDITOR_NOTHING_DROPPED_MESSAGE;
      return;
    }
    this._applyOutcome(this._dropOutcomeFor(widgetId, target));
  }
  /** Pointer drag cancelled. Idempotent: `lostpointercapture` also fires on a normal drop. */
  endDrag(): void {
    this.isDragging = false;
    this.dragPosition = undefined;
  }

  /** @inheritdoc */
  nudgeSelectedScale(delta: number): void {
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return;
    }
    this.dispatch({ kind: 'nudge-scale', widgetId, delta });
  }

  /** @inheritdoc */
  toggleWidgetHidden(widgetId: HudWidgetId): void {
    this.selectWidget(widgetId);
    if (this._isHidden(widgetId)) {
      this._restoreWidget(widgetId);
      return;
    }
    // 🔴 Removal from the keyboard and from the row's Hide button goes through
    // the SAME outcome function a drop onto the shelf does. That is what makes
    // the refusal for a required widget impossible to state one way here and
    // another way there — and it is why the refusal is raised before dispatch:
    // the machine strips a required widget's visibility patch, so dispatching
    // anyway would report success for a no-op.
    this._applyOutcome(this._dropOutcomeFor(widgetId, { kind: 'hidden' }));
  }

  /** @inheritdoc */
  toggleSelectedHidden(): void {
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return;
    }
    this.toggleWidgetHidden(widgetId);
  }

  /**
   * Puts a hidden widget back where it was, with the visibility it had.
   *
   * Deliberately NOT a drop: restoring to the widget's own region must not be
   * refused because that region does not exist at the current window size. The
   * widget is coming back either way, and the board shows it parked in a
   * dimmed region until the window is wide enough to use it.
   */
  private _restoreWidget(widgetId: HudWidgetId): void {
    const visibility = hudEditorRestoreVisibility({
      widgetId,
      preferences: this._hud.draft,
      remembered: this._rememberedVisibility.get(widgetId),
    });
    this.dispatch({ kind: 'show-widget', widgetId, visibility });
    this.statusMessage = `${labelFor(widgetId)} put back on the HUD, ${
      visibility === 'contextual' ? 'showing when relevant' : 'always on'
    }.`;
  }

  /**
   * The single consumer of a drop outcome: dispatch, remember, say.
   *
   * Every route into a placement decision — the shelf, a region, the `H` key,
   * Delete, the row's Hide button — ends here, so no path can dispatch without
   * also reporting what it did and remembering what it destroyed.
   *
   * 🔴 The message is set AFTER the dispatch, never before: `dispatch` clears
   * the status line so a stale sentence cannot survive a new edit, and writing
   * the message first means every committed drop reports nothing at all. A
   * refusal never dispatches, so it is unaffected — which is exactly why this
   * stayed invisible to a test that only asserted refusals.
   */
  private _applyOutcome(outcome: HudEditorDropOutcome): void {
    if (outcome.kind === 'command') {
      if (outcome.command.kind === 'hide-widget') {
        this._rememberVisibility(outcome.command.widgetId);
      }
      this.dispatch(outcome.command);
    }
    this.statusMessage = outcome.message;
  }

  /** What a drop of `widgetId` onto `target` means, against the current draft. */
  private _dropOutcomeFor(
    widgetId: HudWidgetId,
    target: HudEditorDropTarget,
  ): HudEditorDropOutcome {
    return hudEditorDropOutcome({
      widgetId,
      target,
      preferences: this._hud.draft,
      viewport: this._view.viewport,
      remembered: this._rememberedVisibility.get(widgetId),
    });
  }

  private _isHidden(widgetId: HudWidgetId): boolean {
    return effectiveHudWidgetPreference(this._hud.draft, widgetId)?.visibility === 'hidden';
  }

  private _rememberVisibility(widgetId: HudWidgetId): void {
    const visibility = effectiveHudWidgetPreference(this._hud.draft, widgetId)?.visibility;
    if (visibility === 'always' || visibility === 'contextual') {
      this._rememberedVisibility.set(widgetId, visibility);
    }
  }

  /**
   * Refuses placement edits aimed at a hidden widget.
   *
   * Silently accepting them would be the worst version of this bug: pressing
   * Right on a widget that is off the HUD would edit a preference the player
   * cannot see change, and the widget would stay invisible with no explanation.
   */
  private _guardHiddenWidget(
    widgetId: HudWidgetId,
    action: string | undefined,
  ): string | undefined {
    if (action === undefined || !this._isHidden(widgetId)) {
      return undefined;
    }
    return hudEditorHiddenEditSentence(labelFor(widgetId), action);
  }

  /** @inheritdoc */
  save(): void {
    this._hud.save();
    this.revision += 1;
    this._onClose();
  }

  /** @inheritdoc */
  cancel(): void {
    this._hud.cancel();
    this.revision += 1;
    this.statusMessage = undefined;
    this._onClose();
  }

  /**
   * Closing with unsaved changes asks first — the existing unsaved-change
   * convention, instead of a confirmation on every preset apply.
   */
  requestClose(): void {
    if (this.isDirty) {
      this.confirmingDiscard = true;
      return;
    }
    this.cancel();
  }

  /** @inheritdoc */
  confirmDiscard(): void {
    this.confirmingDiscard = false;
    this.cancel();
  }

  /** @inheritdoc */
  cancelDiscard(): void {
    this.confirmingDiscard = false;
  }

  /** @inheritdoc */
  importPresetJson(raw: string): void {
    const read = readHudEditorPresetJson(raw);
    if (!read.ok) {
      this.statusMessage = read.message;
      return;
    }
    const failure = this._hud.importPreset(read.preset);
    if (failure) {
      this.statusMessage = hudEditorImportFailureMessage(failure.reason);
      return;
    }
    this.statusMessage = 'Preset imported';
  }

  /** @inheritdoc */
  exportPresetJson(): string {
    return hudEditorExportPresetJson(this._hud.exportPreset(HUD_EDITOR_EXPORT_NAME));
  }
}

// ── Module helpers ──

/**
 * Builds an editor ViewModel from explicit capabilities.
 *
 * Production wiring lives in `./hud_layout_editor_composition.ts`.
 */
export const createHudLayoutEditorViewModel = (
  options: HudLayoutEditorViewModelOptions,
): HudLayoutEditorViewModelInterface => HudLayoutEditorViewModel.create(options);
