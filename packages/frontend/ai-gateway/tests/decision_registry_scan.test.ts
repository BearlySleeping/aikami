// packages/frontend/ai-gateway/tests/decision_registry_scan.test.ts
//
// Contract C-566 AC-1 applied to the REAL schema registry: what the decision
// compiler actually makes of every shipping schema it can reach.
//
// This is the audit, encoded as a test. A registry scan run once and pasted
// into a document goes stale silently; asserting the verdict here means a
// schema edit that makes a task eligible — or ineligible — shows up as a
// failing test with a named path, instead of quietly invalidating a
// recommendation.
//
// Scope, stated honestly: this scans `@aikami/schemas` plus the inline
// structured-output schemas transcribed from the client agent call sites. It
// does NOT reach `apps/frontend/client` code, so reachability, call frequency
// and consequences of a wrong answer come from the audit document, not from
// here.

import { describe, expect, test } from 'bun:test';
import {
  CombatEventEnvelopeSchema,
  CombatIntentDraftSchema,
  NpcDialogueAiEnvelopeSchema,
  NpcDialogueCommandSchema,
  NpcDialogueExtractionSchema,
  NpcDialogueSkillSchema,
  NpcDialogueTurnSchema,
  NpcSuggestionChipIntentTypeSchema,
  NpcSuggestionChipSchema,
} from '@aikami/schemas';
import {
  analyzeDecisionSchema,
  type DecisionIncompatibilityCode,
} from '../src/lib/decision/index.ts';
import { NPC_COMMAND_KIND_NONE, NPC_COMMAND_KIND_SCHEMA } from '../src/lib/decision/tasks/index.ts';

/** Compiles and returns the rejection codes, asserting failure. */
const rejectCodes = (schema: unknown): DecisionIncompatibilityCode[] => {
  const analysis = analyzeDecisionSchema({ schema });
  if (analysis.ok) {
    throw new Error('expected rejection but the schema compiled');
  }
  return analysis.reasons.map((reason) => reason.code);
};

/**
 * Inline structured-output schemas transcribed from the client agent call
 * sites. These are hand-written JSON Schema objects inside
 * `apps/frontend/client/src/lib/services/agent/agents/*.ts`, not TypeBox
 * exports, so they are reproduced here with their source file recorded.
 */
const INLINE_AGENT_SCHEMAS: ReadonlyArray<{
  readonly id: string;
  readonly source: string;
  readonly schema: unknown;
}> = [
  {
    id: 'BattleTrigger',
    source: 'apps/frontend/client/src/lib/services/agent/agents/battle_trigger_agent.ts',
    schema: {
      type: 'object',
      properties: { battle: { type: 'boolean' }, enemy: { type: 'string' } },
      required: ['battle', 'enemy'],
      additionalProperties: false,
    },
  },
  {
    id: 'Relationship',
    source: 'apps/frontend/client/src/lib/services/agent/agents/relationship_agent.ts',
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
  },
  {
    id: 'Expression',
    source: 'apps/frontend/client/src/lib/services/agent/agents/expression_agent.ts',
    schema: {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, expression: { type: 'string' } },
            required: ['name', 'expression'],
            additionalProperties: false,
          },
        },
      },
      required: ['characters'],
      additionalProperties: false,
    },
  },
  {
    id: 'BatchedAgentAnalysis',
    source: 'apps/frontend/client/src/lib/services/agent/agents/batched_analysis_agent.ts',
    schema: {
      type: 'object',
      properties: {
        battleTrigger: { type: 'boolean' },
        relationshipChange: { type: 'string', enum: ['improve', 'worsen', 'neutral'] },
        questUpdates: { type: 'array', items: { type: 'string' } },
      },
      required: ['battleTrigger', 'relationshipChange', 'questUpdates'],
      additionalProperties: false,
    },
  },
];

