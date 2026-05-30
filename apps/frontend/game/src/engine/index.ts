// apps/frontend/game/src/engine/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// EngineBridge (OOP contract — the sole UI↔Game boundary)
export type { EngineBridge } from './engine-bridge.ts';
export { createEngineBridge, MockEngineBridge } from './engine-bridge.ts';
// GameWorld (lifecycle manager)
export { GameWorld } from './game-world.ts';
// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
} from './types.ts';
