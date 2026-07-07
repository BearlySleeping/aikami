// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { DiceState } from '$lib/components/game/game_dice.svelte';
import {
  DIALOG_ACTION_SYSTEM_PROMPT,
  type DialogActionIntent,
  DialogActionSchema,
} from '$lib/data/ai_prompts/dialog_action_schema';
import {
  FALLBACK_AVATAR_URL,
  FALLBACK_PERSONA_ID,
  PERSONA_PROMPTS,
} from '$lib/data/dialogue_personas';
import type { OllamaClient } from '$lib/services/ai/clients/index.ts';
import type { ActionOption, DialogueMessage, DialoguePhase } from '$lib/types/dialogue';
import {
  diceService,
  draftStore,
  gameStateService,
  messageBranchStore,
  SentenceBoundaryChunker,
  type TextChatMessage,
  textGenerationService,
  ttsService,
} from '$services';
import { worldGenSeedingService } from '$views/worldgen/world_gen_seeding_service.svelte.ts';
import type { DialogueNpcData } from '../../game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// DialogueOverlayViewModel — orchestrates AI chat with an NPC
//
// Manages the conversation history, AI text streaming, and player input
// for the in-game dialogue overlay. Injected with NPC data from the
// GameUIViewModel when the player interacts with an NPC.
//
// Supports two streaming backends:
// 1. OllamaClient.streamChat() — direct local streaming via Ollama's /api/generate
// 2. textGenerationService.streamChat() — OpenRouter cloud streaming fallback
//
// Contract: C-128 (origin), C-129 (polish)
// ---------------------------------------------------------------------------

export type DialogueOverlayViewModelOptions = BaseViewModelOptions & {
  /** NPC data from the ECS interaction event. */
  npcData: DialogueNpcData;
  /** Called when the player ends the conversation. */
  onEndChat: () => void;
  /**
   * Optional OllamaClient instance for direct local streaming.
   * When provided, streamChat() uses Ollama's /api/generate directly
   * instead of routing through textGenerationService (OpenRouter).
   */
  ollamaClient?: OllamaClient;
  /**
   * Whether image generation (ComfyUI or Cloud) is available.
   * When false, ComfyUI requests are skipped and fallback NPC
   * avatars from lpc_asset_catalog are displayed instead.
   *
   * Defaults to true for backwards compatibility.
   */
  imageProviderAvailable?: boolean;
  /**
   * Called when a state mutation triggers combat from dialogue.
   * The parent (GameUIViewModel) transitions to the COMBAT overlay
   * and creates a CombatViewModel for the NPC.
   *
   * Contract: C-157 Dialogue Skill Checks
   */
  onStartCombat?: (npcData: DialogueNpcData) => void;
};

