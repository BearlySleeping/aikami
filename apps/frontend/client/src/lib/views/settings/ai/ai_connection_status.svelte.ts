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

import type { AiConnection, AiProvider } from '@aikami/types';
import type { ConnectionCapability, ConnectionId, ConnectionTestResult } from '$types';
import { registryForCapability } from './ai_provider_registry';

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

/**
 * Rich status-board entry for one capability. Produced by
 * {@link buildCapabilityStatusEntries} so the AI editor's status board and the
 * per-capability detail page render the same projection.
 */
export type CapabilityStatusEntry = {
  capability: ConnectionCapability;
  connectionId: ConnectionId | undefined;
  status: CapabilityStatus;
  color: string;
  dot: string;
  label: string;
  modelName: string | undefined;
  latencyMs: number | undefined;
  providerLabel: string | undefined;
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
  testingIds: ReadonlySet<string>;
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

/** Provider registry for a capability — pure metadata lookup. */
const _registryForCapability = registryForCapability;

/** Inputs required to project the shared capability status board. */
export type CapabilityStatusEntryInput = {
  connections: readonly AiConnection[];
  providers: readonly AiProvider[];
  defaultByCapability: Record<string, string | null> | undefined;
  testResults: Record<string, ConnectionTestResult>;
  testingIds: ReadonlySet<string>;
};

/**
 * Pure projection of the shared status board. Reads only its inputs, so both
 * the AI editor and a lightweight per-capability detail page can render the
 * same facts without sharing an editor instance.
 */
export const buildCapabilityStatusEntries = (
  input: CapabilityStatusEntryInput,
): readonly CapabilityStatusEntry[] => {
  const capabilities: ConnectionCapability[] = ['text', 'voice', 'image'];
  return capabilities.map((capability) => {
    const connections = input.connections.filter(
      (connection) => connection.capability === capability,
    );
    const registry = _registryForCapability(capability);
    const registryIds = new Set<string>(registry.map((entry) => entry.id));
    const providers = input.providers.filter((candidate) => registryIds.has(candidate.registryId));
    // The effective connection is the one actually resolved for this
    // capability's default role — never just the first array entry, which can
    // be stale or arbitrary once more than one connection exists.
    const effectiveId = input.defaultByCapability?.[capability];
    const effectiveConnection =
      connections.find((connection) => connection.id === effectiveId) ?? connections[0];
    const status = deriveCapabilityStatus({
      connection: effectiveConnection,
      testResults: input.testResults,
      testingIds: input.testingIds,
    });
    const testResult = effectiveConnection ? input.testResults[effectiveConnection.id] : undefined;
    const provider = effectiveConnection
      ? providers.find((entry) => entry.id === effectiveConnection.providerId)
      : undefined;
    const registryEntry = registry.find((entry) => entry.id === provider?.registryId);
    return {
      capability,
      connectionId: effectiveConnection?.id,
      status,
      color: capabilityStatusColor(status),
      dot: capabilityStatusDot(status),
      label: capability.charAt(0).toUpperCase() + capability.slice(1),
      modelName: effectiveConnection?.model,
      latencyMs: testResult?.ok ? testResult.latencyMs : undefined,
      providerLabel: registryEntry?.label,
    };
  });
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

// ---------------------------------------------------------------------------
// Per-connection / per-provider descriptors (provider tree)
// ---------------------------------------------------------------------------

/** Human-readable status descriptor for one connection row. */
export type ConnectionStatusDescriptor = {
  label: string;
  colorClass: string;
  dot: string;
};

/** Resolves the display status for one connection from the shared store. */
export const connectionStatusDescriptor = (options: {
  connectionId: ConnectionId;
  testResults: Record<string, ConnectionTestResult>;
  testingIds: ReadonlySet<string>;
}): ConnectionStatusDescriptor => {
  if (options.testingIds.has(options.connectionId)) {
    return { label: 'testing…', colorClass: 'text-warning', dot: '◌' };
  }
  const result = options.testResults[options.connectionId];
  if (!result) {
    return { label: 'not checked', colorClass: 'text-base-content/40', dot: '○' };
  }
  if (result.ok) {
    return { label: `reachable (${result.latencyMs}ms)`, colorClass: 'text-success', dot: '●' };
  }
  return {
    label: result.error ? `unreachable: ${result.error}` : 'unreachable',
    colorClass: 'text-error',
    dot: '●',
  };
};

/** Provider badge status derived from the connections it owns. */
export type ProviderStatusDescriptor = {
  label: string;
  colorClass: string;
};

/** Resolves a provider badge status from its connections + the shared store. */
export const providerStatusFor = (options: {
  connections: readonly { id: ConnectionId }[];
  testResults: Record<string, ConnectionTestResult>;
  testingIds: ReadonlySet<string>;
}): ProviderStatusDescriptor => {
  if (options.connections.length === 0) {
    return { label: 'no connections', colorClass: 'badge-ghost' };
  }
  for (const connection of options.connections) {
    if (options.testingIds.has(connection.id)) {
      return { label: 'testing…', colorClass: 'badge-warning' };
    }
  }
  for (const connection of options.connections) {
    const result = options.testResults[connection.id];
    if (result && !result.ok) {
      return { label: 'unreachable', colorClass: 'badge-error' };
    }
  }
  const allTested = options.connections.every(
    (connection) => options.testResults[connection.id] !== undefined,
  );
  if (allTested) {
    return { label: 'reachable', colorClass: 'badge-success' };
  }
  return { label: 'not checked', colorClass: 'badge-ghost' };
};
