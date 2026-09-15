// apps/frontend/client/src/lib/views/game/ui/hud_slots.ts
//
// C-527 introduced named HUD slots; C-528 made the widget registry the source of
// truth and moved all policy into `hud_layout_policy.ts`. This module is kept as
// the compatibility surface for the C-527 call sites: it forwards to the registry
// so a slot can still never be invented per widget.
//
// New code should import from `hud_layout_policy.ts` (or `@aikami/constants` for
// the registry itself) rather than from here.

import { HUD_WIDGET_REGISTRY } from '@aikami/constants';
import type { HudSlot, HudWidgetId } from '@aikami/types';
import {
  HUD_ANCHOR_CLASS,
  HUD_ANCHOR_ORDER,
  hudWidgetDefinition,
} from '$lib/utils/hud/hud_layout_policy.ts';

export type { HudSlot, HudWidgetId };

/** Slot geometry, forwarded from the resolver's anchor table. */
export const HUD_SLOT_CLASS: Readonly<Record<HudSlot, string>> = HUD_ANCHOR_CLASS;

/** Every slot in layout order (top row first, then bottom row). */
export const HUD_SLOT_ORDER: readonly HudSlot[] = HUD_ANCHOR_ORDER;

/** Which slot each registered widget defaults to. */
export const HUD_WIDGET_SLOT: Readonly<Record<HudWidgetId, HudSlot>> = Object.fromEntries(
  HUD_WIDGET_REGISTRY.map((widget) => [widget.id, widget.defaultAnchor]),
) as Readonly<Record<HudWidgetId, HudSlot>>;

/** The default slot a registered widget occupies. Throws only for a programming error. */
export const hudWidgetSlot = (widget: HudWidgetId): HudSlot => {
  const definition = hudWidgetDefinition(widget);
  if (!definition) {
    throw new Error(`Unknown HUD widget: ${String(widget)}`);
  }
  return definition.defaultAnchor;
};

/** Default position classes for a HUD widget (geometry only, no pointer-event policy). */
export const hudWidgetPositionClass = (widget: HudWidgetId): string =>
  HUD_SLOT_CLASS[hudWidgetSlot(widget)];
