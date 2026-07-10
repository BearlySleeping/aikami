// apps/frontend/client/src/lib/views/chat/chat-view-model.svelte.ts

import {
  CYOA_AGENT_ID,
  getSlashCompletions,
  IMPERSONATION_COMMAND,
  IMPERSONATION_DRAFT_READY_TOAST,
  NO_PERSONA_TOAST_MESSAGE,
  type SlashCommandEntry,
} from '@aikami/constants';
import type { EngineBridge } from '@aikami/frontend/engine';
import { parseBridgeTags } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { createStreamBuffer, parseLine, parseStreamChunk, type StreamBuffer } from '@aikami/parser';
import type { ChatData, CyoaChoice, MessageData, NpcData } from '@aikami/types';
import { impersonationService } from '$lib/services/gm/impersonation_service.svelte.ts';
import {
  aiService,
  authService,
  type ChatMessage,
  chatService,
  choiceHistoryStore,
  connectedChatsService,
  diceService,
  draftStore,
  imageGenerationService,
  messageBranchStore,
  npcChatService,
  npcService,
  personaService,
  SentenceBoundaryChunker,
  ttsService,
} from '$services';
import type { ImpersonationConfig } from '$types';
import {
  type ChoiceButtonsViewModelInterface,
  getChoiceButtonsViewModel,
} from './choice_buttons_view_model.svelte.ts';

