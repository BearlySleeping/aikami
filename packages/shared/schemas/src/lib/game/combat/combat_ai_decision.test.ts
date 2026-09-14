// packages/shared/schemas/src/lib/game/combat/combat_ai_decision.test.ts
//
// C-526 AC-1: the AI decision contract is typed, bounded and selector-only.
//
//   AC-1  valid decisions/drafts pass; unknown `kind`/extra props are
//         rejected; fields are bounded; the draft cannot express ids,
//         coordinates, dice, HP or hidden entities; `intent`/`fallback`
//         reuse the C-525 `IntentStep` vocabulary
//   AC-11 the narration result is bounded and provenance-tagged
//
// Contract: C-526 AC-1, AC-11

import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import {
  AiCombatDecisionBatchDraftSchema,
  AiCombatDecisionDraftSchema,
  AiCombatDecisionSchema,
  COMBAT_AI_BOUNDS,
  COMBAT_AI_DEGRADED_REASONS,
  COMBAT_AI_TOKEN_BUDGET,
  CombatAiDecisionRecordSchema,
  CombatNarrationDraftSchema,
  CombatNarrationResultSchema,
  CompanionControlModeSchema,
  DEFAULT_COMPANION_CONTROL_MODE,
  fitsCombatDecisionTokenBudget,
} from './combat_ai_decision';
import { IntentStepSchema } from './combat_intent';

// ── Fixtures ───────────────────────────────────────────────────────────

const moveThenAttack = [
  {
    kind: 'move',
    destination: { kind: 'relative', relativeTo: { kind: 'nearest_hostile' }, band: 'melee' },
  },
  {
    kind: 'use_ability',
    ability: { kind: 'tag', value: 'basic_melee' },
    target: { kind: 'nearest_hostile' },
  },
];

const validDraft = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  goal: 'protect-the-commander',
  intent: [moveThenAttack[1]],
  fallback: [{ kind: 'defend' }],
  confidence: 'medium',
  shortReason: 'the archer is exposed',
  proposedLine: 'goblin-archer: drawing a bead on the healer',
  ...overrides,
});

const validDecision = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  decisionId: 'decision-1',
  encounterId: 'emberwatch-encounter-1',
  actorId: 'emberwatch:goblin-1',
  basedOnRevision: 7,
  ...validDraft(),
  ...overrides,
});

const validContext = (): Record<string, unknown> => ({
  actor: {
    combatantId: 'emberwatch:goblin-1',
    role: 'skirmisher',
    personality: ['vengeful', 'quick-tempered'],
    relationships: [
      { combatantId: 'emberwatch:goblin-2', stance: 'friendly' },
      { combatantId: 'player-hero', stance: 'hostile', note: 'slew my kin' },
    ],
    fears: ['fire'],
    emotionalState: 'wary',
  },
  objectives: [{ objectiveId: 'objective-1', kind: 'defeat_all_hostiles', status: 'pending' }],
  visibleCombatants: [
    {
      combatantId: 'player-hero',
      team: 'player',
      healthBand: 'bloodied',
      conditions: ['prone'],
      lastKnown: { x: 3, y: 4 },
    },
  ],
  capabilities: [
    { abilityId: 'shortbow', rangeBand: 'ranged', requiresLineOfSight: true, available: true },
  ],
  reachableTargets: [{ combatantId: 'player-hero', distanceBand: 'ranged', cover: 'partial' }],
  candidatePositions: [{ cellBand: 'north cover', risk: 'low' }],
  imminentThreats: ['player-hero closing to melee this turn'],
  morale: 'steady',
  riskTolerance: 'cautious',
  obedience: 'independent',
  difficulty: 'normal',
  recentEvents: [{ kind: 'attackRolled', summary: 'player-hero hit emberwatch:goblin-2' }],
  tokenBudget: COMBAT_AI_TOKEN_BUDGET,
});

// ── AC-1: decisions and drafts ─────────────────────────────────────────

