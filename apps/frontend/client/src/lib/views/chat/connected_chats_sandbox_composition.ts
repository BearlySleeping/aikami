// apps/frontend/client/src/lib/views/chat/connected_chats_sandbox_composition.ts
//
// Production wiring for the /dev/connected-chats sandbox. Reuses the chat
// capability set and widens the connected-chats capability with `createLink`
// for the sandbox's demo-link seeding.

import * as appServices from '$services';
import { createChatCapabilities } from './chat_composition.ts';
import type { ChatViewModelPublicOptions } from './chat_view_model.svelte.ts';
import {
  type ConnectedChatsSandboxViewModel,
  createConnectedChatsSandboxViewModel,
} from './connected_chats_sandbox_view_model.svelte.ts';

/** Caller-facing options for the connected-chats sandbox factory. */
export type ConnectedChatsSandboxCompositionOptions = Omit<ChatViewModelPublicOptions, 'chatId'> & {
  chatId?: string;
};

/** Builds the connected-chats sandbox wired to the production singletons. */
export const getConnectedChatsSandboxViewModel = (
  options: ConnectedChatsSandboxCompositionOptions,
): ConnectedChatsSandboxViewModel =>
  createConnectedChatsSandboxViewModel({
    ...options,
    ...createChatCapabilities(),
    connectedChats: appServices.connectedChatsService,
  });
