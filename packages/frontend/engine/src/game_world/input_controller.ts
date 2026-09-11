// packages/frontend/engine/src/game_world/input_controller.ts
//
// Keyboard input + global input-lock boundary.
//
// Owns the held-key set, the DOM keyboard/blur listeners, and the input-lock
// flag. It aggregates WASD/arrow state into a normalized velocity and hands
// that to the facade through a callback; it never touches the worker or
// PixiJS directly. Click-to-move and interaction discovery stay in the
// facade, which reacts to the `onInteract` / `onMovementStart` callbacks.
//
// Kept imperative and DOM-only so it can be unit-tested with a fake event
// target and driven deterministically.

import { keyToDirection } from '../systems/keybinding_config.ts';
import type { Direction } from '../types.ts';

/** Anything that can register/remove DOM event listeners (window, fake). */
export type InputTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export type InputControllerOptions = {
  /** Receives the aggregate, normalized, speed-scaled velocity. */
  onVelocity: (velocity: { x: number; y: number }) => void;
  /** Fired on the interact key while input is unlocked. */
  onInteract: () => void;
  /** Fired when a movement key is first pressed (cancel click-path). */
  onMovementStart: () => void;
  /** Optional throttled telemetry sink. */
  onTelemetry?: (label: string, detail: Record<string, unknown>) => void;
  /** Event target; defaults to `window` when available. */
  target?: InputTarget;
  /** Direction resolver override (tests); defaults to keybinding config. */
  resolveDirection?: (key: string) => Direction | undefined;
};

/** Base movement speed in pixels per second (matches input_system). */
const BASE_SPEED = 150;

/** Milliseconds between input telemetry logs. */
const TELEMETRY_INTERVAL_MS = 500;

/** Legacy arrow aliases — never rebindable, always the base direction. */
const LEGACY_ARROW_DIRECTION: Record<string, Direction> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

/** Direction → unit vector (base speed applied after normalization). */
const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export class InputController {
  private readonly _onVelocity: (velocity: { x: number; y: number }) => void;
  private readonly _onInteract: () => void;
  private readonly _onMovementStart: () => void;
  private readonly _onTelemetry:
    | ((label: string, detail: Record<string, unknown>) => void)
    | undefined;
  private readonly _resolveDirection: (key: string) => Direction | undefined;
  private readonly _target: InputTarget | undefined;

  private _locked = false;
  private readonly _activeKeys = new Set<string>();
  private _detach: (() => void) | undefined;
  private _lastTelemetryAt = 0;

  constructor(options: InputControllerOptions) {
    this._onVelocity = options.onVelocity;
    this._onInteract = options.onInteract;
    this._onMovementStart = options.onMovementStart;
    this._onTelemetry = options.onTelemetry;
    this._resolveDirection = options.resolveDirection ?? keyToDirection;
    this._target = options.target ?? (typeof window === 'undefined' ? undefined : window);
  }

  /** Whether movement input is currently suppressed. */
  get locked(): boolean {
    return this._locked;
  }

  /**
   * Registers the keyboard/blur listeners. Idempotent — a second call while
   * attached is a no-op, so recreation with the same target is safe.
   */
  attach(): void {
    const target = this._target;
    if (!target || this._detach) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => this._handleKeyDown(event);
    const onKeyUp = (event: KeyboardEvent): void => this._handleKeyUp(event);
    const onBlur = (): void => this._handleBlur();

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);

    this._detach = (): void => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  /** Removes listeners and forgets held keys. Idempotent. */
  detach(): void {
    this._activeKeys.clear();
    this._detach?.();
    this._detach = undefined;
  }

  /**
   * Sets the global input lock and always zeroes velocity on the transition
   * so movement does not stick across pause/unpause or overlay cycles.
   */
  setLocked(locked: boolean): void {
    this._locked = locked;
    this._onVelocity({ x: 0, y: 0 });
  }

  /** Clears held keys and zeroes velocity (key-state-poisoning guard). */
  flush(): void {
    this._activeKeys.clear();
    this._onVelocity({ x: 0, y: 0 });
  }

  private _handleKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();

    if (this._isInputField(event.target)) {
      return;
    }

    // Interaction key — only when input is not locked (DIALOGUE/MENU).
    if ((key === 'e' || key === 'enter') && !this._locked) {
      event.preventDefault();
      this._onInteract();
      return;
    }

    // Block movement keys when locked and force-stop velocity.
    if (this._locked) {
      this._activeKeys.clear();
      if (this._keyToMovementDirection(key)) {
        this._telemetry('[GameWorld] inputSuppressed:inputLocked', {
          key,
          reason: 'inputLocked',
        });
        this._updateVelocity();
      }
      return;
    }

    if (this._keyToMovementDirection(key)) {
      event.preventDefault();
      // C-380 AC-7: keyboard movement cancels the active click-path.
      this._onMovementStart();
      if (!this._activeKeys.has(key)) {
        this._activeKeys.add(key);
        this._updateVelocity();
      }
    }
  }

  private _handleKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (this._isInputField(event.target)) {
      return;
    }
    if (this._activeKeys.has(key)) {
      event.preventDefault();
      this._activeKeys.delete(key);
      this._updateVelocity();
    }
  }

  private _handleBlur(): void {
    this._activeKeys.clear();
    this._onVelocity({ x: 0, y: 0 });
  }

  /**
   * Resolves a key to a movement direction. Legacy arrows win unconditionally
   * (a rebind can never shadow them); configured bindings are consulted only
   * when no legacy alias exists.
   */
  private _keyToMovementDirection(key: string): Direction | undefined {
    return LEGACY_ARROW_DIRECTION[key] ?? this._resolveDirection(key);
  }

  private _updateVelocity(): void {
    let vx = 0;
    let vy = 0;

    for (const key of this._activeKeys) {
      const direction = this._keyToMovementDirection(key);
      if (!direction) {
        continue;
      }
      const delta = DIRECTION_DELTA[direction];
      vx += delta.dx;
      vy += delta.dy;
    }

    // Normalize diagonals so they match orthogonal speed.
    if (vx !== 0 && vy !== 0) {
      const length = Math.sqrt(vx * vx + vy * vy);
      vx /= length;
      vy /= length;
    }

    vx *= BASE_SPEED;
    vy *= BASE_SPEED;

    this._telemetry('[GameWorld] dispatchInputToWorker', {
      vector: { x: Math.round(vx), y: Math.round(vy) },
      activeKeys: [...this._activeKeys],
      inputLocked: this._locked,
    });

    this._onVelocity({ x: vx, y: vy });
  }

  private _isInputField(target: EventTarget | null): boolean {
    if (!target) {
      return false;
    }
    const element = target as { tagName?: string; isContentEditable?: boolean };
    return (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable === true
    );
  }

  private _telemetry(label: string, detail: Record<string, unknown>): void {
    const sink = this._onTelemetry;
    if (!sink) {
      return;
    }
    const now = performance.now();
    if (now - this._lastTelemetryAt <= TELEMETRY_INTERVAL_MS) {
      return;
    }
    this._lastTelemetryAt = now;
    sink(label, detail);
  }
}
