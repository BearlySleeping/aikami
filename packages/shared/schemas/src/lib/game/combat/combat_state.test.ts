// packages/shared/schemas/src/lib/game/combat/combat_state.test.ts
//
// AC-1: versioned combat schemas are defined and validated.
// Contract: C-509 AC-1

import { describe, expect, it } from 'bun:test';
import Type from 'typebox';
import { Value } from 'typebox/value';
import { CombatCommandSchema } from './combat_command';
import { CombatEventSchema } from './combat_event';
import { CombatReplaySchema } from './combat_replay';
import {
  BattlefieldStateSchema,
  COMBAT_SCHEMA_VERSION,
  CombatantStateSchema,
  CombatStateSchema,
  GridPointSchema,
  SerializedRngSchema,
  TurnBudgetSchema,
} from './combat_state';
import { CombatValidationResultSchema, ResolveCombatResultSchema } from './combat_validation';

// ── Fixtures ───────────────────────────────────────────────────────────

const rngStream = { seed: 42, state: 42 };

const validCombatant = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  combatantId: 'emberwatch:goblin-1',
  name: 'Goblin Scout',
  team: 'enemy',
  position: { x: 3, y: 1 },
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
  ...overrides,
});

const validState = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: COMBAT_SCHEMA_VERSION,
  rulesVersion: 'combat-2.0.0',
  encounterId: 'emberwatch-encounter-1',
  stateRevision: 0,
  round: 1,
  phase: 'active',
  turnId: 'r1:player-hero',
  rng: {
    seed: 42,
    streams: { initiative: rngStream, actions: rngStream, loot: rngStream },
  },
  initiative: { order: ['player-hero', 'emberwatch:goblin-1'], activeIndex: 0 },
  combatants: {
    'player-hero': validCombatant({
      combatantId: 'player-hero',
      name: 'Hero',
      team: 'player',
      position: { x: 0, y: 0 },
      hp: 20,
      maxHp: 20,
      initiative: 14,
    }),
    'emberwatch:goblin-1': validCombatant(),
  },
  abilityCatalog: {
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
  },
  battlefield: { width: 12, height: 12, blockedCells: [{ x: 5, y: 5 }] },
  objectives: [],
  outcome: null,
  ...overrides,
});

// ── Static introspection helper ────────────────────────────────────────

const FORBIDDEN_ENTITY_ID_KEYS = new Set(['eid', 'entityId', 'entity_id', 'entityID', 'entity']);

/** Recursively collects every declared property name inside a JSON schema. */
const collectPropertyNames = (node: unknown, acc: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectPropertyNames(entry, acc);
    }
    return acc;
  }
  if (node === null || typeof node !== 'object') {
    return acc;
  }
  const record = node as Record<string, unknown>;
  const properties = record.properties;
  if (properties !== null && typeof properties === 'object') {
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      acc.add(key);
      collectPropertyNames((properties as Record<string, unknown>)[key], acc);
    }
  }
  const patternProperties = record.patternProperties;
  if (patternProperties !== null && typeof patternProperties === 'object') {
    for (const value of Object.values(patternProperties as Record<string, unknown>)) {
      collectPropertyNames(value, acc);
    }
  }
  const items = record.items;
  if (items !== undefined) {
    collectPropertyNames(items, acc);
  }
  const anyOf = record.anyOf;
  if (anyOf !== undefined) {
    collectPropertyNames(anyOf, acc);
  }
  return acc;
};

// ── AC-1: state schema ─────────────────────────────────────────────────

describe('CombatStateSchema (C-509 AC-1)', () => {
  it('accepts a conforming CombatState', () => {
    expect(Value.Check(CombatStateSchema, validState())).toBe(true);
  });

  it('rejects a missing schemaVersion', () => {
    const state = validState();
    delete state.schemaVersion;
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });

  it('rejects a missing rulesVersion', () => {
    const state = validState();
    delete state.rulesVersion;
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });

  it('rejects an unknown extra property at the root', () => {
    expect(Value.Check(CombatStateSchema, { ...validState(), extra: true })).toBe(false);
  });

  it('rejects an unknown extra property inside a combatant', () => {
    const state = validState();
    (state.combatants as Record<string, Record<string, unknown>>)['player-hero'].secret = 1;
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });

  it('rejects an out-of-range integer (negative hp)', () => {
    const state = validState();
    (state.combatants as Record<string, Record<string, unknown>>)['player-hero'].hp = -1;
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });

  it('accepts only schema version 2', () => {
    expect(Value.Check(CombatStateSchema, validState({ schemaVersion: 2 }))).toBe(true);
    expect(Value.Check(CombatStateSchema, validState({ schemaVersion: 1 }))).toBe(false);
    expect(Value.Check(CombatStateSchema, validState({ schemaVersion: 3 }))).toBe(false);
  });

  it('rejects an unknown phase (the narrowed §8.1 vocabulary)', () => {
    expect(Value.Check(CombatStateSchema, validState({ phase: 'reaction' }))).toBe(false);
  });

  it('rejects an unknown damage type in the ability catalog', () => {
    const state = validState();
    const catalog = state.abilityCatalog as Record<string, Record<string, unknown>>;
    catalog.basic_melee.damageType = 'holy';
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });

  it('accepts a null outcome and a null turnId', () => {
    expect(Value.Check(CombatStateSchema, validState({ outcome: null, turnId: null }))).toBe(true);
  });

  it('accepts a populated outcome', () => {
    expect(
      Value.Check(
        CombatStateSchema,
        validState({ phase: 'ended', outcome: { victory: true, reason: 'all_enemies_defeated' } }),
      ),
    ).toBe(true);
  });

  it('rejects a raw ECS entity id where a combatant id is required', () => {
    const state = validState();
    (state.combatants as Record<string, Record<string, unknown>>)['player-hero'].combatantId = 7;
    expect(Value.Check(CombatStateSchema, state)).toBe(false);
  });
});

