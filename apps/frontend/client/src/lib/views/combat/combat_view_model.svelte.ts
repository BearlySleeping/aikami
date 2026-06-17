// apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts
import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
import {
  COMBAT_ACTION_SYSTEM_PROMPT,
  type CombatActionIntent,
  CombatActionSchema,
} from '../../game/core/ai/prompts/combat_action_schema.ts';

// ---------------------------------------------------------------------------
// CombatViewModel — Svelte 5 ViewModel for the combat / turn-based battle UI
//
// Contract: C-145 Turn-Based Combat Loop
//
// Sends COMBAT_ACTION commands to the ECS engine via EngineBridge.send().
// Listens for COMBAT_LOG, COMBAT_STATE_UPDATE, and COMBAT_ENDED events
// to reactively update HP bars, battle log, and overlay state.
// ---------------------------------------------------------------------------

export type CombatViewModelOptions = BaseViewModelOptions;

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

  /** Display name of the active enemy (e.g. "Goblin"). */
  readonly enemyName: string;

  /** The entity ID of the current enemy target. */
  readonly enemyEntityId: number | null;

  /** Whether it's currently the player's turn in combat. */
  readonly isPlayerTurn: boolean;

  /** Ordered combat log entries — most recent first. */
  readonly combatLog: readonly string[];

  /**
   * Battle outcome.
   * `null` while combat is ongoing; `'victory'` or `'defeat'` when ended.
   */
  readonly combatResult: 'victory' | 'defeat' | null;

  /** CSS class string for the battle result banner. */
  readonly combatResultBannerClass: string;

  /** Whether a combat encounter is currently in progress. */
  readonly inCombat: boolean;

  /** Whether the attack button should be disabled (waiting for engine response). */
  readonly isAttacking: boolean;

  /** Whether the AI is resolving a freeform custom action (disables all inputs). */
  readonly isResolvingAiAction: boolean;

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
   * bonusDamage, narrative, generateImage). The narrative is appended to
   * the combat log, image generation is optionally triggered, and the
   * mapped COMBAT_ACTION command is dispatched to the ECS engine.
   *
   * Contract: C-146 Freeform AI Combat Actions
   */
  executeCustomAction(prompt: string): Promise<void>;
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

  enemyName = $state('');

  /** The enemy entity ID set when combat starts. */
  enemyEntityId: number | null = $state(null);

  isPlayerTurn = $state(true);

  /** Whether we're waiting for the engine to resolve an attack. */
  isAttacking = $state(false);

  /** Whether the AI is resolving a freeform custom action. */
  isResolvingAiAction = $state(false);

  combatLog: string[] = $state([]);

  combatResult: 'victory' | 'defeat' | null = $state(null);

  /** Derived count of alive entities. */
  get aliveCount(): number {
    return this.activeEntities.length;
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

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: EngineBridge | undefined;

  /** Cleanup functions for bridge event listeners. */
  private _disposeListeners: Array<() => void> = [];

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
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
    });

    const removeCombatEnded = bridge.on('COMBAT_ENDED', (event) => {
      this.debug('COMBAT_ENDED received', { victory: event.victory });
      if (event.victory) {
        this.combatResult = 'victory';
      } else {
        this.combatResult = 'defeat';
      }
      this.currentTurnEntity = null;
      this.isPlayerTurn = false;
      this.isAttacking = false;
    });

    const removeCombatLog = bridge.on('COMBAT_LOG', (event) => {
      this.debug('COMBAT_LOG received', {
        sourceId: event.sourceId,
        targetId: event.targetId,
        targetRemainingHp: event.targetRemainingHp,
        messageLength: event.message.length,
      });
      this.combatLog = [event.message, ...this.combatLog];
      this.isAttacking = false;

      // Update HP bars from the log event target data
      // The player ID in combat is always entity 1 (bitECS sequential allocation)
      if (event.targetId === 1) {
        this.playerHp = event.targetRemainingHp;
        this.playerMaxHp = event.targetMaxHp;
      } else {
        this.enemyHp = event.targetRemainingHp;
        this.enemyMaxHp = event.targetMaxHp;
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
    this.combatLog = [];
    this.combatResult = null;

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
    this.debug('executeCustomAction: resolving', {
      promptLength: trimmed.length,
      promptPreview: trimmed.slice(0, 60),
      enemyName: this.enemyName,
      playerHp: `${this.playerHp}/${this.playerMaxHp}`,
      enemyHp: `${this.enemyHp}/${this.enemyMaxHp}`,
    });

    try {
      // Build contextual prompt with player stats, enemy info, and user input
      const contextualPrompt = [
        `Player HP: ${this.playerHp}/${this.playerMaxHp}`,
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
        narrativeLength: intent.narrative.length,
        narrativePreview: intent.narrative.slice(0, 80),
      });

      // Append the DM narrative to the combat log
      this.combatLog = [intent.narrative, ...this.combatLog];

      // Fire image generation asynchronously if the action is cinematic
      if (intent.generateImage) {
        this.debug('executeCustomAction: triggering image generation', {
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
          })
          .catch((error) => {
            this.warn('executeCustomAction: image generation failed', error);
          });
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
      this.combatLog = [
        `[AI] Failed to interpret action: ${(error as Error).message}`,
        ...this.combatLog,
      ];
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
}

/**
 * Factory function for creating CombatViewModel instances.
 *
 * @param options - ViewModel options (standard BaseViewModelOptions).
 * @returns A fully initialized CombatViewModel instance.
 */
export const getCombatViewModel = (options: CombatViewModelOptions): CombatViewModel => {
  return new CombatViewModel(options);
};
