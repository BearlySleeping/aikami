// apps/frontend/client/src/lib/views/game/ui/hud_layout_bridge.ts
//
// C-528 — the thin view-layer adapter between live game state and the pure HUD
// resolver.
//
// The resolver (`$lib/utils/hud/hud_layout_policy.ts`) knows nothing about the
// game. This module is the only place that translates "what the session is
// doing right now" into resolver input, and it stays pure so the translation
// itself is testable.

import {
  HUD_DEFAULT_PRESET_ID,
  HUD_PREFERENCE_SCHEMA_VERSION,
  HUD_REQUIRED_WIDGET_IDS,
  HUD_WIDGET_REGISTRY,
} from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import type { HudWidgetId } from '@aikami/types';
import {
  type HudResolvedLayout,
  type HudViewport,
  resolveHudLayout,
} from '$lib/utils/hud/hud_layout_policy.ts';
import type { GameOverlayType } from '$types';

/** Live HUD state the resolver consumes. */
export type GameHudLayoutInput = {
  readonly preferences: HudUserPreferences;
  readonly capabilities: readonly string[];
  readonly overlay: GameOverlayType;
  readonly isTransitioning: boolean;
  readonly isTemporarilyHidden: boolean;
  readonly focusedWidgetIds: readonly string[];
  readonly relevantWidgetIds: readonly string[];
  readonly pendingWidgetIds: readonly string[];
  readonly viewport: HudViewport;
  readonly textScale: number;
};

/**
 * The snapshot used while Hide HUD is active.
 *
 * Temporary, in-memory, and deliberately NOT persisted: every optional widget is
 * hidden while `system-notice` and `menu` stay visible, so a save failure is
 * still announced and recovery navigation is still reachable.
 */
export const hiddenHudPreferences = (): HudUserPreferences => ({
  schemaVersion: HUD_PREFERENCE_SCHEMA_VERSION,
  selectedPresetId: HUD_DEFAULT_PRESET_ID,
  overrides: HUD_WIDGET_REGISTRY.filter(
    (widget) => !(HUD_REQUIRED_WIDGET_IDS as readonly string[]).includes(widget.id),
  ).map((widget) => ({
    widgetId: widget.id,
    visibility: 'hidden' as const,
    anchor: widget.defaultAnchor,
    order: widget.defaultOrder,
    density: 'compact' as const,
    scale: 1,
  })),
});

/** Resolves the live HUD layout, applying the temporary Hide HUD state. */
export const resolveGameHudLayout = (input: GameHudLayoutInput): HudResolvedLayout =>
  resolveHudLayout({
    preferences: input.isTemporarilyHidden ? hiddenHudPreferences() : input.preferences,
    capabilities: input.capabilities,
    overlay: input.overlay,
    isTransitioning: input.isTransitioning,
    viewport: input.viewport,
    textScale: input.textScale,
    focusedWidgetIds: input.focusedWidgetIds,
    relevantWidgetIds: input.relevantWidgetIds,
    pendingWidgetIds: input.pendingWidgetIds,
  });

/** Which capability keys this session actually provides. */
export const gameHudCapabilities = (available: {
  readonly party: boolean;
  readonly time: boolean;
  readonly audioLibrary: boolean;
}): readonly string[] => {
  const capabilities: string[] = [];
  if (available.party) {
    capabilities.push('party');
  }
  if (available.time) {
    capabilities.push('time');
  }
  if (available.audioLibrary) {
    capabilities.push('audio-library');
  }
  return capabilities;
};

/**
 * Which contextual widgets have something to show right now.
 *
 * Contextual visibility is a semantic event, not a timer: a widget is relevant
 * when the session says it has content. The resolver owns the settle delay and
 * the focus exception.
 */
export const gameHudRelevantWidgetIds = (context: {
  readonly hasObjective: boolean;
  readonly hasInteractionTarget: boolean;
  readonly hasPlayerStatus: boolean;
  readonly hasHotbar: boolean;
  readonly hasParty: boolean;
  readonly hasClock: boolean;
  readonly isSaving: boolean;
  readonly hasOnboardingHint: boolean;
  readonly hasSystemNotice: boolean;
  readonly isMusicPlaying: boolean;
}): readonly string[] => {
  const relevant: string[] = [];
  if (context.hasObjective) {
    relevant.push('objective');
  }
  if (context.hasInteractionTarget) {
    relevant.push('interaction');
  }
  if (context.hasPlayerStatus) {
    relevant.push('player-status');
  }
  if (context.hasHotbar) {
    relevant.push('hotbar');
  }
  if (context.hasParty) {
    relevant.push('party-status');
  }
  if (context.hasClock) {
    relevant.push('clock');
  }
  if (context.isSaving) {
    relevant.push('autosave');
  }
  if (context.hasOnboardingHint) {
    relevant.push('onboarding-hint');
  }
  if (context.hasSystemNotice) {
    relevant.push('system-notice');
  }
  if (context.isMusicPlaying) {
    relevant.push('music-player');
  }
  return relevant;
};

/**
 * Extra classes for a resolved widget wrapper.
 *
 * `hud-widget--density-*` is the density contract the widget views style
 * against; `zoom` (applied by the view) is the scale contract. Both come from
 * the resolver so the reserved box and the painted box agree.
 */
export const hudWidgetClass = (options: {
  readonly density: string;
  readonly collapsed: boolean;
  readonly visible: boolean;
}): string => {
  const classes = ['hud-widget', `hud-widget--density-${options.density}`];
  if (!options.visible) {
    classes.push('hud-widget--inactive');
  }
  if (options.collapsed) {
    classes.push('hud-widget--collapsed');
  }
  return classes.join(' ');
};

/** Whether a resolved widget paints. */
export const hudWidgetIsPainted = (widget: { readonly visible: boolean }): boolean =>
  widget.visible;

/** Whether a widget id is one this build registers. */
export const isKnownHudWidgetId = (widgetId: string): widgetId is HudWidgetId =>
  HUD_WIDGET_REGISTRY.some((widget) => widget.id === widgetId);
