// apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AudioTrackEntry } from '@aikami/schemas';
import type { CombatEngineKind, CombatState, GridPoint, IntentInterpreterResult, WorldGenOutput } from '@aikami/types';
import { DEFAULT_MOVEMENT_PER_TURN } from '@aikami/utils';
import {
  COMBAT_ACTION_SYSTEM_PROMPT,
  type CombatActionIntent,
  CombatActionSchema,
} from '$lib/data/ai_prompts/combat_action_schema';
import { resolveNpcAvatarUrl, resolvePlayerAvatarUrl } from '$lib/data/npc_avatar_catalog';
import type { ExpressionId } from '$types';
import {
  type CombatIntentFlow,
  type CombatIntentFlowBridge,
  createCombatIntentFlow,
} from './combat_intent_flow.svelte.ts';
import { buildOutcomeNarration } from './combat_narration.ts';
import type { CombatLogEntry, CombatLogServiceInterface } from './combat_log_service.svelte.ts';
import {
  type CombatSelectionBridge,
  type CombatSelectionController,
  createCombatSelectionController,
} from './combat_selection_controller.svelte.ts';
import type { StatusEffectsServiceInterface } from './status_effects_service.svelte.ts';
import type {
  CombatAbilityOption,
  CombatIntentDecisionState,
  CombatIntentPreview,
  CombatSelectionState,
} from './types/combat_direct_control.ts';
import type {
  DeathSaveState,
  DiceNotation,
  InitiativeEntry,
  QueuedRoll,
  StatusEffectDisplay,
  TurnState,
} from './types/combat_enhancements.ts';

// ---------------------------------------------------------------------------
// CombatViewModel — Svelte 5 ViewModel for the combat / turn-based battle UI
//
// Contract: C-145 Turn-Based Combat Loop
//
// Sends COMBAT_ACTION commands to the ECS engine via EngineBridge.send().
// Listens for COMBAT_LOG, COMBAT_STATE_UPDATE, and COMBAT_ENDED events
// to reactively update HP bars, battle log, and overlay state.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CombatLogEntry — structured combat log entry (C-165)
// ---------------------------------------------------------------------------

export type { CombatLogEntry } from './combat_log_service.svelte.ts';

// ── Module helpers ──────────────────────────────────────────────────────

/**
 * The target id in the form the ENGINE published it.
 *
 * Legacy ids are numeric eids; v2 ids are authored combatant ids. Coercing an
 * authored id to a number hands the kernel `NaN` and rejects every attack, so
 * only a genuinely numeric id is converted.
 */
const _engineTargetId = (targetId: string): string | number => {
  const numeric = Number(targetId);
  return Number.isNaN(numeric) ? targetId : numeric;
};

// ── Capability contracts ────────────────────────────────────────────────

/** Creates the engine bridge the ViewModel talks to (loaded lazily in production). */
export type CombatEngineCapabilities = {
  createBridge(): Promise<EngineBridge>;
};

/**
 * Natural-language intent capabilities (C-525).
 *
 * The ViewModel never reaches into the service registry: production wiring
 * injects the interpreter (model + deterministic fallback) and the feature
 * flag, so unit tests exercise the whole decision loop without a provider.
 */
export type CombatIntentCapabilities = {
  /** Kill switch (C-525 Migration & Rollback) — off means no language surface. */
  readonly enabled: boolean;
  /** Model interpretation with deterministic-parser fallback. */
  interpretWithFallback(request: {
    requestId: string;
    intentId: string;
    encounterId: string;
    actorId: string;
    basedOnRevision: number;
    text: string;
    state: CombatState;
  }): Promise<IntentInterpreterResult>;
  /** Cancels one outstanding interpretation by request id. */
  cancel(requestId: string): void;
};

/** The authored combatant id the v2 kernel knows the player by. */
const COMBAT_PLAYER_COMBATANT_ID = 'player';

/** Image-generation state and requests consumed by the combat view. */
export type CombatImageCapabilities = {
  readonly isGenerating: boolean;
  readonly generationStatus: string;
  readonly generationProgress: number;
  generateImage(options: { prompt: string }): Promise<{ url: string; isDemo: boolean }>;
};

/** LLM structured-output extraction used for freeform combat actions. */
export type CombatTextCapabilities = {
  extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
  }): Promise<unknown>;
};

/** Text-to-speech used for enemy taunts and gatekeeping narration. */
export type CombatTtsCapabilities = {
  synthesize(options: { text: string; voice: string }): Promise<void>;
};

/** Dice notation resolution for queued rolls. */
export type CombatDiceCapabilities = {
  rollNotation(options: { count: number; sides: number; label?: string }): number;
};

/** Static audio catalog + BGM playback used by the AI Director. */
export type CombatAudioCapabilities = {
  getTracksByMood(mood: string): Promise<readonly AudioTrackEntry[]>;
  resolveAudioTrackUrl(entry: AudioTrackEntry): Promise<string>;
  transitionToBgm(trackUrl: string, durationMs?: number): Promise<void>;
  playSceneBgm(scene: 'explore' | 'combat', durationMs?: number): Promise<void>;
};

/** LPC expression overlay resolution for portraits. */
export type CombatExpressionCapabilities = {
  resolveLpcOverlays(expressionId: ExpressionId): {
    readonly eyes?: string;
    readonly eyebrows?: string;
    readonly mouth?: string;
  };
};

/** Player identity fields the portrait reads. */
export type CombatPlayerStateCapabilities = {
  readonly classId: string;
};

/** Player inventory read by the character-sheet context builder. */
export type CombatInventoryCapabilities = {
  readonly inventory: ReadonlyArray<{ readonly itemId: string; readonly quantity: number }>;
};

/** World-generation state read by the character-sheet context builder. */
export type CombatWorldStateCapabilities = {
  readonly worldGenOutput: WorldGenOutput | undefined;
};

/** GM prompt assembly for world context injection. */
export type CombatWorldGenCapabilities = {
  assembleGmPrompt(options: { output: WorldGenOutput; playerGoals: string }): string;
};

/** Combat-log domain helpers. */
export type CombatLogCapabilities = Pick<
  CombatLogServiceInterface,
  'parseActor' | 'updateEntryImage'
>;

/** Status-effect + death-save domain helpers. */
export type CombatStatusEffectsCapabilities = Pick<
  StatusEffectsServiceInterface,
  | 'playerStatusEffects'
  | 'enemyStatusEffects'
  | 'deathSaveState'
  | 'isAnyEntityDowned'
  | 'reset'
  | 'applyStatus'
  | 'expireStatus'
  | 'setEntityDowned'
  | 'setDeathSave'
  | 'revive'
>;

/** Options accepted by callers of the production factory (no wiring). */
export type CombatViewModelPublicOptions = BaseViewModelOptions & {
  /**
   * Optional callback invoked when the user dismisses the battle result.
   * When provided, {@link dismissResult} calls this instead of just
   * clearing the result — allowing the parent to close the overlay.
   */
  onDismissOverlay?: () => void;
};

export type CombatViewModelOptions = CombatViewModelPublicOptions & {
  /** Engine bridge factory. */
  engine: CombatEngineCapabilities;
  /** Image generation state + requests. */
  images: CombatImageCapabilities;
  /** LLM structured-output extraction. */
  text: CombatTextCapabilities;
  /** Text-to-speech synthesis. */
  tts: CombatTtsCapabilities;
  /** Dice notation resolution. */
  dice: CombatDiceCapabilities;
  /** Audio catalog + BGM playback. */
  audio: CombatAudioCapabilities;
  /** LPC expression overlay resolution. */
  expressions: CombatExpressionCapabilities;
  /** Player identity state. */
  playerState: CombatPlayerStateCapabilities;
  /** Player inventory. */
  inventory: CombatInventoryCapabilities;
  /** World-generation state. */
  worldState: CombatWorldStateCapabilities;
  /** World-context GM prompt assembly. */
  worldGen: CombatWorldGenCapabilities;
  /** Combat-log domain helpers. */
  combatLog: CombatLogCapabilities;
  /** Status-effect + death-save domain helpers. */
  statusEffects: CombatStatusEffectsCapabilities;
  /**
   * Natural-language intent interpretation (C-525).
   *
   * Optional: absent means the language surface is off (a sandbox or a test
   * that does not exercise it), which is exactly what the kill switch does.
   */
  intent?: CombatIntentCapabilities;
};

