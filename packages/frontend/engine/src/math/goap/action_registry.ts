// packages/frontend/engine/src/math/goap/action_registry.ts

// ---------------------------------------------------------------------------
// GOAP Action Registry — static action definitions with dual-mask evaluation
//
// Contract C-191: Actions are defined in a global static registry using
// dual 32-bit masks:
//   preconditionUsageMask  — which state bits matter for this action
//   preconditionValueMask  — what those bits must be (1 = set, 0 = clear)
//
// Evaluation:  (currentState & usageMask) === valueMask
// Application: newState = (currentState & ~effectClearMask) | effectSetMask
//
// All action definitions are immutable after initialization. Agents reference
// actions by numeric index into this registry.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default registry action IDs (shared constants)
//
// The default townsfolk registry (goap_scheduler_system.ts) assigns these
// numeric actionIds in order. Consumers that reference a specific action by
// index — e.g. the NPC spawner attaching a "Go to pub" movement goal — MUST
// use these constants, never a bare literal (CodeRabbit review, C-379).
// ---------------------------------------------------------------------------

/** Action ID of the default Idle action (cost 0, no preconditions). */
export const DEFAULT_ACTION_IDLE = 0;

/** Action ID of the default "Go to pub" movement action. */
export const DEFAULT_ACTION_GO_TO_PUB = 2;

/** Action ID of the default "Go to workplace" movement action. */
export const DEFAULT_ACTION_GO_TO_WORKPLACE = 4;

/** Action ID of the default "Pursue target" movement action. */
export const DEFAULT_ACTION_PURSUE_TARGET = 7;

/** Action ID of the default "Combat — move to range" movement action. */
export const DEFAULT_ACTION_COMBAT_MOVE = 10;

// ---------------------------------------------------------------------------
// StaticActionDefinition — single action in the registry
// ---------------------------------------------------------------------------

/**
 * A static action definition in the global GOAP action registry.
 *
 * Each action has a fixed cost, preconditions expressed as dual bitmasks,
 * and effects expressed as clear/set masks.
 */
export type StaticActionDefinition = {
  /** Unique numeric identifier for this action. */
  actionId: number;
  /** Base cost of executing this action (lower = preferred). */
  cost: number;
  /** Bitmask: which state bits are checked for this action's preconditions. */
  preconditionUsageMask: number;
  /** Bitmask: the required values of the checked bits (1 = must be set, 0 = must be clear). */
  preconditionValueMask: number;
  /** Bitmask: which state bits are cleared when this action executes. */
  effectClearMask: number;
  /** Bitmask: which state bits are set when this action executes. */
  effectSetMask: number;
};

// ---------------------------------------------------------------------------
// Action registry storage
// ---------------------------------------------------------------------------

/** Global registry of all GOAP actions. Initialized once, read-only thereafter. */
let _actionRegistry: StaticActionDefinition[] = [];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Initializes the global action registry with the given action definitions.
 *
 * Must be called once before any GOAP planning occurs. Subsequent calls
 * replace the existing registry.
 *
 * @param actions - Array of action definitions to register.
 */
export const initializeActionRegistry = (actions: StaticActionDefinition[]): void => {
  _actionRegistry = actions;
};

/**
 * Returns the current action registry (read-only reference).
 */
export const getActionRegistry = (): readonly StaticActionDefinition[] => _actionRegistry;

/**
 * Returns a single action definition by its numeric index.
 *
 * @param index - Action index in the registry.
 * @returns The action definition, or undefined if out of bounds.
 */
export const getActionByIndex = (index: number): StaticActionDefinition | undefined =>
  _actionRegistry[index];

/**
 * Clears the action registry.
 */
export const clearActionRegistry = (): void => {
  _actionRegistry = [];
};

// ---------------------------------------------------------------------------
// Scoring context — optional relationship/faction data for entity-aware scoring
// ---------------------------------------------------------------------------

