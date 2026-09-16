// packages/shared/utils/src/lib/rules/__tests__/combat_reactions.test.ts
//
// AC-3: opportunity attacks suspend and resume commands correctly.
//
// Covers: trigger detection at the exit cell, eligibility (active, able to
// react, budget, ability ownership, targeting range, hostility), forced
// movement, ordering, nesting cap, stale/duplicate rejection, committed
// prefix vs continuation, and continuation cancellation.
//
// Contract: C-532 AC-3

import { describe, expect, it } from 'bun:test';
import type { CombatantState, ParticipationState } from '@aikami/types';
import {
  advanceReactorQueue,
  buildMoveContinuation,
  buildReactionWindow,
  computeOpportunityTriggers,
  continuationCanResume,
  isHostileToward,
  opportunityReaction,
  reactionRequestIsCurrent,
  reactionWindowId,
  reactorIsEligible,
  resetReactionForTurn,
  resolveReactionWindow,
} from '../combat_reactions';
import {
  DEPTH_ABILITY_CATALOG,
  HOUND_ID,
  makeDepthCombatants,
  PLAYER_ID,
  REACTION_REGISTRY,
  WARDEN_ID,
} from './combat_depth_fixtures';

const combatants = (): Record<string, CombatantState> =>
  Object.fromEntries(makeDepthCombatants().map((c) => [c.combatantId, c]));

const participation = (
  overrides: Record<string, Partial<ParticipationState>> = {},
): Record<string, ParticipationState> =>
  Object.fromEntries(
    Object.keys(combatants()).map((combatantId) => [
      combatantId,
      {
        status: 'active' as const,
        morale: 100,
        appliedTriggerIds: [],
        reactionPolicy: 'ask' as const,
        ...(overrides[combatantId] ?? {}),
      },
    ]),
  );

const triggers = (options: {
  combatants?: Record<string, CombatantState>;
  participation?: Record<string, ParticipationState>;
  path: { x: number; y: number }[];
  cause?: 'voluntary' | 'forced' | 'teleport' | 'reaction';
  nested?: boolean;
}) =>
  computeOpportunityTriggers({
    mover: (options.combatants ?? combatants())[PLAYER_ID],
    path: options.path,
    combatants: options.combatants ?? combatants(),
    participation: options.participation ?? participation(),
    registry: REACTION_REGISTRY,
    abilityCatalog: DEPTH_ABILITY_CATALOG,
    cause: options.cause ?? 'voluntary',
    nested: options.nested ?? false,
  });

/**
 * Mover starts adjacent to the hound (threat range 1) and walks away, so the
 * first committed step is the one that exits the threat range.
 */
const moverInRange = (): Record<string, CombatantState> => {
  const roster = combatants();
  roster[PLAYER_ID] = { ...roster[PLAYER_ID], position: { x: 1, y: 0 } };
  return roster;
};

describe('AC-3 trigger detection', () => {
  it('opens a window at the FIRST cell that leaves the reactor’s threat range', () => {
    // Hound at (2,0), threat range 1: (1,0) is in range, (0,0) is not.
    const groups = triggers({
      combatants: moverInRange(),
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].pathIndex).toBe(0);
    expect(groups[0].triggerCell).toEqual({ x: 0, y: 0 });
    expect(groups[0].reactorIds).toEqual([HOUND_ID]);
  });

  it('opens no window when the mover never leaves the threat range', () => {
    expect(triggers({ combatants: moverInRange(), path: [{ x: 2, y: 0 }] })).toEqual([]);
  });

  it('opens no window when the mover was never in range', () => {
    expect(
      triggers({
        path: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
      }),
    ).toEqual([]);
  });

  it('never triggers on forced, teleport-like or reaction-generated movement', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    const roster = moverInRange();
    expect(triggers({ combatants: roster, path, cause: 'forced' })).toEqual([]);
    expect(triggers({ combatants: roster, path, cause: 'teleport' })).toEqual([]);
    expect(triggers({ combatants: roster, path, cause: 'reaction' })).toEqual([]);
  });

  it('never triggers while a window is already open — nesting is capped at one', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(triggers({ combatants: moverInRange(), path, nested: true })).toEqual([]);
  });

  it('does not trigger for a reactor that is not hostile to the mover', () => {
    const roster = moverInRange();
    roster[GOBLIN_LIKE] = {
      ...roster[HOUND_ID],
      combatantId: GOBLIN_LIKE,
      team: 'ally',
      position: { x: 2, y: 0 },
    };
    roster[HOUND_ID] = { ...roster[HOUND_ID], position: { x: 7, y: 7 } };
    expect(triggers({ combatants: roster, path: [{ x: 0, y: 0 }] })).toEqual([]);
  });
});

