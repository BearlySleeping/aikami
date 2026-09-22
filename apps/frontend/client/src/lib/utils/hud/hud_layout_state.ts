// apps/frontend/client/src/lib/utils/hud/hud_layout_state.ts
//
// C-528 — the pure edit model behind the HUD editor and the settings controls.
//
// The editor must be transactional: Undo/Redo, per-widget reset, layout reset,
// Cancel and Save all have to be deterministic and must not touch committed
// state until Save. That is a pure state machine over the persisted snapshot,
// so it lives here rather than inside a ViewModel or a service method.
//
// 🔴 Pointer, keyboard and gamepad do NOT get three code paths. They all
// produce the same `HudEditorCommand` and are applied here, which is what makes
// "each method can reach the same valid configuration" (AC-2) a unit-testable
// invariant instead of a claim.
//
// Contract: C-528 AC-2, AC-3, AC-8.

import {
  HUD_ANCHORS,
  HUD_LAYOUT_PRESETS,
  HUD_PRESET_IDS,
  HUD_REQUIRED_WIDGET_IDS,
  HUD_SAFE_PRESET_ID,
  HUD_SCALE_MAX,
  HUD_SCALE_MIN,
} from '@aikami/constants';
import {
  type HudLayoutPreset,
  type HudUserPreferences,
  type HudVisibility,
  type HudWidgetPreference,
  parseHudLayoutPreset,
  parseHudUserPreferences,
} from '@aikami/schemas';
import type { HudAnchor, HudDensity, HudSlot, HudWidgetId } from '@aikami/types';
import {
  HUD_ANCHOR_ORDER,
  hudWidgetDefinition,
  isHudWidgetId,
  mergeHudPreferences,
} from './hud_layout_policy.ts';

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/**
 * The bottom-centre region is reserved for required action surfaces.
 *
 * It is where the contextual interaction prompt lives; anchoring an unrelated
 * widget there would let decoration cover a required action, so the editor
 * refuses the move rather than letting reflow sort it out later.
 */
const RESERVED_ANCHOR_WIDGETS: Readonly<Partial<Record<HudSlot, readonly HudWidgetId[]>>> = {
  'bottom-center': ['interaction', 'hotbar'],
};

/** Whether a widget may be anchored to a region, per the registry and reserved regions. */
export const isHudAnchorAllowed = (widgetId: HudWidgetId, anchor: HudSlot): boolean => {
  const definition = hudWidgetDefinition(widgetId);
  if (!definition) {
    return false;
  }
  // `supportedAnchors` is a literal tuple per registry entry, so the union of
  // all entries has no common `includes` signature — view it as strings.
  const supported: readonly string[] = definition.supportedAnchors;
  if (!supported.includes(anchor)) {
    return false;
  }
  const reservedFor = RESERVED_ANCHOR_WIDGETS[anchor];
  if (reservedFor && !reservedFor.includes(widgetId)) {
    return false;
  }
  return true;
};

/** The anchors a widget may be moved to, in layout order. */
export const allowedHudAnchors = (widgetId: HudWidgetId): readonly HudSlot[] =>
  HUD_ANCHOR_ORDER.filter((anchor) => isHudAnchorAllowed(widgetId, anchor));

/** Clamps a requested scale into the registry bounds. */
export const clampHudScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, Math.round(scale * 100) / 100));
};

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/** The shipped preset for an id, falling back to the safe preset. */
const presetFor = (presetId: string): HudLayoutPreset => {
  const preset = HUD_LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
  const resolved =
    preset ?? HUD_LAYOUT_PRESETS.find((candidate) => candidate.id === HUD_SAFE_PRESET_ID);
  if (!resolved) {
    throw new Error(`Missing safe HUD preset: ${HUD_SAFE_PRESET_ID}`);
  }
  return { schemaVersion: 1, id: resolved.id, name: resolved.name, widgets: [...resolved.widgets] };
};

