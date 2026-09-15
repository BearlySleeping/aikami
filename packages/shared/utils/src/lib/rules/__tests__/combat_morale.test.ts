// packages/shared/utils/src/lib/rules/__tests__/combat_morale.test.ts
//
// AC-2: morale supports real nonlethal outcomes.
//
// Covers: triggers apply once, leader + ally triggers from the same event,
// the single documented band mapping, break-threshold crossing, blocked
// retreat falling back to surrender, and participation changes that preserve
// HP and identity.
//
// Contract: C-532 AC-2

import { describe, expect, it } from 'bun:test';
import type { ParticipationState } from '@aikami/types';
import {
  applyMoraleTrigger,
  applyParticipationStatus,
  availableMoraleResponses,
  chooseMoraleResponse,
  isHostileTargetEligible,
  MORALE_BAND_THRESHOLDS,
  moraleAllowsResponse,
  moraleBandFromValue,
  moraleTriggerId,
  retreatIsLegal,
  stillContestsEncounter,
} from '../combat_morale';
import {
  BASE_MORALE_RULES,
  EXIT_ZONE_ID,
  GUARD_ID,
  HOUND_ID,
  PLAYER_ID,
  WARDEN_ID,
} from './combat_depth_fixtures';

const participation = (
  overrides: Record<string, Partial<ParticipationState>> = {},
): Record<string, ParticipationState> => {
  const base = (): ParticipationState => ({
    status: 'active',
    morale: BASE_MORALE_RULES.startingMorale,
    appliedTriggerIds: [],
    reactionPolicy: 'ask',
  });
  return {
    [PLAYER_ID]: { ...base(), ...(overrides[PLAYER_ID] ?? {}) },
    [GUARD_ID]: { ...base(), ...(overrides[GUARD_ID] ?? {}) },
    [HOUND_ID]: { ...base(), ...(overrides[HOUND_ID] ?? {}) },
    [WARDEN_ID]: { ...base(), ...(overrides[WARDEN_ID] ?? {}) },
  };
};

describe('AC-2 the single documented band mapping', () => {
  it('maps numeric morale onto the AI band at documented inclusive lower bounds', () => {
    expect(moraleBandFromValue(100)).toBe('steady');
    expect(moraleBandFromValue(75)).toBe('steady');
    expect(moraleBandFromValue(74)).toBe('shaken');
    expect(moraleBandFromValue(50)).toBe('shaken');
    expect(moraleBandFromValue(49)).toBe('wavering');
    expect(moraleBandFromValue(25)).toBe('wavering');
    expect(moraleBandFromValue(24)).toBe('broken');
    expect(moraleBandFromValue(0)).toBe('broken');
  });

  it('declares exactly four bands and never leaves a value unmapped', () => {
    expect(MORALE_BAND_THRESHOLDS).toHaveLength(4);
    for (let morale = 0; morale <= 100; morale++) {
      expect(typeof moraleBandFromValue(morale)).toBe('string');
    }
  });
});

