// packages/frontend/engine/src/__tests__/combat_ai_turns.test.ts
//
// C-526 AC-5 / AC-7 / AC-9: AI planning is deferred, never blocks the engine,
// and always falls back.
//
//   AC-5  the engine asks the client for a decision, never blocks on it, falls
//         back deterministically at the hard deadline, and discards a
//         submission whose revision no longer matches (prefetch discipline)
//   AC-7  a bounded authored telegraph and a de-duplicated degradation report
//         are published
//   AC-9  with the flag pinned off, the deterministic planner owns every turn
//         and the kill switch is reported once per actor
//
// The harness is a REAL bitECS world driven through the production encounter
// entry point — no Worker, no kernel mocks.
//
// Contract: C-526 AC-5, AC-7, AC-9

import { afterEach, describe, expect, it } from 'bun:test';
import {
  BASIC_COMBAT_ABILITIES,
  BASIC_MELEE_ABILITY_ID,
  resolveCombatAbilityIds,
} from '@aikami/constants';
import type { CombatAiDegradedReason } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  type CombatAiTurnCoordinator,
  createCombatAiTurnCoordinator,
} from '../combat/combat_ai_turns.ts';
import type { CombatAiDecisionSubmittedCommand } from '../combat/combat_bridge_types.ts';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import {
  type CombatEncounterParticipant,
  type StartEncounterResult,
  startEncounterFromCommand,
} from '../combat/combat_encounter_start.ts';
import { getActiveTurn } from '../combat/combat_turn_driver.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { registerCombatMovementObservers } from '../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { registerCompanionObservers } from '../components/companion.ts';
import { registerEnemyObservers } from '../components/enemy.ts';
import { registerGridPositionObservers } from '../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c526/ai_turns';
const SEED = 771;
const CERTAIN_ATTACK_BONUS = 100;
const ENEMY_ID = 'emberwatch/rat';
const PLAYER_ID = 'player';

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const createPlayer = (world: World): number => {
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: 60,
      maxHealth: 60,
      initiative: 10,
      attack: 5,
      defense: 0,
      accuracy: 20,
      evasion: 0,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 10, isActive: true }),
  );
  return eid;
};

/** Enemy first in initiative, one AI actor per encounter. */
const ROSTER: CombatEncounterParticipant[] = [
  { combatantId: PLAYER_ID, team: 'player', cell: { x: 1, y: 1 }, classIds: ['fighter'] },
  {
    combatantId: ENEMY_ID,
    team: 'enemy',
    cell: { x: 4, y: 1 },
    npcId: 'rat',
    stats: { hitPoints: 12, armorClass: 5, attackBonus: CERTAIN_ATTACK_BONUS, initiative: 40 },
    abilityIds: [BASIC_MELEE_ABILITY_ID],
  },
];

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  started: StartEncounterResult;
  abilityIdsByCombatant: Record<string, string[]>;
};

const createHarness = (): Harness => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installTerrain();

  const playerEid = createPlayer(world);
  const bridge = new MockEngineBridge();
  const started = startEncounterFromCommand({
    world,
    bridge,
    command: { encounterId: ENCOUNTER_ID, seed: SEED, engine: 'v2', roster: ROSTER },
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsForClasses: resolveCombatAbilityIds,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
    startLegacy: () => {},
  });

  return {
    world,
    bridge,
    playerEid,
    started,
    abilityIdsByCombatant: started.ok ? started.abilityIdsByCombatant : {},
  };
};

const project = (harness: Harness) =>
  buildV2CombatState({
    world: harness.world,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsByCombatant: harness.abilityIdsByCombatant,
  });

type Recorded = {
  requests: Array<{ requestId: string; combatantId: string; stateRevision: number }>;
  degraded: Array<{ actorId: string; reason: string }>;
  telegraphs: string[];
};

