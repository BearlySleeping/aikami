// apps/frontend/client/src/lib/views/chat/chat-view-model.svelte.ts

import {
  CYOA_AGENT_ID,
  IMPERSONATION_COMMAND,
  IMPERSONATION_DRAFT_READY_TOAST,
  NO_PERSONA_TOAST_MESSAGE,
  type SlashCommandEntry,
} from '@aikami/constants';
import type { EngineBridge } from '@aikami/frontend/engine';
import { parseBridgeTags } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { createStreamBuffer, parseLine, parseStreamChunk, type StreamBuffer } from '@aikami/parser';
import type { ChatData, CyoaChoice, MessageData, NpcData, NpcSuggestionChip } from '@aikami/types';
import type {
  AIServiceInterface,
  AuthServiceInterface,
  ChatMessage,
  ChatServiceInterface,
  ChatStorageInterface,
  ChoiceHistoryStoreInterface,
  ConnectedChatsServiceInterface,
  DiceServiceInterface,
  DraftStoreInterface,
  ImageGenerationServiceInterface,
  ImpersonationServiceInterface,
  MessageBranchStoreInterface,
  NpcServiceInterface,
  PersonaServiceInterface,
  TtsServiceInterface,
} from '$services';
import type { ImpersonationConfig } from '$types';
import type { AgentPipelineViewModelInterface } from '$views/agent/agent_pipeline_view_model.svelte';
import { parseRollCommand } from '../combat/utils/dice_notation.ts';
import type {
  ChoiceButtonsViewModelInterface,
  ChoiceButtonsViewModelOptions,
} from './choice_buttons_view_model.svelte.ts';
import type {
  SlashCommandAutocompleteInterface,
  SlashCommandAutocompleteOptions,
} from './slash_command_autocomplete.svelte.ts';

// ── Capability contracts ─────────────────────────────────────────────────

/** AI text generation used for chat turns and regeneration. */
export type ChatAiCapabilities = Pick<AIServiceInterface, 'sendMessageToAI'>;

/** Identity fields the chat ViewModel reads when persisting turns. */
export type ChatAuthCapabilities = Pick<AuthServiceInterface, 'uid'>;

/** Reactive chat message/state store backing the conversation surface. */
export type ChatStoreCapabilities = Pick<
  ChatServiceInterface,
  | 'messages'
  | 'isLoading'
  | 'isSending'
  | 'isTyping'
  | 'errorMessage'
  | 'setSending'
  | 'setTyping'
  | 'setError'
  | 'addMessage'
  | 'setMessages'
  | 'appendAIMessage'
  | 'updateLastAIMessage'
  | 'clear'
>;

/** Local chat persistence consumed by the ViewModel. */
export type ChatStorageCapabilities = Pick<
  ChatStorageInterface,
  'getChatById' | 'addMessage' | 'getChat' | 'updateChat'
>;

/** CYOA choice history recording. */
export type ChoiceHistoryCapabilities = Pick<ChoiceHistoryStoreInterface, 'recordChoice'>;

/** Connected-chats cross-posting. */
export type ConnectedChatsCapabilities = Pick<ConnectedChatsServiceInterface, 'crossPostOoc'>;

/** Dice resolution for `/roll` and ability checks. */
export type DiceCapabilities = Pick<DiceServiceInterface, 'rollCard' | 'rollD20'>;

/** Per-chat input draft persistence. */
export type DraftCapabilities = Pick<DraftStoreInterface, 'loadDraft' | 'saveDraft' | 'clearDraft'>;

/** Image generation for backgrounds and attachments. */
export type ImageCapabilities = Pick<ImageGenerationServiceInterface, 'generateImage'>;

/** Impersonation draft generation. */
export type ImpersonationCapabilities = Pick<ImpersonationServiceInterface, 'generateDraft'>;

/** Message alternative (swipe) tracking. */
export type MessageBranchCapabilities = Pick<
  MessageBranchStoreInterface,
  'getActiveAlternative' | 'clearAlternatives' | 'swipeAlternative' | 'addAlternative'
>;

/** NPC lookup for resolving the chat's character. */
export type NpcCapabilities = Pick<NpcServiceInterface, 'get'>;

/** Active-persona lookup for impersonation drafting. */
export type PersonaCapabilities = Pick<PersonaServiceInterface, 'getActivePersona'>;

/** Text-to-speech playback for chat messages. */
export type TtsCapabilities = Pick<TtsServiceInterface, 'speak' | 'stop' | 'initialize'>;

/** Sentence-boundary chunker contract (streaming TTS pipeline). */
export type SentenceChunker = {
  onSentence(listener: (event: { sentence: string }) => void): void;
  feed(text: string): void;
  close(): void;
  reset(): void;
};

/** Factory for a per-chat sentence-boundary chunker. */
export type ChunkerCapabilities = {
  create(): SentenceChunker;
};

/** Factory for the composed CYOA choice-buttons child ViewModel. */
export type ChoiceButtonsCapabilities = {
  create(options: ChoiceButtonsViewModelOptions): ChoiceButtonsViewModelInterface;
};

/** Factory for the composed slash-command autocomplete child ViewModel. */
export type SlashAutocompleteCapabilities = {
  create(options: SlashCommandAutocompleteOptions): SlashCommandAutocompleteInterface;
};