describe('CombatState sub-schemas (C-509 AC-1)', () => {
  it('GridPointSchema rejects non-integer coordinates', () => {
    expect(Value.Check(GridPointSchema, { x: 1.5, y: 0 })).toBe(false);
    expect(Value.Check(GridPointSchema, { x: 1, y: 0 })).toBe(true);
  });

  it('TurnBudgetSchema rejects a negative movement budget', () => {
    expect(
      Value.Check(TurnBudgetSchema, {
        movementRemaining: -1,
        actionAvailable: true,
        quickActionAvailable: true,
        reactionAvailable: true,
      }),
    ).toBe(false);
  });

  it('CombatantStateSchema rejects extra properties', () => {
    expect(Value.Check(CombatantStateSchema, validCombatant({ eid: 3 }))).toBe(false);
  });

  it('SerializedRngSchema captures seed + internal state', () => {
    expect(Value.Check(SerializedRngSchema, { seed: 1, state: 2 })).toBe(true);
    expect(Value.Check(SerializedRngSchema, { seed: 1 })).toBe(false);
  });

  it('BattlefieldStateSchema rejects a zero-sized battlefield', () => {
    expect(Value.Check(BattlefieldStateSchema, { width: 0, height: 4, blockedCells: [] })).toBe(
      false,
    );
  });
});

// ── AC-1: command schema ───────────────────────────────────────────────

describe('CombatCommandSchema (C-509 AC-1)', () => {
  it('accepts every Combat-01 variant', () => {
    expect(
      Value.Check(CombatCommandSchema, {
        kind: 'move',
        combatantId: 'a',
        path: [{ x: 1, y: 0 }],
      }),
    ).toBe(true);
    expect(
      Value.Check(CombatCommandSchema, {
        kind: 'useAbility',
        combatantId: 'a',
        abilityId: 'basic_melee',
        targetIds: ['b'],
      }),
    ).toBe(true);
    expect(Value.Check(CombatCommandSchema, { kind: 'defend', combatantId: 'a' })).toBe(true);
    expect(Value.Check(CombatCommandSchema, { kind: 'wait', combatantId: 'a' })).toBe(true);
    expect(Value.Check(CombatCommandSchema, { kind: 'endTurn', combatantId: 'a' })).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(Value.Check(CombatCommandSchema, { kind: 'interact', combatantId: 'a' })).toBe(false);
    expect(Value.Check(CombatCommandSchema, { kind: 'teleport', combatantId: 'a' })).toBe(false);
  });

  it('rejects unknown extra properties on a variant', () => {
    expect(Value.Check(CombatCommandSchema, { kind: 'defend', combatantId: 'a', bonus: 1 })).toBe(
      false,
    );
  });

  it('rejects an empty movement path', () => {
    expect(Value.Check(CombatCommandSchema, { kind: 'move', combatantId: 'a', path: [] })).toBe(
      false,
    );
  });

  it('rejects a missing combatantId', () => {
    expect(Value.Check(CombatCommandSchema, { kind: 'wait' })).toBe(false);
  });
});

// ── AC-1: event schema ─────────────────────────────────────────────────

