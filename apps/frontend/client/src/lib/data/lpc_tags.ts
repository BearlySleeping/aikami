// apps/frontend/client/src/lib/data/lpc_tags.ts
//
// Pure helpers mapping LPC renderer assetIds + animation states to
// canonical manifest tags. Kept free of PixiJS/service imports so it is
// unit-testable in isolation.
//
// Contract: C-372

import { LpcAnimationState } from '$lib/data/lpc_models';

// ── State mapping ──────────────────────────────────────────────────────────

/** Animation state → spritesheet filename suffix. */
const STATE_SUFFIX: Record<number, string> = {
  [LpcAnimationState.Spellcast]: 'spellcast',
  [LpcAnimationState.Thrust]: 'thrust',
  [LpcAnimationState.Walk]: 'walk',
  [LpcAnimationState.Slash]: 'slash',
  [LpcAnimationState.Shoot]: 'shoot',
  [LpcAnimationState.Die]: 'hurt',
};

/**
 * Maps an LPC animation state to its spritesheet filename suffix.
 *
 * @param state - Numeric LpcAnimationState value.
 * @returns The filename suffix (e.g. "walk", "spellcast").
 */
export const lpcStateSuffix = (state: number): string => STATE_SUFFIX[state] ?? 'walk';

// ── Tag mapping ────────────────────────────────────────────────────────────

/** Canonical manifest tag for an LPC asset, e.g. "lpc:body:bodies_male:walk". */
export type LpcTag = `lpc:${string}`;

/**
 * Builds the canonical manifest tag for an LPC asset + animation state.
 *
 * assetIds use "/" (e.g. "hair/bangslong2/bg_adult"); manifest tags use ":".
 *
 * @example lpcTag('torso/aprons/apron_female', LpcAnimationState.Walk)
 *          → "lpc:torso:aprons:apron_female:walk"
 * @param assetId - Renderer asset ID (path segments joined with "/").
 * @param state - Numeric LpcAnimationState value.
 * @returns The manifest tag.
 */
export const lpcTag = (assetId: string, state: number): LpcTag =>
  `lpc:${assetId.replaceAll('/', ':')}:${lpcStateSuffix(state)}`;
