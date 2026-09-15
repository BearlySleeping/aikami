// apps/frontend/client/src/lib/views/game/ui/game_hud_surface.svelte.ts
//
// C-528 — the HUD presentation surface of the game UI ViewModel.
//
// Split out of `game_ui_view_model.svelte.ts` so the overlay-router ViewModel
// keeps its size budget, and because this is a cohesive responsibility of its
// own: "what does the HUD look like right now". It owns the resolved layout,
// the temporary Hide HUD read, the labelled overflow entry's open state and the
// focused widget, and it is the ONLY thing the HUD markup reads.
//
// The resolver stays pure — this module only supplies live context to it.

import { HUD_OVERFLOW_ENTRY_LABEL } from '@aikami/constants';
import type { HudSlot, HudWidgetId } from '@aikami/types';
import {
  type HudResolvedLayout,
  type HudResolvedWidget,
  isHudWidgetVisible,
} from '$lib/utils/hud/hud_layout_policy.ts';
import type { AutoSaveStatus, GameOverlayType } from '$types';
import type {
  GameUIHudCapabilities,
  GameUIHudViewCapabilities,
} from './game_ui_view_model_types.ts';
import {
  gameHudCapabilities,
  gameHudRelevantWidgetIds,
  resolveGameHudLayout,
} from './hud_layout_bridge.ts';

/** Live session state the HUD reflow and contextual policy depend on. */
export type GameHudViewContext = {
  readonly activeOverlay: GameOverlayType;
  readonly isTransitioning: boolean;
  readonly autoSaveStatus: AutoSaveStatus;
  readonly interactionPromptVisible: boolean;
  readonly hasObjective: boolean;
  readonly hasOnboardingHint: boolean;
  readonly hasPlayerStatus: boolean;
  readonly hasHotbar: boolean;
};

/** The labelled, accessible entry that holds widgets collapsed by reflow. */
export const HUD_OVERFLOW_LABEL = HUD_OVERFLOW_ENTRY_LABEL;

export type GameHudViewOptions = {
  readonly hud: GameUIHudCapabilities;
  readonly hudView: GameUIHudViewCapabilities;
  /** Reads the live context; called on each layout resolution. */
  readonly readContext: () => GameHudViewContext;
};

export type GameHudViewInterface = {
  /** The ONE resolved layout the HUD markup renders. */
  readonly layout: HudResolvedLayout;
  readonly isTemporarilyHidden: boolean;
  readonly isEditorEnabled: boolean;
  readonly isOverflowOpen: boolean;
  readonly focusedWidgetId: string | undefined;
  /** Label for the labelled overflow entry (never a bare icon). */
  readonly overflowLabel: string;
  toggleTemporarilyHidden(): void;
  toggleOverflow(): void;
  setFocusedWidget(widgetId: string | undefined): void;
  handleFocusIn(event: FocusEvent): void;
  stacksUpward(anchor: HudSlot): boolean;
  showsOverflowInAnchor(anchor: HudSlot): boolean;
  isVisible(widgetId: HudWidgetId): boolean;
  widgetsInAnchor(anchor: HudSlot): readonly HudResolvedWidget[];
};

/**
 * Builds the HUD view surface.
 *
 * The capabilities are all reported as available: the client always has a
 * clock, a party slot and a local music library. A capability that later becomes
 * conditional only has to stop being listed — the resolver already treats a
 * missing capability as dormant rather than deleting the preference.
 */
export const createGameHudView = (options: GameHudViewOptions): GameHudViewInterface => {
  let isOverflowOpen = $state(false);
  let focusedWidgetId = $state<string | undefined>(undefined);

  const view: GameHudViewInterface = {
    get layout(): HudResolvedLayout {
      const context = options.readContext();
      return resolveGameHudLayout({
        preferences: options.hud.preferences,
        capabilities: gameHudCapabilities({ party: true, time: true, audioLibrary: true }),
        overlay: context.activeOverlay,
        isTransitioning: context.isTransitioning,
        isTemporarilyHidden: options.hud.isHudTemporarilyHidden,
        focusedWidgetIds: focusedWidgetId ? [focusedWidgetId] : [],
        relevantWidgetIds: gameHudRelevantWidgetIds({
          hasObjective: context.hasObjective,
          hasInteractionTarget: context.interactionPromptVisible,
          hasPlayerStatus: context.hasPlayerStatus,
          hasHotbar: context.hasHotbar,
          hasParty: true,
          hasClock: true,
          isSaving: context.autoSaveStatus === 'saving',
          hasOnboardingHint: context.hasOnboardingHint,
          hasSystemNotice: context.autoSaveStatus === 'error',
          isMusicPlaying: false,
        }),
        pendingWidgetIds: [],
        viewport: options.hudView.viewport,
        textScale: options.hudView.textScale,
      });
    },

    get isTemporarilyHidden(): boolean {
      return options.hud.isHudTemporarilyHidden;
    },

    get isEditorEnabled(): boolean {
      return options.hud.isEditorEnabled;
    },

    get isOverflowOpen(): boolean {
      return isOverflowOpen;
    },

    get focusedWidgetId(): string | undefined {
      return focusedWidgetId;
    },

    get overflowLabel(): string {
      return HUD_OVERFLOW_LABEL;
    },

    toggleTemporarilyHidden(): void {
      options.hud.toggleHudTemporarilyHidden();
    },

    toggleOverflow(): void {
      isOverflowOpen = !isOverflowOpen;
    },

    setFocusedWidget(widgetId: string | undefined): void {
      focusedWidgetId = widgetId;
    },

    handleFocusIn(event: FocusEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) {
        focusedWidgetId = undefined;
        return;
      }
      const host = target.closest<HTMLElement>('[data-hud-widget]');
      focusedWidgetId = host?.dataset.hudWidget;
    },

    stacksUpward(anchor: HudSlot): boolean {
      return anchor.startsWith('bottom');
    },

    showsOverflowInAnchor(anchor: HudSlot): boolean {
      return anchor === 'bottom-end' && view.layout.overflow.length > 0;
    },

    isVisible(widgetId: HudWidgetId): boolean {
      return isHudWidgetVisible(view.layout, widgetId);
    },

    widgetsInAnchor(anchor: HudSlot): readonly HudResolvedWidget[] {
      return view.layout.widgets.filter((widget) => widget.anchor === anchor);
    },
  };

  return view;
};
