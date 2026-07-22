// apps/frontend/client/src/lib/services/agent/agents/quest_tracker_agent.ts
//
// Post-agent that detects quest-relevant narrative events and proposes
// state changes for existing quests or new quest creation.
//
// Contract: C-236 Agent Pipeline System

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';
import type { QuestUpdateOutput } from '../agent_schemas.ts';

/**
 * Executes the quest tracker post-agent.
 *
 * Analyzes the GM response and detects quest progression events,
 * proposing status changes for existing quests and new quest creation.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with parsed quest update data.
 */
export const runQuestTrackerAgent = async ({
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
      'Detect any quest-relevant narrative events and propose updates.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          questUpdates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                questId: { type: 'string' },
                questName: { type: 'string' },
                status: { type: 'string', enum: ['active', 'completed', 'failed', 'updated'] },
                objective: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['questId', 'questName', 'status', 'reason'],
              additionalProperties: false,
            },
          },
          newQuests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                objective: { type: 'string' },
              },
              required: ['name', 'description', 'objective'],
              additionalProperties: false,
            },
          },
        },
        required: ['questUpdates', 'newQuests'],
        additionalProperties: false,
      },
      schemaName: 'QuestUpdate',
      prompt,
      systemPrompt: 'Detect quest events from RPG narrative. JSON only.',
    })) as QuestUpdateOutput;

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
