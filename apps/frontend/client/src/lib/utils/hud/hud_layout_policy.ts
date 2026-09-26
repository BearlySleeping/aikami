// apps/frontend/client/src/lib/utils/hud/hud_layout_policy.ts
//
// C-528 — the ONE pure resolver for HUD placement, visibility and reflow.
//
// Three concepts used to be one boolean per widget, decided inline by the
// overlay router. This module separates them explicitly:
//
//   1. saved user intent   — the preset + per-widget overrides (persisted)
//   2. context             — overlay, focus, relevance, capabilities (transient)
//   3. derived pixels      — anchors, stacking, effective scale, overflow (never saved)
//
// Everything here is a pure function of its inputs: no services, no storage, no
// DOM, no Svelte. That is what makes the contract's invariants — "Cancel
// restores the exact prior snapshot", "visiting compact mode never mutates
// desktop intent", "hidden nodes cannot capture input" — provable in unit tests
// rather than asserted from a screenshot.
//
// Contract: C-528 AC-1, AC-4, AC-5, AC-8.

import {
  HUD_COMPACT_MAX_HEIGHT,
  HUD_COMPACT_MAX_WIDTH,
  HUD_LAYOUT_PRESETS,
  HUD_REQUIRED_WIDGET_IDS,
  HUD_SAFE_PRESET_ID,
  HUD_SCALE_MAX,
  HUD_SCALE_MIN,
  HUD_STACK_GAP,
  HUD_TOUCH_MAX_WIDTH,
  HUD_WIDGET_REGISTRY,
} from '@aikami/constants';
import type {
  HudDensityValue,
  HudSlot,
  HudUserPreferences,
  HudWidgetDefinition,
  HudWidgetId,
  HudWidgetPreference,
} from '@aikami/types';
import type { GameOverlayType } from '$types';
import {
  anchorAvailableHeight,
  anchorColumnWidth,
  availableAnchors,
  emptyRect,
  HUD_ANCHOR_CLASS,
  HUD_ANCHOR_ORDER,
  HUD_ANCHOR_STACK_DIRECTION,
  type HudRect,
  hudAnchorClass,
  roundPixels,
  stackAnchor,
} from './hud_layout_geometry.ts';

export {
  HUD_ANCHOR_CLASS,
  HUD_ANCHOR_ORDER,
  HUD_ANCHOR_STACK_DIRECTION,
  type HudRect,
  hudAnchorClass,
};

// ---------------------------------------------------------------------------
// Overlay policy — the single hidden-set owner
// ---------------------------------------------------------------------------

/**
 * Management destinations own the whole screen, including the top rail.
 *
 * Leaving the corner HUD chrome mounted paints it ON TOP of the rail, which is
 * how the clock ended up covering the Back control at 200% text. The chrome is
 * therefore withdrawn for every management destination.
 *
 * Declared here (rather than imported from the view layer) so this module stays
 * free of view-layer dependencies and can be used by the settings service. The
 * unit test asserts it matches `MANAGEMENT_OVERLAY_TYPES`, so the two can never
 * drift apart.
 */
export const HUD_MANAGEMENT_OVERLAYS: ReadonlySet<GameOverlayType> = new Set<GameOverlayType>([
  'INVENTORY',
  'QUEST_LOG',
  'JOURNAL',
  'CHARACTER_DASHBOARD',
  'PARTY_ROSTER',
  'REPUTATION',
  'WORLD',
]);

/** HUD chrome hidden while a blocking menu or terminal surface is open. */
export const HUD_HIDDEN_IN_MENU: ReadonlySet<GameOverlayType> = new Set<GameOverlayType>([
  'PAUSE_MENU',
  'GAME_OVER',
  'END_SESSION',
  'HUD_EDITOR',
  ...HUD_MANAGEMENT_OVERLAYS,
]);

/** HUD chrome hidden whenever the world is not the focus. */
export const HUD_HIDDEN_WHILE_BUSY: ReadonlySet<GameOverlayType> = new Set<GameOverlayType>([
  'PAUSE_MENU',
  'GAME_OVER',
  'END_SESSION',
  'COMBAT',
  'DIALOGUE',
  'HUD_EDITOR',
  ...HUD_MANAGEMENT_OVERLAYS,
]);

