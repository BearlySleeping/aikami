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
  NpcRollResolutionInput,
  NpcRollResolutionOutput,
  NpcStateDelta,
  NpcSuggestionChip,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { FALLBACK_PERSONA_ID, PERSONA_PROMPTS } from '$lib/data/dialogue_personas';
import { questStateService } from '$services';

// ---------------------------------------------------------------------------
// Injected interfaces — all external dependencies passed through configure()
// ---------------------------------------------------------------------------

/** Content-pack data the orchestrator reads from (NPC entries, dialogues). */
export type NpcDialogueContentProvider = {
  /** Returns the NPC entry for a given NPC ID, or undefined. */
  getNpc(npcId: string):
    | {
        name: string;
        defaultDialogueKey?: string;
        isVendor?: boolean;
        vendorInventory?: string;
        combatStats?: Record<string, unknown>;
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
 */
export type NpcDialogueTextGenerator = (options: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema?: Record<string, unknown>;
  schemaName?: string;
  signal?: AbortSignal;
}) => Promise<{ text: string; structured?: unknown }>;

/**
 * Command executor callbacks — one per command kind.
 * Each is called after validation + precondition checks pass.
 * Implementations dispatch to existing executor services and return
 * true if the command was executed, false if denied at runtime.
 */
export type NpcDialogueExecutors = {
  trade(options: { npcId: string; vendorName?: string; vendorInventory?: string }): boolean;
  offerQuest(options: { npcId: string; questId: string }): boolean;
  skillCheck(options: { skill: string; difficultyClass: number }): boolean;
  giveItem(options: { itemId: string; quantity: number }): boolean;
  startCombat(options: { npcId: string; npcName: string; encounterId?: string }): boolean;
  recruit(options: { npcId: string; npcName: string }): boolean;
};

/** Context facts projected into the AI system prompt. */
export type DialogueContextProjection = {
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
// Fallback turn record — generated when the gateway has no text capability
// ---------------------------------------------------------------------------

type FallbackTurnRecord = {
  narrative: string;
  command?: NpcDialogueCommand;
  choices: NpcDialogueChoice[];
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type NpcDialogueServiceInterface = BaseFrontendClassInterface & {
  /** The currently active NPC being conversed with, if any. */
  readonly activeNpc:
    | { npcId: string; npcName: string; dialog?: string; personaId?: string }
    | undefined;

  /**
   * Configures the orchestrator with its required dependencies.
   * Must be called once before {@link generateTurn}.
   *
   * @param options.useFreeTextFirst — When true (default), the two-call
   *   pipeline (analyzeIntent → resolveRoll) is used. When false, the
   *   legacy single-call generateTurn path is used for backward compat.
   */
  configure(options: {
    contentProvider: NpcDialogueContentProvider;
    textGenerator: NpcDialogueTextGenerator;
    executors: NpcDialogueExecutors;
    useFreeTextFirst?: boolean;
  }): void;

  /**
   * Starts a dialogue session with the given NPC.
   * Called by the bridge listener on NPC_INTERACTED.
   */
  startDialogue(options: {
    npcData: { npcId: string; npcName: string; dialog?: string; personaId?: string };
    setOverlay: (type: string) => void;
    pauseEngine: () => void;
  }): void;

  /**
   * Ends the current dialogue session.
   * Called by the bridge listener on NPC_DIALOG_END.
   */
  endDialogue(options: { clearOverlay: () => void; resumeEngine: () => void }): void;

  /**
   * Configures the orchestrator with its required dependencies.
   * Must be called once before {@link generateTurn}.
   */
  configure(options: {
    contentProvider: NpcDialogueContentProvider;
    textGenerator: NpcDialogueTextGenerator;
    executors: NpcDialogueExecutors;
  }): void;

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
   *   Set `source` to `'authored'` when no AI capability is available.
   */
  generateTurn(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    /** Active encounter ID — restricts contextual dialogue resolution to this encounter only. */
    activeEncounterId?: string;
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
   * @returns Validated {@link NpcIntentAnalysisOutput} — either from AI
   *   or an authored/derived fallback when AI is unavailable.
   */
  analyzeIntent(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts?: string[];
    playerContext?: { character_sheet_summary: string; level: number; class_id: string };
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
  }): Promise<NpcRollResolutionOutput>;

  /** Whether the two-call free-text-first pipeline is active. */
  readonly useFreeTextFirst: boolean;
};

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

  /** Feature flag — when false, legacy action menu path is used (C-371). */
  private _useFreeTextFirst = true;

  /** Per-turn executed-command guard (keyed by turn message id). */
  private _executedCommands = new Map<string, NpcDialogueCommandKind>();

  /** Active generation AbortController — only one live at a time. */
  private _activeAbortController: AbortController | null = null;

  /** The currently active NPC, if any. */
  private _activeNpc:
    | { npcId: string; npcName: string; dialog?: string; personaId?: string }
    | undefined;

  /** @inheritdoc */
  get activeNpc():
    | { npcId: string; npcName: string; dialog?: string; personaId?: string }
    | undefined {
    return this._activeNpc;
  }

  /** @inheritdoc */
  startDialogue(options: {
    npcData: { npcId: string; npcName: string; dialog?: string; personaId?: string };
    setOverlay: (type: string) => void;
    pauseEngine: () => void;
  }): void {
    this._activeNpc = {
      npcId: options.npcData.npcId,
      npcName: options.npcData.npcName,
      dialog: options.npcData.dialog,
      personaId: options.npcData.personaId,
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
  }): void {
    this._contentProvider = options.contentProvider;
    this._textGenerator = options.textGenerator;
    this._executors = options.executors;
    this._useFreeTextFirst = options.useFreeTextFirst ?? true;
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
        });
        return aiTurn;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = message.includes('abort') ? 'cancelled' : 'generation_failed';
        this.warn('generateTurn:fallback-activated', { cause, detail: message });

        // ── Fallback to authored branch ─────────────────────────────
        return this._buildAuthoredTurn(turnCtx);
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
    playerContext?: { character_sheet_summary: string; level: number; class_id: string };
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
            character_sheet_summary: 'Level 1 Fighter',
            level: 1,
            class_id: 'fighter',
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = message.includes('abort') ? 'cancelled' : 'generation_failed';
        this.warn('analyzeIntent:fallback', { cause, detail: message });
        return this._deriveIntentFallback(options.npcName, allowedCommands);
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
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.warn('resolveRoll:fallback', { detail: message });
        return this._deriveRollFallback(options.outcome, options.checkType);
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
   * Streams narrative tokens; parses the structured command envelope
   * from the final result. Falls back to authored on any failure.
   */
  private async _generateAiTurn(options: {
    contextProjection: DialogueContextProjection;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    turnCtx?: TurnContext;
  }): Promise<NpcDialogueTurn> {
    const { contextProjection, messages, signal } = options;

    const systemPrompt = this._buildSystemPrompt(contextProjection);

    // Build adapter messages: system + conversation (bounded window)
    const conversationMessages = messages
      .slice(-20) // bounded memory window — last 20 turns max
      .map((m) => ({
        role: m.role === 'player' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }));

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
    ];

    try {
      // Generate with structured output schema for the command envelope.
      // The gateway streams onChunk for narrative, then returns the full
      // text + parsed structured object.
      const result = await this._textGenerator!({
        messages: adapterMessages,
        schema: NpcDialogueAiEnvelopeSchema as unknown as Record<string, unknown>,
        schemaName: 'NpcDialogueAiEnvelope',
        signal,
      });

      const narrative = result.text?.trim() || '';
      const rawEnvelope = result.structured;

      // ── Parse and validate the structured envelope ────────────────
      const parsedEnvelope = this._parseEnvelope(narrative, rawEnvelope);

      // ── Assemble the turn ─────────────────────────────────────────
      const finalNarrative = parsedEnvelope?.narrative || narrative;
      const command = parsedEnvelope?.command;
      let choices = parsedEnvelope?.choices ?? [];

      // Filter + cap choices (schema-bounded to 0–4)
      choices = this._filterChoices(choices);

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

      // Final validation — throw on failure so generateTurn activates authored fallback
      if (!Value.Check(NpcDialogueTurnSchema, turn)) {
        this.warn('_generateAiTurn:turn-validation-failed');
        throw new Error('AI generation produced invalid turn — falling back to authored');
      }

      return turn;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AI generation failed: ${message}`);
    }
  }

  // ── Private: authored fallback path ───────────────────────────────────

  /**
   * Builds a fully authored turn from the content pack.
   * Returns a turn even if the NPC has no authored dialogue (generic fallback).
   */
  private _buildAuthoredTurn(turnCtx: TurnContext): NpcDialogueTurn {
    const { npcEntry, npcId, npcName, contextualDialogueKey, allowedCommands } = turnCtx;

    // Resolve the authored dialogue key — three tiers:
    // 1. Contextual (quest/encounter) dialogue key
    // 2. NPC's defaultDialogueKey
    // 3. Generic fallback line
    let dialogueKey: string | undefined;
    let narrative = '';

    if (contextualDialogueKey) {
      const contextual = this._contentProvider!.getDialogue(contextualDialogueKey);
      if (contextual) {
        dialogueKey = contextualDialogueKey;
        narrative = contextual;
      }
    }

    if (!narrative) {
      const defaultKey = npcEntry?.defaultDialogueKey;
      if (defaultKey) {
        const defaultDialogue = this._contentProvider!.getDialogue(defaultKey);
        if (defaultDialogue) {
          dialogueKey = defaultKey;
          narrative = defaultDialogue;
        }
      }
    }

    if (!narrative) {
      // Last resort: generic authored line from persona
      narrative = this._genericFallbackLine(npcName);
    }

    const fallbackRecord: FallbackTurnRecord = {
      narrative,
      choices: [],
    };

    // Derive choices from NPC capabilities + related dialogue keys
    fallbackRecord.choices = this._deriveAuthoredChoices({
      npcEntry,
      npcId,
      currentDialogueKey: dialogueKey,
      allowedCommands,
      npcName,
    });

    // Build the validated turn
    const turn: NpcDialogueTurn = {
      narrative: fallbackRecord.narrative,
      command: fallbackRecord.command,
      choices: fallbackRecord.choices,
      source: 'authored',
    };

    return turn;
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

  /** Builds the full system prompt string from a context projection. */
  private _buildSystemPrompt(projection: DialogueContextProjection): string {
    const lines = [
      '[NPC CONTEXT]',
      projection.persona,
      `Your name is ${projection.npcName}.`,
      'Stay in character at all times. Respond as the NPC would.',
      '',
      'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
      'Do not break character. Do not mention being an AI.',
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
      `The NPC may perform these actions: ${projection.allowedCommands.join(', ') || 'none'}.`,
      'Only output actions from this list. Other actions will be ignored.',
    );

    // Add structured output instructions
    lines.push(
      '',
      '[OUTPUT FORMAT]',
      'You must output a JSON object with: "narrative" (string, required),',
      'optionally "command" (one of the allowed actions above),',
      'and optionally "choices" (array of player options, at most 4).',
      'Each choice has "id", "label", and optionally "command" or "nextDialogueKey".',
    );

    return lines.join('\n');
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

    // No active encounter — fall back to scanning all (legacy compat)
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

  /** Derives choices for authored fallback branches. */
  private _deriveAuthoredChoices(options: {
    npcEntry: ReturnType<NpcDialogueContentProvider['getNpc']>;
    npcId: string;
    currentDialogueKey?: string;
    allowedCommands: NpcDialogueCommandKind[];
    npcName: string;
  }): NpcDialogueChoice[] {
    const { allowedCommands, npcName } = options;
    const choices: NpcDialogueChoice[] = [];

    // Priority: quest > trade > talk > leave (cap at 4, stable order)

    // 1. Quest offers (if NPC has associated quest)
    const quests = this._contentProvider!.getAllQuests();
    if (quests.length > 0 && allowedCommands.includes('offerQuest')) {
      // Filter to quests associated with this NPC (if offeredByNpcId is set),
      // then filter to only offerable quests (not already active, completed, failed, or declined)
      const npcId = options.npcId;
      const offerableQuest = quests.find(
        (q) =>
          q &&
          // If quest has offeredByNpcId, only match the active NPC
          (!q.offeredByNpcId || q.offeredByNpcId === npcId) &&
          questStateService.canAcceptQuest(q.id),
      );
      if (offerableQuest) {
        choices.push({
          id: 'quest',
          label: `Ask about "${offerableQuest.name}"`,
          command: { kind: 'offerQuest', questId: offerableQuest.id },
        });
      }
    }

    // 2. Trade (if vendor)
    if (allowedCommands.includes('trade') && choices.length < 4) {
      choices.push({
        id: 'trade',
        label: `Trade with ${npcName}`,
        command: { kind: 'trade' },
      });
    }

    // 3. Talk more
    if (choices.length < 4) {
      choices.push({ id: 'talk', label: `Ask ${npcName} more` });
    }

    // 4. Leave
    if (choices.length < 4) {
      choices.push({ id: 'leave', label: 'Leave' });
    }

    return choices;
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
   * Call #1: Intent analysis — determines if a mechanical roll is needed.
   * Sends player text + NPC context + player context to the LLM.
   */
  private async _analyzeIntent(options: {
    npcName: string;
    allowedCommands: NpcDialogueCommandKind[];
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
    gameStateFacts: string[];
    playerContext: { character_sheet_summary: string; level: number; class_id: string };
  }): Promise<NpcIntentAnalysisOutput> {
    this.debug('_analyzeIntent:start');

    const { npcName, allowedCommands, messages, gameStateFacts, playerContext } = options;

    // Build the input for the LLM
    const input: NpcIntentAnalysisInput = {
      player_input: messages.filter((m) => m.role === 'player').pop()?.content ?? '',
      npc_context: {
        name: npcName,
        persona: `You are ${npcName}, a character in a fantasy world.`,
        allowed_commands: allowedCommands,
      },
      player_context: playerContext,
      recent_history: messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 200),
      })),
      game_state_facts: gameStateFacts,
    };

    // Build system prompt for intent analysis
    const systemPrompt = buildIntentAnalysisSystemPrompt();

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(input) },
    ];

    try {
      const result = await this._textGenerator!({
        messages: adapterMessages,
        schema: NpcIntentAnalysisOutputSchema as unknown as Record<string, unknown>,
        schemaName: 'NpcIntentAnalysisOutput',
        signal: options.signal,
      });

      const rawOutput = result.structured ?? {};

      // Validate against schema
      if (Value.Check(NpcIntentAnalysisOutputSchema, rawOutput)) {
        const output = rawOutput as NpcIntentAnalysisOutput;
        this.debug('_analyzeIntent:complete', {
          requires_roll: output.requires_roll,
          check_type: output.check_type,
          chip_count: output.suggested_chips.length,
        });
        return output;
      }

      // Repair attempt: salvage narrative from raw text using shared helper
      this.warn('_analyzeIntent:invalid-output');

      const recovered = recoverIntentAnalysisOutput(
        result.text?.trim(),
        NpcIntentAnalysisOutputSchema,
      );

      return {
        requires_roll: false,
        check_type: undefined,
        difficulty_class: undefined,
        modifier_source: undefined,
        npc_response: recovered.npc_response,
        suggested_chips: recovered.suggested_chips,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Intent analysis failed: ${msg}`);
    }
  }

  /**
   * Call #2: Roll resolution — sends dice outcome to LLM for narrative.
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
  }): Promise<NpcRollResolutionOutput> {
    this.debug('_resolveRoll:start', {
      checkType: options.checkType,
      dc: options.difficultyClass,
      outcome: options.outcome,
    });

    const { npcName, checkType, difficultyClass, rollTotal, outcome, playerInput } = options;

    const _input: NpcRollResolutionInput = {
      check_type: checkType,
      difficulty_class: difficultyClass,
      roll_total: rollTotal,
      outcome,
      player_input: playerInput,
    };

    const systemPrompt = [
      'You are a game master resolving a dice roll outcome in an RPG dialogue.',
      'Given the skill check result, write a narrative NPC response and propose',
      'any state changes (trust, flags, inventory).',
      '',
      'Respond with a JSON object matching the NpcRollResolutionOutput schema.',
    ].join('\n');

    const adapterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${npcName} resolves a ${checkType} check: DC=${difficultyClass}, Roll=${rollTotal}, ${outcome === 'pass' ? 'SUCCESS' : 'FAILURE'}. Player said: "${playerInput}"`,
      },
    ];

    try {
      const result = await this._textGenerator!({
        messages: adapterMessages,
        schema: NpcRollResolutionOutputSchema as unknown as Record<string, unknown>,
        schemaName: 'NpcRollResolutionOutput',
        signal: options.signal,
      });

      const rawOutput = result.structured ?? {};

      if (Value.Check(NpcRollResolutionOutputSchema, rawOutput)) {
        const output = rawOutput as NpcRollResolutionOutput;

        // Validate and apply state deltas
        const validatedDeltas = this._validateAndApplyDeltas({
          deltas: output.state_deltas,
          npcId: options.npcId,
        });
        output.state_deltas = validatedDeltas;

        this.debug('_resolveRoll:complete', {
          narrative_length: output.narrative_result.length,
          delta_count: validatedDeltas.length,
          chip_count: output.suggested_chips.length,
        });
        return output;
      }

      this.warn('_resolveRoll:invalid-output');
      return {
        narrative_result: result.text?.trim() || `*${npcName} waits for your next move.*`,
        state_deltas: [],
        suggested_chips: [],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Roll resolution failed: ${msg}`);
    }
  }

  /**
   * Validates and applies state deltas proposed by the LLM.
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
        case 'flag_set':
        case 'flag_clear': {
          if (delta.label && delta.label.length > 0) {
            valid.push(delta);
          } else {
            this.warn('_validateAndApplyDeltas:invalid-flag', { delta });
          }
          break;
        }
        case 'inventory_grant':
        case 'inventory_remove': {
          if (delta.target && delta.target.length > 0) {
            valid.push(delta);
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

  /**
   * Derives suggestion chips from authored dialogue + NPC capabilities
   * when AI is unavailable (fallback path).
   */
  private _deriveChips(options: {
    npcName: string;
    allowedCommands: NpcDialogueCommandKind[];
  }): NpcSuggestionChip[] {
    const { npcName, allowedCommands } = options;
    const chips: NpcSuggestionChip[] = [];

    // Derive chips from NPC capabilities
    if (allowedCommands.includes('trade')) {
      chips.push({
        id: 'trade',
        label: `Trade with ${npcName}`,
        intent_type: 'trade',
        prefill_text: `I'd like to see your wares.`,
      });
    }

    if (allowedCommands.includes('offerQuest')) {
      chips.push({
        id: 'ask_quest',
        label: 'Ask about work',
        intent_type: 'quest',
        prefill_text: `Do you have any work for me?`,
      });
    }

    // Always add a talk chip
    chips.push({
      id: 'talk',
      label: `Ask ${npcName} more`,
      intent_type: 'dialogue',
      prefill_text: `Tell me more.`,
    });

    // Always add a leave chip
    if (chips.length < 4) {
      chips.push({
        id: 'leave',
        label: 'Leave',
        intent_type: 'dialogue',
        prefill_text: `I must be going.`,
      });
    }

    return chips.slice(0, 4);
  }

  /**
   * Derives a fallback intent analysis output when AI is unavailable.
   */
  private _deriveIntentFallback(
    npcName: string,
    allowedCommands: NpcDialogueCommandKind[],
  ): NpcIntentAnalysisOutput {
    return {
      requires_roll: false,
      check_type: undefined,
      difficulty_class: undefined,
      modifier_source: undefined,
      npc_response: this._genericFallbackLine(npcName),
      suggested_chips: this._deriveChips({ npcName, allowedCommands }),
    };
  }

  /**
   * Derives a fallback roll resolution output when call #2 fails.
   */
  private _deriveRollFallback(
    outcome: 'pass' | 'fail',
    checkType: string,
  ): NpcRollResolutionOutput {
    const narrative =
      outcome === 'pass'
        ? `*The attempt at ${checkType} succeeds.*`
        : `*The attempt at ${checkType} falls short.*`;

    return {
      narrative_result: narrative,
      state_deltas: [],
      suggested_chips: [],
    };
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
 * @returns Partial structured output with at least npc_response and suggested_chips
 */
export function recoverIntentAnalysisOutput(
  rawText: string | undefined,
  _schema: typeof NpcIntentAnalysisOutputSchema,
): Pick<NpcIntentAnalysisOutput, 'npc_response' | 'suggested_chips'> {
  let narrative = '';
  let chips: NpcSuggestionChip[] = [];

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
    const npcResponse = obj.npc_response;
    const narrativePreRoll = obj.narrative_pre_roll;
    const preRollNarrative = obj.pre_roll_narrative;
    const narrativeResult = obj.narrative_result;
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
    const rawChips = obj.suggested_chips || obj.suggestion_chips || obj.chips;
    if (Array.isArray(rawChips)) {
      chips = rawChips
        .slice(0, 4)
        .map((c: unknown, i: number): NpcSuggestionChip | null => {
          if (typeof c === 'string') {
            // String chip: must have enough length for prefill_text validation
            if (c.length < 10) {
              return null;
            }
            return { id: `chip${i}`, label: c, intent_type: 'dialogue', prefill_text: c };
          }
          if (typeof c === 'object' && c !== null) {
            const obj = c as Record<string, unknown>;
            const id = (obj.id as string) || `chip${i}`;
            const label = (obj.label as string) || String(c);
            const intentType = (obj.intent_type as NpcSuggestionChip['intent_type']) || 'dialogue';
            const prefillText = (obj.prefill_text as string) || (obj.label as string) || String(c);

            // Reject chips with String(c) as label or prefill_text (invalid object coercion)
            if (label === String(c) || prefillText === String(c)) {
              return null;
            }

            // Validate with schema
            const candidate = { id, label, intent_type: intentType, prefill_text: prefillText };
            if (Value.Check(NpcSuggestionChipSchema, candidate)) {
              return candidate;
            }
          }
          return null;
        })
        .filter((c): c is NpcSuggestionChip => c !== null);
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
    npc_response: narrative,
    suggested_chips: chips,
  };
}
