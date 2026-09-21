// packages/shared/utils/src/lib/rules/__tests__/combat_depth_forecast.test.ts
//
// AC-1 / AC-3: previews report immediate objective consequences and conditional
// opportunity-attack risks, without leaking hidden facts.
//
// Contract: C-532 AC-1, AC-3

import { describe, expect, it } from 'bun:test';
import type { CombatState, ObjectiveRules } from '@aikami/types';
import { forecastObjectiveEffects, forecastReactionRisks } from '../combat_depth_forecast';
import { createCombatState } from '../combat_kernel';
import { forecastCombatAction } from '../combat_tactical';
import {
  createDepthInput,
  HOUND_ID,
  makeDepthCombatants,
  PLAYER_ID,
  REACTION_REGISTRY,
  RITUAL_AFFORDANCE,
  RITUAL_ID,
  ROUT_OBJECTIVE_RULES,
  WARDEN_ID,
} from './combat_depth_fixtures';

/** Hero at (1,0) — adjacent to the hound at (2,0), inside its threat range. */
const inRangeState = (overrides: { objectiveRules?: ObjectiveRules } = {}): CombatState => {
  const combatants = makeDepthCombatants().map((combatant) =>
    combatant.combatantId === PLAYER_ID ? { ...combatant, position: { x: 1, y: 0 } } : combatant,
  );
  return createCombatState({
    ...createDepthInput({
      combatants,
      reactionRegistry: REACTION_REGISTRY,
      objectiveRules: overrides.objectiveRules,
    }),
  });
};

const away = [{ x: 0, y: 0 }];

