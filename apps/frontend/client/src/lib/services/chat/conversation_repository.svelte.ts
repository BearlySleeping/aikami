// apps/frontend/client/src/lib/services/chat/conversation_repository.svelte.ts
//
// Turso/libSQL-backed repository for persisting NPC dialogue turns.
// Writes player/NPC messages to the chat_history table via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso

import { getLocalDatabase } from '@aikami/frontend/repositories';
import type { ConversationMessage } from './context_builder.ts';

// ---------------------------------------------------------------------------
// Types
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
 * Contract for persisting completed dialogue turns.
 *
 * The Stream Orchestrator calls this after a text stream completes
 * successfully. Implementations forward the data to the underlying
 * database layer.
 */
export type ConversationRepositoryInterface = {
  /**
   * Persists a completed dialogue turn (player input + NPC response).
   *
   * Called AFTER the text stream ends gracefully — never on abort.
   */
  saveDialogueTurn(options: SaveDialogueTurnOptions): Promise<void>;
};

// ---------------------------------------------------------------------------
// Turso-backed Implementation
// ---------------------------------------------------------------------------

/**
 * Local SQLite-backed conversation repository.
 *
 * Writes dialogue turns to the `chat_history` table in the local
 * Turso/libSQL database. The `session_id` column is set to the chatId
 * for future session-scoped queries.
 */
class TursoConversationRepository implements ConversationRepositoryInterface {
  /** @inheritdoc */
  async saveDialogueTurn(options: SaveDialogueTurnOptions): Promise<void> {
    const db = await getLocalDatabase();

    // Persist both messages in one transaction to prevent partial persistence
    await db.transaction([
      {
        sql: `INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)`,
        args: [options.chatId, options.playerMessage.role, options.playerMessage.content],
      },
      {
        sql: `INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)`,
        args: [options.chatId, options.npcMessage.role, options.npcMessage.content],
      },
    ]);
  }
}

/** Shared singleton instance. */
export const conversationRepository: ConversationRepositoryInterface =
  new TursoConversationRepository();
