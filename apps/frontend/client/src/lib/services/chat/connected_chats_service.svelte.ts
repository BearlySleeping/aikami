// apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts
//
// ConnectedChatsService — manages the asymmetric chat bridge between
// Game and OOC/Conversation chats. Handles ChatLink CRUD (locally
// persisted), bridge context injection, OOC cross-posting, and game
// context forwarding.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge
// C-386a: ChatLink rehomed from Firestore to the local `chat_links` table.

import { BRIDGE_CONTEXT_MAX_CHARS, OOC_GAME_CONTEXT_MESSAGE_COUNT } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { BridgeContext, ChatLink } from '@aikami/types';
import { authService } from '../auth/auth_service.svelte.ts';
import { chatService } from './chat.svelte.ts';
import { chatLinkStorage } from './chat_link_storage.svelte.ts';
import { chatStorage } from './chat_storage.svelte.ts';

export type ConnectedChatsServiceOptions = BaseFrontendClassOptions;

export type ConnectedChatsServiceInterface = BaseFrontendClassInterface & {
  /**
   * Gets the active ChatLink for a given game chat.
   *
   * @param options.targetChatId — The game (target) chat ID.
   * @returns The ChatLink if active, or undefined.
   */
  getActiveLink(options: { targetChatId: string }): Promise<ChatLink | undefined>;

  /**
   * Creates a new ChatLink between an OOC source chat and a game target chat.
   *
   * @param options.sourceChatId — The OOC/Conversation chat ID.
   * @param options.targetChatId — The Game chat ID.
   * @returns The created ChatLink.
   */
  createLink(options: { sourceChatId: string; targetChatId: string }): Promise<ChatLink>;

  /**
   * Soft-deactivates a ChatLink (preserves notes/influences for re-link).
   *
   * @param options.linkId — The link ID to deactivate.
   * @param options.targetChatId — The target (game) chat ID.
   */
  unlink(options: { linkId: string; targetChatId: string }): Promise<void>;

  /**
   * Adds a durable note to an active ChatLink.
   */
  addNote(options: { linkId: string; targetChatId: string; note: string }): Promise<void>;

  /**
   * Removes a durable note from an active ChatLink by index.
   */
  removeNote(options: { linkId: string; targetChatId: string; index: number }): Promise<void>;

  /**
   * Adds a pending influence to an active ChatLink.
   */
  addInfluence(options: { linkId: string; targetChatId: string; influence: string }): Promise<void>;

  /**
   * Removes a pending influence from an active ChatLink by index.
   */
  removeInfluence(options: { linkId: string; targetChatId: string; index: number }): Promise<void>;

  /**
   * Assembles the BridgeContext for prompt injection.
   * Consumes pending influences atomically.
   *
   * @param options.targetChatId — The game chat ID.
   * @returns The bridge context, or null if no active link.
   */
  assembleBridgeContext(options: { targetChatId: string }): Promise<BridgeContext | null>;

  /**
   * Handles OOC tag cross-posting: posts extracted OOC content
   * to the linked OOC chat as a new user-like message.
   */
  crossPostOoc(options: { targetChatId: string; oocContents: string[] }): Promise<void>;

  /**
   * Deletes a ChatLink document.
   */
  deleteLink(options: { linkId: string; targetChatId: string }): Promise<void>;
};

