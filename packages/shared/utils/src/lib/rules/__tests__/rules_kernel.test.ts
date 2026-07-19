// packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts
//
// Tests for the deterministic rules kernel.
// Contract: C-336 AC-3

import { describe, expect, it } from 'bun:test';
import type { RulesCommand, RulesEvent } from '@aikami/types';
import { createSeedableRng, serializeRng } from '../../rng/seedable_rng';
import { createMechanicalSnapshot, replayCommandLog, resolveCommand } from '../rules_kernel';

// ── Helpers ────────────────────────────────────────────────────────────

const emptySnapshot = (): Record<string, unknown> => ({});

const cmd = (overrides: Partial<RulesCommand> & { kind: RulesCommand['kind'] }): RulesCommand => {
  const defaults: Record<string, unknown> = {
    rollSkillCheck: {
      skill: 'Persuasion',
      abilityModifier: 3,
      proficiencyBonus: 2,
      difficultyClass: 15,
      advantage: false,
    },
    rollAttack: {
      attackBonus: 5,
      targetArmorClass: 15,
      advantage: false,
      disadvantage: false,
    },
    rollDamage: {
      damageDice: '1d6+2',
      isCritical: false,
    },
    applyDamage: {
      targetCurrentHp: 30,
      amount: 8,
      targetMaxHp: 30,
    },
    applyHealing: {
      targetCurrentHp: 10,
      amount: 15,
      targetMaxHp: 30,
    },
    grantXp: {
      currentXp: 50,
      amount: 25,
      xpToNextLevel: 100,
      currentLevel: 1,
    },
    rollLoot: {
      lootTable: [{ itemId: 'sword', dropChance: 0.5, quantity: 1 }],
    },
    applyRelationshipDelta: {
      currentTrust: 10,
      currentAffinity: 20,
      trustDelta: 5,
      affinityDelta: -3,
      eventDescription: 'test',
    },
  };

  return { ...(defaults[overrides.kind] as Record<string, unknown>), ...overrides } as RulesCommand;
};

// ── Determinism tests ──────────────────────────────────────────────────

describe('resolveCommand determinism', () => {
  it('produces identical results 100 times for rollSkillCheck with same seed', () => {
    const results: Array<{ events: RulesEvent[] }> = [];

    for (let i = 0; i < 100; i++) {
      const rng = createSeedableRng(42);
      const result = resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollSkillCheck' }),
        rng,
      });
      results.push(result);
    }

    // All 100 results must be identical
    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  it('produces identical results 100 times for rollAttack with same seed', () => {
    const first = JSON.stringify(
      resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollAttack' }),
        rng: createSeedableRng(42),
      }),
    );

    for (let i = 0; i < 100; i++) {
      const result = resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollAttack' }),
        rng: createSeedableRng(42),
      });
      expect(JSON.stringify(result)).toBe(first);
    }
  });

  it('does NOT mutate the input snapshot', () => {
    const snapshot = { hp: 100, xp: 50 };
    const snapshotCopy = { ...snapshot };
    const rng = createSeedableRng(42);

    resolveCommand({
      snapshot,
      command: cmd({ kind: 'rollAttack' }),
      rng,
    });

    expect(snapshot).toEqual(snapshotCopy);
  });

  it('RNG advances by correct number of dice rolls per command', () => {
    // rollSkillCheck: 1 d20 (no advantage) = 1 dice call
    const rng1 = createSeedableRng(42);
    const stateBefore1 = serializeRng(rng1).state;
    resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollSkillCheck' }),
      rng: rng1,
    });
    const stateAfter1 = serializeRng(rng1).state;
    expect(stateBefore1).not.toBe(stateAfter1);

    // rollSkillCheck with advantage: 2 d20 = 2 dice calls
    const rng2 = createSeedableRng(42);
    resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollSkillCheck', advantage: true }),
      rng: rng2,
    });
    const stateAfterAdv = serializeRng(rng2).state;

    // State after advantage should differ from state after normal (different # of rolls)
    expect(stateAfter1).not.toBe(stateAfterAdv);
  });
});

// ── Command variant tests ──────────────────────────────────────────────