export type CombatViewModelInterface = BaseViewModelInterface & {
  /**
   * All entity IDs currently alive and participating in the combat encounter.
   * Updated reactively via TURN_CHANGED and COMBAT_STARTED bridge events.
   */
  readonly activeEntities: number[];

  /**
   * The entity ID that currently has the active turn.
   * `null` when no combat encounter is in progress.
   */
  readonly currentTurnEntity: number | null;

  /**
   * Total number of entities participating in combat (alive + dead).
   * Only available after COMBAT_STARTED. Resets on COMBAT_ENDED.
   */
  readonly totalParticipants: number;

  /**
   * Number of entities still alive (health > 0).
   * Derived from activeEntities.length.
   */
  readonly aliveCount: number;

  /** Current player hit points. */
  readonly playerHp: number;

  /** Maximum player hit points. */
  readonly playerMaxHp: number;

  /** Current enemy hit points. */
  readonly enemyHp: number;

  /** Maximum enemy hit points. */
  readonly enemyMaxHp: number;

  /** Player's character level. */
  readonly playerLevel: number;

  /** Player's attack value. */
  readonly playerAttack: number;

  /** Player's defense value. */
  readonly playerDefense: number;

  /** Display name of the active enemy (e.g. "Goblin"). */
  readonly enemyName: string;

  /** Display name of the player. */
  readonly playerName: string;

  /** The entity ID of the current enemy target. */
  readonly enemyEntityId: number | null;

  /** Whether it's currently the player's turn in combat. */
  readonly isPlayerTurn: boolean;

  /** Portrait image URL for the player character. */
  readonly playerPortraitUrl: string;

  /** Portrait image URL for the enemy character. */
  readonly enemyPortraitUrl: string;

  /** Whether the player is currently taking damage (triggers CSS shake/flash). */
  readonly isPlayerTakingDamage: boolean;

  /** Whether the enemy is currently taking damage (triggers CSS shake/flash). */
  readonly isEnemyTakingDamage: boolean;

  /** Whether it's the player's active turn (for portrait highlight). */
  readonly isPlayerActiveTurn: boolean;

  /** Whether it's the enemy's active turn (for portrait highlight). */
  readonly isEnemyActiveTurn: boolean;

  /** Current expression for the player character. */
  readonly playerExpression: ExpressionId;

  /** Current expression for the enemy character. */
  readonly enemyExpression: ExpressionId;

  /** Player LPC eyes overlay source. */
  readonly playerEyesSrc: string | undefined;

  /** Player LPC eyebrows overlay source. */
  readonly playerEyebrowsSrc: string | undefined;

  /** Player LPC mouth overlay source. */
  readonly playerMouthSrc: string | undefined;

  /** Enemy LPC eyes overlay source. */
  readonly enemyEyesSrc: string | undefined;

  /** Enemy LPC eyebrows overlay source. */
  readonly enemyEyebrowsSrc: string | undefined;

  /** Enemy LPC mouth overlay source. */
  readonly enemyMouthSrc: string | undefined;

  /**
   * Ordered combat log entries — most recent first.
   * Each entry carries structured actor/action/outcome data and
   * an optional inline AI-generated image.
   *
   * Contract: C-165 Combat Inline Images & Gallery
   */
  readonly combatLog: readonly CombatLogEntry[];

  /**
   * All AI-generated image URLs produced during this combat encounter.
   * Used by the Gallery tab's masonry grid. Reset on COMBAT_STARTED.
   *
   * Contract: C-165 Combat Inline Images & Gallery
   */
  readonly encounterImages: readonly string[];

  /**
   * Battle outcome.
   * `null` while combat is ongoing; `'victory'` or `'defeat'` when ended.
   */
  readonly combatResult: 'victory' | 'defeat' | null;

  /** CSS class string for the battle result banner. */
  readonly combatResultBannerClass: string;

  /** Whether a combat encounter is currently in progress. */
  readonly inCombat: boolean;

  /**
   * Dismisses the battle result banner after combat ends.
   * Sets {@link combatResult} to null so the action buttons re-appear
   * (or the parent overlay can be dismissed).
   */
  dismissResult(): void;

  /** Dismisses the combat overlay when its backdrop is clicked. */
  handleBackdropClick(event: MouseEvent): void;

  /** Dismisses the combat overlay when Escape is pressed. */
  handleDialogKeyDown(event: KeyboardEvent): void;

  /** Whether the attack button should be disabled (waiting for engine response). */
  readonly isAttacking: boolean;

  /** Whether the AI is resolving a freeform custom action (disables all inputs). */
  readonly isResolvingAiAction: boolean;

  /**
   * Visual dice roll state for CSS-animated d20 component.
   * `null` when no dice roll is in progress or recently completed.
   *
   * Contract: C-148 Combat Immersion
   */
  readonly activeDiceRoll: {
    readonly value: number;
    readonly isRolling: boolean;
    readonly isSuccess: boolean;
  } | null;

  /**
   * Cinematic background image URL for the combat scene.
   * `null` when no image has been generated yet.
   *
   * Contract: C-148 Combat Immersion
   */
  readonly combatBackgroundImageUrl: string | null;

  /**
   * Executes a basic player attack via the engine bridge.
   *
   * Sends a COMBAT_ACTION(ATTACK) command to the ECS worker.
   * The engine processes the hit check, damage roll, enemy counter-
   * attack, and emits COMBAT_LOG + COMBAT_STATE_UPDATE events.
   */
  attack(): void;

  /**
   * Flees from combat via the engine bridge.
   *
   * Sends a COMBAT_ACTION(FLEE) command to the ECS worker.
   * The engine emits COMBAT_ENDED with victory=false.
   */
  flee(): void;

  /**
   * Defends — takes a defensive stance.
   *
   * Sends a COMBAT_ACTION(DEFEND) command to the ECS worker.
   * The engine processes the defense action and follows with an
   * enemy counter-attack.
   */
  defend(): void;

  /**
   * Executes a freeform custom combat action via AI interpretation.
   *
   * The player's natural-language prompt is sent to the TextGenerationService
   * which extracts a {@link CombatActionIntent} (actionType, advantage,
   * bonusDamage, narrative, generateImage, enemyQuote). The narrative is
   * appended to the combat log, image generation is optionally awaited
   * and displayed as a background, and the mapped COMBAT_ACTION command
   * is dispatched to the ECS engine.
   *
   * Contract: C-146 Freeform AI Combat Actions
   * Contract: C-148 Combat Immersion (image + voice)
   */
  executeCustomAction(prompt: string): Promise<void>;

  /**
   * Manually requests a cinematic scene image for the current combat state.
   * Uses the last combat log entry as the image prompt.
   *
   * Contract: C-148 Combat Immersion
   */
  generateSceneImage(): void;

  // C-234: Dice & Initiative
  // -----------------------------------------------------------------------

  /**
   * Queued dice rolls awaiting resolution.
   * Added via dice_quick_menu, resolved via resolveAllRolls().
   */
  readonly queuedRolls: QueuedRoll[];

  /**
   * All combatants in the current encounter, sorted by initiative.
   * Populated when combat starts, updated on turn changes.
   */
  readonly initiativeEntries: InitiativeEntry[];

  /**
   * Current turn state — which entity is acting, action economy, turn number.
   * `null` when no combat encounter is in progress.
   */
  readonly turnState: TurnState | null;

  /**
   * Queue a dice roll for later resolution.
   *
   * @param options - Dice notation and optional label.
   */
  queueRoll(options: { notation: DiceNotation; label?: string }): void;

  /**
   * Remove a queued dice roll by ID.
   *
   * @param rollId - The QueuedRoll ID to remove.
   */
  removeQueuedRoll(rollId: string): void;

  /**
   * Resolve (roll) all queued dice and append results to the combat log.
   */
  resolveAllRolls(): void;

  /**
   * End the current turn — advances initiative to the next combatant.
   * Dispatches END_TURN via the engine bridge.
   */
  endTurn(): void;

  /**
   * Direct-control selection projection (C-516 AC-7/AC-9).
   * Read-only: mutation happens through the `begin*`/`commit*` methods so the
   * preview correlation and revision binding stay in one place.
   */
  readonly combatSelection: CombatSelectionState;

  /** Abilities the player may pick, from the production catalog. */
  readonly availableAbilities: CombatAbilityOption[];

  /** Whether a preview round trip is outstanding. */
  readonly isSelectionLoading: boolean;

  /** Whether the player is picking a move destination (C-516 AC-8). */
  readonly isMoveSelection: boolean;

  /**
   * Whether the encounter runs on the v2 direct-control engine (C-525 R-2).
   *
   * During direct control the tactical world canvas is the interaction
   * surface, so the portrait stage must not occlude it.
   */
  readonly isDirectControl: boolean;

  /** Presentation projected for the move-selection button. */
  readonly moveButtonClasses: string;
  readonly moveButtonLabel: string;
  readonly isMoveButtonDisabled: boolean;

  /** CSS classes for an ability picker button, by ability id. */
  abilityButtonClasses(abilityId: string): string;

  /** CSS classes for a legal-target picker button, by combatant id. */
  targetButtonClasses(targetId: string): string;

  /** Rounded hit chance from the engine forecast, or `null` when absent. */
  readonly forecastHitPercentage: number | null;

  /** Whether the player is picking a target for the selected ability. */
  readonly isTargetSelection: boolean;

  /** Typed reason the engine rejected the last selection, or `null`. */
  readonly selectionRejection: string | null;

  /** Enters move selection and asks the engine for the reachable cells. */
  beginMoveSelection(): void;

  /** Opens or cancels move selection according to the current mode. */
  toggleMoveSelection(): void;

  /** Enters target selection for `abilityId` and asks for its legal targets. */
  beginAbilitySelection(abilityId: string): void;

  /** Selects an ability locally without a preview round trip. */
  selectAbility(abilityId: string | null): void;

  /** Picks a target for the current selection. */
  selectTarget(combatantId: string): void;

  /** Commits the current ability/attack selection. */
  commitSelection(): void;

  /**
   * Commits a budgeted move to `cell`.
   * A cell outside the reachable set does nothing (AC-8).
   */
  commitMoveToCell(cell: GridPoint): void;

  /** Clears the current selection and cancels any outstanding preview. */
  cancelSelection(): void;

  // ── C-525: natural-language intent + confirmation ────────────────────

  /** Whether the language surface is enabled (C-525 kill switch). */
  readonly languageInputEnabled: boolean;
  /** The current decision, projected for the sidebar. */
  readonly intentDecision: CombatIntentDecisionState;
  /** Whether the decision loop is waiting on the interpreter/compiler. */
  readonly isIntentPending: boolean;
  /** The compiled preview awaiting explicit confirmation, if any. */
  readonly intentPreview: CombatIntentPreview | null;
  /**
   * Submits player language. Never commits anything: it asks the engine for the
   * live state, interprets, compiles, and then either previews or clarifies.
   */
  submitLanguageIntent(text: string): void;
  /** Picks one clarification reading and moves to confirmation. */
  chooseIntentClarification(optionId: string): void;
  /** Commits the confirmed plan through the existing v2 command path. */
  confirmIntentPlan(): void;
  /** Cancels the outstanding decision — nothing is committed. */
  cancelIntentPlan(): void;

  // ── Image generation state (exposed from service) ──
  readonly isGeneratingImage: boolean;
  readonly generationStatus: string;
  readonly generationProgress: number;
};

