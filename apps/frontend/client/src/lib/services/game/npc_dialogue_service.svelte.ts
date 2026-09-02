// apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts
// biome-ignore-all lint/style/noNonNullAssertion: _assertConfigured() guarantees non-null after configure()
//
// NPC dialogue orchestrator — single owner of the NPC conversation loop.
// Context projection (persona + memory + game-state facts), AI provider
// routing via aiGatewayService, authored-branch resolution via the content
// pack loader, command validation + precondition checks, command dispatch
// to existing executor services, cancellation (AbortController), and
// choice derivation (2–4 options from NPC capabilities + authored branches).
//
// Model output is untrusted input: validated with TypeBox Value.Check,
// unknown/extra fields rejected, commands checked against the
// precondition-derived whitelist before dispatch.
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks
// Contract: C-371 Free-Text-First NPC Interaction — two-call pipeline

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import {
  NpcDialogueAiEnvelopeSchema,
  NpcDialogueTurnSchema,
  NpcIntentAnalysisOutputSchema,
  NpcQuestActivationSchema,
  NpcRollResolutionOutputSchema,
  NpcSuggestionChipSchema,
} from '@aikami/schemas';
import type {
  ContentPackItemEntry,
  NpcDialogueChoice,
  NpcDialogueCommand,
  NpcDialogueCommandKind,
  NpcDialogueTurn,
  NpcIntentAnalysisInput,
  NpcIntentAnalysisOutput,
  NpcQuestActivation,
  NpcRollResolutionOutput,
  NpcStateDelta,
  NpcSuggestionChip,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { FALLBACK_PERSONA_ID, PERSONA_PROMPTS } from '$lib/data/dialogue_personas';
import { inventoryService, questStateService } from '$services';

export type NpcDialogueServiceOptions = BaseFrontendClassOptions;
// ---------------------------------------------------------------------------
// Injected interfaces — all external dependencies passed through configure()
// ---------------------------------------------------------------------------

/** Content-pack data the orchestrator reads from (NPC entries, dialogues). */
type NpcDialogueContentProvider = {
  /** Returns the NPC entry for a given NPC ID, or undefined. */
  getNpc(npcId: string):
    | {
        name: string;
        defaultDialogueKey?: string;
        isVendor?: boolean;
        vendorInventory?: string;
        combatStats?: Record<string, unknown>;
        /** Pre-authored suggestion chips for the initial greeting. */
        initialSuggestions?: NpcSuggestionChip[];
      }
    | undefined;
  /** Returns a piece of authored dialogue by key, or undefined. */
  getDialogue(dialogueKey: string): string | undefined;
  /** Returns a quest entry by ID, or undefined. */
  getQuest(
    questId: string,
  ): { id: string; name: string; offerDialogueKey: string; offeredByNpcId?: string } | undefined;
  /** Returns quest entries keyed by ID. */
  getAllQuests(): Array<{
    id: string;
    name: string;
    offerDialogueKey: string;
    offeredByNpcId?: string;
  }>;
  /** Returns encounter entries keyed by ID. */
  getAllEncounters(): Array<{ id: string; dialogueKey?: string; encounterNpcIds?: string[] }>;
  /** Returns an encounter entry by ID, or undefined. */
  getEncounter(
    encounterId: string,
  ): { id: string; dialogueKey?: string; encounterNpcIds?: string[] } | undefined;
  /** Returns an item entry by ID, or undefined (C-331). */
  getItem?(itemId: string): ContentPackItemEntry | undefined;
  /** Returns all item entries keyed by item ID (C-331). */
  getAllItems?(): Record<string, ContentPackItemEntry>;
};

/**
 * Text generation callback — wraps aiGatewayService.generateText for the
 * orchestrator. Includes the raw resolution detail for observability.
 *
 * C-401: `onChunk` is called with each narrative token as it arrives from a
 * streaming provider. It is absent for non-streaming callers (authored
 * fallback, test doubles) and optional so those call paths need not supply it.
 */
type NpcDialogueTextGenerator = (options: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema?: Record<string, unknown>;
  schemaName?: string;
  signal?: AbortSignal;
  /** Called with each narrative token as it arrives. */
  onChunk?: (text: string) => void;
}) => Promise<{ text: string; structured?: unknown }>;

/**
 * UI-visible state of a dialogue turn. Drives the generating indicator,
 * the streamed text, and the error affordance.
 *
 * C-401: the machine enters `streaming` only when the first token actually
 * arrives via `onChunk` — a non-streaming provider never enters `streaming`.
 */
type DialogueTurnState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'streaming'; readonly text: string }
  | { readonly kind: 'awaiting_envelope'; readonly text: string }
  | { readonly kind: 'complete'; readonly text: string }
  | {
      readonly kind: 'failed';
      readonly reason: 'timeout' | 'aborted' | 'provider_error' | 'malformed';
      readonly fallbackOffered: boolean;
    };

/**
 * Thrown when a generation call exceeds the configured timeout.
 * Distinguished from other failures so callers can surface an actionable
 * error naming the provider (AC-4).
 */
export class DialogueTimeoutError extends Error {
  constructor(timeoutMs: number, label: string) {
    super(`Dialogue generation timed out after ${timeoutMs}ms (${label})`);
    this.name = 'DialogueTimeoutError';
  }
}

/**
 * Command executor callbacks — one per command kind.
 * Each is called after validation + precondition checks pass.
 * Implementations dispatch to existing executor services and return
 * true if the command was executed, false if denied at runtime.
 */
type NpcDialogueExecutors = {
  trade(options: { npcId: string; vendorName?: string; vendorInventory?: string }): boolean;
  offerQuest(options: { npcId: string; questId: string }): boolean;
  skillCheck(options: { skill: string; difficultyClass: number }): boolean;
  giveItem(options: { itemId: string; quantity: number }): boolean;
  startCombat(options: { npcId: string; npcName: string; encounterId?: string }): boolean;
  recruit(options: { npcId: string; npcName: string }): boolean;
};

/** Context facts projected into the AI system prompt. */
type DialogueContextProjection = {
  persona: string;
  npcName: string;
  memory: string[];
  gameStateFacts: string[];
  relationshipFacts: string[];
  allowedCommands: NpcDialogueCommandKind[];
};

// ---------------------------------------------------------------------------
// Turn-level context (immutable per turn — read during generation)
// ---------------------------------------------------------------------------

