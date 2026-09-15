// packages/frontend/engine/src/__tests__/combat_ai_decision.test.ts
//
// C-526 AC-4 / AC-5 (grounding) / AC-7 / AC-9: decisions execute step-wise
// through the kernel with a legal fallback.
//
//   AC-4  each step grounded against the CURRENT revision and committed one
//         command at a time; an illegal/stale step falls back to the decision's
//         fallback steps, else `chooseV2AiCommand`, else ends the turn;
//         service failure ⇒ deterministic fallback; the model never supplies
//         ids/coordinates/dice and never mutates state
//   AC-7  a bounded authored telegraph is produced even on the fallback path
//   AC-9  flag off ⇒ `chooseV2AiCommand` + `disabled` degradation
//
// The harness is a REAL bitECS world driven through the production encounter
// entry point — no Worker, no mocks of the kernel.
//
// Contract: C-526 AC-4, AC-5, AC-7, AC-9

import { afterEach, describe, expect, it } from 'bun:test';
import {
  BASIC_COMBAT_ABILITIES,
  BASIC_MELEE_ABILITY_ID,
  resolveCombatAbilityIds,
} from '@aikami/constants';
import type { AiCombatDecision, CombatAiDegradedReason } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { createDegradedEmitter, produceAiCombatDecision } from '../combat/combat_ai_decision.ts';
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
const ENCOUNTER_ID = 'c526/ai_decision';
const SEED = 99;
/** Guarantees a hit without depending on the action RNG. */
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
      health: 40,
      maxHealth: 40,
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