/** Options accepted by callers of the production factory (no wiring). */
export type ChatViewModelPublicOptions = BaseViewModelOptions & {
  /** The chat document ID to load. */
  chatId: string;
  /** The NPC ID (from URL query param). If omitted, resolved from the chat document. */
  npcId?: string;
  /** Entity ID of the NPC in the game engine (for expression macros). */
  gameEntityId?: number;
  /** Optional agent pipeline ViewModel for pre/post agent orchestration (C-236). */
  agentPipelineViewModel?: AgentPipelineViewModelInterface;
};

export type ChatViewModelOptions = ChatViewModelPublicOptions & {
  /** AI text generation. */
  ai: ChatAiCapabilities;
  /** Identity fields. */
  auth: ChatAuthCapabilities;
  /** Reactive chat store. */
  chat: ChatStoreCapabilities;
  /** Local chat persistence. */
  chatStorage: ChatStorageCapabilities;
  /** CYOA choice history. */
  choiceHistory: ChoiceHistoryCapabilities;
  /** Connected-chats cross-posting. */
  connectedChats: ConnectedChatsCapabilities;
  /** Dice resolution. */
  dice: DiceCapabilities;
  /** Draft persistence. */
  draft: DraftCapabilities;
  /** Image generation. */
  image: ImageCapabilities;
  /** Impersonation drafting. */
  impersonation: ImpersonationCapabilities;
  /** Message branch tracking. */
  messageBranch: MessageBranchCapabilities;
  /** NPC lookup. */
  npcService: NpcCapabilities;
  /** Active persona lookup. */
  persona: PersonaCapabilities;
  /** Text-to-speech. */
  tts: TtsCapabilities;
  /** Sentence-boundary chunker factory. */
  chunker: ChunkerCapabilities;
  /** CYOA choice-buttons child factory. */
  choiceButtons: ChoiceButtonsCapabilities;
  /** Slash-command autocomplete child factory. */
  slashAutocomplete: SlashAutocompleteCapabilities;
};

