// packages/backend/ai/tests/circuit-breaker.test.ts
import { describe, expect, it } from 'bun:test';
import { CircuitBreaker } from '../src/lib/circuit_breaker.ts';

describe('CircuitBreaker', () => {
  const defaultConfig = {
    failureThreshold: 3,
    cooldownMs: 5000,
    successThreshold: 2,
    halfOpenMaxMs: 10000,
  };

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const breaker = new CircuitBreaker(defaultConfig);
      expect(breaker.state).toBe('CLOSED');
    });

    it('allows requests when CLOSED', () => {
      const breaker = new CircuitBreaker(defaultConfig);
      expect(breaker.allowRequest()).toBe(true);
    });
  });

  describe('failure tracking', () => {
    it('tracks consecutive failures', () => {
      const breaker = new CircuitBreaker(defaultConfig);
      expect(breaker.failureCount).toBe(0);

      breaker.recordFailure();
      expect(breaker.failureCount).toBe(1);

      breaker.recordFailure();
      expect(breaker.failureCount).toBe(2);
    });

    it('resets failure count on success', () => {
      const breaker = new CircuitBreaker(defaultConfig);

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.failureCount).toBe(2);

      breaker.recordSuccess();
      expect(breaker.failureCount).toBe(0);
    });
  });

  describe('circuit opening', () => {
    it('opens after failureThreshold consecutive failures', () => {
      const breaker = new CircuitBreaker(defaultConfig);
      expect(breaker.state).toBe('CLOSED');

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.state).toBe('OPEN');
    });

    it('does not open before failureThreshold is reached', () => {
      const breaker = new CircuitBreaker(defaultConfig);

      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.state).toBe('CLOSED');
    });

    it('rejects requests when OPEN', () => {
      const breaker = new CircuitBreaker(defaultConfig);

      for (let index = 0; index < 3; index++) {
        breaker.recordFailure();
      }

      expect(breaker.allowRequest()).toBe(false);
    });
  });

  describe('success resets', () => {
    it('does not open if successes intersperse failures', () => {
      const breaker = new CircuitBreaker(defaultConfig);

      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordFailure();

      // Failure count reset by success, so never hits threshold
      expect(breaker.state).toBe('CLOSED');
      expect(breaker.failureCount).toBe(1);
    });
  });

  describe('half-open state', () => {
    it('allows requests in half-open (after cooldown)', () => {
      // Use zero cooldown to skip the timer
      const breaker = new CircuitBreaker({
        ...defaultConfig,
        cooldownMs: 0,
      });

      // Open the circuit
      for (let index = 0; index < 3; index++) {
        breaker.recordFailure();
      }
      expect(breaker.state).toBe('OPEN');

      // Cooldown is 0, so immediate transition to HALF_OPEN
      expect(breaker.allowRequest()).toBe(true);
      expect(breaker.state).toBe('HALF_OPEN');
    });

    it('closes after successThreshold successes in half-open', () => {
      const breaker = new CircuitBreaker({
        ...defaultConfig,
        cooldownMs: 0,
      });

      // Open the circuit
      for (let index = 0; index < 3; index++) {
        breaker.recordFailure();
      }

      // Transition to HALF_OPEN
      breaker.allowRequest();
      expect(breaker.state).toBe('HALF_OPEN');

      // Successes in half-open
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.state).toBe('CLOSED');
    });

    it('re-opens on failure during half-open', () => {
      const breaker = new CircuitBreaker({
        ...defaultConfig,
        cooldownMs: 0,
      });

      // Open the circuit
      for (let index = 0; index < 3; index++) {
        breaker.recordFailure();
      }

      // Transition to HALF_OPEN
      breaker.allowRequest();
      expect(breaker.state).toBe('HALF_OPEN');

      // Fail during half-open → re-open
      breaker.recordFailure();
      expect(breaker.state).toBe('OPEN');
    });
  });
});