class ConnectedChatsService
  extends BaseFrontendClass<ConnectedChatsServiceOptions>
  implements ConnectedChatsServiceInterface
{
  /** @inheritdoc */
  async getActiveLink(options: { targetChatId: string }): Promise<ChatLink | undefined> {
    return await chatLinkStorage.getActiveLink(options);
  }

  /** @inheritdoc */
  async createLink(options: { sourceChatId: string; targetChatId: string }): Promise<ChatLink> {
    const link = await chatLinkStorage.createLink(options);
    this.debug('createLink:created', {
      linkId: link.linkId,
      sourceChatId: options.sourceChatId,
      targetChatId: options.targetChatId,
    });
    return link;
  }

  /** @inheritdoc */
  async unlink(options: { linkId: string; targetChatId: string }): Promise<void> {
    await chatLinkStorage.unlink({ linkId: options.linkId });
    this.debug('unlink:deactivated', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async addNote(options: { linkId: string; targetChatId: string; note: string }): Promise<void> {
    const link = await chatLinkStorage.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }
    await chatLinkStorage.addNote({ linkId: options.linkId, note: options.note });
    this.debug('addNote:added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeNote(options: {
    linkId: string;
    targetChatId: string;
    index: number;
  }): Promise<void> {
    const link = await chatLinkStorage.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }
    await chatLinkStorage.removeNote({ linkId: options.linkId, index: options.index });
    this.debug('removeNote:removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async addInfluence(options: {
    linkId: string;
    targetChatId: string;
    influence: string;
  }): Promise<void> {
    const link = await chatLinkStorage.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }
    await chatLinkStorage.addInfluence({ linkId: options.linkId, influence: options.influence });
    this.debug('addInfluence:added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeInfluence(options: {
    linkId: string;
    targetChatId: string;
    index: number;
  }): Promise<void> {
    const link = await chatLinkStorage.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }
    await chatLinkStorage.removeInfluence({ linkId: options.linkId, index: options.index });
    this.debug('removeInfluence:removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async assembleBridgeContext(options: { targetChatId: string }): Promise<BridgeContext | null> {
    const link = await chatLinkStorage.getActiveLink(options);
    if (!link) {
      return null;
    }

    // Snapshot influences for atomic consumption
    const turnInfluences = [...link.pendingInfluences];

    // Build recent game context
    const recentGameContext = this._buildRecentGameContext();

    // Apply character budget
    const { durableNotesStr, influenceStr } = this._applyTokenBudget(link.notes, turnInfluences);

    // Consume influences after reading them
    if (turnInfluences.length > 0) {
      await chatLinkStorage.consumeInfluences({ linkId: link.linkId });
      this.debug('assembleBridgeContext:consumed-influences', {
        count: turnInfluences.length,
      });
    }

    return {
      durableNotes: durableNotesStr,
      turnInfluences: influenceStr,
      recentGameContext,
    };
  }

  /** @inheritdoc */
  async crossPostOoc(options: { targetChatId: string; oocContents: string[] }): Promise<void> {
    const { targetChatId, oocContents } = options;
    if (oocContents.length === 0) {
      return;
    }

    const link = await chatLinkStorage.getActiveLink({ targetChatId });
    if (!link) {
      return;
    }

    const uid = authService.uid;
    if (!uid) {
      return;
    }

    const oocChat = await chatStorage.getChatById({ chatId: link.sourceChatId });
    if (!oocChat) {
      this.warn('crossPostOoc:OOC-chat-not-found', { sourceChatId: link.sourceChatId });
      return;
    }

    for (const content of oocContents) {
      try {
        await chatStorage.addMessage({
          chatId: link.sourceChatId,
          uid,
          npcId: oocChat.npcId,
          message: content,
          sender: 'user',
        });
        this.debug('crossPostOoc:posted', { sourceChatId: link.sourceChatId, content });
      } catch (error) {
        this.error('crossPostOoc:failed-to-post', error);
      }
    }
  }

  /** @inheritdoc */
  async deleteLink(options: { linkId: string; targetChatId: string }): Promise<void> {
    await chatLinkStorage.deleteLink({ linkId: options.linkId });
    this.debug('deleteLink:deleted', { linkId: options.linkId });
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Builds a compact string of recent game chat messages for OOC context.
   */
  private _buildRecentGameContext(): string {
    const messages = chatService.messages.slice(-OOC_GAME_CONTEXT_MESSAGE_COUNT);
    if (messages.length === 0) {
      return '';
    }
    return messages
      .map((m) => `[${m.sender === 'user' ? 'Player' : 'Narrator'}]: ${m.text}`)
      .join('\n');
  }

  /**
   * Applies the bridge context character budget.
   * Truncates with a warning if exceeded.
   */
  private _applyTokenBudget(
    notes: string[],
    influences: string[],
  ): { durableNotesStr: string[]; influenceStr: string[] } {
    let totalLength = 0;
    const resultNotes: string[] = [];
    const resultInfluences: string[] = [];

    for (const note of notes) {
      const sep = totalLength > 0 ? 1 : 0;
      if (totalLength + sep + note.length <= BRIDGE_CONTEXT_MAX_CHARS) {
        resultNotes.push(note);
        totalLength += sep + note.length;
      } else {
        this.warn('_applyTokenBudget:note-truncated', { note });
        const remaining = BRIDGE_CONTEXT_MAX_CHARS - totalLength - 16;
        if (remaining > 0) {
          resultNotes.push(`${note.slice(0, remaining)}...(truncated)`);
        }
        return { durableNotesStr: resultNotes, influenceStr: resultInfluences };
      }
    }

    for (const influence of influences) {
      const sep = totalLength > 0 ? 1 : 0;
      if (totalLength + sep + influence.length <= BRIDGE_CONTEXT_MAX_CHARS) {
        resultInfluences.push(influence);
        totalLength += sep + influence.length;
      } else {
        this.warn('_applyTokenBudget:influence-truncated', { influence });
        const remaining = BRIDGE_CONTEXT_MAX_CHARS - totalLength - 16;
        if (remaining > 0) {
          resultInfluences.push(`${influence.slice(0, remaining)}...(truncated)`);
        }
        break;
      }
    }

    return { durableNotesStr: resultNotes, influenceStr: resultInfluences };
  }
}

export const connectedChatsService: ConnectedChatsServiceInterface = ConnectedChatsService.create({
  className: 'ConnectedChatsService',
}) as ConnectedChatsServiceInterface;
