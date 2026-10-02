// packages/frontend/ai-gateway/tests/decision_evaluation.test.ts
//
// The frozen corpus, the frozen gates, and the baseline they are meant to beat.
//
// What this test proves, and what it deliberately does not:
//
//   PROVES — the corpus is internally consistent, the labels match the task's
//            own option descriptions, the gates are actually enforced, and the
//            control adapter does NOT clear them.
//
//   PROVES NOTHING about any decision model. No live backend is contacted here.
//            A mock adapter proves the harness; it is not evidence about a
//            checkpoint. The evaluator CLI produces that evidence, and an
//            unreachable backend is reported as unavailable rather than scored.
//
// The metrics come from `metrics.ts`, the same module the evaluator and the live
// measurement use. There is no second scorer here to drift.

import { describe, expect, test } from 'bun:test';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  createDeterministicDecisionAdapter,
  type DecisionPlan,
  evaluateQualityGates,
  evaluateSplit,
} from '../src/lib/decision/index.ts';
import {
  loadDecisionCorpus,
  NPC_COMMAND_KIND_COMPARATOR,
  NPC_COMMAND_KIND_DEV,
  NPC_COMMAND_KIND_HELDOUT,
  NPC_COMMAND_KIND_LATENCY_GATE,
  NPC_COMMAND_KIND_LITERALS,
  NPC_COMMAND_KIND_NONE,
  NPC_COMMAND_KIND_OPTION_DESCRIPTIONS,
  NPC_COMMAND_KIND_POLICY,
  NPC_COMMAND_KIND_QUALITY_GATE,
  NPC_COMMAND_KIND_SCHEMA,
} from '../src/lib/decision/tasks/index.ts';

/**
 * The deterministic baseline lexicon.
 *
 * Authored for the task and deliberately incomplete: general surface cues only,
 * no fixture-specific nouns, and it abstains on everything else. This is the
 * control — it exists to be beaten, and its numbers are the honest floor for
 * "no model at all" on this corpus.
 */
const BASELINE_RULES = {
  rules: {
    commandKind: [
      {
        match: ['buy', 'sell', 'trade', 'shop', 'price', 'cost', 'purchase'],
        value: 'trade',
        weight: 1,
      },
      {
        match: ['join', 'recruit', 'party', 'ride with', 'walk with', 'come with'],
        value: 'recruit',
        weight: 1,
      },
      {
        match: ['evidence', 'proof', 'seal', 'sigil', 'here, take it', 'here it is'],
        value: 'presentEvidence',
        weight: 1,
      },
      {
        match: ['roll', 'persuade', 'sneak', 'sleight', 'intimidate', 'skill check'],
        value: 'skillCheck',
        weight: 1,
      },
      {
        match: ['waterskin', 'rations', 'cup of water', 'spare'],
        value: 'giveItem',
        weight: 1,
      },
    ],
  },
} as const;

/** The plan, compiled and bound once. */
const plan = (): DecisionPlan => {
  const analysis = analyzeDecisionSchema({ schema: NPC_COMMAND_KIND_SCHEMA });
  if (!analysis.ok) {
    throw new Error('the frozen task schema must compile');
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: NPC_COMMAND_KIND_POLICY });
  if (!binding.ok) {
    throw new Error('the frozen task policy must bind');
  }
  return binding.plan;
};

/** Scores one split of the real corpus with the deterministic control. */
const score = (split: 'dev' | 'heldout') =>
  evaluateSplit({
    split,
    cases: (split === 'dev' ? NPC_COMMAND_KIND_DEV : NPC_COMMAND_KIND_HELDOUT).cases,
    adapter: createDeterministicDecisionAdapter({ rules: BASELINE_RULES }),
    plan: plan(),
    schema: NPC_COMMAND_KIND_SCHEMA as Record<string, unknown>,
    policy: NPC_COMMAND_KIND_POLICY,
    timeoutMs: 2_000,
    compareValue: NPC_COMMAND_KIND_COMPARATOR,
    safeLiteral: NPC_COMMAND_KIND_NONE,
  });

