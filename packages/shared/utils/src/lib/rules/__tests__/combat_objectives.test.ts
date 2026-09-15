// packages/shared/utils/src/lib/rules/__tests__/combat_objectives.test.ts
//
// AC-1: objectives resolve from authored rules with explicit precedence.
//
// Boundary coverage: initial boundary, last valid boundary, first expired
// boundary; multiple objectives; dead/missing targets; maintained conditions.
//
// Contract: C-532 AC-1

import { describe, expect, it } from 'bun:test';
import type {
  CombatantState,
  ObjectiveProgress,
  ObjectiveRules,
  ParticipationState,
} from '@aikami/types';
import {
  evaluateObjectives,
  interactionKey,
  type ObjectiveEvaluationFacts,
  projectObjectiveState,
} from '../combat_objectives';
import {
  BASE_MORALE_RULES,
  EXIT_ZONE_ID,
  GUARD_ID,
  HOUND_ID,
  makeDepthCombatants,
  PLAYER_ID,
  RITUAL_AFFORDANCE,
  RITUAL_ID,
  RITUAL_OBJECTIVE_RULES,
  ROUT_OBJECTIVE_RULES,
  WARDEN_ID,
} from './combat_depth_fixtures';

const participationFor = (
  combatants: Record<string, CombatantState>,
): Record<string, ParticipationState> =>
  Object.fromEntries(
    Object.keys(combatants).map((combatantId) => [
      combatantId,
      {
        status: 'active' as const,
        morale: BASE_MORALE_RULES.startingMorale,
        appliedTriggerIds: [],
        reactionPolicy: 'ask' as const,
      },
    ]),
  );

const facts = (
  overrides: {
    combatants?: Record<string, CombatantState>;
    participation?: Record<string, ParticipationState>;
    completedInteractions?: string[];
    completedRounds?: number;
    round?: number;
  } = {},
): ObjectiveEvaluationFacts => {
  const combatants =
    overrides.combatants ??
    Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
  return {
    combatants,
    participation: overrides.participation ?? participationFor(combatants),
    completedInteractions: new Set(overrides.completedInteractions ?? []),
    completedRounds: overrides.completedRounds ?? 0,
    round: overrides.round ?? (overrides.completedRounds ?? 0) + 1,
  };
};

const withDefeated = (combatantId: string): Record<string, CombatantState> => {
  const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
  combatants[combatantId] = { ...combatants[combatantId], defeated: true, hp: 0, downed: true };
  return combatants;
};

describe('AC-1 interact_before_deadline', () => {
  it('is pending at the initial boundary and completes on the committed interaction', () => {
    const initial = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: [],
      facts: facts(),
    });
    expect(initial.progress).toEqual([
      { objectiveId: 'objective.stop_ritual', status: 'pending', progress: 0 },
    ]);
    expect(initial.completedObjectiveIds).toEqual([]);

    const done = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: initial.progress,
      facts: facts({
        completedInteractions: [interactionKey(RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(done.progress[0].status).toBe('complete');
    expect(done.completedObjectiveIds).toEqual(['objective.stop_ritual']);
  });

  it('completes at the LAST legal boundary (deadlineRound = 3, completedRounds = 2)', () => {
    const evaluation = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: [],
      facts: facts({
        completedRounds: 2,
        completedInteractions: [interactionKey(RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(evaluation.progress[0].status).toBe('complete');
    expect(evaluation.failedObjectiveIds).toEqual([]);
  });

  it('fails at the FIRST expired boundary (completedRounds = 3) and reports the transition once', () => {
    const first = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: [],
      facts: facts({ completedRounds: 3 }),
    });
    expect(first.progress[0].status).toBe('failed');
    expect(first.failedObjectiveIds).toEqual(['objective.stop_ritual']);

    // The same boundary re-evaluated does not re-report the transition.
    const again = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: first.progress,
      facts: facts({ completedRounds: 3 }),
    });
    expect(again.failedObjectiveIds).toEqual([]);
  });

  it('stays complete once complete — the deadline cannot un-complete it', () => {
    const previous: ObjectiveProgress[] = [
      { objectiveId: 'objective.stop_ritual', status: 'complete', progress: 1 },
    ];
    const evaluation = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous,
      facts: facts({ completedRounds: 9 }),
    });
    expect(evaluation.progress[0].status).toBe('complete');
    expect(evaluation.failedObjectiveIds).toEqual([]);
  });
});

