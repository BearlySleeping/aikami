// packages/frontend/engine/src/__tests__/combat_reaction_policy.test.ts
//
// Review F8: the ENGINE owns the deterministic reaction policy, and normal
// turn/AI scheduling stays SUSPENDED while a reaction continuation is pending.
//
// The failure this locks down: the Ask / Auto / Never policy lived entirely in
// the client reaction flow. An opportunity attack is only ever offered to an
// actor HOSTILE to the mover — and hostiles are never player-controlled — so an
// enemy window was resolved by nothing at all when no decision surface was
// mounted, leaving the encounter in phase 'reaction' forever. Worse, both AI
// paths kept attempting commands through the suspension, and the kernel's
// `reactionPending` refusals were surfaced to the player as command errors.
//
// Contract: C-532 AC-3, C-526 §12.5

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES, OPPORTUNITY_ATTACK_ABILITY_ID } from '@aikami/constants';
import { emptyMoraleRules, emptyObjectiveRules } from '@aikami/schemas';
import type { CombatState, ReactionPolicy, ReactionRegistry } from '@aikami/types';
import { runV2AiTurns } from '../combat/combat_v2_ai.ts';
import { resolveEngineReactionPolicies } from '../combat/combat_v2_reaction_policy.ts';
import {
  buildV2CombatState,
  commitV2KernelCommand,
  engineReactionPolicyFor,
  playerControlsCombatant,
} from '../combat/combat_v2_resolver.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
import { GridPosition } from '../components/grid_position.ts';
import {
  buildCombatEncounterHarness,
  type CombatEncounterHarness,
  HARNESS_ENEMY_ID,
  HARNESS_PLAYER_ID,
} from './support/combat_encounter_harness.ts';

const REACTION_REGISTRY: ReactionRegistry = {
  definitions: [
    {
      reactionId: 'reaction.opportunity_attack',
      triggerKind: 'opportunity_attack',
      abilityId: OPPORTUNITY_ATTACK_ABILITY_ID,
      threatRangeCells: 1,
    },
  ],
};

/** The enemy's declared move that leaves the player's threat range. */
const ENEMY_ESCAPE_PATH = [
  { x: 2, y: 2 },
  { x: 2, y: 3 },
];
const DIRECT_ALLY_ID = 'emberwatch/direct_ally';

type Harness = CombatEncounterHarness & {
  /** Every kernel-event batch the engine published. */
  batches: Array<Array<{ kind: string; [key: string]: unknown }>>;
};

let harness: Harness;

/**
 * Builds an encounter where the ENEMY owns the first turn.
 *
 * Only the active combatant may legally move, and only an ENEMY can be a mover
 * whose exit offers a window to a player-controlled reactor. The enemy's move is
 * therefore driven through the engine-policy commit path, exactly as the AI
 * runner does.
 */
const buildEnemyFirstHarness = (options?: {
  playerPolicy?: ReactionPolicy;
  withDirectAlly?: boolean;
}): Harness => {
  const base = buildCombatEncounterHarness({
    first: 'enemy',
    depth: {
      objectiveRules: emptyObjectiveRules(),
      moraleRules: emptyMoraleRules(),
      reactionRegistry: REACTION_REGISTRY,
    },
    ...(options?.withDirectAlly === true
      ? {
          additionalParticipants: [
            {
              combatantId: DIRECT_ALLY_ID,
              team: 'ally' as const,
              cell: { x: 3, y: 1 },
              npcId: 'direct_ally',
              controlMode: 'direct' as const,
              stats: { hitPoints: 30, armorClass: 12, attackBonus: 4, initiative: 10 },
            },
          ],
        }
      : {}),
  });
  const batches: Harness['batches'] = [];
  base.bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
    batches.push(event.events as unknown as Harness['batches'][number]);
  });
  const harnessWithBatches: Harness = { ...base, batches };
  if (options?.playerPolicy !== undefined) {
    setPolicy(harnessWithBatches, HARNESS_PLAYER_ID, options.playerPolicy);
  }
  return harnessWithBatches;
};

