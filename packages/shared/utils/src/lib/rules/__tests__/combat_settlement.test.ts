// packages/shared/utils/src/lib/rules/__tests__/combat_settlement.test.ts
//
// AC-5: encounter settlement and exploration handoff happen once.
//
// Covers: exactly-once settlement, mandatory-loss precedence, nonlethal
// results (rout / surrender / escape), the required-objective guard against
// the default elimination victory, deterministic settlement identity, and the
// documented boolean projection.
//
// Contract: C-532 AC-5

import { describe, expect, it } from 'bun:test';
import { EncounterSettlementSchema, settlementToVictoryProjection } from '@aikami/schemas';
import type {
  CombatantState,
  EncounterSettlement,
  ObjectiveRules,
  ParticipationState,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { isInExitZone } from '../combat_morale';
import { interactionKey, type ObjectiveEvaluationFacts } from '../combat_objectives';
import { settleEncounter, settlementIdFor } from '../combat_settlement';
import {
  BASE_MORALE_RULES,
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

const roster = (): Record<string, CombatantState> =>
  Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));

const participation = (
  overrides: Record<string, Partial<ParticipationState>> = {},
): Record<string, ParticipationState> =>
  Object.fromEntries(
    Object.keys(roster()).map((combatantId) => [
      combatantId,
      {
        status: 'active' as const,
        morale: BASE_MORALE_RULES.startingMorale,
        appliedTriggerIds: [],
        reactionPolicy: 'ask' as const,
        ...(overrides[combatantId] ?? {}),
      },
    ]),
  );

const facts = (
  overrides: {
    combatants?: Record<string, CombatantState>;
    participation?: Record<string, ParticipationState>;
    completedInteractions?: string[];
    completedRounds?: number;
  } = {},
): ObjectiveEvaluationFacts => {
  const combatants = overrides.combatants ?? roster();
  return {
    combatants,
    participation: overrides.participation ?? participation(),
    completedInteractions: new Set(overrides.completedInteractions ?? []),
    completedRounds: overrides.completedRounds ?? 0,
    round: (overrides.completedRounds ?? 0) + 1,
  };
};

const settle = (options: {
  rules: ObjectiveRules;
  previousProgress?: never[];
  facts: ObjectiveEvaluationFacts;
  existing?: EncounterSettlement | null;
}) =>
  settleEncounter({
    encounterId: 'emberwatch-encounter-1',
    stateRevision: 7,
    round: options.facts.round,
    rules: options.rules,
    previousProgress: options.previousProgress ?? [],
    facts: options.facts,
    existing: options.existing ?? null,
  });

