// apps/frontend/client/src/lib/views/chat/chat_enhancements_sandbox_composition.ts
//
// Production wiring for the /dev/chat-enhancements sandbox. Reuses the chat
// capability set; only this module imports the `$services` graph (through
// ./chat_composition.ts).

import { createChatCapabilities } from './chat_composition.ts';
import {
  type ChatEnhancementsSandboxViewModelOptions,
  createChatEnhancementsSandboxViewModel,
} from './chat_enhancements_sandbox_view_model.svelte.ts';
import type {
  ChatViewModelInterface,
  ChatViewModelPublicOptions,
} from './chat_view_model.svelte.ts';

/** Builds the enhancements sandbox wired to the production singletons. */
export const getChatEnhancementsSandboxViewModel = (
  options: ChatViewModelPublicOptions,
): ChatViewModelInterface => {
  const opts: ChatEnhancementsSandboxViewModelOptions = {
    ...options,
    ...createChatCapabilities(),
  };
  return createChatEnhancementsSandboxViewModel(opts);
};
