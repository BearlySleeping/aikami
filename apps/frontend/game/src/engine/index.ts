// apps/frontend/game/src/engine/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// EngineBridge (OOP contract — the sole UI↔Game boundary)
export type { EngineBridge } from './engine_bridge.ts';
export { createEngineBridge, MockEngineBridge } from './engine_bridge.ts';
// GameWorld (lifecycle manager)
export { GameWorld } from './game_world.ts';
// Services
export { GameApiService } from './services/api_service.ts';
export { GameAiService } from './services/ai_service.ts';
export { createConfiguredAiClient, getConfiguredProvider } from './services/ai_config.ts';
export type { NpcData, PlayerAction, ActionResult, GameState } from './services/api_service.ts';
export type { ItemData } from './services/ai_service.ts';
// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
} from './types.ts';
