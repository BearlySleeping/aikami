// apps/frontend/client/src/lib/services/index.ts
export {
  type DialogServiceInterface,
  dialogService,
  type GameStateSyncServiceInterface,
  gameStateSyncService,
  type RouterServiceInterface,
  routerService,
  type SaveSlotEntry,
  type SaveSlotMetadata,
} from '@aikami/frontend/services';
// ── Agent Pipeline ────────────────────────────────────────────────────
export {
  AgentPipelineService,
  type AgentPipelineServiceInterface,
  type AgentPipelineServiceOptions,
  AgentRegistryService,
  type AgentRegistryServiceInterface,
  type AgentRegistryServiceOptions,
  agentPipelineService,
  agentRegistryService,
  BUILT_IN_AGENTS,
  customAgentToConfig,
  runCustomAgent,
} from './agent/index.ts';
export * from './ai/ai_gateway_service.svelte.ts';
export * from './ai/ai_service.svelte.ts';
export * from './ai/sentence_boundary_chunker';
export * from './ai/stream_orchestrator_service.svelte.ts';
export * from './ai/text_generation_service.svelte.ts';
export * from './analytics/analytics_service.svelte.ts';
export * from './app/app.svelte.ts';
export * from './app/preference.svelte.ts';
export * from './assets/asset_store.svelte.ts';
export * from './audio/audio_context_manager';
export * from './audio/audio_queue_player';
export * from './audio/audio_service.svelte';
export * from './audio/scene_to_music_tags';
export * from './audio/track_registry_service.svelte';
export * from './audio/tts_service.svelte.ts';
export * from './auth/auth_service.svelte.ts';
export * from './campaign/campaign_service.svelte.ts';
export * from './capability/capability_service.svelte.ts';
export * from './character/character.svelte.ts';
export * from './chat/chat.svelte.ts';
export * from './chat/choice_history_store.svelte.ts';
export * from './chat/connected_chats_service.svelte.ts';
export * from './chat/context_builder';
export * from './chat/conversation_repository.svelte.ts';
export * from './chat/draft_store';
export * from './chat/message_branch_store.svelte.ts';
export * from './chat/npc_chat_repository.svelte.ts';
export * from './config/config_service.svelte.ts';
export * from './config/macro_preset_store.svelte.ts';
export * from './config/provider_endpoints';
export * from './dice/dice_service.svelte.ts';
export * from './export/export_service.svelte.ts';
export * from './expression/expression_asset_resolver';
export {
  type ExpressionServiceInterface,
  expressionService,
} from './expression/expression_service.svelte.ts';
export * from './game/bridge_listeners';
export * from './game/combat_service.svelte';
export * from './game/equipment_service.svelte.ts';
export * from './game/game_composition_root.svelte.ts';
export * from './game/game_engine_service.svelte.ts';
export * from './game/game_mode_service.svelte.ts';
export * from './game/game_overlay_service.svelte.ts';
export * from './game/game_save_service.svelte.ts';
export * from './game/game_state_service.svelte.ts';
export * from './game/idle_detection_service.svelte.ts';
export * from './game/inventory_service.svelte.ts';
export * from './game/npc_dialogue_service.svelte';
export * from './game/pixi_texture_injector';
export * from './game/player_state_service.svelte.ts';
export * from './game/quest_service.svelte';
export * from './game/serializable_service';
export * from './game/session_service.svelte';
export * from './game/time_service.svelte';
export * from './game/vendor_service.svelte.ts';
export * from './game/world_state_service.svelte.ts';
export * from './gm/gm_prompt_service.svelte.ts';
export * from './image/contextual_trigger_service.svelte';
export * from './image/gallery_service.svelte';
// ── GM Narrative Director ──
export * from './image/image_generation_service.svelte.ts';
export * from './image/style_profile_service.svelte';
export * from './lorebook/keyword_scanner';
export { lorebookStore } from './lorebook/lorebook_store.svelte';
export * from './notification/notification_repository.svelte.ts';
export * from './npc/autonomous_message_service.svelte.ts';
export * from './npc/npc_repository.svelte.ts';
export * from './npc/npc_schedule_service.svelte.ts';
export * from './onboarding/onboarding.svelte.ts';
export * from './persona/persona_creation_service.svelte.ts';
export * from './persona/persona_creation_text_stream.svelte.ts';
export * from './persona/persona_repository.svelte.ts';
export * from './settings/ai_settings.svelte.ts';
export * from './storage/storage_service.svelte.ts';
export * from './user/user_repository.svelte.ts';
export * from './worldgen/world_gen_seeding_service.svelte.ts';
