// apps/frontend/client/src/lib/views/agent/agent_pipeline_composition.ts
//
// Production wiring for the agent pipeline ViewModel. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its dependencies as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { agentPipelineService, BUILT_IN_AGENTS } from '$services';
import {
  type AgentPipelineViewModelInterface,
  createAgentPipelineViewModel,
} from './agent_pipeline_view_model.svelte';

/**
 * Builds the agent pipeline ViewModel wired to the production pipeline service
 * singleton and the built-in agent catalog.
 */
export const getAgentPipelineViewModel = (
  options: BaseViewModelOptions,
): AgentPipelineViewModelInterface =>
  createAgentPipelineViewModel({
    ...options,
    runner: agentPipelineService,
    availableAgents: BUILT_IN_AGENTS,
  });
