// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_input.ts
//
// C-528 AC-2 — the editor's input vocabulary, as data.
//
// 🔴 These tables are the ONLY place a key or a button index is turned into an
// intent. Keeping them here rather than in the ViewModel is what makes the
// parity claim checkable: a new device is a new row in a table, and the claim
// "keyboard and controller reach the same configuration" is a test over the
// mapping instead of a reading of two switch statements that must be kept in
// sync by hand.
//
// The map stops at INTENT, not at commands. Turning an intent into a command is
// the ViewModel's job, because only it knows the selection; keeping the
// translation in one place per device is what stops "each method can reach the
// same valid configuration" from decaying into three implementations.

/** What a key press means to the editor. */
export type HudEditorKeyIntent =
  | 'previous-widget'
  | 'next-widget'
  | 'move-left'
  | 'move-right'
  | 'reorder-up'
  | 'reorder-down'
  | 'scale-up'
  | 'scale-down'
  | 'cycle-visibility'
  | 'toggle-hidden'
  | 'hide-only'
  | 'close';

/** What a controller button press means to the editor. */
export type HudEditorGamepadAction =
  | 'next-widget'
  | 'previous-widget'
  | 'move-left'
  | 'move-right'
  | 'reorder-up'
  | 'reorder-down'
  | 'scale-up'
  | 'scale-down'
  | 'cycle-visibility'
  | 'toggle-hidden'
  | 'undo'
  | 'redo'
  | 'confirm'
  | 'cancel';

/**
 * Raw keys mapped to intents. `Escape` and `Tab` are resolved before this
 * table, because their meaning depends on modifier and drag state.
 *
 * A Map rather than an object literal: the keys are the DOM's own key names,
 * which are PascalCase by specification and are not ours to rename.
 */
const KEY_INTENTS = new Map<string, HudEditorKeyIntent>([
  ['ArrowLeft', 'move-left'],
  ['ArrowRight', 'move-right'],
  ['ArrowUp', 'reorder-up'],
  ['ArrowDown', 'reorder-down'],
  ['+', 'scale-up'],
  ['=', 'scale-up'],
  ['-', 'scale-down'],
  ['_', 'scale-down'],
  ['v', 'cycle-visibility'],
  ['h', 'toggle-hidden'],
  ['Delete', 'hide-only'],
  ['Backspace', 'hide-only'],
]);

/**
 * The intent a key press means, or `undefined` when the editor should ignore it.
 *
 * 🔴 Looked up TWICE: once as the browser reports it, and once lowercased. The
 * table is written with structural key names (`ArrowRight`, `Delete`) because
 * lowercasing those produces names no browser emits, and the letter bindings
 * are stored lowercase so Caps Lock does not matter. Matching only one of the
 * two silently unbinds every arrow key, which is exactly the sort of failure
 * that looks like "the keyboard path is a bit off" rather than a dead binding.
 *
 * Unmodified chords are deliberately not bound — the browser and the game
 * already own them.
 */
export const hudEditorKeyIntent = (event: {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}): HudEditorKeyIntent | undefined => {
  if (event.key === 'Escape') {
    return 'close';
  }
  if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) {
    return undefined;
  }
  if (event.key === 'Tab') {
    return event.shiftKey === true ? 'previous-widget' : 'next-widget';
  }
  return KEY_INTENTS.get(event.key) ?? KEY_INTENTS.get(event.key.toLowerCase());
};

/** Standard gamepad button indices used by the editor's mapping. */
const GAMEPAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  back: 8,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const GAMEPAD_ACTIONS: Readonly<Record<number, HudEditorGamepadAction>> = {
  [GAMEPAD_BUTTON.dpadLeft]: 'move-left',
  [GAMEPAD_BUTTON.dpadRight]: 'move-right',
  [GAMEPAD_BUTTON.dpadUp]: 'reorder-up',
  [GAMEPAD_BUTTON.dpadDown]: 'reorder-down',
  [GAMEPAD_BUTTON.rb]: 'next-widget',
  [GAMEPAD_BUTTON.lb]: 'previous-widget',
  [GAMEPAD_BUTTON.a]: 'cycle-visibility',
  [GAMEPAD_BUTTON.b]: 'cancel',
  [GAMEPAD_BUTTON.y]: 'toggle-hidden',
  [GAMEPAD_BUTTON.start]: 'confirm',
  [GAMEPAD_BUTTON.back]: 'undo',
};

/** The intent a controller button means, or `undefined` when it is not bound. */
export const hudEditorGamepadAction = (buttonIndex: number): HudEditorGamepadAction | undefined =>
  GAMEPAD_ACTIONS[buttonIndex];

/** Controller polling interval (ms). Never a per-frame ticker. */
export const HUD_EDITOR_GAMEPAD_POLL_MS = 100;