describe('AC-5 the default elimination victory (no authored objectives)', () => {
  const noRules: ObjectiveRules = { definitions: [], protectedActorIds: [] };

  it('settles a victory once every hostile is defeated', () => {
    const combatants = roster();
    for (const id of [HOUND_ID, WARDEN_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const result = settle({ rules: noRules, facts: facts({ combatants }) });
    expect(result.settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'all_enemies_defeated',
    });
    expect(result.settlement?.rewardApplied).toBe(false);
  });

  it('settles a defeat when the whole party is down', () => {
    const combatants = roster();
    for (const id of [PLAYER_ID, GUARD_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const result = settle({ rules: noRules, facts: facts({ combatants }) });
    expect(result.settlement).toMatchObject({ result: 'defeat', reasonCode: 'party_defeated' });
  });

  it('settles nothing while the encounter is still live', () => {
    expect(settle({ rules: noRules, facts: facts() }).settlement).toBeNull();
  });
});

describe('AC-5 required objectives guard the elimination default', () => {
  it('does NOT settle a victory from elimination while a required objective is unmet', () => {
    const combatants = roster();
    for (const id of [HOUND_ID, WARDEN_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const result = settle({
      rules: RITUAL_OBJECTIVE_RULES,
      facts: facts({ combatants }),
    });
    expect(result.settlement).toBeNull();
    expect(result.objectiveProgress[0].status).toBe('pending');
  });

  it('settles a victory once the required objective completes', () => {
    const result = settle({
      rules: RITUAL_OBJECTIVE_RULES,
      facts: facts({
        completedInteractions: [interactionKey(PLAYER_ID, RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(result.settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'objective_completed',
    });
  });

  it('requires every authored required objective to complete', () => {
    const rules: ObjectiveRules = {
      definitions: [
        ...RITUAL_OBJECTIVE_RULES.definitions,
        ...ROUT_OBJECTIVE_RULES.definitions.map((definition) => ({
          ...definition,
          required: true,
        })),
      ],
      protectedActorIds: [],
    };
    const result = settle({
      rules,
      facts: facts({
        completedInteractions: [interactionKey(PLAYER_ID, RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(result.objectiveProgress.map((entry) => entry.status)).toEqual(['complete', 'pending']);
    expect(result.settlement).toBeNull();
  });

  it('allows elimination fallback when only optional objectives are incomplete', () => {
    const combatants = roster();
    for (const id of [HOUND_ID, WARDEN_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const rules: ObjectiveRules = {
      ...RITUAL_OBJECTIVE_RULES,
      definitions: RITUAL_OBJECTIVE_RULES.definitions.map((definition) => ({
        ...definition,
        required: false,
      })),
    };
    expect(settle({ rules, facts: facts({ combatants }) }).settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'all_enemies_defeated',
    });
  });

  it('settles a defeat with deadline_expired when the required deadline passes', () => {
    const result = settle({
      rules: RITUAL_OBJECTIVE_RULES,
      facts: facts({ completedRounds: 3 }),
    });
    expect(result.settlement).toMatchObject({
      result: 'defeat',
      reasonCode: 'deadline_expired',
    });
  });
});

describe('AC-5 mandatory loss precedence at one boundary', () => {
  it('a lost protected actor beats a simultaneous objective completion', () => {
    const combatants = roster();
    combatants[GUARD_ID] = { ...combatants[GUARD_ID], defeated: true, hp: 0, downed: true };
    const rules: ObjectiveRules = {
      ...RITUAL_OBJECTIVE_RULES,
      protectedActorIds: [GUARD_ID],
    };
    const result = settle({
      rules,
      facts: facts({
        combatants,
        completedInteractions: [interactionKey(PLAYER_ID, RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(result.settlement).toMatchObject({
      result: 'defeat',
      reasonCode: 'protected_actor_lost',
    });
    // The objective completion is still recorded as a fact.
    expect(
      result.settlement?.objectiveResults.find(
        (entry) => entry.objectiveId === 'objective.stop_ritual',
      )?.status,
    ).toBe('complete');
  });

  it('a party wipe beats a simultaneous objective completion', () => {
    const combatants = roster();
    for (const id of [PLAYER_ID, GUARD_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const result = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({
        combatants,
        completedInteractions: [interactionKey(PLAYER_ID, RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    });
    expect(result.settlement).toMatchObject({ result: 'defeat', reasonCode: 'party_defeated' });
  });
});

describe('AC-5 nonlethal outcomes', () => {
  it('settles a rout victory from the authored morale route without a death', () => {
    const combatants = roster();
    const state = participation({ [HOUND_ID]: { morale: 15 } });
    const result = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ combatants, participation: state }),
    });
    expect(result.settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'hostile_group_routed',
    });
    expect(combatants[HOUND_ID].hp).toBe(12);
    expect(combatants[HOUND_ID].defeated).toBe(false);
  });

  it('settles a rout victory when the hostile surrendered', () => {
    const result = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ participation: participation({ [HOUND_ID]: { status: 'surrendered' } }) }),
    });
    expect(result.settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'hostile_group_routed',
    });
  });

  it('settles `escape` — not `defeat` — when the whole party legally disengaged', () => {
    const result = settle({
      rules: { definitions: [], protectedActorIds: [] },
      facts: facts({
        participation: participation({
          [PLAYER_ID]: { status: 'escaped' },
          [GUARD_ID]: { status: 'escaped' },
        }),
      }),
    });
    expect(result.settlement).toMatchObject({
      result: 'escape',
      reasonCode: 'escaped_encounter',
    });
  });
});

describe('AC-5 exactly-once settlement', () => {
  it('returns the existing settlement unchanged and reports alreadySettled', () => {
    const existing = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ participation: participation({ [HOUND_ID]: { status: 'surrendered' } }) }),
    }).settlement;
    expect(existing).not.toBeNull();

    const second = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ participation: participation({ [HOUND_ID]: { status: 'surrendered' } }) }),
      existing,
    });
    expect(second.alreadySettled).toBe(true);
    expect(second.settlement).toEqual(existing);
  });

  it('never overwrites a committed outcome even if the facts change', () => {
    const first = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ participation: participation({ [HOUND_ID]: { status: 'surrendered' } }) }),
    }).settlement;
    const combatants = roster();
    for (const id of [PLAYER_ID, GUARD_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const second = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ combatants }),
      existing: first,
    });
    expect(second.settlement).toEqual(first);
    expect(second.settlement?.result).toBe('victory');
  });

  it('derives a deterministic settlement id from encounter, revision and reason', () => {
    expect(settlementIdFor('enc', 7, 'hostile_group_routed')).toBe('enc:7:hostile_group_routed');
  });

  it('produces a schema-valid settlement', () => {
    const settlement = settle({
      rules: ROUT_OBJECTIVE_RULES,
      facts: facts({ participation: participation({ [HOUND_ID]: { status: 'surrendered' } }) }),
    }).settlement;
    expect(settlement).not.toBeNull();
    expect(Value.Check(EncounterSettlementSchema, settlement)).toBe(true);
  });

  it('sorts objective results by id so replay is byte-stable', () => {
    const rules: ObjectiveRules = {
      definitions: [...ROUT_OBJECTIVE_RULES.definitions, ...RITUAL_OBJECTIVE_RULES.definitions],
      protectedActorIds: [],
    };
    const settlement = settle({
      rules,
      facts: facts({
        participation: participation({ [HOUND_ID]: { status: 'surrendered' } }),
        completedInteractions: [interactionKey(PLAYER_ID, RITUAL_ID, RITUAL_AFFORDANCE)],
      }),
    }).settlement;
    expect(settlement?.objectiveResults.map((entry) => entry.objectiveId)).toEqual([
      'objective.rout_hounds',
      'objective.stop_ritual',
    ]);
  });
});

describe('AC-5 the documented boolean projection', () => {
  it('maps victory and escape to true, defeat to false', () => {
    const base = {
      settlementId: 'x',
      reasonCode: 'objective_completed' as const,
      objectiveResults: [],
      round: 1,
      rewardApplied: false,
    };
    expect(settlementToVictoryProjection({ ...base, result: 'victory' })).toBe(true);
    expect(settlementToVictoryProjection({ ...base, result: 'escape' })).toBe(true);
    expect(settlementToVictoryProjection({ ...base, result: 'defeat' })).toBe(false);
  });
});

describe('AC-5 exit zone identity', () => {
  it('does not depend on a hard-coded exit zone', () => {
    const zoneId = 'custom:north_gate';
    const zoneCell = { x: 7, y: 0 };
    const combatants = roster();
    const escapedParticipation = participation();
    for (const id of [PLAYER_ID, GUARD_ID]) {
      combatants[id] = { ...combatants[id], position: zoneCell };
      const reachedAuthoredZone = isInExitZone({
        rules: {
          ...BASE_MORALE_RULES,
          responses: [{ responseKind: 'retreat', exitZoneId: zoneId }],
          exitZones: [{ zoneId, cells: [zoneCell] }],
        },
        exitZoneId: zoneId,
        cell: combatants[id].position,
      });
      expect(reachedAuthoredZone).toBe(true);
      escapedParticipation[id] = { ...escapedParticipation[id], status: 'escaped' };
    }

    const result = settle({
      rules: { definitions: [], protectedActorIds: [] },
      facts: facts({ combatants, participation: escapedParticipation }),
    });
    expect(result.settlement).toMatchObject({
      result: 'escape',
      reasonCode: 'escaped_encounter',
    });
  });
});