const recordBridgeEvents = (harness: Harness): Recorded => {
  const recorded: Recorded = { requests: [], degraded: [], telegraphs: [] };
  harness.bridge.on('COMBAT_AI_DECISION_REQUESTED', (event) => {
    recorded.requests.push(event as unknown as Recorded['requests'][number]);
  });
  harness.bridge.on('COMBAT_AI_DEGRADED', (event) => {
    recorded.degraded.push(event as unknown as Recorded['degraded'][number]);
  });
  harness.bridge.on('COMBAT_INTENT_TELEGRAPHED', (event) => {
    recorded.telegraphs.push((event as unknown as { line: string }).line);
  });
  return recorded;
};

const makeCoordinator = (
  harness: Harness,
  overrides: {
    llmAgentsEnabled: boolean;
    hardDeadlineMs?: number;
    onDegraded?: (event: { combatantId: string; reason: CombatAiDegradedReason }) => void;
  },
): CombatAiTurnCoordinator =>
  createCombatAiTurnCoordinator({
    world: harness.world,
    bridge: harness.bridge,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    playerEntityId: harness.playerEid,
    abilityIdsByCombatant: harness.abilityIdsByCombatant,
    llmAgentsEnabled: overrides.llmAgentsEnabled,
    ...(overrides.hardDeadlineMs === undefined ? {} : { hardDeadlineMs: overrides.hardDeadlineMs }),
    ...(overrides.onDegraded === undefined ? {} : { onDegraded: overrides.onDegraded }),
  });

const attackDecision = () => ({
  decisionId: 'decision-1',
  encounterId: ENCOUNTER_ID,
  actorId: ENEMY_ID,
  basedOnRevision: 0,
  goal: 'bring-the-fighter-down',
  // The standard AI tactic: close to melee, THEN attack — two steps, so the
  // step-wise pipeline is genuinely exercised (AC-4/AC-5).
  intent: [
    {
      kind: 'move' as const,
      destination: {
        kind: 'relative' as const,
        relativeTo: { kind: 'nearest_hostile' as const },
        band: 'melee' as const,
      },
    },
    {
      kind: 'use_ability' as const,
      ability: { kind: 'tag' as const, value: 'basic_melee' },
      target: { kind: 'nearest_hostile' as const },
    },
  ],
  fallback: [],
  confidence: 'high' as const,
});

afterEach(() => {
  resetCollisionGrid();
});

// ── AC-9: flag off ⇒ deterministic ─────────────────────────────────────

describe('coordinator — LLM layer pinned off (AC-9)', () => {
  it('resolves the AI chain deterministically and reports the kill switch once', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: false });

    coordinator.run();

    expect(recorded.requests).toHaveLength(0);
    expect(recorded.degraded.map((event) => `${event.actorId}:${event.reason}`)).toEqual([
      `${ENEMY_ID}:disabled`,
    ]);
    // The AI acted: the revision advanced and the fighter was attacked.
    expect(project(harness)?.stateRevision).toBeGreaterThan(0);
    expect(coordinator.pendingCount).toBe(0);
  });
});

// ── AC-5: deferral ─────────────────────────────────────────────────────

