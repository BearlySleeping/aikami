import type {
  AIApiEvents,
  AIMessageType,
  AIProviderType,
  ChatResponse,
  PersonaData,
  UserSessionData,
} from '@aikami/types';
import { createApiHandler } from '@aikami/utils';

import { createAiService } from './factory.ts';

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const PROVIDERS: { type: AIProviderType; name: string; defaultModel: string }[] = [
  { type: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o' },
  { type: 'gemini', name: 'Gemini', defaultModel: 'gemini-2.0-flash' },
  { type: 'openrouter', name: 'OpenRouter', defaultModel: 'openai/gpt-4o' },
  { type: 'anthropic', name: 'Anthropic', defaultModel: 'claude-sonnet-4-20250514' },
];

/**
 * Create a new Persona from a descriptive prompt.
 *
 * Uses the default AI provider (Gemini) with structured extraction to produce
 * a {@link PersonaData} object matching the schema.
 */
const createPersona = async (payload: { prompt: string }): Promise<{ persona: PersonaData }> => {
  const service = createAiService({ provider: 'gemini' });

  const systemPrompt = [
    'You are a character creation assistant.',
    "Generate a detailed persona in JSON format from the user's description.",
    'Return ONLY valid JSON matching this structure:',
    '{',
    '  "name": "string",',
    '  "race": "string (optional)",',
    '  "class": "string (optional)",',
    '  "subclass": "string (optional)",',
    '  "level": "integer (optional)",',
    '  "background": "string (optional)",',
    '  "alignment": "string (optional)",',
    '  "appearance": "string (optional)",',
    '  "personality": "string (optional)",',
    '  "backstory": "string (optional)",',
    '  "notes": "string (optional)"',
    '}',
  ].join('\n');

  const text = await service.generateCompletion(
    `${systemPrompt}\n\nUser prompt: ${payload.prompt}`,
  );

  // Extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const persona = jsonMatch
    ? (JSON.parse(jsonMatch[0]) as PersonaData)
    : ({ name: 'Unnamed Persona' } as PersonaData);

  return { persona };
};

/**
 * Send a chat message to an AI provider and return the response.
 *
 * Builds the message array from the supplied context (system prompt, message
 * history, current text) and forwards it to the chosen provider.
 */
const sendMessage = async (payload: {
  text: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  context: { messages: Array<{ role: string; content: string }>; systemPrompt?: string };
}): Promise<ChatResponse> => {
  const { text, provider, apiKey, model, context } = payload;

  const providerType = (provider ?? 'gemini') as 'openai' | 'gemini';
  const service = createAiService({ provider: providerType, apiKey, model });

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  if (context.systemPrompt) {
    messages.push({ role: 'system', content: context.systemPrompt });
  }

  for (const message of context.messages) {
    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      messages.push(message as { role: 'system' | 'user' | 'assistant'; content: string });
    }
  }

  messages.push({ role: 'user', content: text });

  const response = await service.generateChat(messages, { model });

  return {
    text: response.text,
    usage: response.usage,
  };
};

/**
 * Return the list of available AI providers with their names and default models.
 */
const getProviders = (_payload: { providers: [] }): { providers: typeof PROVIDERS } => {
  return { providers: PROVIDERS };
};

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const aiApiHandler = createApiHandler<AIApiEvents, UserSessionData | undefined>({
  createPersona,
  getProviders,
  sendMessage,
});

export const handleAIEndpoint = async <T extends AIMessageType>(options: {
  currentUser?: UserSessionData;
  payload: AIApiEvents[T][0];
  type: T;
}): Promise<AIApiEvents[T][1]> => {
  return await aiApiHandler({ type: options.type, payload: options.payload }, options.currentUser);
};
