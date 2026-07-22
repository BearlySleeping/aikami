// apps/frontend/client/src/lib/services/agent/agents/expression_agent.ts
//
// Post-agent that evaluates character emotional states from dialogue and
// recommends expression changes for character rendering.
// Multi-character output format: { characters: [{ name, expression }] }
//
// Contract: C-236 Agent Pipeline System
// Contract: C-239 Expression Emotion System

import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';
import type { ExpressionOutput } from '../agent_schemas.ts';

/**
 * Executes the expression evaluator post-agent.
 *
 * Analyzes the latest dialogue or GM response to determine each character's
 * emotional state and recommend expression changes for visual rendering.
 * Supports multi-character output: identifies all named characters in the
 * response and assigns expressions to each.
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with parsed expression data (characters array).
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
      'Identify every named character in this response and determine their emotional expression.',
    ].join('\n');

    const result = (await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                expression: { type: 'string' },
              },
              required: ['name', 'expression'],
              additionalProperties: false,
            },
          },
        },
        required: ['characters'],
        additionalProperties: false,
      },
      schemaName: 'Expression',
      prompt,
      systemPrompt:
        'Identify every named character and their emotional expression. Return JSON with characters array.',
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