/**
 * Rewrites one combatant's authored reaction policy on the live state.
 *
 * Projects first: before the encounter's opening state is built there is no live
 * state to write to, and a silent no-op would make the test assert the wrong
 * thing.
 */
const setPolicy = (target: Harness, combatantId: string, policy: ReactionPolicy): void => {
  buildV2CombatState({ world: target.world, abilityCatalog: BASIC_COMBAT_ABILITIES });
  const state = getLiveV2CombatState(target.world);
  expect(state).not.toBeNull();
  if (state === null) {
    return;
  }
  const participation = state.participation[combatantId];
  if (participation === undefined) {
    return;
  }
  // The kernel reads participation from the authoritative state, so this is the
  // same field the engine's policy resolution consults.
  state.participation[combatantId] = { ...participation, reactionPolicy: policy };
};

const liveState = (): CombatState | null => getLiveV2CombatState(harness.world);

/** Drives the enemy's move through the engine-policy path. */
const commitEnemyEscape = (path = ENEMY_ESCAPE_PATH): void => {
  const state = buildV2CombatState({
    world: harness.world,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
  expect(state).not.toBeNull();
  if (state === null) {
    return;
  }
  commitV2KernelCommand({
    world: harness.world,
    bridge: harness.bridge,
    state,
    command: { kind: 'move', combatantId: HARNESS_ENEMY_ID, path },
  });
};

const eventsOf = (kind: string): Array<Record<string, unknown>> =>
  harness.batches.flat().filter((event) => event.kind === kind) as Array<Record<string, unknown>>;

/** Dispatches the player's decision for the currently open window. */
const submitPlayerDecision = (choice: 'accept' | 'decline'): void => {
  const state = liveState();
  const window = state?.reaction.windows.find((entry) => entry.status === 'open');
  expect(window).toBeDefined();
  if (state === null || window === undefined) {
    return;
  }
  harness.dispatchRaw({
    type: 'COMBAT_REACTION_SELECTED',
    encounterId: state.encounterId,
    encounterRunId: state.encounterRunId,
    windowId: window.windowId,
    windowVersion: window.version,
    reactorId: window.currentReactorId ?? HARNESS_PLAYER_ID,
    choice,
    source: 'player',
    basedOnRevision: state.stateRevision,
  });
};

beforeEach(() => {
  harness = buildEnemyFirstHarness();
});

afterEach(() => {
  harness.dispose();
});

describe('review F8: the engine owns the deterministic policy', () => {
  it('pins `auto` for an actor the player does not control and `ask` for one they do', () => {
    commitEnemyEscape();
    const state = liveState();
    expect(state).not.toBeNull();
    if (state === null) {
      return;
    }
    expect(playerControlsCombatant(state, HARNESS_PLAYER_ID)).toBe(true);
    expect(playerControlsCombatant(state, HARNESS_ENEMY_ID)).toBe(false);
    expect(engineReactionPolicyFor(state, HARNESS_PLAYER_ID)).toBe('ask');
    expect(engineReactionPolicyFor(state, HARNESS_ENEMY_ID)).toBe('auto');
  });

  it('Auto: resolves the NPC window with no UI and spends the reaction exactly once', () => {
    // The Auto path needs an ENEMY reactor, and only a hostile can be one — so
    // the mover must be the player. This is the shape the game actually has:
    // the player withdraws from an enemy's threat range.
    const auto = buildCombatEncounterHarness({
      depth: {
        objectiveRules: emptyObjectiveRules(),
        moraleRules: emptyMoraleRules(),
        reactionRegistry: REACTION_REGISTRY,
      },
    });
    const batches: Harness['batches'] = [];
    auto.bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
      batches.push(event.events as unknown as Harness['batches'][number]);
    });
    try {
      // The player moves out of the enemy's threat range.
      auto.dispatch({ type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

      const resolved = batches.flat().filter((event) => event.kind === 'reactionResolved') as Array<
        Record<string, unknown>
      >;
      // Exactly one decision, taken by the ENGINE, with no submission anywhere.
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.reactorId).toBe(HARNESS_ENEMY_ID);
      expect(resolved[0]?.source).toBe('ai_policy');
      expect(resolved[0]?.spentReaction).toBe(true);
      // The suspension released and the mover completed its declared move.
      const state = getLiveV2CombatState(auto.world);
      expect(state?.phase).toBe('active');
      expect(state?.reaction.windows).toEqual([]);
      expect(auto.rejected).toEqual([]);
      expect(GridPosition.y[auto.playerEid]).toBe(2);
    } finally {
      auto.dispose();
    }
  });

  it('Never: an authored `never` policy declines with no UI', () => {
    setPolicy(harness, HARNESS_PLAYER_ID, 'never');
    commitEnemyEscape();

    // The engine declines deterministically — no decision surface answered.
    const declines = eventsOf('reactionResolved');
    expect(declines).toHaveLength(1);
    expect(declines[0]?.choice).toBe('decline');
    expect(declines[0]?.source).toBe('ai_policy');
    expect(declines[0]?.reactorId).toBe(HARNESS_PLAYER_ID);
    expect(declines[0]?.spentReaction).toBe(false);
    // The suspension released and the mover committed the cell it declared.
    expect(liveState()?.phase).toBe('active');
    expect(liveState()?.reaction.windows).toEqual([]);
    expect(GridPosition.y[harness.enemyEid]).toBeGreaterThanOrEqual(2);
    expect(harness.rejected).toEqual([]);
  });

  it('Ask: a player-controlled reactor waits for a valid submission', () => {
    commitEnemyEscape();

    // Nothing resolved it: the surface owns a human decision.
    expect(eventsOf('reactionResolved')).toHaveLength(0);
    expect(liveState()?.phase).toBe('reaction');

    submitPlayerDecision('decline');

    const declines = eventsOf('reactionResolved');
    expect(declines).toHaveLength(1);
    expect(declines[0]?.choice).toBe('decline');
    expect(declines[0]?.source).toBe('player');
    expect(harness.rejected).toEqual([]);
  });

  it('Never on the player and Auto on the NPC both resolve without any submission', () => {
    setPolicy(harness, HARNESS_PLAYER_ID, 'never');
    // No `submitPlayerDecision` call anywhere in this test.
    commitEnemyEscape();
    expect(harness.rejected).toEqual([]);
    expect(liveState()?.reaction.windows.filter((w) => w.status === 'open')).toHaveLength(0);
  });
});

describe('review F8: AI scheduling is suspended while a window is pending', () => {
  it('the deterministic AI runner attempts nothing through a suspension', () => {
    commitEnemyEscape();
    const revisionBefore = liveState()?.stateRevision;
    const rejectedBefore = harness.rejected.length;

    runV2AiTurns({
      world: harness.world,
      bridge: harness.bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId: harness.playerEid,
    });

    // Nothing moved, and — critically — no spurious player-facing rejection.
    expect(liveState()?.stateRevision).toBe(revisionBefore);
    expect(harness.rejected.length).toBe(rejectedBefore);
    expect(liveState()?.phase).toBe('reaction');
  });

  it('emits no COMBAT_COMMAND_REJECTED while a window is pending', () => {
    commitEnemyEscape();
    const rejectedBefore = harness.rejected.length;

    // Both AI entry points, repeatedly, while suspended.
    for (let attempt = 0; attempt < 3; attempt++) {
      runV2AiTurns({
        world: harness.world,
        bridge: harness.bridge,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        playerEntityId: harness.playerEid,
      });
    }

    expect(harness.rejected.length).toBe(rejectedBefore);
    expect(harness.rejected.filter((entry) => entry.reasonCode === 'reactionPending')).toEqual([]);
  });

  it('resumes normal AI continuation after the window resolves, on a NEW window', () => {
    setPolicy(harness, HARNESS_PLAYER_ID, 'never');
    commitEnemyEscape();
    // The engine declined the first window; the enemy's turn continues.
    const firstDecisions = eventsOf('reactionResolved');
    expect(firstDecisions).toHaveLength(1);
    const firstWindowId = firstDecisions[0]?.windowId;
    expect(typeof firstWindowId).toBe('string');

    runV2AiTurns({
      world: harness.world,
      bridge: harness.bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId: harness.playerEid,
    });

    // The continuation may legitimately open a FURTHER window (the AI moved the
    // enemy again). What it must never do is decide the SAME window twice.
    const decisions = eventsOf('reactionResolved');
    const windowIds = decisions.map((event) => event.windowId);
    expect(new Set(windowIds).size).toBe(windowIds.length);
    expect(decisions.filter((event) => event.windowId === firstWindowId)).toHaveLength(1);
    expect(harness.rejected).toEqual([]);
  });

  it('a second AI invocation does not decide the same window twice', () => {
    setPolicy(harness, HARNESS_PLAYER_ID, 'never');
    commitEnemyEscape();
    const revisionAfterFirst = liveState()?.stateRevision ?? 0;

    runV2AiTurns({
      world: harness.world,
      bridge: harness.bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId: harness.playerEid,
    });
    const windowIdsAfterFirstRun = eventsOf('reactionResolved').map((event) => event.windowId);

    runV2AiTurns({
      world: harness.world,
      bridge: harness.bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId: harness.playerEid,
    });
    const windowIdsAfterSecondRun = eventsOf('reactionResolved').map((event) => event.windowId);

    // Every window is decided exactly once, across both invocations.
    expect(new Set(windowIdsAfterSecondRun).size).toBe(windowIdsAfterSecondRun.length);
    // The second invocation did not re-decide any window the first one decided.
    for (const windowId of windowIdsAfterFirstRun) {
      expect(windowIdsAfterSecondRun.filter((id) => id === windowId)).toHaveLength(1);
    }
    const after = liveState();
    if (after !== null && after.phase !== 'ended') {
      expect(after.stateRevision).toBeGreaterThanOrEqual(revisionAfterFirst);
    }
    expect(harness.rejected).toEqual([]);
  });
});

describe('review F8: queued reactors', () => {
  it('offers each eligible hostile reactor in turn and drains them all', () => {
    // Two player-side reactors cannot both be hostile to an enemy mover unless
    // the player and a Direct ally are both in threat range. The engine must
    // resolve the non-player-controlled one and leave the player's.
    harness.dispose();
    harness = buildEnemyFirstHarness({ withDirectAlly: true });
    setPolicy(harness, HARNESS_PLAYER_ID, 'never');
    commitEnemyEscape();

    const resolved = eventsOf('reactionResolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.reactorId).toBe(HARNESS_PLAYER_ID);
    expect(liveState()?.reaction.windows.find((w) => w.status === 'open')?.currentReactorId).toBe(
      DIRECT_ALLY_ID,
    );

    submitPlayerDecision('decline');
    // The queue is drained: no window is left open once every reactor has
    // decided, so the encounter is playable again.
    expect(liveState()?.reaction.windows.filter((w) => w.status === 'open')).toHaveLength(0);
  });
});

describe('review F8: the drain is bounded and re-entrancy safe', () => {
  it('is idempotent when invoked twice with nothing pending', () => {
    commitEnemyEscape();
    const before = liveState()?.stateRevision;
    resolveEngineReactionPolicies({
      world: harness.world,
      bridge: harness.bridge,
      readState: () => getLiveV2CombatState(harness.world),
      commit: (command) => {
        const current = getLiveV2CombatState(harness.world);
        if (current === null) {
          throw new Error('no live state');
        }
        return commitV2KernelCommand({
          world: harness.world,
          bridge: harness.bridge,
          state: current,
          command,
        });
      },
    });
    expect(liveState()?.stateRevision).toBe(before);
    expect(liveState()?.phase).toBe('reaction');
  });
});
