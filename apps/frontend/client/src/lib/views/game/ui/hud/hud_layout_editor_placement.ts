// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_placement.ts
//
// C-528 AC-2/AC-3 — WHERE a HUD widget lives, as one model.
//
// 🔴 The editor's mental model is a single question: *which of the six places
// is this widget in?* Five are board regions and the sixth is the Hidden shelf.
// "Drag it to the shelf to remove it" is only honest if removal is a placement
// and not a side effect of a visibility toggle that also cycles a third
// unrelated value — so `hidden` stopped being a step in a visibility cycle and
// became a destination like any other.
//
// This module is the pure half of that decision. The DOM adapter answers "what
// is under the pointer"; this file answers "given a target, what command does
// that produce, or why is it refused". Splitting it here is what keeps refusal
// from being re-derived in the view model — a rule with two owners drifts, and
// a refusal that drifts from the machine turns into a silent no-op.

import { HUD_WIDGET_REGISTRY } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import type { HudDensityValue, HudSlot, HudVisibility, HudWidgetId } from '@aikami/types';
import {
  type HudResolvedLayout,
  type HudViewport,
  mergeHudPreferences,
} from '$lib/utils/hud/hud_layout_policy.ts';
import {
  baselineHudWidgetPreference,
  effectiveHudWidgetPreference,
  type HudEditorCommand,
  isRequiredHudWidget,
} from '$lib/utils/hud/hud_layout_state.ts';
import {
  HUD_EDITOR_DROP_ANCHOR_LABELS,
  hudEditorDropRefusal,
} from './hud_layout_editor_drop_anchors.ts';

// ---------------------------------------------------------------------------
// The six places
// ---------------------------------------------------------------------------

/**
 * A drop destination.
 *
 * 🔴 `hidden` is a VIEW-ONLY variant, deliberately not a `HudAnchor`. Widening
 * the persisted anchor enum would leak a display state into saves, into
 * imported presets and into the resolver, none of which know what a shelf is.
 */
export type HudEditorDropTarget =
  | { readonly kind: 'region'; readonly anchor: HudSlot }
  | { readonly kind: 'hidden' };

/** DOM attribute marking the Hidden shelf. Distinct from the region attribute. */
export const HUD_EDITOR_HIDDEN_ATTRIBUTE = 'data-hud-drop-hidden';

/**
 * The SELECTOR form of {@link HUD_EDITOR_HIDDEN_ATTRIBUTE}.
 *
 * 🔴 These are two different strings, and conflating them fails with NO signal
 * at all. `data-hud-drop-hidden` is a perfectly VALID CSS selector — a *type*
 * selector for a custom element named `<data-hud-drop-hidden>`. It does not
 * throw; it matches nothing and returns `null`. So `closest()` silently reports
 * "not the shelf", the drop never resolves, and "drag a widget onto the Hidden
 * shelf to remove it" does nothing: no move, no refusal, no console error.
 * Invisible to unit tests (no DOM), to typecheck, and to lint, because a
 * well-formed string is exactly what all three check.
 */
export const HUD_EDITOR_HIDDEN_SELECTOR = `[${HUD_EDITOR_HIDDEN_ATTRIBUTE}]`;

/** Test id for the shelf itself. */
export const HUD_EDITOR_HIDDEN_SHELF_TESTID = 'hud-editor-hidden-shelf';

/** The shelf's own name, so it reads as a peer of the five regions. */
export const HUD_EDITOR_HIDDEN_LABEL = 'Hidden';

/** The shelf caption, counting what is on it. */
export const hudEditorHiddenShelfLabel = (count: number): string =>
  count === 0 ? HUD_EDITOR_HIDDEN_LABEL : `${HUD_EDITOR_HIDDEN_LABEL} (${count})`;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Whether a widget may be removed from the layout at all.
 *
 * A read-only pre-check the view uses for hover styling. It calls the SAME
 * predicate the machine's refusal relies on, so the board can grey out the
 * shelf for a required widget without becoming a second source of truth.
 */
export const canHideHudWidget = (widgetId: HudWidgetId): boolean => !isRequiredHudWidget(widgetId);

/** Why a widget cannot be hidden, as a sentence, or `undefined` when it can. */
export const hudEditorHideRefusal = (widgetId: HudWidgetId, label: string): string | undefined =>
  canHideHudWidget(widgetId)
    ? undefined
    : `${label} is required — it carries save warnings and the way back to settings, so it always stays on the HUD.`;

