// packages/frontend/engine/src/__tests__/combat_state_adapter.test.ts
//
// AC-3 + AC-6: stable combatant ids distinct from bitECS entity ids, and an
// ECS adapter that projects rather than becoming a second authority.
//
// Contract: C-509 AC-3, AC-6

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CombatAbilityDefinition, CombatState, ResolveCombatResult } from '@aikami/types';
import { resolveCombatCommand as resolveCombat } from '@aikami/utils';
import { addComponent, addEntity, createWorld, removeEntity, type World } from 'bitecs';
import {
  applyCombatResult,
  COMBAT_STATS_FIELD_MAP,
  createCombatIdentityRegistry,
  deriveCombatantId,
  getCombatIdentityRegistry,
  registerCombatantIdentity,
  resetCombatApplyGuard,
  snapshotCombatState,
  UNMAPPED_COMBAT_STATS_FIELDS,
} from '../combat/combat_state_adapter.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import { GridPosition } from '../components/grid_position.ts';
import { TurnOrder } from '../components/turn_order.ts';

// ── Fixtures ───────────────────────────────────────────────────────────

const ENCOUNTER_ID = 'emberwatch-encounter-1';
const RULES_VERSION = 'combat-2.0.0';
const PLAYER_ID = 'campaign:hero-1';
const GOBLIN_ID = 'emberwatch:goblin-1';
const COMPANION_ID = 'npc-mara';

const CATALOG: Record<string, CombatAbilityDefinition> = {
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
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
};

const BATTLEFIELD = { width: 8, height: 8, blockedCells: [] };

type Harness = {
  world: World;
  playerEid: number;
  goblinEid: number;
  companionEid: number;
};

/** Clears every SoA slot an entity touches — eids recycle across worlds. */
const resetEntitySlots = (eid: number): void => {
  CombatIdentity.combatantId[eid] = '';
  CombatStats.health[eid] = 0;
  CombatStats.maxHealth[eid] = 0;
  CombatStats.evasion[eid] = 0;
  CombatStats.accuracy[eid] = 0;
  CombatStats.initiative[eid] = 0;
  CombatStats.defense[eid] = 0;
  CombatStats.attack[eid] = 0;
  GridPosition.x[eid] = 0;
  GridPosition.y[eid] = 0;
  TurnOrder.currentTurn[eid] = false;
  TurnOrder.isActive[eid] = false;
  Enemy.isActive[eid] = false;
  Enemy.spawnId[eid] = '';
  Enemy.encounterId[eid] = '';
  Companion.npcId[eid] = '';
};

const spawnCombatant = (
  world: World,
  fields: {
    combatantId?: string;
    hp: number;
    maxHp: number;
    evasion: number;
    accuracy: number;
    initiative: number;
    x: number;
    y: number;
    isEnemy?: boolean;
    spawnId?: string;
    npcId?: string;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, CombatIdentity);
  addComponent(world, eid, CombatStats);
  addComponent(world, eid, GridPosition);
  addComponent(world, eid, TurnOrder);
  resetEntitySlots(eid);
  if (fields.combatantId !== undefined) {
    CombatIdentity.combatantId[eid] = fields.combatantId;
  }
  CombatStats.health[eid] = fields.hp;
  CombatStats.maxHealth[eid] = fields.maxHp;
  CombatStats.evasion[eid] = fields.evasion;
  CombatStats.accuracy[eid] = fields.accuracy;
  CombatStats.initiative[eid] = fields.initiative;
  CombatStats.defense[eid] = 99;
  CombatStats.attack[eid] = 7;
  GridPosition.x[eid] = fields.x;
  GridPosition.y[eid] = fields.y;
  TurnOrder.currentTurn[eid] = false;
  TurnOrder.isActive[eid] = true;
  if (fields.isEnemy === true) {
    Enemy.isActive[eid] = true;
  }
  if (fields.spawnId !== undefined) {
    Enemy.spawnId[eid] = fields.spawnId;
  }
  if (fields.npcId !== undefined) {
    Companion.npcId[eid] = fields.npcId;
  }
  return eid;
};

