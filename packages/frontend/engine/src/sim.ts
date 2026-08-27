// packages/frontend/engine/src/sim.ts
// ---------------------------------------------------------------------------
// Simulation subpath — pure ECS, math, GOAP, systems (no PixiJS, no node:*)
// ---------------------------------------------------------------------------

export type { LpcLayerRecipe, LpcLayerRole } from '@aikami/lpc';
// Asset manifest (browser-safe)
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
// Autotile
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
// Content pack loader
export {
  type ContentPackLoaderInterface,
  clearContentPackCache,
  loadContentPack,
} from './assets/content_pack_loader.ts';
// JTON parser
export type { JtonParseResult } from './assets/jton_parser.ts';
export {
  jtonToTilemapData,
  MAX_JTON_SPAWNS,
  MAX_JTON_TRANSITIONS,
  parseJtonMap,
  SPAWN_STRIDE,
  TRANSITION_STRIDE,
} from './assets/jton_parser.ts';
// LPC asset catalog
export { resolveNpcTexture, resolvePropTexture } from './assets/lpc_asset_catalog.ts';
// Map loader
export type {
  AssetTagResolver,
  ObjectLayer,
  RegistryBackedLoadOptions,
  SpawnPoint,
  SpawnPointEntity,
  TilemapData,
  TilemapLayer,
  TilemapTileset,
  TransitionZone,
} from './assets/map_loader.ts';
export {
  buildTerrainGridForMap,
  clearMapCache,
  djb2Hash,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractSpawnPoints,
  extractTransitionZones,
  loadJtonMap,
  loadTilemap,
  resolveGid,
  TILED_FLIP_D,
  TILED_FLIP_H,
  TILED_FLIP_MASK,
  TILED_FLIP_V,
} from './assets/map_loader.ts';
// Base engine class
export {
  BaseEngineClass,
  type BaseEngineClassInterface,
  type BaseEngineClassOptions,
} from './base_engine_class.ts';
// ECS components
export type { AppearanceData } from './components/appearance.ts';
export {
  Appearance,
  DEFAULT_BODY_LAYER_ID,
  EXPRESSION_MAP,
  FACE_LAYER_INDEX,
  getAppearanceLayers,
  registerAppearanceObservers,
  setAppearanceLayers,
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
// PathFollow component
export { PathFollow, registerPathFollowObservers } from './components/path_follow.ts';
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
export { registerTileVisualObservers, TileVisual } from './components/tile_visual.ts';
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
// Memory config
export {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
  MAX_ENTITIES,
} from './config/memory_config.ts';
// Core
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
// Math
export { type AstarGrid, type AstarResult, findPath, type GridCell } from './math/astar.ts';
export { checkLineOfSight, clearBresenhamGrid, setBresenhamGrid } from './math/bresenham.ts';
export type { StaticActionDefinition } from './math/goap/action_registry.ts';
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
export { castDdaVisionCone } from './math/vision/dda_raycaster.ts';
export { castShadowcastingFov } from './math/vision/shadowcasting.ts';
// Serialization
export {
  deserializeWorld,
  serializePlayer,
  serializeWorld,
} from './serialization/ecs_serializer.ts';
// Services
export type { ItemData } from './services/ai_service.ts';
export { GameAiService } from './services/ai_service.ts';
export type { ActionResult, GameState, NpcData, PlayerAction } from './services/api_service.ts';
export { GameApiService } from './services/api_service.ts';
export type {
  ActionMutationPayload,
  MutationResult,
  StreamingOrchestratorOptions,
} from './services/streaming_orchestrator.ts';
export { StreamingOrchestratorService } from './services/streaming_orchestrator.ts';
export type {
  RegistryHandle,
  RegistryRow,
  StringRegistryServiceOptions,
} from './services/string_registry_service.ts';
export { StringRegistryService } from './services/string_registry_service.ts';
// State
export { getEngineGameMode, setEngineGameMode } from './state/game_mode.ts';
// Camera system
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
// Collision system
export type { CollisionGrid } from './systems/collision_system.ts';
export {
  getMapPixelBounds,
  getTerrainGrid,
  getTerrainTileSize,
  initializeSpatialGrid,
  insertIntoSpatialGrid,
  isBlocksSight,
  isCellBlocked,
  isEntityInSpatialGrid,
  isWalkable,
  isWithinMapBounds,
  peekSpatialGridHead,
  removeFromSpatialGrid,
  resetCollisionGrid,
  setCollisionGrid,
  setTerrainCellCost,
  setTerrainGrid,
} from './systems/collision_system.ts';
// Economy system
export {
  addItemStack,
  deductItem,
  hasItemCapacity,
  processTransaction,
  resetEconomyTracking,
} from './systems/economy_system.ts';
// Encounter system
export { spawnEncounterEnemy, updateEncounterSystem } from './systems/encounter_system.ts';
// Entity spawner
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
// Environment system
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
// GOAP combat tactics
export {
  resolveTacticalAction,
  scoreTarget,
  updateGoapCombatTactics,
} from './systems/goap_combat_tactics_system.ts';
// GOAP movement executor
export { updateGoapMovement } from './systems/goap_movement_executor.ts';
// GOAP scheduler
export {
  resetGoapState,
  setFactionProtection,
  updateGoapScheduler,
} from './systems/goap_scheduler_system.ts';
// GridPosition sync
export { syncGridPositions } from './systems/grid_position_sync_system.ts';
// Interaction proximity
export {
  clearInteractionProximityState,
  updateInteractionProximity,
} from './systems/interaction_proximity_system.ts';
// Interaction system
export { handleInteract } from './systems/interaction_system.ts';
// Interaction target selector
export {
  type InteractionTarget,
  selectInteractionTarget,
} from './systems/interaction_target_selector.ts';
// Keybinding config
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
// Movement system
export {
  getStuckWatch,
  resetStuckWatch,
  type StuckWatch,
  updateMovement,
} from './systems/movement_system.ts';
// Party follow
export { updatePartyFollow } from './systems/party_follow_system.ts';
// PathFollow system
export {
  getNpcHaltReason,
  hasActivePath,
  type NpcHaltReason,
  resetNpcHaltReasons,
  updatePathFollow,
} from './systems/path_follow_system.ts';
// Spatial vision
export {
  clearVisionGrid,
  resetVisibilityMasks,
  setVisionGrid,
  updateSpatialVision,
} from './systems/spatial_vision_system.ts';
// Terrain grid
export {
  buildTerrainGridFromBoolean,
  buildTerrainGridFromChannel,
  collectTerrainCostDefs,
  TERRAIN_COST_SCALE,
  TERRAIN_COST_WALKABLE,
  type TerrainCostDef,
  type TerrainGrid,
} from './systems/terrain_grid.ts';
// Turn manager system
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

// Zoning system
export { updateZoningSystem } from './systems/zoning_system.ts';

// Tag parser
export { parseBridgeTags } from './tag_parser.ts';

// Types
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
