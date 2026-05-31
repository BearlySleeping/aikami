// packages/shared/types/src/lib/endpoints/chat.ts
// TODO: merge with ai.ts

/**
 * A single chat message in a conversation.
 */
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Chat API event types.
 */
export type ChatApiEvents = {
  sendMessage: [
    {
      /** The conversation / agent id. */
      agentId: string;
      /** Messages sent so far (for context). */
      messages: { role: 'user' | 'assistant'; content: string }[];
      /** The new user message. */
      content: string;
    },
    {
      /** The AI response content. */
      response: string;
      /** Unique request id for tracing. */
      requestId: string;
    },
  ];
};

export type ChatMessageType = keyof ChatApiEvents;

export type ChatMessageData<T extends ChatMessageType = ChatMessageType> = {
  payload: ChatMessagePayload<T>;
  type: T;
};

export type ChatMessagePayload<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][0];

export type ChatMessageResponse<T extends ChatMessageType = ChatMessageType> = ChatApiEvents[T][1];
