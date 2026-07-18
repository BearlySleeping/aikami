// apps/frontend/client/src/lib/services/game/input_action_service.svelte.ts
//
// Semantic input action layer — maps physical inputs (keyboard keys via
// keybinding map; standard-layout gamepad buttons) to InputActionIds.
// Tracks the last-used device so prompts switch between keyboard key
// labels and gamepad glyphs.
//
// Contract: C-327 AC-1, AC-5

import {
  DEVICE_SWITCH_DEBOUNCE_MS,
  GAMEPAD_AXIS_THRESHOLD,
  GAMEPAD_BUTTON_TO_ACTION,
  GAMEPAD_DPAD_TO_ACTION,
  gamepadActionLabel,
  type InputDevice,
  keyToDisplayLabel,
} from '@aikami/constants';
import {
  buildKeyToAction,
  DEFAULT_KEYBINDINGS,
  KEYBINDING_STORAGE_KEY,
  loadKeybindings,
} from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputActionServiceInterface = BaseFrontendClassInterface & {
  /** Currently active input device (keyboard/gamepad). */
  readonly device: InputDevice;
  /** Whether the gamepad is actively in use this frame. */
  readonly isGamepadActive: boolean;

  /** Resolves the action ID for a keyboard event key. */
  keyToAction(key: string): string | undefined;
  /** Returns the bound key for a given action ID. */
  actionToKey(actionId: string): string;
  /** Returns the display label for the given action (keyboard or gamepad). */
  actionDisplayLabel(actionId: string): string;
  /** Called by the game loop to poll gamepad state. */
  pollGamepad(): void;
  /** Called on keydown to update device tracking. */
  onKeyDown(): void;
  /** Refreshes the keybinding cache from localStorage. */
  refreshBindings(): void;
  /** Processes gamepad input and returns the list of active action IDs. */
  getActiveGamepadActions(): string[];
};

export type InputActionServiceOptions = BaseFrontendClassOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class InputActionService
  extends BaseFrontendClass<InputActionServiceOptions>
  implements InputActionServiceInterface
{
  device = $state<InputDevice>('keyboard');
  isGamepadActive = $state<boolean>(false);

  private _keyToActionMap = new Map<string, string>();
  private _bindings = { ...DEFAULT_KEYBINDINGS };
  private _lastDeviceSwitchTime = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: reserved for future dpad edge-trigger detection
  private _previousDpadState: number[] = [];
  private _previousButtonState: Array<{ pressed: boolean }> = [];
  private _previousAxisValues: number[] = [];

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    this.refreshBindings();
    this._loadPreviousGamepadState();
  }

  // ── Public API ──

  /** Resolves the action ID for a keyboard event key (lowercase). */
  keyToAction(key: string): string | undefined {
    return this._keyToActionMap.get(key.toLowerCase());
  }

  /** Returns the bound key for a given action ID. */
  actionToKey(actionId: string): string {
    return this._bindings[actionId] ?? actionId;
  }

  /** Returns the display label for the given action (keyboard or gamepad glyph). */
  actionDisplayLabel(actionId: string): string {
    if (this.device === 'gamepad') {
      return gamepadActionLabel(actionId);
    }
    return keyToDisplayLabel(this._bindings[actionId] ?? actionId);
  }

  /** Refreshes the keybinding cache from localStorage. */
  refreshBindings(): void {
    this._bindings = loadKeybindings();
    this._keyToActionMap = buildKeyToAction(this._bindings);
  }

  /** Called on `keydown` to mark keyboard as active device. */
  onKeyDown(): void {
    this._switchToDevice('keyboard');
  }

  /**
   * Polls `navigator.getGamepads()` and returns active gamepad actions.
   *
   * Should be called on the UI rAF loop (not in the engine). Tracks
   * button/axis transitions to detect activity and trigger device switches.
   */
  pollGamepad(): void {
    const gamepads = navigator.getGamepads();
    let hasActivity = false;

    for (const gp of gamepads) {
      if (!gp) {
        continue;
      }
      const gamepad = gp; // non-null after guard

      // Buttons
      for (let i = 0; i < gamepad.buttons.length; i++) {
        const btn = gamepad.buttons[i];
        // Detect press — any pressed button counts as gamepad activity
        if (btn && btn.pressed) {
          hasActivity = true;
        }
        // Store for next frame
        this._previousButtonState[i] = { pressed: btn?.pressed ?? false };
      }

      // Axes
      for (let i = 0; i < gamepad.axes.length; i++) {
        const value = gamepad.axes[i];
        if (Math.abs(value ?? 0) > GAMEPAD_AXIS_THRESHOLD) {
          hasActivity = true;
        }
        this._previousAxisValues[i] = value ?? 0;
      }
    }

    if (hasActivity) {
      this.isGamepadActive = true;
      this._switchToDevice('gamepad');
    } else {
      this.isGamepadActive = false;
    }
  }

  /** Returns active gamepad action IDs for this frame. */
  getActiveGamepadActions(): string[] {
    const actions: string[] = [];
    const gamepads = navigator.getGamepads();

    for (const gp of gamepads) {
      if (!gp) {
        continue;
      }
      const gamepad = gp; // non-null after guard

      // Button actions
      for (let i = 0; i < gamepad.buttons.length; i++) {
        const btn = gamepad.buttons[i];
        if (btn && btn.pressed && GAMEPAD_BUTTON_TO_ACTION[i]) {
          actions.push(GAMEPAD_BUTTON_TO_ACTION[i]);
        }
      }

      // D-pad actions
      for (let i = 12; i <= 15; i++) {
        const btn = gamepad.buttons[i];
        if (btn && btn.pressed && GAMEPAD_DPAD_TO_ACTION[i]) {
          actions.push(GAMEPAD_DPAD_TO_ACTION[i]);
        }
      }

      // Left stick → movement (axis 0 = horizontal, 1 = vertical)
      const axisX = gamepad.axes[0] ?? 0;
      const axisY = gamepad.axes[1] ?? 0;

      if (Math.abs(axisY) > GAMEPAD_AXIS_THRESHOLD) {
        actions.push(axisY < 0 ? 'move_up' : 'move_down');
      }
      if (Math.abs(axisX) > GAMEPAD_AXIS_THRESHOLD) {
        actions.push(axisX < 0 ? 'move_left' : 'move_right');
      }
    }

    return [...new Set(actions)];
  }

  // ── Private helpers ──

  /**
   * Switches the tracked device with debounce to prevent rapid flapping.
   *
   * @param target - The device to switch to.
   */
  private _switchToDevice(target: InputDevice): void {
    if (this.device === target) {
      return;
    }
    const now = performance.now();
    if (now - this._lastDeviceSwitchTime < DEVICE_SWITCH_DEBOUNCE_MS) {
      return;
    }
    this._lastDeviceSwitchTime = now;
    this.device = target;
    this.debug('device-switch', { device: target });
  }

  /** Loads prior gamepad state buffers. */
  private _loadPreviousGamepadState(): void {
    const gamepads = navigator.getGamepads();
    for (const gamepad of gamepads) {
      if (!gamepad) {
        continue;
      }
      this._previousButtonState = [];
      for (let i = 0; i < gamepad.buttons.length; i++) {
        this._previousButtonState[i] = { pressed: false };
      }
      this._previousAxisValues = new Array(gamepad.axes.length).fill(0);
      this._previousDpadState = new Array(4).fill(0);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const inputActionService: InputActionServiceInterface = InputActionService.create({
  className: 'InputActionService',
}) as InputActionServiceInterface;
