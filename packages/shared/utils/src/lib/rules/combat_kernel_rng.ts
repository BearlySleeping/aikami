// packages/shared/utils/src/lib/rules/combat_kernel_rng.ts
//
// The combat kernel's deterministic dice and RNG-stream helpers.
//
// A LEAF module: it imports only the seedable-RNG primitive and the combat wire
// types. Extracted from `combat_kernel.ts` so the kernel stays the command
// pipeline. Behaviour is unchanged — the same salts, the same substreams and
// the same dice parsing.
//
// Contract: C-509 AC-1, AC-5

import type { CombatRngState, CombatRngStreamKey } from '@aikami/types';
import { createSeedableRng, type SeedableRng, serializeRng } from '../rng/seedable_rng';

const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

/** Distinct salts keep the three named substreams independent on one seed. */
const STREAM_SALTS: Record<CombatRngStreamKey, number> = {
  initiative: 0x1f2e3d4c,
  actions: 0x2b3c4d5e,
  loot: 0x3c4d5e6f,
};

const deriveStreamSeed = (seed: number, salt: number): number =>
  (Math.imul(seed ^ salt, 0x85ebca6b) ^ salt) | 0;

/**
 * Structural clone of pure JSON combat data.
 *
 * `structuredClone` is available in Bun, Node ≥17, browsers and workers, and
 * is fully typed (`<T>(value: T) => T`) — no casting at this boundary. Clone
 * failures propagate so callers can fail without sharing the input reference.
 */

/** Total order on combatant ids — the deterministic initiative tiebreak. */
export const compareCombatantIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/**
 * d20 attack outcome. Natural 20 always hits, natural 1 always misses
 * (both by the rules, not by the clamping of the totals).
 */
export const resolveHit = (naturalRoll: number, totalRoll: number, armorClass: number): boolean => {
  if (naturalRoll === 20) {
    return true;
  }
  if (naturalRoll === 1) {
    return false;
  }
  return totalRoll >= armorClass;
};

export const createRngState = (seed: number): CombatRngState => ({
  seed,
  streams: {
    initiative: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.initiative))),
    actions: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.actions))),
    loot: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.loot))),
  },
});

export const rollDamage = (rng: SeedableRng, dice: string, isCritical: boolean): number => {
  const match = DAMAGE_DICE_PATTERN.exec(dice);
  if (match === null) {
    return 0;
  }
  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  const diceCount = isCritical ? count * 2 : count;
  let total = bonus;
  for (let index = 0; index < diceCount; index++) {
    total += rng.dice(sides);
  }
  return Math.max(0, total);
};
