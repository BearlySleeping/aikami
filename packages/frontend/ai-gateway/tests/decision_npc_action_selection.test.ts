// packages/frontend/ai-gateway/tests/decision_npc_action_selection.test.ts
//
// The `npc-action-selection` task contract and its corpus (issue #381, lane C).
//
// The corpus checks here are the ones the task exists to make possible. The
// probe's corpus could not assert them, because its options carried no ids.

import { describe, expect, it } from 'bun:test';
import { analyzeDecisionSchema } from '../src/lib/decision/index.ts';
import {
  loadNpcActionSelectionCorpus,
  NPC_ACTION_SELECTION_HELDOUT,
} from '../src/lib/decision/tasks/fixtures.ts';
import {
  isStateChangingAction,
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_COMPARATOR,
  NPC_ACTION_SELECTION_LATENCY_GATE,
  NPC_ACTION_SELECTION_POLICY,
  NPC_ACTION_SELECTION_QUALITY_GATE,
  NPC_ACTION_SELECTION_SCHEMA,
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
  parseActionLiteral,
} from '../src/lib/decision/tasks/npc_action_selection.ts';

const corpus = loadNpcActionSelectionCorpus();

describe('the task contract', () => {
  it('compiles: one closed choice over the canonical literal space', () => {
    const analysis = analyzeDecisionSchema({
      schema: NPC_ACTION_SELECTION_SCHEMA as unknown as Record<string, unknown>,
    });
    expect(analysis.ok).toBe(true);
  });

  it('expresses `none` as a first-class literal, not a sentinel', () => {
    // A schema that structurally cannot say "no action" measures something the
    // game never does, because most turns warrant nothing.
    expect(parseActionLiteral(NPC_ACTION_NONE_ID).kind).toBe('none');
    expect(isStateChangingAction(NPC_ACTION_NONE_ID)).toBe(false);
    expect(isStateChangingAction('offerQuest:fading_ward')).toBe(true);
  });

  it('splits a payload-bearing literal into kind and payload id', () => {
    expect(parseActionLiteral('giveItem:healthPotion')).toEqual({
      kind: 'giveItem',
      payloadId: 'healthPotion',
    });
    expect(parseActionLiteral('trade')).toEqual({ kind: 'trade' });
  });

  it('every canonical literal carries a real content-pack id', () => {
    // The point of the task: no option is a bare invented identifier.
    const questLiterals = [
      'offerQuest:fading_ward',
      'offerQuest:tools_for_tomorrow',
      'offerQuest:a_room_kept_warm',
    ];
    for (const literal of questLiterals) {
      expect(parseActionLiteral(literal).payloadId).toBeTruthy();
    }
  });

  it('declares a selective-acceptance policy, because a legal key is not a correct answer', () => {
    expect(NPC_ACTION_SELECTION_POLICY.choicePolicy).toBeDefined();
    expect(NPC_ACTION_SELECTION_POLICY.choicePolicy?.fallback).toBe('reject');
  });

  it('keeps skillCheck out of the literal space, because it is not enumerable', () => {
    // 3 skills x 16 DCs would put 48 legal-but-meaningless options in front of
    // the model. The omission is stated, not silent.
    expect(NPC_ACTION_SELECTION_POLICY.instructions).toBeTruthy();
    const schema = NPC_ACTION_SELECTION_SCHEMA as unknown as Record<string, unknown>;
    expect(JSON.stringify(schema)).not.toContain('skillCheck');
  });
});

describe('policy construction', () => {
  it('refuses a candidate set where some option has no description', () => {
    // An undescribed option is a per-turn enumeration bug; failing here names
    // the bug instead of surfacing it later as a backend refusal.
    expect(() =>
      npcActionSelectionPolicy(['none', 'offerQuest:fading_ward'], { none: 'take nothing' }),
    ).toThrow(/no option description/);
  });

  it('builds a schema over exactly the literals it is given', () => {
    const schema = npcActionSelectionSchema(['none', 'trade']) as unknown as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(schema)).toContain('trade');
    expect(JSON.stringify(schema)).not.toContain('giveItem');
  });
});

describe('the comparator declares which output is graded', () => {
  it('reads actionId, and refuses to guess at anything else', () => {
    expect(NPC_ACTION_SELECTION_COMPARATOR({ actionId: 'none' })).toBe('none');
    expect(NPC_ACTION_SELECTION_COMPARATOR({ actionId: 42 })).toBeUndefined();
    expect(NPC_ACTION_SELECTION_COMPARATOR({ somethingElse: 'none' })).toBeUndefined();
  });
});