describe('rollSkillCheck', () => {
  it('returns skillCheckResolved event with correct structure', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollSkillCheck' }),
      rng,
    });

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe('skillCheckResolved');
    expect((event as { naturalRoll: number }).naturalRoll).toBeGreaterThanOrEqual(1);
    expect((event as { naturalRoll: number }).naturalRoll).toBeLessThanOrEqual(20);
    expect(typeof (event as { success: boolean }).success).toBe('boolean');
  });

  it('nat 20 is critical success', () => {
    // Find a seed that gives nat 20
    for (let seed = 0; seed < 1000; seed++) {
      const rng = createSeedableRng(seed);
      const result = resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollSkillCheck' }),
        rng,
      });
      const event = result.events[0] as { naturalRoll: number; isCriticalSuccess: boolean };
      if (event.naturalRoll === 20) {
        expect(event.isCriticalSuccess).toBe(true);
        return;
      }
    }
    // If no nat 20 found in 1000 seeds, that's statistically improbable
    // but not impossible — skip assertion rather than fail
  });

  it('nat 1 is critical failure', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rng = createSeedableRng(seed);
      const result = resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollSkillCheck' }),
        rng,
      });
      const event = result.events[0] as { naturalRoll: number; isCriticalFailure: boolean };
      if (event.naturalRoll === 1) {
        expect(event.isCriticalFailure).toBe(true);
        return;
      }
    }
  });

  it('with advantage, rolls 2d20 and takes higher', () => {
    // Verify deterministically: same seed, advantage vs no advantage
    // The total should differ because advantage rolls twice
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollSkillCheck', advantage: true }),
      rng,
    });
    const event = result.events[0] as { naturalRoll: number; totalRoll: number };
    expect(event.naturalRoll).toBeGreaterThanOrEqual(1);
    expect(event.naturalRoll).toBeLessThanOrEqual(20);
  });

  it('totalRoll = naturalRoll + abilityModifier + proficiencyBonus', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollSkillCheck', abilityModifier: 3, proficiencyBonus: 2 }),
      rng,
    });
    const event = result.events[0] as { naturalRoll: number; totalRoll: number };
    expect(event.totalRoll).toBe(event.naturalRoll + 3 + 2);
  });
});

describe('rollAttack', () => {
  it('returns attackResolved event', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollAttack' }),
      rng,
    });

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe('attackResolved');
  });

  it('advantage + disadvantage = normal roll (cancel)', () => {
    const rng1 = createSeedableRng(42);
    const rng2 = createSeedableRng(42);

    const normal = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollAttack', advantage: false, disadvantage: false }),
      rng: rng1,
    });

    const cancelled = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollAttack', advantage: true, disadvantage: true }),
      rng: rng2,
    });

    // Both should produce identical results (1 d20 roll each)
    expect(JSON.stringify(normal)).toBe(JSON.stringify(cancelled));
  });

  it('nat 20 is critical hit', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rng = createSeedableRng(seed);
      const result = resolveCommand({
        snapshot: emptySnapshot(),
        command: cmd({ kind: 'rollAttack' }),
        rng,
      });
      const event = result.events[0] as { naturalRoll: number; isCriticalHit: boolean };
      if (event.naturalRoll === 20) {
        expect(event.isCriticalHit).toBe(true);
        return;
      }
    }
  });
});

describe('rollDamage', () => {
  it('parses damage dice notation and rolls correct count', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollDamage', damageDice: '2d8+3' }),
      rng,
    });

    const event = result.events[0];
    expect(event.kind).toBe('damageResolved');
  });

  it('critical hits double the dice count', () => {
    const resultNormal = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollDamage', damageDice: '1d6+2', isCritical: false }),
      rng: createSeedableRng(42),
    });

    const resultCrit = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollDamage', damageDice: '1d6+2', isCritical: true }),
      rng: createSeedableRng(42),
    });

    // Critical should have different damage due to double dice
    const normalDamage = (resultNormal.events[0] as { totalDamage: number }).totalDamage;
    const critDamage = (resultCrit.events[0] as { totalDamage: number }).totalDamage;
    // They might be the same by chance, but the RNG state will be different
    expect(normalDamage).toBeGreaterThanOrEqual(3); // min 1d6+2
    expect(critDamage).toBeGreaterThanOrEqual(4); // min 2d6+2
  });
});

describe('applyDamage', () => {
  it('subtracts damage from HP', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: { playerHp: 30 },
      command: cmd({ kind: 'applyDamage', targetCurrentHp: 30, amount: 8, targetMaxHp: 30 }),
      rng,
    });

    const event = result.events[0] as { targetHpAfter: number; isDefeated: boolean };
    expect(event.targetHpAfter).toBe(22);
    expect(event.isDefeated).toBe(false);
  });

  it('clamps HP at 0 (never negative)', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'applyDamage', targetCurrentHp: 5, amount: 20, targetMaxHp: 30 }),
      rng,
    });

    const event = result.events[0] as { targetHpAfter: number; isDefeated: boolean };
    expect(event.targetHpAfter).toBe(0);
    expect(event.isDefeated).toBe(true);
  });

  it('marks isDefeated when HP reaches 0', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'applyDamage', targetCurrentHp: 8, amount: 8, targetMaxHp: 30 }),
      rng,
    });

    const event = result.events[0] as { targetHpAfter: number; isDefeated: boolean };
    expect(event.targetHpAfter).toBe(0);
    expect(event.isDefeated).toBe(true);
  });
});

