// packages/shared/schemas/src/lib/game/rules_command.test.ts
//
// Validation tests for the RulesCommand / RulesEvent TypeBox schemas.
// Contract: C-336 AC-2

import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import {
  ApplyDamageCommandSchema,
  ApplyHealingCommandSchema,
  ApplyRelationshipDeltaCommandSchema,
  MechanicalSnapshotSchema,
  RollDamageCommandSchema,
  RollLootCommandSchema,
  RollSkillCheckCommandSchema,
  RulesCommandSchema,
  RulesEventSchema,
} from './rules_command';

// ── Helpers ────────────────────────────────────────────────────────────

const makeValidSkillCheck = () => ({
  kind: 'rollSkillCheck' as const,
  skill: 'Persuasion',
  abilityModifier: 3,
  proficiencyBonus: 2,
  difficultyClass: 15,
  advantage: false,
});

const makeValidAttack = () => ({
  kind: 'rollAttack' as const,
  attackBonus: 5,
  targetArmorClass: 15,
  advantage: false,
  disadvantage: false,
});

const makeValidDamage = () => ({
  kind: 'rollDamage' as const,
  damageDice: '1d6+2',
  isCritical: false,
});

const makeValidApplyDamage = () => ({
  kind: 'applyDamage' as const,
  targetCurrentHp: 30,
  amount: 8,
  targetMaxHp: 30,
});

const makeValidApplyHealing = () => ({
  kind: 'applyHealing' as const,
  targetCurrentHp: 10,
  amount: 15,
  targetMaxHp: 30,
});

const makeValidGrantXp = () => ({
  kind: 'grantXp' as const,
  currentXp: 50,
  amount: 25,
  xpToNextLevel: 100,
  currentLevel: 1,
});

const makeValidRollLoot = () => ({
  kind: 'rollLoot' as const,
  lootTable: [
    { itemId: 'sword_of_truth', dropChance: 0.5, quantity: 1 },
    { itemId: 'health_potion', dropChance: 0.8, quantity: 2 },
  ],
});

const makeValidRelationshipDelta = () => ({
  kind: 'applyRelationshipDelta' as const,
  currentTrust: 10,
  currentAffinity: 20,
  trustDelta: 5,
  affinityDelta: -3,
  eventDescription: "The player saved the NPC's family",
});

// ── RulesCommand schema tests ──────────────────────────────────────────