describe('AC-3 reaction-risk forecast', () => {
  it('reports the trigger cell and the known reactor', () => {
    const state = inRangeState();
    const risks = forecastReactionRisks({
      state,
      moverId: PLAYER_ID,
      path: away,
      perceivedReactorIds: [HOUND_ID],
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({
      triggerCell: { x: 0, y: 0 },
      pathIndex: 0,
      reactorIds: [HOUND_ID],
      committedCells: [],
    });
  });

  it('never reveals a reactor the acting side cannot perceive', () => {
    const state = inRangeState();
    expect(
      forecastReactionRisks({
        state,
        moverId: PLAYER_ID,
        path: away,
        perceivedReactorIds: [],
      }),
    ).toEqual([]);
    expect(
      forecastReactionRisks({
        state,
        moverId: PLAYER_ID,
        path: away,
        perceivedReactorIds: [WARDEN_ID],
      }),
    ).toEqual([]);
  });

  it('reports nothing for a path that never leaves a threat range', () => {
    const state = inRangeState();
    expect(
      forecastReactionRisks({
        state,
        moverId: PLAYER_ID,
        path: [{ x: 2, y: 0 }],
        perceivedReactorIds: [HOUND_ID],
      }),
    ).toEqual([]);
  });

  it('is reachable through the production forecast entry point', () => {
    const state = inRangeState();
    const result = forecastCombatAction({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: away },
      perceivedReactorIds: [HOUND_ID],
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.reactionRisks).toHaveLength(1);
    expect(result.forecast.reactionRisks[0].reactorIds).toEqual([HOUND_ID]);
  });

  it('discloses nothing when the caller supplies no perception data', () => {
    const state = inRangeState();
    const result = forecastCombatAction({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: away },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.reactionRisks).toEqual([]);
  });

  it('does not mutate the state it forecasts against', () => {
    const state = inRangeState();
    const snapshot = structuredClone(state);
    forecastReactionRisks({
      state,
      moverId: PLAYER_ID,
      path: away,
      perceivedReactorIds: [HOUND_ID],
    });
    expect(state).toEqual(snapshot);
  });
});

describe('AC-1 objective-effect forecast', () => {
  const reachZoneRules: ObjectiveRules = {
    definitions: [
      {
        objectiveId: 'objective.escape',
        kind: 'reach_zone',
        required: true,
        hidden: false,
        rule: {
          kind: 'reach_zone',
          zoneId: 'emberwatch:south_gate',
          cells: [{ x: 0, y: 1 }],
          requiredActorIds: [PLAYER_ID],
        },
      },
    ],
    protectedActorIds: [],
  };

  it('reports an objective the proposed move would complete', () => {
    const state = inRangeState({ objectiveRules: reachZoneRules });
    const effects = forecastObjectiveEffects({
      state,
      actorId: PLAYER_ID,
      committedCells: [{ x: 0, y: 1 }],
    });
    expect(effects).toEqual([
      {
        objectiveId: 'objective.escape',
        objectiveKind: 'reach_zone',
        statusBefore: 'pending',
        statusAfter: 'complete',
        progressAfter: 1,
        completes: true,
        failsDeadline: false,
      },
    ]);
  });

  it('reports partial progress without claiming completion', () => {
    const twoActors: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.escape',
          kind: 'reach_zone',
          required: true,
          hidden: false,
          rule: {
            kind: 'reach_zone',
            zoneId: 'emberwatch:south_gate',
            cells: [{ x: 0, y: 1 }],
            requiredActorIds: [PLAYER_ID, WARDEN_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    const state = inRangeState({ objectiveRules: twoActors });
    const effects = forecastObjectiveEffects({
      state,
      actorId: PLAYER_ID,
      committedCells: [{ x: 0, y: 1 }],
    });
    expect(effects[0]).toMatchObject({
      progressAfter: 1,
      completes: false,
      statusAfter: 'pending',
    });
  });

  it('never lists a hidden objective', () => {
    const hidden: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.secret',
          kind: 'reach_zone',
          required: false,
          hidden: true,
          rule: {
            kind: 'reach_zone',
            zoneId: 'emberwatch:secret_zone',
            cells: [{ x: 0, y: 1 }],
            requiredActorIds: [PLAYER_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    const state = inRangeState({ objectiveRules: hidden });
    expect(
      forecastObjectiveEffects({ state, actorId: PLAYER_ID, committedCells: [{ x: 0, y: 1 }] }),
    ).toEqual([]);
  });

  it('reports nothing when an action changes no objective', () => {
    const state = inRangeState({ objectiveRules: ROUT_OBJECTIVE_RULES });
    expect(
      forecastObjectiveEffects({ state, actorId: PLAYER_ID, committedCells: [{ x: 1, y: 1 }] }),
    ).toEqual([]);
  });

  it('flags a proposed interaction that would complete the ritual objective', () => {
    const ritual: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.stop_ritual',
          kind: 'interact_before_deadline',
          required: true,
          hidden: false,
          rule: {
            kind: 'interact_before_deadline',
            objectId: RITUAL_ID,
            affordanceId: RITUAL_AFFORDANCE,
            deadlineRound: 3,
            requiredActorIds: [PLAYER_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    const state = inRangeState({ objectiveRules: ritual });
    const effects = forecastObjectiveEffects({
      state,
      actorId: PLAYER_ID,
      committedInteraction: { objectId: RITUAL_ID, affordanceId: RITUAL_AFFORDANCE },
    });
    expect(effects).toEqual([
      {
        objectiveId: 'objective.stop_ritual',
        objectiveKind: 'interact_before_deadline',
        statusBefore: 'pending',
        statusAfter: 'complete',
        progressAfter: 1,
        completes: true,
        failsDeadline: false,
      },
    ]);
  });

  it('is reachable through the production forecast entry point for a move', () => {
    const state = inRangeState({ objectiveRules: reachZoneRules });
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'move',
        combatantId: PLAYER_ID,
        path: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.objectiveEffects).toHaveLength(1);
    expect(result.forecast.objectiveEffects[0].completes).toBe(true);
  });

  it('does not mutate the state it forecasts against', () => {
    const state = inRangeState({ objectiveRules: reachZoneRules });
    const snapshot = structuredClone(state);
    forecastObjectiveEffects({ state, actorId: PLAYER_ID, committedCells: [{ x: 0, y: 1 }] });
    expect(state).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const state = inRangeState({ objectiveRules: reachZoneRules });
    const input = { state, actorId: PLAYER_ID, committedCells: [{ x: 0, y: 1 }] };
    const first = forecastObjectiveEffects(input);
    expect(first).toHaveLength(1);
    expect(forecastObjectiveEffects(input)).toEqual(first);
  });
});

describe('AC-2 retreat forecast', () => {
  it('reports the declared retreat as a movement cost with an ends-turn warning', () => {
    const combatants = makeDepthCombatants().map((combatant) =>
      combatant.combatantId === HOUND_ID ? { ...combatant, position: { x: 0, y: 6 } } : combatant,
    );
    const base = createCombatState({
      ...createDepthInput({ combatants, moraleRules: undefined }),
    });
    const state: CombatState = {
      ...base,
      moraleRules: {
        startingMorale: 60,
        breakThreshold: 30,
        triggers: [],
        responses: [{ responseKind: 'retreat', exitZoneId: 'emberwatch:south_gate' }],
        exitZones: [{ zoneId: 'emberwatch:south_gate', cells: [{ x: 0, y: 7 }] }],
        leaderIds: [],
      },
      initiative: { order: [HOUND_ID, PLAYER_ID], activeIndex: 0 },
      turnId: `r1:${HOUND_ID}`,
      participation: {
        ...base.participation,
        [HOUND_ID]: { ...base.participation[HOUND_ID], morale: 30 },
      },
    };
    const result = forecastCombatAction({
      state,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: [{ x: 0, y: 7 }] },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.actionCost).toBe('movement');
    expect(result.forecast.warnings).toContain('endsTurn');
  });
});