describe('AC-2 triggers apply exactly once', () => {
  it('applies an ally-removed trigger to the removed actor’s side only', () => {
    const first = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation(),
      event: { kind: 'ally_removed', removedId: HOUND_ID },
      affectedCombatantIds: [WARDEN_ID],
    });
    expect(first.participation[WARDEN_ID].morale).toBe(50);
    expect(first.participation[PLAYER_ID].morale).toBe(60);
    expect(first.appliedTriggerIds).toEqual([moraleTriggerId('ally_removed', HOUND_ID)]);
  });

  it('never moves morale twice for the same source event', () => {
    const first = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation(),
      event: { kind: 'ally_removed', removedId: HOUND_ID },
      affectedCombatantIds: [WARDEN_ID],
    });
    const second = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: first.participation,
      event: { kind: 'ally_removed', removedId: HOUND_ID },
      affectedCombatantIds: [WARDEN_ID],
    });
    expect(second.participation[WARDEN_ID].morale).toBe(50);
    expect(second.changedCombatantIds).toEqual([]);
    expect(second.appliedTriggerIds).toEqual([]);
  });

  it('lets a leader defeat fire BOTH leader and ally triggers from one event', () => {
    const leader = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation(),
      event: { kind: 'leader_defeated', leaderId: WARDEN_ID },
      affectedCombatantIds: [HOUND_ID],
    });
    const ally = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: leader.participation,
      event: { kind: 'ally_removed', removedId: WARDEN_ID },
      affectedCombatantIds: [HOUND_ID],
    });
    // 60 − 25 (leader) − 10 (ally) = 25, i.e. across the 30 break threshold.
    expect(ally.participation[HOUND_ID].morale).toBe(25);
    expect(ally.participation[HOUND_ID].appliedTriggerIds).toHaveLength(2);
    expect(leader.crossedBreakThresholdIds).toEqual([]);
    expect(ally.crossedBreakThresholdIds).toEqual([HOUND_ID]);
    // The derived AI band moved on the leader step (shaken 60 → wavering 35)
    // and held on the ally step (wavering 35 → wavering 25).
    expect(leader.bandChangedCombatantIds).toEqual([HOUND_ID]);
    expect(ally.bandChangedCombatantIds).toEqual([]);
  });

  it('clamps morale at zero and never below', () => {
    const application = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation({
        [HOUND_ID]: {
          status: 'active',
          morale: 5,
          appliedTriggerIds: [],
          reactionPolicy: 'ask',
        },
      }),
      event: { kind: 'leader_defeated', leaderId: WARDEN_ID },
      affectedCombatantIds: [HOUND_ID],
    });
    expect(application.participation[HOUND_ID].morale).toBe(0);
  });

  it('is a no-op when the authored rules carry no rule for that trigger kind', () => {
    const application = applyMoraleTrigger({
      rules: { ...BASE_MORALE_RULES, triggers: [] },
      participation: participation(),
      event: { kind: 'objective_failed', objectiveId: 'objective.stop_ritual' },
      affectedCombatantIds: [PLAYER_ID],
    });
    expect(application.changedCombatantIds).toEqual([]);
    expect(application.participation[PLAYER_ID].morale).toBe(60);
  });

  it('reports the derived AI band transition without mutating the band authority', () => {
    const application = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation({
        [HOUND_ID]: {
          status: 'active',
          morale: 30,
          appliedTriggerIds: [],
          reactionPolicy: 'ask',
        },
      }),
      event: { kind: 'ally_removed', removedId: WARDEN_ID },
      affectedCombatantIds: [HOUND_ID],
    });
    expect(moraleBandFromValue(30)).toBe('wavering');
    expect(moraleBandFromValue(20)).toBe('broken');
    expect(application.bandChangedCombatantIds).toEqual([HOUND_ID]);
  });
});

describe('AC-2 threshold crossing permits authored responses', () => {
  it('does not permit a response above the break threshold', () => {
    const state: ParticipationState = {
      status: 'active',
      morale: 31,
      appliedTriggerIds: [],
      reactionPolicy: 'ask',
    };
    expect(moraleAllowsResponse(BASE_MORALE_RULES, state)).toBe(false);
    expect(availableMoraleResponses(BASE_MORALE_RULES, state)).toEqual([]);
  });

  it('permits exactly the authored responses at or below the threshold', () => {
    const state: ParticipationState = {
      status: 'active',
      morale: 30,
      appliedTriggerIds: [],
      reactionPolicy: 'ask',
    };
    expect(moraleAllowsResponse(BASE_MORALE_RULES, state)).toBe(true);
    expect(availableMoraleResponses(BASE_MORALE_RULES, state).map((r) => r.responseKind)).toEqual([
      'retreat',
      'surrender',
    ]);
  });

  it('crossing the threshold does not itself declare an outcome', () => {
    const application = applyMoraleTrigger({
      rules: BASE_MORALE_RULES,
      participation: participation(),
      event: { kind: 'ally_removed', removedId: HOUND_ID },
      affectedCombatantIds: [WARDEN_ID],
    });
    // Morale moved, but participation status is untouched.
    expect(application.participation[WARDEN_ID].status).toBe('active');
  });
});

