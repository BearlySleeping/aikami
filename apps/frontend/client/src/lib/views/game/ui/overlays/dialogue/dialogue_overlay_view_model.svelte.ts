// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { DiceState } from '$lib/components/game/game_dice.svelte';
import { FALLBACK_AVATAR_URL } from '$lib/data/dialogue_personas';
import type { NpcDialogueServiceInterface } from '$lib/services/game/npc_dialogue_service.svelte';
import type { ActionOption, DialogueMessage, DialoguePhase } from '$lib/types/dialogue';
import {
  buildGameStateFacts,
  combatService,
  diceService,
  draftStore,
  gameModeService,
  messageBranchStore,
  SentenceBoundaryChunker,
  ttsService,
} from '$services';
import type { DialogueNpcData } from '../../game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// DialogueOverlayViewModel — orchestrates AI NPC dialogue via orchestrator
//
// Manages conversation history, choice rendering, and player input for the
// in-game dialogue overlay. All AI streaming and authored fallback is
// delegated to NpcDialogueService (orchestrator).
//
// Contract: C-128 (origin), C-129 (polish), C-328 (orchestrator refactor)
// ---------------------------------------------------------------------------

export type DialogueOverlayViewModelOptions = BaseViewModelOptions & {
  /** NPC data from the ECS interaction event. */
  npcData: DialogueNpcData;
  /** Called when the player ends the conversation. */
  onEndChat: () => void;
  /**
   * NPC dialogue orchestrator — handles AI streaming and authored fallback.
   * Injected by the composition root for production; mocked in sandbox.
   */
  npcDialogueService: NpcDialogueServiceInterface;
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

  /** Active choices from the most recent NPC turn. */
  readonly activeChoices: readonly { id: string; label: string }[];

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
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice, C-330 Declared-DC
   */
  readonly skillCheckState: {
    readonly checkType: string;
    readonly difficultyClass: number;
    /** The stat modifier label (e.g. "CHA"). */
    readonly statModifier: string;
    /** The numeric value of the stat modifier (e.g. +2). */
    readonly statModifierValue: number;
    /** DC - statModifierValue = the number the player needs on the d20. */
    readonly targetNumber: number;
    readonly rollValue: number | null;
    /**
     * Interactive dice phase:
     * - `declared`: DC, modifier, and target shown; dice not yet interactive (C-330).
     * - `awaiting_click`: Dice visible, waiting for player click (C-162).
     * - `rolling`: Spin animation playing.
     * - `revealed`: Result shown.
     */
    readonly phase: 'declared' | 'awaiting_click' | 'rolling' | 'revealed';
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
   * Acknowledges the DC declaration and transitions to the interactive dice phase.
   *
   * Only valid when `skillCheckState.phase === 'declared'`.
   * After this, the dice becomes clickable.
   *
   * Contract: C-330 Declared-DC
   */
  acknowledgeDeclaration(): void;

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
   * Attempts non-combat resolution of the current encounter (C-330 AC-4).
   *
   * Only valid when the encounter has `allowNonCombatResolution`.
   * Performs the mechanical skill check (d20 + modifier vs DC),
   * resolves the outcome, and triggers success/failure dialogue.
   */
  tryNonCombatResolution(): Promise<void>;

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

  /** Whether the current turn offers a recruit action (C-340 AC-1). */
  readonly recruitAvailable: boolean;

  /** Executes the recruit action for the current NPC (C-340 AC-1). */
  recruitCompanion(): void;

  // ── C-343 Rich Chat UX Promotion ───────────────────────────────

  /** Cancels the active AI streaming request. */
  cancelStreaming(): void;

  /** Regenerates the NPC response for the given message (stores current as alternative). */
  regenerateResponse(messageId: string): void;

  /** Replaces a user message's text and re-generates NPC responses from that point. */
  editMessage(options: { messageId: string; newText: string }): void;

  /** Deletes a user message and all subsequent messages. */
  deleteMessage(messageId: string): void;

  /** Creates a new conversation branch starting from the given message. */
  createBranch(options: { parentMessageId: string; label?: string }): void;

  /** Switches to an existing conversation branch. */
  switchBranch(branchId: string): void;

  /** Whether a draft was restored from IndexedDB on open. */
  readonly showDraftRecovery: boolean;

  /** Dismisses the draft recovery badge. */
  dismissDraftRecovery(): void;

  /** Whether TTS is actively speaking (for pulse animation). */
  readonly isTtsSpeaking: boolean;

  /** Current address mode for dialogue prompt routing. */
  readonly addressMode: import('$lib/types/dialogue').DialogueAddressMode;

  /** Sets the address mode (Scene or GM only; Party deferred to C-340). */
  setAddressMode(mode: import('$lib/types/dialogue').DialogueAddressMode): void;

  /** Available conversation branches. */
  readonly branches: readonly import('$lib/types/dialogue').ConversationBranch[];

  /** The currently active branch ID, or null if on the main branch. */
  readonly activeBranchId: string | null;

  /** The ID of the message currently being edited, or null. */
  readonly editingMessageId: string | null;

  /** The current edit text for the message being edited inline. */
  readonly editText: string;

  /** Updates the edit text as the user types. */
  setEditText(text: string): void;

  /** Begins inline editing of a user message. */
  startEdit(messageId: string): void;

  /** Cancels inline editing of a user message. */
  cancelEdit(): void;

  /** The message ID pending deletion confirmation, or null. */
  readonly pendingDeleteMessageId: string | null;

  /** Confirms deletion of the pending message. */
  confirmDelete(): void;

  /** Cancels the pending deletion. */
  cancelDelete(): void;
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
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice, C-330 Declared-DC
   */
  skillCheckState: {
    checkType: string;
    difficultyClass: number;
    statModifier: string;
    statModifierValue: number;
    targetNumber: number;
    rollValue: number | null;
    phase: 'declared' | 'awaiting_click' | 'rolling' | 'revealed';
    isSuccess: boolean | null;
  } | null = $state(null);

  /** Whether the AI is resolving a structured skill check. */
  isResolvingSkillCheck = $state(false);

  /**
   * Guard flag set during the automatic roll phase of tryNonCombatResolution.
   * Prevents user-triggered rollDice() from overlapping with the auto-roll
   * during the 400ms delay after acknowledgeDeclaration.
   */
  private _isAutoRolling = false;

  /** Unified dice state mapping for the shared GameDice component. */
  get diceState(): DiceState | null {
    const s = this.skillCheckState;
    if (!s) {
      return null;
    }
    return {
      phase: s.phase === 'awaiting_click' || s.phase === 'declared' ? 'interactive' : s.phase,
      value: s.rollValue,
      isSuccess: s.isSuccess,
      checkInfo: {
        type: s.checkType,
        dc: s.difficultyClass,
        modLabel: s.statModifier,
        modValue: s.statModifierValue,
        target: s.targetNumber,
      },
      onRoll:
        s.phase === 'awaiting_click'
          ? () => {
              void this.rollDice();
            }
          : s.phase === 'declared'
            ? () => {
                this.acknowledgeDeclaration();
              }
            : undefined,
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

  // ── C-343 Rich Chat UX Promotion ───────────────────────────────

  /** Whether a draft was restored from IndexedDB on open. */
  showDraftRecovery = $state(false);

  /** Whether TTS is actively speaking (for pulse animation). */
  isTtsSpeaking = $state(false);

  /** Current address mode for dialogue prompt routing. */
  addressMode = $state<import('$lib/types/dialogue').DialogueAddressMode>('scene');

  /** Available conversation branches (in-memory). */
  branches = $state<import('$lib/types/dialogue').ConversationBranch[]>([]);

  /** The currently active branch ID, or null if on the main branch. */
  activeBranchId = $state<string | null>(null);

  /** The ID of the message currently being edited, or null. */
  editingMessageId = $state<string | null>(null);

  /** The current edit text for the message being edited inline. */
  editText = $state('');

  /** The message ID pending deletion confirmation, or null. */
  pendingDeleteMessageId = $state<string | null>(null);

  /** The active AbortController for the current streaming request. */
  private _activeAbortController: AbortController | null = null;

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  private readonly _onStartCombat?: (npcData: DialogueNpcData) => void;

  private readonly _npcDialogueService: NpcDialogueServiceInterface;

  private readonly _imageProviderAvailable: boolean;

  private readonly _chunker = new SentenceBoundaryChunker();

  private _ttsInitialized = false;

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
    this._onStartCombat = options.onStartCombat;
    this._npcDialogueService = options.npcDialogueService;
    this._imageProviderAvailable = options.imageProviderAvailable ?? true;

    // Restore per-chat input draft from IndexedDB (fire-and-forget)
    const draftPromise = draftStore.loadDraft({ chatId: this._npcData.npcId });
    if (draftPromise && typeof draftPromise.then === 'function') {
      void draftPromise.then((draft: string) => {
        if (draft) {
          this.inputText = draft;
          this.showDraftRecovery = true;
          this.debug('draftRecovery', { chatId: this._npcData.npcId });
          // Auto-dismiss the badge after 3 seconds
          setTimeout(() => {
            this.showDraftRecovery = false;
          }, 3000);
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
          alternativeCount: 0,
          alternativeLabel: '',
          canSwipeLeft: false,
          canSwipeRight: false,
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
        // gameModeService drives the current mode check
        if (gameModeService.currentMode === 'DIALOGUE' && this.inputElement) {
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
          this.isTtsSpeaking = true;
          ttsService.synthesize({
            text: sentence,
            voice: ttsService.selectedVoice,
          });
          // Reset TTS speaking indicator after a brief delay
          setTimeout(() => {
            this.isTtsSpeaking = false;
          }, 2000);
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

    // Compute the player's stat modifier for this skill
    const { statModifier, statModifierValue } = this._getStatModifier(option.skill);
    const targetNumber = Math.max(1, difficultyClass - statModifierValue);

    // Set up declared-DC phase first (C-330: DC committed before RNG)
    this.skillCheckState = {
      checkType: option.label,
      difficultyClass,
      statModifier,
      statModifierValue,
      targetNumber,
      rollValue: null,
      phase: 'declared',
      isSuccess: null,
    };
  }

  /** @inheritdoc */
  acknowledgeDeclaration(): void {
    const state = this.skillCheckState;
    if (state?.phase !== 'declared') {
      this.debug('acknowledgeDeclaration:invalid-phase', { phase: state?.phase });
      return;
    }

    // Transition to interactive dice — DC has been committed and acknowledged
    this.skillCheckState = { ...state, phase: 'awaiting_click' };
  }

  /** @inheritdoc */
  async tryNonCombatResolution(): Promise<void> {
    const encounterOpts = combatService.lastCombatOptions;
    if (!encounterOpts?.allowNonCombatResolution) {
      this.debug('tryNonCombatResolution:not-available');
      return;
    }

    this.debug('tryNonCombatResolution', { encounterId: encounterOpts.encounterId });

    // Use a default skill check — persuasion vs DC 12
    const difficultyClass = 12;
    const { statModifier, statModifierValue } = this._getStatModifier('persuasion');
    const targetNumber = Math.max(1, difficultyClass - statModifierValue);

    // Show the declared DC before rolling
    this.skillCheckState = {
      checkType: 'Negotiate',
      difficultyClass,
      statModifier,
      statModifierValue,
      targetNumber,
      rollValue: null,
      phase: 'declared',
      isSuccess: null,
    };
    this.dialoguePhase = 'DICE';

    // Guard against concurrent manual dice interaction during auto-roll (CR finding)
    this._isAutoRolling = true;

    // Auto-acknowledge and roll after brief delay
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    this.acknowledgeDeclaration();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    // Roll the d20 — release auto-roll guard now that the roll has been consumed
    this._isAutoRolling = false;
    const { natural: rollValue, total } = diceService.rollD20(statModifierValue);
    const isSuccess = total >= difficultyClass;

    const rollingState = this.skillCheckState;
    if (!rollingState) {
      return;
    }

    this.skillCheckState = {
      ...rollingState,
      rollValue,
      phase: 'rolling',
      isSuccess: null,
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));

    const revealState = this.skillCheckState;
    if (!revealState) {
      return;
    }

    this.skillCheckState = {
      ...revealState,
      phase: 'revealed',
      isSuccess,
    };

    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    this.skillCheckState = null;
    this.dialoguePhase = 'MENU';

    if (isSuccess) {
      // Non-combat resolution succeeded — avoid combat, mark encounter resolved
      this._appendNpcMessage(
        `*${this._npcData.npcName} lowers their guard — perhaps talking it out worked.*`,
      );
      // Emit encounter completed event for quest state (C-329)
      if (encounterOpts.encounterId) {
        this._emitEncounterCompleted(encounterOpts.encounterId, true);
      }
      this._onEndChat();
    } else {
      // Non-combat resolution failed — transition to combat
      this._appendNpcMessage(
        `*${this._npcData.npcName} is not convinced — words have failed. Combat begins!*`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      this._onEndChat();
      if (this._onStartCombat) {
        this._onStartCombat(this._npcData);
      }
    }
  }

  /**
   * Emits an ENCOUNTER_COMPLETED event via a standalone engine bridge (C-330 AC-4).
   * Uses the same pattern as quest_state_service for bridge event emission.
   */
  private _emitEncounterCompleted(encounterId: string, victory: boolean): void {
    this.debug('_emitEncounterCompleted', { encounterId, victory });
    void import('@aikami/frontend/engine').then(({ createEngineBridge }) => {
      const bridge = createEngineBridge();
      bridge.emit({ type: 'ENCOUNTER_COMPLETED', encounterId, victory });
    });
  }

  /** @inheritdoc */
  async rollDice(): Promise<void> {
    const state = this.skillCheckState;
    if (state?.phase !== 'awaiting_click') {
      this.debug('rollDice:invalid-phase', { phase: state?.phase });
      return;
    }

    // Prevent manual roll from overlapping with automatic roll (CR finding)
    if (this._isAutoRolling) {
      this.debug('rollDice:blocked-by-auto-roll');
      return;
    }

    // Roll the d20 with the player's stat modifier
    const { natural: rollValue, total } = diceService.rollD20(state.statModifierValue);
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
      alternativeCount: 0,
      alternativeLabel: '',
      canSwipeLeft: false,
      canSwipeRight: false,
    };
    this.messages = [...this.messages, playerMessage];

    // Delegate to the NPC dialogue orchestrator (handles AI + fallback)
    await this._delegateGenerateResponse();
  }

  /** @inheritdoc */
  endChat(): void {
    // Flush any remaining buffered text as a final sentence
    this._chunker.close();
    // C-343: Clean up message alternatives and branches on close
    for (const message of this.messages) {
      messageBranchStore.clearAlternatives(message.id);
    }
    this.branches = [];
    this.activeBranchId = null;
    this.showDraftRecovery = false;
    if (this._activeAbortController) {
      this._activeAbortController.abort();
      this._activeAbortController = null;
    }
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
      this.isTtsSpeaking = false;
    }
  }

  // ── C-343: Rich Chat UX Promotion ────────────────────────────────────

  /** @inheritdoc */
  cancelStreaming(): void {
    this.debug('cancelStreaming');
    if (this._activeAbortController) {
      this._activeAbortController.abort();
      this._activeAbortController = null;
    }
  }

  /** @inheritdoc */
  regenerateResponse(messageId: string): void {
    this.debug('regenerateResponse', { messageId });

    // Find the NPC message in the array
    const messageIndex = this.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1 || this.messages[messageIndex].role !== 'npc') {
      return;
    }

    const currentText = this.messages[messageIndex].content;

    // Remove this NPC message and everything after it, then regenerate
    const truncatedMessages = this.messages.slice(0, messageIndex);
    this.messages = truncatedMessages;

    // Store the current text as an alternative via messageBranchStore
    messageBranchStore.addAlternative({
      messageId,
      currentText,
      newText: '', // placeholder — will be replaced when new response arrives
    });

    // Trigger re-generation
    void this._delegateGenerateResponse();
  }

  /** @inheritdoc */
  editMessage(options: { messageId: string; newText: string }): void {
    const { messageId, newText } = options;
    this.debug('editMessage', { messageId });

    const messageIndex = this.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1 || this.messages[messageIndex].role !== 'player') {
      return;
    }

    // Update the message text
    this.messages = this.messages.map((m, i) =>
      i === messageIndex ? { ...m, content: newText } : m,
    );

    // Remove all subsequent messages and regenerate
    this.messages = this.messages.slice(0, messageIndex + 1);
    this.editingMessageId = null;

    // Restore input draft to the edited text
    this.inputText = newText;

    void this._delegateGenerateResponse();
  }

  /** @inheritdoc */
  deleteMessage(messageId: string): void {
    this.debug('deleteMessage', { messageId });
    this.pendingDeleteMessageId = messageId;
  }

  /** @inheritdoc */
  confirmDelete(): void {
    const messageId = this.pendingDeleteMessageId;
    if (!messageId) {
      return;
    }

    const messageIndex = this.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) {
      this.pendingDeleteMessageId = null;
      return;
    }

    // Remove this message and all subsequent messages
    this.messages = this.messages.slice(0, messageIndex);

    // If no messages remain, restore the NPC greeting
    if (this.messages.length === 0 && this._npcData.dialog) {
      this.messages = [
        {
          id: crypto.randomUUID(),
          content: this._npcData.dialog,
          role: 'npc' as const,
          alternativeCount: 0,
          alternativeLabel: '',
          canSwipeLeft: false,
          canSwipeRight: false,
        },
      ];
    }

    // Clear alternatives for the deleted message
    messageBranchStore.clearAlternatives(messageId);
    this.pendingDeleteMessageId = null;
  }

  /** @inheritdoc */
  cancelDelete(): void {
    this.pendingDeleteMessageId = null;
  }

  /** @inheritdoc */
  createBranch(options: { parentMessageId: string; label?: string }): void {
    const { parentMessageId, label } = options;
    this.debug('createBranch', { parentMessageId });

    // Cap at 5 branches
    if (this.branches.length >= 5) {
      this.showToast('Branch limit reached (max 5)');
      return;
    }

    const branchId = crypto.randomUUID();
    const branch: import('$lib/types/dialogue').ConversationBranch = {
      branchId,
      parentMessageId,
      messages: [...this.messages],
      createdAt: Date.now(),
      label: label ?? `Branch ${this.branches.length + 1}`,
    };

    this.branches = [...this.branches, branch];
    this.activeBranchId = branchId;
    this.showToast(`Branch "${branch.label ?? ''}" created!`);
  }

  /** @inheritdoc */
  switchBranch(branchId: string): void {
    this.debug('switchBranch', { branchId });

    // Save current messages to the active branch
    if (this.activeBranchId) {
      this.branches = this.branches.map((b) =>
        b.branchId === this.activeBranchId ? { ...b, messages: [...this.messages] } : b,
      );
    }

    const branch = this.branches.find((b) => b.branchId === branchId);
    if (!branch) {
      return;
    }

    this.messages = [...branch.messages];
    this.activeBranchId = branchId;
  }

  /** @inheritdoc */
  dismissDraftRecovery(): void {
    this.showDraftRecovery = false;
  }

  /** @inheritdoc */
  setAddressMode(mode: import('$lib/types/dialogue').DialogueAddressMode): void {
    this.debug('setAddressMode', { mode });
    this.addressMode = mode;
  }

  /** @inheritdoc */
  startEdit(messageId: string): void {
    const message = this.messages.find((m) => m.id === messageId);
    if (message && message.role === 'player') {
      this.editingMessageId = messageId;
      this.editText = message.content;
    }
  }

  /** @inheritdoc */
  setEditText(text: string): void {
    this.editText = text;
  }

  /** @inheritdoc */
  cancelEdit(): void {
    this.editingMessageId = null;
    this.editText = '';
  }

  // ── Orchestrator delegation ──────────────────────────────────────────

  /**
   * Delegates NPC response generation to the NPC dialogue orchestrator.
   * Handles both AI streaming and authored fallback paths via
   * NpcDialogueService.generateTurn.
   */
  private async _delegateGenerateResponse(): Promise<void> {
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
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];

    const controller = new AbortController();
    this._activeAbortController = controller;

    try {
      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages
        .filter((m) => m.id !== npcMessageId) // exclude placeholder
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const turn = await this._npcDialogueService.generateTurn({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
      });

      // Update the NPC message with the full response
      this.messages = this.messages.map((m) => {
        if (m.id !== npcMessageId) {
          return m;
        }
        // Update alternative tracking from messageBranchStore
        const enriched = messageBranchStore.enrichMessage({
          id: m.id,
          text: turn.narrative,
          sender: 'ai',
          timestamp: new Date(),
        });
        return {
          ...m,
          content: turn.narrative,
          alternativeCount: enriched.alternativeCount,
          alternativeLabel: enriched.alternativeLabel,
          canSwipeLeft: enriched.canSwipeLeft,
          canSwipeRight: enriched.canSwipeRight,
        };
      });

      // Append the follow-up choices as actionable buttons
      if (turn.choices.length > 0) {
        // Store choices on the NPC message for the View to render
        this._setMessageChoices(npcMessageId, turn);
      }

      // Execute any command from the turn, guarding against re-execution
      if (turn.command && !this._npcDialogueService.wasCommandExecuted(npcMessageId)) {
        // C-340: Show recruit button instead of auto-executing
        if (turn.command.kind === 'recruit') {
          this.recruitAvailable = true;
        } else {
          this._npcDialogueService.markCommandExecuted(npcMessageId, turn.command.kind);
          await this._dispatchCommand({ command: turn.command, npcMessageId });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('abort') || message.includes('AbortError')) {
        // C-343: Handle cancellation — replace placeholder with cancelled notice
        this.messages = this.messages.map((m) =>
          m.id === npcMessageId ? { ...m, content: '[Generation cancelled]' } : m,
        );
        // Restore the player's input from the last player message
        const lastPlayer = [...this.messages].reverse().find((m) => m.role === 'player');
        if (lastPlayer) {
          this.inputText = lastPlayer.content;
        }
      } else {
        this.streamError = message;
        // Replace the empty NPC message with an error placeholder
        this.messages = this.messages.map((m) =>
          m.id === npcMessageId ? { ...m, content: '*...*' } : m,
        );
      }
    } finally {
      this.isStreaming = false;
    }
  }

  /** Stores turn choices as message-level state for the View to render. */
  private _setMessageChoices(_npcMessageId: string, _turn: unknown): void {
    // Implementation note: choices are threaded through the turn object.
    // For now, the View can access the most recent NPC turn's choices
    // through a dedicated $state field.
    const turn = _turn as { choices: Array<{ id: string; label: string }> };
    this._activeChoices = turn.choices;
  }

  /** Active choices from the most recent NPC turn (rendered as buttons). */
  private _activeChoices = $state<Array<{ id: string; label: string }>>([]);

  /** @inheritdoc */
  get activeChoices(): readonly { id: string; label: string }[] {
    return this._activeChoices;
  }

  /** Whether the current turn offers a recruit action (C-340 AC-1). */
  recruitAvailable = $state<boolean>(false);

  /** Executes the recruit action for the current NPC. */
  recruitCompanion(): void {
    this._npcDialogueService.executeCommand({
      kind: 'recruit',
      npcId: this._npcData.npcId,
      npcName: this._npcData.npcName,
      command: { kind: 'recruit' },
    });
    this.recruitAvailable = false;
    this._appendNpcMessage(`*${this._npcData.npcName} has joined your party!*`);
  }

  // ── Private: Command dispatch to existing executors ──────────────────

  /**
   * Dispatches a validated dialogue command through the orchestrator's
   * executor boundary. UI concerns (combat transition message, delay)
   * remain in the ViewModel; the actual service dispatch is delegated
   * to npcDialogueService.executeCommand().
   *
   * Guards: command already validated by the orchestrator; re-execution
   * prevented by markCommandExecuted in _delegateGenerateResponse.
   */
  private async _dispatchCommand(options: {
    command: { kind: string } & Record<string, unknown>;
    npcMessageId: string;
  }): Promise<void> {
    const { command } = options;
    const kind = command.kind;

    this.debug('dispatchCommand', { kind });

    switch (kind) {
      case 'startCombat': {
        // UI transition message before executing
        this._appendNpcMessage(`*${this._npcData.npcName} reaches for a weapon — combat begins!*`);
        await new Promise<void>((resolve) => setTimeout(resolve, 1200));
        this._onEndChat();

        // Delegate combat start to the orchestrator
        this._npcDialogueService.executeCommand({
          kind,
          npcId: this._npcData.npcId,
          npcName: this._npcData.npcName,
          command: command as unknown as Parameters<
            NpcDialogueServiceInterface['executeCommand']
          >[0]['command'],
        });

        if (this._onStartCombat) {
          this._onStartCombat(this._npcData);
        }
        break;
      }
      default: {
        // Route all other commands through the orchestrator executor boundary
        const executed = this._npcDialogueService.executeCommand({
          kind,
          npcId: this._npcData.npcId,
          npcName: this._npcData.npcName,
          command: command as unknown as Parameters<
            NpcDialogueServiceInterface['executeCommand']
          >[0]['command'],
        });
        if (!executed) {
          this.debug('dispatchCommand:denied', { kind });
        }
        break;
      }
    }
  }

  // ── Private: Action Menu Helpers (C-162) ───────────────────────────

  /**
   * Returns a difficulty class for the given skill check against this NPC.
   *
   * Base DC is 12; harder NPC personas (guard, bandit, guildMaster) get
   * +2, softer personas (innkeeper, healer, merchant) get -2.
   *
   * Contract: C-162 BG3 Action Menu & Dice
   */
  private _getDifficultyClass(_skill: string): number {
    const hardPersonas = ['guard', 'bandit', 'guildMaster'] as const;
    const softPersonas = ['innkeeper', 'healer', 'merchant'] as const;
    const personaId = this._npcData.personaId ?? 'default';

    if (hardPersonas.includes(personaId as (typeof hardPersonas)[number])) {
      return 14;
    }
    if (softPersonas.includes(personaId as (typeof softPersonas)[number])) {
      return 10;
    }
    return 12;
  }

  /**
   * Returns the player's stat modifier for the given skill.
   *
   * Maps skills to stat abbreviations and provides default modifier values
   * for the demo. In a full implementation, this would read from the
   * player's character sheet.
   *
   * Contract: C-330 Declared-DC — modifier must be shown before RNG
   */
  private _getStatModifier(skill: string): {
    statModifier: string;
    statModifierValue: number;
  } {
    const SkillStatMap: Record<string, { label: string; value: number }> = {
      persuasion: { label: 'CHA', value: 2 },
      intimidation: { label: 'STR', value: 1 },
      // biome-ignore lint/style/useNamingConvention: content pack skill key convention
      sleight_of_hand: { label: 'DEX', value: 1 },
      stealth: { label: 'DEX', value: 1 },
      insight: { label: 'WIS', value: 1 },
      investigation: { label: 'INT', value: 0 },
      arcana: { label: 'INT', value: 0 },
      religion: { label: 'INT', value: 0 },
      nature: { label: 'WIS', value: 1 },
      medicine: { label: 'WIS', value: 1 },
      survival: { label: 'WIS', value: 1 },
      performance: { label: 'CHA', value: 1 },
      deception: { label: 'CHA', value: 2 },
      acrobatics: { label: 'DEX', value: 1 },
      athletics: { label: 'STR', value: 2 },
    };

    const entry = SkillStatMap[skill];
    if (entry) {
      return { statModifier: entry.label, statModifierValue: entry.value };
    }
    // Default: no modifier
    return { statModifier: '—', statModifierValue: 0 };
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
      // Delegate to the NPC dialogue orchestrator with the dice result
      // as part of the conversation so the model can respond contextually.
      const diceOutcome = `[Dice result: Skill=${skill}, DC=${difficultyClass}, Roll=${rollValue}, ${isSuccess ? 'SUCCESS' : 'FAILURE'}]`;
      const playerMessage = `\${this._npcData.npcName}, I attempt a ${skill} check. ${diceOutcome}`;

      const npcMessageId = crypto.randomUUID();
      this.messages = [
        ...this.messages,
        {
          id: npcMessageId,
          content: '',
          role: 'npc' as const,
          alternativeCount: 0,
          alternativeLabel: '',
          canSwipeLeft: false,
          canSwipeRight: false,
        },
      ];

      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages
        .filter((m) => m.id !== npcMessageId)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      // Add the virtual player message with dice result
      messages.push({ role: 'player', content: playerMessage });

      const controller = new AbortController();

      const turn = await this._npcDialogueService.generateTurn({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
      });

      // Remove the virtual player message
      this.messages = this.messages.filter((m) => m.id !== npcMessageId);

      // Append the NPC's narrative response
      this._appendNpcMessage(turn.narrative);

      // Execute any command
      if (turn.command && !this._npcDialogueService.wasCommandExecuted(npcMessageId)) {
        this._npcDialogueService.markCommandExecuted(npcMessageId, turn.command.kind);
        await this._dispatchCommand({ command: turn.command, npcMessageId });
      }
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
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
  }
}

export { DialogueOverlayViewModel };

/**
 * Factory function for DialogueOverlayViewModel.
 * Uses BaseViewModel.create() for auto-logging instrumentation.
 *
 * Contract: C-314 AC-3 — ViewModels created via factory, never raw `new`.
 */
export const getDialogueOverlayViewModel = (
  options: DialogueOverlayViewModelOptions,
): DialogueOverlayViewModelInterface => DialogueOverlayViewModel.create(options);