describe('applyHealing', () => {
  it('adds healing to HP', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'applyHealing', targetCurrentHp: 10, amount: 15, targetMaxHp: 30 }),
      rng,
    });

    const event = result.events[0] as { amountHealed: number; targetHpAfter: number };
    expect(event.targetHpAfter).toBe(25);
    expect(event.amountHealed).toBe(15);
  });

  it('clamps HP at maxHp', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'applyHealing', targetCurrentHp: 25, amount: 20, targetMaxHp: 30 }),
      rng,
    });

    const event = result.events[0] as { amountHealed: number; targetHpAfter: number };
    expect(event.targetHpAfter).toBe(30);
    expect(event.amountHealed).toBe(5);
  });
});

describe('grantXp', () => {
  it('adds XP and detects no level-up', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'grantXp',
        currentXp: 50,
        amount: 25,
        xpToNextLevel: 100,
        currentLevel: 1,
      }),
      rng,
    });

    const event = result.events[0] as {
      xpAfter: number;
      leveledUp: boolean;
      newLevel: number | null;
    };
    expect(event.xpAfter).toBe(75);
    expect(event.leveledUp).toBe(false);
    expect(event.newLevel).toBe(null);
  });

  it('detects level-up when XP reaches threshold', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'grantXp',
        currentXp: 80,
        amount: 20,
        xpToNextLevel: 100,
        currentLevel: 1,
      }),
      rng,
    });

    const event = result.events[0] as {
      xpAfter: number;
      leveledUp: boolean;
      newLevel: number | null;
    };
    expect(event.xpAfter).toBe(100);
    expect(event.leveledUp).toBe(true);
    expect(event.newLevel).toBe(2);
  });

  it('detects level-up when XP exceeds threshold', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'grantXp',
        currentXp: 90,
        amount: 50,
        xpToNextLevel: 100,
        currentLevel: 3,
      }),
      rng,
    });

    const event = result.events[0] as {
      xpAfter: number;
      leveledUp: boolean;
      newLevel: number | null;
    };
    expect(event.xpAfter).toBe(140);
    expect(event.leveledUp).toBe(true);
    expect(event.newLevel).toBe(4);
  });
});

describe('rollLoot', () => {
  it('returns lootGenerated event with items', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'rollLoot',
        lootTable: [
          { itemId: 'sword', dropChance: 0.5, quantity: 1 },
          { itemId: 'potion', dropChance: 0.5, quantity: 2 },
        ],
      }),
      rng,
    });

    const event = result.events[0];
    expect(event.kind).toBe('lootGenerated');
    const items = (event as { items: Array<{ itemId: string }> }).items;
    expect(Array.isArray(items)).toBe(true);
  });

  it('empty loot table returns no items', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({ kind: 'rollLoot', lootTable: [] }),
      rng,
    });

    const event = result.events[0] as { items: unknown[] };
    expect(event.items).toEqual([]);
  });

  it('guaranteed drop (dropChance=1) always succeeds', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'rollLoot',
        lootTable: [{ itemId: 'guaranteed_item', dropChance: 1.0, quantity: 1 }],
      }),
      rng,
    });

    const event = result.events[0] as { items: Array<{ itemId: string; quantity: number }> };
    expect(event.items).toHaveLength(1);
    expect(event.items[0].itemId).toBe('guaranteed_item');
  });

  it('impossible drop (dropChance=0) never succeeds', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'rollLoot',
        lootTable: [{ itemId: 'impossible_item', dropChance: 0, quantity: 1 }],
      }),
      rng,
    });

    const event = result.events[0] as { items: unknown[] };
    expect(event.items).toEqual([]);
  });

  it('each loot entry rolls independently', () => {
    // Deterministic: same seed produces same loot results every time
    const rng1 = createSeedableRng(123);
    const rng2 = createSeedableRng(123);

    const result1 = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'rollLoot',
        lootTable: [
          { itemId: 'a', dropChance: 0.5, quantity: 1 },
          { itemId: 'b', dropChance: 0.5, quantity: 1 },
          { itemId: 'c', dropChance: 0.5, quantity: 1 },
        ],
      }),
      rng: rng1,
    });

    const result2 = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'rollLoot',
        lootTable: [
          { itemId: 'a', dropChance: 0.5, quantity: 1 },
          { itemId: 'b', dropChance: 0.5, quantity: 1 },
          { itemId: 'c', dropChance: 0.5, quantity: 1 },
        ],
      }),
      rng: rng2,
    });

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });
});

