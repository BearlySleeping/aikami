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
import type { HudDensity, HudSlot, HudVisibility, HudWidgetId } from '@aikami/types';
import {
  type HudResolvedLayout,
  type HudViewport,
  mergeHudPreferences,
} from '$lib/utils/hud/hud_layout_policy.ts';
import { allowedHudAnchors, type HudEditorCommand } from '$lib/utils/hud/hud_layout_state.ts';
import { resolveGameHudLayout } from '../hud_layout_bridge.ts';

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

export type HudLayoutEditorViewModelOptions = BaseViewModelOptions & {
  readonly hud: HudEditorPreferenceCapabilities;
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

  selectWidget(widgetId: HudWidgetId): void;
  selectAdjacentWidget(direction: 1 | -1): void;
  setPreviewContext(context: HudPreviewContext): void;
  dispatch(command: HudEditorCommand): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleGamepadAction(action: HudEditorGamepadAction): void;
  beginDrag(widgetId: HudWidgetId): void;
  dropOnAnchor(anchor: HudSlot): void;
  endDrag(): void;
  cycleSelectedVisibility(): void;
  nudgeSelectedScale(delta: number): void;
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
  private readonly _onClose: () => void;
  private readonly _view: HudEditorViewportCapabilities;
  private readonly _capabilities: readonly string[];

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
  dormantWidgetIds = $state<readonly string[]>([]);

  constructor(options: HudLayoutEditorViewModelOptions) {
    super(options);
    this._hud = options.hud;
    this._onClose = options.onClose;
    this._view = options.view;
    this._capabilities = options.capabilities;
    this.dormantWidgetIds = options.dormantWidgetIds;
    // Opening the editor starts an edit session, so the draft always equals the
    // committed snapshot when the surface appears.
    this._hud.beginEdit();
    this.revision += 1;
    this.selectedWidgetId = this.widgetRows[0]?.widgetId;
  }

  // ── Reads ──

  /** @inheritdoc */
  get isEditorEnabled(): boolean {
    return this._hud.isEditorEnabled;
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
  }

  /** Pointer drop — a drag and a keyboard anchor move reach the same command. */
  dropOnAnchor(anchor: HudSlot): void {
    const widgetId = this.selectedWidgetId;
    this.isDragging = false;
    if (!widgetId) {
      return;
    }
    this.dispatch({ kind: 'set-anchor', widgetId, anchor });
  }

  /** Pointer drag cancelled. */
  endDrag(): void {
    this.isDragging = false;
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
