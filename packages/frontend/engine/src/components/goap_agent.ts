// packages/frontend/engine/src/components/goap_agent.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// GoapAgent — bitmask-driven agent cognition state
//
// Contract C-191: Each agent carries a 32-bit currentState representing
// active world conditions, a currentGoal bitmask for the target objective,
// and a currentActionId pointer into the global static action registry.
//
// All state is stored as raw uint32 values for single-cycle bitwise evaluation.
// ---------------------------------------------------------------------------

/** SoA storage for GOAP agent state. */
export const GoapAgent = {
  /** Raw active world-state bits (uint32 bitmask). */
  currentState: [] as number[],
  /** Target objective bitmask the agent is working toward. */
  currentGoal: [] as number[],
  /** Index into the global static action registry for the current action, or -1 if idle. */
  currentActionId: [] as number[],
  /** The entity ID of the agent's current target, or 0 if none. */
  targetEntityId: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type GoapAgentData = {
  currentState: number;
  currentGoal: number;
  currentActionId: number;
  targetEntityId: number;
};

/**
 * Registers onSet and onGet observers for the GoapAgent component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerGoapAgentObservers = (world: World): void => {
  observe(world, onSet(GoapAgent), (eid: number, params: GoapAgentData) => {
    GoapAgent.currentState[eid] = params.currentState;
    GoapAgent.currentGoal[eid] = params.currentGoal;
    GoapAgent.currentActionId[eid] = params.currentActionId;
    GoapAgent.targetEntityId[eid] = params.targetEntityId;
  });

  observe(
    world,
    onGet(GoapAgent),
    (eid: number): GoapAgentData => ({
      currentState: GoapAgent.currentState[eid],
      currentGoal: GoapAgent.currentGoal[eid],
      currentActionId: GoapAgent.currentActionId[eid],
      targetEntityId: GoapAgent.targetEntityId[eid],
    }),
  );
};