/**
 * Relationship and faction data that influences GOAP action scoring.
 * Injected per-entity before stepping macro agents.
 * When absent, scoring falls back to the current relationship-agnostic behavior.
 *
 * Contract C-460: NPC Behavioral Autonomy Layer
 */
export type GoapActionScoringContext = {
  /** Relationship standing with the player (-100 to 100). */
  playerRelationship?: { standing: number; factionTier?: string };
  /** NPC's faction identifier (maps to Faction constants in faction_relations.ts). */
  npcFactionId?: string;
};

/**
 * Module-level map of entity ID to scoring context.
 * Set by the caller before stepping macro agents;
 * cleared after the tick completes.
 */
const _scoringContextMap = new Map<number, GoapActionScoringContext>();

/**
 * Sets the scoring context for a single entity.
 * Called by the macro simulation system before stepping.
 */
export const setEntityScoringContext = (eid: number, context: GoapActionScoringContext): void => {
  _scoringContextMap.set(eid, context);
};

/**
 * Removes the scoring context for a single entity.
 */
export const clearEntityScoringContext = (eid: number): void => {
  _scoringContextMap.delete(eid);
};

/**
 * Clears all scoring contexts (called between ticks or on teardown).
 */
export const clearAllScoringContexts = (): void => {
  _scoringContextMap.clear();
};

/**
 * Returns the scoring context for an entity, or undefined if none set.
 */
export const getEntityScoringContext = (eid: number): GoapActionScoringContext | undefined =>
  _scoringContextMap.get(eid);

// ---------------------------------------------------------------------------
// Plan evaluation functions (zero-allocation, pure)
// ---------------------------------------------------------------------------

/**
 * Checks whether an action's preconditions are satisfied by the current state.
 *
 * Uses the dual-mask evaluation pattern:
 *   `(currentState & usageMask) === valueMask`
 *
 * This is a single-cycle bitwise operation — zero heap allocations.
 *
 * @param currentState - The agent's current world state uint32.
 * @param action - The action to evaluate.
 * @returns `true` if preconditions are satisfied.
 */
export const evaluatePreconditions = (
  currentState: number,
  action: StaticActionDefinition,
): boolean => (currentState & action.preconditionUsageMask) === action.preconditionValueMask;

/**
 * Applies an action's effects to a world state, returning the new state.
 *
 * Effects are applied as:
 *   `newState = (currentState & ~clearMask) | setMask`
 *
 * Clear happens before set, so setMask bits take precedence if they overlap.
 *
 * @param currentState - The agent's current world state uint32.
 * @param action - The action whose effects to apply.
 * @returns The new world state after applying effects.
 */
export const applyEffects = (currentState: number, action: StaticActionDefinition): number =>
  (currentState & ~action.effectClearMask) | action.effectSetMask;

/**
 * Finds all actions whose preconditions are satisfied by the current state.
 *
 * Scans the entire registry and returns indices of matching actions.
 * Optionally filters by those that make progress toward a goal state.
 *
 * @param currentState - The agent's current world state uint32.
 * @returns Array of action indices with satisfied preconditions.
 */
export const findSatisfiedActions = (currentState: number): number[] => {
  const results: number[] = [];
  for (let i = 0; i < _actionRegistry.length; i++) {
    if (evaluatePreconditions(currentState, _actionRegistry[i])) {
      results.push(i);
    }
  }
  return results;
};

/**
 * Selects the best action from the registry that satisfies preconditions
 * and makes progress toward the given goal state.
 *
 * Progress is measured by how many goal bits the action's effects would
 * set that aren't already set in the current state (Hamming weight gain).
 * Ties are broken by lower action cost.
 *
 * @param currentState - The agent's current world state uint32.
 * @param goalMask - The target goal state uint32.
 * @returns The best matching action index, or -1 if no action matches.
 */