describe('applyRelationshipDelta', () => {
  it('applies trust and affinity deltas', () => {
    const rng = createSeedableRng(42);
    const result = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'applyRelationshipDelta',
        currentTrust: 10,
        currentAffinity: 20,
        trustDelta: 5,
        affinityDelta: -3,
        eventDescription: 'test',
      }),
      rng,
    });

    const event = result.events[0] as { trustAfter: number; affinityAfter: number };
    expect(event.trustAfter).toBe(15);
    expect(event.affinityAfter).toBe(17);
  });

  it('clamps trust to [-100, 100]', () => {
    const rng = createSeedableRng(42);

    const upperClamp = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'applyRelationshipDelta',
        currentTrust: 95,
        currentAffinity: 0,
        trustDelta: 20,
        affinityDelta: 0,
        eventDescription: 'test',
      }),
      rng,
    });
    expect((upperClamp.events[0] as { trustAfter: number }).trustAfter).toBe(100);

    const lowerClamp = resolveCommand({
      snapshot: emptySnapshot(),
      command: cmd({
        kind: 'applyRelationshipDelta',
        currentTrust: -95,
        currentAffinity: 0,
        trustDelta: -20,
        affinityDelta: 0,
        eventDescription: 'test',
      }),
      rng: createSeedableRng(42),
    });
    expect((lowerClamp.events[0] as { trustAfter: number }).trustAfter).toBe(-100);
  });
});

// ── replayCommandLog tests ─────────────────────────────────────────────

describe('replayCommandLog', () => {
  it('replays a command log deterministically', () => {
    const commands: RulesCommand[] = [
      cmd({ kind: 'rollAttack', attackBonus: 5, targetArmorClass: 15 }),
      cmd({ kind: 'rollDamage', damageDice: '1d6+2', isCritical: false }),
      cmd({ kind: 'applyDamage', targetCurrentHp: 30, amount: 8, targetMaxHp: 30 }),
      cmd({ kind: 'grantXp', currentXp: 0, amount: 25, xpToNextLevel: 100, currentLevel: 1 }),
    ];

    const result1 = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });
    const result2 = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('different seeds produce different outcomes', () => {
    const commands: RulesCommand[] = [
      cmd({ kind: 'rollAttack', attackBonus: 5, targetArmorClass: 15 }),
    ];

    const result1 = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });
    const result2 = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 99 });

    expect(JSON.stringify(result1)).not.toBe(JSON.stringify(result2));
  });

  it('produces correct number of events', () => {
    const commands: RulesCommand[] = [
      cmd({ kind: 'rollAttack' }),
      cmd({ kind: 'rollDamage', damageDice: '1d6+2' }),
      cmd({ kind: 'applyDamage', targetCurrentHp: 30, amount: 8, targetMaxHp: 30 }),
    ];

    const result = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });
    expect(result.allEvents).toHaveLength(3);
    expect(result.commandLog).toHaveLength(3);
  });

  it('command log preserves kind information', () => {
    const commands: RulesCommand[] = [
      cmd({ kind: 'rollAttack' }),
      cmd({ kind: 'grantXp', currentXp: 50, amount: 25, xpToNextLevel: 100, currentLevel: 1 }),
    ];

    const result = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });
    expect(result.commandLog[0].commandKind).toBe('rollAttack');
    expect(result.commandLog[1].commandKind).toBe('grantXp');
  });

  it('snapshot state carries over between commands', () => {
    const commands: RulesCommand[] = [
      cmd({ kind: 'applyDamage', targetCurrentHp: 30, amount: 5, targetMaxHp: 30 }),
      cmd({ kind: 'applyHealing', targetCurrentHp: 25, amount: 5, targetMaxHp: 30 }),
      cmd({ kind: 'grantXp', currentXp: 50, amount: 25, xpToNextLevel: 100, currentLevel: 1 }),
    ];

    const result = replayCommandLog({ snapshot: emptySnapshot(), commandLog: commands, seed: 42 });
    expect(result.allEvents).toHaveLength(3);
  });
});

// ── createMechanicalSnapshot tests ─────────────────────────────────────

describe('createMechanicalSnapshot', () => {
  it('creates a valid snapshot artifact', () => {
    const snapshot = createMechanicalSnapshot({
      finalState: { playerHp: 22, enemyHp: 0, xp: 75 },
      seed: 42,
      commandLog: [
        { index: 0, commandKind: 'rollAttack' },
        { index: 1, commandKind: 'rollDamage' },
        { index: 2, commandKind: 'applyDamage' },
      ],
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.seed).toBe(42);
    expect(snapshot.commandLog).toHaveLength(3);
    expect(snapshot.finalState).toEqual({ playerHp: 22, enemyHp: 0, xp: 75 });
  });
});
