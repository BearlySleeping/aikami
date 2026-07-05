// apps/frontend/client/src/lib/types/connection.ts
//
// Connection data model types (C-230). Client-local — not shared across
// project boundaries since connections are only persisted in localStorage.

import type { GenParamPreset } from '@aikami/constants';

/** Unique connection identifier. */
export type ConnectionId = string;

/**
 * Named provider+model+parameter profile that can be assigned per-chat
 * or used as a global default. API keys are encrypted at rest via
 * crypto_vault.
 */
export type Connection = {
  /** Unique identifier (crypto.randomUUID()). */
  id: ConnectionId;
  /** Human-readable name (e.g. "Claude Opus (Work)", "Local Ollama"). */
  name: string;
  /** Provider identifier matching TEXT_PROVIDERS entries. */
  provider: string;
  /** API key for the provider (encrypted at rest). */
  apiKey: string;
  /** Custom endpoint override (empty = provider default). */
  baseUrl: string;
  /** Model identifier (e.g. "anthropic/claude-3-opus"). */
  model: string;
  /** Generation parameter overrides for this connection. */
  generationParams: GenParamPreset['params'];
  /** Whether this is the default connection. */
  isDefault: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

/** Result of a connection test request. */
export type ConnectionTestResult = {
  /** Whether the connection succeeded. */
  ok: boolean;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** Number of available models (if returned by the endpoint). */
  modelCount?: number;
  /** Error message if the test failed. */
  error?: string;
};
