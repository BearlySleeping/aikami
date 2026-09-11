// apps/frontend/client/src/lib/views/settings/ai/ai_connection_status.svelte.ts
//
// Session-scoped, observable connection-test state shared by the AI settings
// surfaces that belong to one settings session: the header badge and the
// capability detail pages (and, through them, the connection editor). Create
// exactly one store per settings session with {@link createAiConnectionStatus};
// the owning ViewModel resets it when the session ends.
//
// This module holds ONLY the shared test facts plus the pure derivations over
// them. Editor drafts, visibility, model discovery, and provider/role editing
// stay local to each AiSettingsViewModel.

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

/** The shared connection-test store for one settings session. */
export type AiConnectionStatus = {
  readonly testResults: Record<string, ConnectionTestResult>;
  readonly testingIds: ReadonlySet<string>;
  resultFor(connectionId: ConnectionId): ConnectionTestResult | undefined;
  isTesting(connectionId: ConnectionId): boolean;
  /** Marks a probe in flight and returns its generation token. */
  begin(connectionId: ConnectionId): number;
  /** True when `generation` is still the newest probe for the connection. */
  isCurrent(connectionId: ConnectionId, generation: number): boolean;
  /** Stores a probe result only if it belongs to the newest generation. */
  storeResult(
    connectionId: ConnectionId,
    generation: number,
    result: ConnectionTestResult,
  ): boolean;
  /** Stores a result unconditionally (e.g. a verified draft on save). */
  setResult(connectionId: ConnectionId, result: ConnectionTestResult): void;
  /** Clears the in-flight flag when a probe settles. */
  finish(connectionId: ConnectionId, generation: number): void;
  clear(connectionId: ConnectionId): void;
  /** Ends the session: drops every result and invalidates in-flight probes. */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Store factory (per settings session)
// ---------------------------------------------------------------------------

/**
 * Creates the reactive status store for one settings session. The returned
 * store holds no module-global state, so separate sessions (or a test double)
 * cannot leak into one another. Share one instance between the header and the
 * detail pages that must agree; never substitute a module global for it.
 */
export const createAiConnectionStatus = (): AiConnectionStatus => {
  let testResults = $state<Record<string, ConnectionTestResult>>({});
  let testingIds = $state<ReadonlySet<string>>(new Set<string>());
  /** Monotonic generation per connection — discards stale async probe results. */
  const generation: Record<string, number> = {};

  return {
    get testResults(): Record<string, ConnectionTestResult> {
      return testResults;
    },

    get testingIds(): ReadonlySet<string> {
      return testingIds;
    },

    resultFor(connectionId: ConnectionId): ConnectionTestResult | undefined {
      return testResults[connectionId];
    },

    isTesting(connectionId: ConnectionId): boolean {
      return testingIds.has(connectionId);
    },

    begin(connectionId: ConnectionId): number {
      const nextGeneration = (generation[connectionId] ?? 0) + 1;
      generation[connectionId] = nextGeneration;
      const next = new Set(testingIds);
      next.add(connectionId);
      testingIds = next;
      return nextGeneration;
    },

    isCurrent(connectionId: ConnectionId, probeGeneration: number): boolean {
      return generation[connectionId] === probeGeneration;
    },

    storeResult(
      connectionId: ConnectionId,
      probeGeneration: number,
      result: ConnectionTestResult,
    ): boolean {
      if (generation[connectionId] !== probeGeneration) {
        return false;
      }
      testResults = { ...testResults, [connectionId]: result };
      return true;
    },

    setResult(connectionId: ConnectionId, result: ConnectionTestResult): void {
      testResults = { ...testResults, [connectionId]: result };
    },

    finish(connectionId: ConnectionId, probeGeneration: number): void {
      if (generation[connectionId] !== probeGeneration) {
        return;
      }
      const next = new Set(testingIds);
      next.delete(connectionId);
      testingIds = next;
    },

    clear(connectionId: ConnectionId): void {
      if (connectionId in testResults) {
        const { [connectionId]: _removed, ...rest } = testResults;
        testResults = rest;
      }
      if (testingIds.has(connectionId)) {
        const next = new Set(testingIds);
        next.delete(connectionId);
        testingIds = next;
      }
      // Advance (never delete) the generation: an in-flight probe from before the
      // clear must not be able to write its pre-edit result back.
      generation[connectionId] = (generation[connectionId] ?? 0) + 1;
    },

    reset(): void {
      testResults = {};
      testingIds = new Set<string>();
      for (const connectionId of Object.keys(generation)) {
        generation[connectionId] = (generation[connectionId] ?? 0) + 1;
      }
    },
  };
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
 * Builds the lightweight capability status list from live config and a given
 * session's test store. Reads reactive services/state, so callers inside Svelte
 * reactive contexts track updates.
 */
export const buildCapabilityStatuses = (
  config: CapabilityStatusConfig,
  status: AiConnectionStatus,
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
        testResults: status.testResults,
        testingIds: status.testingIds,
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
