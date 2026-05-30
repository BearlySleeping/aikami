// packages/backend/ai/src/lib/circuit-breaker.ts
import type { CircuitBreakerConfig } from './types.ts';

/**
 * Circuit breaker state.
 * - CLOSED: Normal operation, requests pass through.
 * - OPEN: Failures exceeded threshold, requests fail immediately.
 * - HALF_OPEN: Probing for recovery, limited requests allowed.
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker state machine for AI provider calls.
 *
 * After N consecutive failures, opens the circuit and fails fast
 * for a cooldown period. Then transitions to half-open to probe
 * for recovery.
 */
export class CircuitBreaker {
  private readonly _failureThreshold: number;
  private readonly _cooldownMs: number;
  private readonly _successThreshold: number;
  private readonly _halfOpenMaxMs: number;

  private _state: CircuitState = 'CLOSED';
  private _failureCount = 0;
  private _successCount = 0;
  private _openedAt = 0;

  constructor(config: CircuitBreakerConfig) {
    this._failureThreshold = config.failureThreshold;
    this._cooldownMs = config.cooldownMs;
    this._successThreshold = config.successThreshold;
    this._halfOpenMaxMs = config.halfOpenMaxMs;
  }

  /**
   * Called before making a provider call.
   * @returns `true` if the call is allowed, `false` if the circuit is open.
   */
  allowRequest(): boolean {
    if (this._state === 'CLOSED') {
      return true;
    }

    if (this._state === 'OPEN') {
      if (Date.now() - this._openedAt >= this._cooldownMs) {
        this._state = 'HALF_OPEN';
        this._successCount = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN — allow but with timeout
    if (Date.now() - this._openedAt >= this._halfOpenMaxMs) {
      // Half-open window expired without enough successes, re-open
      this._state = 'OPEN';
      this._openedAt = Date.now();
      return false;
    }

    return true;
  }

  /**
   * Record a successful call.
   */
  recordSuccess(): void {
    this._failureCount = 0;

    if (this._state === 'HALF_OPEN') {
      this._successCount++;
      if (this._successCount >= this._successThreshold) {
        this._state = 'CLOSED';
        this._successCount = 0;
      }
    }
  }

  /**
   * Record a failed call.
   */
  recordFailure(): void {
    this._failureCount++;

    if (this._state === 'CLOSED' && this._failureCount >= this._failureThreshold) {
      this._state = 'OPEN';
      this._openedAt = Date.now();
    }

    if (this._state === 'HALF_OPEN') {
      this._state = 'OPEN';
      this._openedAt = Date.now();
      this._successCount = 0;
    }
  }

  /** Current circuit state. */
  get state(): CircuitState {
    return this._state;
  }

  /** Consecutive failure count. */
  get failureCount(): number {
    return this._failureCount;
  }
}