export type DialogueOverlayViewModelInterface = BaseViewModelInterface & {
  /** The NPC's display name. */
  readonly npcName: string;

  /** URL for the NPC's avatar image (LPC spritesheet or generated portrait). */
  readonly npcAvatarUrl: string;

  /** Whether the image generation provider is available. */
  readonly imageProviderAvailable: boolean;

  /** Conversation history — player and NPC messages. */
  readonly messages: DialogueMessage[];

  /** Whether the AI is currently streaming a response. */
  readonly isStreaming: boolean;

  /** The player's current input text (bound to the text input field). */
  inputText: string;

  /** Error message from the last failed generation, if any. */
  readonly streamError: string | null;

  /**
   * Current phase of the dialogue interaction loop.
   *
   * Controls which UI elements are visible: action menu, text input,
   * interactive dice, or standard chat.
   *
   * Contract: C-162 BG3 Action Menu & Dice
   */
  readonly dialoguePhase: DialoguePhase;

  /** The ID of the currently selected action, or `null` if no action is selected. */
  readonly selectedActionId: string | null;

  /** Available action options for the current NPC interaction. */
  readonly actionOptions: readonly ActionOption[];

  /**
   * Skill check UI state for the animated d20 component.
   * `null` when no skill check is in progress or recently completed.
   *
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice
   */
  readonly skillCheckState: {
    readonly checkType: string;
    readonly difficultyClass: number;
    readonly rollValue: number | null;
    /**
     * Interactive dice phase:
     * - `awaiting_click`: Dice visible, waiting for player click (C-162).
     * - `rolling`: Spin animation playing (same as old `isRolling`).
     * - `revealed`: Result shown (same as old `!isRolling` with value).
     */
    readonly phase: 'awaiting_click' | 'rolling' | 'revealed';
    readonly isSuccess: boolean | null;
  } | null;

  /** Unified dice state for the shared GameDice component. */
  readonly diceState: DiceState | null;

  /** Whether the AI is resolving a structured skill check (disables all inputs). */
  readonly isResolvingSkillCheck: boolean;

  /**
   * Screen-space X coordinate of the active dialogue NPC (CSS pixels).
   * Updated reactively from CAMERA_ZOOM_UPDATE bridge events.
   *
   * Contract: C-161 Spatial UI Camera
   */
  npcScreenX: number;

  /**
   * Screen-space Y coordinate of the active dialogue NPC (CSS pixels).
   * Updated reactively from CAMERA_ZOOM_UPDATE bridge events.
   *
   * Contract: C-161 Spatial UI Camera
   */
  npcScreenY: number;

  /**
   * Whether the NPC screen position is available for speech bubble
   * positioning. `true` when dialogue zoom is active and the worker
   * is sending CAMERA_ZOOM_UPDATE events.
   */
  hasNpcScreenPosition: boolean;

  /** Scrollable message container — bound by View via bind:this. */
  messageContainerElement: HTMLDivElement | undefined;

  /** Textarea input — bound by View via bind:this for autofocus. */
  inputElement: HTMLTextAreaElement | undefined;

  /**
   * Selects an action from the context menu.
   *
   * - `skill_check`: Sets up interactive dice, waits for player click (C-162).
   * - `direct_combat`: Bypasses LLM, triggers combat immediately.
   * - `custom`: Switches to freeform text input.
   */
  selectAction(actionId: string): Promise<void>;

  /**
   * Rolls the interactive d20 after the player clicks it.
   *
   * Only valid when `skillCheckState.phase === 'awaiting_click'`.
   * Performs the roll, plays the spin animation, reveals the result,
   * then sends the outcome to the LLM for narrative resolution.
   *
   * Contract: C-162 Interactive Latency Masking
   */
  rollDice(): Promise<void>;

  /**
   * Sends the given text (or current input) as a player message
   * and triggers AI response streaming. Does nothing if input is
   * empty or AI is already streaming.
   *
   * For risky actions (threats, theft, persuasion attempts), uses
   * structured extraction to detect skill checks and state mutations.
   *
   * @param text — Optional explicit text to send. Falls back to current inputText.
   */
  sendMessage(text?: string): Promise<void>;

  /** Sets the player's input text (bound to text input field). */
  setInput(text: string): void;

  /** Returns to the action context menu from the custom input or dice phases. */
  goToMenu(): void;

  /** Closes the dialogue overlay and resumes the game. */
  endChat(): void;

  /**
   * Handles keydown events on the text input.
   * Enter submits the message; Escape ends the chat.
   */
  handleKeyDown(event: KeyboardEvent): void;

  // ── C-231 Rich Chat Streaming ──────────────────────────────────

  /** Swipe between alternative NPC responses for a message. */
  swipeAlternative(messageId: string, direction: 'left' | 'right'): void;

  /** Copy message text to clipboard with toast feedback. */
  copyMessage(text: string): Promise<void>;

  /** Fork a new conversation from the given message (placeholder). */
  branchFromMessage(messageId: string): void;

  /** Toast notification message (e.g. 'Copied!'). */
  readonly toastMessage: string;

  /** Shows a toast notification that auto-dismisses. */
  showToast(message: string): void;

  /** Whether streaming TTS is enabled for this conversation. */
  readonly streamingTtsEnabled: boolean;

  /** Toggles streaming TTS on/off for this chat. */
  toggleStreamingTts(): void;
};

