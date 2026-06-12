import { LpcAnimationState } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// LPC Asset Path Mapper
// ---------------------------------------------------------------------------

/** Base URL for LPC spritesheet assets relative to the static directory. */
const LPC_ASSET_BASE_PATH = '/lpc';

/**
 * Maps LpcAnimationState enum to the string used in split spritesheet filenames.
 */
export const LPC_STATE_FILE_MAP: Record<number, string> = {
  [LpcAnimationState.Spellcast]: 'spellcast',
  [LpcAnimationState.Thrust]: 'thrust',
  [LpcAnimationState.Walk]: 'walk',
  [LpcAnimationState.Slash]: 'slash',
  [LpcAnimationState.Shoot]: 'shoot',
  [LpcAnimationState.Die]: 'hurt',
};

/**
 * Resolves an LPC slot, assetId (relative path), and state to a static file URL.
 *
 * Path format: `/lpc/{slot}/{assetId}/{state}.png`
 *
 * @param slot - LPC layer slot name (e.g. 'body', 'hair').
 * @param assetId - Relative path string (e.g. 'human/male').
 * @param state - Animation state.
 * @returns The full static file URL path.
 */
export const getLpcAssetPath = (
  slot: string,
  assetId: string,
  state: LpcAnimationState,
): string => {
  const stateStr = LPC_STATE_FILE_MAP[state] ?? 'walk';
  return `${LPC_ASSET_BASE_PATH}/${slot}/${assetId}/${stateStr}.png`;
};

/**
 * Creates a placeholder PixiJS Texture for a missing LPC asset.
 *
 * @param slot - LPC layer slot name.
 * @param assetId - Asset ID string.
 * @returns A promise resolving to a PixiJS Texture.
 */
export const createPlaceholderTexture = async (_slot: string, _assetId: string) => {
  const { Texture } = await import('pixi.js');
  return Texture.EMPTY;
};
