// packages/frontend/engine/src/math/goap/world_state_bits.ts

// biome-ignore-all lint/style/useNamingConvention: PascalCase bit flag constants follow the established GOAP enum pattern used throughout the engine
// ---------------------------------------------------------------------------
// WorldStateBit — immutable bit allocation for agent world-state conditions
//
// Contract C-191: Up to 32 world-state conditions mapped to individual bits
// in a uint32. Agents carry a single currentState uint32 representing all
// active conditions. Actions evaluate preconditions via bitwise AND and
// apply effects via clear/set masks.
//
// Bits are powers of 2. New conditions MUST be added at the end to preserve
// existing bit allocations. Never exceed 32 bits total.
// ---------------------------------------------------------------------------

/** Immutable bit placements for agent world-state representation. */
export const WorldStateBit = {
  /** Agent is hungry and needs food. */
  IsHungry: 1 << 0,
  /** Agent has money/currency available. */
  HasMoney: 1 << 1,
  /** Agent is at a pub/tavern location. */
  AtPub: 1 << 2,
  /** Agent is tired and needs rest. */
  IsTired: 1 << 3,
  /** Agent has tools/equipment available. */
  HasTools: 1 << 4,
  /** Agent is at their workplace. */
  AtWorkplace: 1 << 5,
  /** Agent is in a hostile/combat state. */
  IsHostile: 1 << 6,
  /** Agent has witnessed a crime event. */
  HasWitnessedCrime: 1 << 7,
  /** Agent is fleeing from danger. */
  IsFleeing: 1 << 8,
  /** Agent has a target entity to pursue. */
  HasTarget: 1 << 9,
  /** Agent is patrolling. */
  IsPatrolling: 1 << 10,
  /** Agent is guarding a location. */
  IsGuarding: 1 << 11,
  /** Agent needs healing/medical attention. */
  NeedsHealing: 1 << 12,
  /** Agent has consumed food/drink. */
  HasEaten: 1 << 13,
  /** Agent has completed their current task. */
  TaskComplete: 1 << 14,
  /** Agent is in an active combat encounter. */
  InCombat: 1 << 15,
  /** Agent is within preferred attack range of the target. */
  IsInRange: 1 << 16,
  /** Agent health is below a critical threshold. */
  LowHealth: 1 << 17,
  /** Agent has a positional tactical advantage (flanking, high ground). */
  HasAdvantage: 1 << 18,
  /** Agent's current target has low remaining HP. */
  TargetIsWeak: 1 << 19,
  /** Agent is holding a defensive position (guard stance). */
  IsHolding: 1 << 20,
} as const;

/** Type for world state bit values. */
export type WorldStateBit = (typeof WorldStateBit)[keyof typeof WorldStateBit];

/** Number of defined state bits (must not exceed 32). */
export const WORLD_STATE_BIT_COUNT = Object.keys(WorldStateBit).length;