/**
 * Why an edit aimed at a hidden widget would silently do nothing, or
 * `undefined` when the widget is on the board.
 *
 * Arrows and scale stay inert while a widget is off the HUD. Re-hiding as a
 * side effect of an arrow press would be the worst version of this bug: the
 * player presses Right, the widget vanishes from the board, and the only clue
 * is a status line they were not looking at.
 */
export const hudEditorHiddenEditSentence = (label: string, action: string): string =>
  `${label} is hidden — ${action} it back onto a region first.`;

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

/**
 * The visibility a widget returns with.
 *
 * The machine stays pure by being TOLD the value rather than inferring it, so
 * this ladder lives in the editor. `remembered` is session memory written when
 * the widget was hidden, which makes hide-then-show an exact round trip; past
 * that the shipped preset's own choice is the most honest answer, and failing
 * that the widget simply comes back.
 */
export const hudEditorRestoreVisibility = (options: {
  readonly widgetId: HudWidgetId;
  readonly preferences: HudUserPreferences;
  readonly remembered: HudVisibility | undefined;
}): HudVisibility => {
  const { remembered } = options;
  if (remembered === 'always' || remembered === 'contextual') {
    return remembered;
  }
  const baseline = baselineHudWidgetPreference(
    options.preferences.selectedPresetId,
    options.widgetId,
  );
  return baseline?.visibility === 'contextual' ? 'contextual' : 'always';
};

// ---------------------------------------------------------------------------
// The board model
// ---------------------------------------------------------------------------

/** One chip on the preview board. */
export type HudEditorBoardRow = {
  readonly widgetId: HudWidgetId;
  readonly label: string;
  readonly required: boolean;
  /** The build does not register this widget, or lacks its capability. */
  readonly dormant: boolean;
  readonly anchor: HudSlot;
  readonly visibility: HudVisibility;
  readonly density: HudDensityValue;
  /** Requested scale, as persisted. The resolver derives the effective one. */
  readonly scale: number;
  /** Painted in the selected fixture context, at this viewport, right now. */
  readonly painted: boolean;
  /**
   * `contextual`, and nothing in the selected fixture makes it relevant.
   *
   * 🔴 This is not the same as hidden, and conflating them is what made the
   * board lie: switching the preview tab to `dialogue` used to make
   * `autosave` and `clock` disappear with no explanation, because the resolver
   * files an idle contextual widget alongside a hidden one. They are drawn, on
   * the board, marked as inactive for this context.
   */
  readonly idleInContext: boolean;
  /** Reflow moved it behind the labelled overflow entry at this viewport. */
  readonly collapsed: boolean;
};

/** The board and the shelf, split from one pass over the draft. */
export type HudEditorPlacementRows = {
  /** Every widget, in registry order. The list panel, hidden ones included. */
  readonly rows: readonly HudEditorBoardRow[];
  /** Chips drawn in a region. Empty for a widget on the shelf. */
  readonly board: readonly HudEditorBoardRow[];
  /** Chips drawn on the Hidden shelf. */
  readonly shelf: readonly HudEditorBoardRow[];
};

/**
 * Splits the draft into "on the board" and "on the shelf".
 *
 * Built from the DRAFT (the layout intent) rather than from the resolver's
 * placed list, because a board that only shows what the resolver happened to
 * place cannot answer "where did I put this?" — and cannot show a widget
 * parked in a region that does not exist at the current window size, which is
 * exactly when the player needs to be told.
 *
 * Both halves come from the draft rather than from the resolver, and the split
 * is by `visibility === 'hidden'` alone. Deriving the shelf from the resolver's
 * inactive bucket instead would sweep in idle-contextual and capability-dormant
 * widgets, so the shelf would fill with things the player never removed.
 */
