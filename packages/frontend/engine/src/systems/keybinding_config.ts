// packages/frontend/engine/src/systems/keybinding_config.ts
//
// Shared keybinding configuration consumed by both the settings UI
// (SettingsControlsViewModel) and the game engine (input_system).
// Bindings are persisted to localStorage as JSON.
//
// Contract: C-327 AC-1 — overlay action IDs added; keyToAction exported.
import type { Direction } from '../types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key shared between settings UI and game engine. */
export const KEYBINDING_STORAGE_KEY = 'aikami:settings:keybindings';

/** All action IDs — movement + overlay. */
export type InputActionId =
  | 'move_up'
  | 'move_down'
  | 'move_left'
  | 'move_right'
  | 'interact'
  | 'open_inventory'
  | 'open_quest_log'
  | 'open_character'
  | 'open_menu';

/** Action IDs that map to movement directions. */
export const MOVEMENT_ACTION_IDS = ['move_up', 'move_down', 'move_left', 'move_right'] as const;

/** Overlay (non-movement) action IDs. */
export const OVERLAY_ACTION_IDS = [
  'interact',
  'open_inventory',
  'open_quest_log',
  'open_character',
  'open_menu',
] as const;

/** Maps action IDs to engine Direction values. */
const ACTION_TO_DIRECTION: Record<string, Direction> = {
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_up: 'up',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_down: 'down',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_left: 'left',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_right: 'right',
};

// ---------------------------------------------------------------------------
// Keybinding record type
// ---------------------------------------------------------------------------

/** Stored keybinding map: actionId → key name (e.g. "w", "ArrowUp"). */
export type KeybindingMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default keybindings used when localStorage is empty. */
export const DEFAULT_KEYBINDINGS: KeybindingMap = {
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_up: 'w',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_down: 's',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_left: 'a',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  move_right: 'd',
  interact: 'e',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  open_inventory: 'i',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  open_quest_log: 'q',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  open_character: 'c',
  // biome-ignore lint/style/useNamingConvention: action IDs are snake_case constants
  open_menu: 'Escape',
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Loads keybindings from localStorage, falling back to defaults.
 * Returns a mutable copy so callers don't accidentally mutate the reference.
 */
export const loadKeybindings = (): KeybindingMap => {
  try {
    const stored = localStorage.getItem(KEYBINDING_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Invalid data — use defaults
  }
  return { ...DEFAULT_KEYBINDINGS };
};

// ---------------------------------------------------------------------------
// Direction mapping (engine-side)
// ---------------------------------------------------------------------------

/**
 * Looks up the engine {@link Direction} for a keyboard event key,
 * using the stored keybindings (or defaults if storage is empty).
 *
 * @param key - The `event.key` value from a KeyboardEvent.
 * @returns The matching Direction, or `undefined` if not bound.
 */
export const keyToDirection = (key: string): Direction | undefined => {
  const bindings = loadKeybindings();
  for (const actionId of MOVEMENT_ACTION_IDS) {
    const boundKey = bindings[actionId];
    if (boundKey && boundKey.toLowerCase() === key.toLowerCase()) {
      return ACTION_TO_DIRECTION[actionId];
    }
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Action → key reverse lookup (client-side)
// ---------------------------------------------------------------------------

/**
 * Builds a reverse lookup map: key name (lowercase) → action id.
 *
 * Returns a mutable Map so callers (e.g. InputActionService) can refresh
 * it when bindings change. Keys are normalised to lowercase.
 *
 * @param bindings - The active keybinding map (from loadKeybindings or cache).
 * @returns A Map keyed by lowercase key name (e.g. "e", "escape") to action id.
 */
export const buildKeyToAction = (bindings: KeybindingMap): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [actionId, key] of Object.entries(bindings)) {
    map.set(key.toLowerCase(), actionId);
  }
  return map;
};
