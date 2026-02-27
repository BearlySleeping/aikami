export type AIProviderType = 'openai' | 'anthropic' | 'openrouter' | 'gemini';

export interface AIProviderConfig {
  type: AIProviderType;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIChatCompletionRequest {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: AIMessage;
    finishReason: string;
  }[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  type: AIProviderType;
  chat(request: AIChatCompletionRequest): Promise<AIChatCompletionResponse>;
  chatStream?(request: AIChatCompletionRequest): AsyncGenerator<string>;
}

export interface AIProviderFactory {
  create(config: AIProviderConfig): AIProvider;
}
