// apps/frontend/client/src/lib/services/game/idle_detection_service.svelte.ts
//
// Idle detection service — tracks player inactivity via DOM events
// and exposes reactive idle state. Also manages per-session DND mode.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services';
import type { IdleDetectionServiceOptions } from '$types';
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
const _INPUT_THROTTLE_MS = 1000;

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
  extends BaseFrontendClass<IdleDetectionServiceOptions>
  implements IdleDetectionServiceInterface
{
  idleDurationMs = $state(0);
  isDnd = $state(false);
  lastInputAt = $state(Date.now());
  private _isPageVisible = $state(true);
  private _intervalHandle: ReturnType<typeof setInterval> | undefined;

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

  private _boundHandleInput = this._handleInput.bind(this);
  private _boundHandleVisibilityChange = this._handleVisibilityChange.bind(this);

  private _handleInput(): void {
    this.resetIdle();
  }

  private _handleVisibilityChange(): void {
    this._isPageVisible = document.visibilityState === 'visible';
    if (this._isPageVisible) {
      this.resetIdle();
    }
  }

  private _bindInputEvents(): void {
    for (const event of INPUT_EVENTS) {
      document.addEventListener(event, this._boundHandleInput, { passive: true });
    }
  }

  private _unbindInputEvents(): void {
    for (const event of INPUT_EVENTS) {
      document.removeEventListener(event, this._boundHandleInput);
    }
  }

  private _bindVisibilityChange(): void {
    document.addEventListener('visibilitychange', this._boundHandleVisibilityChange);
  }

  private _unbindVisibilityChange(): void {
    document.removeEventListener('visibilitychange', this._boundHandleVisibilityChange);
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
