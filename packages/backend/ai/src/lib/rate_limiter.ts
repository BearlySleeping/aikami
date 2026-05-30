// packages/backend/ai/src/lib/rate-limiter.ts
import type { RateLimiterConfig } from './types.ts';

/**
 * Token-bucket rate limiter for AI provider API calls.
 *
 * Prevents 429 errors by tracking request rates and rejecting
 * calls that would exceed the configured limits.
 */
export class TokenBucketRateLimiter {
  private readonly _maxTokens: number;
  private readonly _refillRate: number;
  private _tokens: number;
  private _lastRefill: number;

  constructor(config: RateLimiterConfig) {
    this._maxTokens = config.maxTokens ?? config.maxRequests;
    this._refillRate = config.refillRate ?? config.maxRequests / (config.windowMs / 1000);
    this._tokens = this._maxTokens;
    this._lastRefill = Date.now();
  }

  /**
   * Attempt to consume a token. Returns true if allowed, false if rate limited.
   */
  tryConsume(): boolean {
    this._refill();
    if (this._tokens >= 1) {
      this._tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Wait until a token is available, then consume it.
   */
  async waitAndConsume(): Promise<void> {
    while (!this.tryConsume()) {
      const waitMs = Math.ceil((1 / this._refillRate) * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private _refill(): void {
    const now = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;
    const refill = elapsed * this._refillRate;
    this._tokens = Math.min(this._maxTokens, this._tokens + refill);
    this._lastRefill = now;
  }
}
