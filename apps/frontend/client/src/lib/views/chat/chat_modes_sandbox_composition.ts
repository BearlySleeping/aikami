// apps/frontend/client/src/lib/views/chat/chat_modes_sandbox_composition.ts
//
// Production wiring for the /dev/chat-modes sandbox. Reuses the chat
// capability set and adds the live-reply text generation service.

import * as appServices from '$services';
import { createChatCapabilities } from './chat_composition.ts';
import {
  type ChatModesSandboxViewModel,
  type ChatModesSandboxViewModelOptions,
  createChatModesSandboxViewModel,
} from './chat_modes_sandbox_view_model.svelte.ts';
import type { ChatViewModelPublicOptions } from './chat_view_model.svelte.ts';

/** Builds the modes sandbox wired to the production singletons. */
export const getChatModesSandboxViewModel = (
  options: ChatViewModelPublicOptions,
): ChatModesSandboxViewModel => {
  const opts: ChatModesSandboxViewModelOptions = {
    ...options,
    ...createChatCapabilities(),
    textGeneration: appServices.textGenerationService,
  };
  return createChatModesSandboxViewModel(opts);
};