export type ChatViewModelOptions = BaseViewModelOptions & {
  /** The chat document ID to load. */
  chatId: string;
  /** The NPC ID (from URL query param). If omitted, resolved from the chat document. */
  npcId?: string;
  /** Entity ID of the NPC in the game engine (for expression macros). */
  gameEntityId?: number;
  /** Optional agent pipeline ViewModel for pre/post agent orchestration (C-236). */
  agentPipelineViewModel?: import('$views/agent/agent_pipeline_view_model.svelte.ts').AgentPipelineViewModelInterface;
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
  /** Slash command completions for current input. */
  slashCompletions = $state<readonly SlashCommandEntry[]>([]);
  /** Selected index in the completions list (-1 = nothing selected). */
  selectedSlashCompletion = $state(-1);
  /** Whether to show the autocomplete popup. */
  showSlashCompletions = $state(false);
  /** Toast notification message — auto-clears after display. */
  toastMessage = $state('');
  /** Whether CYOA choices feed the impersonation draft instead of posting (C-245 AC-6). */
  useCyoaAsDirection = $state(false);

  /** CYOA choice buttons ViewModel — owns display state for the choice stack. */
  readonly choiceButtonsViewModel: ChoiceButtonsViewModelInterface;

  /** Sentence boundary chunker for streaming TTS. */
  private readonly _chunker = new SentenceBoundaryChunker();

  /** Internal flag: whether TTS has been initialised for this chat session. */
  private _ttsInitialised = false;

  /** The NPC's entity ID in the game engine, for expression macro routing. */
  private gameEntityId: number | undefined;

  /** Cached engine bridge — lazily created on first use. */
  private _engineBridge: EngineBridge | undefined;

  /** Optional agent pipeline ViewModel (C-236). */
  private _agentPipelineViewModel:
    | import('$views/agent/agent_pipeline_view_model.svelte.ts').AgentPipelineViewModelInterface
    | undefined;

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
    this.gameEntityId = options.gameEntityId;
    this._agentPipelineViewModel = options.agentPipelineViewModel;
    this.choiceButtonsViewModel = getChoiceButtonsViewModel({
      className: 'ChoiceButtonsViewModel',
      choices: [],
      onSelect: (choice) => this._handleChoiceSelected(choice),
    });
  }

  /** Scrollable message container — bound by View via bind:this. */
  messageContainerElement = $state.raw<HTMLDivElement | undefined>(undefined);

  override async initialize(): Promise<void> {
    // Restore per-chat input draft from IndexedDB
    const draft = await draftStore.loadDraft({ chatId: this._chatId });
    if (draft) {
      this.inputText = draft;
    }

    // Wire streaming TTS — chunker feeds sentences to ttsService
    if (!this._ttsInitialised) {
      this._ttsInitialised = true;
      this._chunker.onSentence(({ sentence }) => {
        if (this.streamingTtsEnabled) {
          ttsService.speak({ text: sentence });
        }
      });
      // Fire-and-forget TTS worker init
      void ttsService.initialize();
    }
    // Register reactive effects for DOM interactions
    this.registerEffectRoot(() => {
      // Auto-scroll to bottom when new messages arrive
      $effect(() => {
        void this.messages.length;
        if (this.messageContainerElement) {
          this.messageContainerElement.scrollTop = this.messageContainerElement.scrollHeight;
        }
      });

      // Auto-save input draft on each keystroke (bind:value bypasses onInputChange)
      $effect(() => {
        const text = this.inputText;
        if (text.length > 0) {
          void draftStore.saveDraft({ chatId: this._chatId, text });
        }
      });
    });

    // If NPC and chat already set by a dev subclass, skip real database lookup
    if (this.npc && this.chat) {
      await this.loadChatHistory(this.chat);
      return super.initialize();
    }

    const chatDataLookup = await npcChatService.getChatById({ chatId: this._chatId });
    if (!chatDataLookup) {
      this.error('Chat not found', { chatId: this._chatId });
      this.errorMessage = 'Chat not found';
      return super.initialize();
    }

    const resolvedNpcId = this._npcId ?? (chatDataLookup as { npcId?: string }).npcId;
    if (resolvedNpcId) {
      this.npc = await npcService.get({ npcId: resolvedNpcId });
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
    return chatService.isLoading;
  }
  get isSending() {
    return chatService.isSending;
  }
  get isTyping() {
    return chatService.isTyping;
  }
  get chatError() {
    return this.errorMessage ?? chatService.errorMessage;
  }
  /**
   * Enhanced message list with alternative tracking.
   * Reads from the reactive chatService.messages so that additions
   * (e.g. from dev sandbox overrides) are immediately reflected.
   */
  get messages(): ChatMessage[] {
    return chatService.messages.map((msg) => {
      const messageId = msg.id || crypto.randomUUID();
      const activeAlt = messageBranchStore.getActiveAlternative(messageId);
      return {
        id: messageId,
        text: activeAlt ?? msg.text,
        sender: msg.sender,
        timestamp: msg.timestamp,
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
    chatService.setMessages(chat.messages as unknown as MessageData[]);
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
        this.showSlashCompletions = false;
        this.slashCompletions = [];
        this.selectedSlashCompletion = -1;
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
        const msg = chatService.messages.find((m) => m.id === messageId);
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

        // Dispatch to game engine bridge
        const bridge = await this._getEngineBridge();
        bridge.executeCommand(command, args);

        // Echo a local system message into the chat
        chatService.addMessage({
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
      void connectedChatsService.crossPostOoc({
        targetChatId: this._chatId,
        oocContents: tagResult.oocContents,
      });

      // Notes and influences are added via the UI (connected chats settings panel).
      // The tag parser extracts them but we store in-message metadata only.
      // Actual ChatLink update happens via ConnectedChatsService UI.
    }

    // ── Normal AI message flow ──
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(undefined);
    const userMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'user' as const,
      timestamp: new Date(),
    };
    chatService.addMessage(userMessage);
    await this.saveMessage(text, 'user');

    // Clear the per-chat draft since the message was sent
    void draftStore.clearDraft({ chatId: this._chatId });
    this.inputText = '';

    // Stream buffer for incremental macro parsing (future streaming use)
    const streamBuf: StreamBuffer = createStreamBuffer();

    try {
      // ── Agent Pipeline (C-236): wrap AI call through pre/post agents ──
      const pipelineVm = this._agentPipelineViewModel;
      const generateResponse = async (): Promise<string | undefined> => {
        return aiService.sendMessageToAI(text, this.npc ?? undefined);
      };

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
            entityId: this.gameEntityId,
          });
          bridge.triggerMacro(macro.name, macro.args, this.gameEntityId);
        }

        const displayText = chunkResult.displayText;
        // Show clean text (macros stripped) in the UI
        chatService.appendAIMessage(displayText);
        await this.saveMessage(displayText, 'ai');

        // Feed through sentence boundary chunker for streaming TTS
        if (this.streamingTtsEnabled) {
          this._chunker.feed(displayText);
          this._chunker.close();
        }
      }
    } catch {
      chatService.setError('Failed to get response from AI');
    } finally {
      chatService.setSending(false);
      chatService.setTyping(false);
    }
  }

  async editMessage(messageId: string, newText: string): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }

    // Editing an AI message invalidates any choices derived from it (C-245)
    if (msgs[idx].sender === 'ai') {
      this.choiceButtonsViewModel.dismiss();
    }
    msgs[idx] = { ...msgs[idx], text: newText };
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const msgs = (chatService.messages as unknown as MessageData[]).filter(
      (m) => m.id !== messageId,
    );
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
    // Clean up any alternatives for the deleted message
    messageBranchStore.clearAlternatives(messageId);
  }

  swipeAlternative(messageId: string, direction: 'left' | 'right'): void {
    messageBranchStore.swipeAlternative({ messageId, direction });
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
    const trimmed = text.trim();
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const matches = getSlashCompletions(trimmed);
      this.slashCompletions = matches;
      this.showSlashCompletions = matches.length > 0;
      this.selectedSlashCompletion = matches.length > 0 ? 0 : -1;
    } else {
      this.slashCompletions = [];
      this.showSlashCompletions = false;
      this.selectedSlashCompletion = -1;
    }

    // Debounced save — fire-and-forget so input feels instant
    void draftStore.saveDraft({ chatId: this._chatId, text });
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
      ttsService.stop();
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

    const persona = await personaService.getActivePersona();
    if (!persona) {
      this.showToast(NO_PERSONA_TOAST_MESSAGE);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = chatService.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await impersonationService.generateDraft({
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

    choiceHistoryStore.recordChoice({
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

    const persona = await personaService.getActivePersona();
    if (!persona) {
      // No persona — fall back to plain posting
      void this.sendMessage(choice.label);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = chatService.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await impersonationService.generateDraft({
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
    if (this.slashCompletions.length === 0) {
      return;
    }
    const next = this.selectedSlashCompletion + delta;
    if (next < 0) {
      this.selectedSlashCompletion = this.slashCompletions.length - 1;
    } else if (next >= this.slashCompletions.length) {
      this.selectedSlashCompletion = 0;
    } else {
      this.selectedSlashCompletion = next;
    }
  }

  /**
   * Applies the currently selected slash completion to the input.
   * Replaces the current `/partial` with `/commandName ` and
   * dismisses the autocomplete popup.
   */
  applySlashCompletion(): void {
    if (!this.showSlashCompletions || this.selectedSlashCompletion < 0) {
      return;
    }
    const cmd = this.slashCompletions[this.selectedSlashCompletion];
    if (!cmd) {
      return;
    }

    this.inputText = `/${cmd.name} `;
    this.showSlashCompletions = false;
    this.slashCompletions = [];
    this.selectedSlashCompletion = -1;

    // Return focus to the textarea after autocomplete insertion.
    // The view registers this callback when the textarea mounts.
    this._focusTextarea?.();
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
    this.selectedSlashCompletion = index;
    this.applySlashCompletion();
  }

  /**
   * Handles the /impersonate slash command from sendMessage().
   * Generates a draft as the player persona, places it in the input field.
   */
  private async _handleImpersonateCommand(direction: string): Promise<void> {
    if (this.isImpersonationDrafting) {
      return;
    }

    const persona = await personaService.getActivePersona();
    if (!persona) {
      this.showToast(NO_PERSONA_TOAST_MESSAGE);
      return;
    }

    this.isImpersonationDrafting = true;

    try {
      const recentMessages = chatService.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const draft = await impersonationService.generateDraft({
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

  async regenerateMessage(messageId: string): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1 || msgs[idx].sender !== 'ai') {
      return;
    }
    chatService.setTyping(true);
    try {
      const context = msgs
        .slice(0, idx)
        .map((m) => m.text)
        .join('\n');
      const response = await aiService.sendMessageToAI(
        `Regenerate your response. Context: ${context}`,
        this.npc,
      );
      if (response) {
        // Store the current response as an alternative before replacing
        messageBranchStore.addAlternative({
          messageId,
          currentText: msgs[idx].text,
          newText: response,
        });
        msgs[idx] = { ...msgs[idx], text: response };
        chatService.setMessages(msgs);
        await this.persistMessages(msgs);

        // Regenerated response invalidates choices from the old response (C-245)
        this.choiceButtonsViewModel.dismiss();

        // Feed through chunker for streaming TTS
        if (this.streamingTtsEnabled) {
          this._chunker.feed(response);
          this._chunker.close();
        }
      }
    } catch {
      chatService.setError('Failed to regenerate message');
    } finally {
      chatService.setTyping(false);
    }
  }

  async generateImage(prompt: string): Promise<string> {
    this.isGeneratingImage = true;
    try {
      return (await imageGenerationService.generateImage({ prompt })).url;
    } finally {
      this.isGeneratingImage = false;
    }
  }

  async playTts(messageId: string): Promise<void> {
    const msg = (chatService.messages as unknown as MessageData[]).find((m) => m.id === messageId);
    if (!msg) {
      return;
    }
    this.isPlayingTts = true;
    try {
      await ttsService.speak({ text: msg.text });
    } finally {
      this.isPlayingTts = false;
    }
  }

  stopTts(): void {
    ttsService.stop();
    this.isPlayingTts = false;
  }

  async attachFile(messageId: string, file: File): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }
    const url = URL.createObjectURL(file);
    msgs[idx] = {
      ...msgs[idx],
      attachments: [...(msgs[idx].attachments ?? []), { type: 'file', url, name: file.name }],
    };
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
  }

  async updateAffection(change: number): Promise<void> {
    if (!this.chatData) {
      return;
    }
    this.chatData = { ...this.chatData, affection: (this.chatData.affection ?? 0) + change };
  }

  async rollPerception(): Promise<{ roll: number; total: number }> {
    const wisdom = 3;
    const result = diceService.rollD20(wisdom);
    chatService.addMessage({
      id: crypto.randomUUID(),
      text: `Perception check: rolled ${result.natural} + ${wisdom} = ${result.total}`,
      sender: 'ai',
      timestamp: new Date(),
    });
    return { roll: result.natural, total: result.total };
  }

  async rollPersuasion(context?: string): Promise<{ roll: number; total: number }> {
    const charisma = 3;
    const result = diceService.rollD20(charisma);
    const ctx = context ? ` Attempting to persuade: ${context}` : '';
    chatService.addMessage({
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
      const result = await imageGenerationService.generateImage({ prompt: bg });
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
    chatService.clear();
    this.showGreeting = true;
    this.inputText = '';
    this.choiceButtonsViewModel.setChoices([]);
    void draftStore.clearDraft({ chatId: this._chatId });

    // TTS cleanup
    ttsService.stop();
    this._chunker.reset();
  }

  private async saveMessage(text: string, sender: 'user' | 'ai'): Promise<void> {
    const uid = authService.uid;
    const chatId = this.chat?.id;
    if (!uid || !this.npc || !chatId) {
      this.debug('saveMessage: missing uid, npc, or chatId');
      return;
    }
    try {
      await npcChatService.addMessage({
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

  private async persistMessages(msgs: MessageData[]): Promise<void> {
    const uid = authService.uid;
    if (!uid || !this.npc) {
      return;
    }
    try {
      const chat = await npcChatService.getChat({ uid, npcId: this.npc.id });
      if (chat?.id) {
        await npcChatService.updateChat({ chatId: chat.id, messages: msgs });
      }
    } catch {}
  }
}

export const getChatViewModel = (options: ChatViewModelOptions): ChatViewModelInterface =>
  ChatViewModel.create(options);
