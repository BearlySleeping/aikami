// apps/frontend/client/src/lib/services/agent/agents/relationship_agent.ts
//
// Post-agent that analyzes dialogue to determine relationship changes
// between characters.
//
// Contract: C-427 AC-4

import type { AgentConfig, AgentRunResult } from '$types';
import { extractAgentStructure } from '../agent_llm.ts';

export type RelationshipOutput = {
  change: 'improve' | 'worsen' | 'neutral';
  magnitude: number;
  reason: string;
};

/**
 * Executes the relationship analysis post-agent.
 *
 * Analyzes dialogue between characters to determine how their
 * relationship changes based on what was said.
 */
export const runRelationshipAgent = async ({
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
      'Latest dialogue to analyze:',
      aiResponse.slice(0, 2000),
      '',
      'Determine how the relationship between the speaking characters changes.',
    ].join('\n');

    // Local-first structured extraction with a cloud fallback (task preset).
    const result = (await extractAgentStructure({
      config,
      signal,
      schema: {
        type: 'object',
        properties: {
          change: { type: 'string', enum: ['improve', 'worsen', 'neutral'] },
          magnitude: { type: 'number', minimum: 0, maximum: 10 },
          reason: { type: 'string' },
        },
        required: ['change', 'magnitude', 'reason'],
        additionalProperties: false,
      },
      schemaName: 'Relationship',
      prompt,
      systemPrompt:
        'Analyze the relationship change between characters. Return JSON with change (improve/worsen/neutral), magnitude (0-10), and reason.',
    })) as RelationshipOutput;

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