/**
 * ViewModel for the combat UI route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 *
 * **Critical boundary rule**: This ViewModel NEVER imports PixiJS, bitECS,
 * or any game-internal types. All communication with the game engine goes
 * through the typed EngineBridge — specifically:
 * - Sending: COMBAT_ACTION command via bridge.send()
 * - Receiving: COMBAT_LOG, COMBAT_STATE_UPDATE, COMBAT_ENDED events
 */
export class CombatViewModel
  extends BaseViewModel<CombatViewModelOptions>
  implements CombatViewModelInterface
{
  // ── Image generation state (delegated from capability) ──
  get isGeneratingImage(): boolean {
    return this._images.isGenerating;
  }
  get generationStatus(): string {
    return this._images.generationStatus;
  }
  get generationProgress(): number {
    return this._images.generationProgress;
  }
  activeEntities: number[] = $state([]);

  currentTurnEntity: number | null = $state(null);

  /** Cached total from COMBAT_STARTED, reset on COMBAT_ENDED. */
  totalParticipants = $state(0);

  playerHp = $state(100);

  playerMaxHp = $state(100);

  enemyHp = $state(80);

  enemyMaxHp = $state(80);

  /** Player combat stats — synced from engine via bridge events or defaults. */
  playerLevel = $state(1);

  playerAttack = $state(5);

  playerDefense = $state(12);

  enemyName = $state('');

  /** NPC id of the enemy combatant — used to resolve the enemy portrait (C-500). */
  enemyNpcId = $state('');

  /** Display name for the player character. */
  playerName = $state('Player');

  /** The enemy entity ID set when combat starts. */
  enemyEntityId: number | null = $state(null);

  isPlayerTurn = $state(true);

  /** Portrait image URL for the player character — resolved via the asset manager (C-500). */
  get playerPortraitUrl(): string {
    return resolvePlayerAvatarUrl({ classId: this._playerState.classId });
  }

  /** Portrait image URL for the enemy character — resolved via the asset manager (C-500). */
  get enemyPortraitUrl(): string {
    return resolveNpcAvatarUrl({
      npcId: this.enemyNpcId,
      npcName: this.enemyName,
      expression: this.enemyExpression,
    });
  }

  /** Current expression for the player character. */
  playerExpression: ExpressionId = $state('neutral');

  /** Current expression for the enemy character. */
  enemyExpression: ExpressionId = $state('neutral');

  /** LPC expression overlay resolver for portrait overlays. */
  private readonly _expressionResolver: CombatExpressionCapabilities;

  /**
   * Player LPC eyes overlay source — derived from current player expression.
   */
  get playerEyesSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.playerExpression).eyes;
  }

  /**
   * Player LPC eyebrows overlay source.
   */
  get playerEyebrowsSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.playerExpression).eyebrows;
  }

  /**
   * Player LPC mouth overlay source.
   */
  get playerMouthSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.playerExpression).mouth;
  }

  /**
   * Enemy LPC eyes overlay source — derived from current enemy expression.
   */
  get enemyEyesSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.enemyExpression).eyes;
  }

  /**
   * Enemy LPC eyebrows overlay source.
   */
  get enemyEyebrowsSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.enemyExpression).eyebrows;
  }

  /**
   * Enemy LPC mouth overlay source.
   */
  get enemyMouthSrc(): string | undefined {
    return this._expressionResolver.resolveLpcOverlays(this.enemyExpression).mouth;
  }

  /** Whether the player is currently taking damage (triggers CSS shake/flash). */
  isPlayerTakingDamage = $state(false);

  /** Whether the enemy is currently taking damage (triggers CSS shake/flash). */
  isEnemyTakingDamage = $state(false);

  /** Whether we're waiting for the engine to resolve an attack. */
  isAttacking = $state(false);

  /** Whether the AI is resolving a freeform custom action. */
  isResolvingAiAction = $state(false);

  /**
   * Visual dice roll state — populated when a COMBAT_LOG event contains
   * a recognizable dice roll value (e.g., "Player rolls 17").
   * Set to `null` when idle.
   *
   * Contract: C-148 Combat Immersion
   */
  activeDiceRoll: {
    value: number;
    isRolling: boolean;
    isSuccess: boolean;
  } | null = $state(null);

  /** C-234: Queued dice rolls awaiting resolution. */
  queuedRolls: QueuedRoll[] = $state([]);

  /** C-234: Combatant initiative entries. */
  initiativeEntries: InitiativeEntry[] = $state([]);

  /** C-234: Current turn state. */
  turnState: TurnState | null = $state(null);

  /** Status-effect + death-save domain helpers. */
  private readonly _statusEffects: CombatStatusEffectsCapabilities;

  /** Natural-language decision loop + kill switch (C-525). */
  private readonly _intentFlow: CombatIntentFlow;

  /** C-165: Combat-log entry domain logic — owned by the composed sub-service (C-425). */
  private readonly _combatLog: CombatLogCapabilities;

  /** Engine bridge factory. */
  private readonly _engine: CombatEngineCapabilities;

  /** Image generation state + requests. */
  private readonly _images: CombatImageCapabilities;

  /** LLM structured-output extraction. */
  private readonly _text: CombatTextCapabilities;

  /** Text-to-speech synthesis. */
  private readonly _tts: CombatTtsCapabilities;

  /** Dice notation resolution. */
  private readonly _dice: CombatDiceCapabilities;

  /** Audio catalog + BGM playback. */
  private readonly _audio: CombatAudioCapabilities;

  /** Player identity state. */
  private readonly _playerState: CombatPlayerStateCapabilities;

  /** Player inventory. */
  private readonly _inventory: CombatInventoryCapabilities;

  /** World-generation state. */
  private readonly _worldState: CombatWorldStateCapabilities;

  /** World-context GM prompt assembly. */
  private readonly _worldGen: CombatWorldGenCapabilities;

  /** C-338: Active status effects on the player entity, keyed by effect ID. */
  get playerStatusEffects(): StatusEffectDisplay[] {
    return this._statusEffects.playerStatusEffects;
  }

  /** C-338: Active status effects on enemy entities, keyed by entity ID. */
  get enemyStatusEffects(): Record<number, StatusEffectDisplay[]> {
    return this._statusEffects.enemyStatusEffects;
  }

  /** C-338: Death save state for the player (null when not downed). */
  get deathSaveState(): DeathSaveState | null {
    return this._statusEffects.deathSaveState;
  }

  /** C-338: Whether any entity is currently downed. */
  get isAnyEntityDowned(): boolean {
    return this._statusEffects.isAnyEntityDowned;
  }

  constructor(options: CombatViewModelOptions) {
    super(options);
    this._engine = options.engine;
    this._images = options.images;
    this._text = options.text;
    this._tts = options.tts;
    this._dice = options.dice;
    this._audio = options.audio;
    this._expressionResolver = options.expressions;
    this._playerState = options.playerState;
    this._inventory = options.inventory;
    this._worldState = options.worldState;
    this._worldGen = options.worldGen;
    this._combatLog = options.combatLog;
    this._statusEffects = options.statusEffects;
    const intent = options.intent;
    this._selection = createCombatSelectionController({
      bridge: () => this._bridge as unknown as CombatSelectionBridge | undefined,
      readRevision: () => this._combatRevision,
      readEncounterId: () => this._encounterId,
      readEngine: () => this._combatEngine,
      isInCombat: () => this.inCombat,
      debug: (event, data) => {
        this.debug(event, data);
      },
    });
    this._intentFlow = createCombatIntentFlow({
      // Language input is a v2 surface: a legacy encounter keeps its existing
      // controls and prose flow (C-525 Scope Boundaries).
      isEnabled: () => (intent?.enabled ?? false) && this.isDirectControl,
      interpretWithFallback: (request) =>
        intent === undefined
          ? Promise.resolve({ ok: false, reason: 'unparseable' })
          : intent.interpretWithFallback(request),
      cancelRequest: (requestId) => {
        intent?.cancel(requestId);
      },
      bridge: () => this._bridge as unknown as CombatIntentFlowBridge | undefined,
      readRevision: () => this._combatRevision,
      readEncounterId: () => this._encounterId,
      actorId: COMBAT_PLAYER_COMBATANT_ID,
      readActorName: () => this.playerName || 'You',
      appendLog: (text) => {
        this._appendCombatLogEntry(text);
      },
      debug: (event, data) => {
        this.debug(event, data);
      },
    });
  }

  /** Timeout handle for clearing the active dice roll after animation. */
  private _diceTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Timeout handles for clearing damage flash states. */
  private _damageFlashTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Cinematic background image URL for the combat scene.
   * Updated when an AI-generated image completes or when the player
   * manually requests a scene generation.
   *
   * Contract: C-148 Combat Immersion
   */
  combatBackgroundImageUrl: string | null = $state(null);

  /**
   * Structured combat log entries — most recent first.
   * Replaces the old flat string[] format (C-165).
   */
  combatLog: CombatLogEntry[] = $state([]);

  /**
   * All AI-generated image URLs for this encounter.
   * Populated as async image generation completes.
   * Reset on COMBAT_STARTED.
   *
   * Contract: C-165 Combat Inline Images & Gallery
   */
  encounterImages: string[] = $state([]);

  combatResult: 'victory' | 'defeat' | null = $state(null);

  /**
   * Direct-control selection state (C-516 AC-7/AC-9) — a projection of what
   * the player has picked, never a second source of HP/turn truth.
   */
  /**
   * Direct-control selection state (C-516 AC-7/AC-9) — owned by the composed
   * selection controller (C-525 R-1); read through the `combatSelection` getter.
   */
  private readonly _selection: CombatSelectionController;

  /**
   * Natural-language decision state (C-525 AC-4/AC-5) — a projection of the
   * outstanding decision only; owned by the composed intent flow (R-1).
   */
  get intentDecision(): CombatIntentDecisionState {
    return this._intentFlow.decision;
  }

  /** The engine's last reported combat state revision; previews bind to it. */
  private _combatRevision = 0;

  /** The encounter id the engine reported; previews are bound to it. */
  private _encounterId = 'encounter';

  /**
   * The resolver this encounter was PINNED to at start (C-516 AC-1).
   *
   * Taken from `COMBAT_STARTED`, never from ambient config: an encounter never
   * changes engine mid-fight, and the `action` forecast query is v2-only.
   */
  private _combatEngine = $state<CombatEngineKind>('legacy');

  /**
   * Runtime eid the engine says the player owns (C-516 AC-5).
   *
   * The world assigns entity ids at spawn time, so the player is not always
   * entity 1; every turn/HP decision reads this instead of a literal.
   */
  private _playerEntityId = 1;

  /**
   * Keeps the last revision the engine told us about.
   *
   * Previews bind to this value, so a preview can never answer for a state the
   * client has already moved past. It only ever moves forward.
   */
  private _syncCombatRevision(revision: number | undefined): void {
    if (revision === undefined) {
      return;
    }
    if (revision <= this._combatRevision) {
      return;
    }
    this._combatRevision = revision;
    this._selection.invalidateOnRevision(revision);
    // A decision bound to the previous revision is stale: drop it, and cancel
    // any interpretation still in flight so a late answer cannot repaint it.
    this._intentFlow.invalidate(revision);
  }
  /** Monotonically increasing counter for CombatLogEntry IDs. */
  private _logEntryCounter = 0;

  /** Monotonically increasing counter for combat turn numbers. */
  private _turnCounter = 0;

  /** Derived count of alive entities. */
  get aliveCount(): number {
    return this.activeEntities.length;
  }

  /** Whether it's the player's active turn (for portrait highlight). */
  get isPlayerActiveTurn(): boolean {
    return this.isPlayerTurn && this.inCombat;
  }

  /** Whether it's the enemy's active turn (for portrait highlight). */
  get isEnemyActiveTurn(): boolean {
    return !this.isPlayerTurn && this.inCombat;
  }

  /** Whether a combat encounter is currently in progress. */
  get inCombat(): boolean {
    return this.currentTurnEntity !== null;
  }

  /** CSS class string for the battle result banner. */
  get combatResultBannerClass(): string {
    if (this.combatResult === 'victory') {
      return 'bg-success/20 text-success';
    }
    if (this.combatResult === 'defeat') {
      return 'bg-error/20 text-error';
    }
    return '';
  }

  /** @inheritdoc */
  dismissResult(): void {
    const onDismiss = (this as unknown as { _options?: CombatViewModelOptions })._options // guard-ignore lint/type-safety/casting: dev options or Record cast for internal combat state
      ?.onDismissOverlay;
    if (onDismiss) {
      this.combatResult = null;
      onDismiss();
      return;
    }
    this.combatResult = null;
  }

  /** @inheritdoc */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    this.dismissResult();
  }

  /** @inheritdoc */
  handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.dismissResult();
  }

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: EngineBridge | undefined;
  private _isEndTurnPending = false;
  /** Cleanup functions for bridge event listeners. */
  private _disposeListeners: Array<() => void> = [];

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      // The engine is heavy (PixiJS + ECS worker); the capability loads it
      // lazily in the composition so this module stays import-safe.
      this._bridge = await this._engine.createBridge();
      this._registerListeners();
    } catch (error) {
      this.debug('Failed to initialize combat bridge', error);
    }
  }

  /**
   * Registers bridge event listeners for combat-related events.
   *
   * All listeners are stored in _disposeListeners so they can be
   * cleanly removed in dispose().
   */
  private _registerListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    // The overlay is opened optimistically BEFORE the engine answers, so this
    // ViewModel can mount after `COMBAT_STARTED`/the opening `TURN_CHANGED` were
    // already emitted. Ask the engine to replay the live encounter state; it is
    // a no-op when no encounter is running (C-516 AC-5).
    bridge.send({ type: 'COMBAT_SYNC_REQUEST' });

    const removeTurnChanged = bridge.on('TURN_CHANGED', (event) => {
      this._isEndTurnPending = false;
      this._syncCombatRevision(event.stateRevision);
      // A selection belongs to the PLAYER's turn: only a turn change away from
      // the player invalidates it. Cancelling on every `TURN_CHANGED` also
      // discarded the preview reply that was already in flight for the player's
      // own turn, leaving the target list empty.
      if (this.combatSelection.mode !== 'idle' && event.currentEntityId !== this._playerEntityId) {
        this.cancelSelection();
      }
      this.activeEntities = event.activeEntities;
      this.currentTurnEntity = event.currentEntityId;

      // C-234: Update initiative entries for new turn
      const isPlayerEntity = event.currentEntityId === this._playerEntityId;
      this.initiativeEntries = this.initiativeEntries.map((e) => ({
        ...e,
        isCurrentTurn: e.entityId === event.currentEntityId,
      }));

      // C-234: Update turn state
      this.turnState = {
        currentEntityId: event.currentEntityId,
        currentEntityName: isPlayerEntity ? this.playerName : this.enemyName || 'Enemy',
        isPlayerTurn: isPlayerEntity,
        actionEconomy: {
          movementRemaining: DEFAULT_MOVEMENT_PER_TURN,
          actionAvailable: true,
          quickActionAvailable: true,
          bonusActionAvailable: true,
          reactionAvailable: true,
        },
        turnNumber: (this.turnState?.turnNumber ?? 0) + 1,
      };
      // C-338: Track turn number for log entries
      this._turnCounter = this.turnState?.turnNumber ?? 0;
    });

    const removeCommandRejected = bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
      this._selection.rejectCommand(event.reasonCode, event.messageKey);
      // R-5: a rejected v2 commit must also be visible on the language surface —
      // a decision the player just confirmed is exactly where the refusal lands.
      this._intentFlow.handleCommandRejected(event.messageKey);
    });

    // C-525: the composed controllers own their own bridge listeners — the
    // selection round trip and the language decision loop.
    this._disposeListeners.push(this._selection.attach(), this._intentFlow.attach());
    this._disposeListeners.push(removeCommandRejected);

    // C-525 AC-7: outcome narration is derived from the RESOLVED kernel events
    // (and the engine-resolved names) — never from the committed command and
    // never from the model. Attempt narration happens earlier, on confirm.
    const removeEventsResolved = bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
      const narration = buildOutcomeNarration({ events: event.events, names: event.names });
      if (narration.length > 0) {
        this._appendCombatLogEntry(narration);
      }
    });
    this._disposeListeners.push(removeEventsResolved);

    const removeCombatStarted = bridge.on('COMBAT_STARTED', (event) => {
      this.debug('COMBAT_STARTED received', {
        participantCount: event.participantIds.length,
        firstTurnId: event.firstTurnEntityId,
        enemyName: event.enemyName,
        enemyHp: event.enemyHp,
      });
      this.activeEntities = event.participantIds;
      this.currentTurnEntity = event.firstTurnEntityId;
      this.totalParticipants = event.participantIds.length;
      this._encounterId = event.encounterId ?? 'encounter';
      this._combatEngine = event.engine ?? 'legacy';
      this._playerEntityId = event.playerEntityId ?? 1;
      this._combatRevision = 0;
      this._intentFlow.reset();
      this._selection.reset();
      this.enemyName = event.enemyName || 'Unknown Enemy';
      this.enemyHp = event.enemyHp ?? 80;
      this.enemyMaxHp = event.enemyMaxHp ?? 80;
      this.enemyEntityId =
        event.enemyId ??
        event.participantIds.find((id: number) => id !== this._playerEntityId) ??
        null;
      this.isPlayerTurn = true;
      this.combatResult = null;
      this.combatLog = [];
      this.encounterImages = [];
      this.queuedRolls = [];
      this._turnCounter = 0;
      this.playerExpression = 'neutral';
      this.enemyExpression = 'neutral';

      // C-234: Build initiative entries from participant data
      const playerInit = Math.floor(Math.random() * 20) + 1;
      const enemyInit = Math.floor(Math.random() * 20) + 1;
      this.initiativeEntries = [
        {
          entityId: this._playerEntityId,
          name: this.playerName,
          initiative: playerInit,
          currentHp: this.playerHp,
          maxHp: this.playerMaxHp,
          isCurrentTurn: event.firstTurnEntityId === this._playerEntityId,
          isDefeated: false,
          statusEffectIds: [],
        },
        ...event.participantIds
          .filter((id: number) => id !== this._playerEntityId)
          .map((id: number, index: number) => ({
            entityId: id,
            name: index === 0 ? this.enemyName || 'Enemy' : `Entity #${id}`,
            initiative: index === 0 ? enemyInit : Math.floor(Math.random() * 20) + 1,
            currentHp: index === 0 ? this.enemyHp : 50,
            maxHp: index === 0 ? this.enemyMaxHp : 50,
            isCurrentTurn: event.firstTurnEntityId === id,
            isDefeated: false,
            statusEffectIds: [],
          })),
      ] as InitiativeEntry[];

      // C-234: Initialize turn state
      this.turnState = {
        currentEntityId: event.firstTurnEntityId,
        currentEntityName:
          event.firstTurnEntityId === this._playerEntityId
            ? this.playerName
            : this.enemyName || 'Enemy',
        isPlayerTurn: event.firstTurnEntityId === this._playerEntityId,
        actionEconomy: {
          movementRemaining: DEFAULT_MOVEMENT_PER_TURN,
          actionAvailable: true,
          quickActionAvailable: true,
          bonusActionAvailable: true,
          reactionAvailable: true,
        },
        turnNumber: 1,
      };

      // C-338: Reset status effects + death saves on combat start
      this._statusEffects.reset();
    });

    const removeCombatEnded = bridge.on('COMBAT_ENDED', (event) => {
      this._isEndTurnPending = false;
      this.debug('COMBAT_ENDED received', { victory: event.victory });
      if (event.victory) {
        this.combatResult = 'victory';
        this.playerExpression = 'happy';
        this.enemyExpression = 'pained';
      } else {
        this.combatResult = 'defeat';
        this.playerExpression = 'pained';
        this.enemyExpression = 'happy';
      }
      this.currentTurnEntity = null;
      this.isPlayerTurn = false;
      this.isAttacking = false;
      this.queuedRolls = [];

      // Mark defeated entries
      this.initiativeEntries = this.initiativeEntries.map((e) => ({
        ...e,
        isCurrentTurn: false,
        isDefeated: event.victory
          ? e.entityId !== this._playerEntityId // non-player entities defeated on victory
          : e.entityId === this._playerEntityId, // player defeated on defeat
      }));
      this.turnState = null;
    });

    const removeCombatLog = bridge.on('COMBAT_LOG', (event) => {
      this.debug('COMBAT_LOG received', {
        sourceId: event.sourceId,
        targetId: event.targetId,
        targetRemainingHp: event.targetRemainingHp,
        messageLength: event.message.length,
      });

      // Create a structured log entry from the engine's raw message (C-165)
      const actor = this._parseActorFromMessage(event.message);
      this._turnCounter++;
      const entry: CombatLogEntry = {
        id: `log-${++this._logEntryCounter}`,
        turnNumber: this._turnCounter,
        actor,
        actionText: event.message,
        outcomeText: '',
      };
      this.combatLog = [entry, ...this.combatLog];
      this.isAttacking = false;

      // Extract dice roll value for animated d20 component (C-148)
      this._triggerDiceRoll(event.message);

      // Update HP bars from the log event target data. The player routes by
      // the engine-reported `_playerEntityId`, never a literal.
      if (event.targetId === this._playerEntityId) {
        const prevPlayerHp = this.playerHp;
        this.playerHp = event.targetRemainingHp;
        this.playerMaxHp = event.targetMaxHp;
        // Trigger damage flash if player HP decreased
        if (event.targetRemainingHp < prevPlayerHp) {
          this._triggerDamageFlash('player');
          // Expression trigger: wounded on damage
          this.playerExpression = 'pained';
        }
      } else if (this.enemyEntityId !== null && event.targetId === this.enemyEntityId) {
        const prevEnemyHp = this.enemyHp;
        this.enemyHp = event.targetRemainingHp;
        this.enemyMaxHp = event.targetMaxHp;
        // Trigger damage flash if enemy HP decreased
        if (event.targetRemainingHp < prevEnemyHp) {
          this._triggerDamageFlash('enemy');
          // Expression trigger: wounded on damage
          this.enemyExpression = 'pained';
        }
      }
      this.initiativeEntries = this.initiativeEntries.map((initiativeEntry) =>
        initiativeEntry.entityId === event.targetId
          ? {
              ...initiativeEntry,
              currentHp: event.targetRemainingHp,
              maxHp: event.targetMaxHp,
              isDefeated: event.targetRemainingHp <= 0,
            }
          : initiativeEntry,
      );

      // Expression trigger: enraged on critical hit
      if (/critical/i.test(event.message)) {
        if (event.sourceId === this._playerEntityId) {
          this.playerExpression = 'determined';
        } else {
          this.enemyExpression = 'angry';
        }
      }

      // Expression trigger: fatal blow — pained on victim
      if (event.targetRemainingHp <= 0) {
        if (event.targetId === this._playerEntityId) {
          this.playerExpression = 'pained';
        } else if (this.enemyEntityId !== null && event.targetId === this.enemyEntityId) {
          this.enemyExpression = 'pained';
        }
      }
    });

    const removeCombatStateUpdate = bridge.on('COMBAT_STATE_UPDATE', (event) => {
      // Update player HP from the entity HP map.
      // Player and enemy route by the engine-reported entity ids, and every
      // OTHER participant (a v2 roster has allies and several enemies) updates
      // its initiative row — a 4-combatant fight must not fold everyone into
      // the player's HP bar.
      const hasInitiativeChange: number[] = [];
      for (const eid of Object.keys(event.entityHpMap)) {
        const numericEid = Number(eid);
        const hp = event.entityHpMap[numericEid];
        const maxHp = event.entityMaxHpMap[numericEid];
        if (numericEid === this._playerEntityId) {
          this.playerHp = hp ?? this.playerHp;
          this.playerMaxHp = maxHp ?? this.playerMaxHp;
        } else if (this.enemyEntityId !== null && numericEid === this.enemyEntityId) {
          this.enemyHp = hp ?? this.enemyHp;
          this.enemyMaxHp = maxHp ?? this.enemyMaxHp;
        }
        if (this.initiativeEntries.some((entry) => entry.entityId === numericEid)) {
          hasInitiativeChange.push(numericEid);
        }
      }
      if (hasInitiativeChange.length > 0) {
        this.initiativeEntries = this.initiativeEntries.map((entry) =>
          hasInitiativeChange.includes(entry.entityId)
            ? {
                ...entry,
                currentHp: event.entityHpMap[entry.entityId] ?? entry.currentHp,
                maxHp: event.entityMaxHpMap[entry.entityId] ?? entry.maxHp,
                isDefeated: (event.entityHpMap[entry.entityId] ?? entry.currentHp) <= 0,
              }
            : entry,
        );
      }
    });

    // ── C-338: New bridge events ──

    const removeStatusApplied = bridge.on('STATUS_APPLIED', (event) => {
      this.debug('STATUS_APPLIED', { effectId: event.effectId, targetId: event.targetId });
      this._statusEffects.applyStatus({
        effectId: event.effectId,
        targetId: event.targetId,
        duration: event.duration,
        sourceId: event.sourceId,
      });
    });

    const removeStatusExpired = bridge.on('STATUS_EXPIRED', (event) => {
      this.debug('STATUS_EXPIRED', { effectId: event.effectId, targetId: event.targetId });
      this._statusEffects.expireStatus(event.effectId, event.targetId);
    });

    const removeStatusTick = bridge.on('STATUS_TICK', (_event) => {
      // Status tick is handled by COMBAT_LOG entries; no additional UI state needed
    });

    const removeActionEconomyChanged = bridge.on('ACTION_ECONOMY_CHANGED', (event) => {
      this.debug('ACTION_ECONOMY_CHANGED', event);
      this._syncCombatRevision(event.stateRevision);
      if (this.turnState && event.entityId === this.turnState.currentEntityId) {
        this.turnState = {
          ...this.turnState,
          actionEconomy: {
            movementRemaining: event.movementRemaining,
            actionAvailable: event.actionAvailable,
            quickActionAvailable: event.quickActionAvailable,
            bonusActionAvailable: event.bonusActionAvailable,
            reactionAvailable: event.reactionAvailable,
          },
        };
      }
    });

    const removeEntityDowned = bridge.on('ENTITY_DOWNED', (event) => {
      this.debug('ENTITY_DOWNED', { entityId: event.entityId });
      this._statusEffects.setEntityDowned(event.entityId);
    });

    const removeDeathSaveRolled = bridge.on('DEATH_SAVE_ROLLED', (event) => {
      this.debug('DEATH_SAVE_ROLLED', event);
      this._statusEffects.setDeathSave(event.cumulativeSuccesses, event.cumulativeFailures);
    });

    const removeEntityRevived = bridge.on('ENTITY_REVIVED', (event) => {
      this.debug('ENTITY_REVIVED', event);
      this._statusEffects.revive(event.entityId);
    });

    this._disposeListeners.push(
      removeTurnChanged,
      removeCombatStarted,
      removeCombatEnded,
      removeCombatLog,
      removeCombatStateUpdate,
      removeStatusApplied,
      removeStatusExpired,
      removeStatusTick,
      removeActionEconomyChanged,
      removeEntityDowned,
      removeDeathSaveRolled,
      removeEntityRevived,
    );
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this._isEndTurnPending = false;
    // Unregister all bridge listeners (AC-3: cleanup)
    for (const cleanup of this._disposeListeners) {
      cleanup();
    }
    this._disposeListeners = [];

    // Clear pending dice animation timeout
    if (this._diceTimeout) {
      clearTimeout(this._diceTimeout);
      this._diceTimeout = null;
    }

    // Clear pending damage flash timeout
    if (this._damageFlashTimeout) {
      clearTimeout(this._damageFlashTimeout);
      this._damageFlashTimeout = null;
    }

    this._bridge = undefined;
    this.activeEntities = [];
    this.currentTurnEntity = null;
    this.totalParticipants = 0;
    this.playerHp = 100;
    this.playerMaxHp = 100;
    this.enemyHp = 80;
    this.enemyMaxHp = 80;
    this.enemyName = '';
    this.enemyNpcId = '';
    this.enemyEntityId = null;
    this.isPlayerTurn = true;
    this.isAttacking = false;
    this.isResolvingAiAction = false;
    this.activeDiceRoll = null;
    this.combatBackgroundImageUrl = null;
    this.isPlayerTakingDamage = false;
    this.isEnemyTakingDamage = false;
    this.playerExpression = 'neutral';
    this.enemyExpression = 'neutral';
    this.combatLog = [];
    this.encounterImages = [];
    this.combatResult = null;
    this.queuedRolls = [];
    this.initiativeEntries = [];
    this.turnState = null;
    // C-338: Reset status effects + death saves via the composed sub-service
    this._statusEffects.reset();
    this._logEntryCounter = 0;
    this._turnCounter = 0;

    await super.dispose();
  }

  // -----------------------------------------------------------------------
  // Custom action — AI-interpreted freeform combat (C-146)
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async executeCustomAction(prompt: string): Promise<void> {
    if (!this.inCombat || !this._bridge || this.isResolvingAiAction) {
      this.debug('executeCustomAction: blocked', {
        inCombat: this.inCombat,
        hasBridge: !!this._bridge,
        alreadyResolving: this.isResolvingAiAction,
      });
      return;
    }

    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      this.debug('executeCustomAction: empty prompt, skipping');
      return;
    }

    this.isResolvingAiAction = true;

    // ── Trigger attack animation on player sprite (C-166 AC-3) ──
    this._bridge?.send({ type: 'COMBAT_ACTION_ANIMATE' });

    this.debug('executeCustomAction: resolving', {
      promptLength: trimmed.length,
      promptPreview: trimmed.slice(0, 60),
      enemyName: this.enemyName,
      playerHp: `${this.playerHp}/${this.playerMaxHp}`,
      enemyHp: `${this.enemyHp}/${this.enemyMaxHp}`,
    });

    try {
      // Build contextual prompt with player stats, enemy info, and user input
      const characterSheet = this._buildCharacterSheetContext();
      const contextualPrompt = [
        characterSheet,
        `Enemy: ${this.enemyName} (HP: ${this.enemyHp}/${this.enemyMaxHp})`,
        `Player action: "${trimmed}"`,
      ].join('\n');

      this.debug('executeCustomAction: calling extractStructure', {
        schemaName: 'CombatActionIntent',
        contextualPromptLength: contextualPrompt.length,
      });

      // Extract structured combat intent from the LLM
      const raw = await this._text.extractStructure({
        schema: CombatActionSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: dev options or Record cast for internal combat state
        schemaName: 'CombatActionIntent',
        prompt: contextualPrompt,
        systemPrompt: COMBAT_ACTION_SYSTEM_PROMPT,
      });

      const intent = raw as CombatActionIntent;

      this.debug('executeCustomAction: LLM response', {
        actionType: intent.actionType,
        bonusDamage: intent.bonusDamage,
        advantage: intent.advantage,
        generateImage: intent.generateImage,
        actionValid: intent.actionValid,
        invalidReason: intent.invalidReason,
        narrativeLength: intent.narrative.length,
        narrativePreview: intent.narrative.slice(0, 80),
      });

      // Create a structured log entry for the DM narrative (C-165)
      const narrativeEntryId = `log-${++this._logEntryCounter}`;
      const narrativeEntry: CombatLogEntry = {
        id: narrativeEntryId,
        turnNumber: ++this._turnCounter,
        actor: 'Player',
        actionText: intent.narrative,
        outcomeText: '',
        isGeneratingImage: intent.generateImage === true,
      };
      this.combatLog = [narrativeEntry, ...this.combatLog];

      // ── Gatekeeping: reject impossible actions (C-149) ──
      if (intent.actionValid === false) {
        this.debug('executeCustomAction: gatekept — action rejected by DM', {
          invalidReason: intent.invalidReason,
        });
        // Append the invalid reason as an additional log entry for clarity
        if (intent.invalidReason) {
          const invalidEntry: CombatLogEntry = {
            id: `log-${++this._logEntryCounter}`,
            turnNumber: narrativeEntry.turnNumber,
            actor: 'DM',
            actionText: `🚫 ${intent.invalidReason}`,
            outcomeText: '',
          };
          this.combatLog = [invalidEntry, ...this.combatLog];
          // Synthesize the gatekeeping response via TTS for immersion
          void this._tts.synthesize({
            text: intent.invalidReason,
            voice: 'af_heart',
          });
        }
        // Do NOT dispatch COMBAT_ACTION — the player loses their action
        return;
      }

      // Enemy voice taunt — C-148 Combat Immersion
      if (intent.enemyQuote && intent.enemyQuote.trim().length > 0) {
        this.debug('executeCustomAction: enemy quote received', {
          quote: intent.enemyQuote,
          ttsStatus: 'would-speak',
        });
        // Log the voice pipeline: show what WOULD be spoken
        const ttsEntry: CombatLogEntry = {
          id: `log-${++this._logEntryCounter}`,
          turnNumber: narrativeEntry.turnNumber,
          actor: 'System',
          actionText: `🔊 TTS: ${this.enemyName} says "${intent.enemyQuote}"`,
          outcomeText: '',
        };
        this.combatLog = [ttsEntry, ...this.combatLog];
        // Append the quote to the battle log (italicized enemy dialogue)
        const quoteEntry: CombatLogEntry = {
          id: `log-${++this._logEntryCounter}`,
          turnNumber: narrativeEntry.turnNumber,
          actor: this.enemyName,
          actionText: `*${this.enemyName} ${intent.enemyQuote}*`,
          outcomeText: '',
        };
        this.combatLog = [quoteEntry, ...this.combatLog];
        // Synthesize via native Kokoro WebGPU TTS — fire-and-forget
        void this._tts.synthesize({
          text: intent.enemyQuote,
          voice: 'af_heart',
        });
      }

      // Fire image generation — wire result into log entry + gallery (C-148, C-165)
      if (intent.generateImage) {
        this.debug('executeCustomAction: generating scene image', {
          prompt: intent.narrative.slice(0, 60),
        });
        void this._images
          .generateImage({
            prompt: `Fantasy combat scene: ${intent.narrative}`,
          })
          .then((result) => {
            this.debug('executeCustomAction: image generated', {
              url: result.url,
              isDemo: result.isDemo,
            });
            this.combatBackgroundImageUrl = result.url;
            // Update the narrative entry's inline image (C-165)
            this._updateLogEntryImage(narrativeEntryId, result.url);
            // Add to encounter gallery (C-165)
            this.encounterImages = [...this.encounterImages, result.url];
          })
          .catch((error) => {
            this.warn('executeCustomAction: image generation failed', error);
            // Clear the isGeneratingImage flag on failure (C-165)
            this._updateLogEntryImage(narrativeEntryId, undefined);
          });
      }

      // ── AI Director: mood-driven BGM crossfade (C-151) ──
      if (intent.sceneMood && intent.sceneMood.trim().length > 0) {
        this.debug('executeCustomAction: sceneMood detected', {
          sceneMood: intent.sceneMood,
        });
        void this._transitionBgmByMood(intent.sceneMood.trim());
      }

      // C-489 AC-5: recompute model-proposed advantage/bonus from state. The
      // model's proposal is a request, not an input — the dispatched values are
      // derived from combat state, never forwarded verbatim (an unearned +10 or
      // fabricated advantage is ignored).
      const resolvedAdvantage = this._computeCombatAdvantage();
      const resolvedBonusDamage = this._computeCombatBonusDamage();
      this.debug('executeCustomAction: recomputed combat mechanics', {
        proposedAdvantage: intent.advantage,
        resolvedAdvantage,
        proposedBonusDamage: intent.bonusDamage,
        resolvedBonusDamage,
      });

      // Dispatch the mapped COMBAT_ACTION to the ECS engine
      this.isAttacking = true;
      this.debug('executeCustomAction: dispatching COMBAT_ACTION', {
        action: intent.actionType,
        targetId: this.enemyEntityId,
        advantage: resolvedAdvantage,
        bonusDamage: resolvedBonusDamage,
      });
      this._bridge.send({
        type: 'COMBAT_ACTION',
        action: intent.actionType,
        targetId: this.enemyEntityId ?? undefined,
        advantage: resolvedAdvantage,
        bonusDamage: resolvedBonusDamage,
      });
    } catch (error) {
      this.warn('executeCustomAction: failed', {
        error: (error as Error).message,
        promptPreview: trimmed.slice(0, 60),
      });
      const errorEntry: CombatLogEntry = {
        id: `log-${++this._logEntryCounter}`,
        turnNumber: this._turnCounter,
        actor: 'System',
        actionText: `[AI] Failed to interpret action: ${(error as Error).message}`,
        outcomeText: '',
      };
      this.combatLog = [errorEntry, ...this.combatLog];
    } finally {
      this.isResolvingAiAction = false;
      this.debug('executeCustomAction: resolved', { isResolvingAiAction: false });
    }
  }

  // -----------------------------------------------------------------------
  // Combat actions — bridge commands to ECS engine
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  attack(): void {
    if (!this.inCombat || !this._bridge || this.isAttacking) {
      this.debug('attack: blocked', {
        inCombat: this.inCombat,
        hasBridge: !!this._bridge,
        isAttacking: this.isAttacking,
      });
      return;
    }

    this.debug('attack: dispatching', { targetId: this.enemyEntityId });
    this.isAttacking = true;

    this._bridge.send({
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      targetId: this.enemyEntityId ?? undefined,
    });
  }

  /** @inheritdoc */
  flee(): void {
    if (!this.inCombat || !this._bridge) {
      this.debug('flee: blocked', {
        inCombat: this.inCombat,
        hasBridge: !!this._bridge,
      });
      return;
    }

    this.debug('flee: dispatching');
    this.isAttacking = true;

    this._bridge.send({
      type: 'COMBAT_ACTION',
      action: 'FLEE',
    });
  }

  /** @inheritdoc */
  defend(): void {
    if (!this.inCombat || !this._bridge || this.isAttacking) {
      this.debug('defend: blocked', {
        inCombat: this.inCombat,
        hasBridge: !!this._bridge,
        isAttacking: this.isAttacking,
      });
      return;
    }

    this.debug('defend: dispatching');
    this.isAttacking = true;

    this._bridge.send({
      type: 'COMBAT_ACTION',
      action: 'DEFEND',
    });
  }

  // C-234: Dice & Initiative
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  queueRoll(options: { notation: DiceNotation; label?: string }): void {
    this.debug('queueRoll', { notation: options.notation, label: options.label });
    const roll: QueuedRoll = {
      id: `queued-${++this._logEntryCounter}`,
      notation: options.notation,
      label: options.label ?? options.notation.label,
      timestamp: Date.now(),
    };
    this.queuedRolls = [...this.queuedRolls, roll];
  }

  /** @inheritdoc */
  removeQueuedRoll(rollId: string): void {
    this.debug('removeQueuedRoll', { rollId });
    this.queuedRolls = this.queuedRolls.filter((r) => r.id !== rollId);
  }

  /** @inheritdoc */
  resolveAllRolls(): void {
    this.debug('resolveAllRolls', { count: this.queuedRolls.length });

    if (this.queuedRolls.length === 0) {
      return;
    }

    // Roll each queued dice, append results to log
    const results: string[] = [];
    const resolved: QueuedRoll[] = [];

    for (const roll of this.queuedRolls) {
      const total = this._dice.rollNotation({
        count: roll.notation.count,
        sides: roll.notation.sides,
        label: roll.notation.label,
      });
      const rollLabel =
        roll.label !== roll.notation.label
          ? `${roll.label} (${roll.notation.label})`
          : roll.notation.label;
      results.push(`🎲 ${rollLabel}: ${total}`);
      resolved.push({ ...roll, result: total });
    }

    // Clear queue
    this.queuedRolls = [];

    // Append combined result to combat log
    const resultText = results.join(' | ');
    this.combatLog = [
      {
        id: `log-${++this._logEntryCounter}`,
        turnNumber: this._turnCounter,
        actor: 'System',
        actionText: `🎲 Dice Roll — ${resultText}`,
        outcomeText: '',
      },
      ...this.combatLog,
    ];
  }

  // -----------------------------------------------------------------------
  // Direct-control selection — delegated to the composed controller (C-525 R-1)
  // -----------------------------------------------------------------------

  /** The player's current selection, owned by the selection controller. */
  get combatSelection(): CombatSelectionState {
    return this._selection.selection;
  }

  /** @inheritdoc */
  get availableAbilities(): CombatAbilityOption[] {
    return this._selection.availableAbilities;
  }

  /** @inheritdoc */
  get isSelectionLoading(): boolean {
    return this._selection.isLoading;
  }

  /** @inheritdoc */
  get isMoveSelection(): boolean {
    return this._selection.isMoveSelection;
  }

  /** Whether the encounter runs on the v2 direct-control engine (C-525 R-2). */
  get isDirectControl(): boolean {
    return this._combatEngine === 'v2';
  }

  /** @inheritdoc */
  get moveButtonClasses(): string {
    return this._selection.moveButtonClasses;
  }

  /** @inheritdoc */
  get moveButtonLabel(): string {
    return this._selection.moveButtonLabel;
  }

  /** @inheritdoc */
  get isMoveButtonDisabled(): boolean {
    return this._selection.isMoveButtonDisabled;
  }

  /** @inheritdoc */
  abilityButtonClasses(abilityId: string): string {
    return this._selection.abilityButtonClasses(abilityId);
  }

  /** @inheritdoc */
  targetButtonClasses(targetId: string): string {
    return this._selection.targetButtonClasses(targetId);
  }

  /** @inheritdoc */
  get forecastHitPercentage(): number | null {
    return this._selection.forecastHitPercentage;
  }

  /** @inheritdoc */
  get isTargetSelection(): boolean {
    return this._selection.isTargetSelection;
  }

  /** @inheritdoc */
  get selectionRejection(): string | null {
    return this._selection.rejection;
  }

  /** @inheritdoc */
  beginMoveSelection(): void {
    this._selection.beginMoveSelection();
  }

  /** @inheritdoc */
  toggleMoveSelection(): void {
    this._selection.toggleMoveSelection();
  }

  /** @inheritdoc */
  beginAbilitySelection(abilityId: string): void {
    this._selection.beginAbilitySelection(abilityId);
  }

  /** @inheritdoc */
  cancelSelection(): void {
    this._selection.cancel();
  }

  /** @inheritdoc */
  commitSelection(): void {
    this._selection.commit();
  }

  /** @inheritdoc */
  selectTarget(combatantId: string): void {
    this._selection.selectTarget(combatantId);
  }

  /** @inheritdoc */
  selectAbility(abilityId: string | null): void {
    this._selection.selectAbility(abilityId);
  }

  /** @inheritdoc */
  commitMoveToCell(cell: GridPoint): void {
    this._selection.commitMoveToCell(cell);
  }
  /** Ends the turn after clearing any in-flight selection. */
  endTurn(): void {
    if (!this.inCombat) {
      this.debug('endTurn: blocked — no combat in progress');
      return;
    }
    if (!this._bridge) {
      this.debug('endTurn: blocked — no bridge');
      return;
    }
    if (this._isEndTurnPending) {
      return;
    }
    this._isEndTurnPending = true;
    this.debug('endTurn: sending COMBAT_END_TURN');
    this._bridge.send({ type: 'COMBAT_END_TURN' });
  }

  // ── C-525: natural-language intent + confirmation (delegation) ──────────
  //
  // The decision loop lives in the composed `CombatIntentFlow` (R-1); the
  // ViewModel only exposes it. Nothing here commits: `confirmIntentPlan` is the
  // single path to the kernel and it is only reachable from an explicit
  // confirmation of a compiled plan.

  /** @inheritdoc */
  get languageInputEnabled(): boolean {
    return this._intentFlow.enabled;
  }

  /** @inheritdoc */
  get isIntentPending(): boolean {
    return this._intentFlow.isPending;
  }

  /** @inheritdoc */
  get intentPreview(): CombatIntentPreview | null {
    return this._intentFlow.preview;
  }

  /** @inheritdoc */
  submitLanguageIntent(text: string): void {
    this._intentFlow.submit(text);
  }

  /** @inheritdoc */
  chooseIntentClarification(optionId: string): void {
    this._intentFlow.chooseClarification(optionId);
  }

  /** @inheritdoc */
  confirmIntentPlan(): void {
    this._intentFlow.confirm();
  }

  /** @inheritdoc */
  cancelIntentPlan(): void {
    this._intentFlow.cancel();
  }

  /** Appends one narration entry to the combat log. */
  private _appendCombatLogEntry(actionText: string): void {
    const entry: CombatLogEntry = {
      id: `log-${++this._logEntryCounter}`,
      turnNumber: this._turnCounter,
      actor: 'You',
      actionText,
      outcomeText: '',
    };
    this.combatLog = [entry, ...this.combatLog];
  }

  /** @inheritdoc */
  generateSceneImage(): void {
    if (!this.inCombat) {
      this.debug('generateSceneImage: blocked — no combat in progress');
      return;
    }

    const lastLogEntry = this.combatLog[0];
    const prompt = lastLogEntry
      ? `Fantasy combat scene — ${this.enemyName} battle: ${lastLogEntry.actionText}`
      : `Fantasy combat scene against a fearsome ${this.enemyName}`;

    this.debug('generateSceneImage: requesting', {
      promptPreview: prompt.slice(0, 60),
      hasLastLog: !!lastLogEntry,
    });

    void this._images
      .generateImage({ prompt })
      .then((result) => {
        this.debug('generateSceneImage: complete', {
          url: result.url,
          isDemo: result.isDemo,
        });
        this.combatBackgroundImageUrl = result.url;
        // Add to encounter gallery (C-165)
        this.encounterImages = [...this.encounterImages, result.url];
      })
      .catch((error) => {
        this.warn('generateSceneImage: failed', error);
      });
  }

  // -----------------------------------------------------------------------
  // Private — combat log helpers (C-165)
  // -----------------------------------------------------------------------

  /**
   * Parses the actor name from a COMBAT_LOG engine message.
   * Messages from the engine follow the pattern "Player rolls..." or
   * "Enemy attacks...". Fallback to "System" if unrecognized.
   */
  private _parseActorFromMessage(message: string): string {
    return this._combatLog.parseActor(message, this.enemyName);
  }

  /**
   * Updates the inline image URL on a combat log entry.
   *
   * Finds the entry by ID and replaces it in the reactive array with a new
   * object carrying the updated imageUrl (or clearing isGeneratingImage).
   * If the ID is not found, the method is a no-op.
   *
   * @param entryId - The CombatLogEntry ID to update.
   * @param imageUrl - The new image URL, or `undefined` to clear
   *   `isGeneratingImage` without setting an image.
   */
  private _updateLogEntryImage(entryId: string, imageUrl: string | undefined): void {
    this.combatLog = this._combatLog.updateEntryImage(this.combatLog, entryId, imageUrl);
  }

  // -----------------------------------------------------------------------
  // Private — character sheet context builder (C-149)
  // -----------------------------------------------------------------------

  /**
   * Builds a serialized character sheet string for the LLM system prompt.
   *
   * Pulls the player's current state — inventory from GameStateService,
   * HP/level/attack/defense from this ViewModel's reactive state — and
   * formats it as a clean text block. This tells the AI exactly what the
   * player is capable of, enabling gatekeeping of impossible freeform
   * actions (e.g., using items they don't have).
   *
   * @returns A formatted multi-line string describing the player's current state.
   */
  /**
   * C-489 AC-5: derive combat advantage from state, never from the model's
   * proposal. Advantage applies when the enemy is wounded to half HP or below;
   * otherwise the world does not grant it, however the model narrates it.
   */
  private _computeCombatAdvantage(): boolean {
    if (this.enemyMaxHp > 0) {
      return this.enemyHp <= this.enemyMaxHp * 0.5;
    }
    return false;
  }

  /**
   * C-489 AC-5: derive bonus damage from the player's attack stat, treating the
   * model's +N as a request never granted verbatim. Deterministic and local.
   */
  private _computeCombatBonusDamage(): number {
    return Math.max(0, Math.floor(this.playerAttack / 2));
  }

  private _buildCharacterSheetContext(): string {
    const inventory = this._inventory.inventory;
    const inventoryLines =
      inventory.length > 0
        ? inventory.map((item) => `  - ${item.itemId} x${item.quantity}`).join('\n')
        : '  (empty)';

    const lines = [
      '--- Player Character Sheet ---',
      `Level: ${this.playerLevel}`,
      `HP: ${this.playerHp}/${this.playerMaxHp}`,
      `Attack: ${this.playerAttack}`,
      `Defense: ${this.playerDefense}`,
      'Inventory:',
      inventoryLines,
      '--- End Character Sheet ---',
    ];

    // Inject world generation context (C-233)
    const worldGen = this._worldState.worldGenOutput;
    if (worldGen && Array.isArray(worldGen.npcs) && worldGen.npcs.length > 0) {
      const gmPrompt = this._worldGen.assembleGmPrompt({
        output: worldGen,
        playerGoals: `Explore the world of ${worldGen.worldName}.`,
      });
      lines.push('', '--- World Context ---', gmPrompt, '--- End World Context ---');
    }

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Private — AI Director: mood-driven BGM crossfade (C-151)
  // -----------------------------------------------------------------------

  /**
   * Resolves audio tracks matching a scene mood from the static catalog
   * and triggers an equal-power BGM crossfade via {@link audioService}.
   *
   * The catalog is a synchronous in-memory map read after first load
   * (C-385 AC-3) — no per-combat network request. Picks a random track
   * from matching results for variety. Unknown moods degrade to a
   * documented fallback track inside the catalog resolver; a failed
   * transition falls back to scene-based BGM resolution.
   *
   * Fire-and-forget — errors are logged but never propagated to the UI.
   *
   * @param mood - Musical mood tag (e.g. 'epic', 'tense', 'triumph').
   *
   * Contract: C-151 AI Dynamic Music, C-385 AC-3
   */
  private async _transitionBgmByMood(mood: string): Promise<void> {
    try {
      const tracks = await this._audio.getTracksByMood(mood);
      const selected = tracks[Math.floor(Math.random() * tracks.length)];
      if (!selected) {
        return;
      }

      const url = await this._audio.resolveAudioTrackUrl(selected);

      this.debug('_transitionBgmByMood: crossfading', {
        mood,
        track: selected.title,
        url,
        availableTracks: tracks.length,
      });

      await this._audio.transitionToBgm(url, 2000);
    } catch (error) {
      // Catalog or playback failure — fall back to scene-based resolution
      this.debug('_transitionBgmByMood: transition failed, using scene fallback', {
        mood,
        error: (error as Error).message,
      });
      await this._transitionBgmFallback(mood);
    }
  }

  /**
   * Fallback BGM resolution for when the audio catalog transition fails
   * or the requested mood cannot be resolved.
   *
   * Resolves through the manifest-backed audio resolver (C-372) instead
   * of legacy /assets/audio/* URLs. Routes through playSceneBgm's recency
   * guard to serialize transitions.
   *
   * @param mood - Musical mood tag.
   */
  private async _transitionBgmFallback(mood: string): Promise<void> {
    const combatMoods = new Set(['epic', 'heroic', 'tense', 'foreboding']);
    const normalizedMood = mood.toLowerCase();
    const scene = combatMoods.has(normalizedMood) ? 'combat' : 'explore';

    this.debug('_transitionBgmFallback', { mood, normalizedMood, scene });

    try {
      await this._audio.playSceneBgm(scene, 2000);
    } catch (error) {
      this.warn('_transitionBgmFallback: transition failed', error);
    }
  }

  // -----------------------------------------------------------------------
  // Private — damage flash trigger (C-167)
  // -----------------------------------------------------------------------

  /**
   * Triggers a CSS damage flash animation on the specified combatant's portrait.
   *
   * Sets {@link isPlayerTakingDamage} or {@link isEnemyTakingDamage} to `true`
   * for 400ms (slightly longer than the 350ms CSS animation to ensure it
   * completes), then resets to `false`.
   *
   * Debounces — if a damage flash is already active for this combatant,
   * the timeout is reset so rapid hits extend the animation.
   *
   * @param target - 'player' or 'enemy' portrait to flash.
   */
  private _triggerDamageFlash(target: 'player' | 'enemy'): void {
    if (target === 'player') {
      this.isPlayerTakingDamage = true;
    } else {
      this.isEnemyTakingDamage = true;
    }

    if (this._damageFlashTimeout) {
      clearTimeout(this._damageFlashTimeout);
    }

    this._damageFlashTimeout = setTimeout(() => {
      this.isPlayerTakingDamage = false;
      this.isEnemyTakingDamage = false;
      this._damageFlashTimeout = null;
    }, 400);
  }

  // -----------------------------------------------------------------------
  // Private — dice roll animation trigger (C-148 Combat Immersion)
  // -----------------------------------------------------------------------

  /**
   * Extracts a d20 roll value from a COMBAT_LOG message and triggers
   * the animated dice component.
   *
   * The engine emits messages like "Player rolls 17 (+4 = 21) to hit."
   * or "Enemy rolls 5 (+3 = 8) vs Evasion 12 — Miss!".
   * This method parses the roll value, sets {@link activeDiceRoll} with
   * `isRolling: true`, then resolves the animation after ~1.5 seconds.
   *
   * Detects success/failure by checking for "Miss!" in the message.
   * If no dice pattern is found, the method is a no-op.
   */
  private _triggerDiceRoll(message: string): void {
    // Clear any pending dice timeout
    if (this._diceTimeout) {
      clearTimeout(this._diceTimeout);
      this._diceTimeout = null;
    }

    // Parse the dice roll: "Player rolls 17" or "Enemy rolls 5"
    const diceMatch = message.match(/(?:Player|Enemy) rolls (\d+)/);
    if (!diceMatch) {
      return;
    }

    const value = Number.parseInt(diceMatch[1], 10);
    if (Number.isNaN(value) || value < 1 || value > 20) {
      return;
    }

    const isSuccess = !message.includes('Miss!');

    this.debug('_triggerDiceRoll', { value, isSuccess, messagePreview: message.slice(0, 60) });

    // Start the rolling animation
    this.activeDiceRoll = { value, isRolling: true, isSuccess };

    // After ~1.5 seconds, reveal the final result
    this._diceTimeout = setTimeout(() => {
      this.activeDiceRoll = { value, isRolling: false, isSuccess };
      // After another ~1.5s, clear the dice entirely
      this._diceTimeout = setTimeout(() => {
        this.activeDiceRoll = null;
        this._diceTimeout = null;
      }, 1500);
    }, 1500);
  }
}

/**
 * Builds a CombatViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getCombatViewModel` in ./combat_composition.ts.
 */
export const createCombatViewModel = (options: CombatViewModelOptions): CombatViewModelInterface =>
  CombatViewModel.create(options);