/** Whether the management host currently owns the screen. */
export const isHudManagementOverlayVisible = (overlay: GameOverlayType): boolean =>
  HUD_MANAGEMENT_OVERLAYS.has(overlay);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Viewport classification that drives reflow. */
export type HudViewportClass = 'desktop' | 'compact' | 'touch';

/** A measured viewport. */
export type HudViewport = {
  readonly width: number;
  readonly height: number;
};

/** Why a widget ended up in the state it did. */
export type HudResolutionReason =
  | 'required'
  | 'policy-always'
  | 'contextual-relevant'
  | 'contextual-pending'
  | 'contextual-idle'
  | 'policy-hidden'
  | 'overlay-hidden'
  | 'capability-missing'
  | 'reflow-collapsed';

/** A widget placed by the resolver. */
export type HudResolvedWidget = {
  readonly widgetId: HudWidgetId;
  readonly label: string;
  readonly required: boolean;
  readonly priority: number;
  readonly anchor: HudSlot;
  readonly order: number;
  readonly density: HudDensityValue;
  /** Requested scale, clamped to the registry bounds. */
  readonly scale: number;
  /** Scale actually used after text-scale and capacity constraints. */
  readonly effectiveScale: number;
  /** Effective minimum box at the resolved scale (text-scale aware). */
  readonly minWidth: number;
  readonly minHeight: number;
  readonly rect: HudRect;
  /** Painted right now. */
  readonly visible: boolean;
  /**
   * Occupies its stack slot even while not visible.
   *
   * This is what keeps a contextual widget from making its neighbours jump
   * while its settle delay elapses.
   */
  readonly reserved: boolean;
  /** Whether the widget may receive pointer events or a tab stop. */
  readonly interactive: boolean;
  /** Moved into the labelled overflow entry by reflow. */
  readonly collapsed: boolean;
  /** Capability absent — preference is retained but nothing is placed. */
  readonly dormant: boolean;
  readonly reason: HudResolutionReason;
};

/** The fully derived layout for one viewport + context. */
export type HudResolvedLayout = {
  readonly viewportClass: HudViewportClass;
  /** Placed widgets, in anchor order then stack order. */
  readonly widgets: readonly HudResolvedWidget[];
  /** Widgets reflow moved behind the labelled overflow entry. */
  readonly overflow: readonly HudResolvedWidget[];
  /**
   * Widgets that keep a preference but are not placed at all: policy-hidden,
   * idle contextual, or capability-dormant. They occupy no space and take no
   * input.
   */
  readonly inactive: readonly HudResolvedWidget[];
  /** Persisted ids that are not in the registry — retained, inert, never placed. */
  readonly unknownWidgetIds: readonly string[];
  /** Machine-readable warnings for observability (never personal content). */
  readonly warnings: readonly string[];
};

/** Everything the resolver needs. */
export type HudResolveInput = {
  readonly preferences: HudUserPreferences;
  /** Capability keys available this session (see HUD_WIDGET_CAPABILITIES). */
  readonly capabilities: readonly string[];
  readonly overlay: GameOverlayType;
  readonly isTransitioning?: boolean;
  readonly viewport: HudViewport;
  /** 1 = 100% text, 2 = 200% text. */
  readonly textScale?: number;
  /** Widgets currently holding focus — they stay mounted until focus moves. */
  readonly focusedWidgetIds?: readonly string[];
  /** Contextual widgets with something to show right now. */
  readonly relevantWidgetIds?: readonly string[];
  /** Contextual widgets whose settle delay has NOT elapsed yet. */
  readonly pendingWidgetIds?: readonly string[];
};

// ---------------------------------------------------------------------------
// Viewport classification
// ---------------------------------------------------------------------------

/** Classifies a viewport into the three reflow classes. */
export const classifyHudViewport = (viewport: HudViewport): HudViewportClass => {
  if (viewport.width < HUD_TOUCH_MAX_WIDTH) {
    return 'touch';
  }
  if (viewport.width < HUD_COMPACT_MAX_WIDTH || viewport.height < HUD_COMPACT_MAX_HEIGHT) {
    return 'compact';
  }
  return 'desktop';
};

/**
 * Whether a region exists at all in this viewport.
 *
 * The editor needs this BEFORE it lets a player drop a widget somewhere: a
 * region the resolver would collapse into the overflow entry is a drop target
 * that silently does nothing, which is indistinguishable from a broken drag.
 * Exposed here so the editor asks the resolver's own policy instead of
 * re-deriving a second opinion about which regions exist.
 */
