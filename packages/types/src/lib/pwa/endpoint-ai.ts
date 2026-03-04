import type { PersonaData } from '../database/persona.ts';

export type AIProviderType = 'openai' | 'anthropic' | 'openrouter' | 'gemini';

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProviderConfig {
  type: AIProviderType;
  apiKey: string;
  model?: string;
}

export interface ChatContext {
  npcId?: string;
  characterId?: string;
  messages: AIChatMessage[];
  systemPrompt?: string;
}

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
