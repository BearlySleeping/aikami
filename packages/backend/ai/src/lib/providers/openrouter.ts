import type {
  AIChatCompletionRequest,
  AIChatCompletionResponse,
  AIProvider,
  AIProviderConfig,
} from './types.ts';

export class OpenRouterProvider implements AIProvider {
  type = 'openrouter' as const;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.defaultModel = config.defaultModel || 'anthropic/claude-3.5-sonnet';
  }

  async chat(request: AIChatCompletionRequest): Promise<AIChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://aikami.app',
        'X-Title': 'Aikami',
      },
      body: JSON.stringify({
        model: request.model || this.defaultModel,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      id: data.id,
      model: data.model,
      choices: data.choices,
      usage: data.usage,
    };
  }
}
