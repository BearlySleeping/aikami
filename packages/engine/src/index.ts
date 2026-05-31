// apps/frontend/game/src/engine/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// Memory config (buffer constants and allocator)
export {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
  MAX_ENTITIES,
} from './config/memory_config.ts';
// EngineBridge (OOP contract — the sole UI↔Game boundary)
export type { EngineBridge } from './engine_bridge.ts';
export { createEngineBridge, MockEngineBridge } from './engine_bridge.ts';
// GameWorld (lifecycle manager)
export { GameWorld } from './game_world.ts';
export { createConfiguredAiClient, getConfiguredProvider } from './services/ai_config.ts';
export type { ItemData } from './services/ai_service.ts';
export { GameAiService } from './services/ai_service.ts';
export type { ActionResult, GameState, NpcData, PlayerAction } from './services/api_service.ts';
// Services
export { GameApiService } from './services/api_service.ts';
// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
} from './types.ts';
