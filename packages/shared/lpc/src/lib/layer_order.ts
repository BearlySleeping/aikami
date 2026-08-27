// packages/shared/lpc/src/lib/layer_order.ts
//
// Canonical direction-aware LPC layer-order table (C-430).
//
// This is the ONLY slot→depth mapping in the repo. Every renderer — game_world,
// character preview, dev sandbox — imports from here. No other file defines a
// slot-name→number map.
//
// ## Conventions
//
// - **Higher depth renders later (in front).** Depth 0 is the backmost known
//   layer; unknown slots resolve above every known slot.
// - **Unknown slots render on top and warn once.** An unrecognised slot name
//   resolves to depth `Number.MAX_SAFE_INTEGER` and logs a warning once per
//   distinct slot name (never per frame).
// - **Direction axis exists for all entries**, even where current data does not
//   vary by it. C-431 depends on this signature being in place.
// - **Sort stability.** `Array.prototype.sort` is stable in JS; two layers at
//   equal depth keep insertion order. This is intentional and documented.
// - **Behind-capable slots** (shield, cape, quiver, weapon) have a `behind`
//   depth that places them behind the body, and a `front` depth at their
//   normal position. The asset library encodes this as `_bg` / `_fg` variants.

import { logger } from '$logger';
import type { LpcLayerRole } from './slot_model.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical LPC slot identifiers. Extend here, nowhere else. */
export type LpcSlot =
  | 'cape'
  | 'body'
  | 'head'
  | 'eyes'
  | 'ears'
  | 'nose'
  | 'facial_hair'
  | 'legs'
  | 'feet'
  | 'torso'
  | 'belt'
  | 'arms'
  | 'shoulders'
  | 'hair'
  | 'hat'
  | 'weapon'
  | 'shield'
  | 'quiver'
  | 'accessory'
  | 'accessories'
  | 'headAccessories';

/**
 * One resolved renderable layer. Supersedes the six fixed Appearance fields.
 */
export type LpcLayer = {
  slot: LpcSlot | string;
  /** Empty string = intentionally empty (C-400 convention, preserved). */
  assetId: string;
  /** Which side of the body this layer draws on. Defaults to 'front'. */
  layerRole: LpcLayerRole;
  /** 1024-byte palette LUT (256 RGBA pixels). */
  hexPalette: Uint8Array;
};

/**
 * The canonical order table. The ONLY slot→depth mapping in the repo.
 * Higher renders later (in front). Unknown slots resolve above every
 * known slot and log once.
 */
export type LpcLayerOrderEntry = {
  slot: LpcSlot;
  /** Depth per (layerRole, direction). Direction: 0=up, 1=left, 2=down, 3=right. */
  depth: Readonly<Record<LpcLayerRole, readonly [number, number, number, number]>>;
};

// ---------------------------------------------------------------------------
// Canonical order table
// ---------------------------------------------------------------------------

/**
 * Canonical back-to-front z-order for LPC character layers.
 *
 * Base layers keep their historical order (body → legs → feet → torso →
 * head → hair); equipment layers append above them (shoulders above torso,
 * hat above hair, weapon/shield in front).
 *
 * Behind-capable slots (shield, cape, quiver, weapon) have a `behind` depth
 * that places them behind the body, and a `front` depth at their normal
 * position. The behind depth is the same for all directions; C-431 will
 * introduce direction-specific behind assets.
 */
