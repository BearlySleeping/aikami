// apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts

import { dataConnect, getTracksByMood } from '@aikami/frontend/dataconnect';
import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  COMBAT_ACTION_SYSTEM_PROMPT,
  type CombatActionIntent,
  CombatActionSchema,
} from '$lib/data/ai_prompts/combat_action_schema';
import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { audioService } from '$lib/services/audio/audio_service.svelte.ts';
import { ttsService } from '$lib/services/audio/tts_service.svelte.ts';
import { getExpressionAssetResolver } from '$lib/services/expression/expression_asset_resolver';
import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
import {
  diceService,
  inventoryService,
  worldGenSeedingService,
  worldStateService,
} from '$services';
import type { ExpressionId } from '$types/expression';
import type {
  DiceNotation,
  InitiativeEntry,
  QueuedRoll,
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

/**
 * A single entry in the combat log, replacing the old flat string format.
 * Each entry tracks its turn, actor, narrative text, and optionally an
 * AI-generated inline image.
 *
 * Contract: C-165 Combat Inline Images & Gallery
 */
export type CombatLogEntry = {
  /** Unique ID for Svelte {#each} keying. */
  readonly id: string;
  /** Turn number this entry belongs to (monotonically increasing). */
  readonly turnNumber: number;
  /** Who performed the action — 'Player' or the enemy name. */
  readonly actor: string;
  /** Description of the action taken. */
  readonly actionText: string;
  /** Outcome or result of the action, if distinct from actionText. */
  readonly outcomeText: string;
  /** AI-generated image URL for this combat turn, if available. */
  readonly imageUrl?: string;
  /** Whether an image is currently being generated for this entry. */
  readonly isGeneratingImage?: boolean;
};

export type CombatViewModelOptions = BaseViewModelOptions & {
  /**
   * Optional callback invoked when the user dismisses the battle result.
   * When provided, {@link dismissResult} calls this instead of just
   * clearing the result — allowing the parent to close the overlay.
   */
  onDismissOverlay?: () => void;
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

  /** Display name for the player character. */
  playerName = $state('Player');

  /** The enemy entity ID set when combat starts. */
  enemyEntityId: number | null = $state(null);

  isPlayerTurn = $state(true);

  /** Portrait image URL for the player character. */
  playerPortraitUrl = $state('/assets/images/combat/player_portrait.webp');

  /** Portrait image URL for the enemy character. */
  enemyPortraitUrl = $state('/assets/images/combat/enemy_portrait.webp');

  /** Current expression for the player character. */
  playerExpression: ExpressionId = $state('neutral');

  /** Current expression for the enemy character. */
  enemyExpression: ExpressionId = $state('neutral');

  /** Lazy-initialized expression asset resolver for LPC overlay paths. */
  private _expressionResolver = getExpressionAssetResolver({
    className: 'CombatExpressionResolver',
  });

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
    const onDismiss = (this as unknown as { _options?: CombatViewModelOptions })._options
      ?.onDismissOverlay;
    if (onDismiss) {
      this.combatResult = null;
      onDismiss();
      return;
    }
    this.combatResult = null;
  }

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: EngineBridge | undefined;

  /** Cleanup functions for bridge event listeners. */
  private _disposeListeners: Array<() => void> = [];

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      // Keep engine dynamic (heavy — PixiJS + ECS worker)
      const { createEngineBridge } = await import('@aikami/frontend/engine');

      this._bridge = createEngineBridge();
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

    const removeTurnChanged = bridge.on('TURN_CHANGED', (event) => {
      this.activeEntities = event.activeEntities;
      this.currentTurnEntity = event.currentEntityId;

      // C-234: Update initiative entries for new turn
      const isPlayerEntity = event.currentEntityId === 1;
      this.initiativeEntries = this.initiativeEntries.map((e) => ({
        ...e,
        isCurrentTurn: e.entityId === event.currentEntityId,
      }));

      // C-234: Update turn state
      this.turnState = {
        currentEntityId: event.currentEntityId,
        currentEntityName: isPlayerEntity ? this.playerName : this.enemyName || 'Enemy',
        isPlayerTurn: isPlayerEntity,
        actionEconomy: { action: false, bonusAction: false, reaction: false },
        turnNumber: (this.turnState?.turnNumber ?? 0) + 1,
      };
    });

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
      this.enemyName = event.enemyName ?? 'Unknown Enemy';
      this.enemyHp = event.enemyHp ?? 80;
      this.enemyMaxHp = event.enemyMaxHp ?? 80;
      this.enemyEntityId = event.enemyId ?? null;
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
          entityId: 1,
          name: this.playerName,
          initiative: playerInit,
          currentHp: this.playerHp,
          maxHp: this.playerMaxHp,
          isCurrentTurn: event.firstTurnEntityId === 1,
          isDefeated: false,
        },
        ...event.participantIds
          .filter((id: number) => id !== 1)
          .map((id: number, index: number) => ({
            entityId: id,
            name: index === 0 ? this.enemyName || 'Enemy' : `Entity #${id}`,
            initiative: index === 0 ? enemyInit : Math.floor(Math.random() * 20) + 1,
            currentHp: index === 0 ? this.enemyHp : 50,
            maxHp: index === 0 ? this.enemyMaxHp : 50,
            isCurrentTurn: event.firstTurnEntityId === id,
            isDefeated: false,
          })),
      ] as InitiativeEntry[];

      // C-234: Initialize turn state
      this.turnState = {
        currentEntityId: event.firstTurnEntityId,
        currentEntityName:
          event.firstTurnEntityId === 1 ? this.playerName : this.enemyName || 'Enemy',
        isPlayerTurn: event.firstTurnEntityId === 1,
        actionEconomy: { action: false, bonusAction: false, reaction: false },
        turnNumber: 1,
      };
    });

    const removeCombatEnded = bridge.on('COMBAT_ENDED', (event) => {
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
          ? e.entityId !== 1 // non-player entities defeated on victory
          : e.entityId === 1, // player defeated on defeat
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

      // Update HP bars from the log event target data
      // The player ID in combat is always entity 1 (bitECS sequential allocation)
      if (event.targetId === 1) {
        const prevPlayerHp = this.playerHp;
        this.playerHp = event.targetRemainingHp;
        this.playerMaxHp = event.targetMaxHp;
        // Trigger damage flash if player HP decreased
        if (event.targetRemainingHp < prevPlayerHp) {
          this._triggerDamageFlash('player');
          // Expression trigger: wounded on damage
          this.playerExpression = 'pained';
        }
      } else {
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

      // Expression trigger: enraged on critical hit
      if (/critical/i.test(event.message)) {
        if (event.sourceId === 1) {
          this.playerExpression = 'determined';
        } else {
          this.enemyExpression = 'angry';
        }
      }

      // Expression trigger: fatal blow — pained on victim
      if (event.targetRemainingHp <= 0) {
        if (event.targetId === 1) {
          this.playerExpression = 'pained';
        } else {
          this.enemyExpression = 'pained';
        }
      }
    });

    const removeCombatStateUpdate = bridge.on('COMBAT_STATE_UPDATE', (event) => {
      // Update player HP from the entity HP map
      // The player entity is always the first participant (eid 1 in bitECS)
      // but use the enemy entity ID from COMBAT_STARTED if available
      for (const eid of Object.keys(event.entityHpMap)) {
        const numericEid = Number(eid);
        if (this.enemyEntityId !== null && numericEid === this.enemyEntityId) {
          this.enemyHp = event.entityHpMap[numericEid] ?? this.enemyHp;
          this.enemyMaxHp = event.entityMaxHpMap[numericEid] ?? this.enemyMaxHp;
        } else if (this.enemyEntityId === null || numericEid !== this.enemyEntityId) {
          // Non-enemy participant = player
          this.playerHp = event.entityHpMap[numericEid] ?? this.playerHp;
          this.playerMaxHp = event.entityMaxHpMap[numericEid] ?? this.playerMaxHp;
        }
      }
    });

    this._disposeListeners.push(
      removeTurnChanged,
      removeCombatStarted,
      removeCombatEnded,
      removeCombatLog,
      removeCombatStateUpdate,
    );
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
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
    this.enemyEntityId = null;
    this.isPlayerTurn = true;
    this.isAttacking = false;
    this.isResolvingAiAction = false;
    this.activeDiceRoll = null;
    this.combatBackgroundImageUrl = null;
    this.isPlayerTakingDamage = false;
    this.isEnemyTakingDamage = false;
    this.playerPortraitUrl = '/assets/images/combat/player_portrait.webp';
    this.enemyPortraitUrl = '/assets/images/combat/enemy_portrait.webp';
    this.playerExpression = 'neutral';
    this.enemyExpression = 'neutral';
    this.combatLog = [];
    this.encounterImages = [];
    this.combatResult = null;
    this.queuedRolls = [];
    this.initiativeEntries = [];
    this.turnState = null;
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
      const raw = await textGenerationService.extractStructure({
        schema: CombatActionSchema as unknown as Record<string, unknown>,
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
          void ttsService.synthesize({
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
        void ttsService.synthesize({
          text: intent.enemyQuote,
          voice: 'af_heart',
        });
      }

      // Fire image generation — wire result into log entry + gallery (C-148, C-165)
      if (intent.generateImage) {
        this.debug('executeCustomAction: generating scene image', {
          prompt: intent.narrative.slice(0, 60),
        });
        void imageGenerationService
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

      // Dispatch the mapped COMBAT_ACTION to the ECS engine
      this.isAttacking = true;
      this.debug('executeCustomAction: dispatching COMBAT_ACTION', {
        action: intent.actionType,
        targetId: this.enemyEntityId,
        advantage: intent.advantage,
        bonusDamage: intent.bonusDamage,
      });
      this._bridge.send({
        type: 'COMBAT_ACTION',
        action: intent.actionType,
        targetId: this.enemyEntityId ?? undefined,
        advantage: intent.advantage,
        bonusDamage: intent.bonusDamage,
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
      const total = diceService.rollNotation({
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

  /** @inheritdoc */
  endTurn(): void {
    if (!this.inCombat) {
      this.debug('endTurn: blocked — no combat in progress');
      return;
    }

    this.debug('endTurn: resolving locally');

    // Advance turn to next combatant (alternate between 1 and nearest enemy)
    // In full combat with many entities, the bridge would handle this.
    const nextId = this.currentTurnEntity === 1 ? (this.enemyEntityId ?? 2) : 1;
    this.currentTurnEntity = nextId;
    this.isPlayerTurn = nextId === 1;

    // Reset turn state locally
    if (this.turnState) {
      this.turnState = {
        currentEntityId: nextId,
        currentEntityName: nextId === 1 ? this.playerName : this.enemyName || 'Enemy',
        isPlayerTurn: nextId === 1,
        actionEconomy: { action: false, bonusAction: false, reaction: false },
        turnNumber: this.turnState.turnNumber + 1,
      };
    }

    // Update initiative current-turn highlight
    this.initiativeEntries = this.initiativeEntries.map((e) => ({
      ...e,
      isCurrentTurn: e.entityId === nextId,
    }));
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

    void imageGenerationService
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
    if (message.startsWith('Player ')) {
      return 'Player';
    }
    if (message.startsWith('Enemy ')) {
      return this.enemyName || 'Enemy';
    }
    return 'System';
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
    const idx = this.combatLog.findIndex((e) => e.id === entryId);
    if (idx === -1) {
      return;
    }
    const old = this.combatLog[idx];
    const updated: CombatLogEntry = {
      ...old,
      imageUrl: imageUrl ?? old.imageUrl,
      isGeneratingImage: false,
    };
    // Replace the entry in place to trigger Svelte reactivity
    const copy = [...this.combatLog];
    copy[idx] = updated;
    this.combatLog = copy;
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
  private _buildCharacterSheetContext(): string {
    const inventory = inventoryService.inventory;
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
    const worldGen = worldStateService.worldGenOutput;
    if (worldGen && Array.isArray(worldGen.npcs) && worldGen.npcs.length > 0) {
      const gmPrompt = worldGenSeedingService.assembleGmPrompt({
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
   * Queries Data Connect for audio tracks matching a scene mood and
   * triggers an equal-power BGM crossfade via {@link audioService}.
   *
   * Picks a random track from matching results for variety. Falls back
   * to a hardcoded placeholder URL when Firebase is unavailable or no
   * tracks match the requested mood.
   *
   * Fire-and-forget — errors are logged but never propagated to the UI.
   *
   * @param mood - Musical mood tag (e.g. 'epic', 'tense', 'triumph').
   *
   * Contract: C-151 AI Dynamic Music
   */
  private async _transitionBgmByMood(mood: string): Promise<void> {
    try {
      const result = await getTracksByMood(dataConnect, { mood });

      if (result.data?.audioTracks && result.data.audioTracks.length > 0) {
        const tracks = result.data.audioTracks;
        const selected = tracks[Math.floor(Math.random() * tracks.length)];
        if (!selected) {
          return;
        }

        this.debug('_transitionBgmByMood: crossfading', {
          mood,
          track: selected.title,
          url: selected.storageUrl,
          availableTracks: tracks.length,
        });

        await audioService.transitionToBgm(selected.storageUrl, 2000);
      } else {
        // No tracks found for this mood — fall back to placeholder
        this.debug('_transitionBgmByMood: no tracks for mood, using fallback', { mood });
        await this._transitionBgmFallback(mood);
      }
    } catch (error) {
      // Firebase / Data Connect unavailable — use hardcoded placeholder
      this.debug('_transitionBgmByMood: query failed, using fallback', {
        mood,
        error: (error as Error).message,
      });
      await this._transitionBgmFallback(mood);
    }
  }

  /**
   * Hardcoded fallback BGM URLs for when Firebase Data Connect is
   * unavailable or no tracks exist for the requested mood.
   *
   * Maps moods to the placeholder audio files created in C-150.
   *
   * @param mood - Musical mood tag.
   */
  private async _transitionBgmFallback(mood: string): Promise<void> {
    const fallbackMap: Record<string, string> = {
      epic: '/assets/audio/bgm_combat.webm',
      heroic: '/assets/audio/bgm_combat.webm',
      tense: '/assets/audio/bgm_combat.webm',
      foreboding: '/assets/audio/bgm_combat.webm',
      triumph: '/assets/audio/bgm_explore.webm',
      sorrow: '/assets/audio/bgm_explore.webm',
      mysterious: '/assets/audio/bgm_explore.webm',
      peaceful: '/assets/audio/bgm_explore.webm',
    };

    const url = fallbackMap[mood] ?? '/assets/audio/bgm_combat.webm';

    this.debug('_transitionBgmFallback', { mood, url });

    try {
      await audioService.transitionToBgm(url, 2000);
    } catch (error) {
      this.warn('_transitionBgmFallback: crossfade failed', error);
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
 * Factory function for creating CombatViewModel instances.
 *
 * @param options - ViewModel options (standard BaseViewModelOptions).
 * @returns A fully initialized CombatViewModel instance.
 */
export const getCombatViewModel = (options: CombatViewModelOptions): CombatViewModelInterface => {
  return CombatViewModel.create(options);
};
