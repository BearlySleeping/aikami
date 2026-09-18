// apps/frontend/client/src/lib/views/dev/combat/inspector/combat_debug_inspector.test.ts
//
// Unit tests for the pure inspector projections and development assertions:
// each selector returns the expected fields, and evaluateCombatDebugAssertions
// detects a non-monotonic revision and a negative movement budget while
// returning nothing for a healthy state.
//
// Contract: combat debug workspace (execution prompt §3, §5)
import { describe, expect, test } from 'bun:test';
import type { CombatState } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState } from '@aikami/utils';
import {
  buildCombatDebugActionSummary,
  buildCombatDebugActorSummary,
  buildCombatDebugAiSummary,
  buildCombatDebugContext,
  buildCombatDebugObjectsSummary,
  buildCombatDebugReactionSummary,
  evaluateCombatDebugAssertions,
} from './combat_debug_inspector.ts';

const PLAYER_ID = 'player-hero';
const GOBLIN_ID = 'emberwatch:goblin-1';
const RUN_ID = 'run:emberwatch-encounter-1:4242';

/** A minimal healthy v4 state with two combatants. */
const baseState = (): CombatState =>
  createCombatState({
    encounterId: 'emberwatch-encounter-1',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 4242,
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Hero',
        team: 'player',
        position: { x: 0, y: 0 },
        hp: 20,
        maxHp: 20,
        armorClass: 12,
        attackBonus: 5,
        initiative: 14,
        abilityIds: ['basic_melee'],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
      {
        combatantId: GOBLIN_ID,
        name: 'Goblin Scout',
        team: 'enemy',
        position: { x: 1, y: 0 },
        hp: 12,
        maxHp: 12,
        armorClass: 13,
        attackBonus: 3,
        initiative: 11,
        abilityIds: ['basic_melee'],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
    ],
    abilityCatalog: {
      // biome-ignore lint/style/useNamingConvention: authored content id
      basic_melee: {
        abilityId: 'basic_melee',
        name: 'Basic Melee',
        kind: 'melee_attack',
        actionCost: 'action',
        attackBonus: 2,
        damageDice: '1d6',
        damageType: 'slashing',
        rangeCells: 1,
        requiresLineOfSight: false,
      },
    },
    battlefield: { width: 8, height: 8, blockedCells: [] },
    objectives: [],
  });

const stateWithOverrides = (overrides: Partial<CombatState>): CombatState => ({
  ...baseState(),
  encounterRunId: RUN_ID,
  ...overrides,
});

/**
 * Spreads the base state with one combatant replaced. Throws if the combatant
 * is missing so a broken fixture fails loudly at the call site rather than
 * silently projecting a partial state.
 */
const withCombatant = (
  state: CombatState,
  combatantId: string,
  update: (combatant: CombatState['combatants'][string]) => CombatState['combatants'][string],
): CombatState => {
  const combatant = state.combatants[combatantId];
  if (!combatant) {
    throw new Error(`Fixture is missing combatant ${combatantId}`);
  }
  return {
    ...state,
    combatants: { ...state.combatants, [combatantId]: update(combatant) },
  };
};

