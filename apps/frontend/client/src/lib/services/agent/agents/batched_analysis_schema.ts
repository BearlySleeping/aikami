// apps/frontend/client/src/lib/services/agent/agents/batched_analysis_schema.ts
//
// Pure schema, prompt, and result-splitting helpers for the combined
// post-agent analysis call. Split out of `batched_analysis_agent.ts` so the
// builder/splitter logic is exercised by production code, not only tests.
//
// Contract: C-236, C-507

import type { CyoaChoice } from '@aikami/types';
import { sanitizeChoices } from './cyoa_agent.ts';

/** Agent ids whose output can be folded into the combined analysis call. */
const BATCHABLE_AGENT_IDS: ReadonlySet<string> = new Set([
  'world-state',
  'quest-tracker',
  'expression',
  'cyoa',
  'prose-guardian',
  'battle-trigger',
  'relationship',
]);

/** True when an agent can participate in a batched analysis call. */
export const isBatchableAgent = (agentId: string): boolean => BATCHABLE_AGENT_IDS.has(agentId);

/** JSON Schema fragment + prompt line for one batchable agent section. */
type BatchSection = {
  property: Record<string, unknown>;
  required: boolean;
  instruction: string;
};

const BATCH_SECTIONS: Record<string, BatchSection> = {
  'world-state': {
    required: true,
    instruction:
      '"worldState": current locationName, locationDescription, timeOfDay, weather, and notableChanges (string[]).',
    property: {
      type: 'object',
      properties: {
        locationName: { type: 'string', minLength: 1 },
        locationDescription: { type: 'string', minLength: 1 },
        timeOfDay: { type: 'string' },
        weather: { type: 'string' },
        notableChanges: { type: 'array', items: { type: 'string' } },
      },
      required: ['locationName', 'locationDescription', 'timeOfDay', 'weather'],
      additionalProperties: false,
    },
  },
  'quest-tracker': {
    required: true,
    instruction:
      '"quests": {questUpdates: [{questId, questName, status: active|completed|failed|updated, objective?, reason}], newQuests: [{name, description, objective}]}.',
    property: {
      type: 'object',
      properties: {
        questUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              questId: { type: 'string' },
              questName: { type: 'string' },
              status: {
                type: 'string',
                enum: ['active', 'completed', 'failed', 'updated'],
              },
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
  },
  expression: {
    required: true,
    instruction:
      '"characters": [{name, expression}] for every named character (expression from the 19-value enum, default neutral).',
    property: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, expression: { type: 'string' } },
        required: ['name', 'expression'],
        additionalProperties: false,
      },
    },
  },
  cyoa: {
    required: true,
    instruction:
      '"choices": [{id, label, description?, skillCheck?: {ability, dc}}] — 2-4 distinct 1-8 word actions; empty array when none fit.',
    property: {
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
            properties: { ability: { type: 'string' }, dc: { type: 'number' } },
            required: ['ability', 'dc'],
            additionalProperties: false,
          },
        },
        required: ['id', 'label'],
        additionalProperties: false,
      },
    },
  },
  'prose-guardian': {
    required: true,
    instruction:
      '"prose": {qualityScore: 0-100, issues: [{type: repetition|cliche|pacing|voice|formatting, description, suggestion}], styleNotes: string[], rewriteSuggestion?}.',
    property: {
      type: 'object',
      properties: {
        qualityScore: { type: 'number', minimum: 0, maximum: 100 },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['repetition', 'cliche', 'pacing', 'voice', 'formatting'],
              },
              description: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['type', 'description', 'suggestion'],
            additionalProperties: false,
          },
        },
        styleNotes: { type: 'array', items: { type: 'string' } },
        rewriteSuggestion: { type: 'string' },
      },
      required: ['qualityScore', 'issues', 'styleNotes'],
      additionalProperties: false,
    },
  },
  'battle-trigger': {
    required: true,
    instruction: '"battleTrigger": {battle: boolean, enemy: string}.',
    property: {
      type: 'object',
      properties: { battle: { type: 'boolean' }, enemy: { type: 'string' } },
      required: ['battle', 'enemy'],
      additionalProperties: false,
    },
  },
  relationship: {
    required: true,
    instruction: '"relationship": {change: improve|worsen|neutral, magnitude: 0-10, reason}.',
    property: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: ['improve', 'worsen', 'neutral'] },
        magnitude: { type: 'number', minimum: 0, maximum: 10 },
        reason: { type: 'string' },
      },
      required: ['change', 'magnitude', 'reason'],
      additionalProperties: false,
    },
  },
};

