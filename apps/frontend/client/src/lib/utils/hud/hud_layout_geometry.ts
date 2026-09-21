// apps/frontend/client/src/lib/utils/hud/hud_layout_geometry.ts
//
// C-528 — the HUD resolver's geometry.
//
// Split out of `hud_layout_policy.ts` so the policy keeps its reviewed size
// budget. Everything here is pure arithmetic over viewport pixels: anchor
// regions, the three disjoint columns that make overlap impossible, stack
// placement and box stacking. No state, no DOM, no services.
//
// Contract: C-528 AC-1, AC-5.

import { HUD_COMPACT_MAX_WIDTH, HUD_SAFE_INSET, HUD_STACK_GAP } from '@aikami/constants';
import type { HudSlot } from '@aikami/types';
import type { HudResolvedWidget, HudViewport, HudViewportClass } from './hud_layout_policy.ts';

/** Anchors in layout order (top row first, then bottom row). */
export const HUD_ANCHOR_ORDER: readonly HudSlot[] = [
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-center',
  'bottom-end',
];

/** Anchor geometry. Stable strings — the slot wrappers in the view use these. */
export const HUD_ANCHOR_CLASS: Readonly<Record<HudSlot, string>> = {
  'top-start': 'absolute top-3 left-3',
  'top-end': 'absolute top-3 right-3',
  'bottom-start': 'absolute bottom-3 left-3',
  'bottom-center': 'absolute bottom-3 left-1/2 -translate-x-1/2',
  'bottom-end': 'absolute bottom-3 right-3',
};

/** The stack direction inside one anchor: top anchors grow down, bottom anchors grow up. */
export const HUD_ANCHOR_STACK_DIRECTION: Readonly<Record<HudSlot, 'down' | 'up'>> = {
  'top-start': 'down',
  'top-end': 'down',
  'bottom-start': 'up',
  'bottom-center': 'up',
  'bottom-end': 'up',
};

/** Position class for an anchor (geometry only, no pointer-event policy). */
export const hudAnchorClass = (anchor: HudSlot): string => HUD_ANCHOR_CLASS[anchor];

/** An axis-aligned box in viewport pixels. */
export type HudRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Anchors available in each viewport class.
 *
 * Availability is driven by WIDTH, not by the class: a 1280×720 window is a
 * short viewport (compact scale ceiling, tighter stacks) but it still has room
 * for all five regions. Collapsing `bottom-start` on any window under 800px
 * tall would hide the objective behind the overflow entry on the most common
 * laptop sizes — a regression, not a reflow.
 */
export const availableAnchors = (
  viewport: HudViewport,
  viewportClass: HudViewportClass,
): readonly HudSlot[] => {
  if (viewportClass === 'touch') {
    return ['top-end', 'bottom-center'];
  }
  if (viewport.width < HUD_COMPACT_MAX_WIDTH) {
    // Narrow: the bottom-end region is the first to go; the objective stays.
    return ['top-start', 'top-end', 'bottom-start', 'bottom-center'];
  }
  return ['top-start', 'top-end', 'bottom-start', 'bottom-center', 'bottom-end'];
};

/**
 * Horizontal share of the usable width each anchor column owns.
 *
 * The three columns are disjoint by construction (start 0…0.33, centre
 * 0.33…0.67, end 0.67…1), which is what makes "no two placed widgets overlap"
 * a property of the geometry rather than something a screenshot has to confirm.
 */
const ANCHOR_COLUMN_SHARE = { start: 0.33, center: 0.34, end: 0.33 } as const;

/** Usable content width (viewport minus the safe inset on both sides). */
const usableWidth = (viewport: HudViewport): number =>
  Math.max(0, viewport.width - HUD_SAFE_INSET * 2);

/** Maximum width a widget may occupy in one anchor column. */
export const anchorColumnWidth = (viewport: HudViewport, anchor: HudSlot): number => {
  const usable = usableWidth(viewport);
  if (anchor === 'bottom-center') {
    return usable * ANCHOR_COLUMN_SHARE.center;
  }
  if (anchor === 'top-start' || anchor === 'bottom-start') {
    return usable * ANCHOR_COLUMN_SHARE.start;
  }
  return usable * ANCHOR_COLUMN_SHARE.end;
};

/** Available stack height for one anchor. */
export const anchorAvailableHeight = (viewport: HudViewport): number =>
  Math.max(0, (viewport.height - HUD_SAFE_INSET * 2) * 0.4);

export const roundPixels = (value: number): number => Math.round(value * 100) / 100;

/**
 * Places the reserved widgets of one anchor into boxes.
 *
 * Widgets are stacked in `order` (then registry priority) and the stack grows
 * away from the anchor edge, so two widgets in the same anchor can never
 * overlap.
 */
export const stackAnchor = (options: {
  readonly anchor: HudSlot;
  readonly entries: readonly HudResolvedWidget[];
  readonly viewport: HudViewport;
  readonly viewportClass: HudViewportClass;
}): readonly HudResolvedWidget[] => {
  const direction = HUD_ANCHOR_STACK_DIRECTION[options.anchor];
  let cursor = HUD_SAFE_INSET;
  const placed: HudResolvedWidget[] = [];
  for (const entry of options.entries) {
    const width = roundPixels(entry.minWidth);
    const height = roundPixels(entry.minHeight);
    const x = roundPixels(anchorX(options.anchor, options.viewport, width));
    const y =
      direction === 'down'
        ? roundPixels(cursor)
        : roundPixels(options.viewport.height - cursor - height);
    cursor += height + HUD_STACK_GAP;
    placed.push({ ...entry, rect: { x, y, width, height } });
  }
  return placed;
};

const anchorX = (anchor: HudSlot, viewport: HudViewport, width: number): number => {
  if (anchor === 'top-start' || anchor === 'bottom-start') {
    return HUD_SAFE_INSET;
  }
  if (anchor === 'top-end' || anchor === 'bottom-end') {
    return viewport.width - HUD_SAFE_INSET - width;
  }
  return (viewport.width - width) / 2;
};

export const emptyRect: HudRect = { x: 0, y: 0, width: 0, height: 0 };