/**
 * Which intents are refused while a widget is off the HUD, and how to say so.
 *
 * 🔴 A bare `undefined` means "applies to a hidden widget too", so a future
 * intent cannot become guarded by accident and a current one cannot silently
 * stop being guarded. The verbs are second person because the sentence is
 * addressed to the player, not describing a command. It lives here, beside the
 * tables it qualifies, because that is where the set of intents is defined.
 */
export const HUD_EDITOR_GUARDED_ACTIONS: Readonly<Partial<Record<HudEditorKeyIntent, string>>> = {
  'move-left': 'move',
  'move-right': 'move',
  'reorder-up': 'reorder',
  'reorder-down': 'reorder',
  'scale-up': 'scale',
  'scale-down': 'scale',
};

/**
 * An edge-triggered controller reader.
 *
 * 🔴 Polls on a timer rather than riding the render ticker: the editor is a
 * paused surface, and a per-frame poll would keep sampling a gamepad for a
 * menu nobody is using. Edge-triggering is what stops a held D-pad from
 * cycling the selected widget sixty times a second.
 */
export type HudEditorGamepadReader = {
  start(): void;
  stop(): void;
};

/**
 * Records one button's edge state and returns the intent a fresh press means.
 *
 * Edge-triggering is what stops a held D-pad from cycling the selection sixty
 * times a second, and returning the action from the same pass that records it
 * keeps the two from drifting apart.
 */
const consumeButton = (options: {
  readonly pressed: Set<number>;
  readonly index: number;
  readonly isDown: boolean;
}): HudEditorGamepadAction | undefined => {
  const { pressed, index, isDown } = options;
  if (!isDown) {
    pressed.delete(index);
    return undefined;
  }
  if (pressed.has(index)) {
    return undefined;
  }
  pressed.add(index);
  return hudEditorGamepadAction(index);
};

/** The first connected gamepad, if any. */
const firstGamepad = (): Gamepad | undefined => {
  const pads = navigator.getGamepads?.() ?? [];
  return Array.from(pads).find((pad) => pad !== null) ?? undefined;
};

/** Creates the reader one editor ViewModel owns for its lifetime. */
export const createHudEditorGamepadReader = (options: {
  readonly onAction: (action: HudEditorGamepadAction) => void;
}): HudEditorGamepadReader => {
  const pressed = new Set<number>();
  let timer: number | undefined;

  const poll = (): void => {
    const pad = firstGamepad();
    if (!pad) {
      // A pad disconnected mid-hold must not leave its buttons stuck down, or
      // reconnecting would fire one press for every button still held.
      pressed.clear();
      return;
    }
    for (const [index, button] of pad.buttons.entries()) {
      const action = consumeButton({ pressed, index, isDown: button.pressed });
      if (action) {
        options.onAction(action);
      }
    }
  };

  return {
    start: () => {
      if (typeof window === 'undefined' || timer !== undefined) {
        return;
      }
      timer = window.setInterval(poll, HUD_EDITOR_GAMEPAD_POLL_MS);
    },
    stop: () => {
      if (timer === undefined) {
        return;
      }
      window.clearInterval(timer);
      timer = undefined;
      pressed.clear();
    },
  };
};

/**
 * How far the pointer must travel before a press counts as a drag.
 *
 * Without it, simply clicking a chip flashes the whole drag presentation —
 * the ghost, the dimmed source, every hover highlight — for one frame. A
 * threshold makes "press" and "drag" different gestures, which is what lets
 * both the board and the row list stay drag sources without stealing clicks.
 */
export const HUD_EDITOR_DRAG_THRESHOLD_PX = 5;

/** The one model sentence the editor's help leads with. */
export const HUD_EDITOR_MODEL_SENTENCE =
  'Every widget lives in one of five regions or on the Hidden shelf. Drag a widget to move it, or to the Hidden shelf to remove it.';

/** Per-device control reference, shown behind a disclosure. */
export const HUD_EDITOR_CONTROL_LINES: readonly {
  readonly device: string;
  readonly keys: string;
}[] = [
  {
    device: 'Pointer',
    keys: 'Drag a chip on the board, or a row in the list, onto a region or onto the Hidden shelf. Every widget’s visibility button hides or restores it directly.',
  },
  {
    device: 'Keyboard',
    keys: 'Tab / Shift+Tab select a widget · arrows move it between regions · ↑ ↓ reorder it in its stack · + − scale it · V toggles always / when relevant · H hides or restores · Delete hides · Esc closes.',
  },
  {
    device: 'Controller',
    keys: 'Bumpers select a widget · D-pad moves and reorders it · A toggles always / when relevant · Y hides or restores · Back undoes · Start saves · B cancels.',
  },
];