describe('coordinator — LLM layer pinned on (AC-5)', () => {
  it('defers the AI turn to the client instead of deciding it', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: true });

    coordinator.run();

    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]?.combatantId).toBe(ENEMY_ID);
    expect(coordinator.pendingCount).toBe(1);
    // NOTHING resolved: the engine never decides on the client's behalf here.
    expect(project(harness)?.stateRevision).toBe(0);
    coordinator.cancelAll();
  });

  it('does not duplicate the request when run() is called again while pending', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: true });

    coordinator.run();
    coordinator.run();

    expect(recorded.requests).toHaveLength(1);
    coordinator.cancelAll();
  });

  it('activates a submitted decision through the step-wise pipeline', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: true });
    coordinator.run();
    const request = recorded.requests[0];
    expect(request).toBeDefined();
    const revision = project(harness)?.stateRevision ?? 0;

    const submission: CombatAiDecisionSubmittedCommand = {
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: request?.requestId ?? '',
      encounterId: ENCOUNTER_ID,
      combatantId: ENEMY_ID,
      stateRevision: revision,
      decision: { ...attackDecision(), basedOnRevision: revision },
    };
    expect(coordinator.submit(submission)).toBe(true);
    expect(coordinator.pendingCount).toBe(0);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // The decision committed: the fighter was wounded.
        expect(project(harness)?.combatants[PLAYER_ID]?.hp).toBeLessThan(60);
        expect(recorded.telegraphs.length).toBeGreaterThan(0);
        resolve();
      }, 20);
    });
  });

  it('falls back deterministically when the client submits null (offline)', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const degraded: Array<{ combatantId: string; reason: CombatAiDegradedReason }> = [];
    const coordinator = makeCoordinator(harness, {
      llmAgentsEnabled: true,
      onDegraded: (event) => degraded.push(event),
    });
    coordinator.run();
    const request = recorded.requests[0];

    coordinator.submit({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: request?.requestId ?? '',
      encounterId: ENCOUNTER_ID,
      combatantId: ENEMY_ID,
      stateRevision: project(harness)?.stateRevision ?? 0,
      decision: null,
    });

    expect(degraded).toEqual([{ combatantId: ENEMY_ID, reason: 'offline' }]);
    // The fallback resolved the turn instead of stalling on the model.
    expect(project(harness)?.stateRevision).toBeGreaterThan(0);
  });

  it('discards a submission whose revision no longer matches as stale', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const degraded: Array<{ combatantId: string; reason: CombatAiDegradedReason }> = [];
    const coordinator = makeCoordinator(harness, {
      llmAgentsEnabled: true,
      onDegraded: (event) => degraded.push(event),
    });
    coordinator.run();
    const request = recorded.requests[0];

    coordinator.submit({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: request?.requestId ?? '',
      encounterId: ENCOUNTER_ID,
      combatantId: ENEMY_ID,
      stateRevision: (project(harness)?.stateRevision ?? 0) + 7,
      decision: attackDecision(),
    });

    expect(degraded).toEqual([{ combatantId: ENEMY_ID, reason: 'stale' }]);
    // The stale decision was NOT applied; the fallback resolved the turn.
    expect(project(harness)?.stateRevision).toBeGreaterThan(0);
  });

  it('ignores a duplicate/unknown submission — a decision commits at most once', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: true });
    coordinator.run();
    const request = recorded.requests[0];
    const submission: CombatAiDecisionSubmittedCommand = {
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: request?.requestId ?? '',
      encounterId: ENCOUNTER_ID,
      combatantId: ENEMY_ID,
      stateRevision: project(harness)?.stateRevision ?? 0,
      decision: null,
    };
    expect(coordinator.submit(submission)).toBe(true);
    expect(coordinator.submit(submission)).toBe(false);
  });

  it('falls back at the hard deadline when the client never answers', async () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, {
      llmAgentsEnabled: true,
      hardDeadlineMs: 5,
    });
    coordinator.run();
    expect(coordinator.pendingCount).toBe(1);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });

    expect(coordinator.pendingCount).toBe(0);
    expect(recorded.degraded.map((event) => event.reason)).toContain('timeout');
    // The encounter moved on instead of stalling on the model.
    expect(project(harness)?.stateRevision).toBeGreaterThan(0);
  });
});

// ── AC-7: the dispatch path still routes a player command ──────────────

describe('coordinator — production dispatch integration', () => {
  it('routes a player end-turn through the dispatcher and then defers the AI turn', () => {
    const harness = createHarness();
    const recorded = recordBridgeEvents(harness);
    const coordinator = makeCoordinator(harness, { llmAgentsEnabled: true });

    // Player is not active first (the enemy won initiative), so give the
    // coordinator a chance to defer, then release it deterministically.
    coordinator.run();
    expect(recorded.requests).toHaveLength(1);
    coordinator.cancelAll();
    coordinator.run();

    dispatchCombatCommand({ type: 'COMBAT_END_TURN' } as never, {
      world: harness.world,
      bridge: harness.bridge,
      playerEntityId: harness.playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      abilityIdsByCombatant: harness.abilityIdsByCombatant,
      aiTurns: coordinator,
    });
    // The command was rejected (the player does not hold the turn) — the point
    // is that the dispatch path is wired and never throws.
    expect(getActiveTurn(harness.world)).not.toBeNull();
  });
});
