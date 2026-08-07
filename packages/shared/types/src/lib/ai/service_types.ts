// packages/shared/types/src/lib/ai/service_types.ts
//
// AI service types consumed by packages/backend/chat/ (reserved for future
// self-hosted LLM serving) and the client AiServiceInterface contract.
// Formerly lived in lib/endpoints/ai.ts alongside callable-specific types.

import type { PersonaData } from '../firestore/persona.ts';

/** Supported AI provider backends. */
export type AIProviderType = 'openai' | 'anthropic' | 'openrouter' | 'gemini';

/** Canonical chat message format used across all AI service providers. */
export type AIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Configuration for a specific AI provider. */
export type AIProviderConfig = {
  type: AIProviderType;
  apiKey: string;
  model?: string;
};

/** Contextual metadata passed alongside chat messages. */
export type ChatContext = {
  npcId?: string;
  characterId?: string;
  messages: AIChatMessage[];
  systemPrompt?: string;
};

// ── Response / option types ────────────────────────────────────────────

/** Token usage statistics returned with AI responses. */
export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Response from a chat/completion generation call. */
export type ChatResponse = {
  text: string;
  usage?: AiTokenUsage;
  metadata?: Record<string, unknown>;
};

/** Options for chat generation calls. */
export type ChatOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  providerOptions?: Record<string, unknown>;
};

/** Options for single-turn completion calls. */
export type CompletionOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  providerOptions?: Record<string, unknown>;
};

/** Options for text classification calls. */
export type ClassificationOptions = {
  model?: string;
  includeScores?: boolean;
  providerOptions?: Record<string, unknown>;
};

/** Result from a text classification call. */
export type ClassificationResult = {
  label: string;
  score?: number;
  allScores?: Record<string, number>;
};

/** Options for embedding generation calls. */
export type EmbeddingOptions = {
  model?: string;
  providerOptions?: Record<string, unknown>;
};

/** Raw provider response before normalization. */
export type RawChatResponse = {
  text: string;
  usage?: AiTokenUsage;
  finishReason?: string;
  metadata?: Record<string, unknown>;
};

// ── Callable API event types (reserved for future self-hosted endpoint) ─

export type AIApiEvents = {
  createPersona: [{ prompt: string }, { persona: PersonaData }];
  sendMessage: [
    {
      text: string;
      provider?: AIProviderType;
      apiKey?: string;
      model?: string;
      context: ChatContext;
    },
    {
      text: string;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    },
  ];
  getProviders: [
    { providers: [] },
    { providers: { type: AIProviderType; name: string; defaultModel: string }[] },
  ];
};

export type AIMessageType = keyof AIApiEvents;

export type AIMessageData<T extends AIMessageType = AIMessageType> = {
  payload: AIApiEvents[T][0];
  type: T;
};

export type AIMessagePayload<T extends AIMessageType = AIMessageType> = AIApiEvents[T][0];

export type AIMessageResponse<T extends AIMessageType = AIMessageType> = AIApiEvents[T][1];
