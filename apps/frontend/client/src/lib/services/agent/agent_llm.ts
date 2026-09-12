// apps/frontend/client/src/lib/services/agent/agent_llm.ts
//
// Thin agent-facing wrapper over TextGenerationService. Injects the agent's
// text task (derived from its id) so the gateway can route each agent to its
// own role connection and apply the task's token/temperature preset. Runners
// pass their abort signal through so a timed-out agent cancels its request.
//
// Contract: C-236, C-507

import { AGENT_TEXT_TASKS } from '@aikami/constants';
import type { AgentConfig } from '$types';
import { textGenerationService } from '../ai/text_generation_service.svelte.ts';

/** Runs a structured agent extraction with task routing + cancellation. */
export const extractAgentStructure = (options: {
  config: AgentConfig;
  schema: Record<string, unknown>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}): Promise<unknown> => {
  const { config, ...rest } = options;
  return textGenerationService.extractStructure({
    ...rest,
    task: AGENT_TEXT_TASKS[config.id],
  });
};
