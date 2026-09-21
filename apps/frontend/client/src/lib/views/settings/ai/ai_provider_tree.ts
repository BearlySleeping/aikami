// apps/frontend/client/src/lib/views/settings/ai/ai_provider_tree.ts
//
// Pure provider-tree projection for the AI settings status board. No state,
// no services — the ViewModel reads config + the shared test store and
// delegates here.

import type { AiConnection, AiProvider } from '@aikami/types';
import type { ConnectionTestResult } from '$types';
import { connectionStatusDescriptor, providerStatusFor } from './ai_connection_status.svelte';
import { LOCAL_PROVIDER_IDS, registryForCapability } from './ai_provider_registry';

/** A provider-tree connection with its resolved verification status. */
export type ProviderTreeConnection = AiConnection & {
  statusLabel: string;
  statusColorClass: string;
  statusDot: string;
};

/** A provider with its nested connections, for the provider tree. */
export type ProviderTreeEntry = {
  provider: AiProvider;
  connections: ProviderTreeConnection[];
  registryLabel: string;
  isLocal: boolean;
  connectionCount: number;
  statusLabel: string;
  statusColorClass: string;
};

/** Builds the provider tree from saved config + the shared test store. */
export const buildProviderTree = (input: {
  providers: readonly AiProvider[];
  connections: readonly AiConnection[];
  testResults: Record<string, ConnectionTestResult>;
  testingIds: ReadonlySet<string>;
}): readonly ProviderTreeEntry[] =>
  input.providers.map((provider) => {
    const connections = input.connections.filter(
      (connection) => connection.providerId === provider.id,
    );
    const treeConnections = connections.map((connection): ProviderTreeConnection => {
      const status = connectionStatusDescriptor({
        connectionId: connection.id,
        testResults: input.testResults,
        testingIds: input.testingIds,
      });
      return {
        ...connection,
        statusLabel: status.label,
        statusColorClass: status.colorClass,
        statusDot: status.dot,
      };
    });
    const registry = registryForCapability(connections[0]?.capability ?? 'text');
    const registryEntry = registry.find((entry) => entry.id === provider.registryId);
    const status = providerStatusFor({
      connections,
      testResults: input.testResults,
      testingIds: input.testingIds,
    });
    return {
      provider,
      connections: treeConnections,
      registryLabel: registryEntry?.label ?? provider.registryId,
      isLocal: LOCAL_PROVIDER_IDS.has(provider.registryId),
      connectionCount: connections.length,
      statusLabel: status.label,
      statusColorClass: status.colorClass,
    };
  });
