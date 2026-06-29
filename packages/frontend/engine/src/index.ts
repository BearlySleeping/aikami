// packages/frontend/engine/src/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// Core

// Base engine class (extend for engine-layer classes)
export {
  BaseEngineClass,
  type BaseEngineClassInterface,
  type BaseEngineClassOptions,
} from './base_engine_class.ts';
export {
  createSafeRef,
  EntityGeneration,
  extractEidFromRef,
  extractGenerationFromRef,
  incrementEntityGeneration,
  resetEntityGenerations,
  resolveSafeRef,
} from './core/entity_reference.ts';
// Entity factories
export {
  createDefaultSandboxAvatar,
  SANDBOX_LAYER_BEARD,
  SANDBOX_LAYER_BODY,
  SANDBOX_LAYER_FEET,
  SANDBOX_LAYER_HAIR,
  SANDBOX_LAYER_HEAD,
  SANDBOX_LAYER_LEGS,
  SANDBOX_LAYER_TORSO,
  SANDBOX_NPC_LAYERS,
  SANDBOX_PLAYER_LAYERS,
} from './entities/create_sandbox_avatar.ts';
export {
  endDialogueZoom,
  getActiveNpcScreenPosition,
  getCameraPosition,
  getCameraZoom,
  resetCameraTracking,
  setMapBounds,
  setScreenSize,
  startDialogueZoom,
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
  handleCombatAction,
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
export type { ChunkDataPayload } from './components/chunk_data.ts';
export {
  CHUNK_TILE_SIZE,
  ChunkData,
  MAX_CHUNKS,
  registerChunkDataObservers,
} from './components/chunk_data.ts';
export type { CollisionDataPayload } from './components/collision_data.ts';
export {
  CollisionData,
  CollisionLayer,
  registerCollisionDataObservers,
} from './components/collision_data.ts';
export type { CombatStatsData } from './components/combat_stats.ts';
export { CombatStats, registerCombatStatsObservers } from './components/combat_stats.ts';
export type { CombatTacticsData } from './components/combat_tactics.ts';
export { CombatTactics, registerCombatTacticsObservers } from './components/combat_tactics.ts';
export type { CrimeEventData } from './components/crime_event.ts';
export { CrimeEvent, registerCrimeEventObservers } from './components/crime_event.ts';
export { Enemy, registerEnemyObservers } from './components/enemy.ts';
export type { EngineStateData } from './components/engine_state.ts';
export {
  createEngineStateEntity,
  EngineState,
  getEngineStateEntityId,
  getSimulationState,
  isSimulationActive,
  registerEngineStateObservers,
  SimulationState,
  setSimulationState,
} from './components/engine_state.ts';
export type { FactionMemberData } from './components/faction_member.ts';
export { FactionMember, registerFactionMemberObservers } from './components/faction_member.ts';
export type { GoapAgentData } from './components/goap_agent.ts';
export { GoapAgent, registerGoapAgentObservers } from './components/goap_agent.ts';
export type { GridPositionData } from './components/grid_position.ts';
export { GridPosition, registerGridPositionObservers } from './components/grid_position.ts';
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
export type { MoveIntentData } from './components/move_intent.ts';
export { MoveIntent, registerMoveIntentObservers } from './components/move_intent.ts';
export type { NPCDialogData } from './components/npc_dialog.ts';
export { NPCDialog, registerNPCDialogObservers } from './components/npc_dialog.ts';
export type { PositionData } from './components/position.ts';
export { Position, registerPositionObservers } from './components/position.ts';
export type { SpatialLinkData } from './components/spatial_link.ts';
export { registerSpatialLinkObservers, SpatialLink } from './components/spatial_link.ts';
export type { SpawnPointData } from './components/spawn_point.ts';
export {
  registerSpawnPointObservers,
  SpawnPoint as SpawnPointComp,
} from './components/spawn_point.ts';
export type { TextIdentityData } from './components/text_identity.ts';
export { registerTextIdentityObservers, TextIdentity } from './components/text_identity.ts';
export type { TileVisualData } from './components/tile_visual.ts';
export { MAX_TILES, registerTileVisualObservers, TileVisual } from './components/tile_visual.ts';
export type { TransitionData } from './components/transition.ts';
export { registerTransitionObservers, Transition } from './components/transition.ts';
export type { TurnOrderData } from './components/turn_order.ts';
export { registerTurnOrderObservers, TurnOrder } from './components/turn_order.ts';
export type { VelocityData } from './components/velocity.ts';
export { registerVelocityObservers, Velocity } from './components/velocity.ts';
export type { VisionObserverData } from './components/vision_observer.ts';
export {
  ObserverState,
  registerVisionObserverObservers,
  VisionObserver,
} from './components/vision_observer.ts';
export type { VisionVisibleData } from './components/vision_visible.ts';
export { registerVisionVisibleObservers, VisionVisible } from './components/vision_visible.ts';
export type { VisualData } from './components/visual.ts';
export {
  AssetAlias,
  registerVisualObservers,
  resolveAssetPath,
  Visual,
} from './components/visual.ts';

// Memory config (buffer constants and allocator)
export {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
  MAX_ENTITIES,
  MAX_REGISTRY_STRINGS,
  REGISTRY_INITIAL_CAPACITY,
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

export type { JtonParseResult } from './assets/jton_parser.ts';
export {
  jtonToTilemapData,
  MAX_JTON_SPAWNS,
  MAX_JTON_TRANSITIONS,
  parseJtonMap,
  SPAWN_STRIDE,
  TRANSITION_STRIDE,
} from './assets/jton_parser.ts';
// Entity spawner (C-136)
export { resolveNpcTexture, resolvePropTexture } from './assets/lpc_asset_catalog.ts';
// Tilemap & collision (C-135)
export type {
  ObjectLayer,
  SpawnPoint,
  SpawnPointEntity,
  TilemapData,
  TilemapLayer,
  TilemapTileset,
  TransitionZone,
} from './assets/map_loader.ts';
export {
  clearMapCache,
  djb2Hash,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractSpawnPoints,
  extractTransitionZones,
  loadJtonMap,
  loadTilemap,
} from './assets/map_loader.ts';
export { checkLineOfSight, clearBresenhamGrid, setBresenhamGrid } from './math/bresenham.ts';
export type { StaticActionDefinition } from './math/goap/action_registry.ts';
// GOAP (C-191)
export {
  applyEffects,
  clearActionRegistry,
  evaluatePreconditions,
  findSatisfiedActions,
  getActionByIndex,
  getActionRegistry,
  initializeActionRegistry,
  selectBestAction,
} from './math/goap/action_registry.ts';
export { Faction, IsHostileTo, IsMemberOf, IsProtectorOf } from './math/goap/faction_relations.ts';
export { WORLD_STATE_BIT_COUNT, WorldStateBit } from './math/goap/world_state_bits.ts';
export type { PathfinderMemoryBuffers } from './math/jps/generational_table.ts';
// JPS Pathfinding (C-192)
export {
  allocatePathfinderBuffers,
  freePathfinderBuffers,
  fromNodeId,
  getGlobalGeneration,
  incrementGeneration,
  isNodeVisited,
  markNodeVisited,
  resetNode,
  toNodeId,
} from './math/jps/generational_table.ts';
export type { JpsSearchConfig, JpsSearchResult } from './math/jps/jps_search.ts';
export {
  cancelJpsSearch,
  isSearchActive,
  startJpsSearch,
  stepJpsSearch,
} from './math/jps/jps_search.ts';
export { MinHeap } from './math/jps/min_heap.ts';
export { castDdaVisionCone } from './math/vision/dda_raycaster.ts';
export { castShadowcastingFov } from './math/vision/shadowcasting.ts';
// Turso hydration bridge (C-195)
export type {
  TursoRegistryHydrationOptions,
  TursoStringRow,
} from './persistence/turso_registry_hydration.ts';
export { TursoRegistryHydration } from './persistence/turso_registry_hydration.ts';
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
export type {
  TilemapChunkRendererOptions,
  TilemapChunkRenderResult,
} from './rendering/tilemap_chunk_renderer.ts';
export { buildTilemapChunks, frustumCullChunks } from './rendering/tilemap_chunk_renderer.ts';

// Streaming orchestrator (C-193)
export type {
  ActionMutationPayload,
  MutationResult,
  StreamingOrchestratorOptions,
} from './services/streaming_orchestrator.ts';
export { StreamingOrchestratorService } from './services/streaming_orchestrator.ts';
// String registry (C-195)
export type {
  RegistryHandle,
  RegistryRow,
  StringRegistryServiceOptions,
} from './services/string_registry_service.ts';
export { StringRegistryService } from './services/string_registry_service.ts';
// State (engine-level mode gate)
export { getEngineGameMode, setEngineGameMode } from './state/game_mode.ts';
// Firebase SQL Connect sync (C-195)
export type {
  FirebaseSqlConnectSyncOptions,
  SqlConnectDelta,
  SqlConnectDeltaType,
} from './sync/firebase_sql_connect_sync.ts';
export { FirebaseSqlConnectSync } from './sync/firebase_sql_connect_sync.ts';
export type { CollisionGrid } from './systems/collision_system.ts';
export {
  initializeSpatialGrid,
  insertIntoSpatialGrid,
  isCellBlocked,
  isWalkable,
  moveInSpatialGrid,
  removeFromSpatialGrid,
  resetCollisionGrid,
  resolveMoveIntents,
  setCollisionGrid,
} from './systems/collision_system.ts';
export { updateEncounterSystem } from './systems/encounter_system.ts';
export type {
  SpawnEntitiesOptions,
  SpawnPointSpawnOptions,
  SpawnResult,
  SpawnTransitionOptions,
} from './systems/entity_spawner.ts';
export {
  spawnEntities,
  spawnSpawnPointEntities,
  spawnTransitionEntities,
} from './systems/entity_spawner.ts';
// Combat Tactics (C-197)
export {
  resolveTacticalAction,
  scoreTarget,
  updateGoapCombatTactics,
} from './systems/goap_combat_tactics_system.ts';
// GOAP (C-191)
export {
  resetGoapState,
  setFactionProtection,
  updateGoapScheduler,
} from './systems/goap_scheduler_system.ts';
export { handleInteract } from './systems/interaction_system.ts';
// JPS Pathfinding (C-192)
export {
  cancelPathfinding,
  initJpsPathfinder,
  isPathfinding,
  requestPath,
  tickJpsPathfinder,
} from './systems/jps_pathfinder_system.ts';
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
  setupVisualObservers,
  syncAppearanceSystem,
  toCellDisplayPosition,
  toGridCellCenter,
  updateEntityUbo,
  updateRender,
  updateRenderFromBuffer,
} from './systems/render_system.ts';
// Vision (C-190)
export {
  clearVisionGrid,
  resetVisibilityMasks,
  setVisionGrid,
  updateSpatialVision,
} from './systems/spatial_vision_system.ts';
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
