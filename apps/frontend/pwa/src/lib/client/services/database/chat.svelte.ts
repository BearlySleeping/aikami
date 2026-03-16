// apps/frontend/pwa/src/lib/client/services/database/npc-chat.svelte.ts
import { chatRepository } from '@aikami/frontend/repositories/chat.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ChatData, MessageData } from '@aikami/types';

export type NpcChatServiceOptions = BaseFrontendClassOptions;

export type NpcChatServiceInterface = BaseFrontendClassInterface & {
  /**
   * Gets the chat document for a specific NPC and user.
   * @param options - Configuration object.
   * @param options.uid The user ID.
   * @param options.npcId The NPC ID.
   * @returns A promise that resolves to the chat data or undefined if not found.
   */
  getChat(options: { uid: string; npcId: string }): Promise<ChatData | undefined>;

  /**
   * Gets an existing chat or creates a new one if it doesn't exist.
   * @param options - Configuration object.
   * @param options.uid The user ID.
   * @param options.npcId The NPC ID.
   * @param options.npcName The NPC name for denormalization.
   * @param options.npcAvatarUrl The NPC avatar URL for denormalization.
   * @returns A promise that resolves to the chat data.
   */
  getOrCreateChat(options: {
    uid: string;
    npcId: string;
    npcName: string;
    npcAvatarUrl?: string;
  }): Promise<ChatData>;

  /**
   * Creates or updates a chat document with a new message.
   * @param options - Configuration object.
   * @param options.uid The user ID.
   * @param options.npcId The NPC ID.
   * @param options.message The message text.
   * @param options.sender Whether the message is from 'user' or 'ai'.
   * @returns A promise that resolves when complete.
   */
  addMessage(options: {
    chatId: string;
    uid: string;
    npcId: string;
    message: string;
    sender: 'user' | 'ai';
  }): Promise<void>;

  /**
   * Gets all messages from a chat.
   * @param options - Configuration object.
   * @param options.uid The user ID.
   * @param options.npcId The NPC ID.
   * @returns A promise that resolves to an array of messages.
   */
  getMessages(options: { uid: string; npcId: string }): Promise<MessageData[]>;

  /**
   * Deletes a chat document.
   * @param options - Configuration object.
   * @param options.uid The user ID.
   * @param options.npcId The NPC ID.
   * @returns A promise that resolves when complete.
   */
  deleteChat(options: { uid: string; npcId: string }): Promise<void>;

  /**
   * Deletes a chat document by its ID.
   * @param options - Configuration object.
   * @param options.chatId The chat ID to delete.
   * @returns A promise that resolves when complete.
   */
  deleteChatById(options: { chatId: string }): Promise<void>;

  /**
   * Gets a chat by ID.
   * @param options - Configuration object.
   * @param options.chatId The chat ID.
   * @returns A promise that resolves to the chat data or undefined.
   */
  getChatById(options: { chatId: string }): Promise<
    | {
        id: string;
        npcId: string;
        npcName: string;
        npcAvatarUrl?: string;
        affection: number;
        stats: Record<string, unknown>;
        messages?: unknown[];
      }
    | undefined
  >;

  /**
   * Updates a chat document.
   * @param options - Configuration object.
   * @param options.chatId The chat ID.
   * @param options.messages The messages to update.
   * @param options.affection Optional affection points.
   * @param options.backgroundImageUrl Optional background image URL.
   * @returns A promise that resolves when complete.
   */
  updateChat(options: {
    chatId: string;
    messages?: MessageData[];
    affection?: number;
    backgroundImageUrl?: string;
  }): Promise<void>;
};

