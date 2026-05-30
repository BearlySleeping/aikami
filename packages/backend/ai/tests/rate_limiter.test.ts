// packages/backend/ai/tests/rate-limiter.test.ts
import { describe, expect, it } from 'bun:test';
import { TokenBucketRateLimiter } from '../src/lib/rate_limiter.ts';

describe('TokenBucketRateLimiter', () => {
  describe('basic rate limiting', () => {
    it('allows requests up to maxRequests', () => {
      const limiter = new TokenBucketRateLimiter({
        maxRequests: 5,
        windowMs: 1000,
      });

      for (let index = 0; index < 5; index++) {
        expect(limiter.tryConsume()).toBe(true);
      }
    });

    it('rejects requests beyond maxRequests', () => {
      const limiter = new TokenBucketRateLimiter({
        maxRequests: 3,
        windowMs: 1000,
      });

      for (let index = 0; index < 3; index++) {
        expect(limiter.tryConsume()).toBe(true);
      }

      expect(limiter.tryConsume()).toBe(false);
    });

    it('allows exactly maxTokens requests in burst', () => {
      const limiter = new TokenBucketRateLimiter({
        maxRequests: 100,
        windowMs: 60000,
        maxTokens: 10,
        refillRate: 0.1,
      });

      // Should allow up to 10 in burst (maxTokens)
      for (let index = 0; index < 10; index++) {
        expect(limiter.tryConsume()).toBe(true);
      }

      expect(limiter.tryConsume()).toBe(false);
    });
  });

  describe('configuration', () => {
    it('uses maxRequests as maxTokens when maxTokens is not provided', () => {
      const limiter = new TokenBucketRateLimiter({
        maxRequests: 10,
        windowMs: 1000,
      });

      for (let index = 0; index < 10; index++) {
        expect(limiter.tryConsume()).toBe(true);
      }
      expect(limiter.tryConsume()).toBe(false);
    });

    it('computes refillRate from maxRequests and windowMs', () => {
      const limiter = new TokenBucketRateLimiter({
        maxRequests: 60,
        windowMs: 60000,
      });

      // Full bucket = 60 tokens initially
      for (let index = 0; index < 60; index++) {
        expect(limiter.tryConsume()).toBe(true);
      }
      expect(limiter.tryConsume()).toBe(false);
    });
  });
});
