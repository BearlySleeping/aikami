// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_view_model.svelte.ts
//
// C-528 AC-2/AC-3 — the HUD layout editor ViewModel.
//
// 🔴 The editor has ONE edit path. Pointer drag, keyboard and gamepad all
// produce a `HudEditorCommand` and hand it to the same `dispatch()`; the
// contract's "each method can reach the same valid configuration" is therefore a
// property of the design, not three implementations kept in sync by hand.
//
// The preview is a read-only fixture presentation over a paused session: it
// resolves the DRAFT against a fixture context and renders the real widgets. It
// is not a second engine and not a combat simulator.

import { HUD_WIDGET_REGISTRY } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { HudUserPreferences } from '@aikami/schemas';
import { isHudLayoutJsonWithinSizeLimit } from '@aikami/schemas';
import type { HudDensity, HudSlot, HudVisibility, HudWidgetId } from '@aikami/types';
import {
  type HudResolvedLayout,
  type HudViewport,
  mergeHudPreferences,
} from '$lib/utils/hud/hud_layout_policy.ts';
import {
  allowedHudAnchors,
  effectiveHudWidgetPreference,
  type HudEditorCommand,
} from '$lib/utils/hud/hud_layout_state.ts';
import { resolveGameHudLayout } from '../hud_layout_bridge.ts';
import {
  createHudLayoutEditorInteractionAdapter,
  type HudLayoutEditorInteractionAdapter,
} from './hud_layout_editor_interaction.ts';

/** The fixture contexts the editor can preview. Presentation only. */
export const HUD_PREVIEW_CONTEXTS = ['explore', 'dialogue', 'combat'] as const;

export type HudPreviewContext = (typeof HUD_PREVIEW_CONTEXTS)[number];

/** What a gamepad button press means to the editor. */
export type HudEditorGamepadAction =
  | 'next-widget'
  | 'previous-widget'
  | 'move-left'
  | 'move-right'
  | 'reorder-up'
  | 'reorder-down'
  | 'scale-up'
  | 'scale-down'
  | 'cycle-visibility'
  | 'undo'
  | 'redo'
  | 'confirm'
  | 'cancel';

/** The HUD authority the editor writes drafts through. */
export type HudEditorPreferenceCapabilities = {
  readonly preferences: HudUserPreferences;
  readonly draft: HudUserPreferences;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isEditorEnabled: boolean;
  readonly recoveryNotice: string | undefined;
  beginEdit(): void;
  dispatch(command: HudEditorCommand): void;
  save(): void;
  cancel(): void;
  exportPreset(name: string): unknown;
  importPreset(preset: unknown): { reason: string } | undefined;
};

/** Session-scoped HUD visibility controlled from the editor header. */
export type HudEditorVisibilityCapabilities = {
  readonly isHudTemporarilyHidden: boolean;
  toggleHudTemporarilyHidden(): void;
};

/** Measurement the preview reflows against. */
export type HudEditorViewportCapabilities = {
  readonly viewport: HudViewport;
  readonly textScale: number;
};

/** One editable widget row. */
export type HudEditorWidgetRow = {
  readonly widgetId: HudWidgetId;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly dormant: boolean;
  readonly visibility: HudVisibility;
  readonly anchor: HudSlot;
  readonly density: HudDensity;
  readonly scale: number;
  readonly allowedAnchors: readonly HudSlot[];
};

/**
 * Live pointer state for the drag ghost.
 *
 * `anchor` is the region under the pointer right now (resolved by the DOM
 * interaction adapter); the ViewModel only holds the value so the ghost and
 * the highlighted region can be rendered without view-local state.
 */
