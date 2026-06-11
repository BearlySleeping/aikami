// apps/frontend/client/src/lib/data/lpc_url_config.ts

/**
 * LPC URL configuration serialization — bidirectional mapping between
 * URLSearchParams and LPC layer/animation state.
 *
 * Used by both the dev component route (read+write) and the lite route
 * (read-only). The encoding uses compact positional keys:
 *
 *   l<N>=<slotDefIndex>:<variantIndex>    — layer N config
 *   p<N>:<paletteIndex>=<hex>             — palette colour for layer N
 *   state=<number>                         — LpcAnimationState value
 *   dir=<number>                           — LpcDirection value
 *   frame=<number>                         — current animation frame
 *   playing=<0|1>                          — playback state
 *   zoom=<number>                          — canvas scale factor
 *
 * @module lpc_url_config
 */

import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialisable snapshot of a single layer's configuration. */
export type LpcLayerUrlEntry = {
  /** Index into ALL_LPC_SLOTS for the slot type. */
  slotDefIndex: number;
  /** Index into the slot's variants array. */
  variantIndex: number;
};

/** Full LPC state serialisable to/from URL search parameters. */
export type LpcUrlState = {
  /** Ordered layer entries. */
  layers: LpcLayerUrlEntry[];
  /**
   * Sparse palette overrides: `${layerIndex}:${paletteIndex}` → 6-char hex.
   * Only non-default entries are serialised to keep URLs compact.
   */
  paletteOverrides: Map<string, string>;
  /** Animation state enum value. */
  state: LpcAnimationState;
  /** Facing direction enum value. */
  direction: LpcDirection;
  /** Current animation frame (0-based). */
  frame: number;
  /** Whether playback ticker is active. */
  playing: boolean;
  /** Canvas scale factor. */
  zoom: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_LAYER_PREFIX = 'l';
const KEY_PALETTE_PREFIX = 'p';
const KEY_STATE = 'state';
const KEY_DIRECTION = 'dir';
const KEY_FRAME = 'frame';
const KEY_PLAYING = 'playing';
const KEY_ZOOM = 'zoom';

/** Valid LpcAnimationState values for runtime membership checks. */
const VALID_ANIMATION_STATES = new Set(Object.values(LpcAnimationState) as number[]);

/** Valid LpcDirection values for runtime membership checks. */
const VALID_DIRECTIONS = new Set(Object.values(LpcDirection) as number[]);

/** Default values used when params are absent. */
const DEFAULT_LPC_URL_STATE: LpcUrlState = {
  layers: [],
  paletteOverrides: new Map(),
  state: LpcAnimationState.Walk,
  direction: LpcDirection.Down,
  frame: 0,
  playing: false,
  zoom: 1,
};

// ---------------------------------------------------------------------------
// Serialise: LpcUrlState → URLSearchParams
// ---------------------------------------------------------------------------

/**
 * Encodes LPC state into URLSearchParams.
 *
 * Only non-default values are written to keep URLs compact.
 * Palette overrides are sparse-written (only indices that differ
 * from the global default palette).
 *
 * @param state - Full LPC state snapshot.
 * @returns URLSearchParams ready for SvelteKit navigation.
 */
export const lpcStateToSearchParams = (state: LpcUrlState): URLSearchParams => {
  const params = new URLSearchParams();

  // Layers
  for (let i = 0; i < state.layers.length; i++) {
    const layer = state.layers[i];
    if (layer === undefined) {
      continue;
    }
    params.set(`${KEY_LAYER_PREFIX}${i}`, `${layer.slotDefIndex}:${layer.variantIndex}`);
  }

  // Palette overrides
  for (const [key, hex] of state.paletteOverrides) {
    params.set(`${KEY_PALETTE_PREFIX}${key}`, hex);
  }

  // Animation — only write if different from defaults
  if (state.state !== DEFAULT_LPC_URL_STATE.state) {
    params.set(KEY_STATE, String(state.state));
  }
  if (state.direction !== DEFAULT_LPC_URL_STATE.direction) {
    params.set(KEY_DIRECTION, String(state.direction));
  }
  if (state.frame !== DEFAULT_LPC_URL_STATE.frame) {
    params.set(KEY_FRAME, String(state.frame));
  }
  if (state.playing !== DEFAULT_LPC_URL_STATE.playing) {
    params.set(KEY_PLAYING, state.playing ? '1' : '0');
  }
  if (state.zoom !== DEFAULT_LPC_URL_STATE.zoom) {
    params.set(KEY_ZOOM, String(state.zoom));
  }

  return params;
};

// ---------------------------------------------------------------------------
// Deserialise: URLSearchParams → LpcUrlState
// ---------------------------------------------------------------------------

/**
 * Decodes URLSearchParams into LPC state with defaults for absent keys.
 *
 * Layer entries are parsed from `l0`, `l1`, ... keys in positional order.
 * Palette overrides are parsed from `p<layerIndex>:<paletteIndex>` keys.
 *
 * @param params - URLSearchParams from the current page URL.
 * @returns Parsed LpcUrlState with defaults for missing values.
 */
export const searchParamsToLpcState = (params: URLSearchParams): LpcUrlState => {
  const state: LpcUrlState = {
    layers: [],
    paletteOverrides: new Map(),
    state: DEFAULT_LPC_URL_STATE.state,
    direction: DEFAULT_LPC_URL_STATE.direction,
    frame: DEFAULT_LPC_URL_STATE.frame,
    playing: DEFAULT_LPC_URL_STATE.playing,
    zoom: DEFAULT_LPC_URL_STATE.zoom,
  };

  // Parse layers — scan for l0, l1, ... until a missing key
  for (let i = 0; ; i++) {
    const raw = params.get(`${KEY_LAYER_PREFIX}${i}`);
    if (raw === null) {
      break;
    }

    const parts = raw.split(':');
    const slotDefIndex = Number.parseInt(parts[0] ?? '', 10);
    const variantIndex = Number.parseInt(parts[1] ?? '', 10);

    if (Number.isNaN(slotDefIndex) || Number.isNaN(variantIndex)) {
      continue;
    }

    state.layers.push({ slotDefIndex, variantIndex });
  }

  // Parse palette overrides
  for (const [key, value] of params) {
    if (!key.startsWith(KEY_PALETTE_PREFIX)) {
      continue;
    }

    const suffix = key.slice(KEY_PALETTE_PREFIX.length);
    // Validate hex: 6-char uppercase hex without #
    if (/^[0-9A-Fa-f]{6}$/.test(value) && suffix.includes(':')) {
      state.paletteOverrides.set(suffix, value.toUpperCase());
    }
  }

  // Parse scalar animation params
  const rawState = params.get(KEY_STATE);
  if (rawState !== null) {
    const parsed = Number.parseInt(rawState, 10);
    if (!Number.isNaN(parsed) && VALID_ANIMATION_STATES.has(parsed)) {
      state.state = parsed as LpcAnimationState;
    }
  }

  const rawDir = params.get(KEY_DIRECTION);
  if (rawDir !== null) {
    const parsed = Number.parseInt(rawDir, 10);
    if (!Number.isNaN(parsed) && VALID_DIRECTIONS.has(parsed)) {
      state.direction = parsed as LpcDirection;
    }
  }

  const rawFrame = params.get(KEY_FRAME);
  if (rawFrame !== null) {
    const parsed = Number.parseInt(rawFrame, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      state.frame = parsed;
    }
  }

  const rawPlaying = params.get(KEY_PLAYING);
  if (rawPlaying !== null) {
    state.playing = rawPlaying === '1';
  }

  const rawZoom = params.get(KEY_ZOOM);
  if (rawZoom !== null) {
    const parsed = Number.parseFloat(rawZoom);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 10) {
      state.zoom = parsed;
    }
  }

  return state;
};

/**
 * Creates a minimal default LPC URL state with two layers (body + hair).
 *
 * Used as the initial state when no URL params are present on the dev page.
 *
 * @returns A default LpcUrlState with body and hair layers.
 */
export const createDefaultLpcUrlState = (): LpcUrlState => {
  return {
    ...DEFAULT_LPC_URL_STATE,
    layers: [
      { slotDefIndex: 0, variantIndex: 0 }, // body: humanoid male light
      { slotDefIndex: 2, variantIndex: 0 }, // hair: mohawk
    ],
  };
};
