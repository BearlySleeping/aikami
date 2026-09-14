import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { CompanionControlMode, GridPoint } from '@aikami/types';
import type { ExpressionId } from '$types';
import type { CompanionDecisionState, CompanionProposal } from './combat_companion_flow.svelte.ts';
import type { CombatLogEntry } from './combat_log_service.svelte.ts';
import type {
  CombatAbilityOption,
  CombatIntentDecisionState,
  CombatIntentPreview,
  CombatSelectionState,
} from './types/combat_direct_control.ts';
import type {
  DiceNotation,
  InitiativeEntry,
  QueuedRoll,
  TurnState,
} from './types/combat_enhancements.ts';

export type CombatViewModelInterface = BaseViewModelInterface & {
  /**
   * Companion control modes, keyed by combatant id (C-526 AC-6).
   *
   * A persisted player PREFERENCE, not rules state: `direct` hands the turn to
   * the player, every other mode keeps it AI-driven with player approval.
   */
  readonly companionModes: Record<string, CompanionControlMode>;

  /**
   * The companions the player can command, with their persisted preference.
   *
   * A presentation projection of the roster — never a second source of truth.
   */
  readonly companionControls: Array<{
    combatantId: string;
    name: string;
    mode: CompanionControlMode;
    intent: string;
  }>;

  /** The companion plan awaiting the player's approval, if any. */
  readonly companionProposal: CompanionProposal | null;

  /** The companion decision lifecycle, for the announcement region. */
  readonly companionDecisionStatus: CompanionDecisionState['status'];

  /** Returns the unsaved Intent draft, falling back to the persisted value. */
  companionIntentDraft(options: { combatantId: string; persistedIntent: string }): string;

  /** Updates one companion's unsaved Intent draft. */
  setCompanionIntentDraft(options: { combatantId: string; intent: string }): void;

  /** Display name for a combatant id (used by the proposal header). */
  displayNameForCombatant(combatantId: string): string;

  /** Changes a companion's mode (and standing goal) and persists it. */
  setCompanionMode(options: {
    combatantId: string;
    mode: CompanionControlMode;
    intent?: string;
  }): void;

  /** Commits the approved companion plan through the existing decision path. */
  approveCompanionPlan(): void;

  /** Refuses the companion plan — nothing is committed. */
  declineCompanionPlan(): void;

  /** Re-points the companion's plan at another combatant and re-previews it. */
  editCompanionTarget(combatantId: string): void;

  /** Re-aims the companion's move at a range band and re-previews it. */
  editCompanionApproach(band: 'melee' | 'reach' | 'ranged'): void;

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
  /** Resolves a compiler-authored i18n key without exposing the key as prose. */
  translateIntentMessage(messageKey: string): string;

  // ── Image generation state (exposed from service) ──
  readonly isGeneratingImage: boolean;
  readonly generationStatus: string;
  readonly generationProgress: number;
};
