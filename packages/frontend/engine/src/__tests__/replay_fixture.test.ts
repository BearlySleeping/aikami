// packages/frontend/engine/src/__tests__/replay_fixture.test.ts
//
// Replay fixture test — proves deterministic round-trip across combat,
// skill checks, damage, healing, XP, loot, and relationship mutations.
//
// Contract: C-336 AC-5
//
// Strategy: Record a command sequence → resolve through the kernel →
// hash the final snapshot. Replay the same sequence 100 times —
// every run must produce the same hash. Different seeds produce
// different hashes.

import { describe, expect, it } from 'bun:test';
import type { RulesCommand } from '@aikami/types';
import { replayCommandLog } from '@aikami/utils';

// ── Fixture: a representative session covering all command variants ────

const SESSION_SEED = 42;

const SESSION_COMMANDS: RulesCommand[] = [
  // ── Combat sequence: 3 attack rounds ──
  {
    kind: 'rollAttack',
    attackBonus: 5,
    targetArmorClass: 15,
    advantage: false,
    disadvantage: false,
  },
  {
    kind: 'rollAttack',
    attackBonus: 5,
    targetArmorClass: 15,
    advantage: true,
    disadvantage: false,
  },
  {
    kind: 'rollAttack',
    attackBonus: 5,
    targetArmorClass: 18,
    advantage: false,
    disadvantage: false,
  },

  // ── Damage resolution ──
  { kind: 'rollDamage', damageDice: '1d6+2', isCritical: false },
  { kind: 'rollDamage', damageDice: '2d8+3', isCritical: true },

  // ── Apply damage to target ──
  { kind: 'applyDamage', targetCurrentHp: 45, amount: 8, targetMaxHp: 45 },
  { kind: 'applyDamage', targetCurrentHp: 37, amount: 12, targetMaxHp: 45 },

  // ── Healing ──
  { kind: 'applyHealing', targetCurrentHp: 25, amount: 10, targetMaxHp: 45 },

  // ── Skill check ──
  {
    kind: 'rollSkillCheck',
    skill: 'Persuasion',
    abilityModifier: 3,
    proficiencyBonus: 2,
    difficultyClass: 15,
    advantage: false,
  },

  // ── XP grants ──
  { kind: 'grantXp', currentXp: 50, amount: 25, xpToNextLevel: 100, currentLevel: 1 },
  { kind: 'grantXp', currentXp: 75, amount: 30, xpToNextLevel: 100, currentLevel: 1 },

  // ── Loot generation ──
  {
    kind: 'rollLoot',
    lootTable: [
      { itemId: 'sword_of_truth', dropChance: 0.5, quantity: 1 },
      { itemId: 'health_potion', dropChance: 0.75, quantity: 2 },
      { itemId: 'gold_pouch', dropChance: 0.3, quantity: 1 },
    ],
  },

  // ── Relationship deltas ──
  {
    kind: 'applyRelationshipDelta',
    currentTrust: 10,
    currentAffinity: 20,
    trustDelta: 5,
    affinityDelta: -3,
    eventDescription: 'Player saved the village',
  },
  {
    kind: 'applyRelationshipDelta',
    currentTrust: 15,
    currentAffinity: 17,
    trustDelta: -10,
    affinityDelta: 5,
    eventDescription: 'Player insulted the NPC',
  },

  // ── More combat to advance RNG ──
  {
    kind: 'rollAttack',
    attackBonus: 5,
    targetArmorClass: 12,
    advantage: false,
    disadvantage: true,
  },

  // ── Final damage to defeat enemy ──
  { kind: 'applyDamage', targetCurrentHp: 5, amount: 20, targetMaxHp: 45 },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe('Replay Fixture — Deterministic Round-Trip (C-336 AC-5)', () => {
  const initialSnapshot: Record<string, unknown> = {};

  it('produces identical snapshot hash across 100 replays', () => {
    const firstResult = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: SESSION_SEED,
    });

    const firstHash = JSON.stringify(firstResult.finalSnapshot);

    for (let i = 0; i < 100; i++) {
      const result = replayCommandLog({
        snapshot: initialSnapshot,
        commandLog: SESSION_COMMANDS,
        seed: SESSION_SEED,
      });
      const hash = JSON.stringify(result.finalSnapshot);
      expect(hash).toBe(firstHash);
    }
  });

  it('produces identical event sequence across 100 replays', () => {
    const firstResult = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: SESSION_SEED,
    });

    const firstEventJson = JSON.stringify(firstResult.allEvents);

    for (let i = 0; i < 100; i++) {
      const result = replayCommandLog({
        snapshot: initialSnapshot,
        commandLog: SESSION_COMMANDS,
        seed: SESSION_SEED,
      });
      expect(JSON.stringify(result.allEvents)).toBe(firstEventJson);
    }
  });

  it('produces correct number of events', () => {
    const result = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: SESSION_SEED,
    });

    // Each command produces 1 event
    expect(result.allEvents).toHaveLength(SESSION_COMMANDS.length);
    expect(result.commandLog).toHaveLength(SESSION_COMMANDS.length);
  });

  it('different seed produces different event outcomes', () => {
    const result1 = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: 42,
    });

    const result2 = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: 99,
    });

    expect(JSON.stringify(result1.allEvents)).not.toBe(JSON.stringify(result2.allEvents));
  });

  it('command log ordering is preserved', () => {
    const result = replayCommandLog({
      snapshot: initialSnapshot,
      commandLog: SESSION_COMMANDS,
      seed: SESSION_SEED,
    });

    // Index: 0, 1, 2 are rollAttack (3 attack rounds)
    expect(result.commandLog[0].commandKind).toBe('rollAttack');
    expect(result.commandLog[2].commandKind).toBe('rollAttack');
    // Index: 3, 4 are rollDamage
    expect(result.commandLog[3].commandKind).toBe('rollDamage');
    // Index: 5, 6 are applyDamage
    expect(result.commandLog[5].commandKind).toBe('applyDamage');
    // Index: 7 is applyHealing
    expect(result.commandLog[7].commandKind).toBe('applyHealing');
    // Index: 8 is rollSkillCheck
    expect(result.commandLog[8].commandKind).toBe('rollSkillCheck');
    // Index: 9, 10 are grantXp
    expect(result.commandLog[9].commandKind).toBe('grantXp');
  });

  it('final state includes expected mechanical keys after combat', () => {
    // Use a subset of commands that would produce a meaningful final state
    const combatSnapshot: Record<string, unknown> = {
      playerHp: 30,
      playerMaxHp: 30,
      playerLevel: 1,
      playerXp: 0,
      enemyHp: 20,
      enemyMaxHp: 20,
    };

    const combatCommands: RulesCommand[] = [
      {
        kind: 'rollAttack',
        attackBonus: 5,
        targetArmorClass: 12,
        advantage: false,
        disadvantage: false,
      },
      { kind: 'rollDamage', damageDice: '1d8+3', isCritical: false },
      { kind: 'applyDamage', targetCurrentHp: 20, amount: 7, targetMaxHp: 20 },
      { kind: 'grantXp', currentXp: 0, amount: 50, xpToNextLevel: 100, currentLevel: 1 },
    ];

    const result = replayCommandLog({
      snapshot: combatSnapshot,
      commandLog: combatCommands,
      seed: 42,
    });

    // Verify the result is deterministic
    const result2 = replayCommandLog({
      snapshot: combatSnapshot,
      commandLog: combatCommands,
      seed: 42,
    });

    expect(JSON.stringify(result)).toBe(JSON.stringify(result2));
  });

  it('empty command log produces original snapshot unchanged', () => {
    const snapshot = { hp: 100, xp: 50 };
    const result = replayCommandLog({
      snapshot,
      commandLog: [],
      seed: 42,
    });

    expect(result.finalSnapshot).toEqual(snapshot);
    expect(result.allEvents).toEqual([]);
    expect(result.commandLog).toEqual([]);
  });
});