describe('RulesCommandSchema', () => {
  it('validates all command variants', () => {
    const commands = [
      makeValidSkillCheck(),
      makeValidAttack(),
      makeValidDamage(),
      makeValidApplyDamage(),
      makeValidApplyHealing(),
      makeValidGrantXp(),
      makeValidRollLoot(),
      makeValidRelationshipDelta(),
    ];

    for (const cmd of commands) {
      const result = Value.Check(RulesCommandSchema, cmd);
      expect(result).toBe(true);
    }
  });

  it('rejects unknown kind values', () => {
    const result = Value.Check(RulesCommandSchema, {
      kind: 'unknownCommandType',
    });
    expect(result).toBe(false);
  });

  it('accepts rollAttack command with both advantage and disadvantage true', () => {
    const cmd = {
      ...makeValidAttack(),
      advantage: true,
      disadvantage: true,
    };
    expect(Value.Check(RulesCommandSchema, cmd)).toBe(true);
  });

  it('rejects additional properties on command objects', () => {
    const cmd = {
      ...makeValidSkillCheck(),
      extraField: 'should be rejected',
    };
    expect(Value.Check(RollSkillCheckCommandSchema, cmd)).toBe(false);
  });

  it('rejects additional properties on event objects', () => {
    // Test damageDice matching pattern
    expect(
      Value.Check(RollDamageCommandSchema, {
        kind: 'rollDamage',
        damageDice: 'not-a-dice',
        isCritical: false,
      }),
    ).toBe(false);
    expect(
      Value.Check(RollDamageCommandSchema, {
        kind: 'rollDamage',
        damageDice: '2d8',
        isCritical: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(RollDamageCommandSchema, {
        kind: 'rollDamage',
        damageDice: '1d6+2',
        isCritical: true,
      }),
    ).toBe(true);
    expect(
      Value.Check(RollDamageCommandSchema, {
        kind: 'rollDamage',
        damageDice: '10d100+50',
        isCritical: false,
      }),
    ).toBe(true);
  });

  it('enforces numeric range bounds on skillCheck', () => {
    // difficultyClass below minimum
    expect(
      Value.Check(RollSkillCheckCommandSchema, {
        ...makeValidSkillCheck(),
        difficultyClass: 2,
      }),
    ).toBe(false);

    // difficultyClass above maximum
    expect(
      Value.Check(RollSkillCheckCommandSchema, {
        ...makeValidSkillCheck(),
        difficultyClass: 35,
      }),
    ).toBe(false);

    // proficiencyBonus below minimum
    expect(
      Value.Check(RollSkillCheckCommandSchema, {
        ...makeValidSkillCheck(),
        proficiencyBonus: 0,
      }),
    ).toBe(false);
  });

  it('enforces HP bounds on applyDamage', () => {
    // negative HP
    expect(
      Value.Check(ApplyDamageCommandSchema, {
        ...makeValidApplyDamage(),
        targetCurrentHp: -1,
      }),
    ).toBe(false);

    // negative amount
    expect(
      Value.Check(ApplyDamageCommandSchema, {
        ...makeValidApplyDamage(),
        amount: -1,
      }),
    ).toBe(false);
  });

  it('enforces HP bounds on applyHealing', () => {
    expect(
      Value.Check(ApplyHealingCommandSchema, {
        ...makeValidApplyHealing(),
        targetMaxHp: 0,
      }),
    ).toBe(false);
  });

  it('enforces relationship bounds', () => {
    expect(
      Value.Check(ApplyRelationshipDeltaCommandSchema, {
        ...makeValidRelationshipDelta(),
        currentTrust: -200,
      }),
    ).toBe(false);

    expect(
      Value.Check(ApplyRelationshipDeltaCommandSchema, {
        ...makeValidRelationshipDelta(),
        currentAffinity: 200,
      }),
    ).toBe(false);
  });

  it('accepts empty loot table', () => {
    expect(
      Value.Check(RollLootCommandSchema, {
        kind: 'rollLoot',
        lootTable: [],
      }),
    ).toBe(true);
  });

  it('rejects loot table entries outside [0,1] drop chance', () => {
    expect(
      Value.Check(RollLootCommandSchema, {
        kind: 'rollLoot',
        lootTable: [{ itemId: 'test', dropChance: 1.5, quantity: 1 }],
      }),
    ).toBe(false);

    expect(
      Value.Check(RollLootCommandSchema, {
        kind: 'rollLoot',
        lootTable: [{ itemId: 'test', dropChance: -0.1, quantity: 1 }],
      }),
    ).toBe(false);
  });
});

// ── RulesEvent schema tests ────────────────────────────────────────────

describe('RulesEventSchema', () => {
  it('validates all event variants', () => {
    const events = [
      {
        kind: 'skillCheckResolved',
        naturalRoll: 18,
        totalRoll: 23,
        success: true,
        isCriticalSuccess: false,
        isCriticalFailure: false,
      },
      { kind: 'attackResolved', naturalRoll: 20, totalRoll: 25, hit: true, isCriticalHit: true },
      {
        kind: 'damageResolved',
        naturalDamage: 6,
        totalDamage: 8,
        targetHpAfter: 22,
        isDefeated: false,
      },
      { kind: 'healingResolved', amountHealed: 15, targetHpAfter: 25 },
      { kind: 'xpGranted', xpAfter: 75, leveledUp: true, newLevel: 2 },
      { kind: 'lootGenerated', items: [{ itemId: 'health_potion', quantity: 2 }] },
      { kind: 'relationshipUpdated', trustAfter: 15, affinityAfter: 17 },
    ];

    for (const evt of events) {
      expect(Value.Check(RulesEventSchema, evt)).toBe(true);
    }
  });

  it('rejects unknown event kinds', () => {
    expect(Value.Check(RulesEventSchema, { kind: 'unknownEvent' })).toBe(false);
  });

  it('rejects invalid naturalRoll on skillCheckResolved', () => {
    expect(
      Value.Check(RulesEventSchema, {
        kind: 'skillCheckResolved',
        naturalRoll: 21,
        totalRoll: 25,
        success: true,
        isCriticalSuccess: false,
        isCriticalFailure: false,
      }),
    ).toBe(false);
  });

  it('rejects events with additional properties', () => {
    const result = Value.Check(RulesEventSchema, {
      kind: 'damageResolved',
      naturalDamage: 6,
      totalDamage: 8,
      targetHpAfter: 22,
      isDefeated: false,
      extraField: 'nope',
    });
    expect(result).toBe(false);
  });
});

// ── MechanicalSnapshot schema tests ────────────────────────────────────

describe('MechanicalSnapshotSchema', () => {
  it('validates a complete snapshot', () => {
    const snapshot = {
      version: 1,
      seed: 42,
      commandLog: [
        { index: 0, commandKind: 'rollAttack' },
        { index: 1, commandKind: 'rollDamage' },
        { index: 2, commandKind: 'applyDamage' },
      ],
      finalState: {
        playerHp: 22,
        enemyHp: 0,
        xp: 75,
      },
    };
    expect(Value.Check(MechanicalSnapshotSchema, snapshot)).toBe(true);
  });

  it('rejects missing version', () => {
    const { version, ...rest } = {
      version: 1,
      seed: 42,
      commandLog: [],
      finalState: {},
    };
    expect(Value.Check(MechanicalSnapshotSchema, rest)).toBe(false);
  });

  it('accepts snapshot with rngState on entries', () => {
    const snapshot = {
      version: 1,
      seed: 42,
      commandLog: [
        {
          index: 0,
          commandKind: 'rollAttack',
          rngState: { seed: 42, state: 0x6d2b79f5 + 42 },
        },
      ],
      finalState: {},
    };
    expect(Value.Check(MechanicalSnapshotSchema, snapshot)).toBe(true);
  });

  it('rejects snapshot with unknown top-level property', () => {
    const snapshot = {
      version: 1,
      seed: 42,
      commandLog: [
        { index: 0, commandKind: 'rollAttack' },
        { index: 1, commandKind: 'rollDamage' },
        { index: 2, commandKind: 'applyDamage' },
      ],
      finalState: {
        playerHp: 22,
        enemyHp: 0,
        xp: 75,
      },
      unknownField: 'should be rejected',
    };
    expect(Value.Check(MechanicalSnapshotSchema, snapshot)).toBe(false);
  });
});
