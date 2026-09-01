// apps/frontend/client/src/lib/types/text_chat.ts

/** Role of a chat message participant. */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** A single chat message in an LLM conversation. */
export type TextChatMessage = {
  role: ChatMessageRole;
  content: string;
};
