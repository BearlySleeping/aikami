// apps/frontend/client/src/lib/views/chat/chat_composition.ts
//
// Production wiring for the chat feature. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// collaborators as typed capabilities so unit tests and the dev sandboxes
// never touch the global service registry.

import * as appServices from '$services';
import {
  type ChatViewModelInterface,
  type ChatViewModelOptions,
  type ChatViewModelPublicOptions,
  createChatViewModel,
} from './chat_view_model.svelte.ts';
import { getChoiceButtonsViewModel } from './choice_buttons_view_model.svelte.ts';
import { getSlashCommandAutocomplete } from './slash_command_autocomplete.svelte.ts';

/** The capability set the chat ViewModel requires, minus its public options. */
export type ChatCapabilities = Omit<ChatViewModelOptions, keyof ChatViewModelPublicOptions>;

/**
 * The production capabilities for the chat ViewModel. Exposed so dev
 * subclasses and sandboxes can build the same wiring without duplicating it.
 */
export const createChatCapabilities = (): ChatCapabilities => ({
  ai: appServices.aiService,
  auth: appServices.authService,
  chat: appServices.chatService,
  chatStorage: appServices.chatStorage,
  choiceHistory: appServices.choiceHistoryStore,
  connectedChats: appServices.connectedChatsService,
  dice: appServices.diceService,
  draft: appServices.draftStore,
  image: appServices.imageGenerationService,
  impersonation: appServices.impersonationService,
  messageBranch: appServices.messageBranchStore,
  npcService: appServices.npcService,
  persona: appServices.personaService,
  tts: appServices.ttsService,
  chunker: { create: () => new appServices.SentenceBoundaryChunker() },
  choiceButtons: { create: getChoiceButtonsViewModel },
  slashAutocomplete: { create: getSlashCommandAutocomplete },
});

/** Builds the chat ViewModel wired to the production service singletons. */
export const getChatViewModel = (options: ChatViewModelPublicOptions): ChatViewModelInterface =>
  createChatViewModel({ ...options, ...createChatCapabilities() });