export const isHudAnchorAvailable = (viewport: HudViewport, anchor: HudSlot): boolean =>
  availableAnchors(classifyHudViewport(viewport)).includes(anchor);

/** Scale ceiling per viewport class — a compact viewport never enlarges widgets. */
const SCALE_CEILING_BY_CLASS: Readonly<Record<HudViewportClass, number>> = {
  desktop: HUD_SCALE_MAX,
  compact: 1.25,
  touch: 1,
};

// ---------------------------------------------------------------------------
// Preference merging
// ---------------------------------------------------------------------------

const registryById = new Map<string, HudWidgetDefinition>(
  HUD_WIDGET_REGISTRY.map((widget) => [widget.id, widget]),
);

const requiredIds: ReadonlySet<string> = new Set<string>(HUD_REQUIRED_WIDGET_IDS);

const presetById = new Map<string, (typeof HUD_LAYOUT_PRESETS)[number]>(
  HUD_LAYOUT_PRESETS.map((preset) => [preset.id, preset]),
);

/** Whether a widget id is a trusted registry id. */
export const isHudWidgetId = (value: string): value is HudWidgetId => registryById.has(value);

/** The trusted registry entry for an id, when it exists. */
export const hudWidgetDefinition = (widgetId: string): HudWidgetDefinition | undefined =>
  registryById.get(widgetId);

/** Whether a widget can ever be hidden by a player policy. */
export const isHudWidgetRequired = (widgetId: string): boolean => requiredIds.has(widgetId);

const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, scale));
};

/** The preset for the persisted selection, falling back to the shipped safe preset. */
export const resolveHudPreset = (
  presetId: string,
): { preset: (typeof HUD_LAYOUT_PRESETS)[number]; fallback: boolean } => {
  const preset = presetById.get(presetId);
  if (preset) {
    return { preset, fallback: false };
  }
  const safe = presetById.get(HUD_SAFE_PRESET_ID);
  if (!safe) {
    throw new Error(`Missing safe HUD preset: ${HUD_SAFE_PRESET_ID}`);
  }
  return { preset: safe, fallback: true };
};

/**
 * Merges the selected preset with the per-widget overrides.
 *
 * Overrides win field-by-field. Unknown ids are collected — never dropped —
 * so a preference for a widget this build does not have stays dormant instead
 * of being deleted on the player's behalf.
 */
export const mergeHudPreferences = (
  preferences: HudUserPreferences,
): {
  merged: readonly HudWidgetPreference[];
  unknownWidgetIds: readonly string[];
  presetFallback: boolean;
} => {
  const { preset, fallback } = resolveHudPreset(preferences.selectedPresetId);
  const byId = new Map<string, HudWidgetPreference>();
  for (const entry of preset.widgets) {
    byId.set(entry.widgetId, { ...entry });
  }
  const unknownWidgetIds: string[] = [];
  for (const override of preferences.overrides) {
    if (!registryById.has(override.widgetId)) {
      unknownWidgetIds.push(override.widgetId);
      continue;
    }
    const base = byId.get(override.widgetId);
    byId.set(override.widgetId, base ? { ...base, ...override } : { ...override });
  }
  // Registry order keeps resolution deterministic regardless of storage order.
  const merged = HUD_WIDGET_REGISTRY.flatMap((widget) => {
    const entry = byId.get(widget.id);
    return entry ? [entry] : [];
  });
  return { merged, unknownWidgetIds, presetFallback: fallback };
};

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

type HudVisibilityInput = {
  readonly definition: HudWidgetDefinition;
  readonly preference: HudWidgetPreference;
  readonly overlay: GameOverlayType;
  readonly isTransitioning: boolean;
  readonly capabilities: ReadonlySet<string>;
  readonly focusedWidgetIds: ReadonlySet<string>;
  readonly relevantWidgetIds: ReadonlySet<string>;
  readonly pendingWidgetIds: ReadonlySet<string>;
};

type HudVisibilityResult = {
  readonly visible: boolean;
  readonly reserved: boolean;
  readonly dormant: boolean;
  readonly reason: HudResolutionReason;
  readonly warnings: readonly string[];
};