/** Whether a widget is a required, never-hideable surface. */
export const isRequiredHudWidget = (widgetId: string): boolean =>
  (HUD_REQUIRED_WIDGET_IDS as readonly string[]).includes(widgetId);

/** The persisted value a widget would have with no overrides at all. */
export const baselineHudWidgetPreference = (
  presetId: string,
  widgetId: HudWidgetId,
): HudWidgetPreference | undefined => {
  const preset = presetFor(presetId);
  return preset.widgets.find((widget) => widget.widgetId === widgetId);
};

/** The effective preference for one widget (preset merged with its override). */
export const effectiveHudWidgetPreference = (
  preferences: HudUserPreferences,
  widgetId: HudWidgetId,
): HudWidgetPreference | undefined => {
  const { merged } = mergeHudPreferences(preferences);
  return merged.find((widget) => widget.widgetId === widgetId);
};

/**
 * Whether a widget's effective policy is anything other than `hidden`.
 *
 * The one read the legacy per-widget toggles (the audio music-player switch)
 * need so they stop owning a second visibility source of truth (C-528
 * Directive 11).
 */
export const isHudWidgetPolicyVisible = (
  preferences: HudUserPreferences,
  widgetId: HudWidgetId,
): boolean => {
  const preference = effectiveHudWidgetPreference(preferences, widgetId);
  return preference !== undefined && preference.visibility !== 'hidden';
};

/** Field-wise equality — object key order must never make two equal values differ. */
const sameHudWidgetPreference = (left: HudWidgetPreference, right: HudWidgetPreference): boolean =>
  left.widgetId === right.widgetId &&
  left.visibility === right.visibility &&
  left.anchor === right.anchor &&
  left.order === right.order &&
  left.density === right.density &&
  left.scale === right.scale;

/**
 * Writes a partial override for one widget.
 *
 * Required widgets can never be hidden: the visibility field is ignored for
 * them so a persisted snapshot cannot strand the player without recovery
 * navigation. Every other field is accepted as long as the widget is known.
 *
 * 🔴 Two rules keep the override list duplicate-free and honest:
 *   1. A patch with nothing applicable left after sanitizing (required
 *      visibility, a region the widget cannot occupy) is not an edit.
 *   2. Repeating a patch that already produced an identical override is a
 *      no-op, so a stray drop cannot append a second row for the same widget.
 * A first-time explicit choice is always recorded, even when it restates the
 * preset — migration relies on that to prove the legacy value was honoured.
 */
export const setHudWidgetOverride = (options: {
  preferences: HudUserPreferences;
  widgetId: HudWidgetId;
  patch: Partial<Omit<HudWidgetPreference, 'widgetId'>>;
}): HudUserPreferences => {
  const { preferences, widgetId } = options;
  const base = effectiveHudWidgetPreference(preferences, widgetId);
  if (!base) {
    return preferences;
  }
  const patch = { ...options.patch };
  if (isRequiredHudWidget(widgetId)) {
    delete patch.visibility;
  }
  if (patch.anchor !== undefined && !isHudAnchorAllowed(widgetId, patch.anchor)) {
    delete patch.anchor;
  }
  if (patch.scale !== undefined) {
    patch.scale = clampHudScale(patch.scale);
  }
  if (Object.keys(patch).length === 0) {
    return preferences;
  }
  const next: HudWidgetPreference = { ...base, ...patch, widgetId };
  const existing = preferences.overrides.find((entry) => entry.widgetId === widgetId);
  if (existing !== undefined && sameHudWidgetPreference(next, existing)) {
    return preferences;
  }
  const overrides = preferences.overrides.filter((entry) => entry.widgetId !== widgetId);
  overrides.push(next);
  return { ...preferences, overrides };
};

/** Drops the override for one widget — the preset value returns. */
export const resetHudWidgetOverride = (
  preferences: HudUserPreferences,
  widgetId: HudWidgetId,
): HudUserPreferences => ({
  ...preferences,
  overrides: preferences.overrides.filter((entry) => entry.widgetId !== widgetId),
});