export const hudEditorPlacementRows = (options: {
  readonly preferences: HudUserPreferences;
  readonly layout: HudResolvedLayout;
  readonly capabilities: readonly string[];
}): HudEditorPlacementRows => {
  const { merged } = mergeHudPreferences(options.preferences);
  const capabilities = new Set(options.capabilities);
  const placed = new Map(options.layout.widgets.map((widget) => [widget.widgetId, widget]));
  const rows: HudEditorBoardRow[] = [];
  const board: HudEditorBoardRow[] = [];
  const shelf: HudEditorBoardRow[] = [];
  for (const preference of merged) {
    const widgetId = preference.widgetId as HudWidgetId;
    const definition = HUD_WIDGET_REGISTRY.find((widget) => widget.id === widgetId);
    const dormant =
      definition === undefined ||
      (definition.capability !== undefined && !capabilities.has(definition.capability));
    const resolved = placed.get(widgetId);
    const painted = resolved?.visible ?? false;
    // A hidden widget keeps its anchor, so dropping it back on its own region
    // restores it exactly where the player last had it.
    const row: HudEditorBoardRow = {
      widgetId,
      label: definition?.label ?? widgetId,
      required: definition?.required ?? false,
      dormant,
      anchor: preference.anchor,
      visibility: preference.visibility,
      density: preference.density,
      scale: preference.scale,
      painted: preference.visibility !== 'hidden' && painted,
      idleInContext: preference.visibility === 'contextual' && !dormant && !painted,
      collapsed: resolved?.collapsed ?? false,
    };
    rows.push(row);
    (preference.visibility === 'hidden' ? shelf : board).push(row);
  }
  return { rows, board, shelf };
};

// ---------------------------------------------------------------------------
// The one place a target becomes a command
// ---------------------------------------------------------------------------

/** What a drop resolved to. */
export type HudEditorDropOutcome =
  | { readonly kind: 'command'; readonly command: HudEditorCommand; readonly message: string }
  | { readonly kind: 'no-change'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Turns a drop target into the command it means, or the sentence explaining why
 * it cannot.
 *
 * 🔴 Pointer, keyboard and gamepad all land here, so a drag onto the shelf, the
 * `H` key and the controller button cannot disagree about what hiding a widget
 * does. The one behaviour worth spelling out: dragging a HIDDEN widget onto a
 * region emits a SINGLE `show-widget` carrying the destination anchor, because
 * two commands would make one gesture cost two undos.
 */
export const hudEditorDropOutcome = (options: {
  readonly widgetId: HudWidgetId;
  readonly target: HudEditorDropTarget;
  readonly preferences: HudUserPreferences;
  readonly viewport: HudViewport;
  readonly remembered: HudVisibility | undefined;
}): HudEditorDropOutcome => {
  const { widgetId, target } = options;
  const current = effectiveHudWidgetPreference(options.preferences, widgetId);
  const label = labelFor(widgetId);
  const isHidden = current?.visibility === 'hidden';

  if (target.kind === 'hidden') {
    const refusal = hudEditorHideRefusal(widgetId, label);
    if (refusal) {
      return { kind: 'refused', message: refusal };
    }
    if (isHidden) {
      return {
        kind: 'no-change',
        message: `${label} is already on the ${HUD_EDITOR_HIDDEN_LABEL.toLowerCase()} shelf.`,
      };
    }
    return {
      kind: 'command',
      command: { kind: 'hide-widget', widgetId },
      message: `${label} removed from the HUD. Put it back any time, or undo.`,
    };
  }

  const refusal = hudEditorDropRefusal({
    widgetId,
    viewport: options.viewport,
    anchor: target.anchor,
  });
  if (refusal) {
    return { kind: 'refused', message: refusal };
  }
  const region = HUD_EDITOR_DROP_ANCHOR_LABELS[target.anchor];
  if (isHidden) {
    return {
      kind: 'command',
      command: {
        kind: 'show-widget',
        widgetId,
        visibility: hudEditorRestoreVisibility({
          widgetId,
          preferences: options.preferences,
          remembered: options.remembered,
        }),
        anchor: target.anchor,
      },
      message: `${label} put back on the HUD in ${region}.`,
    };
  }
  if (current?.anchor === target.anchor) {
    return { kind: 'no-change', message: `${label} is already in ${region}.` };
  }
  return {
    kind: 'command',
    command: { kind: 'set-anchor', widgetId, anchor: target.anchor },
    message: `${label} moved to ${region}.`,
  };
};

/** What a drop that resolved to no target at all did. Said, not swallowed. */
export const HUD_EDITOR_NOTHING_DROPPED_MESSAGE =
  'Nothing changed. Drop a widget on a region to move it, or on the Hidden shelf to remove it.';

/** Registry label for a widget, falling back to its id. */
export const labelFor = (widgetId: HudWidgetId): string =>
  HUD_WIDGET_REGISTRY.find((widget) => widget.id === widgetId)?.label ?? widgetId;

/** Whether a region name should read as a location rather than a place. */
export const hudEditorLocationLabel = (options: {
  readonly visibility: HudVisibility;
  readonly anchor: HudSlot;
}): string =>
  options.visibility === 'hidden'
    ? HUD_EDITOR_HIDDEN_LABEL
    : HUD_EDITOR_DROP_ANCHOR_LABELS[options.anchor];