describe('corpus integrity', () => {
  test('the loader reports no contradictions', () => {
    expect(loadDecisionCorpus().problems).toEqual([]);
  });

  test('both splits exist and are non-empty, and no case appears in both', () => {
    expect(NPC_COMMAND_KIND_DEV.cases.length).toBeGreaterThan(0);
    expect(NPC_COMMAND_KIND_HELDOUT.cases.length).toBeGreaterThan(0);
    const ids = [...NPC_COMMAND_KIND_DEV.cases, ...NPC_COMMAND_KIND_HELDOUT.cases].map(
      (testCase) => testCase.caseId,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every non-null label is a literal the task offers, and every literal is described', () => {
    for (const testCase of [...NPC_COMMAND_KIND_DEV.cases, ...NPC_COMMAND_KIND_HELDOUT.cases]) {
      if (testCase.expected !== null) {
        expect(NPC_COMMAND_KIND_LITERALS).toContain(testCase.expected as never);
      }
    }
    for (const literal of NPC_COMMAND_KIND_LITERALS) {
      expect(NPC_COMMAND_KIND_OPTION_DESCRIPTIONS[literal]).toBeTruthy();
    }
  });

  test('the corpus covers every required category in both splits', () => {
    const required = [
      'clear-intent',
      'ambiguous',
      'negation',
      'multiple-actions',
      'unsupported-action',
      'invented-fantasy-names',
      'unseen-packs',
      'misleading-quote',
      'correlated-fields',
      'out-of-scope',
      'out-of-scope-language',
      'reversed-action-direction',
      'authored-in-product',
    ];
    for (const split of [NPC_COMMAND_KIND_DEV, NPC_COMMAND_KIND_HELDOUT]) {
      const categories = new Set(split.cases.map((testCase) => testCase.category));
      for (const category of required) {
        expect(categories.has(category)).toBe(true);
      }
    }
  });

  test('every corpus case has an explicit case kind', () => {
    for (const testCase of [...NPC_COMMAND_KIND_DEV.cases, ...NPC_COMMAND_KIND_HELDOUT.cases]) {
      expect(['positive', 'required-abstain', 'excluded']).toContain(testCase.kind);
    }
  });
});

describe('the two semantic corrections', () => {
  test('giveItem is described in the PRODUCTION direction', () => {
    // `NpcDialogueGiveItemCommandSchema` says "Grants an item to the player.
    // Requires the NPC to possess the item." The pilot had this reversed.
    expect(NPC_COMMAND_KIND_OPTION_DESCRIPTIONS.giveItem).toContain('hand an item over to them');
    expect(NPC_COMMAND_KIND_OPTION_DESCRIPTIONS.giveItem).not.toContain(
      'player hands an item over',
    );
  });

  test('"none" exists, because the production command field is optional', () => {
    expect(NPC_COMMAND_KIND_LITERALS).toContain(NPC_COMMAND_KIND_NONE);
    expect(NPC_COMMAND_KIND_OPTION_DESCRIPTIONS.none).toContain('no command should be issued');
  });

  test('both giveItem directions are pinned in BOTH splits', () => {
    for (const split of [NPC_COMMAND_KIND_DEV, NPC_COMMAND_KIND_HELDOUT]) {
      const cases = split.cases.filter(
        (testCase) => testCase.category === 'reversed-action-direction',
      );
      expect(cases.some((testCase) => testCase.expected === 'giveItem')).toBe(true);
      expect(cases.some((testCase) => testCase.kind === 'required-abstain')).toBe(true);
    }
  });

  test('the shipped player-facing openers really do mostly require no command', () => {
    // This is the evidence for adding `none` at all: the product's own opening
    // player messages, verbatim, are overwhelmingly ordinary conversation.
    const chips = [...NPC_COMMAND_KIND_DEV.cases, ...NPC_COMMAND_KIND_HELDOUT.cases].filter(
      (testCase) => testCase.category === 'authored-in-product',
    );
    expect(chips.length).toBeGreaterThanOrEqual(18);
    const none = chips.filter((testCase) => testCase.kind === 'required-abstain');
    expect(none.length / chips.length).toBeGreaterThan(0.5);
  });

  test('the corpus states its own limitations for the report to cite', () => {
    expect(NPC_COMMAND_KIND_HELDOUT.labelProvenance.limitations.length).toBeGreaterThan(0);
    expect(NPC_COMMAND_KIND_HELDOUT.labelProvenance.limitations.join('\n')).toContain(
      'necessary, not sufficient',
    );
  });
});

describe('the control does not clear the frozen gate', () => {
  test('the deterministic baseline is measured over the held-out split', async () => {
    const report = await score('heldout');
    expect(report.overall.attempted).toBe(NPC_COMMAND_KIND_HELDOUT.cases.length);
    expect(report.overall.positives).toBeGreaterThan(0);
    expect(report.overall.requiredAbstention).toBeGreaterThan(0);
    expect(report.overall.legalValueRate).toBe(NPC_COMMAND_KIND_QUALITY_GATE.minLegalValueRate);
  });

  test('it fails the gate — which is the point of shipping a control', async () => {
    const report = await score('heldout');
    const failures = evaluateQualityGates(report, NPC_COMMAND_KIND_QUALITY_GATE);
    expect(failures.length).toBeGreaterThan(0);
  });

  test('it also fails on the development split, so the split is not rigged', async () => {
    const dev = await score('dev');
    expect(dev.overall.attempted).toBe(NPC_COMMAND_KIND_DEV.cases.length);
    expect(evaluateQualityGates(dev, NPC_COMMAND_KIND_QUALITY_GATE).length).toBeGreaterThan(0);
  });

  test('no produced value escapes the original schema', async () => {
    const report = await score('heldout');
    for (const split of report.outcomes) {
      if (split.accepted) {
        expect(split.schemaValid).toBe(true);
      }
    }
  });
});

describe('the frozen gates', () => {
  test('positive recall is the gate and answered-positive accuracy is only a diagnostic', () => {
    expect(NPC_COMMAND_KIND_QUALITY_GATE.minPositiveRecall).toBeGreaterThan(0);
    expect(NPC_COMMAND_KIND_QUALITY_GATE.maxFalseAcceptances).toBe(0);
    expect(NPC_COMMAND_KIND_QUALITY_GATE.maxFalseAcceptanceRate).toBeLessThan(0.1);
  });

  test('the latency gate is stated in the units a caller budget is measured in', () => {
    expect(NPC_COMMAND_KIND_LATENCY_GATE.maxWarmP50Ms).toBeLessThan(
      NPC_COMMAND_KIND_LATENCY_GATE.maxWarmP95Ms,
    );
    expect(NPC_COMMAND_KIND_LATENCY_GATE.maxWarmP95Ms).toBeLessThan(
      NPC_COMMAND_KIND_LATENCY_GATE.maxColdP95Ms,
    );
  });

  test('only English is declared, and other slices must abstain rather than answer', () => {
    expect(NPC_COMMAND_KIND_POLICY.language).toBe('en');
    expect(Object.keys(NPC_COMMAND_KIND_QUALITY_GATE.minLanguageRecall ?? {})).toEqual(['en']);
  });

  test('the task declares a choice policy, because a legal key is not a correct answer', () => {
    expect(NPC_COMMAND_KIND_POLICY.choicePolicy).toBeDefined();
  });
});