/** Drops every override — the shipped safe preset returns. */
export const resetHudLayout = (): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: HUD_SAFE_PRESET_ID,
  overrides: [],
});

/** Selects a shipped preset and clears the overrides that were tuned for the old one. */
export const applyHudPreset = (
  preferences: HudUserPreferences,
  presetId: string,
): HudUserPreferences => {
  if (!(HUD_PRESET_IDS as readonly string[]).includes(presetId)) {
    return preferences;
  }
  const preset = presetFor(presetId);
  return { schemaVersion: 1, selectedPresetId: preset.id, overrides: [] };
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Every edit the editor can perform, regardless of input device. */
export type HudEditorCommand =
  | { kind: 'set-visibility'; widgetId: HudWidgetId; visibility: HudVisibility }
  | { kind: 'cycle-visibility'; widgetId: HudWidgetId; direction: 1 | -1 }
  | { kind: 'set-anchor'; widgetId: HudWidgetId; anchor: HudAnchor }
  | { kind: 'move-anchor'; widgetId: HudWidgetId; direction: 1 | -1 }
  | { kind: 'set-density'; widgetId: HudWidgetId; density: HudDensity }
  | { kind: 'set-scale'; widgetId: HudWidgetId; scale: number }
  | { kind: 'nudge-scale'; widgetId: HudWidgetId; delta: number }
  | { kind: 'reorder'; widgetId: HudWidgetId; direction: 1 | -1 }
  | { kind: 'reset-widget'; widgetId: HudWidgetId }
  | { kind: 'reset-layout' }
  | { kind: 'apply-preset'; presetId: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'save' }
  | { kind: 'cancel' };

/** The editor's whole state: the committed snapshot, the draft, and the history. */
export type HudEditorState = {
  readonly committed: HudUserPreferences;
  readonly draft: HudUserPreferences;
  readonly undoStack: readonly HudUserPreferences[];
  readonly redoStack: readonly HudUserPreferences[];
};

/** Maximum retained history depth — bounds memory for a long editing session. */
export const HUD_EDITOR_HISTORY_LIMIT = 50;

/** Creates an editor state whose draft equals the committed snapshot. */
export const createHudEditorState = (committed: HudUserPreferences): HudEditorState => ({
  committed,
  draft: committed,
  undoStack: [],
  redoStack: [],
});

/** Whether the draft differs from the committed snapshot. */
export const hudEditorIsDirty = (state: HudEditorState): boolean =>
  JSON.stringify(state.draft) !== JSON.stringify(state.committed);

/** Whether Undo is available. */
export const hudEditorCanUndo = (state: HudEditorState): boolean => state.undoStack.length > 0;

/** Whether Redo is available. */
export const hudEditorCanRedo = (state: HudEditorState): boolean => state.redoStack.length > 0;

const withDraft = (state: HudEditorState, draft: HudUserPreferences): HudEditorState => {
  if (JSON.stringify(draft) === JSON.stringify(state.draft)) {
    return state;
  }
  const undoStack = [...state.undoStack, state.draft].slice(-HUD_EDITOR_HISTORY_LIMIT);
  return { ...state, draft, undoStack, redoStack: [] };
};

const nextAnchor = (
  widgetId: HudWidgetId,
  current: HudSlot,
  direction: 1 | -1,
): HudAnchor | undefined => {
  const allowed = allowedHudAnchors(widgetId);
  if (allowed.length === 0) {
    return undefined;
  }
  const index = allowed.indexOf(current);
  if (index === -1) {
    return allowed[0];
  }
  const nextIndex = (index + direction + allowed.length) % allowed.length;
  return allowed[nextIndex];
};

const visibilityOrder: readonly HudVisibility[] = ['always', 'contextual', 'hidden'];

const cycleVisibility = (current: HudVisibility, direction: 1 | -1): HudVisibility => {
  const index = visibilityOrder.indexOf(current);
  const nextIndex = (index + direction + visibilityOrder.length) % visibilityOrder.length;
  return visibilityOrder[nextIndex] ?? current;
};

/**
 * Swaps the `order` of a widget with its nearest neighbour in the same anchor.
 *
 * Both widgets get an explicit override so the swap survives a preset change,
 * and the neighbour search is deterministic (ties broken by registry priority).
 */
const reorderWidget = (options: {
  state: HudEditorState;
  widgetId: HudWidgetId;
  direction: 1 | -1;
}): HudUserPreferences => {
  const { merged } = mergeHudPreferences(options.state.draft);
  const current = merged.find((widget) => widget.widgetId === options.widgetId);
  if (!current) {
    return options.state.draft;
  }
  const siblings = merged
    .filter((widget) => widget.anchor === current.anchor && widget.widgetId !== current.widgetId)
    .sort((left, right) => left.order - right.order);
  const neighbour =
    options.direction === 1
      ? siblings.find((widget) => widget.order > current.order)
      : [...siblings].reverse().find((widget) => widget.order < current.order);
  if (!neighbour) {
    return options.state.draft;
  }
  if (!isHudWidgetId(current.widgetId) || !isHudWidgetId(neighbour.widgetId)) {
    return options.state.draft;
  }
  const swapped = setHudWidgetOverride({
    preferences: setHudWidgetOverride({
      preferences: options.state.draft,
      widgetId: current.widgetId,
      patch: { order: neighbour.order },
    }),
    widgetId: neighbour.widgetId,
    patch: { order: current.order },
  });
  return swapped;
};

/** Applies one command to the editor state. Pure — never mutates its input. */
export const applyHudEditorCommand = (
  state: HudEditorState,
  command: HudEditorCommand,
): HudEditorState => {
  switch (command.kind) {
    case 'save':
      return {
        committed: state.draft,
        draft: state.draft,
        undoStack: [],
        redoStack: [],
      };
    case 'cancel':
      return { committed: state.committed, draft: state.committed, undoStack: [], redoStack: [] };
    case 'undo': {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (previous === undefined) {
        return state;
      }
      return {
        committed: state.committed,
        draft: previous,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [state.draft, ...state.redoStack].slice(0, HUD_EDITOR_HISTORY_LIMIT),
      };
    }
    case 'redo': {
      const next = state.redoStack[0];
      if (next === undefined) {
        return state;
      }
      return {
        committed: state.committed,
        draft: next,
        undoStack: [...state.undoStack, state.draft].slice(-HUD_EDITOR_HISTORY_LIMIT),
        redoStack: state.redoStack.slice(1),
      };
    }
    case 'reset-layout':
      return withDraft(state, resetHudLayout());
    case 'apply-preset':
      return withDraft(state, applyHudPreset(state.draft, command.presetId));
    case 'reset-widget':
      return withDraft(state, resetHudWidgetOverride(state.draft, command.widgetId));
    case 'set-visibility':
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { visibility: command.visibility },
        }),
      );
    case 'cycle-visibility': {
      const current = effectiveHudWidgetPreference(state.draft, command.widgetId);
      if (!current) {
        return state;
      }
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { visibility: cycleVisibility(current.visibility, command.direction) },
        }),
      );
    }
    case 'set-anchor':
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { anchor: command.anchor },
        }),
      );
    case 'move-anchor': {
      const current = effectiveHudWidgetPreference(state.draft, command.widgetId);
      if (!current) {
        return state;
      }
      const anchor = nextAnchor(command.widgetId, current.anchor, command.direction);
      if (!anchor || anchor === current.anchor) {
        return state;
      }
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { anchor },
        }),
      );
    }
    case 'set-density':
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { density: command.density },
        }),
      );
    case 'set-scale':
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { scale: clampHudScale(command.scale) },
        }),
      );
    case 'nudge-scale': {
      const current = effectiveHudWidgetPreference(state.draft, command.widgetId);
      if (!current) {
        return state;
      }
      return withDraft(
        state,
        setHudWidgetOverride({
          preferences: state.draft,
          widgetId: command.widgetId,
          patch: { scale: clampHudScale(current.scale + command.delta) },
        }),
      );
    }
    case 'reorder':
      return withDraft(
        state,
        reorderWidget({ state, widgetId: command.widgetId, direction: command.direction }),
      );
    default:
      return state;
  }
};