describe('AC-1 survive_rounds', () => {
  const rules: ObjectiveRules = {
    definitions: [
      {
        objectiveId: 'objective.survive',
        kind: 'survive_rounds',
        required: true,
        hidden: false,
        rule: { kind: 'survive_rounds', rounds: 2, requiredActorIds: [PLAYER_ID, GUARD_ID] },
      },
    ],
    protectedActorIds: [],
  };

  it('starting a round does not count as surviving it', () => {
    const atRoundOne = evaluateObjectives({ rules, previous: [], facts: facts({ round: 1 }) });
    expect(atRoundOne.progress[0]).toEqual({
      objectiveId: 'objective.survive',
      status: 'pending',
      progress: 0,
    });

    const afterOneCompletedRound = evaluateObjectives({
      rules,
      previous: atRoundOne.progress,
      facts: facts({ completedRounds: 1, round: 2 }),
    });
    expect(afterOneCompletedRound.progress[0].progress).toBe(1);
    expect(afterOneCompletedRound.progress[0].status).toBe('pending');
  });

  it('completes only after the declared number of COMPLETED rounds', () => {
    const evaluation = evaluateObjectives({
      rules,
      previous: [],
      facts: facts({ completedRounds: 2, round: 3 }),
    });
    expect(evaluation.progress[0].status).toBe('complete');
  });

  it('resets progress to zero when a required actor is removed', () => {
    const evaluation = evaluateObjectives({
      rules,
      previous: [],
      facts: facts({ completedRounds: 2, round: 3, combatants: withDefeated(GUARD_ID) }),
    });
    expect(evaluation.progress[0].progress).toBe(0);
    expect(evaluation.progress[0].status).toBe('pending');
  });

  it('treats a MISSING required actor as ineligible rather than as present', () => {
    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    const { [GUARD_ID]: _removed, ...withoutGuard } = combatants;
    const evaluation = evaluateObjectives({
      rules,
      previous: [],
      facts: facts({ completedRounds: 2, round: 3, combatants: withoutGuard }),
    });
    expect(evaluation.progress[0].status).toBe('pending');
  });
});

describe('AC-1 reach_zone', () => {
  const rules: ObjectiveRules = {
    definitions: [
      {
        objectiveId: 'objective.escape',
        kind: 'reach_zone',
        required: true,
        hidden: false,
        rule: {
          kind: 'reach_zone',
          zoneId: EXIT_ZONE_ID,
          cells: [{ x: 0, y: 7 }],
          requiredActorIds: [PLAYER_ID, GUARD_ID],
        },
      },
    ],
    protectedActorIds: [],
  };

  it('requires EVERY required actor to be inside the authored zone', () => {
    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    combatants[PLAYER_ID] = { ...combatants[PLAYER_ID], position: { x: 0, y: 7 } };
    const partial = evaluateObjectives({ rules, previous: [], facts: facts({ combatants }) });
    expect(partial.progress[0]).toEqual({
      objectiveId: 'objective.escape',
      status: 'pending',
      progress: 1,
    });

    combatants[GUARD_ID] = { ...combatants[GUARD_ID], position: { x: 0, y: 7 } };
    const complete = evaluateObjectives({ rules, previous: [], facts: facts({ combatants }) });
    expect(complete.progress[0].status).toBe('complete');
  });
});

describe('AC-1 defeat_or_rout', () => {
  it('counts a hostile as routed when it is defeated, surrendered or escaped', () => {
    const defeated = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [],
      facts: facts({ combatants: withDefeated(HOUND_ID) }),
    });
    expect(defeated.progress[0].status).toBe('complete');

    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    const participation = participationFor(combatants);
    participation[HOUND_ID] = { ...participation[HOUND_ID], status: 'surrendered' };
    const surrendered = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [],
      facts: facts({ combatants, participation }),
    });
    expect(surrendered.progress[0].status).toBe('complete');
  });

  it('routs on the authored morale threshold without inventing damage', () => {
    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    const participation = participationFor(combatants);
    participation[HOUND_ID] = { ...participation[HOUND_ID], morale: 20 };
    const evaluation = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [],
      facts: facts({ combatants, participation }),
    });
    expect(evaluation.progress[0].status).toBe('complete');
    expect(combatants[HOUND_ID].hp).toBe(12);
    expect(combatants[HOUND_ID].defeated).toBe(false);
  });

  it('is a MAINTAINED condition: an already-complete rout can revert to pending', () => {
    const previous: ObjectiveProgress[] = [
      { objectiveId: 'objective.rout_hounds', status: 'complete', progress: 1 },
    ];
    const evaluation = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous,
      facts: facts(),
    });
    expect(evaluation.progress[0].status).toBe('pending');
  });
});

