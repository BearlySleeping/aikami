// apps/frontend/client/src/lib/services/agent/agents/relationship_agent.ts
//
// Post-agent that analyzes dialogue to determine relationship changes
// between characters.
//
// Contract: C-427 AC-4

import { localTaskPool } from '$lib/services/ai/local_task_pool_service.svelte.ts';
import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';

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
      'Latest dialogue to analyze:',
      aiResponse.slice(0, 2000),
      '',
      'Determine how the relationship between the speaking characters changes.',
    ].join('\n');

    // Try local task pool first, fall back to gateway
    let result: RelationshipOutput;
    let usedLocal = false;

    try {
      const taskResult = await localTaskPool.submit({
        type: 'relationship',
        payload: {
          speaker: extractSpeaker(aiResponse),
          target: extractTarget(aiResponse),
          dialogue: aiResponse.slice(0, 2000),
        },
      });

      if (taskResult.ok) {
        result = JSON.parse(taskResult.output) as RelationshipOutput;
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

/**
 * Extract the speaker name from dialogue text.
 * Looks for patterns like "Name: dialogue" or "Name said,".
 */
const extractSpeaker = (text: string): string => {
  const match = text.match(/^([A-Z][a-z]+)\s*[:：]/m);
  return match?.[1] ?? 'unknown';
};

/**
 * Extract the target character name from dialogue text.
 * Looks for patterns like "to Name" or "Name," after the speaker.
 */
const extractTarget = (text: string): string => {
  const match = text.match(/(?:to|at|toward)\s+([A-Z][a-z]+)/i);
  return match?.[1] ?? 'unknown';
};