const resolveWidgetVisibility = (input: HudVisibilityInput): HudVisibilityResult => {
  const { definition, preference } = input;
  const warnings: string[] = [];

  if (definition.capability !== undefined && !input.capabilities.has(definition.capability)) {
    // Dormant: the preference is retained, but nothing is placed and nothing
    // reserves space. Re-adding the capability resumes the same choice.
    return {
      visible: false,
      reserved: false,
      dormant: true,
      reason: 'capability-missing',
      warnings,
    };
  }

  if (definition.required) {
    if (preference.visibility !== 'always') {
      warnings.push(`required-widget-policy-coerced:${definition.id}`);
    }
    const hiddenByOverlay = HUD_HIDDEN_IN_MENU.has(input.overlay);
    return {
      visible: !hiddenByOverlay,
      reserved: !hiddenByOverlay,
      dormant: false,
      reason: hiddenByOverlay ? 'overlay-hidden' : 'required',
      warnings,
    };
  }

  if (HUD_HIDDEN_WHILE_BUSY.has(input.overlay)) {
    return { visible: false, reserved: false, dormant: false, reason: 'overlay-hidden', warnings };
  }

  if (preference.visibility === 'hidden') {
    return { visible: false, reserved: false, dormant: false, reason: 'policy-hidden', warnings };
  }

  if (preference.visibility === 'always') {
    return { visible: true, reserved: true, dormant: false, reason: 'policy-always', warnings };
  }

  // Contextual. A focused widget stays mounted until focus safely moves, even
  // if its relevance flag has just gone away.
  if (input.focusedWidgetIds.has(definition.id)) {
    return {
      visible: true,
      reserved: true,
      dormant: false,
      reason: 'contextual-relevant',
      warnings,
    };
  }

  const relevant =
    input.relevantWidgetIds.has(definition.id) &&
    (input.overlay === 'NONE' || input.focusedWidgetIds.has(definition.id));
  if (!relevant || input.isTransitioning) {
    return { visible: false, reserved: false, dormant: false, reason: 'contextual-idle', warnings };
  }
  if (input.pendingWidgetIds.has(definition.id)) {
    // Settle delay has not elapsed: not painted, but the slot is already
    // reserved so the neighbours do not jump when it appears.
    return {
      visible: false,
      reserved: true,
      dormant: false,
      reason: 'contextual-pending',
      warnings,
    };
  }
  return {
    visible: true,
    reserved: true,
    dormant: false,
    reason: 'contextual-relevant',
    warnings,
  };
};

// ---------------------------------------------------------------------------
// Geometry and reflow
// ---------------------------------------------------------------------------

/**
 * Resolves the effective scale and effective minimum box for one widget.
 *
 * Effective text/hit-target minima win over the requested scale: a widget whose
 * measured minimum already exceeds the viewport capacity is reduced toward the
 * registry floor before it is ever collapsed.
 */