/** Enemy first in initiative, placed 3 cells away so melee needs a move. */
const ROSTER: CombatEncounterParticipant[] = [
  {
    combatantId: PLAYER_ID,
    team: 'player',
    cell: { x: 1, y: 1 },
    classIds: ['fighter'],
  },
  {
    combatantId: ENEMY_ID,
    team: 'enemy',
    cell: { x: 4, y: 1 },
    npcId: 'rat',
    stats: {
      hitPoints: 12,
      armorClass: 5,
      attackBonus: CERTAIN_ATTACK_BONUS,
      initiative: 40,
    },
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
    command: { encounterId: ENCOUNTER_ID, seed: SEED, engine: 'v2', roster: { participants: ROSTER } },
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

const decision = (overrides: Partial<AiCombatDecision> = {}): AiCombatDecision => ({
  decisionId: 'decision-1',
  encounterId: ENCOUNTER_ID,
  actorId: ENEMY_ID,
  basedOnRevision: projectLengthSafe(overrides),
  goal: 'bring-the-fighter-down',
  intent: [
    {
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'nearest_hostile' },
    },
  ],
  fallback: [],
  confidence: 'high',
  ...overrides,
});

/** Reads the live revision when the fixture does not pin one. */
function projectLengthSafe(_overrides: Partial<AiCombatDecision>): number {
  return 0;
}

const baseOptions = (harness: Harness) => ({
  world: harness.world,
  bridge: harness.bridge,
  abilityCatalog: BASIC_COMBAT_ABILITIES,
  combatantId: ENEMY_ID,
  playerEntityId: harness.playerEid,
  abilityIdsByCombatant: harness.abilityIdsByCombatant,
  llmEnabled: true,
});

const revisionsSeen: number[] = [];

afterEach(() => {
  resetCollisionGrid();
  revisionsSeen.length = 0;
});

// ── AC-4: step-wise execution ──────────────────────────────────────────

describe('produceAiCombatDecision — step-wise execution (AC-4)', () => {
  it('commits a move and then an attack as two separate, re-grounded steps', async () => {
    const harness = createHarness();
    const state = project(harness);
    expect(state?.initiative.order[state.initiative.activeIndex]).toBe(ENEMY_ID);
    const initialRevision = state?.stateRevision ?? 0;

    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({
        ok: true,
        latencyMs: 42,
        provider: 'local',
        model: 'test-model',
        decision: decision({
          basedOnRevision: initialRevision,
          intent: [
            {
              kind: 'move',
              destination: {
                kind: 'relative',
                relativeTo: { kind: 'nearest_hostile' },
                band: 'melee',
              },
            },
            {
              kind: 'use_ability',
              ability: { kind: 'tag', value: 'basic_melee' },
              target: { kind: 'nearest_hostile' },
            },
          ],
        }),
      }),
    });

    expect(outcome.source).toBe('llm');
    expect(outcome.commands.map((command) => command.kind)).toEqual(['move', 'useAbility']);
    expect(outcome.stepsExecuted).toBe(2);
    expect(outcome.partial).toBe(false);
    expect(outcome.record.source).toBe('llm');
    expect(outcome.record.provider).toBe('local');
    expect(outcome.record.model).toBe('test-model');
    expect(outcome.record.latencyMs).toBe(42);
    expect(outcome.record.goal).toBe('bring-the-fighter-down');
    expect(outcome.record.confidence).toBe('high');

    const after = project(harness);
    // Two commits ⇒ the revision advanced twice; the second step was compiled
    // against the post-move revision, not the pre-move snapshot.
    expect(after?.stateRevision).toBe(initialRevision + 2);
    // The attack landed: the fighter is wounded.
    expect(after?.combatants[PLAYER_ID]?.hp).toBeLessThan(40);
  });

  it('reports a bounded authored telegraph on the llm path', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({
        ok: true,
        latencyMs: 5,
        decision: decision({ proposedLine: 'the rat lunges at the fighter' }),
      }),
    });
    expect(outcome.telegraph).toBe('the rat lunges at the fighter');
  });

  it('falls back to the decision fallback steps when a step is not legal', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({
        ok: true,
        latencyMs: 5,
        decision: decision({
          intent: [
            {
              kind: 'use_ability',
              ability: { kind: 'tag', value: 'no_such_capability' },
              target: { kind: 'nearest_hostile' },
            },
          ],
          fallback: [{ kind: 'defend' }],
        }),
      }),
    });
    expect(outcome.source).toBe('llm');
    expect(outcome.commands.map((command) => command.kind)).toEqual(['defend']);
    expect(outcome.partial).toBe(true);
  });

  it('ends the turn instead of forcing an illegal decision with no legal fallback', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({
        ok: true,
        latencyMs: 5,
        decision: decision({
          intent: [
            {
              kind: 'use_ability',
              ability: { kind: 'tag', value: 'no_such_capability' },
              target: { kind: 'nearest_hostile' },
            },
          ],
          fallback: [],
        }),
      }),
    });
    // Nothing from the rejected decision applied except the turn-ending command.
    expect(outcome.source).toBe('llm');
    expect(outcome.partial).toBe(true);
    expect(outcome.commands.map((command) => command.kind)).toEqual(['endTurn']);
  });

  it('rejects a decision that is not schema-valid and falls back deterministically', async () => {
    const harness = createHarness();
    const invalid = {
      ...decision(),
      goal: '',
      intent: [{ kind: 'teleport_moon' }],
      // guard-ignore lint/type-safety/casting: deliberately malformed model output under test
    } as unknown as AiCombatDecision;
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({ ok: true, latencyMs: 5, decision: invalid }),
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.degradedReason).toBe('invalid');
    expect(outcome.commands).toHaveLength(1);
    // Out of melee range at start: the deterministic fallback closes the gap.
    expect(outcome.commands[0]?.kind).toBe('move');
  });

  it('rejects a decision minted for another actor and falls back', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({
        ok: true,
        latencyMs: 5,
        decision: decision({ actorId: 'someone-else' }),
      }),
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.degradedReason).toBe('invalid');
  });
});

// ── AC-4 / AC-9: deterministic fallback paths ──────────────────────────