describe('AC-1 precedence and composition', () => {
  const composed: ObjectiveRules = {
    definitions: [...RITUAL_OBJECTIVE_RULES.definitions, ...ROUT_OBJECTIVE_RULES.definitions],
    protectedActorIds: [GUARD_ID],
  };

  it('reports every objective independently in authored order', () => {
    const evaluation = evaluateObjectives({ rules: composed, previous: [], facts: facts() });
    expect(evaluation.progress.map((entry) => entry.objectiveId)).toEqual([
      'objective.stop_ritual',
      'objective.rout_hounds',
    ]);
  });

  it('a protected actor lost at the same boundary as an objective completion is a mandatory loss', () => {
    const evaluation = evaluateObjectives({
      rules: composed,
      previous: [],
      facts: facts({
        combatants: withDefeated(GUARD_ID),
        completedInteractions: [interactionKey(RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(evaluation.completedObjectiveIds).toContain('objective.stop_ritual');
    expect(evaluation.lostProtectedActorIds).toEqual([GUARD_ID]);
    expect(evaluation.mandatoryLoss).toBe(true);
  });

  it('a missing protected actor is a loss, not an exemption', () => {
    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    const { [GUARD_ID]: _removed, ...withoutGuard } = combatants;
    const evaluation = evaluateObjectives({
      rules: composed,
      previous: [],
      facts: facts({ combatants: withoutGuard }),
    });
    expect(evaluation.lostProtectedActorIds).toEqual([GUARD_ID]);
    expect(evaluation.mandatoryLoss).toBe(true);
  });

  it('reports unmet required objectives so elimination cannot bypass them', () => {
    const evaluation = evaluateObjectives({
      rules: composed,
      previous: [],
      facts: facts({ combatants: withDefeated(HOUND_ID) }),
    });
    expect(evaluation.unmetRequiredObjectiveIds).toEqual(['objective.stop_ritual']);
  });

  it('a failed required objective is a mandatory loss', () => {
    const evaluation = evaluateObjectives({
      rules: composed,
      previous: [],
      facts: facts({ completedRounds: 3 }),
    });
    expect(evaluation.failedObjectiveIds).toEqual(['objective.stop_ritual']);
    expect(evaluation.mandatoryLoss).toBe(true);
  });

  it('does not mutate the facts it was given', () => {
    const combatants = Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));
    const snapshot = structuredClone(combatants);
    const evaluationFacts = facts({ combatants, completedRounds: 3 });
    evaluateObjectives({ rules: composed, previous: [], facts: evaluationFacts });
    expect(combatants).toEqual(snapshot);
  });
});

describe('AC-1 observable projection', () => {
  it('projects authored definitions and preserves migrated legacy records', () => {
    const evaluation = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [],
      facts: facts(),
    });
    const projected = projectObjectiveState({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [
        { objectiveId: 'legacy.survival', kind: 'survival', status: 'pending', progress: 0 },
      ],
      evaluation,
    });
    expect(projected).toEqual([
      {
        objectiveId: 'legacy.survival',
        kind: 'survival',
        status: 'pending',
        progress: 0,
      },
      {
        objectiveId: 'objective.rout_hounds',
        kind: 'defeat_or_rout',
        status: 'pending',
        progress: 0,
      },
    ]);
  });

  it('keeps the authored objective kind on the projection', () => {
    const evaluation = evaluateObjectives({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: [],
      facts: facts(),
    });
    const projected = projectObjectiveState({
      rules: RITUAL_OBJECTIVE_RULES,
      previous: [],
      evaluation,
    });
    expect(projected[0].kind).toBe('interact_before_deadline');
  });
});

describe('AC-1 determinism', () => {
  it('is a pure function of its inputs — identical inputs give identical output', () => {
    const input = { rules: ROUT_OBJECTIVE_RULES, previous: [], facts: facts() };
    expect(evaluateObjectives(input)).toEqual(evaluateObjectives(input));
  });

  it('never reads the WARDEN as a required actor for a hound-only rout', () => {
    const evaluation = evaluateObjectives({
      rules: ROUT_OBJECTIVE_RULES,
      previous: [],
      facts: facts({ combatants: withDefeated(WARDEN_ID) }),
    });
    expect(evaluation.progress[0].status).toBe('pending');
  });
});
