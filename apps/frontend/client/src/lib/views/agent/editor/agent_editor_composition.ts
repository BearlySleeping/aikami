// apps/frontend/client/src/lib/views/agent/editor/agent_editor_composition.ts
//
// Production wiring for the custom agent editor ViewModel. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives its collaborators as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { agentRegistryService, configService, runCustomAgent } from '$services';
import {
  type AgentEditorViewModelInterface,
  createAgentEditorViewModel,
} from './agent_editor_view_model.svelte';

/**
 * Builds the agent editor ViewModel wired to the production registry, config
 * catalog and custom-agent runner.
 */
export const getAgentEditorViewModel = (
  options: BaseViewModelOptions,
): AgentEditorViewModelInterface =>
  createAgentEditorViewModel({
    ...options,
    registry: agentRegistryService,
    config: configService,
    runner: { run: runCustomAgent },
  });
