// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import {
  DEFAULT_SKILL_CHECK_STAKES,
  SKILL_CHECK_STAKES,
  SKILL_STAT_MAP,
  type SkillCheckStakes,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type NpcQuestActivation,
  type NpcSuggestionChip,
} from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  computeSkillModifier,
  serializeForAi,
} from '@aikami/utils';
import type { DiceState } from '$lib/components/game/game_dice.svelte';
import { mergeInitialSuggestions } from '$lib/data/initial_suggestion_presets';
import { resolveNpcAvatarUrl, resolvePlayerAvatarUrl } from '$lib/data/npc_avatar_catalog';
import type { NpcDialogueServiceInterface, PlayerStateServiceInterface } from '$services';
import {
  buildGameStateFacts,
  combatService,
  diceService,
  draftStore,
  expressionService,
  gameModeService,
  imageGenerationService,
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
import {
  parseSlashCommand,
  SLASH_COMMAND_HELP,
  type SlashCommandResult,
} from '../../../../../services/game/slash_command_parser';
import type { DialogueNpcData } from '../../game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// Skill-check breakdown types (C-487) — UI-state types owned by this ViewModel.
// Not persisted domain types; do not add to @aikami/types.
// ---------------------------------------------------------------------------

/**
 * The named two-component breakdown of a skill check's total modifier.
 * Computed from the real character sheet, never from the model's `modifierSource`.
 */
export type SkillCheckBreakdown = {
  /** Governing ability key (e.g. "charisma") — undefined when unresolvable. */
  ability: AbilityKey | undefined;
  /** Three-letter ability label for display (e.g. "CHA"). */
  abilityLabel: string;
  /** The governing ability's modifier (computeModifier(score)). */
  abilityModifier: number;
  /** Whether the character is proficient in the checked skill. */
  isProficient: boolean;
  /** Whether the character has expertise in the checked skill. */
  isExpertise: boolean;
  /** Proficiency bonus added to the roll (0 when not proficient). */
  proficiencyBonus: number;
  /** Total modifier: computeSkillModifier(abilityModifier, isProficient, proficiencyBonus, isExpertise). */
  totalModifier: number;
};

/** Runtime shape of the declared-DC skill check state rendered by the overlay (C-487). */
export type DialogueSkillCheckState = {
  checkType: string;
  difficultyClass: number;
  breakdown: SkillCheckBreakdown;
  stakes: SkillCheckStakes;
  /** max(1, DC - totalModifier) — the number the player needs on the d20. */
  targetNumber: number;
  rollValue: number | null;
  phase: 'declared' | 'awaiting_click' | 'rolling' | 'revealed';
  isSuccess: boolean | null;
};

/** Maps a three-letter ability label ("CHA") to its canonical AbilityKey ("charisma"). */
const ABILITY_KEY_BY_LABEL: Record<string, AbilityKey> = Object.fromEntries(
  ABILITY_KEYS.map((key) => [ABILITY_LABELS[key], key]),
) as Record<string, AbilityKey>;

/**
 * Normalises a model-authored `checkType` (Title Case, spaces) to the
 * camelCase `SKILL_STAT_MAP` key: "Sleight Of Hand" → "sleightOfHand",
 * "Persuasion" → "persuasion". A direct lookup misses otherwise (C-487 AC-1).
 */
const normalizeCheckType = (checkType: string): string => {
  const words = checkType.trim().split(/\s+/);
  if (words.length === 1) {
    const word = words[0] ?? '';
    return word.charAt(0).toLowerCase() + word.slice(1);
  }
  return words
    .map((word, index) => {
      const lowercaseWord = word.toLowerCase();
      if (index === 0) {
        return lowercaseWord;
      }
      return lowercaseWord.charAt(0).toUpperCase() + lowercaseWord.slice(1);
    })
    .join('');
};

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
  /** Player state owner; dev sandboxes inject an isolated instance. */
  playerStateService?: PlayerStateServiceInterface;
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
  /**
   * Whether this dialogue is part of consequential campaign play (the
   * production `/game` overlay). When true, transcript-rewinding controls
   * (branch/edit/delete) are gated out and retry is presented honestly as
   * "Rephrase" (C-490). The dev sandbox and non-campaign chat modes keep
   * them. Defaults to `true` (the production overlay is always campaign).
   */
  isCampaignPlay?: boolean;
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

  /** Whether the pending NPC response should show a typing indicator. */
  readonly isTyping: boolean;

  /**
   * Streamed narrative text for the in-flight turn (C-401). Grows as tokens
   * arrive, frame-batched to at most one `$state` write per animation frame.
   * Empty when no turn is streaming.
   */
  readonly streamingText: string;

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
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice, C-330 Declared-DC,
   * C-487 — breakdown + stakes sourced from the real character sheet.
   */
  readonly skillCheckState: DialogueSkillCheckState | null;

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

  /**
   * Player messages submitted while the NPC was streaming, awaiting delivery.
   * FIFO-ordered. Each entry is already visible in `messages` as a pending
   * player bubble; entries are delivered in order, one per completed turn,
   * only while auto-drain is enabled.
   */
  readonly pendingMessages: readonly string[];

  /**
   * Re-enables auto-drain and delivers all pending queued messages in FIFO
   * order, one per completed turn. Used to explicitly retry messages that were
   * retained after a failed or cancelled stream.
   */
  retryPending(): void;

  /** Regenerates the NPC response for the given message (stores current as alternative). */
  regenerateResponse(messageId: string): void;

  /**
   * C-490: Regenerates an NPC reply as a presentation-only "Rephrase". Unlike
   * `regenerateResponse`, this path never re-applies state mutations
   * (NpcStateDelta / quest activation / dialogue commands) — the world is not
   * rewound along with the transcript. The previous text is stored as an
   * alternative for swipe recovery.
   */
  rephraseResponse(messageId: string): void;

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

  /**
   * Whether this dialogue is consequential campaign play. Gates the
   * transcript-rewinding controls (branch/edit/delete) and relabels retry as
   * "Rephrase" (C-490). False in the dev sandbox and non-campaign chat modes.
   */
  readonly isCampaignPlay: boolean;

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

  /** @inheritdoc */
  get isTyping(): boolean {
    if (!this.isStreaming) {
      return false;
    }
    const latestMessage = this.messages.at(-1);
    return latestMessage?.role === 'player' || latestMessage?.content === '';
  }

  /** Streamed narrative for the in-flight turn (C-401). */
  streamingText = $state<string>('');

  /** Frame-batched buffer — flushed to {@link streamingText} once per frame. */
  private _streamBuffer = '';

  /** Whether a rAF flush of `_streamBuffer` is scheduled. */
  private _streamFrameScheduled = false;

  /** Monotonic stream epoch — stale flushes from a previous turn are dropped. */
  private _streamEpoch = 0;

  /** @inheritdoc */
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
   * Contract: C-157 Dialogue Skill Checks, C-162 Interactive Dice, C-330 Declared-DC,
   * C-487 — breakdown + stakes sourced from the real character sheet.
   */
  skillCheckState: DialogueSkillCheckState | null = $state(null);

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
    let onRoll: (() => void) | undefined;
    if (s.phase === 'awaiting_click') {
      onRoll = this._boundDiceRoll;
    } else if (s.phase === 'declared') {
      onRoll = this._boundDiceDeclaration;
    } else {
      onRoll = undefined;
    }
    return {
      phase: s.phase === 'awaiting_click' || s.phase === 'declared' ? 'interactive' : s.phase,
      value: s.rollValue,
      isSuccess: s.isSuccess,
      checkInfo: {
        type: s.checkType,
        dc: s.difficultyClass,
        modLabel: s.breakdown.abilityLabel,
        modValue: s.breakdown.totalModifier,
        target: s.targetNumber,
        breakdown: {
          abilityLabel: s.breakdown.abilityLabel,
          abilityModifier: s.breakdown.abilityModifier,
          isProficient: s.breakdown.isProficient,
          isExpertise: s.breakdown.isExpertise,
          proficiencyBonus: s.breakdown.proficiencyBonus,
          totalModifier: s.breakdown.totalModifier,
        },
        stakes: s.stakes,
      },
      onRoll,
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

  /**
   * Whether TTS is actively speaking (for the pulse animation). Derived from
   * the TTS service's live playback state so the indicator tracks real audio
   * rather than a best-effort timeout.
   */
  get isTtsSpeaking(): boolean {
    return this.streamingTtsEnabled && ttsService.isPlaying;
  }

  /** Current address mode for dialogue prompt routing. */
  addressMode = $state<DialogueAddressMode>('scene');

  /**
   * Whether this dialogue is consequential campaign play. Gates transcript
   * rewinding (branch/edit/delete) and relabels retry as "Rephrase" (C-490).
   * Defaults to true for the production overlay; the dev sandbox sets false.
   */
  readonly isCampaignPlay: boolean;

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

  /**
   * Overlay-session-scoped FIFO queue of player messages submitted while the
   * NPC was still streaming. Each entry is already visible in `messages` as a
   * pending player bubble; entries are delivered in FIFO order, one per
   * completed turn, only while auto-drain is enabled.
   */
  private _pendingQueue = $state<string[]>([]);

  /**
   * Whether auto-drain of `_pendingQueue` is allowed. Disabled when a turn
   * fails or is cancelled so queued messages are retained as visible pending
   * items until an explicit Retry/Send (`retryPending`). Re-enabled by
   * `retryPending` and reset on `endChat`.
   */
  private _drainEnabled = true;

  /** True while a queued-message delivery turn is in flight (prevents double-drain). */
  private _isDraining = false;

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  private readonly _onStartCombat?: (npcData: DialogueNpcData) => void;

  private readonly _npcDialogueService: NpcDialogueServiceInterface;

  private readonly _playerStateService: PlayerStateServiceInterface;

  private readonly _imageProviderAvailable: boolean;

  private readonly _chunker = new SentenceBoundaryChunker();

  private readonly _boundDiceRoll: () => void = this._handleDiceRoll.bind(this);
  private readonly _boundDiceDeclaration: () => void = this._handleDiceDeclaration.bind(this);

  private _ttsInitialized = false;

  private _handleDiceRoll(): void {
    void this.rollDice();
  }

  private _handleDiceDeclaration(): void {
    this.acknowledgeDeclaration();
  }

  /**
   * Computes the named modifier breakdown from the real character sheet (C-487).
   *
   * The model's `modifierSource` is never consulted for the number — the sheet
   * is the sole authority. `SKILL_STAT_MAP[checkType]` resolves the governing
   * stat; the sheet skill resolves proficiency/expertise. An unmapped check type
   * falls back to the raw ability modifier with no invented bonus (and logs).
   */
  protected _computeSkillCheckBreakdown(checkType: string): SkillCheckBreakdown {
    const sheet = this._playerStateService.characterSheet;
    const mapKey = normalizeCheckType(checkType);
    const statEntry = SKILL_STAT_MAP[mapKey];

    const sheetSkill = sheet.skills.find((s) => s.name.toLowerCase() === checkType.toLowerCase());

    const abilityKey: AbilityKey | undefined = statEntry
      ? ABILITY_KEY_BY_LABEL[statEntry.stat]
      : sheetSkill?.ability;

    if (!abilityKey) {
      // No resolvable governing ability — do not invent a bonus.
      this.warn('skillCheck:unknown-checkType', { checkType, mapKey });
      return {
        ability: undefined,
        abilityLabel: '—',
        abilityModifier: 0,
        isProficient: sheetSkill?.isProficient ?? false,
        isExpertise: sheetSkill?.isExpertise ?? false,
        proficiencyBonus: 0,
        totalModifier: 0,
      };
    }

    const abilityScore = sheet.abilities[abilityKey];
    if (!abilityScore) {
      // Resolved an ability key but the sheet has no score for it.
      this.warn('skillCheck:missing-ability-score', { checkType, ability: abilityKey });
      return {
        ability: abilityKey,
        abilityLabel: ABILITY_LABELS[abilityKey],
        abilityModifier: 0,
        isProficient: sheetSkill?.isProficient ?? false,
        isExpertise: sheetSkill?.isExpertise ?? false,
        proficiencyBonus: 0,
        totalModifier: 0,
      };
    }

    const abilityModifier = computeModifier(abilityScore.value);
    const proficiencyBonus = computeProficiencyBonus(sheet.level);
    const isProficient = sheetSkill?.isProficient ?? false;
    const isExpertise = sheetSkill?.isExpertise ?? false;
    const totalModifier = computeSkillModifier(
      abilityModifier,
      isProficient,
      proficiencyBonus,
      isExpertise,
    );

    if (!statEntry) {
      this.warn('skillCheck:unmapped-stat', { checkType, mapKey, ability: abilityKey });
    }

    if (!this._playerStateService.isCharacterSheetAuthored) {
      this.warn('skillCheck:neutral-sheet-fallback');
    }

    return {
      ability: abilityKey,
      abilityLabel: ABILITY_LABELS[abilityKey],
      abilityModifier,
      isProficient,
      isExpertise,
      proficiencyBonus: isProficient ? proficiencyBonus : 0,
      totalModifier,
    };
  }

  /** Resolves bounded success/failure stakes for a check type (C-487). */
  protected _resolveStakes(checkType: string): SkillCheckStakes {
    const mapKey = normalizeCheckType(checkType);
    return SKILL_CHECK_STAKES[mapKey] ?? DEFAULT_SKILL_CHECK_STAKES;
  }

  /** Builds the real player context for the dialogue service (C-487 AC-3). */
  private _buildPlayerContext(): {
    characterSheetSummary: string;
    level: number;
    classId: string;
  } {
    const sheet = this._playerStateService.characterSheet;
    return {
      characterSheetSummary: serializeForAi(sheet),
      level: sheet.level,
      classId: sheet.classId ?? 'fighter',
    };
  }

  // ── C-401 Streaming helpers ───────────────────────────────────────────

  /**
   * Appends a token chunk to the frame-batched stream buffer. The buffer is
   * flushed to `streamingText` at most once per animation frame — never one
   * rune write per token (limitations.md §Svelte update threshold).
   * Protected so dev-sandbox overrides can stream mock narratives.
   */
  protected _handleStreamChunk(text: string): void {
    this._streamBuffer += text;
    if (!this._streamFrameScheduled) {
      this._streamFrameScheduled = true;
      const epoch = this._streamEpoch;
      const raf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (callback: FrameRequestCallback) =>
              setTimeout(() => callback(0), 16) as unknown as typeof requestAnimationFrame; // guard-ignore lint/type-safety/casting: rAF polyfill or dev VM internals access
      raf(() => {
        this._streamFrameScheduled = false;
        if (epoch !== this._streamEpoch) {
          return; // stale stream — a new turn started
        }
        this._flushStreamBuffer();
      });
    }
  }

  /** Flushes buffered chunks into streamingText (single $state write). */
  protected _flushStreamBuffer(): void {
    if (this._streamBuffer.length > 0) {
      this.streamingText += this._streamBuffer;
      this._streamBuffer = '';
    }
  }

  /** Synchronously flushes any pending buffer (call before finalizing a turn). */
  protected _flushStreamNow(): void {
    this._streamFrameScheduled = false;
    this._flushStreamBuffer();
  }

  /** Resets the stream for a new turn (invalidates any scheduled flush). */
  protected _resetStreaming(): void {
    this._streamEpoch++;
    this._streamBuffer = '';
    this._streamFrameScheduled = false;
    this.streamingText = '';
  }

  /** Whether the error message represents cancellation (AC-3). */
  private _isAbortError(message: string): boolean {
    return /abort/i.test(message);
  }

  /**
   * Formats the AC-4 actionable error, naming the provider when the gateway
   * routing diagnostic is available.
   */
  private _formatTimeoutError(): string {
    const routing = (globalThis as Record<string, unknown>).__text_service_resolved_routing as
      | { provider?: string }
      | undefined;
    const provider = routing?.provider;
    return provider
      ? `The ${provider} provider did not respond in time. Showing the NPC's pre-written reply instead.`
      : "The text provider did not respond in time. Showing the NPC's pre-written reply instead.";
  }

  /**
   * Handles a failed generation call:
   * - Abort (AC-3): removes the placeholder — no partial turn persists, no error.
   * - Timeout (AC-4): surfaces an actionable error naming the provider.
   * - Other: surfaces the raw error message.
   */
  private _handleTurnFailure(options: { npcMessageId: string; error: unknown }): void {
    const { npcMessageId, error } = options;
    const message = error instanceof Error ? error.message : String(error);

    if (this._isAbortError(message)) {
      // AC-3: remove the placeholder — no partial turn written, no error toast.
      // The player's message stays in history; inputText stays cleared so a
      // retry cannot submit the same text twice (finding: abort restore dup).
      this.messages = this.messages.filter((m) => m.id !== npcMessageId);
      return;
    }

    const turnState = this._npcDialogueService.turnState as
      | { kind: 'failed'; reason: string }
      | undefined;
    const timedOut = turnState?.kind === 'failed' && turnState.reason === 'timeout';
    this.streamError = timedOut ? this._formatTimeoutError() : message;
    this.messages = this.messages.filter((m) => m.id !== npcMessageId);
  }

  /**
   * Fills a placeholder NPC message with the final text (enriched through
   * messageBranchStore for alternatives/swiping).
   */
  protected _setMessageContent(npcMessageId: string, text: string): void {
    this.messages = this.messages.map((m) => {
      if (m.id !== npcMessageId) {
        return m;
      }
      const enriched = messageBranchStore.enrichMessage({
        id: m.id,
        text,
        sender: 'ai',
        timestamp: new Date(),
      });
      return {
        ...m,
        content: text,
        alternativeCount: enriched.alternativeCount,
        alternativeLabel: enriched.alternativeLabel,
        canSwipeLeft: enriched.canSwipeLeft,
        canSwipeRight: enriched.canSwipeRight,
      };
    });

    // Auto-speak the completed NPC message when streaming TTS is enabled.
    // Feed through the chunker (and close) so sentences are dispatched to
    // ttsService.speak() in order, beginning as soon as the first boundary
    // lands rather than waiting for the whole message (low TTFA). speak()
    // no-ops when TTS is not yet ready, so a message that completes mid-warmup
    // is simply skipped rather than failing.
    if (this.streamingTtsEnabled) {
      this._chunker.feed(text);
      this._chunker.close();
    }
  }

  /** @inheritdoc */
  get pendingMessages(): readonly string[] {
    return [...this._pendingQueue];
  }

  /** @inheritdoc */
  retryPending(): void {
    this.debug('retryPending', { count: this._pendingQueue.length });
    this._drainEnabled = true;
    this._maybeDrainQueue();
  }

  /**
   * Called when a streaming turn finishes. On success, drains the pending queue
   * (FIFO, one turn at a time) if auto-drain is enabled. On failure or
   * cancellation, disables auto-drain so queued messages are retained as
   * visible pending items until an explicit retry.
   */
  private _onTurnCompleted(succeeded: boolean): void {
    if (!succeeded) {
      this._drainEnabled = false;
      this._isDraining = false;
      this.debug('turnCompleted:failed-drain-disabled', { queued: this._pendingQueue.length });
      return;
    }
    this._maybeDrainQueue();
  }

  /** Delivers the next queued message if auto-drain is enabled and no turn is active. */
  private _maybeDrainQueue(): void {
    if (!this._drainEnabled || this._isDraining) {
      return;
    }
    if (this.isStreaming || this.isResolvingSkillCheck) {
      return;
    }
    if (this.skillCheckState !== null || this.dialoguePhase !== 'FREE_TEXT') {
      return;
    }
    const next = this._pendingQueue.shift();
    if (!next) {
      return;
    }
    this._isDraining = true;
    this.debug('drainQueue:delivering', { text: next, remaining: this._pendingQueue.length });
    void this._deliverQueued(next).finally(() => {
      this._isDraining = false;
      this._maybeDrainQueue();
    });
  }

  /**
   * Delivers queued input once no turn is active. Slash commands return to
   * their command subsystem; ordinary text is appended and sent to the active
   * NPC/GM pipeline.
   */
  private async _deliverQueued(text: string): Promise<void> {
    const slash = parseSlashCommand(text);
    if (slash.kind !== 'none') {
      this.debug('slash-command:parse', { kind: slash.kind });
      await this._dispatchSlashCommand(slash);
      return;
    }

    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content: text,
        role: 'player' as const,
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
    if (this.addressMode === 'gm') {
      await this._sendToGameMaster(text);
    } else if (this._npcDialogueService.useFreeTextFirst) {
      await this._sendWithIntentAnalysis(text);
    } else {
      await this._delegateGenerateResponse();
    }
  }

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
    this._onStartCombat = options.onStartCombat;
    this._npcDialogueService = options.npcDialogueService;
    this._playerStateService = options.playerStateService ?? playerStateService;
    this._imageProviderAvailable = options.imageProviderAvailable ?? true;
    this.isCampaignPlay = options.isCampaignPlay ?? true;

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
        this._playerStateService.classId,
      );
      if (this.suggestedChips.length > 0) {
        this.debug('initialSuggestions', {
          npcId: this._npcData.npcId,
          chipCount: this.suggestedChips.length,
          classId: this._playerStateService.classId,
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
    return resolvePlayerAvatarUrl({ classId: this._playerStateService.classId });
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

      // Auto-scroll to bottom is owned by RichMessageList (C-424).

      // Auto-save input draft (bind:value bypasses setInput)
      $effect(() => {
        const text = this.inputText;
        if (text.length > 0) {
          void draftStore.saveDraft({ chatId: this._npcData.npcId, text });
        }
      });
    });

    // Initialize native Kokoro TTS eagerly when the overlay opens so the first
    // NPC reply is not delayed by a cold worker/model load (~10s first-speak
    // latency). Fire-and-forget — speech works once the worker reports 'ready'.
    if (!this._ttsInitialized) {
      this._ttsInitialized = true;

      // Auto-speak each NPC message as it completes: completed messages are fed
      // through the chunker in _setMessageContent, which emits sentences here.
      this._chunker.onSentence(({ sentence }) => {
        if (this.streamingTtsEnabled) {
          // speak() supersedes any prior request (silently, per C-476 fix) so
          // rapid successive sentences never surface a 'stop()' error.
          void ttsService.speak({ text: sentence }).catch(() => {});
        }
      });

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

    // Use a default skill check — persuasion vs DC 12, sourced from the real sheet (C-487).
    const difficultyClass = 12;
    const breakdown = this._computeSkillCheckBreakdown('Persuasion');
    const stakes = this._resolveStakes('Persuasion');
    const targetNumber = Math.max(1, difficultyClass - breakdown.totalModifier);

    // Show the declared DC before rolling
    this.skillCheckState = {
      checkType: 'Persuasion',
      difficultyClass,
      breakdown,
      stakes,
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
    const { natural: rollValue, total } = diceService.rollD20(breakdown.totalModifier);
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

    // Roll the d20 with the player's computed total modifier (C-487)
    const { natural: rollValue, total } = diceService.rollD20(state.breakdown.totalModifier);
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
   * C-401: the resolution narrative streams into a placeholder; the call is
   * linked to `_activeAbortController` so End Chat aborts call 2 (AC-3).
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
    this._resetStreaming();

    // Placeholder NPC message — the streamed resolution narrative lands here
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

    // AC-3: link to the active abort controller so End Chat cancels call 2.
    const controller = new AbortController();
    this._activeAbortController = controller;

    try {
      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages
        .filter((m) => m.id !== npcMessageId)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const lastPlayerMsg = [...this.messages].reverse().find((m) => m.role === 'player');
      const playerInput = lastPlayerMsg?.content ?? '';

      const resolution = await this._npcDialogueService.resolveRoll({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        checkType,
        difficultyClass,
        rollTotal: total,
        outcome: isSuccess ? 'pass' : 'fail',
        playerInput,
        onChunk: (text) => this._handleStreamChunk(text),
      });

      this._flushStreamNow();
      const narrative = this.streamingText || resolution.narrativeResult;
      this._setMessageContent(npcMessageId, narrative);
      this._resetStreaming();
      this.suggestedChips = resolution.suggestedChips;

      // AC-4: a stalled provider surfaces an actionable error while the
      // derived fallback narrative is still shown.
      const turnState = this._npcDialogueService.turnState as
        | { kind: 'failed'; reason: string }
        | undefined;
      if (turnState?.kind === 'failed' && turnState.reason === 'timeout') {
        this.streamError = this._formatTimeoutError();
      }
    } catch (error) {
      this._flushStreamNow();
      this._handleTurnFailure({ npcMessageId, error });
    } finally {
      this.isResolvingSkillCheck = false;
      this._resetStreaming();
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /** @inheritdoc */
  async sendMessage(text?: string): Promise<void> {
    const content = (text ?? this.inputText).trim();
    if (!content || this.isResolvingSkillCheck) {
      return;
    }

    // Clear input immediately so the player sees feedback
    this.inputText = '';
    this.streamError = null;
    this.suggestedChips = [];

    // Clear the per-chat draft since a message is being sent
    void draftStore.clearDraft({ chatId: this._npcData.npcId });

    // ── C-501: Slash command intercept ──────────────────────────────
    // Parse before any call into the NPC dialogue pipeline so leading `/`
    // text routes to image/tree/GM/help instead of the NPC.
    // If the NPC is currently streaming, queue the message instead of sending
    // it now. It is surfaced as a visible pending item and is delivered in FIFO
    // order only after the current turn completes successfully (and only while
    // auto-drain is enabled — never after a failed/cancelled stream unless the
    // player explicitly retries).
    if (this.isStreaming) {
      this._pendingQueue.push(content);
      this.debug('sendMessage:queued', { content, queued: this._pendingQueue.length });
      return;
    }

    const slash = parseSlashCommand(content);
    if (slash.kind !== 'none') {
      this.debug('slash-command:parse', { kind: slash.kind });
      await this._dispatchSlashCommand(slash);
      return;
    }

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

  // ── C-501: Slash command dispatch ───────────────────────────────────

  /**
   * Routes a parsed slash command to its target subsystem. Called from
   * `sendMessage` after a non-`none` parse, before any NPC pipeline call.
   */
  private async _dispatchSlashCommand(result: SlashCommandResult): Promise<void> {
    this.debug('slash-command:dispatch', { kind: result.kind });

    switch (result.kind) {
      case 'generate':
        await this._handleGenerateCommand(result.prompt);
        return;
      case 'tree':
        this._handleTreeCommand();
        return;
      case 'gm':
        await this._handleGmCommand(result);
        return;
      case 'help':
        this._handleHelpCommand();
        return;
      case 'none':
        return;
    }
  }

  /**
   * AC-1/AC-2: `/generate <prompt>` produces an inline image via the existing
   * `generatedImages` flow. The NPC never receives the text as dialogue.
   *
   * - Provider available: a `generating` record is pushed immediately, then
   *   flipped to `done` with the produced URL (the player's prompt verbatim).
   * - Provider unavailable: an inline `error` record is shown — no crash, no
   *   stuck `generating` state.
   * - Abortable via the existing AbortController path; an aborted request is
   *   removed cleanly.
   */
  private async _handleGenerateCommand(prompt: string): Promise<void> {
    const afterMessageId = this.messages.at(-1)?.id ?? null;
    const imageId = crypto.randomUUID();

    if (!this._imageProviderAvailable) {
      // AC-2: degrade to an inline error block with no crash.
      this.generatedImages = [
        ...this.generatedImages,
        { id: imageId, url: null, status: 'error', afterMessageId },
      ];
      return;
    }

    this.generatedImages = [
      ...this.generatedImages,
      { id: imageId, url: null, status: 'generating', afterMessageId },
    ];

    const controller = new AbortController();
    this._activeAbortController = controller;
    try {
      const result = await imageGenerationService.generateImage({
        prompt,
        signal: controller.signal,
      });
      this.generatedImages = this.generatedImages.map((img) =>
        img.id === imageId ? { ...img, url: result.url, status: 'done' as const } : img,
      );
    } catch (error) {
      const aborted = error instanceof Error && /abort/i.test(error.message);
      if (aborted) {
        // Cancellation — remove the placeholder entirely.
        this.generatedImages = this.generatedImages.filter((img) => img.id !== imageId);
        return;
      }
      this.generatedImages = this.generatedImages.map((img) =>
        img.id === imageId ? { ...img, status: 'error' as const } : img,
      );
    } finally {
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /**
   * AC-3: `/tree` re-presents the previous turn's choice set. Selecting a
   * re-presented choice routes through the existing choice execution path;
   * command re-execution is guarded because each new turn gets its own
   * message ID (markCommandExecuted / wasCommandExecuted key by message).
   * With no prior choices, inline help is shown.
   */
  private _handleTreeCommand(): void {
    if (this._previousChoices.length > 0) {
      this._activeChoices = this._previousChoices;
      this._appendSystemMessage('Previous choices restored — select one to continue.');
      return;
    }
    this._handleHelpCommand();
  }

  /**
   * AC-4: `/action` / `/look` route the instruction to the Game Master.
   * The instruction is appended as a player turn (attributed to the player,
   * never the NPC) and routed through the existing GM address-mode path.
   */
  private async _handleGmCommand(result: {
    command: 'action' | 'look';
    text: string;
  }): Promise<void> {
    const instruction = result.text.trim();
    if (result.command === 'action' && instruction.length === 0) {
      this._handleHelpCommand();
      return;
    }

    const resolvedInstruction =
      instruction.length > 0 ? instruction : 'Look around and describe what I see.';
    const label = `/${result.command} ${resolvedInstruction}`;
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content: label,
        role: 'player' as const,
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
    await this._sendToGameMaster(label);
  }

  /**
   * AC-5: inline help for unknown/empty commands and bare `/`.
   */
  private _handleHelpCommand(): void {
    this._appendSystemMessage(SLASH_COMMAND_HELP);
  }

  /** Appends a UI-only system message that prompt-context mappers omit. */
  private _appendSystemMessage(content: string): void {
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content,
        role: 'npc' as const,
        senderName: 'System',
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];
  }

  /**
   * GM Mode: sends the player's message directly to the Game Master.
   * The GM responds as the dungeon master, not as an NPC.
   * Streams the response into a placeholder (C-401).
   */
  private async _sendToGameMaster(content: string): Promise<void> {
    this.isStreaming = true;
    this.highlightSpeaker = 'npc';
    this.streamError = null;
    this._resetStreaming();

    const controller = new AbortController();
    this._activeAbortController = controller;
    const latestPlayerMessageId = this.messages.findLast(
      (message) => message.role === 'player',
    )?.id;

    // Placeholder NPC message — the streamed GM response lands here
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

    let succeeded = false;
    try {
      const gmResponse = await this._npcDialogueService.analyzeIntent({
        npcId: this._npcData.npcId,
        npcName: 'Game Master',
        messages: this.messages
          .filter((message) => message.id !== npcMessageId && message.senderName !== 'System')
          .map((m) => ({
            role: m.role === 'player' ? 'player' : ('npc' as const),
            content: m.id === latestPlayerMessageId ? content : m.content,
          })),
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        playerContext: this._buildPlayerContext(),
        onChunk: (text) => this._handleStreamChunk(text),
      });

      this._flushStreamNow();
      const narrative = this.streamingText || gmResponse.npcResponse;
      this._setMessageContent(npcMessageId, `🎭 *Game Master*\n${narrative}`);
      this._resetStreaming();
      this.suggestedChips = gmResponse.suggestedChips;
      succeeded = true;
    } catch (error) {
      this._flushStreamNow();
      this._handleTurnFailure({ npcMessageId, error });
    } finally {
      this.isStreaming = false;
      this.highlightSpeaker = null;
      this._resetStreaming();
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
      this._onTurnCompleted(succeeded);
    }
  }

  /**
   * C-371: Sends a player message through the two-call intent analysis pipeline.
   * Call #1 (analyzeIntent) → if roll needed: DECLARED_DC → dice → rollDice → call #2.
   * If no roll needed: display narrative + chips directly.
   *
   * C-401: the pre-roll narrative streams into a placeholder before the dice
   * prompt appears (AC-2); abort removes the placeholder (AC-3).
   */
  private async _sendWithIntentAnalysis(
    _content: string,
    npcMessageId?: string,
    options?: { applyState?: boolean },
  ): Promise<void> {
    const applyState = options?.applyState ?? true;
    this.isStreaming = true;
    this.highlightSpeaker = 'npc';
    this.streamError = null;
    this._resetStreaming();

    const controller = new AbortController();
    this._activeAbortController = controller;

    // Placeholder NPC message — the streamed pre-roll narrative lands here
    const id = npcMessageId ?? crypto.randomUUID();
    this.messages = [
      ...this.messages,
      {
        id,
        content: '',
        role: 'npc' as const,
        alternativeCount: 0,
        alternativeLabel: '',
        canSwipeLeft: false,
        canSwipeRight: false,
      },
    ];

    let succeeded = false;
    try {
      const messages: Array<{ role: 'player' | 'npc'; content: string }> = this.messages
        .filter((message) => message.id !== id && message.senderName !== 'System')
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const analysis = await this._npcDialogueService.analyzeIntent({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        playerContext: this._buildPlayerContext(),
        onChunk: (text) => this._handleStreamChunk(text),
      });

      this._flushStreamNow();
      const narrative = this.streamingText || analysis.npcResponse;
      this._setMessageContent(id, narrative);
      this._resetStreaming();

      // Run expression detection on the NPC response
      void this._detectExpression(narrative);

      // Execute the GM's quest-activation tool call (accept/decline), if any.
      // C-490: the rephrase path (applyState=false) skips quest/state mutation.
      if (applyState) {
        this._applyQuestActivation(analysis.questActivation);
      }

      // Show suggestion chips
      this.suggestedChips = analysis.suggestedChips;

      // AC-4: a stalled provider surfaces an actionable error while the
      // derived fallback narrative is still shown.
      const turnState = this._npcDialogueService.turnState as
        | { kind: 'failed'; reason: string }
        | undefined;
      if (turnState?.kind === 'failed' && turnState.reason === 'timeout') {
        this.streamError = this._formatTimeoutError();
      }

      if (analysis.requiresRoll && analysis.checkType && analysis.difficultyClass) {
        // ── Roll needed: enter DECLARED_DC → DICE flow ──────────────
        // C-487: the modifier is computed from the real character sheet, not
        // the model's `modifierSource` (a label hint only). The breakdown and
        // stakes are assembled before phase leaves 'declared'.
        const breakdown = this._computeSkillCheckBreakdown(analysis.checkType);
        const stakes = this._resolveStakes(analysis.checkType);
        const targetNumber = Math.max(1, analysis.difficultyClass - breakdown.totalModifier);

        this.skillCheckState = {
          checkType: analysis.checkType,
          difficultyClass: analysis.difficultyClass,
          breakdown,
          stakes,
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
      succeeded = true;
    } catch (error) {
      this._flushStreamNow();
      this._handleTurnFailure({ npcMessageId: id, error });
    } finally {
      this.isStreaming = false;
      this.highlightSpeaker = null;
      this._resetStreaming();
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
      this._onTurnCompleted(succeeded);
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
    // Cancel and clear the pending queue before closing the overlay so no
    // queued text can leak into a later dialogue session.
    this._pendingQueue = [];
    this._drainEnabled = true;
    this._isDraining = false;
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

  // ── C-343: Rich Chat UX Promotion ────────────────────────────────────

  /** @inheritdoc */
  cancelStreaming(): void {
    this.debug('cancelStreaming');
    // Stop auto-drain so queued messages are retained as visible pending items
    // until an explicit Retry/Send. The abort also propagates to the turn's
    // failure handler, which disables draining too; setting it here keeps it
    // held even if the underlying request ignores the abort signal.
    this._drainEnabled = false;
    this._isDraining = false;
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
    void ttsService.speak({ text }).catch(() => {});
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
  rephraseResponse(messageId: string): void {
    this.debug('rephraseResponse', { messageId });

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
    this.messages = this.messages.slice(0, messageIndex);

    // Store the current text as an alternative under the replacement ID
    messageBranchStore.addAlternative({
      messageId: replacementMessageId,
      currentText,
      newText: '',
    });

    // C-490: rephrase is presentation-only — never re-apply NpcStateDelta,
    // quest activation, or dialogue commands (the world is not rewound).
    if (this._npcDialogueService.useFreeTextFirst && lastPlayerMsg) {
      void this._sendWithIntentAnalysis(lastPlayerMsg.content, replacementMessageId, {
        applyState: false,
      });
    } else {
      void this._delegateGenerateResponse({
        npcMessageId: replacementMessageId,
        applyState: false,
      });
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
        this._playerStateService.classId,
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
   *
   * C-401: the placeholder accumulates streamed tokens; abort removes the
   * placeholder entirely (no partial turn persists, AC-3); a timeout
   * surfaces an actionable error while the authored fallback is offered (AC-4).
   */
  private async _delegateGenerateResponse(options?: {
    npcMessageId?: string;
    /** C-490: when false (rephrase), skip dialogue-command state mutations. */
    applyState?: boolean;
  }): Promise<void> {
    const applyState = options?.applyState ?? true;
    this.isStreaming = true;
    this.streamError = null;
    this._resetStreaming();

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

    let succeeded = false;
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
        onChunk: (text) => this._handleStreamChunk(text),
      });

      // Flush any buffered tokens so the final text is complete
      this._flushStreamNow();
      const finalText = this.streamingText || turn.narrative;
      this._setMessageContent(npcMessageId, finalText);
      this._resetStreaming();

      // Append the follow-up choices as actionable buttons
      if (turn.choices.length > 0) {
        // Store choices on the NPC message for the View to render
        this._setMessageChoices(npcMessageId, turn);
      }

      // AC-4: a stalled provider surfaces an actionable error while the
      // authored fallback turn is offered as the recovery.
      const turnState = this._npcDialogueService.turnState as
        | { kind: 'failed'; reason: string }
        | undefined;
      if (turnState?.kind === 'failed' && turnState.reason === 'timeout') {
        this.streamError = this._formatTimeoutError();
      }

      // Execute any command from the turn, guarding against re-execution.
      // C-490: the rephrase path (applyState=false) never re-runs a dialogue
      // command / NpcStateDelta — presentation only.
      if (
        applyState &&
        turn.command &&
        !this._npcDialogueService.wasCommandExecuted(npcMessageId)
      ) {
        // C-340: Show recruit button instead of auto-executing
        if (turn.command.kind === 'recruit') {
          this.recruitAvailable = true;
        } else {
          this._npcDialogueService.markCommandExecuted(npcMessageId, turn.command.kind);
          await this._dispatchCommand({ command: turn.command, npcMessageId });
        }
      }
      succeeded = true;
    } catch (err) {
      this._flushStreamNow();
      this._handleTurnFailure({ npcMessageId, error: err });
    } finally {
      this.isStreaming = false;
      this._resetStreaming();
      this._onTurnCompleted(succeeded);
    }
  }

  /** Stores turn choices as message-level state for the View to render. */
  private _setMessageChoices(_npcMessageId: string, _turn: unknown): void {
    // Implementation note: choices are threaded through the turn object.
    // For now, the View can access the most recent NPC turn's choices
    // through a dedicated $state field.
    const turn = _turn as { choices: Array<{ id: string; label: string }> };
    // Snapshot the current active set before it is replaced so `/tree` can
    // re-present the previous turn's choices (C-501 AC-3).
    if (this._activeChoices.length > 0) {
      this._previousChoices = this._activeChoices;
    }
    this._activeChoices = turn.choices;
  }

  /** Active choices from the most recent NPC turn (rendered as buttons). */
  private _activeChoices = $state<Array<{ id: string; label: string }>>([]);

  /**
   * Snapshot of the previous turn's choice set, captured when a new choice
   * set replaces the active one (C-501 `/tree`). Empty when there is no
   * prior choice set to revisit.
   */
  private _previousChoices = $state<Array<{ id: string; label: string }>>([]);

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
          // guard-ignore lint/type-safety/casting: rAF polyfill or dev VM internals access
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
          // guard-ignore lint/type-safety/casting: rAF polyfill or dev VM internals access
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
    this._resetStreaming();

    // AC-3: link to the active abort controller so End Chat cancels.
    const controller = new AbortController();
    const npcMessageId = crypto.randomUUID();

    try {
      // Delegate to the NPC dialogue orchestrator with the dice result
      // as part of the conversation so the model can respond contextually.
      const diceOutcome = `[Dice result: Skill=${skill}, DC=${difficultyClass}, Roll=${rollValue}, ${isSuccess ? 'SUCCESS' : 'FAILURE'}]`;
      const playerMessage = `${this._npcData.npcName}, I attempt a ${skill} check. ${diceOutcome}`;

      this._activeAbortController = controller;
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

      const turn = await this._npcDialogueService.generateTurn({
        npcId: this._npcData.npcId,
        npcName: this._npcData.npcName,
        messages,
        signal: controller.signal,
        gameStateFacts: buildGameStateFacts({ npcId: this._npcData.npcId }),
        onChunk: (text) => this._handleStreamChunk(text),
      });

      this._flushStreamNow();
      const narrative = this.streamingText || turn.narrative;
      this._setMessageContent(npcMessageId, narrative);
      this._resetStreaming();

      // Execute any command
      if (turn.command && !this._npcDialogueService.wasCommandExecuted(npcMessageId)) {
        this._npcDialogueService.markCommandExecuted(npcMessageId, turn.command.kind);
        await this._dispatchCommand({ command: turn.command, npcMessageId });
      }
    } catch (error) {
      this._flushStreamNow();
      this.warn('_executeSkillCheckAction:failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
      this._handleTurnFailure({ npcMessageId, error });
    } finally {
      this.isResolvingSkillCheck = false;
      this._resetStreaming();
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
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