const createHarness = (): Harness => {
  const world = createWorld();
  registerCombatIdentityObservers(world);
  const playerEid = spawnCombatant(world, {
    combatantId: PLAYER_ID,
    hp: 20,
    maxHp: 20,
    evasion: 12,
    accuracy: 5,
    initiative: 14,
    x: 0,
    y: 0,
  });
  const goblinEid = spawnCombatant(world, {
    combatantId: GOBLIN_ID,
    hp: 12,
    maxHp: 12,
    evasion: 13,
    accuracy: 3,
    initiative: 11,
    x: 1,
    y: 0,
    isEnemy: true,
    spawnId: GOBLIN_ID,
  });
  const companionEid = spawnCombatant(world, {
    combatantId: COMPANION_ID,
    hp: 14,
    maxHp: 14,
    evasion: 11,
    accuracy: 4,
    initiative: 9,
    x: 0,
    y: 1,
    npcId: COMPANION_ID,
  });
  return { world, playerEid, goblinEid, companionEid };
};

const snapshot = (harness: Harness, seed = 1337, overrides: Record<string, unknown> = {}) =>
  snapshotCombatState(harness.world, {
    encounterId: ENCOUNTER_ID,
    rulesVersion: RULES_VERSION,
    seed,
    abilityCatalog: CATALOG,
    battlefield: BATTLEFIELD,
    playerCombatantId: PLAYER_ID,
    playerEntityId: harness.playerEid,
    abilityIdsByCombatant: {
      [PLAYER_ID]: ['basic_melee'],
      [GOBLIN_ID]: ['basic_melee'],
      [COMPANION_ID]: ['basic_melee'],
    },
    ...overrides,
  });

const attackCommand = (targetId: string) => ({
  kind: 'useAbility' as const,
  combatantId: PLAYER_ID,
  abilityId: 'basic_melee',
  targetIds: [targetId],
});

/** Finds a seed whose first player attack lands, and returns state + result. */
const firstHittingSeed = (
  harness: Harness,
): { state: CombatState; result: ResolveCombatResult; seed: number } => {
  for (let seed = 1; seed <= 400; seed++) {
    const state = snapshot(harness, seed);
    const result = resolveCombat({ state, command: attackCommand(GOBLIN_ID) });
    if (result.valid && result.events.some((event) => event.kind === 'damageApplied')) {
      return { state, result, seed };
    }
  }
  throw new Error('no hitting seed found');
};

const collectKeys = (value: unknown, acc: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, acc);
    }
    return acc;
  }
  if (value === null || typeof value !== 'object') {
    return acc;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    acc.add(key);
    collectKeys(entry, acc);
  }
  return acc;
};

// ── AC-3: combatant id derivation ──────────────────────────────────────

describe('deriveCombatantId (C-509 AC-3)', () => {
  it('prefers Enemy.spawnId for encounter spawns', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    Enemy.spawnId[eid] = GOBLIN_ID;
    Enemy.encounterId[eid] = 'emberwatch-encounter-1:wave-2';
    expect(
      deriveCombatantId({
        entityId: eid,
        encounterId: ENCOUNTER_ID,
        playerCombatantId: PLAYER_ID,
        spawnIndex: 3,
      }),
    ).toBe(GOBLIN_ID);
  });

  it('falls back to Enemy.encounterId when spawnId is absent', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    Enemy.encounterId[eid] = 'emberwatch-encounter-1:wave-2';
    expect(
      deriveCombatantId({
        entityId: eid,
        encounterId: ENCOUNTER_ID,
        playerCombatantId: PLAYER_ID,
        spawnIndex: 3,
      }),
    ).toBe('emberwatch-encounter-1:wave-2');
  });

  it('uses Companion.npcId for companions', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    Companion.npcId[eid] = COMPANION_ID;
    expect(
      deriveCombatantId({
        entityId: eid,
        encounterId: ENCOUNTER_ID,
        playerCombatantId: PLAYER_ID,
        spawnIndex: 1,
      }),
    ).toBe(COMPANION_ID);
  });

  it('uses the caller-supplied campaign character id for the player', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    expect(
      deriveCombatantId({
        entityId: eid,
        encounterId: ENCOUNTER_ID,
        playerCombatantId: PLAYER_ID,
        playerEntityId: eid,
        spawnIndex: 0,
      }),
    ).toBe(PLAYER_ID);
  });

  it('mints a deterministic <encounterId>:<spawnIndex> only when no authored id exists', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    expect(
      deriveCombatantId({
        entityId: eid,
        encounterId: ENCOUNTER_ID,
        playerCombatantId: PLAYER_ID,
        spawnIndex: 4,
      }),
    ).toBe(`${ENCOUNTER_ID}:4`);
  });

  it('never derives an id from the runtime entity id', () => {
    const world = createWorld();
    const eid = addEntity(world);
    resetEntitySlots(eid);
    const derived = deriveCombatantId({
      entityId: eid,
      encounterId: ENCOUNTER_ID,
      playerCombatantId: PLAYER_ID,
      spawnIndex: 4,
    });
    expect(derived).not.toBe(String(eid));
    expect(derived).not.toContain(`:${eid}`);
  });

  it('writes the derived id onto the CombatIdentity component', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    const eid = addEntity(world);
    resetEntitySlots(eid);
    Enemy.spawnId[eid] = GOBLIN_ID;
    const id = registerCombatantIdentity({
      entityId: eid,
      encounterId: ENCOUNTER_ID,
      playerCombatantId: PLAYER_ID,
      spawnIndex: 0,
    });
    expect(id).toBe(GOBLIN_ID);
    expect(CombatIdentity.combatantId[eid]).toBe(GOBLIN_ID);
  });
});