// ---------------------------------------------------------------------------
// Exchange
// ---------------------------------------------------------------------------

/** Builds a shareable preset from the current snapshot. */
export const exportHudPreset = (options: {
  preferences: HudUserPreferences;
  id: string;
  name: string;
}): HudLayoutPreset => {
  const { merged } = mergeHudPreferences(options.preferences);
  return {
    schemaVersion: 1,
    id: options.id,
    name: options.name,
    widgets: merged.map((widget) => ({ ...widget })),
  };
};

/** Why an imported preset could not be adopted. */
export type HudPresetImportFailure =
  | { readonly reason: 'invalid-preset' }
  | { readonly reason: 'missing-required-widget'; readonly widgetIds: readonly string[] };

/** The outcome of importing a preset. */
export type HudPresetImportResult =
  | {
      readonly ok: true;
      readonly preferences: HudUserPreferences;
      /** Ids this build does not know — retained as dormant preferences. */
      readonly dormantWidgetIds: readonly string[];
    }
  | ({ readonly ok: false } & HudPresetImportFailure);

/**
 * Adopts an imported preset.
 *
 * Unknown OPTIONAL ids are retained as inert overrides so the choice resumes if
 * the widget comes back (AC-8). A preset that omits a required surface this
 * build has is incompatible: adopting it would leave the player without
 * recovery navigation, so it is rejected with an explanation instead.
 */
