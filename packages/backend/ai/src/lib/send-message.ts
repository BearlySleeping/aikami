import { isEmulatorMode } from '@aikami/backend-configs';
import type { AIMessagePayload, AIMessageResponse, UserSessionData } from '@aikami/types';
import { logger } from '$logger';
import { LorebookService } from './lorebook.ts';
import { type AIChatMessage, createAIProvider } from './providers/index.ts';

/**
 * Helper to inject lorebook context into the message list.
 */
const injectLoreContext = (
  messages: AIChatMessage[],
  text: string,
  history: AIChatMessage[],
): void => {
  const lorebook = new LorebookService(LorebookService.getMockEntries());
  // Combine current text and recent history for scanning
  const scanText = history.map((m) => m.content).join('\n') + '\n' + text;
  const activatedEntries = lorebook.scan(scanText);

  if (activatedEntries.length > 0) {
    const lorePrompt = lorebook.formatForPrompt(activatedEntries);
    // Find system prompt index or insert at beginning
    const systemIndex = messages.findIndex((m) => m.role === 'system');
    if (systemIndex !== -1) {
      messages.splice(systemIndex + 1, 0, { role: 'system', content: lorePrompt });
    } else {
      messages.unshift({ role: 'system', content: lorePrompt });
    }
    logger.debug('Injected lorebook context', { entryCount: activatedEntries.length });
  }
};

export const sendMessage = async (
  options: AIMessagePayload<'sendMessage'>,
  user: UserSessionData,
): Promise<AIMessageResponse<'sendMessage'>> => {
  try {
    logger.log('sendMessage', options, user);

    const { text, provider = 'openai', apiKey, model, context } = options;

    // Return mock response in emulator mode
    if (isEmulatorMode()) {
      logger.log('Emulator mode: returning mock AI response');
      return {
        text: `[Mock AI Response] You said: "${text}". This is a mock response from the AI since we're running in emulator mode. In production, this would call the actual ${provider} API.`,
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      };
    }

    if (!apiKey) {
      throw new Error('API key is required');
    }

    const messages: AIChatMessage[] = [];

    if (context.systemPrompt) {
      messages.push({ role: 'system', content: context.systemPrompt });
    }

    // Inject Lorebook context here
    injectLoreContext(messages, text, context.messages);

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

    // Return mock response in emulator mode
    if (isEmulatorMode()) {
      logger.log('Emulator mode: returning mock AI response');
      yield `[Mock AI Response] You said: "${text}". This is a mock response from the AI since we're running in emulator mode. In production, this would call the actual ${provider} API.`;
      return;
    }

    if (!apiKey) {
      throw new Error('API key is required');
    }

    const messages: AIChatMessage[] = [];

    if (context.systemPrompt) {
      messages.push({ role: 'system', content: context.systemPrompt });
    }

    // Inject Lorebook context here
    injectLoreContext(messages, text, context.messages);

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
