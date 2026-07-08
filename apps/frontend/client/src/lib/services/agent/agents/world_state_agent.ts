// apps/frontend/client/src/lib/services/agent/agents/world_state_agent.ts
//
// Post-agent that extracts world state from the GM response. Produces
// structured location, time, weather, and change tracking data.
//
// Contract: C-236 Agent Pipeline System

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';
import type { WorldStateExtractionOutput } from '../agent_schemas.ts';

/**
 * Executes the world state tracker post-agent.
 *
 * Analyzes the latest GM response and extracts structured world state
 * including location, time, weather, and notable changes.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with parsed world state extraction.
 */
export const runWorldStateAgent = async ({
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
      'Extract the current world state from this response.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          locationName: { type: 'string', minLength: 1 },
          locationDescription: { type: 'string', minLength: 1 },
          timeOfDay: { type: 'string' },
          weather: { type: 'string' },
          notableChanges: { type: 'array', items: { type: 'string' } },
        },
        required: ['locationName', 'locationDescription', 'timeOfDay', 'weather'],
        additionalProperties: false,
      },
      schemaName: 'WorldStateExtraction',
      prompt,
      systemPrompt: 'Extract world state from RPG narrative. JSON only.',
    })) as WorldStateExtractionOutput;

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
