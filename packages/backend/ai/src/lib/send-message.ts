import type { AIMessagePayload, AIMessageResponse, UserSessionData } from '@aikami/types';

import logger from '$logger';
import { type AIChatMessage, createAIProvider } from './providers/index.ts';

export const sendMessage = async (
  options: AIMessagePayload<'sendMessage'>,
  user: UserSessionData,
): Promise<AIMessageResponse<'sendMessage'>> => {
  try {
    logger.log('sendMessage', options, user);

    const { text, provider = 'openai', apiKey, model, context } = options;

    if (!apiKey) {
      throw new Error('API key is required');
    }

    const messages: AIChatMessage[] = [];

    if (context.systemPrompt) {
      messages.push({ role: 'system', content: context.systemPrompt });
    }

    for (const msg of context.messages) {
      messages.push(msg);
    }

    messages.push({ role: 'user', content: text });

    const aiProvider = createAIProvider({
      type: provider,
      apiKey,
      defaultModel: model,
    });

    const response = await aiProvider.chat({
      messages,
      model,
      temperature: 0.7,
      maxTokens: 4096,
    });

    const assistantMessage = response.choices[0]?.message?.content || '';

    return {
      text: assistantMessage,
      usage: response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          }
        : undefined,
    };
  } catch (error) {
    logger.error('sendMessage', error);
    throw error;
  }
};

export async function* sendMessageStream(
  options: AIMessagePayload<'sendMessage'>,
  user: UserSessionData,
): AsyncGenerator<string> {
  try {
    logger.log('sendMessageStream', options, user);

    const { text, provider = 'openai', apiKey, model, context } = options;

    if (!apiKey) {
      throw new Error('API key is required');
    }

    const messages: AIChatMessage[] = [];

    if (context.systemPrompt) {
      messages.push({ role: 'system', content: context.systemPrompt });
    }

    for (const msg of context.messages) {
      messages.push(msg);
    }

    messages.push({ role: 'user', content: text });

    const aiProvider = createAIProvider({
      type: provider,
      apiKey,
      defaultModel: model,
    });

    if (!aiProvider.chatStream) {
      const response = await aiProvider.chat({
        messages,
        model,
        temperature: 0.7,
        maxTokens: 4096,
      });
      yield response.choices[0]?.message?.content || '';
      return;
    }

    for await (const chunk of aiProvider.chatStream({
      messages,
      model,
      temperature: 0.7,
      maxTokens: 4096,
    })) {
      yield chunk;
    }
  } catch (error) {
    logger.error('sendMessageStream', error);
    throw error;
  }
}
