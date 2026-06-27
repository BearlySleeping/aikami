// packages/frontend/engine/src/components/engine_state.ts

import type { World } from 'bitecs';
import { addComponent, addEntity, observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// EngineState — singleton component for simulation lifecycle control
//
// Contract C-172: A single entity holds the simulation state. Core systems
// (movement, interaction, AI, zoning) check this component and return early
// when the state is TRANSITIONING, ensuring the main ECS world is not mutated
// during map transitions.
//
// Values:
//   ACTIVE (0)        — Normal gameplay. All systems run.
//   TRANSITIONING (1) — Map transition in progress. Systems pause.
// ---------------------------------------------------------------------------

/** Simulation lifecycle states. */
export const SimulationState = {
  active: 0,
  transitioning: 1,
} as const;

/** Type alias for SimulationState values. */
export type SimulationState = (typeof SimulationState)[keyof typeof SimulationState];

/** SoA storage for the engine state. Index 0 is the conventional singleton slot. */
export const EngineState = {
  /** Current simulation state: 0 = active, 1 = transitioning. */
  state: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type EngineStateData = {
  state: number;
};

/** The entity ID assigned to the EngineState singleton. Set during initialization. */
let _engineStateEntityId = 0;

/**
 * Returns the entity ID of the EngineState singleton.
 *
 * @returns The singleton entity ID, or 0 if not yet initialized.
 */
export const getEngineStateEntityId = (): number => {
  return _engineStateEntityId;
};

/**
 * Creates the EngineState singleton entity in the given world.
 *
 * Must be called once during world initialization. Subsequent calls
 * are no-ops if the singleton already exists.
 *
 * @param world - The bitECS world.
 */
export const createEngineStateEntity = (world: World): void => {
  if (_engineStateEntityId > 0) {
    return;
  }

  _engineStateEntityId = addEntity(world);
  addComponent(world, _engineStateEntityId, EngineState);
  EngineState.state[_engineStateEntityId] = SimulationState.active;
};

/**
 * Sets the simulation state on the EngineState singleton.
 *
 * @param world - The bitECS world.
 * @param newState - The target simulation state.
 */
export const setSimulationState = (_world: World, newState: SimulationState): void => {
  if (_engineStateEntityId === 0) {
    return;
  }
  EngineState.state[_engineStateEntityId] = newState;
};

/**
 * Returns the current simulation state.
 *
 * @returns ACTIVE (0), TRANSITIONING (1), or -1 if not initialized.
 */
export const getSimulationState = (): number => {
  if (_engineStateEntityId === 0) {
    return -1;
  }
  return EngineState.state[_engineStateEntityId] ?? SimulationState.active;
};

/**
 * Returns true when the simulation is in ACTIVE state (systems should run).
 *
 * Defaults to `true` when the EngineState singleton has not been created
 * (test environments without full engine initialization).
 */
export const isSimulationActive = (): boolean => {
  return getSimulationState() !== SimulationState.transitioning;
};

/**
 * Registers onSet and onGet observers for the EngineState component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerEngineStateObservers = (world: World): void => {
  observe(world, onSet(EngineState), (eid: number, params: EngineStateData) => {
    EngineState.state[eid] = params.state;
  });

  observe(
    world,
    onGet(EngineState),
    (eid: number): EngineStateData => ({
      state: EngineState.state[eid],
    }),
  );
};
