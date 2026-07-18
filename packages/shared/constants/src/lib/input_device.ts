// packages/shared/constants/src/lib/input_device.ts
// biome-ignore-all lint/style/useNamingConvention: KeyboardEvent.key values and gamepad action IDs are Web API identifiers, not camelCase
//
// Input device and key label constants — device glyph labels and keyboard
// display-name normalisation for interaction prompts and onboarding hints.
// Contract: C-327 AC-1, AC-5

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

/** Last-used physical input device — drives prompt glyph selection. */
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

// ---------------------------------------------------------------------------
// Device debounce
// ---------------------------------------------------------------------------

/** Minimum time in ms between device switches to prevent glyph strobing (C-327 AC-5). */
export const DEVICE_SWITCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Keyboard display labels
// ---------------------------------------------------------------------------

/**
 * Normalises raw `KeyboardEvent.key` values to display labels.
 *
 * Maps special keys to human-readable labels (e.g. " " → "Space",
 * "ArrowUp" → "↑"). All other keys pass through unmodified.
 */
const KEYBOARD_DISPLAY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: '↵',
  Backspace: '⌫',
  Tab: 'Tab',
  CapsLock: 'Caps',
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Meta',
};

/**
 * Converts a raw keyboard key (from `KeyboardEvent.key`) to a display label.
 *
 * Falls back to the raw key string for unknown keys.
 *
 * @param key - The raw key value (e.g. " ", "ArrowUp", "e").
 * @returns The display label (e.g. "Space", "↑", "E").
 */
export const keyToDisplayLabel = (key: string): string => {
  const normalised = KEYBOARD_DISPLAY_LABELS[key];
  if (normalised) {
    return normalised;
  }
  // Single character keys: uppercase for display
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
};

// ---------------------------------------------------------------------------
// Gamepad glyph labels
// ---------------------------------------------------------------------------

/**
 * Maps input action IDs to standard-layout gamepad button labels.
 *
 * Uses Unicode glyphs suitable for DOM rendering. Based on the
 * standard Xbox / PS controller layout (south = A/Cross, start = Menu).
 */
const GAMEPAD_ACTION_LABELS: Record<string, string> = {
  move_up: '↑',
  move_down: '↓',
  move_left: '←',
  move_right: '→',
  interact: 'Ⓐ',
  open_inventory: '▤',
  open_quest_log: 'Ⓧ',
  open_menu: 'Ⓢ',
};

/**
 * Returns the gamepad glyph label for a given action ID.
 *
 * Falls back to the action ID itself for unmapped actions.
 *
 * @param actionId - The input action identifier.
 * @returns The gamepad glyph label (e.g. "Ⓐ").
 */
export const gamepadActionLabel = (actionId: string): string => {
  return GAMEPAD_ACTION_LABELS[actionId] ?? actionId;
};

// ---------------------------------------------------------------------------
// Gamepad button mapping
// ---------------------------------------------------------------------------

/**
 * Standard-layout gamepad button index → action ID mapping.
 *
 * Indices follow the Gamepad API's `buttons[]` array:
 * 0 = south (A / Cross), 1 = east (B / Circle), 2 = west (X / Square),
 * 3 = north (Y / Triangle), 8 = select, 9 = start, 12 = dpad up,
 * 13 = dpad down, 14 = dpad left, 15 = dpad right.
 */
export const GAMEPAD_BUTTON_TO_ACTION: Record<number, string> = {
  0: 'interact', // A / Cross (south)
  1: 'open_menu', // B / Circle (east) — secondary menu
  2: 'open_character', // X / Square (west)
  3: 'open_quest_log', // Y / Triangle (north)
  8: 'open_inventory', // Select / Share — inventory
  9: 'open_menu', // Start / Options — pause
};

/**
 * Gamepad dpad index → action ID mapping.
 */
export const GAMEPAD_DPAD_TO_ACTION: Record<number, string> = {
  12: 'move_up',
  13: 'move_down',
  14: 'move_left',
  15: 'move_right',
};

// ---------------------------------------------------------------------------
// Gamepad axis mapping
// ---------------------------------------------------------------------------

/**
 * Axis index → action pairs for left stick.
 *
 * Index 0 = horizontal (-1 left, +1 right), axis 1 = vertical (-1 up, +1 down).
 * Threshold avoids drift from resting stick values.
 */
export const GAMEPAD_AXIS_THRESHOLD = 0.3;