describe('registry scan — TypeBox shipping schemas', () => {
  test('NpcDialogueCommandSchema is rejected: its payload carries strings and integers', () => {
    const codes = rejectCodes(NpcDialogueCommandSchema);
    expect(codes).toContain('unsupported-property-type');
  });

  test('NpcDialogueAiEnvelopeSchema is rejected: narrative is free prose and command is optional', () => {
    const codes = rejectCodes(NpcDialogueAiEnvelopeSchema);
    expect(codes).toEqual(expect.arrayContaining(['unsupported-property-type', 'optional-field']));
  });

  test('NpcDialogueExtractionSchema is rejected: both fields are optional', () => {
    expect(rejectCodes(NpcDialogueExtractionSchema)).toEqual(
      expect.arrayContaining(['optional-field']),
    );
  });

  test('NpcDialogueTurnSchema is rejected: narrative plus a bounded array', () => {
    expect(rejectCodes(NpcDialogueTurnSchema)).toEqual(
      expect.arrayContaining(['unsupported-property-type', 'unsupported-array']),
    );
  });

  test('CombatIntentDraftSchema is rejected: steps are arrays of steps', () => {
    expect(rejectCodes(CombatIntentDraftSchema)).toEqual(
      expect.arrayContaining(['unsupported-array']),
    );
  });

  test('CombatEventEnvelopeSchema is rejected: it carries a free-form event payload', () => {
    expect(rejectCodes(CombatEventEnvelopeSchema)).not.toHaveLength(0);
  });

  test('NpcSuggestionChipSchema is rejected: ids, labels and prefill text are all free strings', () => {
    expect(rejectCodes(NpcSuggestionChipSchema)).toEqual(
      expect.arrayContaining(['unsupported-property-type']),
    );
  });

  test('the bounded SKILL union compiles on its own — the pilot is built from exactly this shape', () => {
    const bare = analyzeDecisionSchema({ schema: NpcDialogueSkillSchema });
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.plan.questions[0]?.path).toEqual([]);
      expect(bare.plan.questions[0]?.options).toHaveLength(3);
    }

    const wrapped = {
      type: 'object',
      properties: { skill: NpcDialogueSkillSchema },
      required: ['skill'],
      additionalProperties: false,
    };
    const wrappedAnalysis = analyzeDecisionSchema({ schema: wrapped });
    expect(wrappedAnalysis.ok).toBe(true);
    if (wrappedAnalysis.ok) {
      expect(
        wrappedAnalysis.plan.questions[0]?.options?.map((option) => option.value).sort(),
      ).toEqual(['Intimidation', 'Persuasion', 'Sleight_of_Hand']);
    }
  });

  test('the suggestion-chip intent union compiles inside a closed object', () => {
    const wrapped = {
      type: 'object',
      properties: { intentType: NpcSuggestionChipIntentTypeSchema },
      required: ['intentType'],
      additionalProperties: false,
    };
    const analysis = analyzeDecisionSchema({ schema: wrapped });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.plan.questions[0]?.options).toHaveLength(5);
    }
  });

  test('the probe schema is the shipping command kinds PLUS an explicit `none`', () => {
    const analysis = analyzeDecisionSchema({ schema: NPC_COMMAND_KIND_SCHEMA });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.plan.questions).toHaveLength(1);
      const shippingKinds = NpcDialogueCommandSchema.anyOf.map(
        (branch) => branch.properties.kind.const,
      );
      const probeKinds = analysis.plan.questions[0]?.options?.map((option) => option.value) ?? [];
      // Every shipping kind is offered...
      for (const kind of shippingKinds) {
        expect(probeKinds).toContain(kind);
      }
      // ...and so is `none`, because `NpcDialogueAiEnvelopeSchema` types
      // `command` as optional. A discriminator that structurally cannot say
      // "nothing is warranted" measures something the game never does.
      expect(probeKinds).toContain(NPC_COMMAND_KIND_NONE);
      expect(probeKinds).toHaveLength(shippingKinds.length + 1);
      expect(analysis.plan.constants).toHaveLength(0);
    }
  });
});

describe('registry scan — inline agent schemas', () => {
  test('every inline agent schema is rejected, each for a stated reason', () => {
    const verdicts = INLINE_AGENT_SCHEMAS.map((entry) => ({
      id: entry.id,
      codes: rejectCodes(entry.schema),
    }));
    expect(verdicts.length).toBe(INLINE_AGENT_SCHEMAS.length);
    for (const verdict of verdicts) {
      expect(verdict.codes.length).toBeGreaterThan(0);
    }
    const byId = new Map(verdicts.map((verdict) => [verdict.id, verdict.codes]));
    expect(byId.get('BattleTrigger')).toContain('unsupported-property-type');
    expect(byId.get('Relationship')).toContain('unsupported-property-type');
    expect(byId.get('Expression')).toContain('unsupported-array');
    expect(byId.get('BatchedAgentAnalysis')).toEqual(['unsupported-array']);
  });

  test('an agent schema becomes eligible only once its free-text fields are removed', () => {
    // This is the shape a decision model could actually serve, and it is
    // NARROWER than the schema the agent really has to fill. The gap is the
    // finding: the eligible schema is not the shipping schema.
    const battleOnly = {
      type: 'object',
      properties: { battle: { type: 'boolean' } },
      required: ['battle'],
      additionalProperties: false,
    };
    const analysis = analyzeDecisionSchema({ schema: battleOnly });
    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.plan.questions[0]?.kind).toBe('boolean');
    }
  });
});
