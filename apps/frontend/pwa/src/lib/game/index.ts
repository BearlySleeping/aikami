// apps/frontend/pwa/src/lib/game/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports — consumed by ViewModels only
// ---------------------------------------------------------------------------

// EngineBridge (OOP contract — the sole UI↔Game boundary)
export type { EngineBridge } from './engine-bridge.ts';
export { createEngineBridge, MockEngineBridge } from './engine-bridge.ts';
// GameWorld (lifecycle manager — instantiated by GameViewModel)
export { GameWorld } from './game-world.ts';
// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
} from './types.ts';
