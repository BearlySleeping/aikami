// apps/frontend/hub/src/lib/views/lpc_preview/__tests__/lpc_preview_state.test.ts
//
// Guards the hub's pure LPC preview-state derivation: tag → asset id, and
// asset → initial layer composition (required defaults + requested component).

import { describe, expect, test } from 'bun:test';
import type { LpcSlotDef } from '@aikami/frontend-preview';
import { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import { buildLpcPreviewState, lpcAssetIdFromTag } from '../lpc_preview_state.ts';

const SLOTS: readonly LpcSlotDef[] = [
  {
    slot: 'body',
    label: 'Body',
    variants: [
      { label: 'Male', assetId: 'body/bodies_male' },
      { label: 'Female', assetId: 'body/bodies_female' },
    ],
  },
  {
    slot: 'hair',
    label: 'Hair',
    variants: [
      { label: 'Bangs', assetId: 'hair/bangs_adult' },
      { label: 'Long', assetId: 'hair/long_adult' },
    ],
  },
  {
    slot: 'head',
    label: 'Head',
    variants: [{ label: 'Human Male', assetId: 'head/heads/human_male' }],
  },
  {
    slot: 'torso',
    label: 'Torso',
    variants: [{ label: 'Chainmail', assetId: 'torso/chainmail_male' }],
  },
];

describe('lpcAssetIdFromTag', () => {
  test('derives the catalog asset id from a stateful LPC tag', () => {
    expect(lpcAssetIdFromTag('lpc:body:bodies_male:walk')).toBe('body/bodies_male');
    expect(lpcAssetIdFromTag('lpc:hair:bangs:adult:slash')).toBe('hair/bangs/adult');
  });

  test('returns undefined for tags that are not LPC-shaped', () => {
    expect(lpcAssetIdFromTag('lpc:hair:bangs_adult')).toBeUndefined();
    expect(lpcAssetIdFromTag('maps:village')).toBeUndefined();
  });
});

describe('buildLpcPreviewState', () => {
  test('seeds every required slot from the catalog defaults', () => {
    const state = buildLpcPreviewState({ allSlots: SLOTS });
    const indices = state.layers.map((layer) => layer.slotDefIndex);
    // head (2), body (0), torso (3) — the schema's required-slot order.
    expect(indices).toEqual([2, 0, 3]);
    expect(state.layers.every((layer) => layer.variantIndex === 0)).toBe(true);
    expect(state.state).toBe(LpcAnimationState.Walk);
    expect(state.direction).toBe(LpcDirection.Down);
    expect(state.paletteOverrides.size).toBe(0);
  });

  test('applies a requested required-slot component at its catalog index', () => {
    const state = buildLpcPreviewState({
      allSlots: SLOTS,
      targetAssetId: 'body/bodies_female',
    });
    const bodyLayer = state.layers.find((layer) => layer.slotDefIndex === 0);
    expect(bodyLayer?.variantIndex).toBe(1);
    // The other required slots keep their defaults.
    expect(state.layers).toHaveLength(3);
  });

  test('adds a requested non-required component as an extra layer', () => {
    const state = buildLpcPreviewState({
      allSlots: SLOTS,
      targetAssetId: 'hair/long_adult',
    });
    expect(state.layers).toHaveLength(4);
    expect(state.layers[3]).toEqual({ slotDefIndex: 1, variantIndex: 1 });
  });

  test('ignores an unknown target asset id and still renders the defaults', () => {
    const state = buildLpcPreviewState({
      allSlots: SLOTS,
      targetAssetId: 'hair/does_not_exist',
    });
    // Unknown variant falls back to index 0 rather than dropping the layer.
    expect(state.layers[3]).toEqual({ slotDefIndex: 1, variantIndex: 0 });
  });
});
