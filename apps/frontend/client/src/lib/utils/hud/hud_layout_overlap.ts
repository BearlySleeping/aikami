// apps/frontend/client/src/lib/utils/hud/hud_layout_overlap.ts
//
// C-528 — the geometry invariant helpers for a resolved HUD layout.
//
// Split out of `hud_layout_policy.ts` so the resolver keeps its reviewed size
// budget. These are pure predicates over the resolver's own output: they exist
// so "no two placed widgets overlap at any supported viewport or text scale"
// (AC-5) is asserted against geometry rather than eyeballed in a screenshot.

import type { HudWidgetId } from '@aikami/types';
import type { HudRect, HudResolvedLayout } from './hud_layout_policy.ts';

/** Whether two boxes intersect. */
export const hudRectsOverlap = (left: HudRect, right: HudRect): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

/** Every pair of boxes that occupy space and intersect. Empty when the layout is sound. */
export const hudLayoutOverlaps = (
  layout: HudResolvedLayout,
): readonly (readonly [HudWidgetId, HudWidgetId])[] => {
  const occupying = layout.widgets.filter((widget) => widget.reserved);
  const overlaps: (readonly [HudWidgetId, HudWidgetId])[] = [];
  for (let left = 0; left < occupying.length; left += 1) {
    for (let right = left + 1; right < occupying.length; right += 1) {
      const a = occupying[left];
      const b = occupying[right];
      if (a && b && hudRectsOverlap(a.rect, b.rect)) {
        overlaps.push([a.widgetId, b.widgetId] as const);
      }
    }
  }
  return overlaps;
};