export const LPC_LAYER_ORDER: readonly LpcLayerOrderEntry[] = [
  // ── Behind-capable slots (render behind body when layerRole = 'behind') ──
  {
    slot: 'shield',
    depth: { behind: [-10, -10, -10, -10] as const, front: [80, 80, 80, 80] as const },
  },
  {
    slot: 'cape',
    depth: { behind: [-10, -10, -10, -10] as const, front: [60, 60, 60, 60] as const },
  },
  {
    slot: 'quiver',
    depth: { behind: [-10, -10, -10, -10] as const, front: [70, 70, 70, 70] as const },
  },
  {
    slot: 'weapon',
    depth: { behind: [-10, -10, -10, -10] as const, front: [80, 80, 80, 80] as const },
  },

  // ── Body and clothing (front only) ──
  { slot: 'body', depth: { behind: [0, 0, 0, 0] as const, front: [0, 0, 0, 0] as const } },
  { slot: 'legs', depth: { behind: [0, 0, 0, 0] as const, front: [10, 10, 10, 10] as const } },
  { slot: 'feet', depth: { behind: [0, 0, 0, 0] as const, front: [20, 20, 20, 20] as const } },
  { slot: 'torso', depth: { behind: [0, 0, 0, 0] as const, front: [30, 30, 30, 30] as const } },
  { slot: 'belt', depth: { behind: [0, 0, 0, 0] as const, front: [35, 35, 35, 35] as const } },
  { slot: 'arms', depth: { behind: [0, 0, 0, 0] as const, front: [36, 36, 36, 36] as const } },
  { slot: 'shoulders', depth: { behind: [0, 0, 0, 0] as const, front: [40, 40, 40, 40] as const } },

  // ── Head and face ──
  { slot: 'head', depth: { behind: [0, 0, 0, 0] as const, front: [50, 50, 50, 50] as const } },
  { slot: 'eyes', depth: { behind: [0, 0, 0, 0] as const, front: [51, 51, 51, 51] as const } },
  { slot: 'ears', depth: { behind: [0, 0, 0, 0] as const, front: [52, 52, 52, 52] as const } },
  { slot: 'nose', depth: { behind: [0, 0, 0, 0] as const, front: [53, 53, 53, 53] as const } },
  {
    slot: 'facial_hair',
    depth: { behind: [0, 0, 0, 0] as const, front: [54, 54, 54, 54] as const },
  },
  { slot: 'hair', depth: { behind: [0, 0, 0, 0] as const, front: [60, 60, 60, 60] as const } },
  { slot: 'hat', depth: { behind: [0, 0, 0, 0] as const, front: [70, 70, 70, 70] as const } },

  // ── Accessories ──
  {
    slot: 'accessories',
    depth: { behind: [0, 0, 0, 0] as const, front: [75, 75, 75, 75] as const },
  },
  {
    slot: 'headAccessories',
    depth: { behind: [0, 0, 0, 0] as const, front: [76, 76, 76, 76] as const },
  },
  { slot: 'accessory', depth: { behind: [0, 0, 0, 0] as const, front: [77, 77, 77, 77] as const } },
] as const;

// ---------------------------------------------------------------------------
// Depth resolution
// ---------------------------------------------------------------------------

/** Set of slot names already warned for unknown-slot fallback. */
const _loggedUnknownSlots = new Set<string>();

/** Resets the unknown-slot warn dedup (tests / hot reload). */
export const resetUnknownSlotWarnings = (): void => {
  _loggedUnknownSlots.clear();
};

/**
 * Resolves the render depth for a given slot, layer role, and direction.
 *
 * Unknown slots resolve above every known slot (depth = max known + 10)
 * and log a warning once per distinct slot name.
 *
 * @param options.slot - The slot name.
 * @param options.layerRole - Behind or front.
 * @param options.direction - 0=up, 1=left, 2=down, 3=right.
 * @returns The render depth (higher = in front).
 */
export const resolveLayerDepth = (options: {
  slot: string;
  layerRole: LpcLayerRole;
  direction: number;
}): number => {
  const { slot, layerRole, direction } = options;

  const entry = LPC_LAYER_ORDER.find((e) => e.slot === slot);

  if (entry) {
    const depths = entry.depth[layerRole];
    return depths[direction] ?? depths[0];
  }

  // Unknown slot: render above every known slot.
  if (!_loggedUnknownSlots.has(slot)) {
    _loggedUnknownSlots.add(slot);
    logger.warn('lpc-layer-order:unknown-slot', {
      slot,
      hint: 'Slot not found in canonical LPC_LAYER_ORDER — rendered on top. Add it to LPC_LAYER_ORDER to control its depth.',
    });
  }

  // Return max known depth + 10 so it renders above everything.
  const maxKnownDepth = Math.max(
    ...LPC_LAYER_ORDER.map((e) => Math.max(...e.depth.front, ...e.depth.behind)),
  );
  return maxKnownDepth + 10;
};

/**
 * Returns the max known depth from the canonical table.
 * Used for default/fallback z-ordering.
 */
export const getMaxKnownDepth = (): number =>
  Math.max(...LPC_LAYER_ORDER.map((e) => Math.max(...e.depth.front, ...e.depth.behind)));

/**
 * Sorts an array of layers in render order (back-to-front).
 * Stable sort — layers at equal depth keep insertion order.
 */
export const sortLayersByDepth = <T extends { slot: string; layerRole?: LpcLayerRole }>(
  layers: readonly T[],
  direction: number,
): T[] =>
  [...layers].sort((a, b) => {
    const zA = resolveLayerDepth({
      slot: a.slot,
      layerRole: a.layerRole ?? 'front',
      direction,
    });
    const zB = resolveLayerDepth({
      slot: b.slot,
      layerRole: b.layerRole ?? 'front',
      direction,
    });
    return zA - zB;
  });