describe('the corpus', () => {
  it('passes integrity: no duplicate ids across splits, no contradictory labels', () => {
    expect(corpus.problems).toEqual([]);
  });

  it("never labels a case with an option that case's NPC was not offered", () => {
    // This is the check the probe's corpus could not make. It is the whole
    // reason candidates carry payload ids.
    for (const cases of Object.values(corpus.splits)) {
      for (const testCase of cases) {
        if (testCase.expected === null) {
          continue;
        }
        expect(testCase.options.map((option) => option.id)).toContain(testCase.expected);
      }
    }
  });

  it('offers `none` in every case, so "nothing is warranted" is always expressible', () => {
    for (const cases of Object.values(corpus.splits)) {
      for (const testCase of cases) {
        expect(testCase.options.map((option) => option.id)).toContain(NPC_ACTION_NONE_ID);
      }
    }
  });

  it('labels required-abstention cases with nothing, and positives with an action', () => {
    for (const cases of Object.values(corpus.splits)) {
      for (const testCase of cases) {
        if (testCase.kind === 'required-abstain') {
          expect(testCase.expected).toBeNull();
        }
        if (testCase.kind === 'positive') {
          expect(testCase.expected).not.toBeNull();
          expect(isStateChangingAction(testCase.expected ?? NPC_ACTION_NONE_ID)).toBe(true);
        }
      }
    }
  });

  it('includes adversarial negatives: a player asking for something the npc cannot give', () => {
    // These are the cases that make a false acceptance an actual bug rather
    // than a wrong label. They are also where the shipping path is weakest.
    const all = [...corpus.splits.dev, ...corpus.splits.heldout];
    const adversarial = all.filter(
      (testCase) => testCase.category === 'wrong-npc' || testCase.category === 'not-vendor',
    );
    expect(adversarial.length).toBeGreaterThanOrEqual(10);
  });

  it('is large enough for the held-out split to establish its own warm percentile', () => {
    // MIN_REPETITIONS_FOR_PERCENTILE is 20, and the split also carries its own
    // cold samples and warmup discards. Reporting a p95 over fewer than this is
    // rounding the maximum.
    expect(corpus.splits.heldout.length).toBeGreaterThanOrEqual(26);
  });

  it('does not leak a case id between dev and heldout', () => {
    const devIds = new Set(corpus.splits.dev.map((testCase) => testCase.caseId));
    for (const testCase of corpus.splits.heldout) {
      expect(devIds.has(testCase.caseId)).toBe(false);
    }
  });

  it('states its own limitations rather than claiming held-out generalisation', () => {
    // Authored labels grade agreement with an authored specification. Saying so
    // in the corpus is what keeps the report honest.
    expect(NPC_ACTION_SELECTION_HELDOUT.labelProvenance.limitations.join(' ')).toMatch(/authored/i);
  });
});

describe('the gates were declared, not fitted', () => {
  it('demands zero false acceptances, because a false acceptance is a real mutation', () => {
    expect(NPC_ACTION_SELECTION_QUALITY_GATE.maxFalseAcceptances).toBe(0);
    expect(NPC_ACTION_SELECTION_QUALITY_GATE.maxFalseAcceptanceRate).toBeLessThanOrEqual(0.05);
  });

  it('requires every produced value to satisfy the original schema', () => {
    expect(NPC_ACTION_SELECTION_QUALITY_GATE.minLegalValueRate).toBe(1);
  });

  it('anchors latency to the interaction, with cold load included not excluded', () => {
    expect(NPC_ACTION_SELECTION_LATENCY_GATE.maxWarmP50Ms).toBeLessThanOrEqual(250);
    expect(NPC_ACTION_SELECTION_LATENCY_GATE.maxWarmP95Ms).toBeLessThanOrEqual(750);
    expect(NPC_ACTION_SELECTION_LATENCY_GATE.maxColdP95Ms).toBeGreaterThan(
      NPC_ACTION_SELECTION_LATENCY_GATE.maxWarmP95Ms,
    );
  });

  it('pins a task version so a changed literal space invalidates a qualification', () => {
    expect(NPC_ACTION_SELECTION_TASK_VERSION).toBe(1);
    expect(NPC_ACTION_SELECTION_TASK_ID).toBe('npc-action-selection');
  });
});
