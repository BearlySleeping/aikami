// packages/frontend/engine/src/__tests__/combat_reaction_bridge.test.ts
//
// C-532 (Combat-08) reaction bridge round trip.
//
//   AC-3  an opportunity attack suspends and resumes a move
//
// The harness drives the PRODUCTION dispatch entry point
// (`dispatchCombatCommand`) against a real bitECS world, so the bridge
// registration, the worker routing, the kernel commit, the ECS apply and the
// event mapping are all exercised together. No Worker is spun up.
//
// Before C-532 wired this path the kernel could open a window nothing in the
// client could resolve: `COMBAT_REACTION_SELECTED` had no registered forwarder
// (so `EngineBridge.send` dropped it) and nothing emitted
// `COMBAT_REACTION_OPENED`, leaving the encounter suspended in phase
// `'reaction'` forever.
//
// Contract: C-532 AC-3

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES, OPPORTUNITY_ATTACK_ABILITY_ID } from '@aikami/constants';
import { emptyMoraleRules, emptyObjectiveRules } from '@aikami/schemas';
import type { CombatState, ReactionRegistry } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  dispatchCombatCommand,
  isCombatDispatchCommand,
} from '../combat/combat_command_dispatch.ts';
import type { EncounterDepth } from '../combat/combat_encounter_depth.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
} from '../combat/combat_encounter_start.ts';
import { startProductionEncounter } from '../combat/combat_encounter_start.ts';
import {
  buildV2CombatState,
  commitV2KernelCommand,
  engineReactionPolicyFor,
} from '../combat/combat_v2_resolver.ts';
import { withLiveIdentity } from './support/combat_command_identity.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { CombatMovement, registerCombatMovementObservers } from '../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { Enemy, registerEnemyObservers } from '../components/enemy.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c532-reaction-encounter';
const PLAYER_ID = 'player';
const ENEMY_ID = 'emberwatch/ash_hound';

/** One registered opportunity attack — the only reaction this release ships. */
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

const DEPTH: EncounterDepth = {
  objectiveRules: emptyObjectiveRules(),
  moraleRules: emptyMoraleRules(),
  reactionRegistry: REACTION_REGISTRY,
};

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const playerParticipant = (
  cell: { x: number; y: number },
  initiative = PLAYER_INITIATIVE_WHEN_FIRST,
): CombatEncounterParticipant => ({
  combatantId: PLAYER_ID,
  team: 'player',
  cell,
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 10, initiative },
  classIds: ['wizard'],
});

const enemyParticipant = (
  cell: { x: number; y: number },
  initiative = 5,
): CombatEncounterParticipant => ({
  combatantId: ENEMY_ID,
  team: 'enemy',
  cell,
  npcId: 'ash_hound',
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative },
});

/**
 * The Ask path needs a reactor the player controls AND that is hostile to the
 * mover. The only such actor is the PLAYER (or a Direct ally) when an ENEMY
 * moves — so the Ask fixtures make the enemy the active combatant and drive its
 * move through the engine-policy commit path, exactly as the AI runner does.
 */
const ENEMY_INITIATIVE_WHEN_FIRST = 40;
const PLAYER_INITIATIVE_WHEN_FIRST = 30;

type OpenedEvent = {
  windowId: string;
  windowVersion: number;
  encounterRunId: string;
  moverId: string;
  reactionId: string;
  currentReactorId: string | null;
  reactorQueue: string[];
  triggerCell: { x: number; y: number };
  reactionPolicy: string;
  abilityId: string;
  committedCells: Array<{ x: number; y: number }>;
};

type ResolvedEvents = Array<{ kind: string; [key: string]: unknown }>;

type Fixture = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  opened: OpenedEvent[];
  rejected: Array<{ reasonCode: string }>;
  /**
   * Every kernel-event batch the engine published, in order.
   *
   * The resumed move legitimately continues under AI policy after a reaction
   * resolves, so asserting on the final state would be asserting on the AI's
   * later decisions. These batches let a test assert what the REACTION did.
   */
  resolved: ResolvedEvents[];
};

/**
 * `reactor` decides which actor is offered the opportunity window.
 *
 * `enemy` is an actor the player does NOT control, so the ENGINE resolves the
 * window deterministically (review F8) — no mounted UI required. `direct-ally`
 * is a player-controlled companion, so the policy is `ask` and the window stays
 * open for the decision surface.
 */