export type ChatViewModelInterface = BaseViewModelInterface & {
  readonly npc?: NpcData;
  readonly chatData?: {
    affection: number;
    stats: Record<string, unknown>;
    backgroundImageUrl?: string;
  };
  readonly isLoading: boolean;
  readonly isSending: boolean;
  readonly isTyping: boolean;
  readonly chatError: string | undefined;
  readonly errorMessage: string | undefined;
  readonly messages: ChatMessage[];
  readonly showGreeting: boolean;
  readonly isGeneratingImage: boolean;
  readonly isPlayingTts: boolean;
  readonly backgroundImageUrl: string | undefined;
  /** Current text in the chat input field (draft-aware). */
  inputText: string;
  /** Whether streaming TTS is enabled for this chat. */
  readonly streamingTtsEnabled: boolean;
  /** Impersonation drafting configuration. */
  readonly impersonationConfig: ImpersonationConfig;
  /** Whether an impersonation draft is currently being generated. */
  readonly isImpersonationDrafting: boolean;
  /** Slash command autocomplete completions (filtered by current input). */
  readonly slashCompletions: readonly SlashCommandEntry[];
  /** Index of the currently selected autocomplete item (-1 = none). */
  readonly selectedSlashCompletion: number;
  /** Whether the autocomplete popup should be shown. */
  readonly showSlashCompletions: boolean;
  /** Toast notification message (e.g. 'Copied!'). */
  readonly toastMessage: string;
  /** CYOA choice buttons ViewModel (C-245) — rendered below the latest AI message. */
  readonly choiceButtonsViewModel: ChoiceButtonsViewModelInterface;
  /** Whether "Use CYOA as direction" feeds choices into impersonation drafts (C-245 AC-6). */
  readonly useCyoaAsDirection: boolean;
  /** Toggles the "Use CYOA as direction" impersonation integration. */
  toggleUseCyoaAsDirection(): void;
  loadChatHistory(chat: ChatData): Promise<void>;
  sendMessage(text: string): Promise<void>;
  editMessage(messageId: string, newText: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  regenerateMessage(messageId: string): Promise<void>;
  /** Swipe between alternative AI responses for a message. */
  swipeAlternative(messageId: string, direction: 'left' | 'right'): void;
  /** Copy message text to clipboard with toast feedback. */
  copyMessage(text: string): Promise<void>;
  /** Fork a new chat from the given message (placeholder). */
  branchFromMessage(messageId: string): void;
  /** Saves the current input to the per-chat draft store. */
  onInputChange(text: string): void;
  /** Shows a toast notification that auto-dismisses. */
  showToast(message: string): void;
  /** Triggers an impersonation draft (quick button). */
  handleImpersonateDraft(): Promise<void>;
  /** Toggles the impersonation quick button visibility. */
  toggleImpersonationQuickButton(): void;
  /** Navigate the slash command autocomplete selection up (-1) or down (+1). */
  navigateSlashCompletion(delta: number): void;
  /** Select a specific completion by index and apply it. */
  selectAndApplySlashCompletion(index: number): void;
  /** Registers a callback to focus the chat textarea (called from the view). */
  setFocusTextareaCallback(callback: () => void): void;
  /** Apply the selected slash completion to the input field. */
  applySlashCompletion(): void;
  /** Toggles streaming TTS on/off for this chat. */
  toggleStreamingTts(): void;
  /** Sends current input text as a user message (convenience). */
  handleSend(): void;
  /** Handles keydown events on the chat input (Enter to send). */
  handleKeyDown(event: KeyboardEvent): void;
  /** Dispatches a message-level action from the inline action bar. */
  handleMessageAction(
    messageId: string,
    action: 'copy' | 'retry' | 'edit' | 'delete' | 'branch' | 'speak',
  ): void;
  /** Scrollable message container — bound by View via bind:this. */
  messageContainerElement: HTMLDivElement | undefined;
  generateImage(prompt: string): Promise<string>;
  playTts(messageId: string): Promise<void>;
  stopTts(): void;
  attachFile(messageId: string, file: File): Promise<void>;
  updateAffection(change: number): Promise<void>;
  rollPerception(): Promise<{ roll: number; total: number }>;
  rollPersuasion(context?: string): Promise<{ roll: number; total: number }>;
  generateBackground(prompt?: string): Promise<void>;
  dismissGreeting(): void;
  clearChat(): void;
};

export class ChatViewModel
  extends BaseViewModel<ChatViewModelOptions>
  implements ChatViewModelInterface
{
  npc: NpcData | undefined = $state();
  chat: ChatData | undefined = $state();
  errorMessage: string | undefined = $state();

  private _chatId: string;
  private _npcId: string | undefined;

  protected readonly _ai: ChatAiCapabilities;
  protected readonly _auth: ChatAuthCapabilities;
  protected readonly _chat: ChatStoreCapabilities;
  protected readonly _chatStorage: ChatStorageCapabilities;
  protected readonly _choiceHistory: ChoiceHistoryCapabilities;
  protected readonly _connectedChats: ConnectedChatsCapabilities;
  protected readonly _dice: DiceCapabilities;
  protected readonly _draft: DraftCapabilities;
  protected readonly _image: ImageCapabilities;
  protected readonly _impersonation: ImpersonationCapabilities;
  protected readonly _messageBranch: MessageBranchCapabilities;
  protected readonly _npcService: NpcCapabilities;
  protected readonly _persona: PersonaCapabilities;
  protected readonly _tts: TtsCapabilities;

  showGreeting = $state(true);
  chatData = $state<
    { affection: number; stats: Record<string, unknown>; backgroundImageUrl?: string } | undefined
  >();
  isGeneratingImage = $state(false);
  isPlayingTts = $state(false);
  backgroundImageUrl = $state<string | undefined>();
  /** Current input text (draft-aware, bound to textarea). */
  inputText = $state('');
  /** Whether streaming TTS is enabled for this chat. */
  streamingTtsEnabled = $state(false);
  /** Impersonation drafting configuration (per-chat client state). */
  impersonationConfig = $state<ImpersonationConfig>({
    quickButtonEnabled: false,
    promptTemplate: '',
    skipAgents: false,
  });
  /** Whether an impersonation draft is currently being generated. */
  isImpersonationDrafting = $state(false);
  /** Toast notification message — auto-clears after display. */
  toastMessage = $state('');
  /** Whether CYOA choices feed the impersonation draft instead of posting (C-245 AC-6). */
  useCyoaAsDirection = $state(false);

  /** CYOA choice buttons ViewModel — owns display state for the choice stack. */
  readonly choiceButtonsViewModel: ChoiceButtonsViewModelInterface;

  /** Slash-command autocomplete sub-service — owns completion state + navigation (C-425). */
  private readonly _slashAutocomplete: SlashCommandAutocompleteInterface;

  /** Suggestion chips shown above the composer (C-420). */
  suggestedChips = $state<NpcSuggestionChip[]>([]);

  /** Sentence boundary chunker for streaming TTS. */
  protected readonly _chunker: SentenceChunker;

  /** Internal flag: whether TTS has been initialised for this chat session. */
  private _ttsInitialised = false;

  /** The NPC's entity ID in the game engine, for expression macro routing. */
  private _gameEntityId: number | undefined;

  /** Cached engine bridge — lazily created on first use. */
  private _engineBridge: EngineBridge | undefined;

  /** Optional agent pipeline ViewModel (C-236). */
  private _agentPipelineViewModel: AgentPipelineViewModelInterface | undefined;

  /**
   * Lazily initializes and caches the engine bridge.
   * Uses dynamic import so the engine is not statically bundled.
   */
  private async _getEngineBridge(): Promise<EngineBridge> {
    if (!this._engineBridge) {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      this._engineBridge = createEngineBridge();
    }
    return this._engineBridge;
  }

  constructor(options: ChatViewModelOptions) {
    super(options);
    this._chatId = options.chatId;
    this._npcId = options.npcId;
    this._gameEntityId = options.gameEntityId;
    this._agentPipelineViewModel = options.agentPipelineViewModel;
    this._ai = options.ai;
    this._auth = options.auth;
    this._chat = options.chat;
    this._chatStorage = options.chatStorage;
    this._choiceHistory = options.choiceHistory;
    this._connectedChats = options.connectedChats;
    this._dice = options.dice;
    this._draft = options.draft;
    this._image = options.image;
    this._impersonation = options.impersonation;
    this._messageBranch = options.messageBranch;
    this._npcService = options.npcService;
    this._persona = options.persona;
    this._tts = options.tts;
    this._chunker = options.chunker.create();
    this.choiceButtonsViewModel = options.choiceButtons.create({
      className: 'ChoiceButtonsViewModel',
      choices: [],
      onSelect: (choice) => this._handleChoiceSelected(choice),
    });
    this._slashAutocomplete = options.slashAutocomplete.create({
      className: 'SlashCommandAutocomplete',
      onApply: (commandName) => {
        this.inputText = `/${commandName} `;
        this._focusTextarea?.();
      },
    });
  }

  /** Slash command completions for current input (delegated to sub-service). */
  get slashCompletions(): readonly SlashCommandEntry[] {
    return this._slashAutocomplete.completions;
  }

  /** Selected index in the completions list (-1 = nothing selected). */
  get selectedSlashCompletion(): number {
    return this._slashAutocomplete.selectedIndex;
  }

  /** Whether to show the autocomplete popup. */
  get showSlashCompletions(): boolean {
    return this._slashAutocomplete.visible;
  }

  override async dispose(): Promise<void> {
    // Dispose the composed sub-service so its reactive roots are torn down
    // with the parent (C-425 lifecycle gotcha).
    await this._slashAutocomplete.dispose();
    return super.dispose();
  }

  /** Scrollable message container — bound by View via bind:this. */
  messageContainerElement = $state.raw<HTMLDivElement | undefined>(undefined);

  override async initialize(): Promise<void> {
    // Restore per-chat input draft from IndexedDB
    const draft = await this._draft.loadDraft({ chatId: this._chatId });
    if (draft) {
      this.inputText = draft;
    }

    // Wire streaming TTS — chunker feeds sentences to ttsService
    if (!this._ttsInitialised) {
      this._ttsInitialised = true;
      this._chunker.onSentence(({ sentence }) => {
        if (this.streamingTtsEnabled) {
          this._tts.speak({ text: sentence }).catch(() => {});
        }
      });
      // Fire-and-forget TTS worker init
      void this._tts.initialize();
    }
    // Register reactive effects for DOM interactions
    this.registerEffectRoot(() => {
      // Auto-scroll to bottom is owned by RichMessageList (C-424).

      // Auto-save input draft on each keystroke (bind:value bypasses onInputChange)
      $effect(() => {
        const text = this.inputText;
        if (text.length > 0) {
          void this._draft.saveDraft({ chatId: this._chatId, text });
        }
      });
    });

    // If NPC and chat already set by a dev subclass, skip real database lookup
    if (this.npc && this.chat) {
      await this.loadChatHistory(this.chat);
      return super.initialize();
    }

    const chatDataLookup = await this._chatStorage.getChatById({ chatId: this._chatId });
    if (!chatDataLookup) {
      this.error('Chat not found', { chatId: this._chatId });
      this.errorMessage = 'Chat not found';
      return super.initialize();
    }

    const resolvedNpcId = this._npcId ?? (chatDataLookup as { npcId?: string }).npcId;
    if (resolvedNpcId) {
      this.npc = await this._npcService.get({ npcId: resolvedNpcId });
      if (!this.npc) {
        this.error('NPC not found', { npcId: resolvedNpcId });
        this.errorMessage = 'NPC not found';
        return super.initialize();
      }
    }

    const chatData: ChatData = {
      id: chatDataLookup.id,
      npcId: (chatDataLookup as { npcId?: string }).npcId ?? '',
      npcName: (chatDataLookup as { npcName?: string }).npcName ?? '',
      npcAvatarUrl: (chatDataLookup as { npcAvatarUrl?: string }).npcAvatarUrl,
      uid: (chatDataLookup as { uid?: string }).uid ?? '',
      visibility: (chatDataLookup as { visibility?: 'private' | 'public' }).visibility ?? 'private',
      messages: (chatDataLookup as { messages?: MessageData[] }).messages ?? [],
      messageCount: (chatDataLookup as { messageCount?: number }).messageCount ?? 0,
      affection: (chatDataLookup as { affection?: number }).affection ?? 0,
      stats: (chatDataLookup as { stats?: Record<string, unknown> }).stats ?? {},
      backgroundImageUrl: (chatDataLookup as { backgroundImageUrl?: string }).backgroundImageUrl,
    };
    this.chat = chatData;
    await this.loadChatHistory(chatData);

    return super.initialize();
  }

  get isLoading() {
    return this._chat.isLoading;
  }
  get isSending() {
    return this._chat.isSending;
  }
  get isTyping() {
    return this._chat.isTyping;
  }
  get chatError() {
    return this.errorMessage ?? this._chat.errorMessage;
  }
  /**
   * Enhanced message list with alternative tracking.
   * Reads from the reactive this._chat.messages so that additions
   * (e.g. from dev sandbox overrides) are immediately reflected.
   */
  get messages(): ChatMessage[] {
    return this._chat.messages.map((msg) => {
      const messageId = msg.id || crypto.randomUUID();
      const activeAlt = this._messageBranch.getActiveAlternative(messageId);
      return {
        id: messageId,
        text: activeAlt ?? msg.text,
        sender: msg.sender,
        timestamp: msg.timestamp,
        kind: msg.kind,
        dice: msg.dice,
      };
    });
  }

  async loadChatHistory(chat: ChatData): Promise<void> {
    this.chatData = {
      affection: chat.affection ?? 0,
      stats: chat.stats ?? {},
      backgroundImageUrl: chat.backgroundImageUrl,
    };
    this.backgroundImageUrl = chat.backgroundImageUrl;
    this._chat.setMessages(chat.messages as unknown as MessageData[]); // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    this.showGreeting = (chat.messages?.length ?? 0) === 0;
  }

  /**
   * Sends the current input text as a user message.
   * Convenience overload — delegates to the text-parameter
   * version. Used by the View's send button / Enter handler.
   */
  handleSend(): void {
    const text = this.inputText.trim();
    if (!text || this.isSending) {
      return;
    }
    void this.sendMessage(text);
  }

  /**
   * Handles keydown events on the chat input.
   * Enter submits; Shift+Enter inserts newline.
   */
  handleKeyDown(event: KeyboardEvent): void {
    // ── Slash command autocomplete keyboard navigation ──
    if (this.showSlashCompletions) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.navigateSlashCompletion(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.navigateSlashCompletion(-1);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        this.applySlashCompletion();
        return;
      }
      if (event.key === 'Escape') {
        this._slashAutocomplete.dismiss();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  /**
   * Dispatches a message-level action from the inline action bar
   * to the appropriate ViewModel method.
   */
  handleMessageAction(
    messageId: string,
    action: 'copy' | 'retry' | 'edit' | 'delete' | 'branch' | 'speak',
  ): void {
    switch (action) {
      case 'copy': {
        const msg = this._chat.messages.find((m) => m.id === messageId);
        if (msg) {
          void this.copyMessage(msg.text);
        }
        break;
      }
      case 'retry':
        void this.regenerateMessage(messageId);
        break;
      case 'delete':
        void this.deleteMessage(messageId);
        break;
      case 'branch':
        this.branchFromMessage(messageId);
        break;
      case 'speak':
        void this.playTts(messageId);
        break;
      // edit is handled inline by the View, not dispatched here
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.npc) {
      return;
    }
    this.showGreeting = false;

    // ── Parser intercept: slash commands ──
    if (text.startsWith('/')) {
      const parsed = parseLine(text);
      if (parsed.command) {
        const { command, args } = parsed.command;
        this.debug('command detected', { command, args });

        // ── Impersonation command — draft, don't send ──
        if (command === IMPERSONATION_COMMAND) {
          const direction = args.length > 0 ? args.join(' ') : '';
          await this._handleImpersonateCommand(direction);
          return;
        }

        // ── Dice roll command (C-421) — resolve through DiceService, not the bridge ──
        if (command === 'roll') {
          this._handleRollCommand(args.join(' '));
          // Clear the input and draft for both valid and invalid roll notation.
          this.inputText = '';
          void this._draft.clearDraft({ chatId: this._chatId });
          return;
        }

        // Dispatch to game engine bridge
        const bridge = await this._getEngineBridge();
        bridge.executeCommand(command, args);

        // Echo a local system message into the chat
        this._chat.addMessage({
          id: crypto.randomUUID(),
          text: `Command: ${parsed.command.raw}`,
          sender: 'ai',
          timestamp: new Date(),
        });
        return; // Do NOT send to AI
      }
    }

    // ── Bridge tag parsing (C-244) — extract notes/influences/ooc ──
    const tagResult = parseBridgeTags(text);
    if (
      tagResult.notes.length > 0 ||
      tagResult.influences.length > 0 ||
      tagResult.oocContents.length > 0
    ) {
      // Use cleaned content for the displayed/sent message
      text = tagResult.cleanContent || text;

      // Handle OOC cross-posting asynchronously
      void this._connectedChats.crossPostOoc({
        targetChatId: this._chatId,
        oocContents: tagResult.oocContents,
      });

      // Notes and influences are added via the UI (connected chats settings panel).
      // The tag parser extracts them but we store in-message metadata only.
      // Actual ChatLink update happens via ConnectedChatsService UI.
    }

    // ── Normal AI message flow ──
    this._chat.setSending(true);
    this._chat.setTyping(true);
    this._chat.setError(undefined);
    const userMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'user' as const,
      timestamp: new Date(),
    };
    this._chat.addMessage(userMessage);
    await this._saveMessage(text, 'user');

    // Clear the per-chat draft since the message was sent
    void this._draft.clearDraft({ chatId: this._chatId });
    this.inputText = '';

    // Stream buffer for incremental macro parsing (future streaming use)
    const streamBuf: StreamBuffer = createStreamBuffer();

    try {
      // ── Agent Pipeline (C-236): wrap AI call through pre/post agents ──
      const pipelineVm = this._agentPipelineViewModel;
      const generateResponse = async (): Promise<string | undefined> =>
        this._ai.sendMessageToAI(text, this.npc ?? undefined);

      // Any previously rendered choices are stale once a new turn starts
      this.choiceButtonsViewModel.setChoices([]);

      const rawResponse: string | undefined = pipelineVm
        ? await pipelineVm.runPipeline({
            chatId: this._chatId,
            userMessage: text,
            systemPrompt: '',
            mainGenerator: async () => {
              const resp = await generateResponse();
              return resp ?? '';
            },
            npcId: this._npcId,
          })
        : await generateResponse();

      // ── CYOA choices (C-245): surface post-agent output as buttons ──
      if (pipelineVm) {
        this._applyCyoaResults(pipelineVm.results);
      }

      const response = rawResponse || undefined;
      if (response) {
        // Process macros from the AI response
        const chunkResult = parseStreamChunk(response, streamBuf);

        // Dispatch any macros to the engine bridge
        const bridge = await this._getEngineBridge();
        for (const macro of chunkResult.macros) {
          this.debug('macro in response', {
            name: macro.name,
            args: macro.args,
            entityId: this._gameEntityId,
          });
          bridge.triggerMacro(macro.name, macro.args, this._gameEntityId);
        }

        const displayText = chunkResult.displayText;
        // Show clean text (macros stripped) in the UI
        this._chat.appendAIMessage(displayText);
        await this._saveMessage(displayText, 'ai');

        // Feed through sentence boundary chunker for streaming TTS
        if (this.streamingTtsEnabled) {
          this._chunker.feed(displayText);
          this._chunker.close();
        }
      }
    } catch {
      this._chat.setError('Failed to get response from AI');
    } finally {
      this._chat.setSending(false);
      this._chat.setTyping(false);
    }
  }

  async editMessage(messageId: string, newText: string): Promise<void> {
    const msgs = [...this._chat.messages] as unknown as MessageData[]; // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }

    // Editing an AI message invalidates any choices derived from it (C-245)
    if (msgs[idx].sender === 'ai') {
      this.choiceButtonsViewModel.dismiss();
    }
    msgs[idx] = { ...msgs[idx], text: newText };
    this._chat.setMessages(msgs);
    await this._persistMessages(msgs);
  }

  async deleteMessage(messageId: string): Promise<void> {
    // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    const msgs = (this._chat.messages as unknown as MessageData[]).filter(
      (m) => m.id !== messageId,
    );
    this._chat.setMessages(msgs);
    await this._persistMessages(msgs);
    // Clean up any alternatives for the deleted message
    this._messageBranch.clearAlternatives(messageId);
  }

  swipeAlternative(messageId: string, direction: 'left' | 'right'): void {
    this._messageBranch.swipeAlternative({ messageId, direction });
    // Choices were generated for the previously displayed branch —
    // agent results are not tracked per-branch, so hide them (C-245).
    this.choiceButtonsViewModel.dismiss();
  }

  async copyMessage(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for insecure contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.showToast('Copied!');
    } catch {
      this.showToast('Copy failed');
    }
  }

  branchFromMessage(_messageId: string): void {
    // Placeholder: creates a new chat fork.
    // Full fork semantics are out of scope for C-231.
    this.showToast('Branch created!');
  }

  onInputChange(text: string): void {
    this.inputText = text;

    // ── Slash command autocomplete ──
    this._slashAutocomplete.update(text);

    // Debounced save — fire-and-forget so input feels instant
    void this._draft.saveDraft({ chatId: this._chatId, text });
  }

  showToast(message: string): void {
    this.toastMessage = message;
    // Auto-clear after 2 seconds
    setTimeout(() => {
      if (this.toastMessage === message) {
        this.toastMessage = '';
      }
    }, 2000);
  }

  toggleStreamingTts(): void {
    this.streamingTtsEnabled = !this.streamingTtsEnabled;
    if (!this.streamingTtsEnabled) {
      this._tts.stop();
    }
  }

  /**
   * Triggers an impersonation draft via the quick button (empty direction).
   * Generates a purely context-based draft — "what would my character do?"
   */
  async handleImpersonateDraft(): Promise<void> {
    if (this.isImpersonationDrafting) {
      return;
    }

    const persona = await this._persona.getActivePersona();
    if (!persona) {
      this.showToast(NO_PERSONA_TOAST_MESSAGE);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = this._chat.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await this._impersonation.generateDraft({
        personaName: persona.name,
        personaTraits: persona.personalityTraits ?? '',
        recentMessages,
      });

      this.inputText = draft;
      this.showToast(IMPERSONATION_DRAFT_READY_TOAST);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.error('handleImpersonateDraft:failed', { message });
      this.showToast(`Impersonation draft failed: ${message}`);
    } finally {
      this.isImpersonationDrafting = false;
    }
  }

  /**
   * Toggles the impersonation quick-button visibility in the chat input bar.
   */
  toggleImpersonationQuickButton(): void {
    this.impersonationConfig = {
      ...this.impersonationConfig,
      quickButtonEnabled: !this.impersonationConfig.quickButtonEnabled,
    };
  }

  /**
   * Toggles whether a selected CYOA choice feeds the impersonation
   * draft pipeline instead of posting directly as a user message.
   */
  toggleUseCyoaAsDirection(): void {
    this.useCyoaAsDirection = !this.useCyoaAsDirection;
  }

  /**
   * Extracts CYOA choices from the latest pipeline post-agent results
   * and feeds them to the choice buttons ViewModel. Malformed or failed
   * CYOA results leave the UI hidden (empty choice set).
   */
  private _applyCyoaResults(
    results: ReadonlyArray<{ agentId: string; success: boolean; output?: unknown }>,
  ): void {
    const cyoaResult = results.find((r) => r.agentId === CYOA_AGENT_ID);
    if (!cyoaResult?.success || !cyoaResult.output) {
      return;
    }

    const output = cyoaResult.output as { type?: string; choices?: CyoaChoice[] };
    if (output.type !== 'cyoa_choices' || !Array.isArray(output.choices)) {
      return;
    }

    this.choiceButtonsViewModel.setChoices(output.choices);
  }

  /**
   * Handles a CYOA choice selection: records it to the per-chat history
   * and either posts it as a user message or feeds it to the
   * impersonation draft when "Use CYOA as direction" is active (AC-6).
   */
  private _handleChoiceSelected(choice: CyoaChoice): void {
    const useDirection = this.useCyoaAsDirection && this.impersonationConfig.quickButtonEnabled;

    this._choiceHistory.recordChoice({
      chatId: this._chatId,
      entry: {
        choiceId: choice.id,
        label: choice.label,
        selectedAt: Date.now(),
        ...(useDirection ? { context: 'impersonation' } : {}),
      },
    });

    if (useDirection) {
      void this._draftChoiceAsDirection(choice);
      return;
    }

    void this.sendMessage(choice.label);
  }

  /**
   * Feeds the choice label to the impersonation draft pipeline (AC-6).
   * On failure, falls back to posting the label as a plain user message.
   */
  private async _draftChoiceAsDirection(choice: CyoaChoice): Promise<void> {
    if (this.isImpersonationDrafting) {
      return;
    }

    const persona = await this._persona.getActivePersona();
    if (!persona) {
      // No persona — fall back to plain posting
      void this.sendMessage(choice.label);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = this._chat.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await this._impersonation.generateDraft({
        personaName: persona.name,
        personaTraits: persona.personalityTraits ?? '',
        recentMessages,
        direction: choice.label,
      });

      this.inputText = draft;
      this.showToast(IMPERSONATION_DRAFT_READY_TOAST);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.error('_draftChoiceAsDirection:failed', { message });
      // Fallback: post the choice label as a plain user message
      void this.sendMessage(choice.label);
    } finally {
      this.isImpersonationDrafting = false;
    }
  }

  /**
   * Navigates the slash command autocomplete selection.
   * @param delta — -1 to move up, +1 to move down.
   */
  navigateSlashCompletion(delta: number): void {
    this._slashAutocomplete.navigate(delta);
  }

  /**
   * Applies the currently selected slash completion to the input.
   * Replaces the current `/partial` with `/commandName ` and
   * dismisses the autocomplete popup.
   */
  applySlashCompletion(): void {
    this._slashAutocomplete.apply();
  }

  /** Callback registered by the view to focus the textarea. */
  private _focusTextarea?: () => void;

  /** Registers a callback to focus the chat textarea (called from the view). */
  setFocusTextareaCallback(callback: () => void): void {
    this._focusTextarea = callback;
  }

  /**
   * Selects a completion by index and immediately applies it.
   */
  selectAndApplySlashCompletion(index: number): void {
    this._slashAutocomplete.selectAndApply(index);
  }

  /**
   * Handles the /impersonate slash command from sendMessage().
   * Generates a draft as the player persona, places it in the input field.
   */
  private async _handleImpersonateCommand(direction: string): Promise<void> {
    if (this.isImpersonationDrafting) {
      return;
    }

    const persona = await this._persona.getActivePersona();
    if (!persona) {
      this.showToast(NO_PERSONA_TOAST_MESSAGE);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = this._chat.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await this._impersonation.generateDraft({
        personaName: persona.name,
        personaTraits: persona.personalityTraits ?? '',
        recentMessages,
        direction: direction || undefined,
      });

      this.inputText = draft;
      this.showToast(IMPERSONATION_DRAFT_READY_TOAST);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.error('_handleImpersonateCommand:failed', { message });
      this.showToast(`Impersonation draft failed: ${message}`);
    } finally {
      this.isImpersonationDrafting = false;
    }
  }

  /**
   * Handles the `/roll` slash command (C-421). Parses notation with an optional
   * `vs <dc>` check, resolves through DiceService, and adds a dice chat message.
   * Malformed notation produces a clear inline error and no roll.
   */
  private _handleRollCommand(input: string): void {
    const parsed = parseRollCommand(input);
    if (!parsed) {
      this._chat.addMessage({
        id: crypto.randomUUID(),
        text: `Invalid dice notation: "${input.trim()}". Try /roll 1d20+3 or /roll 2d6 vs 10.`,
        sender: 'ai',
        timestamp: new Date(),
      });
      return;
    }

    const card = this._dice.rollCard({
      notation: parsed.notation,
      count: parsed.count,
      sides: parsed.sides,
      modifier: parsed.modifier,
      ...(parsed.dc !== undefined ? { dc: parsed.dc } : {}),
    });

    this._chat.addMessage({
      id: crypto.randomUUID(),
      text: card.notation,
      sender: 'ai',
      timestamp: new Date(),
      kind: 'dice',
      dice: card,
    });
  }

  async regenerateMessage(messageId: string): Promise<void> {
    const msgs = [...this._chat.messages] as unknown as MessageData[]; // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1 || msgs[idx].sender !== 'ai') {
      return;
    }
    this._chat.setTyping(true);
    try {
      const context = msgs
        .slice(0, idx)
        .map((m) => m.text)
        .join('\n');
      const response = await this._ai.sendMessageToAI(
        `Regenerate your response. Context: ${context}`,
        this.npc,
      );
      if (response) {
        // Store the current response as an alternative before replacing
        this._messageBranch.addAlternative({
          messageId,
          currentText: msgs[idx].text,
          newText: response,
        });
        msgs[idx] = { ...msgs[idx], text: response };
        this._chat.setMessages(msgs);
        await this._persistMessages(msgs);

        // Regenerated response invalidates choices from the old response (C-245)
        this.choiceButtonsViewModel.dismiss();

        // Feed through chunker for streaming TTS
        if (this.streamingTtsEnabled) {
          this._chunker.feed(response);
          this._chunker.close();
        }
      }
    } catch {
      this._chat.setError('Failed to regenerate message');
    } finally {
      this._chat.setTyping(false);
    }
  }

  async generateImage(prompt: string): Promise<string> {
    this.isGeneratingImage = true;
    try {
      return (await this._image.generateImage({ prompt })).url;
    } finally {
      this.isGeneratingImage = false;
    }
  }

  async playTts(messageId: string): Promise<void> {
    const msg = (this._chat.messages as unknown as MessageData[]).find((m) => m.id === messageId); // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    if (!msg) {
      return;
    }
    this.isPlayingTts = true;
    try {
      await this._tts.speak({ text: msg.text });
    } catch {
      // Worker/server synthesis failure — playback simply did not start.
    } finally {
      this.isPlayingTts = false;
    }
  }

  stopTts(): void {
    this._tts.stop();
    this.isPlayingTts = false;
  }

  async attachFile(messageId: string, file: File): Promise<void> {
    const msgs = [...this._chat.messages] as unknown as MessageData[]; // guard-ignore lint/type-safety/casting: chat service message array typed as readonly; runtime mutation safe within VM scope
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }
    const url = URL.createObjectURL(file);
    msgs[idx] = {
      ...msgs[idx],
      attachments: [...(msgs[idx].attachments ?? []), { type: 'file', url, name: file.name }],
    };
    this._chat.setMessages(msgs);
    await this._persistMessages(msgs);
  }

  async updateAffection(change: number): Promise<void> {
    if (!this.chatData) {
      return;
    }
    this.chatData = { ...this.chatData, affection: (this.chatData.affection ?? 0) + change };
  }

  async rollPerception(): Promise<{ roll: number; total: number }> {
    const wisdom = 3;
    const result = this._dice.rollD20(wisdom);
    this._chat.addMessage({
      id: crypto.randomUUID(),
      text: `Perception check: rolled ${result.natural} + ${wisdom} = ${result.total}`,
      sender: 'ai',
      timestamp: new Date(),
    });
    return { roll: result.natural, total: result.total };
  }

  async rollPersuasion(context?: string): Promise<{ roll: number; total: number }> {
    const charisma = 3;
    const result = this._dice.rollD20(charisma);
    const ctx = context ? ` Attempting to persuade: ${context}` : '';
    this._chat.addMessage({
      id: crypto.randomUUID(),
      text: `Persuasion check: rolled ${result.natural} + ${charisma} = ${result.total}${ctx}`,
      sender: 'ai',
      timestamp: new Date(),
    });
    return { roll: result.natural, total: result.total };
  }

  async generateBackground(prompt?: string): Promise<void> {
    this.isGeneratingImage = true;
    try {
      const bg = prompt ?? `Fantasy chat background, ${this.npc?.name ?? 'mysterious'} atmosphere`;
      const result = await this._image.generateImage({ prompt: bg });
      this.backgroundImageUrl = result.url;
      if (this.chatData) {
        this.chatData.backgroundImageUrl = result.url;
      }
    } finally {
      this.isGeneratingImage = false;
    }
  }

  dismissGreeting(): void {
    this.showGreeting = false;
  }

  clearChat(): void {
    this._chat.clear();
    this.showGreeting = true;
    this.inputText = '';
    this.choiceButtonsViewModel.setChoices([]);
    void this._draft.clearDraft({ chatId: this._chatId });

    // TTS cleanup
    this._tts.stop();
    this._chunker.reset();
  }

  private async _saveMessage(text: string, sender: 'user' | 'ai'): Promise<void> {
    const uid = this._auth.uid;
    const chatId = this.chat?.id;
    if (!uid || !this.npc || !chatId) {
      this.debug('saveMessage: missing uid, npc, or chatId');
      return;
    }
    try {
      await this._chatStorage.addMessage({
        chatId,
        uid,
        npcId: this.npc.id,
        message: text,
        sender,
      });
      this.debug('saveMessage: success');
    } catch (error) {
      this.error('saveMessage failed', error);
    }
  }

  private async _persistMessages(msgs: MessageData[]): Promise<void> {
    const uid = this._auth.uid;
    if (!uid || !this.npc) {
      return;
    }
    try {
      const chat = await this._chatStorage.getChat({ uid, npcId: this.npc.id });
      if (chat?.id) {
        await this._chatStorage.updateChat({ chatId: chat.id, messages: msgs });
      }
    } catch {}
  }
}

export const createChatViewModel = (options: ChatViewModelOptions): ChatViewModelInterface =>
  ChatViewModel.create(options);