describe('CombatEventSchema (C-509 AC-1)', () => {
  const envelope = {
    encounterId: 'emberwatch-encounter-1',
    turnId: 'r1:player-hero',
    stateRevision: 1,
    round: 1,
  };

  it('accepts every Combat-01 event variant', () => {
    const events: unknown[] = [
      { ...envelope, kind: 'turnStarted', combatantId: 'a' },
      {
        ...envelope,
        kind: 'movementCommitted',
        combatantId: 'a',
        path: [{ x: 1, y: 0 }],
        movementCost: 1,
        movementRemaining: 5,
      },
      {
        ...envelope,
        kind: 'attackRolled',
        attackerId: 'a',
        targetId: 'b',
        abilityId: 'basic_melee',
        naturalRoll: 20,
        totalRoll: 25,
        hit: true,
        isCriticalHit: true,
      },
      {
        ...envelope,
        kind: 'damageApplied',
        attackerId: 'a',
        targetId: 'b',
        amount: 7,
        damageType: 'slashing',
        hpAfter: 5,
        downed: false,
      },
      { ...envelope, kind: 'combatantDowned', combatantId: 'b' },
      { ...envelope, kind: 'combatantDefeated', combatantId: 'b' },
      { ...envelope, kind: 'turnEnded', combatantId: 'a' },
      { ...envelope, kind: 'combatEnded', victory: true, reason: 'all_enemies_defeated' },
    ];
    for (const event of events) {
      expect(Value.Check(CombatEventSchema, event)).toBe(true);
    }
  });

  it('rejects an unknown event kind', () => {
    expect(Value.Check(CombatEventSchema, { ...envelope, kind: 'reactionOffered' })).toBe(false);
  });

  it('rejects an out-of-range natural roll', () => {
    expect(
      Value.Check(CombatEventSchema, {
        ...envelope,
        kind: 'attackRolled',
        attackerId: 'a',
        targetId: 'b',
        abilityId: 'basic_melee',
        naturalRoll: 21,
        totalRoll: 25,
        hit: true,
        isCriticalHit: false,
      }),
    ).toBe(false);
  });

  it('rejects an event without envelope identity', () => {
    expect(Value.Check(CombatEventSchema, { kind: 'turnEnded', combatantId: 'a' })).toBe(false);
  });
});

// ── AC-1: validation + replay schemas ──────────────────────────────────

describe('CombatValidationResultSchema (C-509 AC-1)', () => {
  it('accepts both variants', () => {
    expect(
      Value.Check(CombatValidationResultSchema, {
        valid: true,
        normalizedCommand: { kind: 'wait', combatantId: 'a' },
      }),
    ).toBe(true);
    expect(
      Value.Check(CombatValidationResultSchema, {
        valid: false,
        reasonCode: 'noActionAvailable',
        messageKey: 'combat.invalid.no_action',
      }),
    ).toBe(true);
  });

  it('rejects an unknown reason code', () => {
    expect(
      Value.Check(CombatValidationResultSchema, {
        valid: false,
        reasonCode: 'somethingElse',
        messageKey: 'x',
      }),
    ).toBe(false);
  });

  it('rejects a success result carrying a reason code', () => {
    expect(
      Value.Check(CombatValidationResultSchema, {
        valid: true,
        normalizedCommand: { kind: 'wait', combatantId: 'a' },
        reasonCode: 'noActionAvailable',
      }),
    ).toBe(false);
  });

  it('ResolveCombatResultSchema accepts a resolved state + events', () => {
    expect(
      Value.Check(ResolveCombatResultSchema, {
        valid: true,
        state: validState({ stateRevision: 1 }),
        events: [],
      }),
    ).toBe(true);
  });

  it('ResolveCombatResultSchema rejects a failure result carrying state', () => {
    expect(
      Value.Check(ResolveCombatResultSchema, {
        valid: false,
        reasonCode: 'staleRevision',
        messageKey: 'x',
        state: validState(),
      }),
    ).toBe(false);
  });
});

describe('CombatReplaySchema (C-509 AC-1)', () => {
  it('accepts a replay artifact with a null final state', () => {
    expect(
      Value.Check(CombatReplaySchema, {
        replayVersion: 1,
        rulesVersion: 'combat-2.0.0',
        initialState: validState(),
        commands: [{ kind: 'wait', combatantId: 'player-hero' }],
        events: [],
        finalState: null,
      }),
    ).toBe(true);
  });

  it('rejects a replay artifact missing rulesVersion', () => {
    expect(
      Value.Check(CombatReplaySchema, {
        replayVersion: 1,
        initialState: validState(),
        commands: [],
        events: [],
        finalState: null,
      }),
    ).toBe(false);
  });
});

// ── AC-1: no raw ECS entity ids in any schema ──────────────────────────

describe('combat schema surface (C-509 AC-1)', () => {
  it('finds forbidden properties nested in union branches', () => {
    const regressionSchema = Type.Union([
      Type.Object({ allowed: Type.String() }),
      Type.Object({ nested: Type.Object({ eid: Type.Integer() }) }),
    ]);
    const names = collectPropertyNames(regressionSchema);
    expect([...names].filter((name) => FORBIDDEN_ENTITY_ID_KEYS.has(name))).toEqual(['eid']);
  });

  it('declares no raw ECS entity-id field anywhere', () => {
    const names = collectPropertyNames([
      CombatStateSchema,
      CombatCommandSchema,
      CombatEventSchema,
      CombatValidationResultSchema,
      CombatReplaySchema,
    ]);
    const offenders = [...names].filter((name) => FORBIDDEN_ENTITY_ID_KEYS.has(name));
    expect(offenders).toEqual([]);
  });
});