const buildFixture = (options: {
  withReactions?: boolean;
  /** Which actor owns the first turn — it decides who can legally move. */
  first?: 'player' | 'enemy';
} = {}): Fixture => {
  const enemyFirst = options.first === 'enemy';
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installTerrain();

  const bridge = new MockEngineBridge();

  const playerEid = addEntity(world);
  addComponent(world, playerEid, CombatStats);
  addComponent(
    world,
    playerEid,
    set(CombatStats, {
      health: 40,
      maxHealth: 40,
      initiative: 30,
      attack: 5,
      defense: 0,
      accuracy: 10,
      evasion: 10,
    }),
  );
  addComponent(world, playerEid, TurnOrder);
  addComponent(
    world,
    playerEid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 30, isActive: true }),
  );

  const roster: CombatEncounterRoster = {
    encounterId: ENCOUNTER_ID,
    seed: 1234,
    engine: 'v2',
    participants: [
      playerParticipant(
        { x: 1, y: 1 },
        enemyFirst ? PLAYER_INITIATIVE_WHEN_FIRST - 10 : PLAYER_INITIATIVE_WHEN_FIRST,
      ),
      enemyParticipant({ x: 2, y: 1 }, enemyFirst ? ENEMY_INITIATIVE_WHEN_FIRST : 5),
    ],
    ...(options.withReactions === false ? {} : { depth: DEPTH }),
  };

  const started = startProductionEncounter({
    world,
    bridge,
    roster,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
  });
  expect(started.ok).toBe(true);

  const opened: OpenedEvent[] = [];
  const rejected: Array<{ reasonCode: string }> = [];
  const resolved: ResolvedEvents[] = [];
  bridge.on('COMBAT_REACTION_OPENED', (event) => opened.push(event as OpenedEvent));
  bridge.on('COMBAT_COMMAND_REJECTED', (event) => rejected.push(event));
  bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
    resolved.push(event.events as unknown as ResolvedEvents);
  });

  const participantIds = started.ok ? started.participantIds : [];
  return {
    world,
    bridge,
    playerEid,
    enemyEid: participantIds[1] ?? 0,
    opened,
    rejected,
    resolved,
  };
};

/**
 * The ONE `reactionResolved` event for a specific window.
 *
 * Scoped by window id on purpose: the resumed move continues under AI policy and
 * can legitimately open a FURTHER window for the player, so a test that asserted
 * "there is exactly one reaction in the encounter" would be asserting on the
 * AI's later decisions rather than on the decision under test.
 */
const reactionForWindow = (
  target: Fixture,
  windowId: string,
): { event: Record<string, unknown>; batch: ResolvedEvents } => {
  const matching = target.resolved.filter((group) =>
    group.some((event) => event.kind === 'reactionResolved' && event.windowId === windowId),
  );
  expect(matching).toHaveLength(1);
  const batch = matching[0] ?? [];
  const events = batch.filter(
    (event) => event.kind === 'reactionResolved' && event.windowId === windowId,
  );
  expect(events).toHaveLength(1);
  return { event: events[0] ?? {}, batch };
};

const dispatch = (target: Fixture, command: Parameters<typeof dispatchCombatCommand>[0]): void => {
  // Review F-B: an ordinary move carries the admission envelope; a reaction
  // choice is validated by the kernel's own window/run checks.
  dispatchCombatCommand(
    withLiveIdentity(
      { world: target.world, abilityCatalog: BASIC_COMBAT_ABILITIES },
      command as { type: string },
    ) as Parameters<typeof dispatchCombatCommand>[0],
    {
    world: target.world,
    bridge: target.bridge,
      playerEntityId: target.playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    },
  );
};

const resetCombatComponentGlobals = (): void => {
  for (let eid = 0; eid < 64; eid++) {
    Companion.recruited[eid] = false;
    Companion.npcId[eid] = '';
    Companion.approval[eid] = 0;
    Enemy.isActive[eid] = false;
    Enemy.spawnId[eid] = '';
    Enemy.encounterId[eid] = '';

    delete CombatMovement.movementPerTurn[eid];
    CombatIdentity.combatantId[eid] = '';
  }
};

let fixture: Fixture;

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  resetCollisionGrid();
  resetCombatComponentGlobals();
});