/** The property key each agent reads out of the combined response. */
const OUTPUT_KEY: Record<string, string> = {
  'world-state': 'worldState',
  'quest-tracker': 'quests',
  expression: 'characters',
  cyoa: 'choices',
  'prose-guardian': 'prose',
  'battle-trigger': 'battleTrigger',
  relationship: 'relationship',
};

/** Builds a JSON schema containing only the requested agents' sections. */
export const buildCombinedSchema = (agentIds: readonly string[]): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const agentId of agentIds) {
    const key = OUTPUT_KEY[agentId];
    const section = BATCH_SECTIONS[agentId];
    if (!key || !section) {
      continue;
    }
    properties[key] = section.property;
    if (section.required) {
      required.push(key);
    }
  }
  return { type: 'object', properties, required, additionalProperties: false };
};

/** Builds the combined user prompt for the requested agents. */
export const buildBatchedPrompt = (options: {
  agentIds: readonly string[];
  aiResponse: string;
}): string => {
  const { agentIds, aiResponse } = options;
  const lines = agentIds
    .map((id) => BATCH_SECTIONS[id])
    .filter((section): section is BatchSection => section !== undefined)
    .map((section) => `- ${section.instruction}`);
  return [
    'Analyze the following game master response and return ONE JSON object with these fields:',
    ...lines,
    '',
    'Latest GM response to analyze:',
    aiResponse.slice(0, 4000),
  ].join('\n');
};

export const BATCHED_SYSTEM_PROMPT =
  'You are a background analysis engine for a fantasy RPG. Return a single JSON object with exactly the requested fields. No markdown, no explanations.';

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Parses raw choice candidates into the trusted `CyoaChoice` shape. */
const parseChoices = (value: unknown): CyoaChoice[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const choices: CyoaChoice[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string') {
      continue;
    }
    const choice: CyoaChoice = { id: item.id, label: item.label };
    if (typeof item.description === 'string') {
      choice.description = item.description;
    }
    if (
      isRecord(item.skillCheck) &&
      typeof item.skillCheck.ability === 'string' &&
      typeof item.skillCheck.dc === 'number'
    ) {
      choice.skillCheck = { ability: item.skillCheck.ability, dc: item.skillCheck.dc };
    }
    choices.push(choice);
  }
  return choices;
};

/** Per-agent output split from the combined extraction result. */
type BatchedAgentOutput = {
  success: boolean;
  output?: unknown;
  error?: string;
};

/**
 * Splits a combined batched response into per-agent outputs, restoring each
 * agent's native output shape. Exported for table-driven tests.
 */
export const splitBatchedOutput = (options: {
  agentIds: readonly string[];
  raw: unknown;
}): Map<string, BatchedAgentOutput> => {
  const { agentIds, raw } = options;
  const record = isRecord(raw) ? raw : {};
  const results = new Map<string, BatchedAgentOutput>();

  for (const agentId of agentIds) {
    switch (agentId) {
      case 'world-state': {
        const value = record.worldState;
        results.set(
          agentId,
          value
            ? { success: true, output: value }
            : { success: false, error: 'Batched response missing worldState' },
        );
        break;
      }
      case 'quest-tracker': {
        if (!isRecord(record.quests)) {
          results.set(agentId, {
            success: false,
            error: 'Batched response missing quests',
          });
          break;
        }
        const quests = record.quests;
        results.set(agentId, {
          success: true,
          output: {
            questUpdates: Array.isArray(quests.questUpdates) ? quests.questUpdates : [],
            newQuests: Array.isArray(quests.newQuests) ? quests.newQuests : [],
          },
        });
        break;
      }
      case 'expression': {
        if (!Array.isArray(record.characters)) {
          results.set(agentId, {
            success: false,
            error: 'Batched response missing characters',
          });
          break;
        }
        results.set(agentId, {
          success: true,
          output: { characters: record.characters },
        });
        break;
      }
      case 'cyoa': {
        results.set(agentId, {
          success: true,
          output: { type: 'cyoa_choices', choices: sanitizeChoices(parseChoices(record.choices)) },
        });
        break;
      }
      case 'prose-guardian': {
        const value = record.prose;
        results.set(
          agentId,
          value
            ? { success: true, output: value }
            : { success: false, error: 'Batched response missing prose' },
        );
        break;
      }
      case 'battle-trigger': {
        const value = record.battleTrigger;
        results.set(
          agentId,
          value
            ? { success: true, output: value }
            : { success: false, error: 'Batched response missing battleTrigger' },
        );
        break;
      }
      case 'relationship': {
        const value = record.relationship;
        results.set(
          agentId,
          value
            ? { success: true, output: value }
            : { success: false, error: 'Batched response missing relationship' },
        );
        break;
      }
      default:
        break;
    }
  }

  return results;
};