class NpcChatService
  extends BaseFrontendClass<NpcChatServiceOptions>
  implements NpcChatServiceInterface
{
  async getChat(options: { uid: string; npcId: string }): Promise<ChatData | undefined> {
    this.debug('getChat', options);
    const { uid, npcId } = options;

    try {
      const results = await chatRepository.getDocumentsByQuery({
        getCollectionPathArgument: undefined,
        filters: [
          { field: 'uid', operator: '==', value: uid },
          { field: 'npcId', operator: '==', value: npcId },
        ],
        limit: 1,
      });
      const result = results[0];
      this.debug('getChat: result', result);
      return result;
    } catch (error) {
      this.error('getChat failed', error);
      return undefined;
    }
  }

  async getOrCreateChat(options: {
    uid: string;
    npcId: string;
    npcName: string;
    npcAvatarUrl?: string;
  }): Promise<ChatData> {
    this.debug('getOrCreateChat', options);
    const { uid, npcId, npcName, npcAvatarUrl } = options;

    const existingChat = await this.getChat({ uid, npcId });
    if (existingChat) {
      this.debug('getOrCreateChat: found existing chat', existingChat);
      return existingChat;
    }

    this.debug('getOrCreateChat: creating new chat');
    try {
      const chatId = await chatRepository.addDocument({
        getCollectionPathArgument: undefined,
        createData: {
          npcId,
          npcName,
          npcAvatarUrl,
          uid,
          visibility: 'private',
          messages: [],
          messageCount: 0,
          affection: 0,
          stats: {},
        },
      });
      this.debug('getOrCreateChat: created new chat with id', chatId);

      return {
        id: chatId,
        npcId,
        npcName,
        npcAvatarUrl,
        uid,
        visibility: 'private',
        messages: [],
        messageCount: 0,
        affection: 0,
        stats: {},
      };
    } catch (error) {
      this.error('getOrCreateChat failed', error);
      throw error;
    }
  }

  async addMessage(options: {
    chatId: string;
    uid: string;
    npcId: string;
    message: string;
    sender: 'user' | 'ai';
  }): Promise<void> {
    this.debug('addMessage', options);
    const { chatId, uid, npcId, message, sender } = options;

    const existingChat = await this.getChat({ uid, npcId });
    this.debug('addMessage: existingChat', existingChat);
    const now = new Date();

    const newMessage: MessageData = {
      id: crypto.randomUUID(),
      text: message,
      sender,
      createdAt: now,
      attachments: [],
      metadata: {},
    };
    this.debug('addMessage: newMessage', newMessage);

    if (existingChat) {
      this.debug('addMessage: updating existing chat with new message');
      const updatedMessages = [...(existingChat.messages || []), newMessage];
      this.debug('addMessage: updatedMessages', updatedMessages);
      try {
        await chatRepository.updateDocument({
          getDocumentPathArgument: { chatId: existingChat.id },
          updateData: {
            messages: updatedMessages,
            lastMessageAt: now,
            messageCount: updatedMessages.length,
          },
        });
        this.debug('addMessage: update successful');
      } catch (error) {
        this.error('addMessage: update failed', error);
        throw error;
      }
    } else {
      this.debug('addMessage: creating new chat');
      try {
        await chatRepository.addDocument({
          getCollectionPathArgument: undefined,
          createData: {
            npcId,
            npcName: npcId,
            uid,
            visibility: 'private',
            messages: [newMessage],
            lastMessageAt: now,
            messageCount: 1,
            affection: 0,
            stats: {},
          },
        });
        this.debug('addMessage: create successful');
      } catch (error) {
        this.error('addMessage: create failed', error);
        throw error;
      }
    }
  }

  async getMessages(options: { uid: string; npcId: string }): Promise<MessageData[]> {
    this.debug('getMessages', options);
    const { uid, npcId } = options;

    const chat = await this.getChat({ uid, npcId });
    return chat?.messages ?? [];
  }

  async deleteChat(options: { uid: string; npcId: string }): Promise<void> {
    this.debug('deleteChat', options);
    const { uid, npcId } = options;

    try {
      const chat = await this.getChat({ uid, npcId });
      if (chat?.id) {
        await chatRepository.deleteDocument({ chatId: chat.id });
      }
    } catch (error) {
      this.error('deleteChat failed', error);
    }
  }

  async updateChat(options: {
    chatId: string;
    messages?: MessageData[];
    affection?: number;
    backgroundImageUrl?: string;
  }): Promise<void> {
    this.debug('updateChat', options);
    const { chatId, messages, affection, backgroundImageUrl } = options;

    try {
      const updateData: Record<string, unknown> = {};
      if (messages !== undefined) {
        updateData.messages = messages;
        updateData.messageCount = messages.length;
      }
      if (affection !== undefined) {
        updateData.affection = affection;
      }
      if (backgroundImageUrl !== undefined) {
        updateData.backgroundImageUrl = backgroundImageUrl;
      }

      await chatRepository.updateDocument({
        getDocumentPathArgument: { chatId },
        updateData,
      });
    } catch (error) {
      this.error('updateChat failed', error);
    }
  }

  async deleteChatById(options: { chatId: string }): Promise<void> {
    this.debug('deleteChatById', options);
    const { chatId } = options;
    try {
      await chatRepository.deleteDocument({ chatId });
    } catch (error) {
      this.error('deleteChatById failed', error);
    }
  }

  async getChatById(options: { chatId: string }): Promise<
    | {
        id: string;
        npcId: string;
        npcName: string;
        npcAvatarUrl?: string;
        affection: number;
        stats: Record<string, unknown>;
        messages?: unknown[];
      }
    | undefined
  > {
    this.debug('getChatById', options);
    const { chatId } = options;
    try {
      const chat = await chatRepository.getDocument({ chatId });
      return chat;
    } catch (error) {
      this.error('getChatById failed', error);
      return undefined;
    }
  }
}

export const npcChatService: NpcChatServiceInterface = new NpcChatService({
  className: 'NpcChatService',
});