export type HudEditorDragPosition = {
  readonly x: number;
  readonly y: number;
  readonly anchor: HudSlot | undefined;
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
  readonly isOpen: boolean;
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
  /** Label of the widget being dragged, for the floating drag ghost. */
  readonly draggingLabel: string | undefined;
  /** Live pointer position + region under the pointer while dragging. */
  readonly dragPosition: HudEditorDragPosition | undefined;

  selectWidget(widgetId: HudWidgetId): void;
  selectAdjacentWidget(direction: 1 | -1): void;
  setPreviewContext(context: HudPreviewContext): void;
  dispatch(command: HudEditorCommand): void;
  handleEditorKeyDown(event: KeyboardEvent): void;
  handleWidgetRowKeyDown(event: KeyboardEvent): void;
  handlePointerDown(event: PointerEvent): void;
  handleDragPointerUp(event: PointerEvent): void;
  handleDragPointerMove(event: PointerEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleGamepadAction(action: HudEditorGamepadAction): void;
  toggleHudTemporarilyHidden(): void;
  beginDrag(widgetId: HudWidgetId): void;
  /** Records the pointer position (and region) for the drag ghost. */
  updateDrag(position: HudEditorDragPosition): void;
  dropOnAnchor(anchor: HudSlot): void;
  endDrag(): void;
  cycleSelectedVisibility(): void;
  nudgeSelectedScale(delta: number): void;
  /** Pointer parity: cycles one widget's visibility through the shared command. */
  cycleWidgetVisibility(widgetId: HudWidgetId): void;
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

/** Gamepad button indices used by the editor's controller mapping. */
const GAMEPAD_BUTTON = {
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  a: 0,
  b: 1,
  lb: 4,
  rb: 5,
  back: 8,
  start: 9,
} as const;

const GAMEPAD_POLL_MS = 100;

/** Which widgets a fixture context makes relevant. Presentation fixtures only. */
const PREVIEW_RELEVANCE: Readonly<Record<HudPreviewContext, readonly HudWidgetId[]>> = {
  explore: ['objective', 'interaction', 'party-status', 'clock', 'onboarding-hint'],
  dialogue: ['objective', 'interaction'],
  combat: ['interaction', 'hotbar', 'party-status'],
};

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
  private readonly _pressedGamepadButtons = new Set<number>();
  private _gamepadPollTimer: number | undefined;

  isOpen = $state(true);
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
  previewContext = $state<HudPreviewContext>('explore');
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
    this._startGamepadPolling();
    await super.initialize();
  }

  /** Stops controller polling with the editor lifecycle. */
  override async dispose(): Promise<void> {
    this._stopGamepadPolling();
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
    const { merged } = mergeHudPreferences(this._hud.draft);
    const capabilitySet = new Set(this._capabilities);
    return merged.map((widget) => {
      const definition = rowDefinition(widget.widgetId);
      const dormant =
        definition === undefined ||
        (definition.capability !== undefined && !capabilitySet.has(definition.capability));
      return {
        widgetId: widget.widgetId as HudWidgetId,
        label: definition?.label ?? widget.widgetId,
        description: definition?.description ?? '',
        required: definition?.required ?? false,
        dormant,
        visibility: widget.visibility,
        anchor: widget.anchor,
        density: widget.density,
        scale: widget.scale,
        allowedAnchors: allowedAnchorsFor(widget.widgetId as HudWidgetId),
      };
    });
  }

  /** @inheritdoc */
  get selectedRow(): HudEditorWidgetRow | undefined {
    void this.revision;
    return this.widgetRows.find((row) => row.widgetId === this.selectedWidgetId);
  }

  /** @inheritdoc */
  get previewContexts(): readonly HudPreviewContext[] {
    return HUD_PREVIEW_CONTEXTS;
  }

  /**
   * The draft resolved against the current fixture context.
   *
   * The fixture never applies the overlay-hidden policy: the editor is a paused
   * surface, so blanking the preview would make it useless.
   */
  get previewLayout(): HudResolvedLayout {
    void this.revision;
    return resolveGameHudLayout({
      preferences: this._hud.draft,
      capabilities: this._capabilities,
      overlay: 'NONE',
      isTransitioning: false,
      isTemporarilyHidden: false,
      focusedWidgetIds: [],
      relevantWidgetIds: PREVIEW_RELEVANCE[this.previewContext],
      pendingWidgetIds: [],
      viewport: this._view.viewport,
      textScale: this._view.textScale,
    });
  }

  toggleHudTemporarilyHidden(): void {
    this._visibility.toggleHudTemporarilyHidden();
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
    this.previewContext = context;
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

  /** Begins a pointer drag through the DOM interaction adapter. */
  handlePointerDown(event: PointerEvent): void {
    this._interactionAdapter.handlePointerDown({ event, target: this });
  }

  /** Resolves and applies the pointer's current drop target. */
  handleDragPointerUp(event: PointerEvent): void {
    this._interactionAdapter.handleDragPointerUp({ event, target: this });
  }

  /** Updates the drag ghost and hover target from pointer coordinates. */
  handleDragPointerMove(event: PointerEvent): void {
    this._interactionAdapter.handleDragPointerMove({ event, target: this });
  }

  /**
   * Keyboard parity.
   *
   * The whole point of routing through commands: the keys below produce exactly
   * the commands the pointer produces for the same intent.
   */
  handleKeyDown(event: KeyboardEvent): void {
    const widgetId = this.selectedWidgetId;
    if (event.key === 'Escape') {
      this.requestClose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this.selectAdjacentWidget(event.shiftKey ? -1 : 1);
      return;
    }
    if (!widgetId) {
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: -1 });
        break;
      case 'ArrowRight':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: 1 });
        break;
      case 'ArrowUp':
        this.dispatch({ kind: 'reorder', widgetId, direction: -1 });
        break;
      case 'ArrowDown':
        this.dispatch({ kind: 'reorder', widgetId, direction: 1 });
        break;
      case '+':
      case '=':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: SCALE_STEP });
        break;
      case '-':
      case '_':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: -SCALE_STEP });
        break;
      case 'v':
      case 'V':
        this.dispatch({ kind: 'cycle-visibility', widgetId, direction: 1 });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Controller parity — the same commands, edge-triggered by the view's poll. */
  handleGamepadAction(action: HudEditorGamepadAction): void {
    const widgetId = this.selectedWidgetId;
    switch (action) {
      case 'next-widget':
        this.selectAdjacentWidget(1);
        return;
      case 'previous-widget':
        this.selectAdjacentWidget(-1);
        return;
      case 'undo':
        this.dispatch({ kind: 'undo' });
        return;
      case 'redo':
        this.dispatch({ kind: 'redo' });
        return;
      case 'confirm':
        this.save();
        return;
      case 'cancel':
        this.requestClose();
        return;
      default:
        break;
    }
    if (!widgetId) {
      return;
    }
    switch (action) {
      case 'move-left':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: -1 });
        break;
      case 'move-right':
        this.dispatch({ kind: 'move-anchor', widgetId, direction: 1 });
        break;
      case 'reorder-up':
        this.dispatch({ kind: 'reorder', widgetId, direction: -1 });
        break;
      case 'reorder-down':
        this.dispatch({ kind: 'reorder', widgetId, direction: 1 });
        break;
      case 'scale-up':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: SCALE_STEP });
        break;
      case 'scale-down':
        this.dispatch({ kind: 'nudge-scale', widgetId, delta: -SCALE_STEP });
        break;
      case 'cycle-visibility':
        this.dispatch({ kind: 'cycle-visibility', widgetId, direction: 1 });
        break;
      default:
        break;
    }
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

  /** Pointer drag — a drag and a keyboard anchor move reach the same command. */
  dropOnAnchor(anchor: HudSlot): void {
    const widgetId = this.selectedWidgetId;
    this.isDragging = false;
    this.dragPosition = undefined;
    if (!widgetId) {
      return;
    }
    if (!allowedHudAnchors(widgetId).includes(anchor)) {
      this.statusMessage = 'That region is reserved for other HUD surfaces.';
      return;
    }
    const current = effectiveHudWidgetPreference(this._hud.draft, widgetId)?.anchor;
    if (current === anchor) {
      // Dropping a widget back onto its own region is not an edit. Returning
      // early keeps a stray drop from recording a redundant override.
      return;
    }
    this.dispatch({ kind: 'set-anchor', widgetId, anchor });
  }

  /** Pointer drag cancelled. */
  endDrag(): void {
    this.isDragging = false;
    this.dragPosition = undefined;
  }

  /** @inheritdoc */
  cycleSelectedVisibility(): void {
    const widgetId = this.selectedWidgetId;
    if (!widgetId) {
      return;
    }
    this.dispatch({ kind: 'cycle-visibility', widgetId, direction: 1 });
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
  cycleWidgetVisibility(widgetId: HudWidgetId): void {
    this.selectWidget(widgetId);
    this.dispatch({ kind: 'cycle-visibility', widgetId, direction: 1 });
  }

  /** @inheritdoc */
  save(): void {
    this._hud.save();
    this.revision += 1;
    this.isOpen = false;
    this._onClose();
  }

  /** @inheritdoc */
  cancel(): void {
    this._hud.cancel();
    this.revision += 1;
    this.statusMessage = undefined;
    this.isOpen = false;
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
    if (!isHudLayoutJsonWithinSizeLimit(raw)) {
      this.statusMessage = 'That preset file is too large.';
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.statusMessage = 'That preset file is not valid JSON.';
      return;
    }
    const failure = this._hud.importPreset(parsed);
    if (failure) {
      this.statusMessage =
        failure.reason === 'missing-required-widget'
          ? 'That preset is missing a required HUD surface and cannot be used.'
          : 'That preset could not be read.';
      return;
    }
    this.statusMessage = 'Preset imported';
  }

  /** @inheritdoc */
  exportPresetJson(): string {
    return JSON.stringify(this._hud.exportPreset('Shared layout'), undefined, 2);
  }

  private _startGamepadPolling(): void {
    if (typeof window === 'undefined' || this._gamepadPollTimer !== undefined) {
      return;
    }
    this._gamepadPollTimer = window.setInterval(() => this._pollGamepad(), GAMEPAD_POLL_MS);
  }

  private _stopGamepadPolling(): void {
    if (this._gamepadPollTimer === undefined) {
      return;
    }
    window.clearInterval(this._gamepadPollTimer);
    this._gamepadPollTimer = undefined;
    this._pressedGamepadButtons.clear();
  }

  private _pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((candidate) => candidate !== null);
    if (!pad) {
      this._pressedGamepadButtons.clear();
      return;
    }
    for (const [index, button] of pad.buttons.entries()) {
      const wasDown = this._pressedGamepadButtons.has(index);
      if (button.pressed && !wasDown) {
        this._pressedGamepadButtons.add(index);
        const action = this._gamepadActionFor(index);
        if (action) {
          this.handleGamepadAction(action);
        }
      } else if (!button.pressed && wasDown) {
        this._pressedGamepadButtons.delete(index);
      }
    }
  }

  private _gamepadActionFor(index: number): HudEditorGamepadAction | undefined {
    switch (index) {
      case GAMEPAD_BUTTON.dpadLeft:
        return 'move-left';
      case GAMEPAD_BUTTON.dpadRight:
        return 'move-right';
      case GAMEPAD_BUTTON.dpadUp:
        return 'reorder-up';
      case GAMEPAD_BUTTON.dpadDown:
        return 'reorder-down';
      case GAMEPAD_BUTTON.rb:
        return 'next-widget';
      case GAMEPAD_BUTTON.lb:
        return 'previous-widget';
      case GAMEPAD_BUTTON.a:
        return 'cycle-visibility';
      case GAMEPAD_BUTTON.b:
        return 'cancel';
      case GAMEPAD_BUTTON.start:
        return 'confirm';
      case GAMEPAD_BUTTON.back:
        return 'undo';
      default:
        return undefined;
    }
  }
}

// ── Module helpers ──

const rowDefinition = (widgetId: string) =>
  HUD_WIDGET_REGISTRY.find((widget) => widget.id === widgetId);

const allowedAnchorsFor = (widgetId: HudWidgetId): readonly HudSlot[] =>
  allowedHudAnchors(widgetId);

/**
 * Builds an editor ViewModel from explicit capabilities.
 *
 * Production wiring lives in `./hud_layout_editor_composition.ts`.
 */
export const createHudLayoutEditorViewModel = (
  options: HudLayoutEditorViewModelOptions,
): HudLayoutEditorViewModelInterface => HudLayoutEditorViewModel.create(options);