const GOBLIN_LIKE = 'emberwatch:goblin-like';

describe('AC-3 eligibility', () => {
  const reaction = opportunityReaction(REACTION_REGISTRY);
  if (reaction === null) {
    throw new Error('fixture registry must register the opportunity attack');
  }

  const eligible = (overrides: {
    reactor?: Partial<CombatantState>;
    participation?: Partial<ParticipationState>;
  }) => {
    const roster = moverInRange();
    const reactor: CombatantState = { ...roster[HOUND_ID], ...(overrides.reactor ?? {}) };
    return reactorIsEligible({
      reactor,
      mover: roster[PLAYER_ID],
      participation: { ...participation()[HOUND_ID], ...(overrides.participation ?? {}) },
      reaction,
      ability: DEPTH_ABILITY_CATALOG[reaction.abilityId],
      // The mover's current cell — the cell it is leaving.
      targetPosition: roster[PLAYER_ID].position,
    });
  };

  it('accepts an active, budgeted, in-range reactor that owns the ability', () => {
    expect(eligible({})).toBe(true);
  });

  it('rejects a reactor whose reaction is already spent', () => {
    expect(
      eligible({
        reactor: { budget: { ...combatants()[HOUND_ID].budget, reactionAvailable: false } },
      }),
    ).toBe(false);
  });

  it('rejects a downed or defeated reactor', () => {
    expect(eligible({ reactor: { downed: true } })).toBe(false);
    expect(eligible({ reactor: { defeated: true } })).toBe(false);
  });

  it('rejects a reactor whose participation is not active', () => {
    expect(eligible({ participation: { status: 'surrendered' } })).toBe(false);
    expect(eligible({ participation: { status: 'retreating' } })).toBe(false);
  });

  it('rejects a reactor that does not own the registered ability', () => {
    expect(eligible({ reactor: { abilityIds: ['basic_melee'] } })).toBe(false);
  });

  it('rejects a target position outside the ability’s targeting range', () => {
    const roster = moverInRange();
    expect(
      reactorIsEligible({
        reactor: roster[HOUND_ID],
        mover: roster[PLAYER_ID],
        participation: participation()[HOUND_ID],
        reaction,
        ability: DEPTH_ABILITY_CATALOG[reaction.abilityId],
        targetPosition: { x: 6, y: 6 },
      }),
    ).toBe(false);
  });

  it('rejects a missing ability catalog entry rather than assuming a default', () => {
    const roster = moverInRange();
    expect(
      reactorIsEligible({
        reactor: roster[HOUND_ID],
        mover: roster[PLAYER_ID],
        participation: participation()[HOUND_ID],
        reaction,
        ability: undefined,
        targetPosition: roster[PLAYER_ID].position,
      }),
    ).toBe(false);
  });
});

describe('AC-3 simultaneous reactor ordering', () => {
  it('orders by initiative descending, then stable id ascending', () => {
    const roster = moverInRange();
    // Two reactors adjacent to the mover's current cell, with equal initiative.
    roster.REACTOR_B = {
      ...roster[HOUND_ID],
      combatantId: 'REACTOR_B',
      team: 'enemy',
      position: { x: 1, y: 1 },
      initiative: 7,
    };
    roster.REACTOR_A = {
      ...roster[HOUND_ID],
      combatantId: 'REACTOR_A',
      team: 'enemy',
      position: { x: 2, y: 0 },
      initiative: 7,
    };
    const groups = computeOpportunityTriggers({
      mover: roster[PLAYER_ID],
      path: [{ x: 0, y: 0 }],
      combatants: roster,
      participation: participation(),
      registry: REACTION_REGISTRY,
      abilityCatalog: DEPTH_ABILITY_CATALOG,
      cause: 'voluntary',
      nested: false,
    });
    expect(groups).toHaveLength(1);
    // HOUND (initiative 11) first, then the equal-initiative pair by id.
    expect(groups[0].reactorIds).toEqual([HOUND_ID, 'REACTOR_A', 'REACTOR_B']);
  });
});

