import { AnthropicProvider } from './anthropic.ts';
import { OpenAIProvider } from './openai.ts';
import { OpenRouterProvider } from './openrouter.ts';
import type { AIProvider, AIProviderConfig, AIProviderType } from './types.ts';

export type {
  AIChatCompletionRequest,
  AIChatCompletionResponse,
  AIMessage,
  AIMessage as AIChatMessage,
  AIProvider,
  AIProviderConfig,
  AIProviderType,
} from './types.ts';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.type) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'gemini':
      return new OpenAIProvider({
        ...config,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: config.defaultModel || 'gemini-2.0-flash',
      });
    default:
      throw new Error(`Unknown AI provider type: ${config.type}`);
  }
}

export const SUPPORTED_PROVIDERS: { type: AIProviderType; name: string; defaultModel: string }[] = [
  { type: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o' },
  { type: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514' },
  { type: 'openrouter', name: 'OpenRouter', defaultModel: 'anthropic/claude-3.5-sonnet' },
  { type: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-2.0-flash' },
];
