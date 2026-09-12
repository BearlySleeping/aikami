// apps/frontend/client/src/lib/services/agent/agents/battle_trigger_agent.ts
//
// Post-agent that detects whether the latest GM response describes a combat
// encounter and should trigger a battle scene transition.
//
// Contract: C-427 AC-4

import type { AgentConfig, AgentRunResult } from '$types';
import { extractAgentStructure } from '../agent_llm.ts';

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
  aiResponse,
  signal,
}: {
  config: AgentConfig;
  aiResponse: string;
  signal?: AbortSignal;
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

    // Local-first structured extraction with a cloud fallback (task preset).
    const result = (await extractAgentStructure({
      config,
      signal,
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