// ── AC-3: registry integrity across despawn / eid recycling ────────────

describe('combatantId ↔ eid registry (C-509 AC-3)', () => {
  it('maps both directions after a sync', () => {
    const { world, goblinEid } = createHarness();
    const registry = createCombatIdentityRegistry();
    registry.sync(world);
    expect(registry.toEntityId(GOBLIN_ID)).toBe(goblinEid);
    expect(registry.toCombatantId(goblinEid)).toBe(GOBLIN_ID);
  });

  it('resolves a recycled eid to the new combatant and retires the stale id', () => {
    const { world, goblinEid } = createHarness();
    const registry = createCombatIdentityRegistry();
    registry.sync(world);
    expect(registry.toCombatantId(goblinEid)).toBe(GOBLIN_ID);

    // Despawn and let bitECS recycle the eid for a different combatant.
    removeEntity(world, goblinEid);
    const recycledEid = addEntity(world);
    addComponent(world, recycledEid, CombatIdentity);
    resetEntitySlots(recycledEid);
    CombatIdentity.combatantId[recycledEid] = 'emberwatch:goblin-2';

    registry.sync(world);
    expect(registry.toCombatantId(recycledEid)).toBe('emberwatch:goblin-2');
    expect(registry.toEntityId(GOBLIN_ID)).toBeNull();
    expect(registry.retiredCombatantIds()).toContain(GOBLIN_ID);
    expect(registry.toCombatantId(recycledEid)).not.toBe(GOBLIN_ID);
  });

  it('retires a combatant id when its entity is despawned', () => {
    const { world, companionEid } = createHarness();
    const registry = createCombatIdentityRegistry();
    registry.sync(world);
    removeEntity(world, companionEid);
    registry.sync(world);
    expect(registry.toEntityId(COMPANION_ID)).toBeNull();
    expect(registry.retiredCombatantIds()).toContain(COMPANION_ID);
  });

  it('is idempotent when nothing changed', () => {
    const { world } = createHarness();
    const registry = createCombatIdentityRegistry();
    registry.sync(world);
    const first = registry.entries();
    registry.sync(world);
    expect(registry.entries()).toEqual(first);
    expect(registry.retiredCombatantIds()).toEqual([]);
  });

  it('drops every mapping on clear', () => {
    const { world } = createHarness();
    const registry = createCombatIdentityRegistry();
    registry.sync(world);
    registry.clear();
    expect(registry.entries()).toEqual([]);
    expect(registry.retiredCombatantIds()).toEqual([]);
  });

  it('scopes registries per world', () => {
    const a = createHarness();
    const b = createHarness();
    expect(getCombatIdentityRegistry(a.world)).not.toBe(getCombatIdentityRegistry(b.world));
  });
});

// ── AC-3: no raw eids in the snapshot ──────────────────────────────────

