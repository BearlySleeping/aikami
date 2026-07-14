// apps/frontend/client/src/lib/services/game/idle_detection_service.svelte.ts
//
// Idle detection service — tracks player inactivity via DOM events
// and exposes reactive idle state. Also manages per-session DND mode.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

// ── Types ────────────────────────────────────────────────────────────────

export type IdleDetectionServiceInterface = BaseFrontendClassInterface & {
  /** Milliseconds since last user input. Reactive $state. */
  readonly idleDurationMs: number;
  /** Whether DND mode is active. Reactive $state. */
  readonly isDnd: boolean;
  /** Timestamp of last user input. */
  readonly lastInputAt: number;

  /**
   * Checks if the player has been idle for at least `thresholdMs`.
   * When the page is not visible, always returns false.
   */
  isIdle(thresholdMs: number): boolean;

  /** Resets the idle timer (called on user input or DND toggle-off). */
  resetIdle(): void;

  /** Toggles or sets DND mode. When turned off, resets the idle timer. */
  setDnd(enabled: boolean): void;
};

// ── Constants ────────────────────────────────────────────────────────────

/** Throttle lastInputAt updates to once per second to avoid excessive $state writes. */
const INPUT_THROTTLE_MS = 1000;

/** Events that count as user input. */
const INPUT_EVENTS = [
  'pointermove',
  'keydown',
  'mousedown',
  'touchstart',
  'gamepadconnected',
] as const;

// ── Implementation ───────────────────────────────────────────────────────

class IdleDetectionService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements IdleDetectionServiceInterface
{
  idleDurationMs = $state(0);
  isDnd = $state(false);
  lastInputAt = $state(Date.now());
  private _isPageVisible = $state(true);
  private _intervalHandle: ReturnType<typeof setInterval> | undefined;
  private _lastThrottledInput = 0;

  // ── Initialization ──────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this._bindInputEvents();
    this._bindVisibilityChange();
    this._startIdleTracking();
  }

  // ── Teardown ────────────────────────────────────────────────────────

  destroy(): void {
    this._unbindInputEvents();
    this._unbindVisibilityChange();
    this._stopIdleTracking();
  }

  // ── Public API ──────────────────────────────────────────────────────

  isIdle(thresholdMs: number): boolean {
    if (!this._isPageVisible) {
      return false;
    }
    return this.idleDurationMs >= thresholdMs;
  }

  resetIdle(): void {
    this.lastInputAt = Date.now();
    this.idleDurationMs = 0;
  }

  setDnd(enabled: boolean): void {
    this.isDnd = enabled;
    if (!enabled) {
      this.resetIdle();
    }
  }

  // ── Private: Event binding ──────────────────────────────────────────

  private _handleInput = (): void => {
    const now = Date.now();
    if (now - this._lastThrottledInput < INPUT_THROTTLE_MS) {
      return;
    }
    this._lastThrottledInput = now;
    this.resetIdle();
  };

  private _bindInputEvents(): void {
    for (const event of INPUT_EVENTS) {
      document.addEventListener(event, this._handleInput, { passive: true });
    }
  }

  private _unbindInputEvents(): void {
    for (const event of INPUT_EVENTS) {
      document.removeEventListener(event, this._handleInput);
    }
  }

  private _handleVisibilityChange = (): void => {
    const wasHidden = !this._isPageVisible;
    this._isPageVisible = document.visibilityState === 'visible';

    // When tab becomes visible after being hidden, reset idle time
    if (wasHidden && this._isPageVisible) {
      this.debug('visibilityChange:tab-returned — resetting idle');
      this.resetIdle();
    }
  };

  private _bindVisibilityChange(): void {
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  private _unbindVisibilityChange(): void {
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
  }

  // ── Private: Idle tracking ──────────────────────────────────────────

  private _startIdleTracking(): void {
    // Update idleDurationMs every second
    this._intervalHandle = setInterval(() => {
      this.idleDurationMs = Date.now() - this.lastInputAt;
    }, 1000);
  }

  private _stopIdleTracking(): void {
    if (this._intervalHandle !== undefined) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = undefined;
    }
  }
}

export const idleDetectionService: IdleDetectionServiceInterface = IdleDetectionService.create({
  className: 'IdleDetectionService',
}) as IdleDetectionServiceInterface;
