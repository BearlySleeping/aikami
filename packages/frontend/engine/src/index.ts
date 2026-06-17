// packages/frontend/engine/src/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// Base engine class (extend for engine-layer classes)
export {
  BaseEngineClass,
  type BaseEngineClassInterface,
  type BaseEngineClassOptions,
} from './base_engine_class.ts';
export {
  getCameraPosition,
  resetCameraTracking,
  setMapBounds,
  setScreenSize,
  updateCameraSystem,
} from './systems/camera_system.ts';
export {
  addItemStack,
  deductItem,
  hasItemCapacity,
  processTransaction,
  resetEconomyTracking,
} from './systems/economy_system.ts';
// Systems
export { resetMovementTracking, updateMovement } from './systems/movement_system.ts';
export {
  advanceTurn,
  endCombat,
  initCombat,
  resetTurnTracking,
} from './systems/turn_manager_system.ts';

// ECS components

export type { AppearanceData, LpcLayerRecipe } from './components/appearance.ts';
export {
  APPEARANCE_LAYER_COUNT,
  Appearance,
  EXPRESSION_MAP,
  FACE_LAYER_INDEX,
  getAppearanceLayers,
  registerAppearanceObservers,
} from './components/appearance.ts';
export { CameraFocus, registerCameraFocusObservers } from './components/camera_focus.ts';
export type { CombatStatsData } from './components/combat_stats.ts';
export { CombatStats, registerCombatStatsObservers } from './components/combat_stats.ts';
export type { InteractableData, InteractableType } from './components/interactable.ts';
export { Interactable, registerInteractableObservers } from './components/interactable.ts';
export type { InventoryData, WalletData } from './components/inventory.ts';
export {
  Inventory,
  MAX_INVENTORY_SLOTS,
  registerInventoryObservers,
  registerWalletObservers,
  Wallet,
} from './components/inventory.ts';
export type { NPCDialogData } from './components/npc_dialog.ts';
export { NPCDialog, registerNPCDialogObservers } from './components/npc_dialog.ts';
export type { PositionData } from './components/position.ts';
export { Position, registerPositionObservers } from './components/position.ts';
export type { SpriteData } from './components/sprite.ts';
export { registerSpriteObservers, Sprite } from './components/sprite.ts';
export type { TransitionData } from './components/transition.ts';
export { registerTransitionObservers, Transition } from './components/transition.ts';
export type { TurnOrderData } from './components/turn_order.ts';
export { registerTurnOrderObservers, TurnOrder } from './components/turn_order.ts';
export type { VelocityData } from './components/velocity.ts';
export { registerVelocityObservers, Velocity } from './components/velocity.ts';

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
export type { GameWorldInitializeOptions, GameWorldOptions, PlayerInitData } from './game_world.ts';
export { GameWorld } from './game_world.ts';
export { createConfiguredAiClient, getConfiguredProvider } from './services/ai_config.ts';
export type { ItemData } from './services/ai_service.ts';
export { GameAiService } from './services/ai_service.ts';
export type { ActionResult, GameState, NpcData, PlayerAction } from './services/api_service.ts';
// Services
export { GameApiService } from './services/api_service.ts';

// Serialization

export { deserializeWorld, serializeWorld } from './serialization/ecs_serializer.ts';

// Rendering

// Entity spawner (C-136)
export { resolveNpcTexture, resolvePropTexture } from './assets/lpc_asset_catalog.ts';
// Tilemap & collision (C-135)
export type {
  ObjectLayer,
  SpawnPoint,
  TilemapData,
  TilemapLayer,
  TilemapTileset,
  TransitionZone,
} from './assets/map_loader.ts';
export {
  clearMapCache,
  extractCollisionGrid,
  extractSpawnPoints,
  extractTransitionZones,
  loadTilemap,
} from './assets/map_loader.ts';
export type { PixiAppDebugMetrics, PixiAppInstance, PixiAppOptions } from './pixi_app.ts';
export { createPixiApp } from './pixi_app.ts';
export {
  AnimationController,
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from './rendering/animation_controller.ts';
export type { PaletteSpriteOptions } from './rendering/sprite_composer.ts';
export {
  initLpcShaders,
  packRecipeToUboBuffer,
  SpriteComposer,
} from './rendering/sprite_composer.ts';
export type { TextureManagerConfig } from './rendering/texture_manager.ts';
export { TextureManager } from './rendering/texture_manager.ts';
// State (engine-level mode gate)
export { getEngineGameMode, setEngineGameMode } from './state/game_mode.ts';
export type { CollisionGrid } from './systems/collision_system.ts';
export { isWalkable, resetCollisionGrid, setCollisionGrid } from './systems/collision_system.ts';
export type {
  SpawnEntitiesOptions,
  SpawnResult,
  SpawnTransitionOptions,
} from './systems/entity_spawner.ts';
export { spawnEntities, spawnTransitionEntities } from './systems/entity_spawner.ts';
export { handleInteract } from './systems/interaction_system.ts';
export type { RenderEntry } from './systems/render_system.ts';
export {
  animateEntitySystem,
  dirtyCheckAppearance,
  getEntityAnimationFrame,
  hasAppearanceChanged,
  invalidateComposedSprite,
  LpcBatchManager,
  resetAnimationTracking,
  resetAppearanceTracking,
  syncAppearanceSystem,
  toCellDisplayPosition,
  toGridCellCenter,
  updateEntityUbo,
  updateRender,
  updateRenderFromBuffer,
} from './systems/render_system.ts';
export type { TilemapRenderOptions, TilemapRenderResult } from './systems/tilemap_render_system.ts';
export { renderTilemap } from './systems/tilemap_render_system.ts';
export { updateZoningSystem } from './systems/zoning_system.ts';

// Types (plain serializable — safe for UI consumption)
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
  QuestData,
  QuestObjectiveData,
  QuestStatus,
} from './types.ts';