describe('snapshotCombatState identity surface (C-509 AC-3)', () => {
  it('uses authored combatant ids and never exposes an eid field', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    expect(Object.keys(state.combatants).sort()).toEqual(
      [COMPANION_ID, GOBLIN_ID, PLAYER_ID].sort(),
    );
    expect(state.combatants[GOBLIN_ID].combatantId).toBe(GOBLIN_ID);

    const keys = collectKeys(JSON.parse(JSON.stringify(state)));
    for (const forbidden of ['eid', 'entityId', 'entity_id', 'entityID']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('serializes and deserializes without losing identity integrity', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    const roundTripped = JSON.parse(JSON.stringify(state)) as CombatState;
    expect(roundTripped.combatants[GOBLIN_ID].combatantId).toBe(GOBLIN_ID);
    expect(roundTripped.initiative.order).toContain(GOBLIN_ID);
    const registry = getCombatIdentityRegistry(harness.world);
    registry.sync(harness.world);
    expect(registry.toEntityId(GOBLIN_ID)).toBe(harness.goblinEid);
  });

  it('survives a despawn/recycle between two snapshots', () => {
    const harness = createHarness();
    const first = snapshot(harness);
    expect(first.combatants[GOBLIN_ID]).toBeDefined();

    removeEntity(harness.world, harness.goblinEid);
    const recycledEid = addEntity(harness.world);
    addComponent(harness.world, recycledEid, CombatIdentity);
    addComponent(harness.world, recycledEid, CombatStats);
    addComponent(harness.world, recycledEid, GridPosition);
    resetEntitySlots(recycledEid);
    CombatIdentity.combatantId[recycledEid] = 'emberwatch:goblin-2';
    CombatStats.health[recycledEid] = 9;
    CombatStats.maxHealth[recycledEid] = 9;
    CombatStats.evasion[recycledEid] = 12;
    CombatStats.accuracy[recycledEid] = 3;
    CombatStats.initiative[recycledEid] = 8;
    GridPosition.x[recycledEid] = 2;
    GridPosition.y[recycledEid] = 2;

    const second = snapshot(harness);
    expect(second.combatants[GOBLIN_ID]).toBeUndefined();
    expect(second.combatants['emberwatch:goblin-2']).toBeDefined();
    expect(second.combatants['emberwatch:goblin-2'].hp).toBe(9);
    const registry = getCombatIdentityRegistry(harness.world);
    expect(registry.toCombatantId(recycledEid)).toBe('emberwatch:goblin-2');
    expect(registry.toEntityId(GOBLIN_ID)).toBeNull();
  });
});

// ── AC-6: explicit field mapping ───────────────────────────────────────

describe('ECS field mapping (C-509 AC-6)', () => {
  it('documents the CombatStats → CombatantState mapping', () => {
    expect(COMBAT_STATS_FIELD_MAP).toEqual({
      health: 'hp',
      maxHealth: 'maxHp',
      evasion: 'armorClass',
      accuracy: 'attackBonus',
      initiative: 'initiative',
    });
  });

  it('records defense (and the other unmapped fields) rather than inventing semantics', () => {
    expect(UNMAPPED_COMBAT_STATS_FIELDS).toContain('defense');
    expect(Object.keys(COMBAT_STATS_FIELD_MAP)).not.toContain('defense');
    expect(Object.keys(COMBAT_STATS_FIELD_MAP)).not.toContain('attack');
  });

  it('projects CombatStats onto the snapshot exactly per the mapping', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    const goblin = state.combatants[GOBLIN_ID];
    expect(goblin.hp).toBe(12);
    expect(goblin.maxHp).toBe(12);
    expect(goblin.armorClass).toBe(13);
    expect(goblin.attackBonus).toBe(3);
    expect(goblin.initiative).toBe(11);
    // CombatStats.defense (99) and .attack (7) are deliberately NOT mapped.
    expect(goblin.armorClass).not.toBe(99);
    expect(goblin.attackBonus).not.toBe(7);
    expect(goblin.position).toEqual({ x: 1, y: 0 });
  });

  it('assigns teams from the ECS tags', () => {
    const state = snapshot(createHarness());
    expect(state.combatants[PLAYER_ID].team).toBe('player');
    expect(state.combatants[GOBLIN_ID].team).toBe('enemy');
    expect(state.combatants[COMPANION_ID].team).toBe('ally');
  });

  it('marks a 0-HP entity as downed and defeated', () => {
    const harness = createHarness();
    CombatStats.health[harness.goblinEid] = 0;
    const state = snapshot(harness);
    expect(state.combatants[GOBLIN_ID].downed).toBe(true);
    expect(state.combatants[GOBLIN_ID].defeated).toBe(true);
  });

  it('derives a deterministic initiative order from CombatStats.initiative', () => {
    const state = snapshot(createHarness());
    expect(state.initiative.order).toEqual([PLAYER_ID, GOBLIN_ID, COMPANION_ID]);
  });
});

// ── AC-6: apply ────────────────────────────────────────────────────────