export const importHudPreset = (options: {
  current: HudUserPreferences;
  preset: unknown;
}): HudPresetImportResult => {
  const preset = parseHudLayoutPreset(options.preset);
  if (!preset) {
    return { ok: false, reason: 'invalid-preset' };
  }
  const provided = new Set(preset.widgets.map((widget) => widget.widgetId));
  const missingRequired = (HUD_REQUIRED_WIDGET_IDS as readonly string[]).filter(
    (widgetId) => !provided.has(widgetId),
  );
  if (missingRequired.length > 0) {
    return { ok: false, reason: 'missing-required-widget', widgetIds: missingRequired };
  }
  const dormantWidgetIds = preset.widgets
    .map((widget) => widget.widgetId)
    .filter((widgetId) => hudWidgetDefinition(widgetId) === undefined);
  const selectedPresetId = (HUD_PRESET_IDS as readonly string[]).includes(preset.id)
    ? preset.id
    : options.current.selectedPresetId;
  const preferences: HudUserPreferences = {
    schemaVersion: 1,
    selectedPresetId,
    overrides: preset.widgets.map((widget) => ({ ...widget })),
  };
  const parsed = parseHudUserPreferences(preferences);
  if (!parsed) {
    return { ok: false, reason: 'invalid-preset' };
  }
  return { ok: true, preferences: parsed, dormantWidgetIds };
};

/** Re-validates an untrusted snapshot, returning undefined when it is unusable. */
export const validateHudPreferences = (value: unknown): HudUserPreferences | undefined =>
  parseHudUserPreferences(value);

/** Every anchor, exported for editor controls that need the full list. */
export const HUD_EDITOR_ANCHORS: readonly HudSlot[] = HUD_ANCHOR_ORDER;

/** All anchors as declared by the schema (used by tests and the anchor picker). */
export const HUD_SCHEMA_ANCHORS = HUD_ANCHORS;
