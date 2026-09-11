// apps/frontend/client/src/lib/views/chat/testing/chat_fixtures.ts
//
// Feature-owned test doubles for the chat ViewModel. Each builder returns a
// fresh object typed against the narrow capability contracts the ViewModel
// consumes (see ../chat_view_model.svelte.ts), so tests assert against explicit
// behavior instead of the global `$services` mock inventory.
//
// Operations that a test does not configure throw when called, so a test
// cannot pass by accident on a silent no-op.

import type { ChatMessage } from '$services';
import type { ChatCapabilities } from '../chat_composition.ts';
import type {
  ChatAiCapabilities,
  ChatAuthCapabilities,
  ChatStorageCapabilities,
  ChatStoreCapabilities,
  ChoiceButtonsCapabilities,
  ChoiceHistoryCapabilities,
  ChunkerCapabilities,
  ConnectedChatsCapabilities,
  DiceCapabilities,
  DraftCapabilities,
  ImageCapabilities,
  ImpersonationCapabilities,
  MessageBranchCapabilities,
  NpcCapabilities,
  PersonaCapabilities,
  SentenceChunker,
  SlashAutocompleteCapabilities,
  TtsCapabilities,
} from '../chat_view_model.svelte.ts';
import { ChoiceButtonsViewModel } from '../choice_buttons_view_model.svelte.ts';
import { SlashCommandAutocomplete } from '../slash_command_autocomplete.svelte.ts';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** A reactive chat store double with no messages. */
export const createChatStoreCapabilities = (
  overrides: Partial<ChatStoreCapabilities> = {},
): ChatStoreCapabilities => ({
  messages: [] as ChatMessage[],
  isLoading: false,
  isSending: false,
  isTyping: false,
  errorMessage: undefined,
  setSending: () => {},
  setTyping: () => {},
  setError: () => {},
  addMessage: () => {},
  setMessages: () => {},
  appendAIMessage: () => {},
  updateLastAIMessage: () => {},
  clear: () => {},
  ...overrides,
});

/** A dice double whose rolls throw until configured. */
export const createDiceCapabilities = (
  overrides: Partial<DiceCapabilities> = {},
): DiceCapabilities => ({
  rollCard: () => unconfigured('dice.rollCard'),
  rollD20: () => unconfigured('dice.rollD20'),
  ...overrides,
});

/** A no-op sentence-boundary chunker factory. */
export const createChunkerCapabilities = (): ChunkerCapabilities => ({
  create: (): SentenceChunker => ({
    onSentence: () => {},
    feed: () => {},
    close: () => {},
    reset: () => {},
  }),
});

/** Real choice-buttons child factory (the child is dependency-free). */
export const createChoiceButtonsCapabilities = (): ChoiceButtonsCapabilities => ({
  create: (options) => ChoiceButtonsViewModel.create(options),
});

/** Real slash-autocomplete child factory. */
export const createSlashAutocompleteCapabilities = (): SlashAutocompleteCapabilities => ({
  create: (options) => SlashCommandAutocomplete.create(options),
});

const inertAi = (): ChatAiCapabilities => ({ generateText: async () => ({ text: '' }) });
const inertAuth = (): ChatAuthCapabilities => ({ uid: 'test-uid' });
const inertStorage = (): ChatStorageCapabilities => ({
  getChatById: async () => undefined,
  addMessage: async () => {},
  getChat: async () => undefined,
  updateChat: async () => {},
});
const inertChoiceHistory = (): ChoiceHistoryCapabilities => ({ recordChoice: () => {} });
const inertConnectedChats = (): ConnectedChatsCapabilities => ({ crossPostOoc: async () => {} });
const inertDraft = (): DraftCapabilities => ({
  loadDraft: async () => '',
  saveDraft: async () => {},
  clearDraft: async () => {},
});
const inertImage = (): ImageCapabilities => ({
  generateImage: async () => ({ url: '', isDemo: false }),
});
const inertImpersonation = (): ImpersonationCapabilities => ({ generateDraft: async () => '' });
const inertMessageBranch = (): MessageBranchCapabilities => ({
  getActiveAlternative: () => undefined,
  clearAlternatives: () => {},
  swipeAlternative: () => {},
  addAlternative: () => {},
});
const inertNpc = (): NpcCapabilities => ({ get: async () => undefined });
const inertPersona = (): PersonaCapabilities => ({ getActivePersona: async () => undefined });
const inertTts = (): TtsCapabilities => ({
  speak: async () => {},
  stop: () => {},
  initialize: async () => {},
});

/**
 * Assembles a complete capability set for the chat ViewModel. Override any
 * capability by key; unconfigured destructive operations stay inert.
 */
export const createInertChatCapabilities = (
  overrides: Partial<ChatCapabilities> = {},
): ChatCapabilities => ({
  ai: inertAi(),
  auth: inertAuth(),
  chat: createChatStoreCapabilities(),
  chatStorage: inertStorage(),
  choiceHistory: inertChoiceHistory(),
  connectedChats: inertConnectedChats(),
  dice: createDiceCapabilities(),
  draft: inertDraft(),
  image: inertImage(),
  impersonation: inertImpersonation(),
  messageBranch: inertMessageBranch(),
  npcService: inertNpc(),
  persona: inertPersona(),
  tts: inertTts(),
  chunker: createChunkerCapabilities(),
  choiceButtons: createChoiceButtonsCapabilities(),
  slashAutocomplete: createSlashAutocompleteCapabilities(),
  ...overrides,
});