const resolveBox = (options: {
  readonly definition: HudWidgetDefinition;
  readonly requestedScale: number;
  readonly textScale: number;
  readonly viewportClass: HudViewportClass;
  readonly availableWidth: number;
}): { effectiveScale: number; minWidth: number; minHeight: number; fits: boolean } => {
  const textScale =
    Number.isFinite(options.textScale) && options.textScale > 0 ? options.textScale : 1;
  const ceiling = SCALE_CEILING_BY_CLASS[options.viewportClass];
  const requested = Math.min(clampScale(options.requestedScale), ceiling);
  const textAwareWidth = options.definition.minWidth * textScale;
  const textAwareHeight = options.definition.minHeight * textScale;
  let effectiveScale = requested;
  let fits = true;
  if (textAwareWidth > 0 && textAwareWidth * effectiveScale > options.availableWidth) {
    // The requested scale does not fit the column. Shrink toward the registry
    // floor; if even the floor overflows, the widget does not fit and the
    // resolver collapses it rather than letting it spill into a neighbour.
    const required = options.availableWidth / textAwareWidth;
    fits = required >= HUD_SCALE_MIN;
    effectiveScale = Math.max(required, Number.EPSILON);
  }
  return {
    effectiveScale: roundPixels(effectiveScale),
    minWidth: roundPixels(textAwareWidth * effectiveScale),
    minHeight: roundPixels(textAwareHeight * effectiveScale),
    fits,
  };
};

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** Resolves the complete HUD layout. Pure — the same inputs always give the same output. */
export const resolveHudLayout = (input: HudResolveInput): HudResolvedLayout => {
  const viewportClass = classifyHudViewport(input.viewport);
  const textScale = input.textScale ?? 1;
  const isTransitioning = input.isTransitioning ?? false;
  const capabilities = new Set(input.capabilities);
  const focusedWidgetIds = new Set(input.focusedWidgetIds ?? []);
  const pendingWidgetIds = new Set(input.pendingWidgetIds ?? []);
  const relevantWidgetIds = new Set(input.relevantWidgetIds ?? []);

  const { merged, unknownWidgetIds, presetFallback } = mergeHudPreferences(input.preferences);
  const warnings: string[] = [];
  if (presetFallback) {
    warnings.push(`unknown-preset:${input.preferences.selectedPresetId}`);
  }
  if (unknownWidgetIds.length > 0) {
    warnings.push(`unknown-widgets:${unknownWidgetIds.join(',')}`);
  }

  const availableHeight = anchorAvailableHeight(input.viewport);
  const usableAnchors = new Set(availableAnchors(viewportClass));

  type Candidate = {
    readonly definition: HudWidgetDefinition;
    readonly preference: HudWidgetPreference;
    readonly visible: boolean;
    readonly reserved: boolean;
    readonly dormant: boolean;
    readonly reason: HudResolutionReason;
    readonly effectiveScale: number;
    readonly minWidth: number;
    readonly minHeight: number;
    /** False when the widget cannot fit its anchor column even at the scale floor. */
    readonly fits: boolean;
  };

  const candidates: Candidate[] = [];
  for (const preference of merged) {
    const definition = registryById.get(preference.widgetId);
    if (!definition) {
      continue;
    }
    const visibility = resolveWidgetVisibility({
      definition,
      preference,
      overlay: input.overlay,
      isTransitioning,
      capabilities,
      focusedWidgetIds,
      relevantWidgetIds,
      pendingWidgetIds,
    });
    warnings.push(...visibility.warnings);
    if (visibility.dormant) {
      candidates.push({
        definition,
        preference,
        visible: false,
        reserved: false,
        dormant: true,
        reason: visibility.reason,
        effectiveScale: clampScale(preference.scale),
        minWidth: 0,
        minHeight: 0,
        fits: true,
      });
      continue;
    }
    const box = resolveBox({
      definition,
      requestedScale: preference.scale,
      textScale,
      viewportClass,
      availableWidth: anchorColumnWidth(input.viewport, preference.anchor),
    });
    candidates.push({
      definition,
      preference,
      visible: visibility.visible,
      reserved: visibility.reserved,
      dormant: false,
      reason: visibility.reason,
      ...box,
    });
  }

  // ── Reflow ──
  //
  // Step 1: an anchor unavailable in this viewport class collapses its whole
  // stack, lowest priority first. Step 2: an over-tall stack collapses until it
  // fits. Required widgets are never collapsed — a required surface that cannot
  // fit is still placed, because dropping it would strand the player.
  const overflow: Candidate[] = [];
  const surviving: Candidate[] = [];
  // Not placed at all: policy-hidden, idle contextual, or capability-dormant.
  // They keep their preference but occupy no space and take no input.
  const inactive: Candidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.reserved) {
      inactive.push(candidate);
      continue;
    }
    if (!usableAnchors.has(candidate.preference.anchor) && !candidate.definition.required) {
      overflow.push(candidate);
      continue;
    }
    if (!candidate.fits && !candidate.definition.required) {
      // Cannot fit its column even at the scale floor — go behind the labelled
      // overflow entry instead of overlapping the neighbouring region.
      overflow.push(candidate);
      continue;
    }
    surviving.push(candidate);
  }

  const byAnchor = new Map<HudSlot, Candidate[]>();
  for (const candidate of surviving) {
    const list = byAnchor.get(candidate.preference.anchor) ?? [];
    list.push(candidate);
    byAnchor.set(candidate.preference.anchor, list);
  }

  const stackOrder = (left: Candidate, right: Candidate): number => {
    if (left.preference.order !== right.preference.order) {
      return left.preference.order - right.preference.order;
    }
    return left.definition.priority - right.definition.priority;
  };

  const placed: HudResolvedWidget[] = [];
  for (const anchor of HUD_ANCHOR_ORDER) {
    const stack = byAnchor.get(anchor);
    if (!stack) {
      continue;
    }
    stack.sort(stackOrder);

    // Collapse the lowest-priority reserved widgets until the stack fits.
    const fits = (entries: readonly Candidate[]): boolean => {
      let height = 0;
      for (const entry of entries) {
        height += entry.minHeight + HUD_STACK_GAP;
      }
      return height <= availableHeight;
    };

    let working = [...stack];
    while (!fits(working)) {
      const index = findLowestPriorityCollapsible(working);
      if (index === -1) {
        break;
      }
      overflow.push(working[index]);
      working = working.filter((_, position) => position !== index);
    }

    const resolved = stackAnchor({
      anchor,
      viewport: input.viewport,
      viewportClass,
      entries: working.map((candidate) => toResolved(candidate, anchor)),
    });
    placed.push(...resolved);
  }

  const overflowResolved = overflow
    .sort((left, right) => left.definition.priority - right.definition.priority)
    .map((candidate) => ({
      ...toResolved(candidate, candidate.preference.anchor),
      visible: false,
      reserved: false,
      collapsed: true,
      reason: 'reflow-collapsed' as const,
      rect: emptyRect,
    }));

  const inactiveResolved = inactive.map((candidate) => ({
    ...toResolved(candidate, candidate.preference.anchor),
    visible: false,
    reserved: false,
    interactive: false,
    collapsed: false,
    rect: emptyRect,
  }));

  return {
    viewportClass,
    widgets: placed,
    overflow: overflowResolved,
    inactive: inactiveResolved,
    unknownWidgetIds,
    warnings,
  };
};