type TurnContext = {
  npcId: string;
  npcName: string;
  npcEntry: ReturnType<NpcDialogueContentProvider['getNpc']>;
  /** Allowed command kinds derived from the NPC's content-pack capabilities. */
  allowedCommands: NpcDialogueCommandKind[];
  /** Active quest/encounter dialogue key override, if any. */
  contextualDialogueKey?: string;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type NpcDialogueServiceInterface = BaseFrontendClassInterface & {
  /** The currently active NPC being conversed with, if any. */
  readonly activeNpc:
    | {
        npcId: string;
        npcName: string;
        dialog?: string;
        personaId?: string;
        /** Pre-authored suggestion chips for the initial greeting. */
        initialSuggestions?: NpcSuggestionChip[];
      }
    | undefined;

  /**
   * Configures the orchestrator with its required dependencies.
   * Must be called once before {@link generateTurn}.
   *
   * @param options.useFreeTextFirst — When true (default), the two-call
   *   pipeline (analyzeIntent → resolveRoll) is used. When false, the
   *   single-call generateTurn path is used.
   */
  configure(options: {
    contentProvider: NpcDialogueContentProvider;
    textGenerator: NpcDialogueTextGenerator;
    executors: NpcDialogueExecutors;
    useFreeTextFirst?: boolean;
    /**
     * Per-generation-call timeout in milliseconds. A provider that stalls
     * past this surfaces a `failed` turn state with `reason: 'timeout'` and
     * the call rejects (the error is surfaced, never faked). Default:
     * {@link DEFAULT_DIALOGUE_TIMEOUT_MS}.
     */
    timeoutMs?: number;
  }): void;

  /**
   * UI-visible state of the current dialogue turn.
   * Owned by the orchestrator; the dialogue ViewModel renders it reactively.
   */
  readonly turnState: DialogueTurnState;

  /**
   * Starts a dialogue session with the given NPC.
   * Called by the bridge listener on NPC_INTERACTED.
   *
   * When the content provider is configured, `dialog` is resolved through
   * `getDialogue` (the engine emits the dialogue KEY, not the text) and the
   * NPC's authored `initialSuggestions` are attached to the session.
   */
  startDialogue(options: {
    npcData: {
      npcId: string;
      npcName: string;
      dialog?: string;
      personaId?: string;
      initialSuggestions?: NpcSuggestionChip[];
    };
    setOverlay: (type: string) => void;
    pauseEngine: () => void;
  }): void;

  /**
   * Ends the current dialogue session.
   * Called by the bridge listener on NPC_DIALOG_END.
   */
  endDialogue(options: { clearOverlay: () => void; resumeEngine: () => void }): void;

  /**
   * Generates one NPC turn: AI or authored fallback.
   *
   * @param options.npcId — the content-pack NPC ID
   * @param options.npcName — display name from the bridge event
   * @param options.messages — recent conversation messages (newest last)
   * @param options.signal — AbortSignal to cancel in-flight AI generation
   * @param options.gameStateFacts — read-only world facts (active quests, flags, etc.)
   *
   * @returns A {@link NpcDialogueTurn} validated turn (always has narrative + choices).
   *   Rejects when the text provider fails — the error is surfaced, never
   *   faked with authored dialogue.
   */
  generateTurn(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    /** Active encounter ID — restricts contextual dialogue resolution to this encounter only. */
    activeEncounterId?: string;
    /** Called with each narrative token as the turn streams (C-401). */
    onChunk?: (text: string) => void;
  }): Promise<NpcDialogueTurn>;

  /**
   * Derives the precondition whitelist for a given NPC.
   * Public for convenience in sandbox toggles.
   */
  deriveAllowedCommands(npcId: string): NpcDialogueCommandKind[];

  /**
   * Builds the context projection (persona + memory + game-state facts)
   * for a dialogue turn. Public for sandbox inspection.
   */
  buildContext(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    gameStateFacts?: string[];
  }): DialogueContextProjection;

  /**
   * Marks a command as executed for a given turn, preventing re-execution on regenerate.
   */
  markCommandExecuted(turnId: string, kind: NpcDialogueCommandKind): void;

  /**
   * Checks whether a command was already executed for a given turn.
   */
  wasCommandExecuted(turnId: string): boolean;

  /**
   * Executes a validated dialogue command through the orchestrator-owned
   * executor boundary. Returns true if executed, false if denied at runtime.
   */
  executeCommand(options: {
    kind: string;
    npcId: string;
    npcName: string;
    npcEntry?: ReturnType<NpcDialogueContentProvider['getNpc']>;
    command: NpcDialogueCommand;
  }): boolean;

  /**
   * Call #1 of the two-call pipeline: intent analysis.
   *
   * Projects NPC context + player context + recent history to the LLM
   * and determines whether a mechanical roll is needed.
   *
   * @returns Validated {@link NpcIntentAnalysisOutput}.
   *   Rejects when the text provider fails — the error is surfaced, never
   *   faked with an authored reply.
   */
  analyzeIntent(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    playerContext?: { characterSheetSummary: string; level: number; classId: string };
    /** Called with each narrative token as the pre-roll narrative streams (C-401). */
    onChunk?: (text: string) => void;
  }): Promise<NpcIntentAnalysisOutput>;

  /**
   * Call #2 of the two-call pipeline: roll resolution.
   *
   * Called AFTER the dice has been rolled. Sends the roll outcome to
   * the LLM for narrative resolution + state delta proposals.
   *
   * @returns Validated {@link NpcRollResolutionOutput}.
   */
  resolveRoll(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    checkType: string;
    difficultyClass: number;
    rollTotal: number;
    outcome: 'pass' | 'fail';
    playerInput: string;
    /** Called with each narrative token as the resolution narrative streams (C-401). */
    onChunk?: (text: string) => void;
  }): Promise<NpcRollResolutionOutput>;

  /** Whether the two-call free-text-first pipeline is active. */
  readonly useFreeTextFirst: boolean;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default per-call generation timeout. Generous by design — a CPU-bound
 * local model on a slow machine can take a while for first token; a value
 * that fires during normal local play is worse than no timeout (AC-4 watch
 * point). Configurable via `configure({ timeoutMs })`.
 */