class DialogueOverlayViewModel
  extends BaseViewModel<DialogueOverlayViewModelOptions>
  implements DialogueOverlayViewModelInterface
{
  /**
   * Pre-written action buttons for the BG3-style context menu.
   *
   * Contract: C-162 BG3 Action Menu & Dice
   */
  static readonly ACTION_OPTIONS: readonly ActionOption[] = [
    { id: 'persuasion', label: 'Persuasion', type: 'skill_check', skill: 'persuasion' },
    { id: 'intimidation', label: 'Intimidation', type: 'skill_check', skill: 'intimidation' },
    { id: 'stealth', label: 'Stealth', type: 'skill_check', skill: 'sleight_of_hand' },
    { id: 'attack', label: 'Attack', type: 'direct_combat' },
    { id: 'custom', label: 'Custom', type: 'custom' },
  ] as const;

  messages = $state<DialogueMessage[]>([]);

  isStreaming = $state<boolean>(false);

  inputText = $state<string>('');

  streamError = $state<string | null>(null);

  /**
   * Current phase of the dialogue interaction loop (C-162).
   * Starts in `MENU` — action context menu visible.
   */
  dialoguePhase = $state<DialoguePhase>('MENU');

  /** The ID of the currently selected action, or `null`. */
  selectedActionId = $state<string | null>(null);

  /**
   * Skill check dice roll UI state — null when idle.
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice
   */
  skillCheckState: {
    checkType: string;
    difficultyClass: number;
    rollValue: number | null;
    phase: 'awaiting_click' | 'rolling' | 'revealed';
    isSuccess: boolean | null;
  } | null = $state(null);

  /** Whether the AI is resolving a structured skill check. */
  isResolvingSkillCheck = $state(false);

  /** Unified dice state mapping for the shared GameDice component. */
  get diceState(): DiceState | null {
    const s = this.skillCheckState;
    if (!s) {
      return null;
    }
    return {
      phase: s.phase === 'awaiting_click' ? 'interactive' : s.phase,
      value: s.rollValue,
      isSuccess: s.isSuccess,
      checkInfo: { type: s.checkType, dc: s.difficultyClass },
      onRoll: () => {
        void this.rollDice();
      },
    };
  }

  /** @inheritdoc */
  npcScreenX = $state<number>(0);

  /** @inheritdoc */
  npcScreenY = $state<number>(0);

  /** @inheritdoc */
  hasNpcScreenPosition = $state<boolean>(false);

  /** Scrollable message container — set by View via bind:this. */
  messageContainerElement = $state.raw<HTMLDivElement | undefined>(undefined);

  /** Textarea input — set by View via bind:this for autofocus. */
  inputElement = $state.raw<HTMLTextAreaElement | undefined>(undefined);

  /** Toast notification message — auto-clears after display. */
  toastMessage = $state('');

  /** Whether streaming TTS is enabled for this conversation. */
  streamingTtsEnabled = $state(false);

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  private readonly _onStartCombat?: (npcData: DialogueNpcData) => void;

  private readonly _ollamaClient?: OllamaClient;

  private readonly _imageProviderAvailable: boolean;

  private readonly _chunker = new SentenceBoundaryChunker();

  private _ttsInitialized = false;

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
    this._onStartCombat = options.onStartCombat;
    this._ollamaClient = options.ollamaClient;
    this._imageProviderAvailable = options.imageProviderAvailable ?? true;

    // Restore per-chat input draft from IndexedDB (fire-and-forget)
    const draftPromise = draftStore.loadDraft({ chatId: this._npcData.npcId });
    if (draftPromise && typeof draftPromise.then === 'function') {
      void draftPromise.then((draft: string) => {
        if (draft) {
          this.inputText = draft;
        }
      });
    }

    // Show the NPC's initial greeting dialog as the first message.
    // Done in constructor (not initialize) because the consumer may
    // not wrap with BaseViewModelContainer.
    if (this._npcData.dialog) {
      this.messages = [
        {
          id: crypto.randomUUID(),
          content: this._npcData.dialog,
          role: 'npc' as const,
        },
      ];
    }
  }

  get npcName(): string {
    return this._npcData.npcName;
  }

  /**
   * NPC avatar URL.
   * Uses the fallback LPC spritesheet from the asset catalog when image
   * generation is unavailable, or the default body walk sheet otherwise.
   */
  get npcAvatarUrl(): string {
    return FALLBACK_AVATAR_URL;
  }

  /** @inheritdoc */
  get imageProviderAvailable(): boolean {
    return this._imageProviderAvailable;
  }

  /** Available action options for the context menu (C-162). */
  get actionOptions(): readonly ActionOption[] {
    return DialogueOverlayViewModel.ACTION_OPTIONS;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Register reactive effects for DOM interactions
    this.registerEffectRoot(() => {
      // Autofocus the textarea when dialogue mode is active
      $effect(() => {
        // gameStateService is imported at module level
        if (gameStateService.currentMode === 'DIALOGUE' && this.inputElement) {
          this.inputElement.focus();
        }
      });

      // Auto-scroll to bottom when new messages arrive or AI is streaming
      $effect(() => {
        void this.messages.length;
        void this.isStreaming;
        if (this.messageContainerElement) {
          this.messageContainerElement.scrollTop = this.messageContainerElement.scrollHeight;
        }
      });

      // Auto-save input draft (bind:value bypasses setInput)
      $effect(() => {
        const text = this.inputText;
        if (text.length > 0) {
          void draftStore.saveDraft({ chatId: this._npcData.npcId, text });
        }
      });
    });

    // Initialize native Kokoro TTS if not already done
    if (!this._ttsInitialized) {
      this._ttsInitialized = true;
      this._chunker.onSentence(({ sentence }) => {
        if (this.streamingTtsEnabled) {
          ttsService.synthesize({
            text: sentence,
            voice: ttsService.selectedVoice,
          });
        }
      });

      // Fire-and-forget — TTS init happens in background, speech works
      // once the worker reports 'ready'.
      void ttsService.initialize();
    }

    await super.initialize();
  }

  /** @inheritdoc */
  goToMenu(): void {
    this.dialoguePhase = 'MENU';
    this.inputText = '';
  }

  /** @inheritdoc */
  setInput(text: string): void {
    this.inputText = text;
    // Fire-and-forget draft save
    void draftStore.saveDraft({ chatId: this._npcData.npcId, text });
  }

  // ── Action Context Menu (C-162) ─────────────────────────────────────

  /** @inheritdoc */
  async selectAction(actionId: string): Promise<void> {
    this.debug('selectAction', { actionId });

    if (actionId === 'attack') {
      await this._handleDirectCombat();
      return;
    }

    if (actionId === 'custom') {
      this.dialoguePhase = 'CUSTOM_INPUT';
      return;
    }

    const option = DialogueOverlayViewModel.ACTION_OPTIONS.find((o) => o.id === actionId);
    if (option?.type !== 'skill_check' || !option.skill) {
      this.warn('selectAction:unknown-action', { actionId });
      return;
    }

    this.selectedActionId = actionId;
    this.dialoguePhase = 'DICE';

    // Determine the difficulty class based on the NPC's persona difficulty
    const difficultyClass = this._getDifficultyClass(option.skill);

    // Set up interactive dice — player must click to roll
    this.skillCheckState = {
      checkType: option.label,
      difficultyClass,
      rollValue: null,
      phase: 'awaiting_click',
      isSuccess: null,
    };
  }

  /** @inheritdoc */
  async rollDice(): Promise<void> {
    const state = this.skillCheckState;
    if (state?.phase !== 'awaiting_click') {
      this.debug('rollDice:invalid-phase', { phase: state?.phase });
      return;
    }

    // Roll the d20
    const { natural: rollValue, total } = diceService.rollD20(0);
    const isSuccess = total >= state.difficultyClass;

    this.debug('rollDice', {
      checkType: state.checkType,
      difficultyClass: state.difficultyClass,
      rollValue,
      total,
      isSuccess,
    });

    // Show rolling animation
    this.skillCheckState = { ...state, phase: 'rolling' };

    // Wait for the spin animation (~1.5s)
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Reveal the result
    this.skillCheckState = { ...state, rollValue, phase: 'revealed', isSuccess };

    // Brief pause so the player can absorb the outcome
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    // Now send the action + dice result to the LLM for narrative resolution
    await this._executeSkillCheckAction({
      skill: state.checkType,
      difficultyClass: state.difficultyClass,
      rollValue,
      isSuccess,
    });

    // Clear dice overlay and return to menu for the next action
    this.skillCheckState = null;
    this.selectedActionId = null;
    this.dialoguePhase = 'MENU';
  }

  /** @inheritdoc */
  async sendMessage(text?: string): Promise<void> {
    const content = (text ?? this.inputText).trim();
    if (!content || this.isStreaming || this.isResolvingSkillCheck) {
      return;
    }

    // Clear input immediately so the player sees feedback
    this.inputText = '';
    this.streamError = null;

    // Clear the per-chat draft since a message is being sent
    void draftStore.clearDraft({ chatId: this._npcData.npcId });

    // Append the player's message
    const playerMessage: DialogueMessage = {
      id: crypto.randomUUID(),
      content,
      role: 'player',
    };
    this.messages = [...this.messages, playerMessage];

    // Detect risky actions for structured skill check extraction.
    // Casual conversation uses the standard streaming path.
    if (this._isRiskyAction(content)) {
      await this._executeStructuredIntent({ playerContent: content });
    } else {
      // Generate AI response via appropriate backend (existing flow)
      await this._generateAiResponse();
    }
  }

  /** @inheritdoc */
  endChat(): void {
    // Flush any remaining buffered text as a final sentence
    this._chunker.close();
    this._onEndChat();
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.endChat();
    }
  }

  // ── C-231: Rich Chat Streaming ───────────────────────────────────────

  /** @inheritdoc */
  swipeAlternative(messageId: string, direction: 'left' | 'right'): void {
    messageBranchStore.swipeAlternative({ messageId, direction });
  }

  /** @inheritdoc */
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

  /** @inheritdoc */
  branchFromMessage(_messageId: string): void {
    // Placeholder: creates a new conversation fork.
    this.showToast('Branch created!');
  }

  /** @inheritdoc */
  showToast(message: string): void {
    this.toastMessage = message;
    setTimeout(() => {
      if (this.toastMessage === message) {
        this.toastMessage = '';
      }
    }, 2000);
  }

  /** @inheritdoc */
  toggleStreamingTts(): void {
    this.streamingTtsEnabled = !this.streamingTtsEnabled;
    if (!this.streamingTtsEnabled) {
      ttsService.stop();
    }
  }

  // ── Private: AI response generation ──────────────────────────────────

  /**
   * Builds the system prompt that defines the NPC's personality and
   * response style. Uses the NPC name and greeting for context.
   */
  private _buildSystemPrompt(): string {
    const { npcName, dialog, personaId } = this._npcData;

    // Start with the persona-specific archetype description
    const personaPrompt =
      PERSONA_PROMPTS[personaId ?? FALLBACK_PERSONA_ID] ?? PERSONA_PROMPTS[FALLBACK_PERSONA_ID];

    const lines = [
      personaPrompt,
      `Your name is ${npcName}.`,
      `Stay in character at all times. Respond as ${npcName} would.`,
    ];

    if (dialog) {
      lines.push(`Your initial greeting to the player was: "${dialog}"`);
    }

    lines.push(
      'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
      'Do not break character. Do not mention being an AI.',
    );

    // Inject character sheet summary for AI context awareness
    const sheetSummary = gameStateService.characterSheetSummary;
    if (sheetSummary) {
      lines.push('', '[CHARACTER SHEET]', sheetSummary, '[/CHARACTER SHEET]');
    }

    // Inject world generation context (C-233)
    const worldGen = gameStateService.worldGenOutput;
    if (worldGen && Array.isArray(worldGen.npcs) && worldGen.npcs.length > 0) {
      const gmPrompt = worldGenSeedingService.assembleGmPrompt({
        output: worldGen,
        playerGoals: `Explore the world of ${worldGen.worldName}.`,
      });
      lines.push('', '[WORLD CONTEXT]', gmPrompt, '[/WORLD CONTEXT]');
    }

    return lines.join('\n');
  }

  /**
   * Sends the conversation history to the AI and streams the response
   * token by token into the last message.
   *
   * When an OllamaClient is available, uses direct /api/generate streaming.
   * Falls back to textGenerationService (OpenRouter SSE) otherwise.
   *
   * Image generation (ComfyUI) requests are skipped entirely when
   * imageProviderAvailable is false — see C-133 graceful degradation.
   */
  private async _generateAiResponse(): Promise<void> {
    this.isStreaming = true;
    this.streamError = null;

    // Create a placeholder NPC message that accumulates streamed tokens
    const npcMessageId = crypto.randomUUID();
    this.messages = [
      ...this.messages,
      {
        id: npcMessageId,
        content: '',
        role: 'npc' as const,
      },
    ];

    try {
      if (this._ollamaClient) {
        await this._streamViaOllama({ npcMessageId });
      } else {
        await this._streamViaTextGenerationService({ npcMessageId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.streamError = message;

      // Replace the empty NPC message with an error placeholder
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: '*...*' } : m,
      );
    } finally {
      this.isStreaming = false;
    }
  }

  /**
   * Streams NPC response directly from Ollama's /api/generate endpoint.
   * Formats the conversation into a prompt string for Ollama's completion API.
   */
  private async _streamViaOllama(options: { npcMessageId: string }): Promise<void> {
    const { npcMessageId } = options;

    const systemPrompt = this._buildSystemPrompt();

    // Build context array for Ollama's generate endpoint
    const context: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...this.messages
        .filter((m) => m.id !== npcMessageId)
        .map((m) => ({
          role: m.role === 'player' ? 'user' : 'assistant',
          content: m.content,
        })),
    ];

    // Build a plain-text prompt from the context for Ollama's generate API
    const prompt = `${context
      .filter((c) => c.content.trim().length > 0)
      .map(
        (c) =>
          `${c.role === 'system' ? 'System' : c.role === 'user' ? 'Player' : this._npcData.npcName}: ${c.content}`,
      )
      .join('\n')}\n${this._npcData.npcName}:`;

    let accumulated = '';

    const client = this._ollamaClient;
    if (!client) {
      return; // Should not happen — caller checks this._ollamaClient
    }
    const stream = client.streamChat(prompt);

    for await (const chunk of stream) {
      accumulated += chunk;
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
      this._chunker.feed(chunk);
    }

    // Flush any remaining text at end of stream
    this._chunker.close();

    // Ensure final text is set (in case stream yielded nothing)
    if (accumulated) {
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
    }
  }

  /**
   * Streams NPC response via textGenerationService (OpenRouter SSE).
   * Used as fallback when no OllamaClient is available.
   */
  private async _streamViaTextGenerationService(options: { npcMessageId: string }): Promise<void> {
    const { npcMessageId } = options;

    const llmMessages: TextChatMessage[] = [
      { role: 'system', content: this._buildSystemPrompt() },
      ...this.messages
        .filter((m) => m.id !== npcMessageId) // exclude empty placeholder
        .map((m) => ({
          role: m.role === 'player' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
    ];

    let accumulated = '';

    await textGenerationService.streamChat({
      messages: llmMessages,
      onChunk: (text: string) => {
        accumulated += text;
        this.messages = this.messages.map((m) =>
          m.id === npcMessageId ? { ...m, content: accumulated } : m,
        );
        this._chunker.feed(text);
      },
    });

    // Flush any remaining text at end of stream
    this._chunker.close();

    if (accumulated) {
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
    }
  }

  // ── Private: Skill Check Flow (C-157) ───────────────────────────────

  /**
   * Keyword-based detection of risky player actions that may require
   * a skill check (Persuasion, Intimidation, Sleight of Hand).
   *
   * Casual conversation passes through normal streaming; risky actions
   * are routed through structured extraction for skill check detection.
   */
  private _isRiskyAction(content: string): boolean {
    const riskyPatterns = [
      /\b(threaten|intimidate|scare|warn|bully)\b/i,
      /\b(steal|pickpocket|palm|swipe|snatch|slip|grab)\b/i,
      /\b(persuade|convince|charm|bribe|negotiate|haggle|bargain)\b/i,
      /\b(lie|deceive|bluff|trick|mislead)\b/i,
      /\b(attack|punch|stab|shove|tackle|draw .* sword|draw .* weapon)\b/i,
      /\b(force|demand|order|command)\b/i,
    ];

    return riskyPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Executes the structured skill check flow for a risky player action.
   *
   * 1. Extracts structured intent via the LLM (DialogActionSchema).
   * 2. If a skill check is required, performs the d20 roll with animation.
   * 3. Feeds the roll result back to the LLM for narrative resolution.
   * 4. Handles any state mutations (trigger_combat, give_item).
   *
   * On failure, falls back to streaming chat with an error message.
   */
  private async _executeStructuredIntent(options: { playerContent: string }): Promise<void> {
    const { playerContent } = options;
    this.isResolvingSkillCheck = true;
    this.streamError = null;

    try {
      // Build the conversation context for the LLM
      const conversationContext = this.messages
        .filter((m) => m.content.trim().length > 0)
        .slice(0, -1) // exclude the just-added player message
        .map((m) =>
          m.role === 'player' ? `Player: ${m.content}` : `${this._npcData.npcName}: ${m.content}`,
        )
        .join('\n');

      const contextualPrompt = [
        `NPC Name: ${this._npcData.npcName}`,
        `NPC Personality: ${PERSONA_PROMPTS[this._npcData.personaId ?? FALLBACK_PERSONA_ID]}`,
        conversationContext ? `\nConversation history:\n${conversationContext}` : '',
        `\nPlayer's latest action: "${playerContent}"`,
      ]
        .filter(Boolean)
        .join('\n');

      this.debug('_executeStructuredIntent:calling-extractStructure', {
        playerContent: playerContent.slice(0, 60),
        contextLength: contextualPrompt.length,
      });

      const intent = (await textGenerationService.extractStructure({
        schema: DialogActionSchema as unknown as Record<string, unknown>,
        schemaName: 'DialogActionIntent',
        prompt: contextualPrompt,
        systemPrompt: DIALOG_ACTION_SYSTEM_PROMPT,
      })) as DialogActionIntent;

      this.debug('_executeStructuredIntent:LLM-response', {
        hasCheck: !!intent.requiredCheck,
        checkType: intent.requiredCheck,
        dc: intent.difficultyClass,
        stateMutation: intent.stateMutation,
        itemId: intent.itemId,
        narrativeLength: intent.narrative.length,
      });

      // Always show the NPC's initial reaction narrative
      this._appendNpcMessage(intent.narrative);

      // If a skill check is required, perform the d20 roll
      if (intent.requiredCheck && intent.difficultyClass !== undefined) {
        await this._performSkillCheck({
          checkType: intent.requiredCheck,
          difficultyClass: intent.difficultyClass,
        });

        // Feed the roll result back to the LLM for final resolution
        await this._resolveSkillCheck({
          checkType: intent.requiredCheck,
          difficultyClass: intent.difficultyClass,
          playerContent,
          intent,
        });

        // Keep the dice result visible briefly then clear
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        this.skillCheckState = null;
      }

      // Handle state mutations after resolution
      await this._handleStateMutation({ intent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_executeStructuredIntent:failed', { message });
      this.streamError = `Skill check failed: ${message}`;
    } finally {
      this.isResolvingSkillCheck = false;
    }
  }

  /**
   * Performs the d20 skill check with animated dice UI.
   *
   * Rolls a d20 using the diceService, shows the rolling animation
   * for ~1.5 seconds, then reveals the result (success or failure).
   *
   * The result is stored in {@link skillCheckState} for the View to render.
   */
  private async _performSkillCheck(options: {
    checkType: string;
    difficultyClass: number;
  }): Promise<{ rollValue: number; isSuccess: boolean }> {
    const { checkType, difficultyClass } = options;

    // Roll the d20
    const { natural: rollValue, total } = diceService.rollD20(0);
    const isSuccess = total >= difficultyClass;

    this.debug('_performSkillCheck', { checkType, difficultyClass, rollValue, total, isSuccess });

    // Show the rolling animation
    this.skillCheckState = {
      checkType,
      difficultyClass,
      rollValue: null,
      phase: 'rolling',
      isSuccess: null,
    };

    // Wait for the dice animation (~1.5s)
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Reveal the result — state stays visible for _resolveSkillCheck to read
    this.skillCheckState = {
      checkType,
      difficultyClass,
      rollValue,
      phase: 'revealed',
      isSuccess,
    };

    return { rollValue, isSuccess };
  }

  /**
   * Feeds the d20 roll result back to the LLM for narrative resolution.
   *
   * The LLM is told whether the skill check passed or failed and
   * provides a narrative resolution — success or failure dialogue
   * from the NPC.
   */
  private async _resolveSkillCheck(options: {
    checkType: string;
    difficultyClass: number;
    playerContent: string;
    intent: DialogActionIntent;
  }): Promise<void> {
    const { checkType, difficultyClass, playerContent, intent } = options;
    const skillCheckState = this.skillCheckState;
    if (!skillCheckState || skillCheckState.rollValue === null) {
      return;
    }

    const { rollValue, isSuccess } = skillCheckState;

    const resolutionPrompt = [
      `The player attempted: "${playerContent}"`,
      `Skill check: ${checkType} (DC ${difficultyClass})`,
      `Result: Rolled ${rollValue} — ${isSuccess ? 'SUCCESS' : 'FAILURE'}`,
      `\nThe NPC's initial reaction was: "${intent.narrative}"`,
      `\nNow provide the NPC's final response to the ${isSuccess ? 'SUCCESSFUL' : 'FAILED'} skill check.`,
      isSuccess
        ? 'The player succeeded — the NPC should react accordingly (give information, hand over the item, show fear, etc.).'
        : 'The player failed — the NPC should react accordingly (get angry, refuse, raise alarm, mock the attempt).',
      `\nRespond as ${this._npcData.npcName} in 1–3 sentences. Stay in character.`,
    ].join('\n');

    this.debug('_resolveSkillCheck:sending', {
      checkType,
      rollValue,
      isSuccess,
      promptLength: resolutionPrompt.length,
    });

    try {
      const messages: TextChatMessage[] = [
        { role: 'system', content: this._buildSystemPrompt() },
        { role: 'user', content: resolutionPrompt },
      ];

      if (this._ollamaClient) {
        // Ollama direct streaming
        const prompt = `System: ${this._buildSystemPrompt()}\nUser: ${resolutionPrompt}\n${this._npcData.npcName}:`;
        let accumulated = '';
        const npcMessageId = crypto.randomUUID();
        this.messages = [...this.messages, { id: npcMessageId, content: '', role: 'npc' as const }];

        const client = this._ollamaClient;
        if (!client) {
          return;
        }
        const stream = client.streamChat(prompt);

        for await (const chunk of stream) {
          accumulated += chunk;
          this.messages = this.messages.map((m) =>
            m.id === npcMessageId ? { ...m, content: accumulated } : m,
          );
          this._chunker.feed(chunk);
        }
        this._chunker.close();
      } else {
        // OpenRouter streaming
        const npcMessageId = crypto.randomUUID();
        this.messages = [...this.messages, { id: npcMessageId, content: '', role: 'npc' as const }];

        let accumulated = '';
        await textGenerationService.streamChat({
          messages,
          onChunk: (text: string) => {
            accumulated += text;
            this.messages = this.messages.map((m) =>
              m.id === npcMessageId ? { ...m, content: accumulated } : m,
            );
            this._chunker.feed(text);
          },
        });
        this._chunker.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_resolveSkillCheck:failed', { message });
      this._appendNpcMessage(isSuccess ? '*The attempt succeeded.*' : '*The attempt failed.*');
    }
  }

  /**
   * Handles state mutations returned by the LLM.
   *
   * - `trigger_combat`: Closes the dialogue and notifies the parent
   *   to transition to the COMBAT overlay against the current NPC.
   * - `give_item`: Appends a narrative message confirming the item.
   *
   * Item granting is a narrative note for MVP — actual inventory
   * mutations are future work.
   */
  private async _handleStateMutation(options: { intent: DialogActionIntent }): Promise<void> {
    const { intent } = options;

    if (intent.stateMutation === 'trigger_combat') {
      this.debug('_handleStateMutation:trigger_combat', {
        npcName: this._npcData.npcName,
        npcId: this._npcData.npcId,
      });

      // Append a combat transition message
      this._appendNpcMessage(`*${this._npcData.npcName} reaches for a weapon — combat begins!*`);

      // Brief delay so the player can read the transition message
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      // End the dialogue
      this._onEndChat();

      // Notify parent to start combat
      if (this._onStartCombat) {
        this._onStartCombat(this._npcData);
      }

      return;
    }

    if (intent.stateMutation === 'give_item' && intent.itemId) {
      this.debug('_handleStateMutation:give_item', { itemId: intent.itemId });
      this._appendNpcMessage(`*Received: ${intent.itemId}*`);
    }
  }

  // ── Private: Action Menu Helpers (C-162) ───────────────────────────

  /**
   * Returns a difficulty class for the given skill check against this NPC.
   *
   * Base DC is 12; harder NPC personas (guard, bandit, guild_master) get
   * +2, softer personas (innkeeper, healer, merchant) get -2.
   *
   * Contract: C-162 BG3 Action Menu & Dice
   */
  private _getDifficultyClass(_skill: string): number {
    const hardPersonas = ['guard', 'bandit', 'guild_master'] as const;
    const softPersonas = ['innkeeper', 'healer', 'merchant'] as const;
    const personaId = this._npcData.personaId ?? FALLBACK_PERSONA_ID;

    if (hardPersonas.includes(personaId as (typeof hardPersonas)[number])) {
      return 14;
    }
    if (softPersonas.includes(personaId as (typeof softPersonas)[number])) {
      return 10;
    }
    return 12;
  }

  /**
   * Bypasses the LLM entirely and triggers combat against the current NPC.
   *
   * Appends a combat transition message, ends the dialogue, and notifies
   * the parent to start the combat overlay.
   *
   * Contract: C-162 AC-1 — [Attack] bypasses LLM
   */
  private async _handleDirectCombat(): Promise<void> {
    this.debug('_handleDirectCombat', {
      npcName: this._npcData.npcName,
      npcId: this._npcData.npcId,
    });

    // Append a combat initiation message
    this._appendNpcMessage(`*${this._npcData.npcName} reaches for a weapon — combat begins!*`);

    // Brief delay so the player can read the transition message
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));

    // End the dialogue
    this._onEndChat();

    // Notify parent to start combat
    if (this._onStartCombat) {
      this._onStartCombat(this._npcData);
    }
  }

  /**
   * Executes the LLM resolution for a skill check action selected from
   * the action context menu.
   *
   * The dice has already been rolled and the result is known. This method
   * sends the action + dice result to the LLM for structured extraction
   * (narrative response + state mutations), streams the NPC response,
   * and handles any state mutations.
   *
   * Contract: C-162 Interactive Latency Masking — LLM request fires
   * ONLY after dice click + animation complete.
   */
  protected async _executeSkillCheckAction(options: {
    skill: string;
    difficultyClass: number;
    rollValue: number;
    isSuccess: boolean;
  }): Promise<void> {
    const { skill, difficultyClass, rollValue, isSuccess } = options;
    this.isResolvingSkillCheck = true;
    this.streamError = null;

    try {
      // Build the conversation context for the LLM
      const conversationContext = this.messages
        .filter((m) => m.content.trim().length > 0)
        .map((m) =>
          m.role === 'player' ? `Player: ${m.content}` : `${this._npcData.npcName}: ${m.content}`,
        )
        .join('\n');

      const contextualPrompt = [
        `NPC Name: ${this._npcData.npcName}`,
        `NPC Personality: ${PERSONA_PROMPTS[this._npcData.personaId ?? FALLBACK_PERSONA_ID]}`,
        conversationContext ? `\nConversation history:\n${conversationContext}` : '',
        `\nThe player is attempting a **${skill}** skill check.`,
        `Dice result: Rolled **${rollValue}** vs DC ${difficultyClass} — **${isSuccess ? 'SUCCESS' : 'FAILURE'}**`,
        isSuccess
          ? 'The player succeeded on the skill check. Provide the NPC narrative response and any state mutations.'
          : 'The player failed the skill check. Provide the NPC narrative response and any state mutations.',
      ]
        .filter(Boolean)
        .join('\n');

      this.debug('_executeSkillCheckAction:calling-extractStructure', {
        skill,
        rollValue,
        isSuccess,
        contextLength: contextualPrompt.length,
      });

      const intent = (await textGenerationService.extractStructure({
        schema: DialogActionSchema as unknown as Record<string, unknown>,
        schemaName: 'DialogActionIntent',
        prompt: contextualPrompt,
        systemPrompt: DIALOG_ACTION_SYSTEM_PROMPT,
      })) as DialogActionIntent;

      this.debug('_executeSkillCheckAction:LLM-response', {
        hasCheck: !!intent.requiredCheck,
        stateMutation: intent.stateMutation,
        narrativeLength: intent.narrative.length,
      });

      // Append the NPC's narrative response (structural extraction result)
      this._appendNpcMessage(intent.narrative);

      // Handle any state mutations returned by the LLM
      await this._handleStateMutation({ intent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_executeSkillCheckAction:failed', { message });
      this.streamError = `Skill check failed: ${message}`;
    } finally {
      this.isResolvingSkillCheck = false;
      // Return to chat phase after resolution
      this.dialoguePhase = 'MENU';
    }
  }

  /**
   * Appends an NPC message to the conversation history.
   */
  private _appendNpcMessage(content: string): void {
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content,
        role: 'npc' as const,
      },
    ];
  }
}

export { DialogueOverlayViewModel };
