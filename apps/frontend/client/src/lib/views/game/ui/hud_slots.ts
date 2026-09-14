// apps/frontend/client/src/lib/views/game/ui/hud_slots.ts
//
// C-527 — named HUD slots with stable geometry.
//
// The previous HUD let each fixed child own its own viewport coordinates
// (`absolute top-16 left-4`, `absolute top-3 right-3`, …), which made overlap
// and reflow failures a per-widget accident. Slots invert that: the layout owns
// a small set of named regions, each widget is assigned to exactly one, and a
// widget can never invent a new coordinate.
//
// Inert data plus pure lookups — safe to unit test without a DOM.

/** The named regions of the play HUD. */
export type HudSlot = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end';

/** The HUD widgets that occupy a slot. */
export type HudWidgetId =
  | 'player-status'
  | 'system-notice'
  | 'menu'
  | 'objective'
  | 'hotbar'
  | 'interaction';

/** Slot geometry. Stable strings — asserted by the unit test. */
export const HUD_SLOT_CLASS: Readonly<Record<HudSlot, string>> = {
  'top-start': 'absolute top-3 left-3',
  'top-end': 'absolute top-3 right-3',
  'bottom-start': 'absolute bottom-3 left-3',
  'bottom-center': 'absolute bottom-3 left-1/2 -translate-x-1/2',
  'bottom-end': 'absolute bottom-3 right-3',
};

/**
 * Which slot each widget occupies.
 *
 * - player/party status and system notices share the top row (start / end)
 * - the labeled Menu entry sits top-end beside the notices
 * - one objective sits bottom-start, above nothing else
 * - hotbar and contextual interaction share the bottom-centre region
 */
export const HUD_WIDGET_SLOT: Readonly<Record<HudWidgetId, HudSlot>> = {
  'player-status': 'top-start',
  'system-notice': 'top-end',
  menu: 'top-end',
  objective: 'bottom-start',
  hotbar: 'bottom-center',
  interaction: 'bottom-center',
};

/** Every slot in layout order (top row first, then bottom row). */
export const HUD_SLOT_ORDER: readonly HudSlot[] = [
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-center',
  'bottom-end',
];

/** The slot a widget is assigned to. Throws only for a programming error (unknown id). */
export const hudWidgetSlot = (widget: HudWidgetId): HudSlot => {
  const slot = HUD_WIDGET_SLOT[widget];
  if (!slot) {
    throw new Error(`Unknown HUD widget: ${String(widget)}`);
  }
  return slot;
};

/** Position classes for a HUD widget (geometry only, no pointer-event policy). */
export const hudWidgetPositionClass = (widget: HudWidgetId): string =>
  HUD_SLOT_CLASS[hudWidgetSlot(widget)];
