// apps/frontend/client/src/lib/services/agent/agents/expression_agent.ts
//
// Post-agent that evaluates NPC emotional state from dialogue and
// recommends expression changes for character rendering.
//
// Contract: C-236 Agent Pipeline System

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';
import type { ExpressionOutput } from '../agent_schemas.ts';

/**
 * Executes the expression evaluator post-agent.
 *
 * Analyzes the latest NPC dialogue or GM response to determine the NPC's
 * emotional state and recommend expression changes for visual rendering.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with parsed expression data.
 */
export const runExpressionAgent = async ({
  config,
  _context,
  aiResponse,
}: {
  config: AgentConfig;
  _context: AgentPipelineContext;
  aiResponse: string;
}): Promise<AgentRunResult> => {
  const start = performance.now();

  try {
    const prompt = [
      config.systemPrompt,
      '',
      'Latest GM response to analyze:',
      aiResponse.slice(0, 2000),
      '',
      "Determine the NPC's emotional state and suggest an expression.",
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          npcName: { type: 'string' },
          currentMood: {
            type: 'string',
            enum: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'],
          },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
          expressionLabel: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['npcName', 'currentMood', 'intensity', 'expressionLabel', 'reason'],
        additionalProperties: false,
      },
      schemaName: 'Expression',
      prompt,
      systemPrompt: 'Evaluate NPC emotional state from dialogue. JSON only.',
    })) as ExpressionOutput;

    // extractStructure validates against the provided schema, so the cast is safe

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: result,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agentId: config.id,
      phase: config.phase,
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - start),
    };
  }
};