describe('AiCombatDecisionSchema', () => {
  it('validates a well-formed decision', () => {
    expect(Value.Check(AiCombatDecisionSchema, validDecision())).toBe(true);
  });

  it('validates a multi-step move-then-attack decision', () => {
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ intent: moveThenAttack }))).toBe(
      true,
    );
  });

  it('rejects unknown envelope properties', () => {
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ hp: 12 }))).toBe(false);
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ targetId: 'player-hero' }))).toBe(
      false,
    );
  });

  it('rejects a negative revision and an empty goal', () => {
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ basedOnRevision: -1 }))).toBe(false);
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ goal: '' }))).toBe(false);
  });

  it('rejects an unknown confidence value', () => {
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ confidence: 'certain' }))).toBe(
      false,
    );
  });

  it('bounds the intent step count and the fallback step count', () => {
    const tooMany = Array.from({ length: COMBAT_AI_BOUNDS.steps + 1 }, () => ({
      kind: 'defend',
    }));
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ intent: tooMany }))).toBe(false);
    const tooManyFallback = Array.from({ length: COMBAT_AI_BOUNDS.fallbackSteps + 1 }, () => ({
      kind: 'defend',
    }));
    expect(Value.Check(AiCombatDecisionSchema, validDecision({ fallback: tooManyFallback }))).toBe(
      false,
    );
  });

  it('bounds free-text fields through COMBAT_AI_BOUNDS', () => {
    expect(
      Value.Check(
        AiCombatDecisionSchema,
        validDecision({ goal: 'g'.repeat(COMBAT_AI_BOUNDS.goalChars + 1) }),
      ),
    ).toBe(false);
    expect(
      Value.Check(
        AiCombatDecisionSchema,
        validDecision({ proposedLine: 'x'.repeat(COMBAT_AI_BOUNDS.proposedLineChars + 1) }),
      ),
    ).toBe(false);
    expect(
      Value.Check(
        AiCombatDecisionSchema,
        validDecision({ shortReason: 'x'.repeat(COMBAT_AI_BOUNDS.shortReasonChars + 1) }),
      ),
    ).toBe(false);
  });

  it('rejects an unknown IntentStep kind', () => {
    expect(
      Value.Check(AiCombatDecisionSchema, validDecision({ intent: [{ kind: 'teleport' }] })),
    ).toBe(false);
  });
});

