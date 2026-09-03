// packages/frontend/engine/src/math/goap/index.ts

// ---------------------------------------------------------------------------
// GOAP math — bitmask planning, action registry, faction relations
//
// Contract C-191: Exports world state bit definitions, dual-mask action
// evaluation, and faction relation graph primitives.
// ---------------------------------------------------------------------------

export type { GoapActionScoringContext, StaticActionDefinition } from './action_registry.ts';
export {
  applyEffects,
  clearActionRegistry,
  clearAllScoringContexts,
  clearEntityScoringContext,
  evaluatePreconditions,
  findSatisfiedActions,
  getActionByIndex,
  getActionRegistry,
  getEntityScoringContext,
  initializeActionRegistry,
  selectBestAction,
  setEntityScoringContext,
} from './action_registry.ts';

export { Faction, IsHostileTo, IsMemberOf, IsProtectorOf } from './faction_relations.ts';
export type { WorldStateBit as WorldStateBitType } from './world_state_bits.ts';
export { WORLD_STATE_BIT_COUNT, WorldStateBit } from './world_state_bits.ts';
