// apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts
//
// ConnectedChatsService — manages the asymmetric chat bridge between
// Game and OOC/Conversation chats. Handles ChatLink CRUD (Firestore
// persisted), bridge context injection, OOC cross-posting, and game
// context forwarding.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import {
  BRIDGE_CONTEXT_MAX_CHARS,
  CHAT_LINKS_COLLECTION,
  OOC_GAME_CONTEXT_MESSAGE_COUNT,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { ChatLinkSchema } from '@aikami/schemas';
import type { BridgeContext, ChatLink } from '@aikami/types';
import { Value } from 'typebox/value';
import { authService } from '../auth/auth_service.svelte.ts';
import { chatService } from './chat.svelte.ts';
import { npcChatService } from './npc_chat_repository.svelte.ts';

type FirestoreModule = typeof import('@aikami/frontend/configs/firestore.ts');

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
   * @param options.targetChatId — The target (game) chat ID for Firestore path.
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
   * Deletes a ChatLink document from Firestore.
   */
  deleteLink(options: { linkId: string; targetChatId: string }): Promise<void>;
};

class ConnectedChatsService
  extends BaseFrontendClass<ConnectedChatsServiceOptions>
  implements ConnectedChatsServiceInterface
{
  /** Lazily-loaded Firestore module. */
  private _firestoreModule: FirestoreModule | undefined;

  private async _getFirestore(): Promise<FirestoreModule> {
    if (this._firestoreModule) {
      return this._firestoreModule;
    }
    this._firestoreModule = await import('@aikami/frontend/configs/firestore.ts');
    return this._firestoreModule;
  }

  /** @inheritdoc */
  async getActiveLink(options: { targetChatId: string }): Promise<ChatLink | undefined> {
    const fs = await this._getFirestore();
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      'active',
    );

    try {
      const snapshot = await fs.getDoc(linkRef);
      if (!snapshot.exists()) {
        return undefined;
      }

      const data = snapshot.data();
      if (!data?.isActive) {
        return undefined;
      }

      if (!Value.Check(ChatLinkSchema, data)) {
        this.warn('getActiveLink: schema validation failed', {
          targetChatId: options.targetChatId,
        });
        return undefined;
      }

      return data as ChatLink;
    } catch {
      return undefined;
    }
  }

  /** @inheritdoc */
  async createLink(options: { sourceChatId: string; targetChatId: string }): Promise<ChatLink> {
    const fs = await this._getFirestore();
    const now = Date.now();
    const linkId = crypto.randomUUID();

    const link: ChatLink = {
      linkId,
      sourceChatId: options.sourceChatId,
      targetChatId: options.targetChatId,
      notes: [],
      pendingInfluences: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      linkId,
    );
    await fs.setDoc(linkRef, link);

    this.debug('createLink: created', {
      linkId,
      sourceChatId: options.sourceChatId,
      targetChatId: options.targetChatId,
    });

    return link;
  }

  /** @inheritdoc */
  async unlink(options: { linkId: string; targetChatId: string }): Promise<void> {
    const fs = await this._getFirestore();
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.updateDoc(linkRef, { isActive: false, updatedAt: Date.now() });
    this.debug('unlink: deactivated', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async addNote(options: { linkId: string; targetChatId: string; note: string }): Promise<void> {
    const link = await this.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }

    const fs = await this._getFirestore();
    const newNotes = [...link.notes, options.note];
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.updateDoc(linkRef, { notes: newNotes, updatedAt: Date.now() });
    this.debug('addNote: added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeNote(options: {
    linkId: string;
    targetChatId: string;
    index: number;
  }): Promise<void> {
    const link = await this.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }

    const fs = await this._getFirestore();
    const newNotes = link.notes.filter((_, i) => i !== options.index);
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.updateDoc(linkRef, { notes: newNotes, updatedAt: Date.now() });
    this.debug('removeNote: removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async addInfluence(options: {
    linkId: string;
    targetChatId: string;
    influence: string;
  }): Promise<void> {
    const link = await this.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }

    const fs = await this._getFirestore();
    const newInfluences = [...link.pendingInfluences, options.influence];
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.updateDoc(linkRef, { pendingInfluences: newInfluences, updatedAt: Date.now() });
    this.debug('addInfluence: added', { linkId: options.linkId });
  }

  /** @inheritdoc */
  async removeInfluence(options: {
    linkId: string;
    targetChatId: string;
    index: number;
  }): Promise<void> {
    const link = await this.getActiveLink({ targetChatId: options.targetChatId });
    if (!link || link.linkId !== options.linkId) {
      return;
    }

    const fs = await this._getFirestore();
    const newInfluences = link.pendingInfluences.filter((_, i) => i !== options.index);
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.updateDoc(linkRef, { pendingInfluences: newInfluences, updatedAt: Date.now() });
    this.debug('removeInfluence: removed', { linkId: options.linkId, index: options.index });
  }

  /** @inheritdoc */
  async assembleBridgeContext(options: { targetChatId: string }): Promise<BridgeContext | null> {
    const link = await this.getActiveLink(options);
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
      const fs = await this._getFirestore();
      const linkRef = fs.doc(
        fs.firestore,
        'chats',
        options.targetChatId,
        CHAT_LINKS_COLLECTION,
        link.linkId,
      );
      await fs.updateDoc(linkRef, {
        pendingInfluences: [],
        updatedAt: Date.now(),
      });

      this.debug('assembleBridgeContext: consumed influences', {
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

    const link = await this.getActiveLink({ targetChatId });
    if (!link) {
      return;
    }

    const uid = authService.uid;
    if (!uid) {
      return;
    }

    const oocChat = await npcChatService.getChatById({ chatId: link.sourceChatId });
    if (!oocChat) {
      this.warn('crossPostOoc: OOC chat not found', { sourceChatId: link.sourceChatId });
      return;
    }

    for (const content of oocContents) {
      try {
        await npcChatService.addMessage({
          chatId: link.sourceChatId,
          uid,
          npcId: oocChat.npcId,
          message: content,
          sender: 'user',
        });
        this.debug('crossPostOoc: posted', { sourceChatId: link.sourceChatId, content });
      } catch (error) {
        this.error('crossPostOoc: failed to post', error);
      }
    }
  }

  /** @inheritdoc */
  async deleteLink(options: { linkId: string; targetChatId: string }): Promise<void> {
    const fs = await this._getFirestore();
    const linkRef = fs.doc(
      fs.firestore,
      'chats',
      options.targetChatId,
      CHAT_LINKS_COLLECTION,
      options.linkId,
    );
    await fs.deleteDoc(linkRef);
    this.debug('deleteLink: deleted', { linkId: options.linkId });
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
        this.warn('_applyTokenBudget: note truncated', { note });
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
        this.warn('_applyTokenBudget: influence truncated', { influence });
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
