// TODO: merge with chat.ts

import type { PersonaData } from '../database/persona.ts';
export type AIProviderType = 'openai' | 'anthropic' | 'openrouter' | 'gemini';

export type AIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AIProviderConfig = {
  type: AIProviderType;
  apiKey: string;
  model?: string;
};

export type ChatContext = {
  npcId?: string;
  characterId?: string;
  messages: AIChatMessage[];
  systemPrompt?: string;
};

/** Token usage statistics returned with AI responses. */
export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Response from a chat/completion generation call. */
export type ChatResponse = {
  /** The generated text content. */
  text: string;
  /** Optional token usage statistics from the provider. */
  usage?: AiTokenUsage;
  /** Provider-specific metadata (model used, finish reason, safety ratings, etc.). */
  metadata?: Record<string, unknown>;
};

/** Options for chat generation calls. */
export type ChatOptions = {
  /** Model identifier override (e.g. 'gpt-4o', 'gemini-2.0-flash'). */
  model?: string;
  /** Maximum completion tokens to generate. */
  maxTokens?: number;
  /** Sampling temperature (0-2). Lower = more deterministic. */
  temperature?: number;
  /** Nucleus sampling threshold (0-1). */
  topP?: number;
  /** Sequences where the model will stop generating. */
  stopSequences?: string[];
  /** Additional provider-specific options forwarded to the vendor SDK. */
  providerOptions?: Record<string, unknown>;
};

/** Options for single-turn completion calls. */
export type CompletionOptions = {
  /** Model identifier override. */
  model?: string;
  /** Maximum completion tokens to generate. */
  maxTokens?: number;
  /** Sampling temperature (0-2). Lower = more deterministic. */
  temperature?: number;
  /** Nucleus sampling threshold (0-1). */
  topP?: number;
  /** Sequences where the model will stop generating. */
  stopSequences?: string[];
  /** Additional provider-specific options. */
  providerOptions?: Record<string, unknown>;
};

/** Options for text classification calls. */
export type ClassificationOptions = {
  /** Model identifier override. */
  model?: string;
  /** Whether to return confidence scores (if supported by provider). */
  includeScores?: boolean;
  /** Additional provider-specific options. */
  providerOptions?: Record<string, unknown>;
};

/** Result from a text classification call. */
export type ClassificationResult = {
  /** The selected label. */
  label: string;
  /** Optional confidence score (0-1). */
  score?: number;
  /** Optional scores for all candidate labels. */
  allScores?: Record<string, number>;
};

/** Options for embedding generation calls. */
export type EmbeddingOptions = {
  /** Model identifier override. */
  model?: string;
  /** Additional provider-specific options. */
  providerOptions?: Record<string, unknown>;
};

/** Raw provider response before normalization — used internally by concrete services. */
export type RawChatResponse = {
  text: string;
  usage?: AiTokenUsage;
  finishReason?: string;
  metadata?: Record<string, unknown>;
};

export type AIApiEvents = {
  createPersona: [
    {
      prompt: string;
    },
    {
      persona: PersonaData;
    },
  ];
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
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    },
  ];
  getProviders: [
    { providers: [] },
    {
      providers: { type: AIProviderType; name: string; defaultModel: string }[];
    },
  ];
};

export type AIMessageData<T extends AIMessageType = AIMessageType> = {
  payload: AIMessagePayload<T>;
  type: T;
};

export type AIMessagePayload<T extends AIMessageType = AIMessageType> = AIApiEvents[T][0];

export type AIMessageResponse<T extends AIMessageType = AIMessageType> = AIApiEvents[T][1];

export type AIMessageType = keyof AIApiEvents;
