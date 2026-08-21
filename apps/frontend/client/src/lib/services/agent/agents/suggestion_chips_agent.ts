// apps/frontend/client/src/lib/services/agent/agents/suggestion_chips_agent.ts
//
// Post-agent that reads the AI's narrative response and proposes 0–4
// suggestion chips (NpcSuggestionChip) — short, natural things the player
// could say next, rendered as a chip row above the composer.
//
// This reuses the existing NpcSuggestionChip primitive (C-420) — it does NOT
// introduce a new chip type. Combat-intent chips are filtered out here so
// chat never receives a chip it cannot act on (no combat surface to escalate
// to); the dialogue surface keeps its own combat escalation path.
//
// Contract: C-420 One Choice Affordance
import { SUGGESTION_CHIPS_AGENT_ID } from '@aikami/constants';
import { type NpcSuggestionChip, SuggestionChipsResultSchema, schemaCheck } from '@aikami/schemas';
import { logger } from '$logger';
import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types';

/** Maximum number of chips the agent may propose per turn. */
const MAX_CHIPS = 4;

/**
 * Sanitizes raw agent output into a clean chip list:
 * - drops entries with empty labels or too-short prefillText
 * - removes duplicate labels (case-insensitive)
 * - guarantees unique, non-empty IDs
 * - caps the list at MAX_CHIPS entries
 * - drops combat-intent chips (no chat combat surface)
 */
export const sanitizeChips = (chips: NpcSuggestionChip[]): NpcSuggestionChip[] => {
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  const cleaned: NpcSuggestionChip[] = [];

  for (const chip of chips) {
    if (chip.intentType === 'combat') {
      continue;
    }
    const label = chip.label.trim();
    if (label.length === 0) {
      continue;
    }
    const prefillText = chip.prefillText.trim();
    if (prefillText.length < 10) {
      logger.warn('suggestionChipsAgent: prefillText too short, dropped', { label });
      continue;
    }

    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) {
      logger.warn('suggestionChipsAgent: duplicate chip label dropped', { label });
      continue;
    }
    seenLabels.add(labelKey);

    let id = chip.id.trim();
    if (id.length === 0 || seenIds.has(id)) {
      id = crypto.randomUUID();
    }
    seenIds.add(id);

    cleaned.push({ ...chip, id, label, prefillText });

    if (cleaned.length >= MAX_CHIPS) {
      break;
    }
  }

  return cleaned;
};

/**
 * Executes the suggestion-chips post-agent.
 *
 * Analyzes the GM response via structured extraction and proposes 0–4
 * suggestion chips. Zero chips is a valid no-op (no UI rendered). Malformed
 * output produces a failed result with a logged warning.
 *
 * @param config - Agent configuration.
 * @param _context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with `{ chips: NpcSuggestionChip[] }` output.
 */
export const runSuggestionChipsAgent = async ({
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
    // Keep the prompt small (<500 tokens): only the latest response.
    const prompt = [
      config.systemPrompt,
      '',
      'Latest GM response to analyze:',
      aiResponse.slice(0, 2000),
      '',
      'Propose 0-4 short, natural things the player could say next.',
    ].join('\n');

    const result = await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          chips: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                intentType: {
                  type: 'string',
                  enum: ['dialogue', 'skill_check', 'combat', 'trade', 'quest'],
                },
                prefillText: { type: 'string' },
              },
              required: ['id', 'label', 'intentType', 'prefillText'],
              additionalProperties: false,
            },
          },
        },
        required: ['chips'],
        additionalProperties: false,
      },
      schemaName: 'SuggestionChipsResult',
      prompt,
      systemPrompt:
        'Propose short, natural player lines from RPG narrative. prefillText must be a complete sentence (min 10 chars). JSON only.',
    });

    if (!schemaCheck(SuggestionChipsResultSchema, result)) {
      logger.warn('suggestionChipsAgent: malformed structured output', { result });
      return {
        agentId: config.id,
        phase: config.phase,
        success: false,
        error: 'Malformed suggestion-chips output — schema validation failed',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const chips = sanitizeChips(result.chips);

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: { type: 'suggestion_chips', chips },
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('suggestionChipsAgent: extraction failed', { message });
    return {
      agentId: config.id,
      phase: config.phase,
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - start),
    };
  }
};

/** Agent id constant re-exported for callers that need the literal. */
export const SUGGESTION_CHIPS_AGENT_ID_LITERAL = SUGGESTION_CHIPS_AGENT_ID;
