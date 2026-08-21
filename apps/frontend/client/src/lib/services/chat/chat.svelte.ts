import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { DiceCardData, MessageData } from '@aikami/types';

export type ChatServiceOptions = BaseFrontendClassOptions;

export type ChatMessage = {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  /** Message kind — 'dice' renders a DiceCard instead of plain text. */
  kind?: 'text' | 'dice';
  /** Present when kind === 'dice'. */
  dice?: DiceCardData;
};

/**
 * Service interface for managing chat state and messages.
 * Provides reactive state management for chat UI with methods to update each state variable.
 */
export type ChatServiceInterface = BaseFrontendClassInterface & {
  /**
   * List of all chat messages in the current conversation.
   * @readonly - Use addMessage(), setMessages(), appendAIMessage() to modify
   */
  readonly messages: ChatMessage[];

  /**
   * Indicates if chat data is currently being loaded.
   * @readonly - Use setLoading() to modify
   */
  readonly isLoading: boolean;

  /**
   * Indicates if a message is currently being sent.
   * @readonly - Use setSending() to modify
   */
  readonly isSending: boolean;

  /**
   * Indicates if the AI is typing/generating a response.
   * @readonly - Use setTyping() to modify
   */
  readonly isTyping: boolean;

  /**
   * Current error message, if any.
   * @readonly - Use setError() to modify
   */
  readonly errorMessage: string | undefined;

  /**
   * Sets the loading state.
   * @param loading - Whether data is loading
   */
  setLoading(loading: boolean): void;

  /**
   * Sets the sending state.
   * @param sending - Whether a message is being sent
   */
  setSending(sending: boolean): void;

  /**
   * Sets the typing state.
   * @param typing - Whether the AI is typing
   */
  setTyping(typing: boolean): void;

  /**
   * Sets the error message.
   * @param error - The error message or null
   */
  setError(error: string | undefined): void;

  /**
   * Adds a message to the chat.
   * @param message - The message to add
   */
  addMessage(message: ChatMessage): void;

  /**
   * Replaces all messages with the given array.
   * @param messages - Array of message data to set
   */
  setMessages(messages: MessageData[]): void;

  /**
   * Appends a new AI message to the chat.
   * @param text - The AI response text
   */
  appendAIMessage(text: string): void;

  /**
   * Updates the content of the last AI message.
   * @param text - The updated text
   */
  updateLastAIMessage(text: string): void;

  /**
   * Clears all chat state to initial values.
   */
  clear(): void;

  /** Connection ID for per-chat provider override (C-230). */
  readonly connectionId: string | undefined;

  /** Sets the connection override for this chat. */
  setConnectionId(connectionId: string | undefined): void;
};

class ChatService extends BaseFrontendClass<ChatServiceOptions> implements ChatServiceInterface {
  messages: ChatMessage[] = $state([]);
  isLoading = $state(false);
  isSending = $state(false);
  isTyping = $state(false);
  errorMessage: string | undefined = $state(undefined);
  connectionId: string | undefined = $state(undefined);

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }

  setSending(sending: boolean): void {
    this.isSending = sending;
  }

  setTyping(typing: boolean): void {
    this.isTyping = typing;
  }

  setError(error: string | undefined): void {
    this.errorMessage = error;
  }

  addMessage(message: ChatMessage): void {
    this.messages = [...this.messages, message];
  }

  setMessages(messages: MessageData[]): void {
    this.messages = messages.map((msg) => {
      let timestamp: Date;
      const createdAt = msg.createdAt as unknown;
      if (createdAt) {
        // Handle Firestore Timestamp (has toDate method) or plain Date
        if (
          typeof createdAt === 'object' &&
          'toDate' in createdAt &&
          typeof createdAt.toDate === 'function'
        ) {
          timestamp = (createdAt as { toDate: () => Date }).toDate();
        } else if (createdAt instanceof Date) {
          timestamp = createdAt;
        } else {
          timestamp = new Date();
        }
      } else {
        timestamp = new Date();
      }
      // Carry the optional dice metadata through unchanged so dice messages
      // keep rendering as DiceCard across rebuilds (edit/delete) and reloads.
      // The fields may live at the top level (in-memory ChatMessage) or in the
      // persisted `metadata` map (MessageData from Firestore).
      const meta = (msg as { metadata?: Record<string, unknown> }).metadata;
      const kind =
        (msg as { kind?: 'text' | 'dice' }).kind ?? (meta?.kind as 'text' | 'dice' | undefined);
      const dice = (msg as { dice?: DiceCardData }).dice ?? (meta?.dice as DiceCardData | undefined);
      return {
        id: msg.id || crypto.randomUUID(),
        text: msg.text,
        sender: msg.sender,
        timestamp,
        kind,
        dice,
      };
    });
    this.debug('setMessages: mapped messages', this.messages);
  }

  appendAIMessage(text: string): void {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'ai',
      timestamp: new Date(),
    };
    this.messages = [...this.messages, message];
  }

  updateLastAIMessage(text: string): void {
    if (this.messages.length === 0) {
      return;
    }
    const lastIndex = this.messages.length - 1;
    if (this.messages[lastIndex].sender === 'ai') {
      this.messages[lastIndex].text = text;
    } else {
      this.appendAIMessage(text);
    }
  }

  clear(): void {
    this.messages = [];
    this.isLoading = false;
    this.isSending = false;
    this.isTyping = false;
    this.errorMessage = undefined;
    this.connectionId = undefined;
  }

  setConnectionId(connectionId: string | undefined): void {
    this.connectionId = connectionId;
  }
}

export const chatService: ChatServiceInterface = ChatService.create({
  className: 'ChatService',
});
