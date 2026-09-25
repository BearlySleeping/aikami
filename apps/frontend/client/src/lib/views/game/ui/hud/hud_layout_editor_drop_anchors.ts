// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_drop_anchors.ts
//
// C-528 — which of the editor board's five regions this drag may actually use.
//
// Split out of the editor ViewModel so the size budget stays honest and so the
// rule lives in one place: a region is droppable when the REGISTRY lets this
// widget live there AND the resolver's own viewport policy still has that
// region. Neither half is cosmetic — a region that fails either test used to
// refuse the drop in silence, which from the board is indistinguishable from a
// drag that simply does not work.

import type { HudSlot, HudWidgetId } from '@aikami/types';
import {
  HUD_ANCHOR_ORDER,
  type HudViewport,
  isHudAnchorAvailable,
} from '$lib/utils/hud/hud_layout_policy.ts';
import { allowedHudAnchors } from '$lib/utils/hud/hud_layout_state.ts';

/** One drop region on the editor board, and whether this drag may use it. */
export type HudEditorDropAnchor = {
  readonly anchor: HudSlot;
  readonly label: string;
  /** The registry lets this widget occupy the region at all. */
  readonly allowed: boolean;
  /** The region exists in the current viewport. */
  readonly available: boolean;
  /** Both of the above: the only regions a drop here will actually move to. */
  readonly droppable: boolean;
};

/**
 * Human names for the five regions.
 *
 * "bottom-end" is resolver vocabulary, not a player's; the status line and the
 * region tooltips speak the language the live HUD does.
 */
export const HUD_EDITOR_DROP_ANCHOR_LABELS: Readonly<Record<HudSlot, string>> = {
  'top-start': 'Top left',
  'top-end': 'Top right',
  'bottom-start': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-end': 'Bottom right',
};

/** Annotates every board region for the widget currently being dragged. */
export const hudEditorDropAnchors = (options: {
  readonly widgetId: HudWidgetId | undefined;
  readonly viewport: HudViewport;
}): readonly HudEditorDropAnchor[] => {
  const allowed = new Set<HudSlot>(options.widgetId ? allowedHudAnchors(options.widgetId) : []);
  return HUD_ANCHOR_ORDER.map((anchor) => {
    const isAllowed = allowed.has(anchor);
    const isAvailable = isHudAnchorAvailable(options.viewport, anchor);
    return {
      anchor,
      label: HUD_EDITOR_DROP_ANCHOR_LABELS[anchor],
      allowed: isAllowed,
      available: isAvailable,
      droppable: isAllowed && isAvailable,
    };
  });
};

/**
 * Why a drop on this region would be refused, or `undefined` when it is fine.
 *
 * Returned as a sentence rather than a boolean so every refusal the board can
 * produce has a matching explanation — the difference between "nothing
 * happened" and "that region is spoken for".
 */
export const hudEditorDropRefusal = (options: {
  readonly widgetId: HudWidgetId;
  readonly viewport: HudViewport;
  readonly anchor: HudSlot;
}): string | undefined => {
  const label = HUD_EDITOR_DROP_ANCHOR_LABELS[options.anchor];
  if (!allowedHudAnchors(options.widgetId).includes(options.anchor)) {
    return `${label} is reserved for other HUD surfaces.`;
  }
  if (!isHudAnchorAvailable(options.viewport, options.anchor)) {
    return `${label} does not exist at this window size. Widen the window to use it.`;
  }
  return undefined;
};
