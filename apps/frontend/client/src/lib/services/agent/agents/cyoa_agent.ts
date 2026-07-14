// apps/frontend/client/src/lib/services/agent/agents/cyoa_agent.ts
//
// Post-agent that reads the AI's narrative response and proposes 2–4
// structured player choices (CYOA — Choose Your Own Adventure), rendered
// as interactive buttons below the AI message.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { CYOA_MAX_CHOICES } from '@aikami/constants';
import { type CyoaChoice, CyoaChoiceResultSchema, schemaCheck } from '@aikami/schemas';
import { logger } from '$logger';
import { textGenerationService } from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';

/**
 * Sanitizes raw agent output into a clean choice list:
 * - drops entries with empty labels
 * - removes duplicate labels (case-insensitive)
 * - guarantees unique, non-empty IDs
 * - caps the list at CYOA_MAX_CHOICES entries
 * - hides malformed skill checks (missing/invalid dc)
 */
export const sanitizeChoices = (choices: CyoaChoice[]): CyoaChoice[] => {
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  const cleaned: CyoaChoice[] = [];

  for (const choice of choices) {
    const label = choice.label.trim();
    if (label.length === 0) {
      continue;
    }

    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) {
      logger.warn('cyoaAgent: duplicate choice label dropped', { label });
      continue;
    }
    seenLabels.add(labelKey);

    let id = choice.id.trim();
    if (id.length === 0 || seenIds.has(id)) {
      id = crypto.randomUUID();
    }
    seenIds.add(id);

    let skillCheck = choice.skillCheck;
    if (skillCheck && (!Number.isFinite(skillCheck.dc) || skillCheck.dc <= 0)) {
      logger.warn('cyoaAgent: malformed skill check hidden', { label, skillCheck });
      skillCheck = undefined;
    }

    cleaned.push({ ...choice, id, label, skillCheck });

    if (cleaned.length >= CYOA_MAX_CHOICES) {
      break;
    }
  }

  return cleaned;
};

/**
 * Executes the CYOA post-agent.
 *
 * Analyzes the GM response via structured extraction and proposes 2–4
 * player choices. Zero choices is a valid no-op (no UI rendered). A
 * single choice is treated as a prompt-advance ("Continue") by the UI.
 * Malformed output produces a failed result with a logged warning.
 *
 * @param config - Agent configuration.
 * @param _context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze.
 * @returns Agent run result with `{ choices: CyoaChoice[] }` output.
 */
export const runCyoaAgent = async ({
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
      'Propose 2-4 distinct player choices for what to do next.',
    ].join('\n');

    const result = await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          choices: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                skillCheck: {
                  type: 'object',
                  properties: {
                    ability: { type: 'string' },
                    dc: { type: 'number' },
                  },
                  required: ['ability', 'dc'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['choices'],
        additionalProperties: false,
      },
      schemaName: 'CyoaChoiceResult',
      prompt,
      systemPrompt: 'Propose player choices from RPG narrative. JSON only.',
    });

    if (!schemaCheck(CyoaChoiceResultSchema, result)) {
      logger.warn('cyoaAgent: malformed structured output', { result });
      return {
        agentId: config.id,
        phase: config.phase,
        success: false,
        error: 'Malformed CYOA output — schema validation failed',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const choices = sanitizeChoices(result.choices);

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: { type: 'cyoa_choices', choices },
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('cyoaAgent: extraction failed', { message });
    return {
      agentId: config.id,
      phase: config.phase,
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - start),
    };
  }
};
