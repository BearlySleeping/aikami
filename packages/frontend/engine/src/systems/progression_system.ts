// packages/frontend/engine/src/systems/progression_system.ts
//
// Class-aware character progression system. Replaces the hardcoded
// level-up logic in turn_manager_system.ts with table-driven feature
// resolution keyed off the player's class definition.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import { CLASS_REGISTRY, XP_THRESHOLDS } from '@aikami/constants';
import type { ClassDefinition, ClassFeature } from '@aikami/types';
import type { World } from 'bitecs';
import { getComponent } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// XP Threshold Lookup
// ---------------------------------------------------------------------------

/**
 * Returns the XP threshold to reach the given level.
 * Falls back to a computed threshold for levels beyond the defined table.
 */
const _getXpThreshold = (level: number): number => {
  const key = String(level);
  if (key in XP_THRESHOLDS) {
    return XP_THRESHOLDS[key];
  }
  // Fallback for levels beyond the defined table
  return Math.floor(300 * 1.7 ** (level - 2));
};

/**
 * Checks whether the given XP total is sufficient to reach the next level.
 *
 * @returns The new level if leveled up, or null if no level-up.
 */
export const checkLevelUp = (options: {
  currentLevel: number;
  currentXp: number;
}): number | null => {
  const nextLevelThreshold = _getXpThreshold(options.currentLevel + 1);
  if (options.currentXp >= nextLevelThreshold && nextLevelThreshold > 0) {
    return options.currentLevel + 1;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Feature Lookup
// ---------------------------------------------------------------------------

/**
 * Resolves all features granted at a specific class level.
 * Includes base class features and subclass features from the auto-assigned subclass.
 *
 * @returns Array of feature IDs granted at this level (empty array if none).
 */
export const resolveLevelFeatures = (options: { classId: string; level: number }): string[] => {
  const classDef: ClassDefinition | undefined = (CLASS_REGISTRY as Record<string, ClassDefinition>)[
    options.classId
  ];
  if (!classDef) {
    return [];
  }

  const features: string[] = [];

  // Base class features at this level
  const levelKey = String(options.level);
  const levelFeatures: ClassFeature[] | undefined = classDef.features[levelKey];
  if (levelFeatures) {
    for (const feature of levelFeatures) {
      features.push(feature.id);
    }
  }

  // Auto-assigned subclass features (first subclass for the class)
  const subclass = classDef.subclasses[0];
  if (subclass && subclass.features[levelKey]) {
    for (const feature of subclass.features[levelKey]) {
      features.push(feature.id);
    }
  }

  return features;
};

/**
 * Resolves class-dependent HP gain per level from the class definition.
 * Falls back to a simple +6 HP if the class is not found or stat is missing.
 */
export const resolveHpPerLevel = (classId: string): number => {
  const classDef: ClassDefinition | undefined = (CLASS_REGISTRY as Record<string, ClassDefinition>)[
    classId
  ];
  return classDef?.hpPerLevel ?? 6;
};

// ---------------------------------------------------------------------------
// XP Grant + Level-Up Resolution (ECS integration)
// ---------------------------------------------------------------------------

/**
 * Grants XP to the player entity and handles level-up sequentially.
 *
 * Handles multi-level jumps: each level-up processes sequentially,
 * deducting the threshold XP and carrying the remainder forward.
 * Features from each intermediate level are emitted via bridge events.
 *
 * Stat changes follow the existing convention:
 * - HP increase: class-dependent hpPerLevel (default +6)
 * - Attack increase: +2 per level
 * - Defense increase: +2 per level
 * - Full heal on level-up
 *
 * @param world - The bitECS world.
 * @param playerEid - The player entity ID.
 * @param amount - Amount of XP to grant.
 * @param bridge - The EngineBridge for emitting events.
 * @param classId - Optional class ID for class-aware progression.
 */
export const grantXp = (
  world: World,
  playerEid: number,
  amount: number,
  bridge: EngineBridge,
  classId?: string,
): void => {
  const stats = getComponent(world, playerEid, CombatStats) as CombatStatsData | undefined;
  if (!stats) {
    return;
  }

  const effectiveClassId = classId || 'fighter';
  let xp = (stats.xp ?? 0) + amount;
  let level = stats.level ?? 1;
  let maxHp = stats.maxHealth ?? 100;
  let attack = stats.attack ?? 5;
  let defense = stats.defense ?? 12;
  const hpPerLevel = resolveHpPerLevel(effectiveClassId);

  // Use stored xpToNextLevel if set, fall back to XP_THRESHOLDS
  let nextThreshold = stats.xpToNextLevel ?? _getXpThreshold(level + 1);
  if (nextThreshold <= 0) {
    nextThreshold = _getXpThreshold(level + 1);
  }

  // Sequential level-up loop — handles multi-level jumps
  while (xp >= nextThreshold && nextThreshold > 0) {
    // Deduct threshold XP (carry remainder forward)
    xp -= nextThreshold;
    level += 1;

    // Resolve features for the new level
    const featuresUnlocked = resolveLevelFeatures({ classId: effectiveClassId, level });

    // Apply stat gains
    maxHp += hpPerLevel;
    attack += 2;
    defense += 2;

    // Compute next threshold: scale from current, or use XP_THRESHOLDS fallback
    const tableThreshold = _getXpThreshold(level + 1);
    nextThreshold = tableThreshold > 0 ? tableThreshold : Math.floor(nextThreshold * 1.5);

    // Emit the level-up event
    bridge.emit({
      type: 'PLAYER_LEVELED_UP',
      newLevel: level,
      maxHp,
      attack,
      defense,
      xpToNextLevel: nextThreshold,
      featuresUnlocked,
    });
  }

  // Apply the results to the ECS world
  CombatStats.xp[playerEid] = xp;
  CombatStats.level[playerEid] = level;
  CombatStats.xpToNextLevel[playerEid] = nextThreshold;
  CombatStats.maxHealth[playerEid] = maxHp;
  CombatStats.health[playerEid] = maxHp; // Full heal on level-up
  CombatStats.attack[playerEid] = attack;
  CombatStats.defense[playerEid] = defense;
};
