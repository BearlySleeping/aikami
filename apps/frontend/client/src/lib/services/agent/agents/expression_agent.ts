// apps/frontend/client/src/lib/services/agent/agents/expression_agent.ts
//
// Post-agent that evaluates character emotional states from dialogue and
// recommends expression changes for character rendering.
// Multi-character output format: { characters: [{ name, expression }] }
//
// Contract: C-236 Agent Pipeline System
// Contract: C-239 Expression Emotion System

import type { AgentConfig, AgentRunResult } from '$types';
import { extractAgentStructure } from '../agent_llm.ts';
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
      'Identify every named character in this response and determine their emotional expression.',
    ].join('\n');

    const characterNames = extractCharacterNames(aiResponse);

    // Tier 1: free keyword lexicon (0ms/$0). Tier 2: local-first structured
    // extraction with a cloud fallback, handled inside `extractAgentStructure`.
    let result: ExpressionOutput | undefined = classifyExpressions(aiResponse, characterNames);

    if (!result) {
      result = (await extractAgentStructure({
        config,
        signal,
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

/**
 * Extract character names from a text by finding capitalized words
 * that are likely character names. This is a simple heuristic.
 */
const extractCharacterNames = (text: string): string[] => {
  const words = text.match(/[A-Z][a-z]+/g) ?? [];
  return [...new Set(words)].slice(0, 10);
};

/**
 * Keyword → expression lexicon. Ordered by specificity; the first match wins.
 * Covers the common emotional beats so most turns never need an LLM call.
 */
const EXPRESSION_LEXICON: ReadonlyArray<{ expression: string; pattern: RegExp }> = [
  {
    expression: 'angry',
    pattern: /\b(angry|furious|enraged|snarls?|snarled|growls?|growled|glared|seething)\b/i,
  },
  { expression: 'fearful', pattern: /\b(afraid|fearful|terrified|trembl\w*|cowers?|panick\w*)\b/i },
  { expression: 'sad', pattern: /\b(sad|sorrow\w*|weep\w*|cries|crying|tearful|mourn\w*)\b/i },
  // Specific before generic: "grins wickedly" must win over `grins?` (happy).
  {
    expression: 'mischievous',
    pattern: /\b(mischievous|sly|scheming|grins? wickedly|grinned wickedly)\b/i,
  },
  { expression: 'happy', pattern: /\b(happy|joy\w*|delight\w*|grins?|grinned|beams?|cheer\w*)\b/i },
  { expression: 'amused', pattern: /\b(amused|laughs?|laughed|chuckles?|chuckled|smirks?)\b/i },
  { expression: 'surprised', pattern: /\b(surprised|shocked|startled|gasp\w*|stunned)\b/i },
  { expression: 'annoyed', pattern: /\b(annoyed|irritated|frowns?|frowned|scoffs?|sighed)\b/i },
  { expression: 'blushing', pattern: /\b(blush\w*|flushed|embarrassed|reddens?)\b/i },
  { expression: 'confused', pattern: /\b(confused|puzzled|bewildered|unsure)\b/i },
  { expression: 'determined', pattern: /\b(determined|resolute|steeled|clench\w*|nods firmly)\b/i },
  { expression: 'relieved', pattern: /\b(relieved|relief|exhales?|relax\w*)\b/i },
  { expression: 'sleepy', pattern: /\b(sleepy|drowsy|yawns?|tired|weary)\b/i },
  { expression: 'thoughtful', pattern: /\b(thoughtful|pensive|muses?|contemplat\w*|ponders?)\b/i },
  { expression: 'flirty', pattern: /\b(flirt\w*|winks?|winked|purrs?|teasing)\b/i },
  { expression: 'pained', pattern: /\b(pained|winces?|winced|grimaces?|agony)\b/i },
  { expression: 'disgusted', pattern: /\b(disgust\w*|recoils?|revolted|sneers?)\b/i },
];

/**
 * Classifies every named character's expression from emotional keywords.
 * Returns undefined when the text contains no lexicon match so the caller
 * can fall back to the LLM.
 */
const classifyExpressions = (text: string, characters: string[]): ExpressionOutput | undefined => {
  const match = EXPRESSION_LEXICON.find((entry) => entry.pattern.test(text));
  if (!match || characters.length === 0) {
    return undefined;
  }
  return {
    characters: characters.map((name) => ({ name, expression: match.expression })),
  };
};