describe('AC-3 window lifecycle', () => {
  const continuation = buildMoveContinuation({
    continuationId: 'cont:1',
    initiatingCommandId: 'cmd:1',
    combatantId: PLAYER_ID,
    fullPath: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    committedPathIndex: 0,
    spentMovement: 1,
  });

  const window = buildReactionWindow({
    initiatingCommandId: 'cmd:1',
    moverId: PLAYER_ID,
    reactionId: 'reaction.opportunity_attack',
    trigger: { triggerCell: { x: 2, y: 0 }, pathIndex: 1, reactorIds: [HOUND_ID, WARDEN_ID] },
    continuation,
    version: 1,
  });

  it('builds a deterministic window id and starts at the first reactor', () => {
    expect(window.windowId).toBe(reactionWindowId('cmd:1', 1, 1));
    expect(window.currentReactorId).toBe(HOUND_ID);
    expect(window.status).toBe('open');
  });

  it('commits only the prefix and keeps the remaining path on the continuation', () => {
    expect(continuation.committedCells).toEqual([{ x: 1, y: 0 }]);
    expect(continuation.remainingPath).toEqual([
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(continuation.spentMovement).toBe(1);
  });

  it('advances the queue, bumping the version so a stale request is rejected', () => {
    const advanced = advanceReactorQueue(window);
    expect(advanced.currentReactorId).toBe(WARDEN_ID);
    expect(advanced.version).toBe(2);
    expect(
      reactionRequestIsCurrent({
        window: advanced,
        windowId: window.windowId,
        windowVersion: 1,
        reactorId: HOUND_ID,
      }),
    ).toBe(false);
    expect(
      reactionRequestIsCurrent({
        window: advanced,
        windowId: window.windowId,
        windowVersion: 2,
        reactorId: WARDEN_ID,
      }),
    ).toBe(true);
  });

  it('drains the queue to null and records the window on the continuation when resolved', () => {
    const drained = advanceReactorQueue(advanceReactorQueue(window));
    expect(drained.currentReactorId).toBeNull();
    const resolved = resolveReactionWindow(drained);
    expect(resolved.status).toBe('resolved');
    expect(resolved.continuation.resolvedWindowIds).toEqual([window.windowId]);
    expect(resolved.continuation.pendingWindowId).toBeNull();
  });

  it('rejects a request against a resolved window even at the right version', () => {
    const resolved = resolveReactionWindow(window);
    expect(
      reactionRequestIsCurrent({
        window: resolved,
        windowId: resolved.windowId,
        windowVersion: resolved.version,
        reactorId: HOUND_ID,
      }),
    ).toBe(false);
  });

  it('rejects a request naming a different reactor than the current one', () => {
    expect(
      reactionRequestIsCurrent({
        window,
        windowId: window.windowId,
        windowVersion: window.version,
        reactorId: WARDEN_ID,
      }),
    ).toBe(false);
  });
});

describe('AC-3 continuation resume', () => {
  it('cancels when the mover is downed by the reaction', () => {
    const roster = combatants();
    expect(
      continuationCanResume({
        mover: { ...roster[PLAYER_ID], downed: true, defeated: true },
        participation: participation()[PLAYER_ID],
        phaseEnded: false,
      }),
    ).toBe(false);
  });

  it('cancels when the mover surrendered or the encounter ended', () => {
    const roster = combatants();
    expect(
      continuationCanResume({
        mover: roster[PLAYER_ID],
        participation: { ...participation()[PLAYER_ID], status: 'surrendered' },
        phaseEnded: false,
      }),
    ).toBe(false);
    expect(
      continuationCanResume({
        mover: roster[PLAYER_ID],
        participation: participation()[PLAYER_ID],
        phaseEnded: true,
      }),
    ).toBe(false);
  });

  it('cancels when the mover is missing from the roster', () => {
    expect(
      continuationCanResume({
        mover: undefined,
        participation: undefined,
        phaseEnded: false,
      }),
    ).toBe(false);
  });

  it('resumes a healthy active mover', () => {
    const roster = combatants();
    expect(
      continuationCanResume({
        mover: roster[PLAYER_ID],
        participation: participation()[PLAYER_ID],
        phaseEnded: false,
      }),
    ).toBe(true);
  });
});

describe('AC-3 reaction reset and hostility', () => {
  it('resets reaction availability at the start of the reactor’s own turn', () => {
    const budget = { ...combatants()[HOUND_ID].budget, reactionAvailable: false };
    expect(resetReactionForTurn(budget).reactionAvailable).toBe(true);
  });

  it('treats player/ally vs enemy as hostile in both directions and neutral as never hostile', () => {
    expect(isHostileToward('enemy', 'player')).toBe(true);
    expect(isHostileToward('player', 'enemy')).toBe(true);
    expect(isHostileToward('ally', 'enemy')).toBe(true);
    expect(isHostileToward('enemy', 'ally')).toBe(true);
    expect(isHostileToward('enemy', 'enemy')).toBe(false);
    expect(isHostileToward('player', 'ally')).toBe(false);
    expect(isHostileToward('neutral', 'player')).toBe(false);
    expect(isHostileToward('player', 'neutral')).toBe(false);
  });

  it('returns null when no opportunity attack is registered', () => {
    expect(opportunityReaction({ definitions: [] })).toBeNull();
  });
});