const DEFAULT_DIALOGUE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class NpcDialogueService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements NpcDialogueServiceInterface
{
  private _contentProvider: NpcDialogueContentProvider | undefined;
  private _textGenerator: NpcDialogueTextGenerator | undefined;
  private _executors: NpcDialogueExecutors | undefined;
  private _configured = false;

  /** Per-call generation timeout (AC-4). */
  private _timeoutMs = DEFAULT_DIALOGUE_TIMEOUT_MS;

  /**
   * UI-visible state of the current dialogue turn (C-401).
   * Public by design — the dialogue ViewModel renders it reactively.
   */
  turnState = $state<DialogueTurnState>({ kind: 'idle' });

  /** Streamed narrative accumulator for the current turn (non-reactive). */
  private _streamText = '';

  /**
   * Per-turn validity token. Bumped on `_startTurnStream` and on timeout so
   * late onChunk/_forwardChunk callbacks from a superseded turn are dropped.
   */
  private _streamTurnId = 0;

  /** Whether a rAF flush of `_streamText` is already scheduled. */
  private _streamFlushScheduled = false;

  /** Feature flag — when false, action menu path is used (C-371). */
  private _useFreeTextFirst = true;

  /** Per-turn executed-command guard (keyed by turn message id). */
  private _executedCommands = new Map<string, NpcDialogueCommandKind>();

  /** Active generation AbortController — only one live at a time. */
  private _activeAbortController: AbortController | null = null;

  /** The currently active NPC, if any. */
  private _activeNpc:
    | {
        npcId: string;
        npcName: string;
        dialog?: string;
        personaId?: string;
        initialSuggestions?: NpcSuggestionChip[];
      }
    | undefined;

  /** @inheritdoc */
  get activeNpc():
    | {
        npcId: string;
        npcName: string;
        dialog?: string;
        personaId?: string;
        initialSuggestions?: NpcSuggestionChip[];
      }
    | undefined {
    return this._activeNpc;
  }

  /** @inheritdoc */
  startDialogue(options: {
    npcData: {
      npcId: string;
      npcName: string;
      dialog?: string;
      personaId?: string;
      initialSuggestions?: NpcSuggestionChip[];
    };
    setOverlay: (type: string) => void;
    pauseEngine: () => void;
  }): void {
    // The engine emits the dialogue KEY (e.g. "guard_captain_greeting"); the
    // content provider resolves it to authored text. Plain text (dev sandbox)
    // passes through unchanged when getDialogue has no entry for it.
    const rawDialog = options.npcData.dialog;
    const resolvedDialog = this._contentProvider?.getDialogue(rawDialog ?? '') ?? rawDialog;

    // Attach the NPC's authored initial suggestion chips when not supplied.
    const npcEntry = this._contentProvider?.getNpc(options.npcData.npcId);
    const initialSuggestions = options.npcData.initialSuggestions ?? npcEntry?.initialSuggestions;

    this.debug('startDialogue', {
      npcId: options.npcData.npcId,
      dialogWasKey: rawDialog !== resolvedDialog,
      suggestionCount: initialSuggestions?.length ?? 0,
    });

    this._activeNpc = {
      npcId: options.npcData.npcId,
      npcName: options.npcData.npcName,
      dialog: resolvedDialog,
      personaId: options.npcData.personaId,
      initialSuggestions,
    };
    options.pauseEngine();
    options.setOverlay('DIALOGUE');
  }

  /** @inheritdoc */
  endDialogue(options: { clearOverlay: () => void; resumeEngine: () => void }): void {
    this._activeNpc = undefined;
    if (this._activeAbortController) {
      this._activeAbortController.abort();
      this._activeAbortController = null;
    }
    options.clearOverlay();
    options.resumeEngine();
  }

  configure(options: {
    contentProvider: NpcDialogueContentProvider;
    textGenerator: NpcDialogueTextGenerator;
    executors: NpcDialogueExecutors;
    useFreeTextFirst?: boolean;
    timeoutMs?: number;
  }): void {
    this._contentProvider = options.contentProvider;
    this._textGenerator = options.textGenerator;
    this._executors = options.executors;
    this._useFreeTextFirst = options.useFreeTextFirst ?? true;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_DIALOGUE_TIMEOUT_MS;
    this._configured = true;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** @inheritdoc */
  deriveAllowedCommands(npcId: string): NpcDialogueCommandKind[] {
    this._assertConfigured();
    const npc = this._contentProvider!.getNpc(npcId);
    return this._deriveAllowedCommands(npc);
  }

  /** @inheritdoc */
  buildContext(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    gameStateFacts?: string[];
  }): DialogueContextProjection {
    this._assertConfigured();
    const npc = this._contentProvider!.getNpc(options.npcId);
    const allowedCommands = this._deriveAllowedCommands(npc);
    return this._buildContextProjection({
      npc,
      npcName: options.npcName,
      messages: options.messages,
      gameStateFacts: options.gameStateFacts ?? [],
      allowedCommands,
    });
  }

  /** @inheritdoc */
  async generateTurn(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    activeEncounterId?: string;
    onChunk?: (text: string) => void;
  }): Promise<NpcDialogueTurn> {
    this._assertConfigured();

    // ── Concurrency gate: cancel any in-flight turn ───────────────────
    if (this._activeAbortController) {
      this._activeAbortController.abort();
      this.warn('generateTurn:cancelled-previous');
    }

    const controller = new AbortController();
    this._activeAbortController = controller;
    const linkedSignal = this._linkSignals(options.signal, controller.signal, controller);

    try {
      const npc = this._contentProvider!.getNpc(options.npcId);

      // ── Build turn context ─────────────────────────────────────────
      const allowedCommands = this._deriveAllowedCommands(npc);
      const contextualKey = this._resolveContextualDialogueKey(
        options.npcId,
        options.activeEncounterId,
      );

      const turnCtx: TurnContext = {
        npcId: options.npcId,
        npcName: options.npcName,
        npcEntry: npc,
        allowedCommands,
        contextualDialogueKey: contextualKey,
      };

      const contextProjection = this._buildContextProjection({
        npc,
        npcName: options.npcName,
        messages: options.messages,
        gameStateFacts: options.gameStateFacts ?? [],
        allowedCommands,
      });

      // ── Attempt AI generation ──────────────────────────────────────
      try {
        const aiTurn = await this._generateAiTurn({
          contextProjection,
          messages: options.messages,
          signal: linkedSignal,
          turnCtx,
          onChunk: options.onChunk,
        });
        return aiTurn;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // AC-3: abort rejects — the ViewModel removes the placeholder and
        // never writes a partial turn.
        if (this._isAbortError(error)) {
          this._setTurnStateIfCurrent(controller, {
            kind: 'failed',
            reason: 'aborted',
            fallbackOffered: false,
          });
          this.warn('generateTurn:aborted');
          throw error;
        }

        // Any provider failure (timeout or error) is surfaced to the player.
        // We deliberately do NOT fall back to authored dialogue: the game is
        // unplayable without the text provider, so a broken provider must be
        // visible as an error rather than silently faked. Record the failure
        // and rethrow so the ViewModel surfaces it.
        const timedOut = error instanceof DialogueTimeoutError;
        const cause = timedOut ? ('timeout' as const) : ('provider_error' as const);
        this._setTurnStateIfCurrent(controller, {
          kind: 'failed',
          reason: cause,
          fallbackOffered: false,
        });
        this.warn('generateTurn:failed', { cause, detail: message });
        throw error;
      }
    } finally {
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /**
   * Records that a command was executed for a given turn ID.
   * Prevents re-execution on regenerate.
   */
  markCommandExecuted(turnId: string, kind: NpcDialogueCommandKind): void {
    this._executedCommands.set(turnId, kind);
  }

  /**
   * Checks whether a command was already executed for a given turn ID.
   */
  wasCommandExecuted(turnId: string): boolean {
    return this._executedCommands.has(turnId);
  }

  /**
   * Executes a validated dialogue command through the orchestrator-owned
   * executor boundary.
   */
  executeCommand(options: {
    kind: string;
    npcId: string;
    npcName: string;
    npcEntry?: ReturnType<NpcDialogueContentProvider['getNpc']>;
    command: NpcDialogueCommand;
  }): boolean {
    this._assertConfigured();
    const { kind, npcId, npcName, npcEntry, command } = options;

    const npc = npcEntry ?? this._contentProvider!.getNpc(npcId);

    switch (kind) {
      case 'trade':
        return this._executors!.trade({
          npcId,
          vendorName: npcName,
          vendorInventory: npc?.vendorInventory,
        });
      case 'offerQuest':
        return this._executors!.offerQuest({
          npcId,
          questId: (command as { questId: string }).questId,
        });
      case 'skillCheck':
        return this._executors!.skillCheck({
          skill: (command as { skill: string }).skill,
          difficultyClass: (command as { difficultyClass: number }).difficultyClass,
        });
      case 'giveItem':
        return this._executors!.giveItem({
          itemId: (command as { itemId: string }).itemId,
          quantity: (command as { quantity: number }).quantity ?? 1,
        });
      case 'startCombat':
        return this._executors!.startCombat({
          npcId,
          npcName,
          encounterId: (command as { encounterId?: string }).encounterId,
        });
      case 'recruit':
        return this._executors!.recruit({
          npcId,
          npcName: npc?.name ?? 'Unknown',
        });
      default:
        this.warn('executeCommand:unknown-kind', { kind });
        return false;
    }
  }

  /** @inheritdoc */
  get useFreeTextFirst(): boolean {
    return this._useFreeTextFirst;
  }

  // ── Public: two-call pipeline (C-371) ─────────────────────────────────

  /** @inheritdoc */
  async analyzeIntent(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    playerContext?: { characterSheetSummary: string; level: number; classId: string };
    onChunk?: (text: string) => void;
  }): Promise<NpcIntentAnalysisOutput> {
    this._assertConfigured();

    // Concurrency gate
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
    const controller = new AbortController();
    this._activeAbortController = controller;
    const linkedSignal = this._linkSignals(options.signal, controller.signal, controller);

    try {
      const npc = this._contentProvider!.getNpc(options.npcId);
      const allowedCommands = this._deriveAllowedCommands(npc);

      try {
        return await this._analyzeIntent({
          npcName: options.npcName,
          allowedCommands,
          messages: options.messages,
          signal: linkedSignal,
          gameStateFacts: options.gameStateFacts ?? [],
          playerContext: options.playerContext ?? {
            characterSheetSummary: 'Level 1 Fighter',
            level: 1,
            classId: 'fighter',
          },
          onChunk: options.onChunk,
        });
      } catch (error) {
        if (this._isAbortError(error)) {
          this._setTurnStateIfCurrent(controller, {
            kind: 'failed',
            reason: 'aborted',
            fallbackOffered: false,
          });
          this.warn('analyzeIntent:aborted');
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof DialogueTimeoutError ? 'timeout' : 'provider_error';
        this._setTurnStateIfCurrent(controller, {
          kind: 'failed',
          reason: cause,
          fallbackOffered: false,
        });
        // Surface the provider failure — never fake an authored reply.
        this.warn('analyzeIntent:failed', { cause, detail: message });
        throw error;
      }
    } finally {
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  /** @inheritdoc */
  async resolveRoll(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    checkType: string;
    difficultyClass: number;
    rollTotal: number;
    outcome: 'pass' | 'fail';
    playerInput: string;
    onChunk?: (text: string) => void;
  }): Promise<NpcRollResolutionOutput> {
    this._assertConfigured();

    // Concurrency gate
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
    const controller = new AbortController();
    this._activeAbortController = controller;
    const linkedSignal = this._linkSignals(options.signal, controller.signal, controller);

    try {
      try {
        return await this._resolveRoll({
          npcId: options.npcId,
          npcName: options.npcName,
          messages: options.messages,
          signal: linkedSignal,
          gameStateFacts: options.gameStateFacts ?? [],
          checkType: options.checkType,
          difficultyClass: options.difficultyClass,
          rollTotal: options.rollTotal,
          outcome: options.outcome,
          playerInput: options.playerInput,
          onChunk: options.onChunk,
        });
      } catch (error) {
        if (this._isAbortError(error)) {
          this._setTurnStateIfCurrent(controller, {
            kind: 'failed',
            reason: 'aborted',
            fallbackOffered: false,
          });
          this.warn('resolveRoll:aborted');
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof DialogueTimeoutError ? 'timeout' : 'provider_error';
        this._setTurnStateIfCurrent(controller, {
          kind: 'failed',
          reason: cause,
          fallbackOffered: false,
        });
        // Surface the provider failure — never fake a resolution.
        this.warn('resolveRoll:failed', { cause, detail: message });
        throw error;
      }
    } finally {
      if (this._activeAbortController === controller) {
        this._activeAbortController = null;
      }
    }
  }

  // ── Private: AI generation path ───────────────────────────────────────

  /**
   * Parses and validates the raw structured envelope from the AI response.
   * Returns a parsed envelope or null if validation fails.
   */
  private _parseEnvelope(
    narrative: string,
    rawEnvelope: unknown,
  ): {
    narrative?: string;
    command?: NpcDialogueCommand;
    choices?: NpcDialogueChoice[];
  } | null {
    if (!rawEnvelope || typeof rawEnvelope !== 'object') {
      return null;
    }

    const env = rawEnvelope as Record<string, unknown>;

    // First attempt: check raw envelope directly
    if (Value.Check(NpcDialogueAiEnvelopeSchema, env)) {
      return env as {
        narrative?: string;
        command?: NpcDialogueCommand;
        choices?: NpcDialogueChoice[];
      };
    }

    // One repair attempt: try merging with narrative
    const repaired = {
      narrative: narrative || (env.narrative as string) || '',
      command: env.command,
      choices: env.choices,
    };
    if (Value.Check(NpcDialogueAiEnvelopeSchema, repaired)) {
      this.warn('_generateAiTurn:repaired', {
        narrativeLength: narrative.length,
      });
      return repaired as {
        narrative?: string;
        command?: NpcDialogueCommand;
        choices?: NpcDialogueChoice[];
      };
    }

    this.warn('_generateAiTurn:invalid-output', {
      narrativeLength: narrative.length,
      envelopeKeys: Object.keys(env),
    });
    return null;
  }

  /**
   * Calls the gateway text generator with the projected context.
   *
   * C-401: split into two calls — call 1 streams plain narrative prose
   * (no schema, via `onChunk`), call 2 extracts the structured command
   * envelope from the completed narrative under the TypeBox schema. If
   * call 2 fails or returns a malformed envelope, the turn degrades to
   * narrative-only with derived choices — the streamed text the player
   * already read is never discarded (AC-7).
   */
  private async _generateAiTurn(options: {
    contextProjection: DialogueContextProjection;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    turnCtx?: TurnContext;
    onChunk?: (text: string) => void;
  }): Promise<NpcDialogueTurn> {
    const { contextProjection, messages, signal, onChunk } = options;

    const narrativeSystemPrompt = this._buildNarrativeSystemPrompt(contextProjection);
    const extractionSystemPrompt = this._buildExtractionSystemPrompt(contextProjection);

    // Build adapter messages: system + conversation (bounded window)
    const conversationMessages = messages
      .slice(-20) // bounded memory window — last 20 turns max
      .map((m) => ({
        role: m.role === 'player' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }));

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: narrativeSystemPrompt },
      ...conversationMessages,
    ];

    const turnStart = performance.now();
    this._startTurnStream();

    try {
      // ── Call 1: stream narrative prose (no schema) ─────────────────
      const narrative = await this._withTimeout(
        this._streamNarrative({
          adapterMessages,
          signal,
          onChunk,
          path: 'turn-narrative',
          call: 1,
        }),
        'narrative',
      );
      this._checkAbort(signal);

      // ── Call 2: extract the command envelope from the narrative ────
      this.turnState = { kind: 'awaiting_envelope', text: narrative };
      let rawEnvelope: unknown;
      try {
        rawEnvelope = await this._withTimeout(
          this._extractEnvelope({
            narrative,
            systemPrompt: extractionSystemPrompt,
            schema: NpcDialogueAiEnvelopeSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
            schemaName: 'NpcDialogueAiEnvelope',
            signal,
            path: 'turn-envelope',
            call: 2,
          }),
          'envelope',
        );
      } catch (error) {
        this._checkAbort(signal);
        this._logCallFailure({ path: 'turn-envelope', call: 2, error });
        // AC-7: degrade to narrative-only — never discard streamed text.
        return this._assembleNarrativeTurn({ narrative, contextProjection });
      }
      this._checkAbort(signal);

      // ── Parse and validate the structured envelope ────────────────
      const parsedEnvelope = this._parseEnvelope(narrative, rawEnvelope);

      if (!parsedEnvelope) {
        // Malformed envelope — same AC-7 degrade path.
        this.warn('_generateAiTurn:malformed-envelope', {
          narrativeLength: narrative.length,
        });
        return this._assembleNarrativeTurn({ narrative, contextProjection });
      }

      // The streamed narrative is authoritative — the player already read it.
      const finalNarrative = narrative || parsedEnvelope.narrative || '';
      const command = parsedEnvelope.command;
      let choices = this._filterChoices(parsedEnvelope.choices ?? []);

      // If no choices came back, derive from context
      if (choices.length === 0) {
        choices = this._deriveChoices({ npcName: contextProjection.npcName });
      }

      // Precondition check on command
      if (command) {
        const precondResult = this._validateCommandPreconditions(
          command,
          contextProjection.allowedCommands,
          options.turnCtx?.npcEntry,
        );
        if (!precondResult.allowed) {
          this.warn('_generateAiTurn:command-denied', {
            commandKind: command.kind,
            reason: precondResult.reason,
            allowed: contextProjection.allowedCommands,
          });
          // Drop the command — narrative still renders
          this.turnState = { kind: 'complete', text: finalNarrative };
          this._logTurnTime({ path: 'turn', ms: performance.now() - turnStart });
          return {
            narrative: finalNarrative,
            choices,
            source: 'ai' as const,
          };
        }
      }

      const turn: NpcDialogueTurn = {
        narrative: finalNarrative,
        command,
        choices,
        source: 'ai',
      };

      // Final validation — degrade to narrative-only rather than discarding
      // streamed text (AC-7); authored fallback is reserved for call-1 failures.
      if (!Value.Check(NpcDialogueTurnSchema, turn)) {
        this.warn('_generateAiTurn:turn-validation-failed');
        return this._assembleNarrativeTurn({ narrative, contextProjection });
      }

      this.turnState = { kind: 'complete', text: finalNarrative };
      this._logTurnTime({ path: 'turn', ms: performance.now() - turnStart });
      return turn;
    } catch (error) {
      this._logCallFailure({ path: 'turn', call: this._currentCallIndex, error });
      throw error;
    }
  }

  // ── Private: two-call split helpers (C-401) ───────────────────────────

  /**
   * Call 1 of the split: streams narrative prose (no schema) and returns
   * the completed narrative. Also accumulates a turnState copy and forwards
   * tokens to the caller's `onChunk`.
   */
  private async _streamNarrative(options: {
    adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    signal: AbortSignal;
    onChunk?: (text: string) => void;
    path: string;
    call: number;
  }): Promise<string> {
    const { adapterMessages, signal, onChunk, path, call } = options;
    const callStart = performance.now();
    // Capture the turn token: a timeout bumps `_streamTurnId`, so chunks
    // arriving after the timeout from the still-running provider are dropped
    // (they must never regress the failed turn state or reach the view after
    // the placeholder was removed).
    const streamTurnId = this._streamTurnId;
    let firstToken = false;

    const result = await this._textGenerator!({
      messages: adapterMessages,
      signal,
      onChunk: (text: string) => {
        if (streamTurnId !== this._streamTurnId) {
          return;
        }
        if (!firstToken) {
          firstToken = true;
          this.info('dialogue:ttft', {
            path,
            call,
            ms: Math.round(performance.now() - callStart),
          });
        }
        this._forwardChunk(onChunk, text);
      },
    });

    return result.text?.trim() || this._streamText.trim() || '';
  }

  /**
   * Call 2 of the split: schema-constrained extraction of the structured
   * envelope from the completed narrative. Non-streamed by design.
   */
  private async _extractEnvelope(options: {
    narrative: string;
    systemPrompt: string;
    schema: Record<string, unknown>;
    schemaName: string;
    signal: AbortSignal;
    path: string;
    call: number;
  }): Promise<unknown> {
    const { narrative, systemPrompt, schema, schemaName, signal, path, call } = options;
    const callStart = performance.now();
    this._currentCallIndex = call;
    try {
      const result = await this._textGenerator!({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: narrative },
        ],
        schema,
        schemaName,
        signal,
      });
      return result.structured;
    } catch (error) {
      this._logCallFailure({ path, call, error, ms: performance.now() - callStart });
      throw error;
    }
  }

  /**
   * Wraps a generation promise with the configured timeout. A stalled
   * provider (never resolves) rejects with {@link DialogueTimeoutError}.
   *
   * On timeout the current turn is invalidated: the per-turn stream token
   * is bumped so late onChunk/_forwardChunk callbacks from the still-running
   * provider are dropped (they must never regress the `failed` turn state or
   * write streamed text after the placeholder was removed).
   */
  private _withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._streamTurnId++;
        reject(new DialogueTimeoutError(this._timeoutMs, label));
      }, this._timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /** Resets per-turn stream state and enters `idle`. */
  private _startTurnStream(): void {
    this._streamText = '';
    this._streamFlushScheduled = false;
    this._currentCallIndex = 1;
    this._streamTurnId++;
    this.turnState = { kind: 'idle' };
  }

  /**
   * Accumulates a chunk into turnState (frame-batched) and forwards it to
   * the caller's onChunk. Enters `streaming` on the first chunk — a
   * non-streaming provider never enters `streaming` (AC-6).
   */
  private _forwardChunk(onChunk: ((text: string) => void) | undefined, text: string): void {
    this._streamText += text;
    if (this.turnState.kind !== 'streaming') {
      this.turnState = { kind: 'streaming', text: this._streamText };
    }
    this._scheduleStreamFlush();
    onChunk?.(text);
  }

  /**
   * Batches turnState text updates to at most one per animation frame —
   * never one rune write per token (limitations.md §Svelte update threshold).
   */
  private _scheduleStreamFlush(): void {
    if (this._streamFlushScheduled) {
      return;
    }
    this._streamFlushScheduled = true;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            setTimeout(() => callback(0), 16) as unknown as typeof requestAnimationFrame; // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
    raf(() => {
      this._streamFlushScheduled = false;
      // Only update while still streaming — never regress complete/failed.
      if (this.turnState.kind === 'streaming' && this._streamText.length > 0) {
        this.turnState = { kind: 'streaming', text: this._streamText };
      }
    });
  }

  /** Throws an AbortError if the caller aborted between calls (AC-3). */
  private _checkAbort(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  }

  /** Whether the error represents cancellation. */
  private _isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /abort/i.test(message);
  }

  /**
   * Assembles a narrative-only turn (AC-7) — keeps the streamed text and
   * derives choices; no command is derived, so no command executes and
   * `_validateCommandPreconditions` never runs.
   */
  private _assembleNarrativeTurn(options: {
    narrative: string;
    contextProjection: DialogueContextProjection;
  }): NpcDialogueTurn {
    const { narrative, contextProjection } = options;
    const turn: NpcDialogueTurn = {
      narrative: narrative || this._genericFallbackLine(contextProjection.npcName),
      choices: this._deriveChoices({ npcName: contextProjection.npcName }),
      source: 'ai' as const,
    };
    this.turnState = { kind: 'complete', text: turn.narrative };
    return turn;
  }

  /** Sets turnState only if this turn is still the active one. */
  private _setTurnStateIfCurrent(controller: AbortController, state: DialogueTurnState): void {
    if (this._activeAbortController === controller) {
      this.turnState = state;
    }
  }

  /** AC-5 instrumentation: time-to-first-token / per-call failure. */
  private _currentCallIndex = 1;

  private _logCallFailure(options: {
    path: string;
    call: number;
    error: unknown;
    ms?: number;
  }): void {
    const { path, call, error, ms } = options;
    let reason: 'aborted' | 'timeout' | 'provider_error';
    if (this._isAbortError(error)) {
      reason = 'aborted';
    } else if (error instanceof DialogueTimeoutError) {
      reason = 'timeout';
    } else {
      reason = 'provider_error';
    }
    this.warn('dialogue:call-failed', {
      path,
      call,
      reason,
      ms: ms !== undefined ? Math.round(ms) : undefined,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /** AC-5 instrumentation: total turn time. */
  private _logTurnTime(options: { path: string; ms: number }): void {
    this.info('dialogue:turn-time', {
      path: options.path,
      ms: Math.round(options.ms),
    });
  }

  // ── Private: context projection ───────────────────────────────────────

  /** Builds the full context projection for a dialogue turn. */
  private _buildContextProjection(options: {
    npc: ReturnType<NpcDialogueContentProvider['getNpc']>;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    gameStateFacts: string[];
    allowedCommands: NpcDialogueCommandKind[];
  }): DialogueContextProjection {
    const { npc, npcName, messages, gameStateFacts, allowedCommands } = options;

    // Persona: content-pack NPC name + PERSONA_PROMPTS fallback
    const personaKey = npc?.name?.toLowerCase().replace(/\s+/g, '_') ?? FALLBACK_PERSONA_ID;
    const persona = npc?.name
      ? `You are ${npcName}, a ${npc.name} living in a fantasy world. ${
          PERSONA_PROMPTS[personaKey] ?? PERSONA_PROMPTS[FALLBACK_PERSONA_ID]
        }`
      : PERSONA_PROMPTS[FALLBACK_PERSONA_ID];

    // Memory: recent conversation turns (bounded window — last 10 turns)
    const memory = messages
      .slice(-10)
      .map((m) => `${m.role === 'player' ? 'Player' : npcName}: ${m.content}`);

    return {
      persona,
      npcName,
      memory,
      gameStateFacts,
      relationshipFacts: [],
      allowedCommands,
    };
  }

  /**
   * Builds the system prompt for the streamed narrative call (call 1 of the
   * C-401 split). Asks for plain prose — never JSON — so tokens stream as
   * readable narrative.
   */
  private _buildNarrativeSystemPrompt(projection: DialogueContextProjection): string {
    const lines = [
      '[NPC CONTEXT]',
      projection.persona,
      `Your name is ${projection.npcName}.`,
      'Stay in character at all times. Respond as the NPC would.',
      '',
      'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
      'Do not break character. Do not mention being an AI.',
      "Reply with the NPC's spoken narrative ONLY — plain prose, no JSON.",
    ];

    if (projection.gameStateFacts.length > 0) {
      lines.push('', '[GAME STATE]', ...projection.gameStateFacts);
    }

    if (projection.relationshipFacts && projection.relationshipFacts.length > 0) {
      lines.push('', '[RELATIONSHIPS]', ...projection.relationshipFacts);
    }

    if (projection.memory.length > 0) {
      lines.push('', '[CONVERSATION HISTORY]', ...projection.memory);
    }

    lines.push(
      '',
      '[ALLOWED ACTIONS]',
      `In this scene the NPC has these actions available: ${projection.allowedCommands.join(', ') || 'none'}.`,
      'These are scene context only — do not output actions in your reply.',
    );

    return lines.join('\n');
  }

  /**
   * Builds the system prompt for the envelope extraction call (call 2 of
   * the C-401 split). Operating on the completed narrative, it asks for the
   * structured `{narrative, command, choices}` envelope — the same shape the
   * single-call path used to request.
   */
  private _buildExtractionSystemPrompt(projection: DialogueContextProjection): string {
    return [
      '[NPC CONTEXT]',
      projection.persona,
      `You are ${projection.npcName}, staying in character.`,
      '',
      '[EXTRACTION]',
      'You are given an NPC narrative that was just spoken to the player.',
      'Extract the structured dialogue envelope from it:',
      '"narrative" (string, required),',
      'optionally "command" (one of the allowed actions),',
      'and optionally "choices" (array of player options, at most 4).',
      'Each choice has "id", "label", and optionally "command" or "nextDialogueKey".',
      `Allowed actions: ${projection.allowedCommands.join(', ') || 'none'}.`,
      'Do not invent new narrative — reuse the given narrative verbatim.',
    ].join('\n');
  }

  // ── Private: precondition derivation ──────────────────────────────────

  /** Derives the allowed command kinds from an NPC's content-pack capabilities. */
  private _deriveAllowedCommands(
    npc: ReturnType<NpcDialogueContentProvider['getNpc']>,
  ): NpcDialogueCommandKind[] {
    const allowed: NpcDialogueCommandKind[] = [];

    if (npc?.isVendor) {
      allowed.push('trade');
    }

    // Any NPC can offer a quest (gated by per-quest precondition in dispatch)
    if (npc) {
      allowed.push('offerQuest');
      allowed.push('skillCheck');
    }

    // giveItem: only when NPC has inventory items (vendorInventory)
    if (npc?.vendorInventory) {
      allowed.push('giveItem');
    }

    if (npc?.combatStats) {
      allowed.push('startCombat');
    }

    // recruit: only when NPC is a recruitable companion (C-340)
    if ((npc as Record<string, unknown> | undefined)?.isCompanion) {
      allowed.push('recruit');
    }

    return allowed;
  }

  // ── Private: command-specific precondition validation ─────────────────

  /**
   * Validates a command beyond its kind whitelist:
   * - giveItem: item must be in the NPC's inventory
   * - offerQuest: quest must exist in content
   * - startCombat: NPC must have combat stats
   * - skillCheck: difficulty class in [1, 30], skill must be non-empty
   * - trade: NPC must be a vendor
   */
  private _validateCommandPreconditions(
    command: NpcDialogueCommand,
    allowedCommands: NpcDialogueCommandKind[],
    npcEntry?: ReturnType<NpcDialogueContentProvider['getNpc']>,
  ): { allowed: boolean; reason?: string } {
    // Kind-level check
    if (!allowedCommands.includes(command.kind)) {
      return { allowed: false, reason: `kind ${command.kind} not in whitelist` };
    }

    const c = command as NpcDialogueCommand & Record<string, unknown>;

    switch (command.kind) {
      case 'giveItem': {
        const itemId = c.itemId as string | undefined;
        if (!itemId) {
          return { allowed: false, reason: 'giveItem missing itemId' };
        }
        const quantity = (c.quantity as number) ?? 1;
        if (quantity < 1 || quantity > 99) {
          return { allowed: false, reason: `giveItem quantity ${quantity} out of bounds` };
        }
        // Check NPC inventory contains the item
        const inventory = npcEntry?.vendorInventory;
        if (!inventory) {
          return { allowed: false, reason: 'NPC has no inventory for giveItem' };
        }
        const items = inventory.split(',').map((s: string) => s.trim());
        if (!items.includes(itemId)) {
          return { allowed: false, reason: `item ${itemId} not in NPC inventory` };
        }
        return { allowed: true };
      }

      case 'offerQuest': {
        const questId = c.questId as string | undefined;
        if (!questId) {
          return { allowed: false, reason: 'offerQuest missing questId' };
        }
        const quest = this._contentProvider!.getQuest(questId);
        if (!quest) {
          return { allowed: false, reason: `quest ${questId} not found` };
        }
        return { allowed: true };
      }

      case 'skillCheck': {
        const skill = c.skill as string | undefined;
        if (!skill) {
          return { allowed: false, reason: 'skillCheck missing skill' };
        }
        const difficultyClass = (c.difficultyClass as number) ?? 0;
        if (difficultyClass < 1 || difficultyClass > 30) {
          return {
            allowed: false,
            reason: `skillCheck DC ${difficultyClass} out of bounds [1,30]`,
          };
        }
        return { allowed: true };
      }

      case 'startCombat': {
        if (!npcEntry?.combatStats) {
          return { allowed: false, reason: 'NPC has no combat stats' };
        }
        return { allowed: true };
      }

      case 'trade': {
        if (!npcEntry?.isVendor) {
          return { allowed: false, reason: 'NPC is not a vendor' };
        }
        return { allowed: true };
      }

      default: {
        const unknownCmd = command as NpcDialogueCommand & Record<string, unknown>;
        return { allowed: false, reason: `unknown command kind: ${String(unknownCmd.kind)}` };
      }
    }
  }

  // ── Private: contextual dialogue key resolution ──────────────────────

  /**
   * Resolves the active encounter-specific dialogue key.
   * When `activeEncounterId` is provided, only that encounter is checked,
   * preventing NPCs listed in other encounters from inheriting their dialogue.
   * Falls back to scanning all encounters only when no active encounter is known.
   */
  private _resolveContextualDialogueKey(
    npcId: string,
    activeEncounterId?: string,
  ): string | undefined {
    if (activeEncounterId) {
      const enc = this._contentProvider!.getEncounter(activeEncounterId);
      if (enc?.encounterNpcIds?.includes(npcId) && enc.dialogueKey) {
        return enc.dialogueKey;
      }
      return undefined;
    }

    // No active encounter — fall back to scanning all
    const encounters = this._contentProvider!.getAllEncounters();
    for (const enc of encounters) {
      if (enc.encounterNpcIds?.includes(npcId) && enc.dialogueKey) {
        return enc.dialogueKey;
      }
    }

    return undefined;
  }

  // ── Private: choice derivation ───────────────────────────────────────

  /** Filters and caps choices after AI generation. */
  private _filterChoices(choices: NpcDialogueChoice[]): NpcDialogueChoice[] {
    return choices.filter((c) => c.id && c.label).slice(0, 4);
  }

  /** Derives contextual choices from NPC capabilities (both AI and authored paths). */
  private _deriveChoices(options: { npcName: string }): NpcDialogueChoice[] {
    // Minimal generic choices when AI doesn't provide any
    return [
      { id: 'talk', label: `Ask ${options.npcName} more` },
      { id: 'leave', label: 'Leave' },
    ];
  }

  // ── Private: generic fallback ────────────────────────────────────────

  /** Generic fallback line when an NPC has no authored dialogue at all. */
  private _genericFallbackLine(npcName: string): string {
    return `*${npcName} looks at you silently, waiting for you to speak.*`;
  }

  // ── Private: signal linking ──────────────────────────────────────────

  /**
   * Links the caller's signal with our internal controller.
   * Captures `controller` locally so aborting an older caller cannot
   * cancel a newer turn.
   */
  private _linkSignals(
    callerSignal: AbortSignal,
    internalSignal: AbortSignal,
    controller: AbortController,
  ): AbortSignal {
    // Handle already-aborted caller before starting work
    if (callerSignal.aborted) {
      controller.abort();
      return internalSignal;
    }

    // When the caller signal aborts, abort the captured controller
    const onCallerAbort = () => {
      try {
        controller.abort();
      } catch {
        // ignore — signal may already be aborted
      }
    };
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });

    return internalSignal;
  }

  // ── Private: guard ────────────────────────────────────────────────────

  private _assertConfigured(): void {
    if (!this._configured) {
      throw new Error('NpcDialogueService not configured — call configure() before use');
    }
  }

  // ── Private: two-call pipeline (C-371) ────────────────────────────────

  /**
   * Call #1 of the two-call pipeline: intent analysis — determines if a
   * mechanical roll is needed.
   *
   * C-401: split — the NPC's narrative response streams first (no schema),
   * then the intent envelope (requiresRoll, checkType, DC, chips) is
   * extracted from the completed narrative. The streamed narrative is
   * authoritative for `npcResponse` (AC-2: narrative fully streamed and
   * visible before the dice prompt).
   */
  private async _analyzeIntent(options: {
    npcName: string;
    allowedCommands: NpcDialogueCommandKind[];
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts: string[];
    playerContext: { characterSheetSummary: string; level: number; classId: string };
    onChunk?: (text: string) => void;
  }): Promise<NpcIntentAnalysisOutput> {
    this.debug('_analyzeIntent:start');

    const { npcName, allowedCommands, messages, gameStateFacts, playerContext, onChunk } = options;

    // Build the input for the LLM
    const input: NpcIntentAnalysisInput = {
      playerInput: messages.filter((m) => m.role === 'player').pop()?.content ?? '',
      npcContext: {
        name: npcName,
        persona: `You are ${npcName}, a character in a fantasy world.`,
        allowedCommands,
      },
      playerContext,
      recentHistory: messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 200),
      })),
      gameStateFacts,
    };

    // Call 1 streams prose; call 2 extracts the intent envelope.
    const narrativeSystemPrompt = buildIntentNarrativeSystemPrompt();
    const extractionSystemPrompt = buildIntentAnalysisSystemPrompt();

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: narrativeSystemPrompt },
      { role: 'user', content: JSON.stringify(input) },
    ];

    const turnStart = performance.now();
    this._startTurnStream();

    try {
      // ── Call 1: stream the NPC's narrative response (no schema) ─────
      const narrative = await this._withTimeout(
        this._streamNarrative({
          adapterMessages,
          signal: options.signal,
          onChunk,
          path: 'intent-narrative',
          call: 1,
        }),
        'intent-narrative',
      );
      this._checkAbort(options.signal);

      // ── Call 2: extract the intent envelope from the narrative ──────
      this.turnState = { kind: 'awaiting_envelope', text: narrative };
      let rawOutput: unknown;
      try {
        rawOutput = await this._withTimeout(
          this._extractEnvelope({
            // Keep the player's action alongside the narrative so the
            // requiresRoll decision survives extraction.
            narrative: `${input.playerInput}\n\n${narrative}`,
            systemPrompt: extractionSystemPrompt,
            schema: NpcIntentAnalysisOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
            schemaName: 'NpcIntentAnalysisOutput',
            signal: options.signal,
            path: 'intent-envelope',
            call: 2,
          }),
          'intent-envelope',
        );
      } catch (error) {
        this._checkAbort(options.signal);
        this.warn('_analyzeIntent:call2-failed', {
          detail: error instanceof Error ? error.message : String(error),
        });
        // Propagate call-2 failure to public handler so it sets failed turn state
        throw error;
      }
      this._checkAbort(options.signal);

      let output: NpcIntentAnalysisOutput | undefined;
      if (rawOutput !== undefined && Value.Check(NpcIntentAnalysisOutputSchema, rawOutput)) {
        output = rawOutput as NpcIntentAnalysisOutput;
        this.debug('_analyzeIntent:complete', {
          requiresRoll: output.requiresRoll,
          checkType: output.checkType,
          chipCount: output.suggestedChips.length,
        });
      }

      if (!output) {
        // Repair attempt: salvage narrative from the streamed text
        this.warn('_analyzeIntent:invalid-output');
        const recovered = recoverIntentAnalysisOutput(
          narrative.trim(),
          NpcIntentAnalysisOutputSchema,
        );
        output = {
          requiresRoll: false,
          checkType: undefined,
          difficultyClass: undefined,
          modifierSource: undefined,
          npcResponse: recovered.npcResponse,
          suggestedChips: recovered.suggestedChips,
          questActivation: recovered.questActivation,
        };
      }

      // The streamed narrative is authoritative — the player already read it.
      const finalOutput: NpcIntentAnalysisOutput = {
        ...output,
        npcResponse: narrative || output.npcResponse,
      };
      this.turnState = { kind: 'complete', text: finalOutput.npcResponse };
      this._logTurnTime({ path: 'intent', ms: performance.now() - turnStart });
      return finalOutput;
    } catch (error) {
      this._logCallFailure({ path: 'intent', call: this._currentCallIndex, error });
      throw error;
    }
  }

  /**
   * Call #2: Roll resolution — sends dice outcome to LLM for narrative.
   *
   * C-401: the resolution narrative streams first (no schema), then the
   * NpcRollResolutionOutput envelope (stateDeltas, chips) is extracted from
   * the completed narrative. The streamed narrative is authoritative for
   * `narrativeResult` (AC-2: resolution narrative streams after the roll).
   */
  private async _resolveRoll(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts: string[];
    checkType: string;
    difficultyClass: number;
    rollTotal: number;
    outcome: 'pass' | 'fail';
    playerInput: string;
    onChunk?: (text: string) => void;
  }): Promise<NpcRollResolutionOutput> {
    this.debug('_resolveRoll:start', {
      checkType: options.checkType,
      dc: options.difficultyClass,
      outcome: options.outcome,
    });

    const { npcName, checkType, difficultyClass, rollTotal, outcome, playerInput, onChunk } =
      options;

    const userPrompt = `${npcName} resolves a ${checkType} check: DC=${difficultyClass}, Roll=${rollTotal}, ${outcome === 'pass' ? 'SUCCESS' : 'FAILURE'}. Player said: "${playerInput}"`;

    // C-421: log the authoritative mechanical result so prompt fidelity is
    // verifiable from a session log.
    this.debug('_resolveRoll:authoritative', {
      npcName,
      checkType,
      dc: difficultyClass,
      total: rollTotal,
      success: outcome === 'pass',
    });

    // Call 1 streams prose; call 2 extracts the roll-resolution envelope.
    const narrativeSystemPrompt = [
      'You are a game master resolving a dice roll outcome in an RPG dialogue.',
      'Given the skill check result, write a narrative NPC response and propose',
      'any state changes (trust, flags, inventory).',
      '',
      'The mechanical result (DC, Roll, SUCCESS/FAILURE) is FINAL and',
      'authoritative. Your narration MUST NOT contradict it: if the check',
      'failed, the NPC cannot describe the player succeeding, and vice versa.',
      '',
      "Reply with the NPC's spoken narrative ONLY — plain prose, no JSON.",
    ].join('\n');

    const extractionSystemPrompt = [
      'You are a game master resolving a dice roll outcome in an RPG dialogue.',
      'Given the skill check result, write a narrative NPC response and propose',
      'any state changes (trust, flags, inventory).',
      '',
      'Extract the structured NpcRollResolutionOutput from the given narrative:',
      '"narrativeResult" (string, required), "stateDeltas" (array),',
      'and "suggestedChips" (array of player options).',
      'Do not invent new narrative — reuse the given narrative verbatim.',
    ].join('\n');

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: narrativeSystemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const turnStart = performance.now();
    this._startTurnStream();

    try {
      // ── Call 1: stream the resolution narrative (no schema) ─────────
      const narrative = await this._withTimeout(
        this._streamNarrative({
          adapterMessages,
          signal: options.signal,
          onChunk,
          path: 'roll-narrative',
          call: 1,
        }),
        'roll-narrative',
      );
      this._checkAbort(options.signal);

      // ── Call 2: extract the roll-resolution envelope ────────────────
      this.turnState = { kind: 'awaiting_envelope', text: narrative };
      let rawOutput: unknown;
      try {
        rawOutput = await this._withTimeout(
          this._extractEnvelope({
            narrative: `${userPrompt}\n\n${narrative}`,
            systemPrompt: extractionSystemPrompt,
            schema: NpcRollResolutionOutputSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
            schemaName: 'NpcRollResolutionOutput',
            signal: options.signal,
            path: 'roll-envelope',
            call: 2,
          }),
          'roll-envelope',
        );
      } catch (error) {
        this._checkAbort(options.signal);
        this.warn('_resolveRoll:call2-failed', {
          detail: error instanceof Error ? error.message : String(error),
        });
        // Propagate call-2 failure to public handler so it sets failed turn state
        throw error;
      }
      this._checkAbort(options.signal);

      let output: NpcRollResolutionOutput | undefined;
      if (rawOutput !== undefined && Value.Check(NpcRollResolutionOutputSchema, rawOutput)) {
        output = rawOutput as NpcRollResolutionOutput;
        this.debug('_resolveRoll:complete', {
          narrativeLength: output.narrativeResult.length,
          deltaCount: output.stateDeltas.length,
          chipCount: output.suggestedChips.length,
        });
      }

      if (!output) {
        this.warn('_resolveRoll:invalid-output');
        output = {
          narrativeResult: narrative || `*${npcName} waits for your next move.*`,
          stateDeltas: [],
          suggestedChips: [],
        };
      }

      // The streamed narrative is authoritative — the player already read it.
      output.narrativeResult = narrative || output.narrativeResult;

      // Validate and apply state deltas
      const validatedDeltas = this._validateAndApplyDeltas({
        deltas: output.stateDeltas,
        npcId: options.npcId,
      });
      output.stateDeltas = validatedDeltas;

      this.turnState = { kind: 'complete', text: output.narrativeResult };
      this._logTurnTime({ path: 'roll', ms: performance.now() - turnStart });
      return output;
    } catch (error) {
      this._logCallFailure({ path: 'roll', call: this._currentCallIndex, error });
      throw error;
    }
  }

  /**
   * Validates and applies state deltas proposed by the LLM.
   * Applied: inventory_grant/inventory_remove mutate the player inventory
   * (grants also advance completeOnItemPickup quest objectives), and
   * flag_set/flag_clear mutate the quest world-state flags.
   * Invalid deltas are silently dropped and logged.
   */
  private _validateAndApplyDeltas(options: {
    deltas: NpcStateDelta[];
    npcId: string;
  }): NpcStateDelta[] {
    const valid: NpcStateDelta[] = [];

    for (const delta of options.deltas) {
      switch (delta.kind) {
        case 'trust_change': {
          if (delta.value !== undefined && delta.value >= -10 && delta.value <= 10) {
            valid.push(delta);
          } else {
            this.warn('_validateAndApplyDeltas:invalid-trust', { delta });
          }
          break;
        }
        case 'flag_set': {
          if (delta.label && delta.label.length > 0) {
            if (questStateService.setWorldStateFlag(delta.label)) {
              valid.push(delta);
            } else {
              this.warn('_validateAndApplyDeltas:invalid-flag-name', { delta });
            }
          } else {
            this.warn('_validateAndApplyDeltas:invalid-flag', { delta });
          }
          break;
        }
        case 'flag_clear': {
          if (delta.label && delta.label.length > 0) {
            if (questStateService.clearWorldStateFlag(delta.label)) {
              valid.push(delta);
            } else {
              this.warn('_validateAndApplyDeltas:invalid-flag-name', { delta });
            }
          } else {
            this.warn('_validateAndApplyDeltas:invalid-flag', { delta });
          }
          break;
        }
        case 'inventory_grant': {
          if (delta.target && delta.target.length > 0) {
            // Bound the authored quantity to the [1, 99] range.
            const quantity = Math.min(99, Math.max(1, Math.round(delta.value ?? 1)));
            if (inventoryService.addItem({ itemId: delta.target, quantity })) {
              // Advance completeOnItemPickup quest objectives (e.g. the Ward Wand).
              questStateService.evaluateTriggers({
                type: 'ITEM_PICKED_UP',
                itemId: delta.target,
              });
              valid.push(delta);
            } else {
              this.warn('_validateAndApplyDeltas:inventory-grant-failed', { delta });
            }
          } else {
            this.warn('_validateAndApplyDeltas:invalid-inventory', { delta });
          }
          break;
        }
        case 'inventory_remove': {
          if (delta.target && delta.target.length > 0) {
            // Bound the authored quantity to the [1, 99] range.
            const quantity = Math.min(99, Math.max(1, Math.round(delta.value ?? 1)));
            if (inventoryService.removeItem({ itemId: delta.target, quantity })) {
              valid.push(delta);
            } else {
              this.warn('_validateAndApplyDeltas:inventory-remove-failed', { delta });
            }
          } else {
            this.warn('_validateAndApplyDeltas:invalid-inventory', { delta });
          }
          break;
        }
        case 'relationship_update': {
          if (delta.label && delta.label.length > 0) {
            valid.push(delta);
          } else {
            this.warn('_validateAndApplyDeltas:invalid-relationship', { delta });
          }
          break;
        }
        default: {
          this.warn('_validateAndApplyDeltas:unknown-kind', { delta });
          break;
        }
      }
    }

    return valid;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const npcDialogueService: NpcDialogueServiceInterface = NpcDialogueService.create({
  className: 'NpcDialogueService',
});

// ---------------------------------------------------------------------------
// Exported helpers for intent analysis (C-371) — shared with sandbox
// ---------------------------------------------------------------------------

/**
 * Builds the system prompt for the streamed intent-narrative call (call 1
 * of the C-401 split inside `_analyzeIntent`). Asks for plain prose — the
 * NPC's spoken response — never JSON, so tokens stream as readable text.
 * Exported for the dev sandbox's real-LLM path.
 */
export function buildIntentNarrativeSystemPrompt(): string {
  return [
    'You are a game master assistant analyzing player intent in an RPG dialogue.',
    "Given the player's message and NPC context, respond as the NPC.",
    "Write the NPC's spoken response — in FIRST-PERSON as the NPC speaking directly to the player.",
    '   Include actions in asterisks for flavor (e.g. *strokes beard* "Ah, a fine question!").',
    '   NEVER write third-person narration like "The elder considers your words."',
    '',
    'The response will be analyzed afterward for intent (skill check, quest acceptance),',
    'so naturally reflect what the player is attempting.',
    "Reply with the NPC's spoken narrative ONLY — plain prose, no JSON.",
  ].join('\n');
}

/**
 * Builds the system prompt for intent analysis (call #1).
 * Exported for use by dev sandbox and service internals.
 */
export function buildIntentAnalysisSystemPrompt(): string {
  return [
    'You are a game master assistant analyzing player intent in an RPG dialogue.',
    "Given the player's message and NPC context, determine:",
    '1. Whether this action requires a skill check (dice roll).',
    '2. If so, what skill to check, what difficulty class (5-20), and what stat modifier applies.',
    "3. The NPC's spoken response — write in FIRST-PERSON as the NPC speaking directly to the player.",
    '   Include actions in asterisks for flavor (e.g. *strokes beard* "Ah, a fine question!").',
    '   NEVER write third-person narration like "The elder considers your words."',
    '4. 0-4 contextual suggestion chips for the player.',
    '',
    'QUEST ACTIVATION TOOL:',
    '- The [GAME STATE] facts list quests this NPC can offer, e.g. "Offerable quests: "The Fading Ward" (id: fading_ward)".',
    '- When the player CLEARLY accepts an offered quest ("I will take the quest", "Consider it done", "I accept"):',
    '  set questActivation to { "action": "accept", "questId": "<id>" }.',
    '- When the player CLEARLY declines ("No thanks", "I cannot help"): set questActivation to',
    '  { "action": "decline", "questId": "<id>" }.',
    '- Only use questActivation for a quest listed as offerable by THIS NPC, and only when the',
    '  intent is unambiguous. Ordinary conversation about the quest leaves questActivation unset.',
    '- The narrative (npcResponse) should still acknowledge the acceptance/refusal in character.',
    '',
    'Be conservative: only require a roll when the player is clearly attempting',
    'persuasion, deception, intimidation, stealth, or another skill-based action.',
    'Everyday conversation does NOT need a roll.',
    '',
    'Respond with a JSON object matching the NpcIntentAnalysisOutput schema.',
  ].join('\n');
}

/**
 * Attempts to recover structured output from raw text when schema validation fails.
 * Handles fenced JSON, alternate narrative field names, chip extraction, and sanitization.
 * Throws if no meaningful narrative can be extracted.
 *
 * @param rawText - The raw text response from the LLM
 * @param schema - The expected TypeBox schema (for validation)
 * @returns Partial structured output with at least npcResponse and suggestedChips
 */
export function recoverIntentAnalysisOutput(
  rawText: string | undefined,
  _schema: typeof NpcIntentAnalysisOutputSchema,
): Pick<NpcIntentAnalysisOutput, 'npcResponse' | 'suggestedChips' | 'questActivation'> {
  let narrative = '';
  let chips: NpcSuggestionChip[] = [];
  let questActivation: NpcQuestActivation | undefined;

  if (!rawText) {
    throw new Error('No raw text to recover');
  }

  const trimmed = rawText.trim();

  // First attempt: parse as JSON (handle arrays and objects with/without fences)
  let parsed: unknown = null;
  try {
    // Remove code fences if present
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Not JSON — might be plain text
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // Try common field names for narrative - only accept runtime string values
    const npcResponse = obj.npcResponse;
    const narrativePreRoll = obj.narrative_pre_roll;
    const preRollNarrative = obj.pre_roll_narrative;
    const narrativeResult = obj.narrativeResult;
    const narrativeField = obj.narrative;
    const response = obj.response;

    narrative =
      (typeof npcResponse === 'string' ? npcResponse : '') ||
      (typeof narrativePreRoll === 'string' ? narrativePreRoll : '') ||
      (typeof preRollNarrative === 'string' ? preRollNarrative : '') ||
      (typeof narrativeResult === 'string' ? narrativeResult : '') ||
      (typeof narrativeField === 'string' ? narrativeField : '') ||
      (typeof response === 'string' ? response : '') ||
      '';

    // Try common field names for chips
    const rawChips = obj.suggestedChips || obj.suggestionChips || obj.chips;
    if (Array.isArray(rawChips)) {
      chips = rawChips
        .slice(0, 4)
        .map((c: unknown, i: number): NpcSuggestionChip | null => {
          if (typeof c === 'string') {
            // String chip: must have enough length for prefillText validation
            if (c.length < 10) {
              return null;
            }
            return { id: `chip${i}`, label: c, intentType: 'dialogue', prefillText: c };
          }
          if (typeof c === 'object' && c !== null) {
            const chipObj = c as Record<string, unknown>;
            const id = (chipObj.id as string) || `chip${i}`;
            const label = (chipObj.label as string) || String(c);
            const intentType =
              (chipObj.intentType as NpcSuggestionChip['intentType']) || 'dialogue';
            const prefillText =
              (chipObj.prefillText as string) || (chipObj.label as string) || String(c);

            // Reject chips with String(c) as label or prefillText (invalid object coercion)
            if (label === String(c) || prefillText === String(c)) {
              return null;
            }

            // Validate with schema
            const candidate = { id, label, intentType, prefillText };
            if (Value.Check(NpcSuggestionChipSchema, candidate)) {
              return candidate;
            }
          }
          return null;
        })
        .filter((c): c is NpcSuggestionChip => c !== null);
    }

    // Recover the quest-activation tool call from the raw JSON.
    const rawActivation = obj.questActivation;
    if (rawActivation && typeof rawActivation === 'object') {
      const candidate = {
        action: (rawActivation as Record<string, unknown>).action,
        questId: (rawActivation as Record<string, unknown>).questId,
      };
      if (Value.Check(NpcQuestActivationSchema, candidate)) {
        questActivation = candidate as NpcQuestActivation;
      }
    }
  } else {
    // Plain text (not JSON) — use directly as narrative
    narrative = trimmed;
  }

  // Reject if narrative is too short (schema requires minLength: 20) or not a string
  if (!narrative || typeof narrative !== 'string' || narrative.length < 20) {
    throw new Error('Recovered narrative does not satisfy minimum length requirement');
  }

  return {
    npcResponse: narrative,
    suggestedChips: chips,
    questActivation,
  };
}
