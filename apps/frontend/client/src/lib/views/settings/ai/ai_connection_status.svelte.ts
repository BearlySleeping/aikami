// apps/frontend/client/src/lib/views/settings/ai/ai_connection_status.svelte.ts
//
// Settings-session-scoped, observable connection-test state shared by every AI
// settings surface. Previously each AiSettingsViewModel instance owned its own
// `testResults`/`testingIds`, so testing a connection on a capability detail
// page never updated the header badge (which read a different instance).
//
// This module holds ONLY the shared test facts. Editor drafts, visibility,
// model discovery, and provider/role editing stay local to each
// AiSettingsViewModel. The store is deliberately module-scoped to the settings
// UI; call `resetAiConnectionStatus()` when the settings session ends if a
// fresh session is required.

import type { ConnectionCapability, ConnectionId, ConnectionTestResult } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-capability connection status. Distinct, honest states — a
 * configured-but-never-tested connection must not read as reachable, and an
 * in-flight probe must not read as unconfigured.
 */
export type CapabilityStatus =
  | 'not_configured' // no connection exists for the capability
  | 'not_tested' // connection exists, but has never been verified
  | 'testing' // a verification probe is in flight
  | 'reachable' // last verification succeeded
  | 'unreachable'; // last verification failed

/** Minimal capability/status pair used by lightweight consumers (header badge). */
export type AiCapabilityStatus = {
  capability: ConnectionCapability;
  status: CapabilityStatus;
};

// ---------------------------------------------------------------------------
// Store (reactive)
// ---------------------------------------------------------------------------

let _testResults = $state<Record<string, ConnectionTestResult>>({});
let _testingIds = $state<Set<string>>(new Set());
/** Monotonic generation per connection — discards stale async probe results. */
const _generation: Record<string, number> = {};

export const aiConnectionStatus = {
  get testResults(): Record<string, ConnectionTestResult> {
    return _testResults;
  },

  get testingIds(): Set<string> {
    return _testingIds;
  },

  resultFor(connectionId: ConnectionId): ConnectionTestResult | undefined {
    return _testResults[connectionId];
  },

  isTesting(connectionId: ConnectionId): boolean {
    return _testingIds.has(connectionId);
  },

  /** Marks a probe in flight and returns its generation token. */
  begin(connectionId: ConnectionId): number {
    const generation = (_generation[connectionId] ?? 0) + 1;
    _generation[connectionId] = generation;
    const next = new Set(_testingIds);
    next.add(connectionId);
    _testingIds = next;
    return generation;
  },

  /** True when `generation` is still the newest probe for the connection. */
  isCurrent(connectionId: ConnectionId, generation: number): boolean {
    return _generation[connectionId] === generation;
  },

  /** Stores a probe result only if it belongs to the newest generation. */
  storeResult(
    connectionId: ConnectionId,
    generation: number,
    result: ConnectionTestResult,
  ): boolean {
    if (_generation[connectionId] !== generation) {
      return false;
    }
    _testResults = { ..._testResults, [connectionId]: result };
    return true;
  },

  /** Stores a result unconditionally (e.g. a verified draft on save). */
  setResult(connectionId: ConnectionId, result: ConnectionTestResult): void {
    _testResults = { ..._testResults, [connectionId]: result };
  },

  /** Clears the in-flight flag when a probe settles. */
  finish(connectionId: ConnectionId, generation: number): void {
    if (_generation[connectionId] !== generation) {
      return;
    }
    const next = new Set(_testingIds);
    next.delete(connectionId);
    _testingIds = next;
  },

  clear(connectionId: ConnectionId): void {
    if (connectionId in _testResults) {
      const { [connectionId]: _removed, ...rest } = _testResults;
      _testResults = rest;
    }
    if (_testingIds.has(connectionId)) {
      const next = new Set(_testingIds);
      next.delete(connectionId);
      _testingIds = next;
    }
    // Advance (never delete) the generation: an in-flight probe from before the
    // clear must not be able to write its pre-edit result back.
    _generation[connectionId] = (_generation[connectionId] ?? 0) + 1;
  },

  reset(): void {
    _testResults = {};
    _testingIds = new Set();
    for (const connectionId of Object.keys(_generation)) {
      _generation[connectionId] = (_generation[connectionId] ?? 0) + 1;
    }
  },
};

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

export const deriveCapabilityStatus = (options: {
  connection: { id: ConnectionId } | undefined;
  testResults: Record<string, ConnectionTestResult>;
  testingIds: Set<string>;
}): CapabilityStatus => {
  if (!options.connection) {
    return 'not_configured';
  }
  if (options.testingIds.has(options.connection.id)) {
    return 'testing';
  }
  const result = options.testResults[options.connection.id];
  if (!result) {
    return 'not_tested';
  }
  return result.ok ? 'reachable' : 'unreachable';
};

export const capabilityStatusColor = (status: CapabilityStatus): string => {
  if (status === 'reachable') {
    return 'text-success';
  }
  if (status === 'unreachable') {
    return 'text-error';
  }
  if (status === 'testing') {
    return 'text-warning';
  }
  return 'text-base-content/40';
};

export const capabilityStatusDot = (status: CapabilityStatus): string => {
  if (status === 'reachable' || status === 'unreachable') {
    return '\u25CF';
  }
  if (status === 'testing') {
    return '\u25CC';
  }
  return '\u25CB';
};

/** Narrow config surface needed to resolve the effective connection per capability. */
export type CapabilityStatusConfig = {
  getAiConnections(): readonly { id: ConnectionId; capability: ConnectionCapability }[];
  getDefaultByCapability(): Record<string, string | null> | undefined;
};

/**
 * Builds the shared capability status list from live config + shared test
 * state. Reads reactive services/store, so callers inside Svelte reactive
 * contexts track updates.
 */
export const buildCapabilityStatuses = (
  config: CapabilityStatusConfig,
): readonly AiCapabilityStatus[] => {
  const capabilities: ConnectionCapability[] = ['text', 'voice', 'image'];
  const connections = config.getAiConnections();
  const defaults = config.getDefaultByCapability();
  return capabilities.map((capability) => {
    const capConnections = connections.filter((connection) => connection.capability === capability);
    const effective =
      capConnections.find((connection) => connection.id === defaults?.[capability]) ??
      capConnections[0];
    return {
      capability,
      status: deriveCapabilityStatus({
        connection: effective,
        testResults: aiConnectionStatus.testResults,
        testingIds: aiConnectionStatus.testingIds,
      }),
    };
  });
};
