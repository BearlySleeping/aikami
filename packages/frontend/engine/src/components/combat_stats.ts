// packages/frontend/engine/src/components/combat_stats.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CombatStats — SoA component for entity combat attributes
// ---------------------------------------------------------------------------

/** SoA storage for combat-relevant statistics. Indexed by entity ID. */
export const CombatStats = {
  health: [] as number[],
  maxHealth: [] as number[],
  initiative: [] as number[],
  /** Base physical attack damage. */
  attack: [] as number[],
  /** Physical defense (reduces incoming damage). */
  defense: [] as number[],
  /** Hit chance modifier (added to d20 roll). */
  accuracy: [] as number[],
  /** Evasion target number (attacker must meet or exceed this). */
  evasion: [] as number[],
  /** Experience points accumulated from combat victories. */
  xp: [] as number[],
  /** Current character level. */
  level: [] as number[],
  /** XP threshold required to reach the next level. */
  xpToNextLevel: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CombatStatsData = {
  health: number;
  maxHealth: number;
  initiative: number;
  attack: number;
  defense: number;
  accuracy: number;
  evasion: number;
  xp: number;
  level: number;
  xpToNextLevel: number;
};

/**
 * Registers onSet and onGet observers for the CombatStats component on the
 * given world. Must be called once per world before any entity uses CombatStats.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCombatStatsObservers = (world: World): void => {
  observe(world, onSet(CombatStats), (eid: number, params: CombatStatsData) => {
    CombatStats.health[eid] = params.health;
    CombatStats.maxHealth[eid] = params.maxHealth;
    CombatStats.initiative[eid] = params.initiative;
    CombatStats.attack[eid] = params.attack;
    CombatStats.defense[eid] = params.defense;
    CombatStats.accuracy[eid] = params.accuracy;
    CombatStats.evasion[eid] = params.evasion;
    CombatStats.xp[eid] = params.xp;
    CombatStats.level[eid] = params.level;
    CombatStats.xpToNextLevel[eid] = params.xpToNextLevel;
  });

  observe(
    world,
    onGet(CombatStats),
    (eid: number): CombatStatsData => ({
      health: CombatStats.health[eid],
      maxHealth: CombatStats.maxHealth[eid],
      initiative: CombatStats.initiative[eid],
      attack: CombatStats.attack[eid],
      defense: CombatStats.defense[eid],
      accuracy: CombatStats.accuracy[eid],
      evasion: CombatStats.evasion[eid],
      xp: CombatStats.xp[eid],
      level: CombatStats.level[eid],
      xpToNextLevel: CombatStats.xpToNextLevel[eid],
    }),
  );
};
