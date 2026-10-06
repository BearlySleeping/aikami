// apps/frontend/client/src/lib/services/npc/conversation_recap_composition.ts
import {
  type ConversationRecapServiceInterface,
  createConversationRecapService,
} from './conversation_recap_service.svelte.ts';

/** One application recorder; tests may construct isolated service instances. */
export const conversationRecapService: ConversationRecapServiceInterface =
  createConversationRecapService({ className: 'ConversationRecapService' });
