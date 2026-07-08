// apps/frontend/client/src/lib/services/agent/agents/narrative_director_agent.ts
//
// Pre-agent adapter for the C-235 Narrative Director. Runs a background
// LLM call to generate a scene direction, then injects the result into
// the system prompt as a narrative context section.
//
// Contract: C-236 Agent Pipeline System

import { narrativeDirectorService } from '$lib/services/gm/narrative_director_service.svelte.ts';
import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';
import type { SceneDirectionOutput } from '../agent_schemas.ts';

/**
 * Executes the narrative director pre-agent.
 *
 * Generates a scene direction via LLM, validates it, and returns
 * a run result. Also pushes the direction to the narrative director
 * service for arc memory tracking.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context (user message, system prompt).
 * @returns Agent run result with parsed scene direction.
 */
export const runNarrativeDirectorAgent = async ({
  config,
  context,
}: {
  config: AgentConfig;
  context: AgentPipelineContext;
}): Promise<AgentRunResult> => {
  const start = performance.now();

  try {
    const prompt = [
      config.systemPrompt,
      '',
      'Context:',
      `Player message: ${context.userMessage}`,
      '',
      'Current system prompt for reference:',
      context.systemPrompt.slice(0, 1500),
      '',
      "Generate a scene direction that sets the mood for the gamemaster's upcoming response.",
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 1 },
          playerGuidance: { type: 'string' },
        },
        required: ['description'],
        additionalProperties: false,
      },
      schemaName: 'SceneDirection',
      prompt,
      systemPrompt:
        'Generate concise fantasy RPG scene directions. JSON only. No markdown, no explanations.',
    })) as SceneDirectionOutput;

    // extractStructure validates against the provided schema, so the cast is safe

    // Push to narrative director service for arc memory tracking
    try {
      await narrativeDirectorService.pushStory();
    } catch {
      // Non-critical — arc memory push is best-effort
    }

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
