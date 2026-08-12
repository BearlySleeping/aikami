// packages/frontend/engine/src/index.ts

// ---------------------------------------------------------------------------
// Public game engine exports
// ---------------------------------------------------------------------------

// Register the custom-scheme (tauri://, file://) asset URL resolver with
// PixiJS before any Assets.load() call in the app. Idempotent.
import './assets/custom_scheme_url_resolver.ts';

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
  createSeedableRng,
  endCombat,
  getCombatSeed,
  handleCombatAction,
  initCombat,
  resetTurnTracking,
  setCombatSeed,
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
export { Companion, registerCompanionObservers } from './components/companion.ts';
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
export type {
  InteractableStateData,
  InteractableStateMap,
} from './components/interactable_state.ts';
export { InteractableState } from './components/interactable_state.ts';
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
export type { ItemData } from './services/ai_service.ts';
export { GameAiService } from './services/ai_service.ts';
export type { ActionResult, GameState, NpcData, PlayerAction } from './services/api_service.ts';
// Services
export { GameApiService } from './services/api_service.ts';

// Serialization

export {
  deserializeWorld,
  serializePlayer,
  serializeWorld,
} from './serialization/ecs_serializer.ts';

// Rendering

// Asset Manifest (C-243)
//
// Node-only filesystem operations (ensureAssetDirs / buildManifest /
// loadManifest) live in asset_manifest_node.ts and are intentionally NOT
// re-exported here — importing them from the browser bundle would pull
// `node:fs/promises` / `node:path` into the client (externalized to empty
// modules with build warnings). Consumers that need disk scanning import
// them from the module path directly (e.g. scripts, engine tests).
export {
  buildAssetTagList,
  buildAssetTree,
  hasNativeMarker,
  pathToTag,
  resolveAssetUrl,
  sanitizeAssetFilename,
  tagToPath,
  validUniquePath,
} from './assets/asset_manifest.ts';
export {
  type AutotileOptions,
  autotileLayers,
  CORNER16_MASK_COUNT,
  cornerFrameName,
  cornerMaskForCell,
  pickFillVariant,
  type ResolvedTerrainGrid,
  resolveTerrainGrid,
  TERRAIN_CORNER_BITS,
  TERRAIN_CORNER_ORDER,
  type TerrainCorner,
  type TerrainLayerEmission,
  validateTerrains,
} from './assets/autotile.ts';
export {
  type ContentPackLoaderInterface,
  clearContentPackCache,
  loadContentPack,
} from './assets/content_pack_loader.ts';
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
  DEFAULT_TILEMAP_BAND,
  djb2Hash,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractSpawnPoints,
  extractTransitionZones,
  loadJtonMap,
  loadTilemap,
} from './assets/map_loader.ts';
export {
  COLOR_DAWN,
  COLOR_DUSK,
  COLOR_MIDNIGHT,
  COLOR_NOON,
  copyEnvironmentUBO,
  createEnvironmentUBO,
  DIURNAL_KEYFRAMES,
  ENV_UBO_OFFSETS,
  ENVIRONMENT_SHADER_STRUCT,
  ENVIRONMENT_UBO_BYTES,
  ENVIRONMENT_UBO_SIZE,
} from './environment/environment_ubo.ts';
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
//
// Intentionally NOT re-exported from the barrel: TursoRegistryHydration
// dynamically imports @tursodatabase/database (a Rust native client that
// imports `node:module`), which Vite externalizes with
// browser-compatibility warnings. Node-side consumers import it from the
// module path directly (e.g. engine tests).
export type { PixiAppDebugMetrics, PixiAppInstance, PixiAppOptions } from './pixi_app.ts';
export { createPixiApp } from './pixi_app.ts';
export type { PixiInitOptions } from './pixi_init_options.ts';
export { isE2ETestMode, resolvePixiInitOptions } from './pixi_init_options.ts';
export {
  AnimationController,
  getLpcFrameIndex,
  getLpcStateRow,
  LpcAnimationState,
  LpcDirection,
  velocityToDirection,
} from './rendering/animation_controller.ts';
// Layer bands (C-376 AC-4)
export type { WorldZBand } from './rendering/layer_bands.ts';
export {
  computeEntityZIndex,
  MIN_ENTITY_Y,
  WORLD_Z_BANDS,
} from './rendering/layer_bands.ts';
export type {
  CreatePropFrameResolverOptions,
  PropFrameResolverHandle,
  PropSpritesheet,
  PropTextureResolution,
  PropTextureResolver,
} from './rendering/prop_texture_resolver.ts';
export { createPropFrameResolver } from './rendering/prop_texture_resolver.ts';
// Scene Background (C-243)
export type { SceneBackgroundOptions } from './rendering/scene_background.ts';
export { SceneBackground } from './rendering/scene_background.ts';
export type { PaletteSpriteOptions } from './rendering/sprite_composer.ts';
export {
  initLpcShaders,
  packRecipeToUboBuffer,
  SpriteComposer,
} from './rendering/sprite_composer.ts';
export { installNearestTextureDefault } from './rendering/texture_defaults.ts';
export type { TextureManagerConfig } from './rendering/texture_manager.ts';
export { TextureManager } from './rendering/texture_manager.ts';
export type {
  TilemapChunk,
  TilemapChunkRendererOptions,
  TilemapChunkRenderResult,
} from './rendering/tilemap_chunk_renderer.ts';
export { buildTilemapChunks, frustumCullChunks } from './rendering/tilemap_chunk_renderer.ts';
export type { WeatherOverlayOptions } from './rendering/weather_overlay.ts';
export { WeatherOverlay } from './rendering/weather_overlay.ts';
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
export type { CollisionGrid } from './systems/collision_system.ts';
export {
  getMapPixelBounds,
  initializeSpatialGrid,
  insertIntoSpatialGrid,
  isCellBlocked,
  isWalkable,
  isWithinMapBounds,
  removeFromSpatialGrid,
  resetCollisionGrid,
  setCollisionGrid,
} from './systems/collision_system.ts';
export { spawnEncounterEnemy, updateEncounterSystem } from './systems/encounter_system.ts';
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
// Environment (C-213)
export type {
  EnvironmentState,
  SetEnvironmentConfigOptions,
} from './systems/environment_system.ts';
export {
  getEnvironmentState,
  resetEnvironmentTracking,
  setEnvironmentConfig,
  stepEnvironment,
} from './systems/environment_system.ts';
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
export {
  clearInteractionProximityState,
  updateInteractionProximity,
} from './systems/interaction_proximity_system.ts';
export { handleInteract } from './systems/interaction_system.ts';
export {
  type InteractionTarget,
  selectInteractionTarget,
} from './systems/interaction_target_selector.ts';
// JPS Pathfinding (C-192)
export {
  cancelPathfinding,
  initJpsPathfinder,
  isPathfinding,
  requestPath,
  tickJpsPathfinder,
} from './systems/jps_pathfinder_system.ts';
// Keybinding config (shared between settings UI and engine)
export {
  buildKeyToAction,
  DEFAULT_KEYBINDINGS,
  type InputActionId,
  KEYBINDING_STORAGE_KEY,
  type KeybindingMap,
  keyToDirection,
  loadKeybindings,
  MOVEMENT_ACTION_IDS,
  OVERLAY_ACTION_IDS,
} from './systems/keybinding_config.ts';
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
// Bridge tag parser (C-244)
export { parseBridgeTags } from './tag_parser.ts';
export type {
  GameCommand,
  GameCommandOfType,
  GameEvent,
  GameEventOfType,
  NPCSpawnData,
  QuestData,
  QuestJournalEntry,
  QuestObjectiveData,
  QuestStatus,
} from './types.ts';