const findLowestPriorityCollapsible = (
  entries: readonly { definition: HudWidgetDefinition }[],
): number => {
  let bestIndex = -1;
  let bestPriority = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.definition.required) {
      continue;
    }
    if (entry.definition.priority > bestPriority) {
      bestPriority = entry.definition.priority;
      bestIndex = index;
    }
  }
  return bestIndex;
};

type CandidateForResolve = {
  readonly definition: HudWidgetDefinition;
  readonly preference: HudWidgetPreference;
  readonly visible: boolean;
  readonly reserved: boolean;
  readonly dormant: boolean;
  readonly reason: HudResolutionReason;
  readonly effectiveScale: number;
  readonly minWidth: number;
  readonly minHeight: number;
};

const toResolved = (candidate: CandidateForResolve, anchor: HudSlot): HudResolvedWidget => ({
  widgetId: candidate.definition.id,
  label: candidate.definition.label,
  required: candidate.definition.required,
  priority: candidate.definition.priority,
  anchor,
  order: candidate.preference.order,
  density: candidate.preference.density,
  scale: clampScale(candidate.preference.scale),
  effectiveScale: candidate.effectiveScale,
  minWidth: candidate.minWidth,
  minHeight: candidate.minHeight,
  rect: emptyRect,
  visible: candidate.visible,
  reserved: candidate.reserved,
  interactive: candidate.visible,
  collapsed: false,
  dormant: candidate.dormant,
  reason: candidate.reason,
});

/** Looks up one resolved widget by id. */
export const findResolvedHudWidget = (
  layout: HudResolvedLayout,
  widgetId: HudWidgetId,
): HudResolvedWidget | undefined =>
  layout.widgets.find((widget) => widget.widgetId === widgetId) ??
  layout.overflow.find((widget) => widget.widgetId === widgetId) ??
  layout.inactive.find((widget) => widget.widgetId === widgetId);

/**
 * Whether a resolved widget paints right now.
 *
 * Thin adapter used by the view; returns `false` for a widget that was not
 * placed at all, so an absent capability can never be mistaken for "visible".
 */
export const isHudWidgetVisible = (layout: HudResolvedLayout, widgetId: HudWidgetId): boolean =>
  findResolvedHudWidget(layout, widgetId)?.visible ?? false;

// The overlap invariant helpers live in `hud_layout_overlap.ts` (size budget);
// re-exported so existing importers keep one entry point.
export { hudLayoutOverlaps, hudRectsOverlap } from './hud_layout_overlap.ts';