describe('applyCombatResult (C-509 AC-6)', () => {
  it('writes the kernel HP result onto CombatStats', () => {
    const harness = createHarness();
    const { state, result } = firstHittingSeed(harness);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const damage = result.events.find((event) => event.kind === 'damageApplied');
    expect(damage).toBeDefined();

    applyCombatResult(harness.world, state, result);
    expect(CombatStats.health[harness.goblinEid]).toBe(result.state.combatants[GOBLIN_ID].hp);
    expect(CombatStats.health[harness.goblinEid]).toBeLessThan(12);
  });

  it('writes kernel positions onto GridPosition', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    const result = resolveCombat({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [{ x: 0, y: 1 }] },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    applyCombatResult(harness.world, state, result);
    expect(GridPosition.x[harness.playerEid]).toBe(0);
    expect(GridPosition.y[harness.playerEid]).toBe(1);
  });

  it('no-ops when result.valid === false', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    const before = CombatStats.health[harness.goblinEid];
    applyCombatResult(harness.world, state, {
      valid: false,
      reasonCode: 'notActiveCombatant',
      messageKey: 'combat.invalid.not_active_combatant',
    });
    expect(CombatStats.health[harness.goblinEid]).toBe(before);
    expect(GridPosition.y[harness.playerEid]).toBe(0);
  });

  it('does not double-apply the same result', () => {
    const harness = createHarness();
    const { state, result } = firstHittingSeed(harness);
    applyCombatResult(harness.world, state, result);
    const afterFirst = CombatStats.health[harness.goblinEid];
    applyCombatResult(harness.world, state, result);
    expect(CombatStats.health[harness.goblinEid]).toBe(afterFirst);
    applyCombatResult(harness.world, state, result);
    expect(CombatStats.health[harness.goblinEid]).toBe(afterFirst);
  });

  it('rejects a result that does not advance the revision by exactly one', () => {
    const harness = createHarness();
    const { state, result } = firstHittingSeed(harness);
    const stale: CombatState = { ...state, stateRevision: 9 };
    applyCombatResult(harness.world, stale, result);
    expect(CombatStats.health[harness.goblinEid]).toBe(12);
  });

  it('keeps applying successive revisions', () => {
    const harness = createHarness();
    const state = snapshot(harness);
    const move = resolveCombat({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [{ x: 0, y: 1 }] },
    });
    expect(move.valid).toBe(true);
    if (!move.valid) {
      return;
    }
    applyCombatResult(harness.world, state, move);
    const endTurn = resolveCombat({
      state: move.state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(endTurn.valid).toBe(true);
    if (!endTurn.valid) {
      return;
    }
    applyCombatResult(harness.world, move.state, endTurn);
    expect(TurnOrder.currentTurn[harness.goblinEid]).toBe(true);
    expect(TurnOrder.currentTurn[harness.playerEid]).toBe(false);
  });

  it('exposes a reset for the apply guard', () => {
    const harness = createHarness();
    const { state, result } = firstHittingSeed(harness);
    applyCombatResult(harness.world, state, result);
    resetCombatApplyGuard(harness.world);
    CombatStats.health[harness.goblinEid] = 12;
    applyCombatResult(harness.world, state, result);
    expect(CombatStats.health[harness.goblinEid]).toBeLessThan(12);
  });
});

// ── AC-6: the adapter is a projection, not an authority ────────────────

describe('adapter authority boundary (C-509 AC-6)', () => {
  const adapterSource = readFileSync(
    fileURLToPath(new URL('../combat/combat_state_adapter.ts', import.meta.url)),
    'utf8',
  );
  const serializerSource = readFileSync(
    fileURLToPath(new URL('../serialization/ecs_serializer.ts', import.meta.url)),
    'utf8',
  );

  it('delegates to the kernel instead of recalculating rules', () => {
    expect(adapterSource).toContain("from '@aikami/utils'");
    expect(adapterSource).toContain('createCombatState');
    expect(adapterSource).not.toContain('Math.random');
    expect(adapterSource).not.toContain('createSeedableRng');
    expect(adapterSource).not.toContain('resolveCommand');
    expect(adapterSource).not.toContain('.dice(');
  });

  it('does not touch the legacy turn manager', () => {
    const turnManagerSource = readFileSync(
      fileURLToPath(new URL('../systems/turn_manager_system.ts', import.meta.url)),
      'utf8',
    );
    expect(turnManagerSource).not.toContain('combat_kernel');
    expect(turnManagerSource).not.toContain('combat_state_adapter');
    expect(turnManagerSource).not.toContain('CombatIdentity');
  });

  it('keeps CombatIdentity out of the persisted ECS snapshot', () => {
    expect(serializerSource).not.toContain('CombatIdentity');
  });
});
