// apps/frontend/client/src/lib/services/agent/agents/batched_analysis_agent.ts
//
// One combined structured call that produces the outputs of several
// independent post-agents at once. Replaces N per-agent round trips with a
// single prompt + schema + bill; the pipeline splits the result back into
// individual `AgentRunResult`s so downstream consumers are unchanged.
//
// Contract: C-236, C-507

import type { AgentConfig, AgentRunResult } from '$types';
import { textGenerationService } from '../../ai/text_generation_service.svelte.ts';
import {
  BATCHED_SYSTEM_PROMPT,
  buildBatchedPrompt,
  buildCombinedSchema,
  splitBatchedOutput,
} from './batched_analysis_schema.ts';

export const runBatchedAnalysisAgent = async (options: {
  agents: readonly AgentConfig[];
  aiResponse: string;
  signal?: AbortSignal;
}): Promise<AgentRunResult[]> => {
  const { agents, aiResponse, signal } = options;
  const start = performance.now();
  const agentIds = agents.map((agent) => agent.id);

  try {
    const raw = await textGenerationService.extractStructure({
      schema: buildCombinedSchema(agentIds),
      schemaName: 'BatchedAgentAnalysis',
      prompt: buildBatchedPrompt({ agentIds, aiResponse }),
      systemPrompt: BATCHED_SYSTEM_PROMPT,
      signal,
      task: 'agent-batch',
    });

    const split = splitBatchedOutput({ agentIds, raw });
    return agents.map((agent) => {
      const result = split.get(agent.id);
      const durationMs = Math.round(performance.now() - start);
      if (result?.success) {
        return {
          agentId: agent.id,
          phase: agent.phase,
          success: true,
          output: result.output,
          durationMs,
          metadata: { batched: true },
        };
      }
      return {
        agentId: agent.id,
        phase: agent.phase,
        success: false,
        error: result?.error ?? 'No output from batched analysis',
        durationMs,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - start);
    return agents.map((agent) => ({
      agentId: agent.id,
      phase: agent.phase,
      success: false,
      error: message,
      durationMs,
    }));
  }
};
