// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_preview.svelte.ts
//
// C-528 AC-3 — the editor's fixture preview.
//
// 🔴 A fixture, not a second engine. It resolves the DRAFT through the SAME
// resolver the live HUD uses, against a fixed relevance list, and never applies
// the overlay-hidden policy: the editor is a paused surface, so blanking the
// preview would make it useless. What the player arranges is therefore exactly
// what they will see, with no drift between the board and the game.
//
// The relevance lists are the one piece of invented state here, and they exist
// so `contextual` widgets can be seen in each of their three modes. A widget
// that is idle in the selected fixture is drawn on the board marked inactive —
// it is NOT absent. The resolver files idle-contextual alongside hidden in its
// `inactive` bucket, and treating that bucket as "removed" is what used to make
// a widget appear to vanish when the player merely changed tabs.

import type { HudUserPreferences } from '@aikami/schemas';
import type { HudWidgetId } from '@aikami/types';
import type { HudResolvedLayout, HudViewport } from '$lib/utils/hud/hud_layout_policy.ts';
import { resolveGameHudLayout } from '../hud_layout_bridge.ts';

/** The fixture contexts the editor can preview. Presentation only. */
export const HUD_PREVIEW_CONTEXTS = ['explore', 'dialogue', 'combat'] as const;

export type HudPreviewContext = (typeof HUD_PREVIEW_CONTEXTS)[number];

/** Which widgets a fixture context makes relevant. Presentation fixtures only. */
const PREVIEW_RELEVANCE: Readonly<Record<HudPreviewContext, readonly HudWidgetId[]>> = {
  explore: ['objective', 'interaction', 'party-status', 'clock', 'onboarding-hint'],
  dialogue: ['objective', 'interaction'],
  combat: ['interaction', 'hotbar', 'party-status'],
};

/** Everything the preview resolves against, read fresh on every layout access. */
export type HudEditorPreviewInput = {
  readonly preferences: HudUserPreferences;
  readonly capabilities: readonly string[];
  readonly viewport: HudViewport;
  readonly textScale: number;
};

/** The editor's fixture context and what it resolves to. */
export type HudEditorPreview = {
  readonly context: HudPreviewContext;
  readonly contexts: readonly HudPreviewContext[];
  setContext(context: HudPreviewContext): void;
  readonly layout: HudResolvedLayout;
};

/**
 * Creates the preview for one editor session.
 *
 * `read` is a callback rather than a value so every read sees the CURRENT
 * draft: the draft lives in the preference authority and is replaced wholesale
 * on each dispatch, so a snapshot taken once would go stale on the first edit.
 */
export const createHudEditorPreview = (read: () => HudEditorPreviewInput): HudEditorPreview => {
  let context = $state<HudPreviewContext>('explore');
  return {
    get context(): HudPreviewContext {
      return context;
    },
    get contexts(): readonly HudPreviewContext[] {
      return HUD_PREVIEW_CONTEXTS;
    },
    setContext(next: HudPreviewContext): void {
      context = next;
    },
    get layout(): HudResolvedLayout {
      const input = read();
      return resolveGameHudLayout({
        preferences: input.preferences,
        capabilities: input.capabilities,
        overlay: 'NONE',
        isTransitioning: false,
        isTemporarilyHidden: false,
        focusedWidgetIds: [],
        relevantWidgetIds: PREVIEW_RELEVANCE[context],
        pendingWidgetIds: [],
        viewport: input.viewport,
        textScale: input.textScale,
      });
    },
  };
};
