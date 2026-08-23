// apps/frontend/client/src/lib/services/agent/agents/battle_trigger_agent.ts
//
// Post-agent that detects whether the latest GM response describes a combat
// encounter and should trigger a battle scene transition.
//
// Contract: C-427 AC-4

import { localTaskPool } from '$lib/services/ai/local_task_pool_service.svelte.ts';
import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';

export type BattleTriggerOutput = {
  battle: boolean;
  enemy: string;
};

/**
 * Executes the battle trigger post-agent.
 *
 * Analyzes the latest GM response to determine if a battle should be
 * triggered and who the enemy is.
 */
export const runBattleTriggerAgent = async ({
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
      'Determine if this describes a combat encounter. If so, identify the enemy.',
    ].join('\n');

    // Try local task pool first, fall back to gateway
    let result: BattleTriggerOutput;
    let usedLocal = false;

    try {
      const taskResult = await localTaskPool.submit({
        type: 'battle-trigger',
        payload: {
          prose: aiResponse.slice(0, 2000),
        },
      });

      if (taskResult.ok) {
        result = JSON.parse(taskResult.output) as BattleTriggerOutput;
        usedLocal = true;
      } else {
        throw new Error('Local task validation failed');
      }
    } catch {
      // Fall back to gateway
      result = (await textGenerationService.extractStructure({
        schema: {
          type: 'object',
          properties: {
            battle: { type: 'boolean' },
            enemy: { type: 'string' },
          },
          required: ['battle', 'enemy'],
          additionalProperties: false,
        },
        schemaName: 'BattleTrigger',
        prompt,
        systemPrompt:
          'Determine if this describes a combat encounter. Return JSON with battle (boolean) and enemy (string).',
      })) as BattleTriggerOutput;
    }

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: result,
      durationMs: Math.round(performance.now() - start),
      metadata: { usedLocal },
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
