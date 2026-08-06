// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import { SKILL_STAT_MAP } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { NpcQuestActivation, NpcSuggestionChip } from '@aikami/types';
import type { DiceState } from '$lib/components/game/game_dice.svelte';
import { mergeInitialSuggestions } from '$lib/data/initial_suggestion_presets';
import { resolveNpcAvatarUrl, resolvePlayerAvatarUrl } from '$lib/data/npc_avatar_catalog';
import { expressionService } from '$lib/services/expression/expression_service.svelte.ts';
import type { NpcDialogueServiceInterface } from '$services';
import {
  buildGameStateFacts,
  combatService,
  diceService,
  draftStore,
  gameModeService,
  messageBranchStore,
  playerStateService,
  questStateService,
  SentenceBoundaryChunker,
  ttsService,
} from '$services';
import type {
  ConversationBranch,
  DialogueAddressMode,
  DialogueMessage,
  DialoguePhase,
  ExpressionId,
} from '$types';
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

/** A generated scene image anchored to a conversation message (C-162 devtools). */
export type GeneratedImage = {
  /** Unique image identifier. */
  id: string;
  /** The image URL, or null while generating. */
  url: string | null;
  /** Current generation status. */
  status: 'generating' | 'done' | 'error';
  /** Message this image was created after; null = created before any message. */
  afterMessageId: string | null;
};

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

  /** Current expression ID for the NPC (updated by expression agent/keyword detection). */
  readonly npcExpression: ExpressionId;

  /** URL for the player character's avatar image. */
  readonly playerAvatarUrl: string;

  /** Which speaker is currently highlighted ('npc' while streaming, 'player' while typing). */
  readonly highlightSpeaker: 'npc' | 'player' | null;

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

  /**
   * Suggested follow-up chips from the LLM or authored fallback.
   * Shown below the most recent NPC message. 0–4 chips.
   *
   * Contract: C-371 Suggestion Chips
   */
  readonly suggestedChips: readonly NpcSuggestionChip[];

  /**
   * Taps a suggestion chip — pre-fills the input with the chip's
   * prefillText and sends it as a player message.
   *
   * Contract: C-371 Suggestion Chips
   */
  handleChipTap(chipId: string): void;

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

  /**
   * Generated scene images, ordered by creation.
   * Each image lives at the message index where it was requested.
   */
  readonly generatedImages: readonly GeneratedImage[];

  /** Party UI visibility toggle. */
  readonly showPartyUi: boolean;

  /** Latest dice roll result banner (null when no banner to show). */
  readonly rollResultBanner: {
    value: number;
    dc: number;
    checkType: string;
    isSuccess: boolean;
    afterMessageId: string;
  } | null;

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

  /** Switches to an existing conversation branch. Pass null to restore the main (base) conversation. */
  switchBranch(branchId: string | null): void;

  /** Speaks the given NPC message text via TTS. */
  speakMessage(text: string): void;

  /** Whether a draft was restored from IndexedDB on open. */
  readonly showDraftRecovery: boolean;

  /** Dismisses the draft recovery badge. */
  dismissDraftRecovery(): void;

  /** Whether TTS is actively speaking (for pulse animation). */
  readonly isTtsSpeaking: boolean;

  /** Current address mode for dialogue prompt routing. */
  readonly addressMode: DialogueAddressMode;

  /** Sets the address mode (Scene or GM only; Party deferred to C-340). */
  setAddressMode(mode: DialogueAddressMode): void;

  /** Available conversation branches. */
  readonly branches: readonly ConversationBranch[];

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
  messages = $state<DialogueMessage[]>([]);

  isStreaming = $state<boolean>(false);

  inputText = $state<string>('');

  streamError = $state<string | null>(null);

  /**
   * Current phase of the dialogue interaction loop.
   * Starts in `FREE_TEXT` — free-text input always visible (C-371).
   */
  dialoguePhase = $state<DialoguePhase>('FREE_TEXT');

  /**
   * Suggested follow-up chips from the most recent NPC response.
   * 0–4 chips derived from LLM output or authored fallback.
   */
  suggestedChips = $state<NpcSuggestionChip[]>([]);

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

  /** Generated scene images, ordered by creation (C-162 devtools). */
  generatedImages = $state<GeneratedImage[]>([]);

  /** Party UI visibility toggle (default: hidden). */
  showPartyUi = $state(false);

  // ── C-343 Rich Chat UX Promotion ───────────────────────────────

  /** Whether a draft was restored from IndexedDB on open. */
  showDraftRecovery = $state(false);

  /** Whether TTS is actively speaking (for pulse animation). */
  isTtsSpeaking = $state(false);

  /** Current address mode for dialogue prompt routing. */
  addressMode = $state<DialogueAddressMode>('scene');

  /** Available conversation branches (in-memory). */
  branches = $state<ConversationBranch[]>([]);

  /** The currently active branch ID, or null if on the main branch. */
  activeBranchId = $state<string | null>(null);

  /** Snapshot of the base (main) conversation — preserved for branch restore. */
  private _baseMessages: DialogueMessage[] = [];

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

      // Preload suggestion chips: the NPC's authored initial suggestions
      // (content pack) merged with the player class's preset hooks.
      this.suggestedChips = mergeInitialSuggestions(
        this._npcData.initialSuggestions,
        playerStateService.classId,
      );
      if (this.suggestedChips.length > 0) {
        this.debug('initialSuggestions', {
          npcId: this._npcData.npcId,
          chipCount: this.suggestedChips.length,
          classId: playerStateService.classId,
        });
      }
    }
  }

  get npcName(): string {
    return this._npcData.npcName;
  }

  /**
   * NPC avatar URL — resolved from the NPC portrait catalog keyed by
   * npcId/personaId. Logs an error and returns a placeholder when no
   * portrait is configured (never the in-world LPC body spritesheet).
   */
  get npcAvatarUrl(): string {
    return resolveNpcAvatarUrl({
      npcId: this._npcData.npcId,
      npcName: this._npcData.npcName,
      personaId: this._npcData.personaId,
      expression: this.npcExpression,
    });
  }

  /** Current NPC expression — defaults to neutral, updated by detection. */
  npcExpression = $state<ExpressionId>('neutral');

  /** Player avatar URL — resolved from the active player character's class. */
  get playerAvatarUrl(): string {
    return resolvePlayerAvatarUrl({ classId: playerStateService.classId });
  }

  /** Which speaker is highlighted — derived from streaming/input state. */
  highlightSpeaker = $state<'npc' | 'player' | null>(null);

  /** Dice roll result banner — shown centered in chat after a roll resolves. */
  rollResultBanner = $state<{
    value: number;
    dc: number;
    checkType: string;
    isSuccess: boolean;
    afterMessageId: string;
  } | null>(null);

  /** @inheritdoc */
  get imageProviderAvailable(): boolean {
    return this._imageProviderAvailable;
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
  setInput(text: string): void {
    this.inputText = text;
    // Fire-and-forget draft save
    void draftStore.saveDraft({ chatId: this._npcData.npcId, text });
  }

  // ── Suggestion Chips (C-371) ────────────────────────────────────────

  /** @inheritdoc */
  handleChipTap(chipId: string): void {
    const chip = this.suggestedChips.find((c) => c.id === chipId);
    if (!chip || this.isStreaming || this.isResolvingSkillCheck) {
      return;
    }

    this.debug('handleChipTap', { chipId, intentType: chip.intentType });

    // If the chip is a combat intent, trigger direct combat
    if (chip.intentType === 'combat') {
      void this._handleDirectCombat();
      return;
    }

    // Otherwise, pre-fill and send as a player message.
    // Use the label as fallback if the LLM's prefillText is too short/nonsensical.
    const messageText = chip.prefillText.length >= 10 ? chip.prefillText : chip.label;
    this.inputText = messageText;
    void this.sendMessage(messageText);
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
    const skillEntry = SKILL_STAT_MAP.persuasion;
    const statModifier = skillEntry?.stat ?? '—';
    const statModifierValue = skillEntry?.defaultModifier ?? 0;
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

    // Show the result as a centered banner in chat
    this.rollResultBanner = {
      value: rollValue,
      dc: revealState.difficultyClass,
      checkType: revealState.checkType,
      isSuccess,
      afterMessageId: this.messages.at(-1)?.id ?? '',
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

    // ── C-371: Call #2 — roll resolution ────────────────────────────
    await this._executeRollResolution({
      checkType: state.checkType,
      difficultyClass: state.difficultyClass,
      rollValue,
      total,
      isSuccess,
    });

    // Clear dice overlay and return to FREE_TEXT
    this.skillCheckState = null;
    this.dialoguePhase = 'FREE_TEXT';
  }

  /**
   * C-371: Call #2 — sends the dice outcome to the LLM for narrative resolution.
   */
  private async _executeRollResolution(options: {
    checkType: string;
    difficultyClass: number;
    rollValue: number;
    total: number;
    isSuccess: boolean;
  }): Promise<void> {
    const { checkType, difficultyClass, total, isSuccess } = options;
    this.isResolvingSkillCheck = true;

    try {
      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages.map(
        (m) => ({
          role: m.role,
          content: m.content,
        }),
      );

      const lastPlayerMsg = [...this.messages].reverse().find((m) => m.role === 'player');
      const playerInput = lastPlayerMsg?.content ?? '';

      const resolution = await this._npcDialogueService.resolveRoll({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: new AbortController().signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        checkType,
        difficultyClass,
        rollTotal: total,
        outcome: isSuccess ? 'pass' : 'fail',
        playerInput,
      });

      this._appendNpcMessage(resolution.narrativeResult);
      this.suggestedChips = resolution.suggestedChips;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.warn('_executeRollResolution:failed', { msg });
      this.streamError = msg;
    } finally {
      this.isResolvingSkillCheck = false;
    }
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
    this.suggestedChips = [];

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

    // ── GM mode: send to Game Master instead of NPC ──────────────
    if (this.addressMode === 'gm') {
      await this._sendToGameMaster(content);
      return;
    }

    // ── C-371: Two-call pipeline ────────────────────────────────────
    if (this._npcDialogueService.useFreeTextFirst) {
      await this._sendWithIntentAnalysis(content);
    } else {
      // Single-call generateTurn
      await this._delegateGenerateResponse();
    }
  }

  /**
   * GM Mode: sends the player's message directly to the Game Master.
   * The GM responds as the dungeon master, not as an NPC.
   */
  private async _sendToGameMaster(_content: string): Promise<void> {
    this.isStreaming = true;
    this.highlightSpeaker = 'npc';
    this.streamError = null;

    const controller = new AbortController();
    this._activeAbortController = controller;

    try {
      const gmResponse = await this._npcDialogueService.analyzeIntent({
        npcId: this._npcData.npcId,
        npcName: 'Game Master',
        messages: this.messages.map((m) => ({
          role: m.role === 'player' ? 'player' : ('npc' as const),
          content: m.content,
        })),
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        playerContext: {
          characterSheetSummary: 'Level 1 Fighter',
          level: 1,
          classId: 'fighter',
        },
      });

      this._appendNpcMessage(`🎭 *Game Master*\n${gmResponse.npcResponse}`);
      this.suggestedChips = gmResponse.suggestedChips;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.warn('_sendToGameMaster:failed', { msg });
      this._appendNpcMessage('🎭 *The Game Master remains silent...*');
    } finally {
      this.isStreaming = false;
      this.highlightSpeaker = null;
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /**
   * C-371: Sends a player message through the two-call intent analysis pipeline.
   * Call #1 (analyzeIntent) → if roll needed: DECLARED_DC → dice → rollDice → call #2.
   * If no roll needed: display narrative + chips directly.
   */
  private async _sendWithIntentAnalysis(_content: string, npcMessageId?: string): Promise<void> {
    this.isStreaming = true;
    this.highlightSpeaker = 'npc';

    const controller = new AbortController();
    this._activeAbortController = controller;

    try {
      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages.map(
        (m) => ({
          role: m.role,
          content: m.content,
        }),
      );

      const analysis = await this._npcDialogueService.analyzeIntent({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
      });

      // Display the pre-roll narrative
      this._appendNpcMessage(analysis.npcResponse, npcMessageId);

      // Run expression detection on the NPC response
      void this._detectExpression(analysis.npcResponse);

      // Execute the GM's quest-activation tool call (accept/decline), if any.
      this._applyQuestActivation(analysis.questActivation);

      // Show suggestion chips
      this.suggestedChips = analysis.suggestedChips;

      if (analysis.requiresRoll && analysis.checkType && analysis.difficultyClass) {
        // ── Roll needed: enter DECLARED_DC → DICE flow ──────────────
        const modSource = analysis.modifierSource ?? '—';
        const modValue = 0; // TODO: read from character sheet when available
        const targetNumber = Math.max(1, analysis.difficultyClass - modValue);

        this.skillCheckState = {
          checkType: analysis.checkType,
          difficultyClass: analysis.difficultyClass,
          statModifier: modSource,
          statModifierValue: modValue,
          targetNumber,
          rollValue: null,
          phase: 'declared',
          isSuccess: null,
        };
        this.dialoguePhase = 'DECLARED_DC';
      } else {
        // ── No roll needed: stay in FREE_TEXT ────────────────────────
        this.dialoguePhase = 'FREE_TEXT';
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.warn('_sendWithIntentAnalysis:failed', { msg });
      this.streamError = msg;
    } finally {
      this.isStreaming = false;
      this.highlightSpeaker = null;
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /**
   * Executes the GM's quest-activation tool call returned from intent
   * analysis. Accepts or declines the quest (gated to quests this NPC can
   * offer), toasts the player, and lets the quest tracker + overlay update
   * reactively via questStateService.
   */
  private _applyQuestActivation(activation: NpcQuestActivation | undefined): void {
    if (!activation) {
      return;
    }
    const { action, questId } = activation;

    if (action === 'decline') {
      // Only decline quests this NPC can actually offer — never mutate quest
      // state for an identifier the NPC has no offerable quest for.
      const offerable = questStateService.getOfferableQuests(this._npcData.npcId);
      const quest = offerable.find((q) => q.id === questId);
      if (!quest) {
        this.warn('_applyQuestActivation:not-offerable', {
          questId,
          npcId: this._npcData.npcId,
        });
        return;
      }
      questStateService.declineQuest({ questId });
      this.showSnackbar({ text: 'Quest declined.', type: 'info' });
      this.debug('_applyQuestActivation:declined', { questId, npcId: this._npcData.npcId });
      return;
    }

    // Accept — only quests this NPC can actually offer.
    const offerable = questStateService.getOfferableQuests(this._npcData.npcId);
    const quest = offerable.find((q) => q.id === questId);
    if (!quest) {
      this.warn('_applyQuestActivation:not-offerable', {
        questId,
        npcId: this._npcData.npcId,
      });
      return;
    }

    const accepted = questStateService.acceptQuest({
      questId,
      npcId: this._npcData.npcId,
    });
    if (accepted) {
      this.showSnackbar({ text: `📜 Quest accepted: ${quest.name}`, type: 'success' });
      this.debug('_applyQuestActivation:accepted', { questId, npcId: this._npcData.npcId });
    } else {
      this.showSnackbar({ text: 'Quest could not be accepted.', type: 'warning' });
    }
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
  speakMessage(text: string): void {
    if (!text) {
      this.debug('speakMessage:skipped-empty');
      return;
    }
    if (ttsService.status !== 'ready') {
      this.warn('speakMessage:skipped-not-ready', { status: ttsService.status });
      return;
    }
    this.debug('speakMessage:speaking', { length: text.length });
    void ttsService.speak({ text });
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

    // Find the last player message before this NPC message (what triggered it)
    const lastPlayerMsg = this.messages
      .slice(0, messageIndex)
      .reverse()
      .find((m) => m.role === 'player');

    // Generate replacement message ID before removing the old message
    const replacementMessageId = crypto.randomUUID();

    // Remove this NPC message and everything after it, then regenerate
    const truncatedMessages = this.messages.slice(0, messageIndex);
    this.messages = truncatedMessages;

    // Store the current text as an alternative under the replacement ID
    messageBranchStore.addAlternative({
      messageId: replacementMessageId,
      currentText,
      newText: '',
    });

    // C-371: Route through the same pipeline as sendMessage
    if (this._npcDialogueService.useFreeTextFirst && lastPlayerMsg) {
      void this._sendWithIntentAnalysis(lastPlayerMsg.content, replacementMessageId);
    } else {
      void this._delegateGenerateResponse({ npcMessageId: replacementMessageId });
    }
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

    // C-371: Route through the same pipeline as sendMessage
    if (this._npcDialogueService.useFreeTextFirst) {
      // Clear input and draft after assigning newText
      this.inputText = '';
      void draftStore.clearDraft({ chatId: this._npcData.npcId });
      void this._sendWithIntentAnalysis(newText);
    } else {
      void this._delegateGenerateResponse();
    }
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

    // If no messages remain, restore the NPC greeting + initial suggestions
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
      this.suggestedChips = mergeInitialSuggestions(
        this._npcData.initialSuggestions,
        playerStateService.classId,
      );
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
    const branch: ConversationBranch = {
      branchId,
      parentMessageId,
      messages: [...this.messages],
      createdAt: Date.now(),
      label: label ?? `Branch ${this.branches.length + 1}`,
    };

    // Save base conversation snapshot before first branch so Main is restorable
    if (this.activeBranchId === null && this._baseMessages.length === 0) {
      this._baseMessages = [...this.messages];
    }

    this.branches = [...this.branches, branch];
    this.activeBranchId = branchId;
    this.showToast(`Branch "${branch.label ?? ''}" created!`);
  }

  /** @inheritdoc */
  switchBranch(branchId: string | null): void {
    this.debug('switchBranch', { branchId });

    // Save current messages to the active branch before switching away
    if (this.activeBranchId) {
      this.branches = this.branches.map((b) =>
        b.branchId === this.activeBranchId ? { ...b, messages: [...this.messages] } : b,
      );
    } else if (branchId !== null) {
      // Switching from Main to a branch — save current messages as base
      this._baseMessages = [...this.messages];
    }

    // Restore main branch (null target)
    if (branchId === null) {
      this.messages = this._baseMessages.length > 0 ? [...this._baseMessages] : this.messages;
      this.activeBranchId = null;
      return;
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
  setAddressMode(mode: DialogueAddressMode): void {
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
  private async _delegateGenerateResponse(options?: { npcMessageId?: string }): Promise<void> {
    this.isStreaming = true;
    this.streamError = null;

    // Create a placeholder NPC message that accumulates streamed tokens
    const npcMessageId = options?.npcMessageId ?? crypto.randomUUID();
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
  private _appendNpcMessage(content: string, messageId?: string): void {
    this.messages = [
      ...this.messages,
      {
        id: messageId ?? crypto.randomUUID(),
        content,
        role: 'npc' as const,
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
  }

  /**
   * Runs expression detection on NPC response text and updates {@link npcExpression}.
   */
  protected async _detectExpression(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    try {
      // Get available expressions for this NPC (overridable in subclasses like dev sandbox)
      const availableExpressions = this._getAvailableExpressions();

      const result = await expressionService.detectExpression({
        message: text,
        characters: [this._npcData.npcName],
        availableExpressions,
      });

      const detectedExpression = result.expressionMap[this._npcData.npcName];
      if (detectedExpression && availableExpressions.includes(detectedExpression)) {
        this.npcExpression = detectedExpression;
        this.debug('_detectExpression', {
          npc: this._npcData.npcName,
          expression: detectedExpression,
          tier: result.detectionTier,
        });
      }
    } catch {
      // Expression detection is non-critical — silently skip failures
    }
  }

  /**
   * Returns the list of available expressions for the current NPC.
   * Overridable in subclasses (e.g., dev sandbox uses sprite-specific expressions).
   */
  protected _getAvailableExpressions(): string[] {
    return ['neutral', 'happy', 'sad', 'angry', 'surprised'];
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