describe('AiCombatDecisionDraftSchema', () => {
  it('validates a well-formed draft', () => {
    expect(Value.Check(AiCombatDecisionDraftSchema, validDraft())).toBe(true);
  });

  it('cannot express envelope identity (no ids, no revision, no encounter)', () => {
    for (const injected of [
      { decisionId: 'decision-1' },
      { actorId: 'emberwatch:goblin-1' },
      { encounterId: 'emberwatch-encounter-1' },
      { basedOnRevision: 7 },
      { source: 'llm' },
    ]) {
      expect(Value.Check(AiCombatDecisionDraftSchema, validDraft(injected))).toBe(false);
    }
  });

  it('cannot express coordinates, dice or HP in a step', () => {
    expect(
      Value.Check(
        AiCombatDecisionDraftSchema,
        validDraft({ intent: [{ kind: 'move', cell: { x: 3, y: 4 } }] }),
      ),
    ).toBe(false);
    expect(
      Value.Check(
        AiCombatDecisionDraftSchema,
        validDraft({
          intent: [
            {
              kind: 'use_ability',
              ability: { kind: 'tag', value: 'shortbow' },
              target: { kind: 'explicit', combatantId: 'player-hero' },
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(Value.Check(AiCombatDecisionDraftSchema, validDraft({ hp: 4 }))).toBe(false);
    expect(Value.Check(AiCombatDecisionDraftSchema, validDraft({ damage: '2d6' }))).toBe(false);
  });

  it('reuses the C-525 IntentStep vocabulary', () => {
    for (const step of [
      ...moveThenAttack,
      { kind: 'defend' },
      { kind: 'wait' },
      { kind: 'end_turn' },
      {
        kind: 'move',
        destination: { kind: 'nearest_safe' },
        stopAt: 'ranged',
      },
    ]) {
      expect(Value.Check(IntentStepSchema, step)).toBe(true);
    }
  });

  it('bounds every free-text field', () => {
    expect(
      Value.Check(
        AiCombatDecisionDraftSchema,
        validDraft({ proposedLine: 'x'.repeat(COMBAT_AI_BOUNDS.proposedLineChars + 1) }),
      ),
    ).toBe(false);
    expect(Value.Check(AiCombatDecisionDraftSchema, validDraft({ goal: '' }))).toBe(false);
  });
});

describe('AiCombatDecisionBatchDraftSchema', () => {
  it('bounds actor key length and batch size', () => {
    expect(
      Value.Check(AiCombatDecisionBatchDraftSchema, {
        decisions: { ['x'.repeat(COMBAT_AI_BOUNDS.decisionIdChars + 1)]: validDraft() },
      }),
    ).toBe(false);
    expect(
      Value.Check(AiCombatDecisionBatchDraftSchema, {
        decisions: Object.fromEntries(
          Array.from({ length: COMBAT_AI_BOUNDS.visibleCombatants + 1 }, (_, index) => [
            `actor-${index}`,
            validDraft(),
          ]),
        ),
      }),
    ).toBe(false);
  });
});

// ── AC-11: the narrator's only authorable shape ────────────────────────

describe('CombatNarrationDraftSchema (AC-11)', () => {
  it('accepts referenced claims plus an optional inert flavour sentence', () => {
    expect(
      Value.Check(CombatNarrationDraftSchema, {
        claims: [{ kind: 'attack', index: 0 }, { kind: 'defeated', index: 1 }, { kind: 'ended' }],
        flavor: 'Steel rings against packed earth.',
      }),
    ).toBe(true);
    expect(Value.Check(CombatNarrationDraftSchema, { claims: [] })).toBe(true);
  });

  it('cannot express mechanical wording, numbers, conditions or extra fields', () => {
    // There is no field for prose mechanics — the whole point of the repair.
    expect(Value.Check(CombatNarrationDraftSchema, { text: 'The goblin dies.' })).toBe(false);
    expect(Value.Check(CombatNarrationDraftSchema, { claims: [], hp: 3 })).toBe(false);
    expect(
      Value.Check(CombatNarrationDraftSchema, {
        claims: [{ kind: 'damage', index: 0, amount: 9 }],
      }),
    ).toBe(false);
    expect(
      Value.Check(CombatNarrationDraftSchema, { claims: [{ kind: 'invented', index: 0 }] }),
    ).toBe(false);
  });

  it('bounds the claim count and the fact index', () => {
    const many = Array.from({ length: COMBAT_AI_BOUNDS.narrationClaims + 1 }, () => ({
      kind: 'attack' as const,
      index: 0,
    }));
    expect(Value.Check(CombatNarrationDraftSchema, { claims: many })).toBe(false);
    expect(
      Value.Check(CombatNarrationDraftSchema, {
        claims: [{ kind: 'attack', index: COMBAT_AI_BOUNDS.narrationFactIndexMax + 1 }],
      }),
    ).toBe(false);
    expect(
      Value.Check(CombatNarrationDraftSchema, { claims: [{ kind: 'attack', index: -1 }] }),
    ).toBe(false);
  });

  it('bounds the flavour sentence separately from full narration length', () => {
    expect(
      Value.Check(CombatNarrationDraftSchema, {
        claims: [],
        flavor: 'x'.repeat(COMBAT_AI_BOUNDS.narrationFlavorChars + 1),
      }),
    ).toBe(false);
    expect(
      Value.Check(CombatNarrationDraftSchema, {
        claims: [],
        flavor: 'x'.repeat(COMBAT_AI_BOUNDS.narrationFlavorChars),
      }),
    ).toBe(true);
  });
});

// ── AC-2: context shape ────────────────────────────────────────────────

describe('fitsCombatDecisionTokenBudget', () => {
  it('accepts a serialized context within the budget', () => {
    const context = validContext();
    expect(
      fitsCombatDecisionTokenBudget({
        // guard-ignore lint/type-safety/casting: test fixture is schema-valid by construction
        context: context as never,
        tokenBudget: 100_000,
      }),
    ).toBe(true);
  });

  it('rejects a serialized context over the budget', () => {
    const context = validContext();
    expect(
      fitsCombatDecisionTokenBudget({
        // guard-ignore lint/type-safety/casting: test fixture is schema-valid by construction
        context: context as never,
        tokenBudget: 1,
      }),
    ).toBe(false);
  });
});

// ── AC-6: companion control mode ───────────────────────────────────────

describe('CompanionControlModeSchema', () => {
  it('accepts every documented mode and defaults to suggest', () => {
    for (const mode of ['direct', 'suggest', 'intent', 'autonomous']) {
      expect(Value.Check(CompanionControlModeSchema, mode)).toBe(true);
    }
    expect(DEFAULT_COMPANION_CONTROL_MODE).toBe('suggest');
  });

  it('rejects an unknown mode', () => {
    expect(Value.Check(CompanionControlModeSchema, 'puppet')).toBe(false);
  });
});

// ── AC-3 / AC-7: telemetry and degradation reasons ─────────────────────

describe('CombatAiDecisionRecordSchema', () => {
  it('validates an llm record with provider/model and a fallback record with a reason', () => {
    expect(
      Value.Check(CombatAiDecisionRecordSchema, {
        decisionId: 'decision-1',
        encounterId: 'emberwatch-encounter-1',
        actorId: 'emberwatch:goblin-1',
        basedOnRevision: 7,
        source: 'llm',
        provider: 'local',
        model: 'qwen3-4b',
        latencyMs: 412,
        goal: 'protect-the-commander',
        confidence: 'high',
        rationale: 'the healer was exposed',
      }),
    ).toBe(true);
    expect(
      Value.Check(CombatAiDecisionRecordSchema, {
        decisionId: 'decision-2',
        encounterId: 'emberwatch-encounter-1',
        actorId: 'emberwatch:goblin-1',
        basedOnRevision: 7,
        source: 'fallback',
        latencyMs: 1500,
        fallbackReason: 'timeout',
      }),
    ).toBe(true);
  });

  it('rejects an unknown fallback reason and a negative latency', () => {
    expect(
      Value.Check(CombatAiDecisionRecordSchema, {
        decisionId: 'decision-3',
        encounterId: 'enc',
        actorId: 'a',
        basedOnRevision: 0,
        source: 'fallback',
        latencyMs: -1,
      }),
    ).toBe(false);
    expect(
      Value.Check(CombatAiDecisionRecordSchema, {
        decisionId: 'decision-4',
        encounterId: 'enc',
        actorId: 'a',
        basedOnRevision: 0,
        source: 'fallback',
        latencyMs: 1,
        fallbackReason: 'confused',
      }),
    ).toBe(false);
  });
});

describe('COMBAT_AI_DEGRADED_REASONS', () => {
  it('covers disabled, offline, timeout, invalid, stale and cancelled', () => {
    expect([...COMBAT_AI_DEGRADED_REASONS].sort()).toEqual(
      ['cancelled', 'disabled', 'invalid', 'offline', 'stale', 'timeout'].sort(),
    );
  });
});

// ── AC-11: narration result ────────────────────────────────────────────

describe('CombatNarrationResultSchema', () => {
  it('validates an llm result and a template result', () => {
    expect(
      Value.Check(CombatNarrationResultSchema, {
        narrationId: 'narration-1',
        encounterId: 'emberwatch-encounter-1',
        basedOnRevision: 8,
        source: 'llm',
        text: 'The goblin scatters back as the blade bites deep.',
      }),
    ).toBe(true);
    expect(
      Value.Check(CombatNarrationResultSchema, {
        narrationId: 'narration-2',
        encounterId: 'emberwatch-encounter-1',
        basedOnRevision: 8,
        source: 'template',
        text: 'The blow lands.',
      }),
    ).toBe(true);
  });

  it('rejects an unknown source and an over-long text block', () => {
    expect(
      Value.Check(CombatNarrationResultSchema, {
        narrationId: 'narration-3',
        encounterId: 'enc',
        basedOnRevision: 0,
        source: 'authored',
        text: 'x',
      }),
    ).toBe(false);
    expect(
      Value.Check(CombatNarrationResultSchema, {
        narrationId: 'narration-4',
        encounterId: 'enc',
        basedOnRevision: 0,
        source: 'llm',
        text: 'x'.repeat(COMBAT_AI_BOUNDS.narrationTextChars + 1),
      }),
    ).toBe(false);
  });
});