/** Spreads the base state with one participation record replaced. */
const withParticipation = (
  state: CombatState,
  combatantId: string,
  update: (
    participation: CombatState['participation'][string],
  ) => CombatState['participation'][string],
): CombatState => {
  const participation = state.participation[combatantId];
  if (!participation) {
    throw new Error(`Fixture is missing participation for ${combatantId}`);
  }
  return {
    ...state,
    participation: { ...state.participation, [combatantId]: update(participation) },
  };
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

describe('buildCombatDebugContext', () => {
  test('projects the encounter-level identity and turn state', () => {
    const state = stateWithOverrides({ turnId: `r1:${PLAYER_ID}` });
    const context = buildCombatDebugContext(state);

    expect(context.runId).toBe(RUN_ID);
    expect(context.encounterId).toBe('emberwatch-encounter-1');
    expect(context.rulesVersion).toBe(COMBAT_RULES_VERSION);
    expect(context.schemaVersion).toBe(state.schemaVersion);
    expect(context.revision).toBe(state.stateRevision);
    expect(context.round).toBe(1);
    expect(context.turnId).toBe(`r1:${PLAYER_ID}`);
    expect(context.phase).toBe('active');
    expect(context.activeCombatantId).toBe(PLAYER_ID);
    expect(context.seed).toBe(4242);
    expect(context.settlementPresent).toBe(false);
    expect(context.outcomePresent).toBe(false);
  });

  test('projects RNG substreams sorted by name', () => {
    const context = buildCombatDebugContext(stateWithOverrides({}));
    expect(context.rngStreams.map((stream) => stream.name)).toEqual([
      'actions',
      'initiative',
      'loot',
    ]);
    for (const stream of context.rngStreams) {
      expect(typeof stream.seed).toBe('number');
      expect(typeof stream.state).toBe('number');
    }
  });

  test('maps a null turn id to an undefined active combatant', () => {
    const context = buildCombatDebugContext(stateWithOverrides({ turnId: null }));
    expect(context.turnId).toBeUndefined();
    expect(context.activeCombatantId).toBeUndefined();
  });

  test('reports settlement and outcome presence', () => {
    const state = stateWithOverrides({});
    const withSettlement = {
      ...state,
      phase: 'ended' as const,
      settlement: {
        settlementId: 'settle-1',
        reasonCode: 'victory',
        round: 3,
      } as CombatState['settlement'],
      outcome: { victory: true, reason: 'victory' },
    };
    const context = buildCombatDebugContext(withSettlement);
    expect(context.settlementPresent).toBe(true);
    expect(context.outcomePresent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

describe('buildCombatDebugActorSummary', () => {
  test('projects a known combatant', () => {
    const summary = buildCombatDebugActorSummary({
      state: stateWithOverrides({}),
      combatantId: PLAYER_ID,
    });
    expect(summary).toBeDefined();
    expect(summary?.combatantId).toBe(PLAYER_ID);
    expect(summary?.name).toBe('Hero');
    expect(summary?.team).toBe('player');
    expect(summary?.hp).toBe(20);
    expect(summary?.maxHp).toBe(20);
    expect(summary?.position).toEqual({ x: 0, y: 0 });
    expect(summary?.initiative).toBe(14);
    expect(summary?.movementRemaining).toBe(6);
    expect(summary?.actionAvailable).toBe(true);
    expect(summary?.downed).toBe(false);
    expect(summary?.defeated).toBe(false);
    expect(summary?.abilityIds).toEqual(['basic_melee']);
    // Participation defaults to active with the rules' starting morale.
    expect(summary?.participation?.morale).toBe(100);
    expect(summary?.participation?.broken).toBe(false);
  });

  test('returns undefined for an unknown combatant', () => {
    expect(
      buildCombatDebugActorSummary({
        state: stateWithOverrides({}),
        combatantId: 'nobody',
      }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

describe('buildCombatDebugActionSummary', () => {
  test('produces all-undefined fields with an empty warnings array by default', () => {
    const summary = buildCombatDebugActionSummary();
    expect(summary.commandId).toBeUndefined();
    expect(summary.revision).toBeUndefined();
    expect(summary.acknowledgement).toBeUndefined();
    expect(summary.warnings).toEqual([]);
  });

  test('copies the warnings array rather than aliasing it', () => {
    const warnings = ['one'];
    const summary = buildCombatDebugActionSummary({
      commandId: 'cmd-1',
      revision: 2,
      semanticIntent: 'attack',
      groundedKind: 'useAbility',
      acknowledgement: 'accepted',
      resultingRevision: 3,
      warnings,
    });
    expect(summary.commandId).toBe('cmd-1');
    expect(summary.acknowledgement).toBe('accepted');
    expect(summary.warnings).toEqual(['one']);
    warnings.push('two');
    expect(summary.warnings).toEqual(['one']);
  });
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

describe('buildCombatDebugAiSummary', () => {
  test('counts provider usage and degraded records', () => {
    const summary = buildCombatDebugAiSummary([
      {
        commandId: 'a',
        controlOwner: 'ai',
        failureCode: undefined,
        providerUsed: true,
        rationale: undefined,
      },
      {
        commandId: 'b',
        controlOwner: 'ai',
        failureCode: 'timeout',
        providerUsed: false,
        rationale: undefined,
      },
      {
        commandId: 'c',
        controlOwner: 'player',
        failureCode: undefined,
        providerUsed: true,
        rationale: undefined,
      },
    ]);
    expect(summary.providerUsedCount).toBe(2);
    expect(summary.degradedCount).toBe(1);
    expect(summary.records).toHaveLength(3);
  });

  test('copies the records array', () => {
    const records = [
      {
        commandId: 'a',
        controlOwner: 'ai' as const,
        failureCode: undefined,
        providerUsed: true,
        rationale: undefined,
      },
    ];
    const summary = buildCombatDebugAiSummary(records);
    expect(summary.records).not.toBe(records);
  });
});

// ---------------------------------------------------------------------------
// Objects / objectives
// ---------------------------------------------------------------------------

describe('buildCombatDebugObjectsSummary', () => {
  test('returns empty objects and objectives for a bare state', () => {
    const summary = buildCombatDebugObjectsSummary(stateWithOverrides({}));
    expect(summary.objects).toEqual([]);
    expect(summary.objectives).toEqual([]);
  });

  test('projects objects and their affordance availability', () => {
    const base = stateWithOverrides({});
    const state: CombatState = {
      ...base,
      environment: {
        objects: {
          brazier: {
            objectId: 'brazier',
            definitionId: 'prop-brazier',
            position: { x: 2, y: 2 },
            footprint: [{ x: 2, y: 2 }],
            durability: 5,
            state: 'intact',
            ignited: false,
            cover: 'none',
            affordanceIds: ['topple', 'missing'],
            attachedToObjectId: null,
          },
        },
        surfaces: [],
        hazardTickStamps: [],
      },
      environmentBundle: {
        bundleVersion: base.environmentBundle.bundleVersion,
        rulesVersion: base.environmentBundle.rulesVersion,
        objectDefinitions: {
          'prop-brazier': {
            definitionId: 'prop-brazier',
            name: 'Brazier',
            durability: 5,
            blocksMovement: false,
            blocksSight: false,
            cover: 'none',
            affordanceIds: ['topple'],
          },
        },
        affordances: {
          topple: {
            affordanceId: 'topple',
            name: 'Topple',
            actionCost: 'action',
            requirements: [],
            check: null,
            successEffects: [],
            failureEffects: [],
          },
        },
        impactZones: {},
      },
      objectives: [{ objectiveId: 'survive', kind: 'survival', status: 'pending', progress: 0 }],
      objectiveRules: {
        definitions: [],
        protectedActorIds: [],
      },
    };

    const summary = buildCombatDebugObjectsSummary(state);
    expect(summary.objects).toHaveLength(1);
    const brazier = summary.objects[0];
    expect(brazier?.objectId).toBe('brazier');
    expect(brazier?.definitionId).toBe('prop-brazier');
    expect(brazier?.state).toBe('intact');
    expect(brazier?.affordances).toEqual([
      { affordanceId: 'topple', available: true },
      { affordanceId: 'missing', available: false },
    ]);
  });

  test('projects an objective deadline and required flag from authored rules', () => {
    const base = stateWithOverrides({});
    const state: CombatState = {
      ...base,
      objectives: [
        { objectiveId: 'ritual', kind: 'interact_before_deadline', status: 'pending', progress: 1 },
        { objectiveId: 'survive', kind: 'survival', status: 'complete', progress: 3 },
      ],
      objectiveRules: {
        definitions: [
          {
            objectiveId: 'ritual',
            kind: 'interact_before_deadline',
            required: true,
            hidden: false,
            rule: {
              kind: 'interact_before_deadline',
              objectId: 'brazier',
              affordanceId: 'topple',
              deadlineRound: 5,
              requiredActorIds: [PLAYER_ID],
            },
          },
        ],
        protectedActorIds: [],
      },
    };

    const summary = buildCombatDebugObjectsSummary(state);
    expect(summary.objectives).toEqual([
      {
        objectiveId: 'ritual',
        kind: 'interact_before_deadline',
        progress: 1,
        deadlineRound: 5,
        required: true,
        satisfied: undefined,
      },
      {
        objectiveId: 'survive',
        kind: 'survival',
        progress: 3,
        deadlineRound: undefined,
        required: false,
        satisfied: true,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

describe('buildCombatDebugReactionSummary', () => {
  test('returns all-undefined for no open window', () => {
    const summary = buildCombatDebugReactionSummary(stateWithOverrides({}));
    expect(summary.windowId).toBeUndefined();
    expect(summary.trigger).toBeUndefined();
    expect(summary.currentReactorId).toBeUndefined();
    expect(summary.windowVersion).toBeUndefined();
    expect(summary.orderedReactors).toEqual([]);
    expect(summary.policy).toBeUndefined();
  });

  test('projects the first open window and the reactor policy', () => {
    const base = stateWithOverrides({});
    const state: CombatState = withParticipation(
      { ...base, phase: 'reaction' },
      PLAYER_ID,
      (participation) => ({ ...participation, reactionPolicy: 'never' }),
    );
    const stateWithReaction: CombatState = {
      ...state,
      reaction: {
        windows: [
          {
            windowId: 'window-1',
            version: 2,
            status: 'open',
            initiatingCommandId: 'cmd-1',
            moverId: GOBLIN_ID,
            reactionId: 'opportunity_attack',
            reactorQueue: [PLAYER_ID],
            currentReactorId: PLAYER_ID,
            triggerCell: { x: 1, y: 1 },
            continuation: {
              continuationId: 'cont-1',
              initiatingCommandId: 'cmd-1',
              commandKind: 'move',
              combatantId: GOBLIN_ID,
              committedCells: [],
              remainingPath: [{ x: 2, y: 1 }],
              spentMovement: 1,
              resolvedWindowIds: [],
              offeredReactorIds: [],
            },
          },
        ],
      },
    };

    const summary = buildCombatDebugReactionSummary(stateWithReaction);
    expect(summary.windowId).toBe('window-1');
    expect(summary.trigger).toBe('opportunity_attack');
    expect(summary.currentReactorId).toBe(PLAYER_ID);
    expect(summary.windowVersion).toBe(2);
    expect(summary.orderedReactors).toEqual([PLAYER_ID]);
    expect(summary.policy).toBe('never');
  });
});

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe('evaluateCombatDebugAssertions', () => {
  test('returns no violations for a healthy state', () => {
    const state = stateWithOverrides({ stateRevision: 5 });
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 4,
      lastAcceptedCommandRevision: undefined,
    });
    expect(violations).toEqual([]);
  });

  test('detects a non-monotonic revision', () => {
    const state = stateWithOverrides({ stateRevision: 2 });
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 5,
      lastAcceptedCommandRevision: undefined,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.assertion).toBe('monotonic-revision');
    expect(violations[0]?.revision).toBe(2);
  });

  test('detects a negative movement budget', () => {
    const state = withCombatant(stateWithOverrides({}), PLAYER_ID, (combatant) => ({
      ...combatant,
      budget: { ...combatant.budget, movementRemaining: -1 },
    }));
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 0,
      lastAcceptedCommandRevision: undefined,
    });
    expect(violations.some((violation) => violation.assertion === 'budget-bounds')).toBe(true);
    expect(violations[0]?.detail).toContain(PLAYER_ID);
  });

  test('detects a settlement present before the ended phase', () => {
    const state = stateWithOverrides({
      settlement: {
        settlementId: 'settle-1',
        reasonCode: 'victory',
        round: 2,
      } as CombatState['settlement'],
    });
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 0,
      lastAcceptedCommandRevision: undefined,
    });
    expect(violations.some((violation) => violation.assertion === 'single-settlement')).toBe(true);
  });

  test('detects an ordinary command accepted during an open reaction', () => {
    const state = stateWithOverrides({ phase: 'reaction', stateRevision: 3 });
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 2,
      lastAcceptedCommandRevision: 3,
    });
    expect(
      violations.some((violation) => violation.assertion === 'no-ordinary-command-during-reaction'),
    ).toBe(true);
  });

  test('does not report a command at a different revision during reaction', () => {
    const state = stateWithOverrides({ phase: 'reaction', stateRevision: 3 });
    const violations = evaluateCombatDebugAssertions({
      state,
      previousRevision: 2,
      lastAcceptedCommandRevision: 2,
    });
    expect(
      violations.some((violation) => violation.assertion === 'no-ordinary-command-during-reaction'),
    ).toBe(false);
  });

  test('never repairs state', () => {
    const state = withCombatant(stateWithOverrides({}), PLAYER_ID, (combatant) => ({
      ...combatant,
      budget: { ...combatant.budget, movementRemaining: -3 },
    }));
    evaluateCombatDebugAssertions({
      state,
      previousRevision: 0,
      lastAcceptedCommandRevision: undefined,
    });
    expect(state.combatants[PLAYER_ID]?.budget.movementRemaining).toBe(-3);
  });
});
