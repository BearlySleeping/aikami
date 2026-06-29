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
export const getActionRegistry = (): readonly StaticActionDefinition[] => {
  return _actionRegistry;
};

/**
 * Returns a single action definition by its numeric index.
 *
 * @param index - Action index in the registry.
 * @returns The action definition, or undefined if out of bounds.
 */
export const getActionByIndex = (index: number): StaticActionDefinition | undefined => {
  return _actionRegistry[index];
};

/**
 * Clears the action registry.
 */
export const clearActionRegistry = (): void => {
  _actionRegistry = [];
};

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
): boolean => {
  return (currentState & action.preconditionUsageMask) === action.preconditionValueMask;
};

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
export const applyEffects = (currentState: number, action: StaticActionDefinition): number => {
  return (currentState & ~action.effectClearMask) | action.effectSetMask;
};

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
export const selectBestAction = (currentState: number, goalMask: number): number => {
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

    // Prefer higher score, then lower cost
    if (score > bestScore || (score === bestScore && action.cost < bestCost)) {
      bestScore = score;
      bestCost = action.cost;
      bestIndex = i;
    }
  }

  return bestIndex;
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