const liveState = (target: Fixture) =>
  buildV2CombatState({ world: target.world, abilityCatalog: BASIC_COMBAT_ABILITIES });

/**
 * Commits an ENEMY move through the engine-policy path.
 *
 * The dispatcher deliberately refuses a client command for an actor the player
 * does not control, so an enemy move can only come from the engine's own policy
 * (the AI runner) — which is exactly what this simulates.
 */
const commitEnemyMove = (target: Fixture, path: Array<{ x: number; y: number }>): void => {
  const state = liveState(target);
  expect(state).not.toBeNull();
  if (state === null) {
    return;
  }
  commitV2KernelCommand({
    world: target.world,
    bridge: target.bridge,
    state,
    command: { kind: 'move', combatantId: ENEMY_ID, path },
  });
};

describe('C-532 AC-3: the reaction bridge round trip', () => {
  it('routes COMBAT_REACTION_SELECTED through the combat dispatcher', () => {
    // An unregistered command is dropped on the main thread and an unrouted one
    // is dropped in the worker — either leaves the window unresolved.
    expect(
      isCombatDispatchCommand({
        type: 'COMBAT_REACTION_SELECTED',
        encounterId: ENCOUNTER_ID,
        encounterRunId: 'run',
        windowId: 'w',
        windowVersion: 1,
        reactorId: PLAYER_ID,
        choice: 'decline',
        source: 'player',
        basedOnRevision: 0,
      }),
    ).toBe(true);
  });

  it('opens a window on the bridge when a move leaves a threat range', () => {
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

    expect(fixture.opened).toHaveLength(1);
    const event = fixture.opened[0];
    expect(event?.moverId).toBe(PLAYER_ID);
    expect(event?.currentReactorId).toBe(ENEMY_ID);
    expect(event?.reactorQueue).toEqual([ENEMY_ID]);
    expect(event?.reactionId).toBe('reaction.opportunity_attack');
    expect(event?.abilityId).toBe(OPPORTUNITY_ATTACK_ABILITY_ID);
    // The trigger cell is the cell the mover was ATTEMPTING to enter.
    expect(event?.triggerCell).toEqual({ x: 1, y: 2 });
    // The enemy is not player-controlled, so it has no decision surface: the
    // engine pins a deterministic policy instead of blocking on a model.
    expect(event?.reactionPolicy).toBe('auto');
    // Review F8: and the ENGINE resolves it. The window is opened, published and
    // decided inside the same commit, so the encounter is never left suspended
    // waiting for a UI that may not be mounted.
    const state = liveState(fixture);
    expect(state?.phase).toBe('active');
    expect(state?.reaction.windows).toEqual([]);
    expect(state?.combatants[ENEMY_ID]?.budget.reactionAvailable).toBe(false);
    expect(GridPosition.y[fixture.playerEid]).toBe(2);
  });

  it('emits nothing when the encounter authors no reaction', () => {
    const withoutReactions = buildFixture({ withReactions: false });
    dispatch(withoutReactions, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

    expect(withoutReactions.opened).toHaveLength(0);
    expect(liveState(withoutReactions)?.phase).toBe('active');
  });

  it('suspends for a player-controlled reactor and resolves its decline exactly once', () => {
    // The ENEMY is active and moves through the engine-policy commit path (the
    // same path the AI runner uses). The player is hostile to it, so the player
    // is the reactor — and the player IS player-controlled, so the policy is
    // `ask` and the window waits for the decision surface.
    const ask = buildFixture({ first: 'enemy' });
    commitEnemyMove(ask, [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ]);

    const opened = ask.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }
    expect(opened.moverId).toBe(ENEMY_ID);
    expect(opened.currentReactorId).toBe(PLAYER_ID);
    expect(opened.reactionPolicy).toBe('ask');
    // Still suspended — the engine refuses to decide for a human-controlled actor.
    expect(liveState(ask)?.phase).toBe('reaction');

    dispatch(ask, {
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: PLAYER_ID,
      choice: 'decline',
      source: 'player',
      basedOnRevision: liveState(ask)?.stateRevision ?? -1,
    });

    // The DECLINE resolved exactly once, spent nothing, and targeted nothing.
    const decline = reactionForWindow(ask, opened.windowId);
    expect(decline.event.choice).toBe('decline');
    expect(decline.event.reactorId).toBe(PLAYER_ID);
    expect(decline.event.source).toBe('player');
    expect(decline.event.spentReaction).toBe(false);
    expect(decline.event.abilityId).toBeNull();
    // Declining never rolls an attack for this window.
    expect(decline.batch.filter((event) => event.kind === 'attackRolled')).toHaveLength(0);
    // The suspension released and the mover committed the cell it declared.
    expect(GridPosition.y[ask.enemyEid]).toBeGreaterThanOrEqual(2);
    expect(ask.rejected).toEqual([]);
    resetCollisionGrid();
    resetCombatComponentGlobals();
  });

  it('rejects a stale or duplicate choice without spending anything', () => {
    const ask = buildFixture({ first: 'enemy' });
    commitEnemyMove(ask, [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ]);
    const opened = ask.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }

    const selection = {
      type: 'COMBAT_REACTION_SELECTED' as const,
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: PLAYER_ID,
      choice: 'decline' as const,
      source: 'player' as const,
      basedOnRevision: liveState(ask)?.stateRevision ?? -1,
    };
    dispatch(ask, selection);
    // The window is gone, so the replay is a typed rejection — not a second
    // resolution that would advance RNG or the revision.
    const revision = liveState(ask)?.stateRevision;
    dispatch(ask, selection);

    expect(ask.rejected.map((entry) => entry.reasonCode)).toEqual(['staleRevision']);
    expect(liveState(ask)?.stateRevision).toBe(revision);
    resetCollisionGrid();
    resetCombatComponentGlobals();
  });

  it('accepts the opportunity attack and consumes the reaction', () => {
    const ask = buildFixture({ first: 'enemy' });
    commitEnemyMove(ask, [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ]);
    const opened = ask.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }

    dispatch(ask, {
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: PLAYER_ID,
      choice: 'accept',
      source: 'player',
      basedOnRevision: liveState(ask)?.stateRevision ?? -1,
    });

    // The ACCEPT resolved exactly once, spent the reaction, and resolved the
    // opportunity attack through the shared attack path against the mover.
    const accept = reactionForWindow(ask, opened.windowId);
    expect(accept.event.choice).toBe('accept');
    expect(accept.event.reactorId).toBe(PLAYER_ID);
    expect(accept.event.spentReaction).toBe(true);
    expect(accept.event.abilityId).toBe(OPPORTUNITY_ATTACK_ABILITY_ID);
    expect(accept.event.targetId).toBe(ENEMY_ID);
    // Exactly one attack roll in that batch, by the reactor, against the mover.
    const rolls = accept.batch.filter((event) => event.kind === 'attackRolled');
    expect(rolls).toHaveLength(1);
    expect(rolls[0]?.attackerId).toBe(PLAYER_ID);
    expect(rolls[0]?.targetId).toBe(ENEMY_ID);
    resetCollisionGrid();
    resetCombatComponentGlobals();
  });

  // ── Review F8: the engine owns the NPC policy ───────────────────────────

  it('resolves a non-player-controlled reaction with NO mounted decision surface', () => {
    // No `COMBAT_REACTION_SELECTED` is ever dispatched in this test: the only
    // input is the player's move. Before the repair the window stayed open
    // forever because the Auto/Never policy lived entirely in the client flow.
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

    const state = liveState(fixture);
    expect(state?.phase).toBe('active');
    expect(state?.reaction.windows).toEqual([]);
    // The reactor paid its reaction — the engine decided, not the UI.
    expect(state?.combatants[ENEMY_ID]?.budget.reactionAvailable).toBe(false);
    // The mover completed the move it declared.
    expect(GridPosition.x[fixture.playerEid]).toBe(1);
    expect(GridPosition.y[fixture.playerEid]).toBe(2);
    expect(fixture.rejected).toEqual([]);
  });

  it('pins the deterministic policy the engine will apply', () => {
    // `auto` for an actor the player does not control: the engine accepts the
    // opportunity the kernel already established eligibility for.
    expect(engineReactionPolicyFor(liveState(fixture) as CombatState, ENEMY_ID)).toBe('auto');
    // `ask` for the player's own side: the decision surface owns it.
    expect(engineReactionPolicyFor(liveState(fixture) as CombatState, PLAYER_ID)).toBe('ask');
  });
});
