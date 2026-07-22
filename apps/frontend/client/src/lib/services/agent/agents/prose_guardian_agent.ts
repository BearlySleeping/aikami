// apps/frontend/client/src/lib/services/agent/agents/prose_guardian_agent.ts
//
// Post-agent that evaluates dialogue quality and suggests improvements
// for repetition, clichés, pacing, voice, and formatting issues.
//
// Contract: C-236 Agent Pipeline System

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';
import type { ProseGuardianOutput } from '../agent_schemas.ts';

/**
 * Executes the prose guardian post-agent.
 *
 * Evaluates the quality of the GM response, checking for repetition,
 * clichés, pacing issues, voice consistency, and formatting problems.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to evaluate.
 * @returns Agent run result with parsed prose quality data.
 */
export const runProseGuardianAgent = async ({
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
      'Latest GM response to evaluate:',
      aiResponse.slice(0, 2000),
      '',
      'Evaluate the prose quality and identify any issues.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          qualityScore: { type: 'number', minimum: 0, maximum: 100 },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['repetition', 'cliche', 'pacing', 'voice', 'formatting'],
                },
                description: { type: 'string' },
                suggestion: { type: 'string' },
              },
              required: ['type', 'description', 'suggestion'],
              additionalProperties: false,
            },
          },
          styleNotes: { type: 'array', items: { type: 'string' } },
          rewriteSuggestion: { type: 'string' },
        },
        required: ['qualityScore', 'issues', 'styleNotes'],
        additionalProperties: false,
      },
      schemaName: 'ProseGuardian',
      prompt,
      systemPrompt: 'Evaluate prose quality in RPG dialogue. JSON only.',
    })) as ProseGuardianOutput;

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
