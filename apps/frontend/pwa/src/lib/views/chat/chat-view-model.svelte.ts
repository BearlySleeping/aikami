// apps/frontend/pwa/src/lib/views/chat/chat-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { MessageCreateData, NpcData } from '@aikami/types';
import { aiService, authService, chatService, messageService, npcService } from '$services';

/**
 * Options for creating a ChatViewModel instance.
 */
export type ChatViewModelOptions = BaseViewModelOptions & {
  /** The ID of the NPC to chat with */
  npcId: string;
};

/**
 * View model interface for the chat functionality.
 * Manages chat state, message sending, and NPC interactions.
 */
export type ChatViewModelInterface = BaseViewModelInterface & {
  /** The NPC being chatted with, or null if not loaded */
  readonly npc: NpcData | null;

  /** Whether chat data is currently loading */
  readonly isLoading: boolean;

  /** Whether a message is currently being sent */
  readonly isSending: boolean;

  /** Whether the AI is typing a response */
  readonly isTyping: boolean;

  /** Current error message, if any */
  readonly chatError: string | null;

  /** Array of chat messages */
  readonly messages: typeof chatService.messages;

  /** Whether to show the greeting card (before first message) */
  readonly showGreeting: boolean;

  /**
   * Loads the chat history for the current NPC.
   * Should be called after initialize() when NPC data is available.
   */
  loadChatHistory(): Promise<void>;

  /**
   * Sends a message to the AI and handles the response.
   * @param text - The message text to send
   */
  sendMessage(text: string): Promise<void>;

  /**
   * Dismisses the greeting card and shows the chat.
   */
  dismissGreeting(): void;

  /**
   * Clears all chat messages and resets state.
   */
  clearChat(): void;
};

class ChatViewModel extends BaseViewModel<ChatViewModelOptions> implements ChatViewModelInterface {
  npc = $state<NpcData | null>(null);
  showGreeting = $state(true);

  get isLoading() {
    return chatService.isLoading;
  }

  get isSending() {
    return chatService.isSending;
  }

  get isTyping() {
    return chatService.isTyping;
  }

  get chatError() {
    return chatService.errorMessage;
  }

  get messages() {
    return chatService.messages;
  }

  async initialize(): Promise<void> {
    chatService.setLoading(true);
    try {
      const npcData = await npcService.get(this._options.npcId);
      this.npc = npcData ?? null;
      if (this.npc) {
        await this.loadChatHistory();
      }
    } catch (err) {
      this.error('initialize', err);
    } finally {
      chatService.setLoading(false);
    }
  }

  async loadChatHistory(): Promise<void> {
    const uid = authService.uid;
    if (!uid || !this.npc) return;

    chatService.setLoading(true);
    try {
      const messages = await messageService.getMessages(uid, this.npc.id);
      chatService.setMessages(messages);
      this.showGreeting = messages.length === 0;
    } catch (_error) {
    } finally {
      chatService.setLoading(false);
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.npc) return;

    this.showGreeting = false;
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(null);

    const userMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'user' as const,
      timestamp: new Date(),
    };

    chatService.addMessage(userMessage);
    await this.saveMessage(text, 'user');

    try {
      const response = await aiService.sendMessageToAI(text, this.npc ?? undefined);
      if (response) {
        chatService.appendAIMessage(response);
        await this.saveMessage(response, 'ai');
      }
    } catch (_error) {
      chatService.setError('Failed to get response from AI');
    } finally {
      chatService.setSending(false);
      chatService.setTyping(false);
    }
  }

  dismissGreeting(): void {
    this.showGreeting = false;
  }

  private async saveMessage(text: string, sender: 'user' | 'ai'): Promise<void> {
    const uid = authService.uid;
    if (!uid || !this.npc) return;

    const messageData: MessageCreateData = {
      text,
      sender,
    };

    try {
      await messageService.createMessage(uid, this.npc.id, messageData);
    } catch (_error) {}
  }

  clearChat(): void {
    chatService.clear();
    this.showGreeting = true;
  }
}

export const getChatViewModel = (options: ChatViewModelOptions): ChatViewModelInterface =>
  new ChatViewModel(options);
