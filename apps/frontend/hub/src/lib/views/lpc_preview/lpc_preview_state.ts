// apps/frontend/hub/src/lib/views/lpc_preview/lpc_preview_state.ts
//
// Pure LPC preview-state helpers (no PixiJS, no Svelte). The hub's LPC
// preview view model uses these to turn a catalog tag into an
// `LpcPreviewState` with the requested component already applied to its slot.

import type { LpcPreviewState, LpcSlotDef } from '@aikami/frontend-preview';
import { LPC_PREVIEW_DEFAULT_ZOOM } from '@aikami/frontend-preview';
import { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import {
  LPC_DEFAULT_BODY_ASSET_ID,
  LPC_DEFAULT_HEAD_ASSET_ID,
  REQUIRED_LPC_SLOTS,
} from '@aikami/schemas';

/** Slots a complete character always needs, used to seed default layers. */
const REQUIRED_SLOTS: readonly string[] = REQUIRED_LPC_SLOTS;

/** Default zoom that makes a single character legible in the preview canvas. */
const DEFAULT_PREVIEW_ZOOM = LPC_PREVIEW_DEFAULT_ZOOM;

/**
 * Derives the `buildLpcCatalog` asset id from a catalog tag.
 *
 * Tag shape is `lpc:<slot>:<...path>:<state>`; the asset id drops the state
 * and joins the path with `/` (e.g. `lpc:hair:bangs_adult:walk` →
 * `hair/bangs_adult`). Returns undefined for tags that are not LPC-shaped.
 */
export const lpcAssetIdFromTag = (tag: string): string | undefined => {
  const parts = tag.split(':');
  if (parts.length < 4 || parts[0] !== 'lpc') {
    return undefined;
  }
  const slot = parts[1];
  const path = parts.slice(2, parts.length - 1).join('/');
  return `${slot}/${path}`;
};

/** Preferred default asset id for a slot, or undefined when there is none. */
const preferredAssetIdForSlot = (slot: string): string | undefined => {
  if (slot === 'head') {
    return LPC_DEFAULT_HEAD_ASSET_ID;
  }
  if (slot === 'body') {
    return LPC_DEFAULT_BODY_ASSET_ID;
  }
  return undefined;
};

/**
 * Builds the initial preview state for the character compositor.
 *
 * The required slots (head, body, torso) are always seeded so a full
 * character renders immediately; `targetAssetId` overrides its own slot and,
 * when that slot is not required, is added as an extra layer.
 */
export const buildLpcPreviewState = (options: {
  allSlots: readonly LpcSlotDef[];
  targetAssetId?: string;
}): LpcPreviewState => {
  const { allSlots, targetAssetId } = options;
  const layers: Array<{ slotDefIndex: number; variantIndex: number }> = [];

  const pushSlot = (slotName: string, preferAssetId?: string): void => {
    const slotDefIndex = allSlots.findIndex((slot) => slot.slot === slotName);
    if (slotDefIndex < 0) {
      return;
    }
    const variants = allSlots[slotDefIndex].variants;
    let variantIndex = 0;
    if (preferAssetId) {
      const found = variants.findIndex((variant) => variant.assetId === preferAssetId);
      if (found >= 0) {
        variantIndex = found;
      }
    }
    layers.push({ slotDefIndex, variantIndex });
  };

  const targetSlot = targetAssetId?.split('/')[0];

  for (const slotName of REQUIRED_SLOTS) {
    if (slotName === targetSlot) {
      pushSlot(slotName, targetAssetId);
    } else {
      pushSlot(slotName, preferredAssetIdForSlot(slotName));
    }
  }

  // Non-required target slots (hair, feet, legs, …) are layered on top.
  if (targetSlot && !REQUIRED_SLOTS.includes(targetSlot)) {
    pushSlot(targetSlot, targetAssetId);
  }

  return {
    layers,
    paletteOverrides: new Map(),
    state: LpcAnimationState.Walk,
    direction: LpcDirection.Down,
    frame: 0,
    playing: true,
    zoom: DEFAULT_PREVIEW_ZOOM,
  };
};