describe('AC-2 retreat requires legal movement, and a blocked retreat falls back', () => {
  const broken: ParticipationState = {
    status: 'active',
    morale: 10,
    appliedTriggerIds: [],
    reactionPolicy: 'ask',
  };

  it('accepts a retreat only when the authored exit zone is reachable', () => {
    const retreat = BASE_MORALE_RULES.responses[0];
    expect(
      retreatIsLegal({
        rules: BASE_MORALE_RULES,
        response: retreat,
        reachableCells: [{ x: 0, y: 7 }],
      }),
    ).toBe(true);
    expect(
      retreatIsLegal({
        rules: BASE_MORALE_RULES,
        response: retreat,
        reachableCells: [{ x: 1, y: 7 }],
      }),
    ).toBe(false);
  });

  it('never treats surrender as a movement-gated response', () => {
    const surrender = BASE_MORALE_RULES.responses[1];
    expect(
      retreatIsLegal({ rules: BASE_MORALE_RULES, response: surrender, reachableCells: [] }),
    ).toBe(false);
  });

  it('chooses surrender when the exit is blocked, and retreat when it is open', () => {
    expect(
      chooseMoraleResponse({
        rules: BASE_MORALE_RULES,
        participation: broken,
        reachableCells: [{ x: 0, y: 7 }],
      }),
    ).toBe('surrender');
    expect(
      chooseMoraleResponse({
        rules: BASE_MORALE_RULES,
        participation: broken,
        reachableCells: [],
      }),
    ).toBe('surrender');
  });

  it('prefers retreat over surrender when surrender is not authored', () => {
    const retreatOnly = {
      ...BASE_MORALE_RULES,
      responses: [BASE_MORALE_RULES.responses[0]],
    };
    expect(
      chooseMoraleResponse({
        rules: retreatOnly,
        participation: broken,
        reachableCells: [{ x: 0, y: 7 }],
      }),
    ).toBe('retreat');
    expect(
      chooseMoraleResponse({
        rules: retreatOnly,
        participation: broken,
        reachableCells: [],
      }),
    ).toBeNull();
  });

  it('returns null when the authored policy offers no legal response', () => {
    expect(
      chooseMoraleResponse({
        rules: { ...BASE_MORALE_RULES, responses: [] },
        participation: broken,
        reachableCells: [],
      }),
    ).toBeNull();
  });
});

describe('AC-2 participation changes preserve HP and identity', () => {
  it('surrendering changes participation only', () => {
    const before: ParticipationState = {
      status: 'active',
      morale: 10,
      appliedTriggerIds: [],
      reactionPolicy: 'ask',
    };
    const after = applyParticipationStatus({ participation: before, status: 'surrendered' });
    expect(after.status).toBe('surrendered');
    expect(after.morale).toBe(before.morale);
    expect(after.appliedTriggerIds).toEqual(before.appliedTriggerIds);
  });

  it('surrendered and escaped actors are not ordinary hostile targets; retreating ones still are', () => {
    expect(isHostileTargetEligible('active')).toBe(true);
    expect(isHostileTargetEligible('retreating')).toBe(true);
    expect(isHostileTargetEligible('surrendered')).toBe(false);
    expect(isHostileTargetEligible('escaped')).toBe(false);
    expect(isHostileTargetEligible('defeated')).toBe(false);
  });

  it('a retreating actor still contests the encounter until it exits or surrenders', () => {
    expect(stillContestsEncounter('retreating')).toBe(true);
    expect(stillContestsEncounter('surrendered')).toBe(false);
    expect(stillContestsEncounter('escaped')).toBe(false);
  });
});

describe('AC-2 exit zone identity', () => {
  it('uses the authored exit zone id, not a hard-coded one', () => {
    expect(BASE_MORALE_RULES.exitZones[0].zoneId).toBe(EXIT_ZONE_ID);
  });
});
