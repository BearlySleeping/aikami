// scripts/src/lib/agents/resilience.ts
/**
 * Swarm resilience module (C-311.2.2).
 *
 * Extracted from swarm_director.ts: stall detection, exponential backoff,
 * retry policies, and heartbeat tracking. Used by step_executor.ts.
 */

import type { AgentRole, SwarmState } from './types';

// ── Types ──────────────────────────────────────────────────

/** Exponential backoff configuration. */
export type BackoffConfig = {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
};

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 50,
  maxDelayMs: 2000,
  maxRetries: 5,
} as const;

/** Sliding timeout barrier configuration. */
export type StreamTimeoutConfig = {
  readTimeoutMs: number;
  heartbeatIntervalMs: number;
  stallTimeoutMs: number;
};

export const DEFAULT_STREAM_CONFIG: StreamTimeoutConfig = {
  readTimeoutMs: 15_000,
  heartbeatIntervalMs: 5_000,
  stallTimeoutMs: 60_000,
} as const;

// ── Exponential backoff with jitter ────────────────────────

/**
 * Compute exponential backoff delay with random jitter.
 *
 * Formula: min(cap, base × 2^attempt) + random_jitter
 * Jitter prevents thundering herd on concurrent write retries.
 */
export const backoffDelay = (attempt: number, config: BackoffConfig = DEFAULT_BACKOFF): number => {
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return exponential + jitter;
};

/**
 * Retry an async operation with exponential backoff on error.
 *
 * Watch point: All retry loops handling OCC conflicts must use backoff jitter
 * to minimize write collisions across rapid execution cycles.
 */
export const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  options: {
    config?: BackoffConfig;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> => {
  const { config = DEFAULT_BACKOFF, shouldRetry } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === config.maxRetries) {
        break;
      }

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      const delay = backoffDelay(attempt, config);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
};

// ── Stall detection ────────────────────────────────────────

/**
 * Check for stalled agents based on heartbeat recency.
 *
 * Enforces a strict sliding timeout barrier — flags agents as
 * 'blocked' or 'unknown' if heartbeat is stale, safely unlocking
 * adjacent pipeline operations.
 */
export const detectStalledAgents = (
  state: SwarmState,
  heartbeatTimestamps: Record<AgentRole, number>,
  stallTimeoutMs: number = DEFAULT_STREAM_CONFIG.stallTimeoutMs,
): AgentRole[] => {
  const stalled: AgentRole[] = [];
  const now = Date.now();

  for (const [role, agent] of Object.entries(state.agents)) {
    if (agent.status !== 'working' && agent.status !== 'blocked') {
      continue;
    }

    const lastBeat = heartbeatTimestamps[role as AgentRole] ?? 0;
    if (now - lastBeat > stallTimeoutMs) {
      stalled.push(role as AgentRole);
    }
  }

  return stalled;
};

// ── Role-specific timeouts (AC-2: Trivial Path) ────────────

/** Role-specific timeout defaults per C-311.2.4 spec. */
export const ROLE_TIMEOUTS: Record<AgentRole, number> = {
  architect: 300_000, // Model loading + plan generation
  coder: 600_000, // Large contracts can take 5-10 minutes
  qa: 600_000, // Tests take time
  git: 120_000,
  review: 120_000,
} as const;
