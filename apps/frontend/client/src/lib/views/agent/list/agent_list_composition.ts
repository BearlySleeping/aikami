// apps/frontend/client/src/lib/views/agent/list/agent_list_composition.ts
//
// Production wiring for the agent list feature. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import { agentRegistryService, BUILT_IN_AGENTS } from '$services';
import {
  type AgentListViewModelInterface,
  type AgentListViewModelOptions,
  createAgentListViewModel,
} from './agent_list_view_model.svelte';

/**
 * Builds the agent list ViewModel wired to the production registry singleton
 * and the built-in agent catalog.
 */
export const getAgentListViewModel = (
  options: Omit<AgentListViewModelOptions, 'agents' | 'builtInAgents'>,
): AgentListViewModelInterface =>
  createAgentListViewModel({
    ...options,
    agents: agentRegistryService,
    builtInAgents: BUILT_IN_AGENTS,
  });
