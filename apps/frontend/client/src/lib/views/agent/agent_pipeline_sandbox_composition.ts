// apps/frontend/client/src/lib/views/agent/agent_pipeline_sandbox_composition.ts
//
// Production wiring for the agent pipeline sandbox ViewModel. This is the only
// module in the feature that imports the `$services` barrel and builds the
// nested pipeline/HUD ViewModels; the sandbox receives them as typed
// capabilities.

import { BUILT_IN_AGENTS } from '$services';
import { getAgentHudViewModel } from './agent_hud_view_model.svelte.ts';
import { getAgentPipelineViewModel } from './agent_pipeline_composition.ts';
import {
  type AgentPipelineSandboxViewModelInterface,
  type AgentPipelineSandboxViewModelOptions,
  createAgentPipelineSandboxViewModel,
} from './agent_pipeline_sandbox_view_model.svelte';

type AgentPipelineSandboxCompositionOptions = Omit<
  AgentPipelineSandboxViewModelOptions,
  'pipeline' | 'hud' | 'availableAgents'
>;

/**
 * Builds the sandbox ViewModel wired to fresh pipeline/HUD ViewModels and the
 * built-in agent catalog.
 */
export const getAgentPipelineSandboxViewModel = (
  options: AgentPipelineSandboxCompositionOptions,
): AgentPipelineSandboxViewModelInterface =>
  createAgentPipelineSandboxViewModel({
    ...options,
    pipeline: getAgentPipelineViewModel({ className: 'AgentPipelineViewModel:sandbox' }),
    hud: getAgentHudViewModel({ className: 'AgentHudViewModel:sandbox' }),
    availableAgents: BUILT_IN_AGENTS,
  });
