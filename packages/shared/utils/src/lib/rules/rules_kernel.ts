// packages/shared/utils/src/lib/rules/rules_kernel.ts
//
// Pure-function deterministic rules kernel.
// Takes a mechanical snapshot, a rules command, and a seedable RNG,
// returns a new snapshot + events. No side effects, no I/O, no
// imports from engine or client packages.
//
// Contract: C-336 AC-3

import type { RulesCommand, RulesEvent } from '@aikami/types';
import type { SeedableRng } from '../rng/seedable_rng';
import { createSeedableRng } from '../rng/seedable_rng';

// ---------------------------------------------------------------------------
// Damage dice parser
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

/**
 * Parses a damage dice string like "1d6+2" into its components.
 */
const parseDamageDice = (notation: string): { count: number; sides: number; bonus: number } => {
  const match = notation.match(DAMAGE_DICE_PATTERN);
  if (!match) {
    return { count: 0, sides: 0, bonus: 0 };
  }
  return {
    count: Number.parseInt(match[1], 10),
    sides: Number.parseInt(match[2], 10),
    bonus: match[3] ? Number.parseInt(match[3], 10) : 0,
  };
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Clamp a number between min and max. */
const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

/** Roll a single d20, with optional advantage/disadvantage. */
const rollD20 = (rng: SeedableRng, advantage: boolean, disadvantage: boolean): number => {
  // Per D&D 5e rules, advantage and disadvantage cancel
  if (advantage && disadvantage) {
    return rng.dice(20);
  }
  if (advantage) {
    const roll1 = rng.dice(20);
    const roll2 = rng.dice(20);
    return Math.max(roll1, roll2);
  }
  if (disadvantage) {
    const roll1 = rng.dice(20);
    const roll2 = rng.dice(20);
    return Math.min(roll1, roll2);
  }
  return rng.dice(20);
};

// ---------------------------------------------------------------------------
// Command resolvers — one per command variant
// ---------------------------------------------------------------------------

const resolveSkillCheck = (
  command: Extract<RulesCommand, { kind: 'rollSkillCheck' }>,
  rng: SeedableRng,
): { events: RulesEvent[] } => {
  const naturalRoll = rollD20(rng, command.advantage, false);
  const totalRoll = naturalRoll + command.abilityModifier + command.proficiencyBonus;
  const success = totalRoll >= command.difficultyClass;
  const isCriticalSuccess = naturalRoll === 20;
  const isCriticalFailure = naturalRoll === 1;

  return {
    events: [
      {
        kind: 'skillCheckResolved',
        naturalRoll,
        totalRoll,
        success,
        isCriticalSuccess,
        isCriticalFailure,
      },
    ],
  };
};

const resolveAttack = (
  command: Extract<RulesCommand, { kind: 'rollAttack' }>,
  rng: SeedableRng,
): { events: RulesEvent[] } => {
  // advantage + disadvantage = normal roll (per D&D 5e)
  const naturalRoll = rollD20(rng, command.advantage, command.disadvantage);
  const totalRoll = naturalRoll + command.attackBonus;
  const hit = totalRoll >= command.targetArmorClass;
  const isCriticalHit = naturalRoll === 20;

  return {
    events: [
      {
        kind: 'attackResolved',
        naturalRoll,
        totalRoll,
        hit,
        isCriticalHit,
      },
    ],
  };
};

const resolveDamage = (
  command: Extract<RulesCommand, { kind: 'rollDamage' }>,
  rng: SeedableRng,
): { events: RulesEvent[] } => {
  const { count, sides } = parseDamageDice(command.damageDice);

  // Critical hits double the dice count
  const diceCount = command.isCritical ? count * 2 : count;

  let naturalDamage = 0;
  for (let i = 0; i < diceCount; i++) {
    naturalDamage += rng.dice(sides);
  }

  // rollDamage only computes dice outcome; no event emitted here.
  // The damageResolved event is emitted by applyDamage with actual HP state.
  return {
    events: [],
  };
};

const resolveApplyDamage = (
  command: Extract<RulesCommand, { kind: 'applyDamage' }>,
  snapshot: Record<string, unknown>,
): { newSnapshot: Record<string, unknown>; events: RulesEvent[] } => {
  const hpAfter = clamp(command.targetCurrentHp - command.amount, 0, command.targetMaxHp);
  const isDefeated = hpAfter <= 0;

  return {
    newSnapshot: { ...snapshot, targetHpAfter: hpAfter, isDefeated },
    events: [
      {
        kind: 'damageResolved',
        naturalDamage: command.amount,
        totalDamage: command.amount,
        targetHpAfter: hpAfter,
        isDefeated,
      },
    ],
  };
};

const resolveApplyHealing = (
  command: Extract<RulesCommand, { kind: 'applyHealing' }>,
  snapshot: Record<string, unknown>,
): { newSnapshot: Record<string, unknown>; events: RulesEvent[] } => {
  const hpAfter = clamp(command.targetCurrentHp + command.amount, 0, command.targetMaxHp);
  const amountHealed = hpAfter - command.targetCurrentHp;

  return {
    newSnapshot: { ...snapshot, targetHpAfter: hpAfter, amountHealed },
    events: [
      {
        kind: 'healingResolved',
        amountHealed,
        targetHpAfter: hpAfter,
      },
    ],
  };
};

const resolveGrantXp = (
  command: Extract<RulesCommand, { kind: 'grantXp' }>,
  snapshot: Record<string, unknown>,
): { newSnapshot: Record<string, unknown>; events: RulesEvent[] } => {
  const xpAfter = command.currentXp + command.amount;
  const leveledUp = xpAfter >= command.xpToNextLevel;
  const newLevel = leveledUp ? command.currentLevel + 1 : null;

  return {
    newSnapshot: { ...snapshot, xpAfter, leveledUp, newLevel },
    events: [
      {
        kind: 'xpGranted',
        xpAfter,
        leveledUp,
        newLevel,
      },
    ],
  };
};

const resolveRollLoot = (
  command: Extract<RulesCommand, { kind: 'rollLoot' }>,
  rng: SeedableRng,
): { events: RulesEvent[] } => {
  const items: Array<{ itemId: string; quantity: number }> = [];

  for (const entry of command.lootTable) {
    const roll = rng.next();
    if (roll < entry.dropChance) {
      items.push({ itemId: entry.itemId, quantity: entry.quantity });
    }
  }

  return {
    events: [
      {
        kind: 'lootGenerated',
        items,
      },
    ],
  };
};

const resolveRelationshipDelta = (
  command: Extract<RulesCommand, { kind: 'applyRelationshipDelta' }>,
  snapshot: Record<string, unknown>,
): { newSnapshot: Record<string, unknown>; events: RulesEvent[] } => {
  const trustAfter = clamp(command.currentTrust + command.trustDelta, -100, 100);
  const affinityAfter = clamp(command.currentAffinity + command.affinityDelta, -100, 100);

  return {
    newSnapshot: { ...snapshot, trustAfter, affinityAfter },
    events: [
      {
        kind: 'relationshipUpdated',
        trustAfter,
        affinityAfter,
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type CommandResolver = (
  command: RulesCommand,
  snapshot: Record<string, unknown>,
  rng: SeedableRng,
) => { newSnapshot: Record<string, unknown>; events: RulesEvent[] };

const RESOLVERS: Record<RulesCommand['kind'], CommandResolver> = {
  rollSkillCheck: (cmd, snap, rng) => {
    const { events } = resolveSkillCheck(
      cmd as Extract<RulesCommand, { kind: 'rollSkillCheck' }>,
      rng,
    );
    return { newSnapshot: { ...snap }, events };
  },
  rollAttack: (cmd, snap, rng) => {
    const { events } = resolveAttack(cmd as Extract<RulesCommand, { kind: 'rollAttack' }>, rng);
    return { newSnapshot: { ...snap }, events };
  },
  rollDamage: (cmd, snap, rng) => {
    const { events } = resolveDamage(cmd as Extract<RulesCommand, { kind: 'rollDamage' }>, rng);
    return { newSnapshot: { ...snap }, events };
  },
  applyDamage: (cmd, snap, _rng) => {
    return resolveApplyDamage(cmd as Extract<RulesCommand, { kind: 'applyDamage' }>, snap);
  },
  applyHealing: (cmd, snap, _rng) => {
    return resolveApplyHealing(cmd as Extract<RulesCommand, { kind: 'applyHealing' }>, snap);
  },
  grantXp: (cmd, snap, _rng) => {
    return resolveGrantXp(cmd as Extract<RulesCommand, { kind: 'grantXp' }>, snap);
  },
  rollLoot: (cmd, snap, rng) => {
    const { events } = resolveRollLoot(cmd as Extract<RulesCommand, { kind: 'rollLoot' }>, rng);
    return { newSnapshot: { ...snap }, events };
  },
  applyRelationshipDelta: (cmd, snap, _rng) => {
    return resolveRelationshipDelta(
      cmd as Extract<RulesCommand, { kind: 'applyRelationshipDelta' }>,
      snap,
    );
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a single rules command against a mechanical snapshot using
 * a deterministic PRNG. Pure function — no side effects, no I/O.
 *
 * @param snapshot - The current mechanical state ({@link Record<string, unknown>}).
 * @param command - A validated {@link RulesCommand} to resolve.
 * @param rng - A {@link SeedableRng} instance for deterministic dice rolls.
 * @returns The new snapshot and emitted events. The input snapshot is NOT mutated.
 */
export const resolveCommand = (options: {
  snapshot: Record<string, unknown>;
  command: RulesCommand;
  rng: SeedableRng;
}): { newSnapshot: Record<string, unknown>; events: RulesEvent[] } => {
  const resolver = RESOLVERS[options.command.kind];
  if (!resolver) {
    throw new Error(`Unknown rules command kind: ${(options.command as { kind: string }).kind}`);
  }
  return resolver(options.command, options.snapshot, options.rng);
};

/**
 * Replays a command log against a snapshot using a deterministic seed.
 * Each command sees the state updated by the previous one — the RNG
 * advances through the whole sequence.
 *
 * @param snapshot - The initial mechanical state.
 * @param commandLog - An ordered array of {@link RulesCommand}s to replay.
 * @param seed - The campaign seed for RNG initialization.
 * @returns The final snapshot, all events, and the serializable command log.
 */
export const replayCommandLog = (options: {
  snapshot: Record<string, unknown>;
  commandLog: RulesCommand[];
  seed: number;
}): {
  finalSnapshot: Record<string, unknown>;
  allEvents: Array<{ index: number; command: RulesCommand; events: RulesEvent[] }>;
  commandLog: Array<{ index: number; commandKind: string }>;
} => {
  const rng = createSeedableRng(options.seed);
  let snapshot = { ...options.snapshot };
  const allEvents: Array<{ index: number; command: RulesCommand; events: RulesEvent[] }> = [];
  const log: Array<{ index: number; commandKind: string }> = [];

  for (let i = 0; i < options.commandLog.length; i++) {
    const command = options.commandLog[i];
    const result = resolveCommand({ snapshot, command, rng });
    snapshot = result.newSnapshot;
    allEvents.push({ index: i, command, events: result.events });
    log.push({ index: i, commandKind: command.kind });
  }

  return {
    finalSnapshot: snapshot,
    allEvents,
    commandLog: log,
  };
};

/**
 * Creates a mechanical snapshot for the replay artifact (AC-5).
 * Captures the seed + command log + final state for CI gating.
 *
 * @param finalState - The mechanical state after all commands.
 * @param seed - The campaign seed used for RNG.
 * @param commandLog - The ordered command log entries.
 * @returns A serializable {@link MechanicalSnapshot}.
 */
export const createMechanicalSnapshot = (options: {
  finalState: Record<string, unknown>;
  seed: number;
  commandLog: Array<{ index: number; commandKind: string }>;
}): {
  version: number;
  seed: number;
  commandLog: Array<{ index: number; commandKind: string }>;
  finalState: Record<string, unknown>;
} => {
  return {
    version: 1,
    seed: options.seed,
    commandLog: options.commandLog,
    finalState: options.finalState,
  };
};
