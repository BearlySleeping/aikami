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
  agentPipelineService,
  BUILT_IN_AGENTS,
} from './agent/index.ts';
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
export * from './audio/tts_service.svelte.ts';
export * from './auth/auth_service.svelte.ts';
export * from './character/character.svelte.ts';
export * from './chat/chat.svelte.ts';
export * from './chat/connected_chats_service.svelte.ts';
export * from './chat/context_builder';
export * from './chat/conversation_repository.svelte.ts';
export * from './chat/draft_store';
export * from './chat/message_branch_store.svelte.ts';
export * from './chat/npc_chat_repository.svelte.ts';
export * from './config/config_service.svelte.ts';
export * from './config/macro_preset_store.svelte.ts';
export * from './dice/dice_service.svelte.ts';
export * from './expression/expression_asset_resolver';
export {
  type ExpressionServiceInterface,
  expressionService,
} from './expression/expression_service.svelte.ts';
export * from './game/bridge_listeners';
export * from './game/combat_service.svelte';
export * from './game/game_engine_service.svelte.ts';
export * from './game/game_load_state.svelte.ts';
export * from './game/game_overlay_service.svelte.ts';
export * from './game/game_save_service.svelte.ts';
export * from './game/game_state_service.svelte.ts';
export * from './game/inventory_service.svelte';
export * from './game/npc_dialogue_service.svelte';
export * from './game/pixi_texture_injector';
export * from './game/quest_service.svelte';
export * from './game/serializable_service';
export * from './game/session_service.svelte';
export * from './game/time_service.svelte';
export * from './game/vendor_service.svelte.ts';
export * from './image/contextual_trigger_service.svelte';
export * from './image/gallery_service.svelte';
// ── GM Narrative Director ────────────────────────────────────────────
// NOTE: GM services are NOT re-exported from here to avoid Bun's `export * from`
// limitation with .svelte.ts re-exports in test runner. Consumers import directly
// from './gm/gm_prompt_service.svelte.ts' etc.
export * from './image/image_generation_service.svelte.ts';
export * from './image/style_profile_service.svelte';
export * from './lorebook/keyword_scanner';
export { lorebookStore } from './lorebook/lorebook_store.svelte';
export * from './notification/notification_repository.svelte.ts';
export * from './npc/npc_repository.svelte.ts';
export * from './onboarding/onboarding.svelte.ts';
export * from './persona/persona_creation_service.svelte.ts';
export * from './persona/persona_creation_text_stream.svelte.ts';
export * from './persona/persona_repository.svelte.ts';
export * from './settings/ai_settings.svelte.ts';
export * from './storage/storage_service.svelte.ts';
export * from './user/user_repository.svelte.ts';