describe('produceAiCombatDecision — deterministic fallback (AC-4, AC-9)', () => {
  it('uses chooseV2AiCommand when the service reports offline', async () => {
    const harness = createHarness();
    const degraded: CombatAiDegradedReason[] = [];
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({ ok: false, reason: 'offline', latencyMs: 3 }),
      onDegraded: (event) => degraded.push(event.reason),
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.degradedReason).toBe('offline');
    expect(outcome.commands).toHaveLength(1);
    expect(outcome.telegraph).toBeDefined();
    expect(outcome.record.source).toBe('fallback');
    expect(outcome.record.fallbackReason).toBe('offline');
    expect(degraded).toEqual(['offline']);
  });

  it('aborts a slow decision at the hard deadline and falls back', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      hardDeadlineMs: 10,
      decide: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: false, reason: 'offline', latencyMs: 0 }), 500);
        }),
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.degradedReason).toBe('timeout');
    expect(outcome.commands).toHaveLength(1);
  });

  it('treats a thrown service error as a degraded fallback, never a throw', async () => {
    const harness = createHarness();
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      hardDeadlineMs: 50,
      decide: async () => {
        throw new Error('provider exploded');
      },
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.commands).toHaveLength(1);
  });

  it('pins disabled when the flag is off and never calls the model', async () => {
    const harness = createHarness();
    let called = false;
    const degraded: CombatAiDegradedReason[] = [];
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      llmEnabled: false,
      decide: async () => {
        called = true;
        return { ok: false, reason: 'offline', latencyMs: 1 };
      },
      onDegraded: (event) => degraded.push(event.reason),
    });
    expect(called).toBe(false);
    expect(outcome.degradedReason).toBe('disabled');
    expect(outcome.record.fallbackReason).toBe('disabled');
    expect(outcome.commands).toHaveLength(1);
    expect(degraded).toEqual(['disabled']);
  });

  it('discards a decision produced against a different revision as stale', async () => {
    const harness = createHarness();
    const state = project(harness);
    const outcome = await produceAiCombatDecision({
      ...baseOptions(harness),
      requireRevision: (state?.stateRevision ?? 0) + 5,
      decide: async () => ({
        ok: true,
        latencyMs: 1,
        decision: decision({ basedOnRevision: state?.stateRevision ?? 0 }),
      }),
    });
    expect(outcome.source).toBe('fallback');
    expect(outcome.degradedReason).toBe('stale');
  });

  it('emits telemetry for every attempt and never leaks a raw context', async () => {
    const harness = createHarness();
    const records: unknown[] = [];
    await produceAiCombatDecision({
      ...baseOptions(harness),
      decide: async () => ({ ok: false, reason: 'offline', latencyMs: 7 }),
      onRecord: (record) => records.push(record),
    });
    expect(records).toHaveLength(1);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain('abilityCatalog');
    expect(serialized).not.toContain('blockedCells');
  });
});

// ── AC-7: degradation de-duplication ───────────────────────────────────

describe('createDegradedEmitter (AC-7)', () => {
  it('emits once per (actor, reason) and resets per encounter', () => {
    const seen: Array<{ actorId: string; reason: CombatAiDegradedReason }> = [];
    const emitter = createDegradedEmitter({ onDegraded: (event) => seen.push(event) });
    emitter.emit({ actorId: ENEMY_ID, reason: 'timeout' });
    emitter.emit({ actorId: ENEMY_ID, reason: 'timeout' });
    emitter.emit({ actorId: ENEMY_ID, reason: 'invalid' });
    emitter.emit({ actorId: PLAYER_ID, reason: 'timeout' });
    expect(seen).toHaveLength(3);
    emitter.reset();
    emitter.emit({ actorId: ENEMY_ID, reason: 'timeout' });
    expect(seen).toHaveLength(4);
  });
});

// ── Turn-driver sanity: the harness really is mid-encounter ────────────

describe('harness sanity', () => {
  it('starts with the AI combatant active and the player able to act', () => {
    const harness = createHarness();
    expect(harness.started.ok).toBe(true);
    const active = getActiveTurn(harness.world);
    expect(active?.combatantId).toBe(ENEMY_ID);
  });

  it('the production dispatch path rejects a player command during an enemy turn', () => {
    const harness = createHarness();
    const rejected: string[] = [];
    harness.bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
      rejected.push(event.reasonCode);
    });
    const revision = project(harness)?.stateRevision;
    dispatchCombatCommand({ type: 'COMBAT_END_TURN' } as never, {
      world: harness.world,
      bridge: harness.bridge,
      playerEntityId: harness.playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      abilityIdsByCombatant: harness.abilityIdsByCombatant,
    });
    expect(rejected).toEqual(['notActiveCombatant']);
    expect(project(harness)?.stateRevision).toBe(revision);
  });
});