export const selectBestAction = (
  currentState: number,
  goalMask: number,
  entityId?: number,
): number => {
  const scoringContext = entityId !== undefined ? _scoringContextMap.get(entityId) : undefined;
  let bestIndex = -1;
  let bestScore = -1;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let i = 0; i < _actionRegistry.length; i++) {
    const action = _actionRegistry[i];
    if (!evaluatePreconditions(currentState, action)) {
      continue;
    }

    // Compute progress: bits that the action sets toward the goal
    const goalBitsSet = action.effectSetMask & goalMask;
    const alreadySet = currentState & goalBitsSet;
    const newBits = goalBitsSet & ~alreadySet;

    // Score: how many new goal bits this action sets
    const score = _popcount(newBits);

    // Apply relationship-based cost modifier if scoring context exists
    const effectiveCost = scoringContext
      ? _applyRelationshipCostModifier({
          actionId: action.actionId,
          cost: action.cost,
          scoringContext,
        })
      : action.cost;

    // Prefer higher score, then lower effective cost
    if (score > bestScore || (score === bestScore && effectiveCost < bestCost)) {
      bestScore = score;
      bestCost = effectiveCost;
      bestIndex = i;
    }
  }

  return bestIndex;
};

// ---------------------------------------------------------------------------
// Internal: relationship-based cost modifier
// ---------------------------------------------------------------------------

/**
 * Action IDs that are considered aggressive/avoidant — lower effective cost
 * for hostile NPCs (faction standing < 0).
 * Currently: action 6 (Flee), action 7 (Pursue target), action 10 (Combat move).
 */
const HOSTILE_BIAS_ACTION_IDS = new Set([6, 7, 10]);

/**
 * Action IDs that are considered social/approachable — lower effective cost
 * for friendly NPCs (faction standing > 0).
 * Currently: action 2 (Go to pub), action 3 (social interaction).
 */
const FRIENDLY_BIAS_ACTION_IDS = new Set([2, 3]);

/**
 * Maximum cost modifier applied for relationship-based scoring.
 * Kept small so it influences tie-breaking without overriding goal progress.
 */
const MAX_RELATIONSHIP_COST_MODIFIER = 3;

/**
 * Computes an effective cost for an action given the NPC's relationship
 * context. Hostile NPCs prefer aggressive/avoidant actions (lower cost);
 * friendly NPCs prefer social/approach actions (lower cost).
 *
 * The modifier is additive and proportional to relationship standing
 * magnitude, capped at MAX_RELATIONSHIP_COST_MODIFIER.
 *
 * @returns The effective cost after applying the relationship modifier.
 */
const _applyRelationshipCostModifier = (options: {
  actionId: number;
  cost: number;
  scoringContext: GoapActionScoringContext;
}): number => {
  const { actionId, cost, scoringContext } = options;
  const standing = scoringContext.playerRelationship?.standing ?? 0;

  if (standing === 0) {
    return cost;
  }

  // Normalize standing to -1..1 range (clamped to -100..100)
  const normalizedStanding = Math.max(-1, Math.min(1, standing / 100));

  // Hostile NPCs (standing < 0): prefer aggressive/avoidant actions
  if (standing < 0 && HOSTILE_BIAS_ACTION_IDS.has(actionId)) {
    const modifier = Math.round(Math.abs(normalizedStanding) * MAX_RELATIONSHIP_COST_MODIFIER);
    return Math.max(0, cost - modifier);
  }

  // Friendly NPCs (standing > 0): prefer social/approach actions
  if (standing > 0 && FRIENDLY_BIAS_ACTION_IDS.has(actionId)) {
    const modifier = Math.round(normalizedStanding * MAX_RELATIONSHIP_COST_MODIFIER);
    return Math.max(0, cost - modifier);
  }

  // No bias for this action — leave cost unchanged
  return cost;
};

// ---------------------------------------------------------------------------
// Internal: population count (Hamming weight)
// ---------------------------------------------------------------------------

/**
 * Counts the number of set bits in a 32-bit integer.
 *
 * Uses the standard SWAR (SIMD Within A Register) algorithm for fast
 * population count without hardware intrinsics.
 */
const _popcount = (n: number): number => {
  let v = n >>> 0; // Force unsigned
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
};
