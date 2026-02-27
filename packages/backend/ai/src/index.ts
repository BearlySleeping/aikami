import type {
  AIApiEvents,
  AIMessagePayload,
  AIMessageResponse,
  AIMessageType,
  UserSessionData,
} from '@aikami/types';

import { createApiHandler } from '@aikami/utils';
import { createPersona } from './lib/persona-generation.ts';
import { SUPPORTED_PROVIDERS } from './lib/providers/index.ts';
import { sendMessage } from './lib/send-message.ts';

const getProviders = (): AIApiEvents['getProviders'][1] => {
  return { providers: SUPPORTED_PROVIDERS };
};

const apiHandler = createApiHandler<AIApiEvents, UserSessionData>({
  createPersona,
  sendMessage,
  getProviders,
});

export const handleAIEndpoint = async <T extends AIMessageType>(options: {
  currentUser: UserSessionData;
  payload: AIMessagePayload<T>;
  type: T;
}): Promise<AIMessageResponse<T>> => {
  return await apiHandler(options, options.currentUser);
};

export type { AIProviderType } from './lib/providers/index.ts';
export { SUPPORTED_PROVIDERS } from './lib/providers/index.ts';
