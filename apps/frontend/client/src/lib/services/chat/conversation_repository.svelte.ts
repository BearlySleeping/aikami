// apps/frontend/client/src/lib/services/media/conversation_repository.svelte.ts
import type { ConversationMessage } from './context_builder.ts';

// ---------------------------------------------------------------------------
// ConversationRepositoryAdapter — contract for persisting dialogue turns
// ---------------------------------------------------------------------------

/** Options for saving a completed dialogue turn. */
export type SaveDialogueTurnOptions = {
  /** ID of the chat/conversation this turn belongs to. */
  chatId: string;
  /** ID of the NPC the player is speaking with. */
  npcId: string;
  /** The player's input message. */
  playerMessage: ConversationMessage;
  /** The NPC's generated response. */
  npcMessage: ConversationMessage;
};

/**
 * Minimal contract for persisting completed dialogue turns.
 *
 * The Stream Orchestrator calls this after a text stream completes
 * successfully.  Implementations forward the data to the underlying
 * database layer (Firestore, IndexedDB, mock, etc.).
 */
export type ConversationRepositoryInterface = {
  /**
   * Persists a completed dialogue turn (player input + NPC response).
   *
   * Called AFTER the text stream ends gracefully — never on abort.
   */
  saveDialogueTurn(options: SaveDialogueTurnOptions): Promise<void>;
};
