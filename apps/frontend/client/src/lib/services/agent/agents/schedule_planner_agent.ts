// apps/frontend/client/src/lib/services/agent/agents/schedule_planner_agent.ts
//
// Post-agent that generates a 7×24 weekly schedule from an NPC's
// personality card. Uses extractStructure() to get validated output
// from the LLM.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';
import type { SchedulePlannerOutput } from '../agent_schemas.ts';

/**
 * Executes the schedule planner agent.
 *
 * Takes an NPC's personality description and infers a realistic
 * 7-day weekly schedule with hourly availability and activity
 * descriptions. Called on demand (not per-message).
 *
 * @param config - Agent configuration with system prompt.
 * @param context - Pipeline context containing NPC info in userMessage.
 * @returns Agent run result with parsed schedule data.
 */
export const runSchedulePlannerAgent = async ({
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
      'NPC Personality & Background:',
      context.userMessage ||
        'This NPC has no defined personality. Generate a generic daily schedule.',
      '',
      'Generate a realistic 7-day weekly schedule for this character.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          dailyPattern: { type: 'string', minLength: 1 },
          schedule: {
            type: 'object',
            properties: {
              days: {
                type: 'array',
                minItems: 7,
                maxItems: 7,
                items: {
                  type: 'object',
                  properties: {
                    day: { type: 'integer', minimum: 0, maximum: 6 },
                    hours: {
                      type: 'array',
                      minItems: 24,
                      maxItems: 24,
                      items: {
                        type: 'object',
                        properties: {
                          hour: { type: 'integer', minimum: 0, maximum: 23 },
                          status: { type: 'string', enum: ['online', 'idle', 'dnd', 'offline'] },
                          activity: { type: 'string' },
                        },
                        required: ['hour', 'status'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['day', 'hours'],
                  additionalProperties: false,
                },
              },
            },
            required: ['days'],
            additionalProperties: false,
          },
          suggestedTalkativeness: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['dailyPattern', 'schedule', 'suggestedTalkativeness'],
        additionalProperties: false,
      },
      schemaName: 'SchedulePlanner',
      prompt,
      systemPrompt: 'Generate fantasy RPG NPC schedules. JSON only. No markdown, no explanations.',
    })) as unknown as SchedulePlannerOutput;

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
