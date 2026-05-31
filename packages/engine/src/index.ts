// packages/engine/src/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// ECS components

export {
  Appearance,
  APPEARANCE_LAYER_COUNT,
  EXPRESSION_MAP,
  FACE_LAYER_INDEX,
  getAppearanceLayers,
  registerAppearanceObservers,
} from './components/appearance.ts';
export type { AppearanceData } from './components/appearance.ts';
export { NPCDialog, registerNPCDialogObservers } from './components/npc_dialog.ts';
export type { NPCDialogData } from './components/npc_dialog.ts';
export { Position, registerPositionObservers } from './components/position.ts';
export type { PositionData } from './components/position.ts';
export { registerSpriteObservers, Sprite } from './components/sprite.ts';
export type { SpriteData } from './components/sprite.ts';
export { registerVelocityObservers, Velocity } from './components/velocity.ts';
export type { VelocityData } from './components/velocity.ts';

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
// Rendering

export type { RenderEntry } from './systems/render_system.ts';
export { dirtyCheckAppearance, invalidateComposedSprite, updateRender, updateRenderFromBuffer } from './systems/render_system.ts';
export { SpriteComposer } from './rendering/sprite_composer.ts';
export { TextureManager } from './rendering/texture_manager.ts';
export type { TextureManagerConfig } from './rendering/texture_manager.ts';

// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
} from './types.ts';
