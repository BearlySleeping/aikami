// apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts

import type { CombatDecisionPolicy, EngineBridge } from '@aikami/frontend/engine';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type {
  CombatEngineKind,
  CompanionControlMode,
  GridPoint,
  ReactionPolicy,
} from '@aikami/types';
import { DEFAULT_MOVEMENT_PER_TURN } from '@aikami/utils';
import m from '$i18n';
import {
  COMBAT_ACTION_SYSTEM_PROMPT,
  type CombatActionIntent,
  CombatActionSchema,
} from '$lib/data/ai_prompts/combat_action_schema';
import { resolveNpcAvatarUrl, resolvePlayerAvatarUrl } from '$lib/data/npc_avatar_catalog';
import type { ExpressionId } from '$types';
import { createEncounterRunTracker } from '../../services/game/combat_ai_lifecycle';
import { createCombatAiController } from './combat_ai_controller.svelte.ts';
import {
  type CombatCompanionFlow,
  createCombatCompanionFlow,
} from './combat_companion_flow.svelte.ts';
import type { CompanionDecisionState, CompanionProposal } from './combat_companion_preview.ts';
import { type CombatIntentFlow, createCombatIntentFlow } from './combat_intent_flow.svelte.ts';
import type { CombatLogEntry } from './combat_log_service.svelte.ts';
import { createCombatNarrationFlow } from './combat_narration_flow.svelte.ts';
import {
  CombatObjectInspector,
  type CombatObjectInspectorStatus,
  type InspectedObject,
  type InspectedPreview,
} from './combat_object_inspector.svelte.ts';
import {
  type CombatObjectivePanelViewModelInterface,
  getCombatObjectivePanelViewModel,
} from './combat_objective_panel.svelte.ts';
import {
  type CombatReactionFlowViewModelInterface,
  getCombatReactionFlowViewModel,
  REACTION_COST_MESSAGE_KEY,
  type ReactionDecisionState,
} from './combat_reaction_flow.svelte.ts';
import {
  type CombatSelectionController,
  createCombatSelectionController,
} from './combat_selection_controller.svelte.ts';
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
import type { ObjectivePanelEntry } from './utils/objective_panel.ts';

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CombatViewModel — Svelte 5 ViewModel for the combat / turn-based battle UI
//
// Contract: C-145 Turn-Based Combat Loop
//
// Sends COMBAT_ACTION commands to the ECS engine via EngineBridge.send().
// Listens for COMBAT_LOG, COMBAT_STATE_UPDATE, and COMBAT_ENDED events
// to reactively update HP bars, battle log, and overlay state.
//
// This file is BEHAVIOUR. The dependency contract it is handed lives in
// `combat_view_model_capabilities.ts`, and the surface the Views render against
// lives in `combat_view_model_contract.ts`; both are re-exported below so every
// existing importer keeps resolving them from here.
// ---------------------------------------------------------------------------

export type { CombatLogEntry } from './combat_log_service.svelte.ts';

// Capability contracts (what this ViewModel is HANDED) live in
// `combat_view_model_capabilities.ts`, and the surface the Views render against
// lives in `combat_view_model_contract.ts`; both are re-exported so every
// importer keeps resolving them from THIS module.
export type {
  CombatAiTurnCapabilities,
  CombatAudioCapabilities,
  CombatCompanionCapabilities,
  CombatDiceCapabilities,
  CombatEngineCapabilities,
  CombatExpressionCapabilities,
  CombatImageCapabilities,
  CombatIntentCapabilities,
  CombatInventoryCapabilities,
  CombatLogCapabilities,
  CombatNarrationCapabilities,
  CombatPlayerStateCapabilities,
  CombatStatusEffectsCapabilities,
  CombatTextCapabilities,
  CombatTtsCapabilities,
  CombatWorldGenCapabilities,
  CombatWorldStateCapabilities,
} from './combat_view_model_capabilities.ts';

// 🔴 `CombatViewModelOptions`, `CombatViewModelPublicOptions` and
// `CombatViewModelInterface` are deliberately DECLARED here rather than only
// re-exported: the MVVM guard (M1/M2) requires a ViewModel module to declare its
// own `*ViewModelOptions` and `*ViewModelInterface`, so that a consumer always
// finds the pair beside the ViewModel it belongs to. Their definitions — one
// entry per capability, one entry per rendered surface — live in the two sibling
// modules above; these declarations are this module's published names.
export type CombatViewModelPublicOptions =
  import('./combat_view_model_capabilities.ts').CombatViewModelPublicOptions;
export type CombatViewModelOptions =
  import('./combat_view_model_capabilities.ts').CombatViewModelOptions;
export type CombatViewModelInterface =
  import('./combat_view_model_contract.ts').CombatViewModelInterface;

// Local aliases for the names the class body type-annotates with.
// (`export type { X } from '…'` re-exports without bringing the name into scope,
// so these are ordinary imports, separate from the re-exports above.)
import type {
  CombatAudioCapabilities,
  CombatCompanionCapabilities,
  CombatDiceCapabilities,
  CombatEngineCapabilities,
  CombatExpressionCapabilities,
  CombatImageCapabilities,
  CombatInventoryCapabilities,
  CombatLogCapabilities,
  CombatNarrationCapabilities,
  CombatPlayerStateCapabilities,
  CombatStatusEffectsCapabilities,
  CombatTextCapabilities,
  CombatTtsCapabilities,
  CombatWorldGenCapabilities,
  CombatWorldStateCapabilities,
} from './combat_view_model_capabilities.ts';

/** The authored combatant id the v2 kernel knows the player by. */
const COMBAT_PLAYER_COMBATANT_ID = 'player';

/** Maps compiler/kernel i18n keys onto the generated translation functions. */
const COMBAT_INTENT_TRANSLATIONS: Record<string, () => string> = {
  'combat.intent.too_long': m.combatIntentTooLong,
  'combat.intent.stale': m.combatIntentStale,
  'combat.intent.ambiguous': m.combatIntentAmbiguous,
  'combat.intent.unresolved': m.combatIntentUnresolved,
  'combat.intent.unavailable': m.combatIntentUnavailable,
  'combat.clarify.option_1': m.combatClarifyOption1,
  'combat.clarify.option_2': m.combatClarifyOption2,
  'combat.clarify.option_3': m.combatClarifyOption3,
  'combat.clarify.option_4': m.combatClarifyOption4,
  'combat.invalid.state_shape': m.combatInvalidStateShape,
  'combat.invalid.command_shape': m.combatInvalidCommandShape,
  'combat.invalid.encounter_ended': m.combatInvalidEncounterEnded,
  'combat.invalid.stale_revision': m.combatInvalidStaleRevision,
  'combat.invalid.not_active_combatant': m.combatInvalidNotActiveCombatant,
  'combat.invalid.actor_unknown': m.combatInvalidActorUnknown,
  'combat.invalid.ability_unknown': m.combatInvalidAbilityUnknown,
  'combat.invalid.ability_not_available': m.combatInvalidAbilityNotAvailable,
  'combat.invalid.no_action_available': m.combatInvalidNoActionAvailable,
  'combat.invalid.target_invalid': m.combatInvalidTargetInvalid,
  'combat.invalid.target_defeated': m.combatInvalidTargetDefeated,
  'combat.invalid.target_not_participating': m.combatInvalidTargetNotParticipating,
  'combat.invalid.target_out_of_range': m.combatInvalidTargetOutOfRange,
  'combat.invalid.target_not_visible': m.combatInvalidTargetNotVisible,
  'combat.invalid.movement_budget_exceeded': m.combatInvalidMovementBudgetExceeded,
  'combat.invalid.path_blocked': m.combatInvalidPathBlocked,
  'combat.invalid.path_invalid': m.combatInvalidPathInvalid,
  'combat.invalid.unsupported_in_v2': m.combatInvalidUnsupportedInV2,
  'combat.invalid.reaction_pending': m.combatInvalidReactionPending,
  'combat.invalid.reaction_not_pending': m.combatInvalidReactionNotPending,
  'combat.invalid.reaction_stale': m.combatInvalidReactionStale,
  'combat.invalid.reaction_actor_not_eligible': m.combatInvalidReactionActorNotEligible,
  'combat.invalid.encounter_run_mismatch': m.combatInvalidEncounterRunMismatch,
  'combat.invalid.retreat_not_authored': m.combatInvalidRetreatNotAuthored,
  'combat.invalid.retreat_not_toward_exit': m.combatInvalidRetreatNotTowardExit,
  'combat.invalid.surrender_not_authored': m.combatInvalidSurrenderNotAuthored,
  'combat.reaction.cost': m.combatReactionCost,
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

  /** Unsaved standing-goal inputs, keyed by companion combatant id. */
  companionIntentDrafts = $state<Record<string, string>>({});

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

  /**
   * Authored-object inspector (C-531) — the controller owns the loop; these
   * runes are the render projection.
   */
  private readonly _objectInspector: CombatObjectInspector;

  /**
   * Objective panel (C-532 AC-1) — the child ViewModel owns the snapshot round
   * trip and render projection. Hidden objectives are never listed.
   */
  private readonly _objectivePanel: CombatObjectivePanelViewModelInterface;

  /** Authored, visible objectives for the running encounter. */
  objectives: ObjectivePanelEntry[] = $state([]);

  /**
   * The reaction decision surface (C-532 AC-4). The child ViewModel owns the
   * policy, request and render projection.
   */
  private readonly _reactionFlow: CombatReactionFlowViewModelInterface;

  /** The open reaction decision, or an idle state. */
  reactionDecision: ReactionDecisionState = $state({
    status: 'idle',
    prompt: null,
    secondsRemaining: null,
  });

  /** Per-actor reaction policy (Ask / Auto / Never). */
  reactionPolicies: Record<string, ReactionPolicy> = $state({});

  /** Objects the actor can act on right now, from the engine's own snapshot. */
  inspectedObjects: Array<InspectedObject & { coverLabel: string }> = $state([]);

  /** Status of the inspection loop. */
  inspectorStatus: CombatObjectInspectorStatus = $state('idle');

  /** The object the player opened, or `null`. */
  inspectedObjectId: string | null = $state(null);

  /** The engine's forecast for the chosen action, or `null`. */
  inspectorPreview: InspectedPreview | null = $state(null);

  /** Readable check outcome for the current authored-object preview. */
  get inspectorCheckSummary(): string {
    const check = this.inspectorPreview?.checkOutcome;
    if (check === null || check === undefined) {
      return 'No check — this action always succeeds.';
    }
    if (!check.modifierAvailable) {
      return `Requires ${check.category} (DC ${check.dc}); your sheet has no ${check.modifierSource} modifier.`;
    }
    return `${check.category} (DC ${check.dc}) with ${check.modifier >= 0 ? '+' : ''}${check.modifier} — ${Math.round(check.successOdds * 100)}% chance.`;
  }

  /** Readable affected-cell summary for the current authored-object preview. */
  get inspectorImpactSummary(): string | null {
    const count = this.inspectorPreview?.impactCells.length ?? 0;
    return count > 0 ? `Affects ${count} cell(s).` : null;
  }

  /** Readable environmental consequence labels for the current preview. */
  get inspectorEffectLabels(): string[] {
    return (this.inspectorPreview?.effects ?? []).map((effect) =>
      effect.change.replace(/([A-Z])/g, ' $1').toLowerCase(),
    );
  }

  /** Stable i18n key for the inspector's last rejection, or `null`. */
  inspectorRejectionKey: string | null = $state(null);

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
    this._narration = options.narration;
    this._companions = options.companions;
    const companions = options.companions;
    if (companions !== undefined) {
      // C-526 AC-6: the approval surface. Mode is a preference, so the flow only
      // ever decides WHO confirms a plan — the compiled command still travels the
      // same `COMBAT_AI_DECISION_SUBMITTED` path into the same kernel.
      this._companionFlow = createCombatCompanionFlow({
        bridge: () => this._bridge,
        preferenceFor: (combatantId) =>
          companions.isCompanion(combatantId)
            ? { mode: companions.modeFor(combatantId), intent: companions.intentFor(combatantId) }
            : undefined,
        persistPreference: (change) => {
          companions.persist({
            combatantId: change.combatantId,
            mode: change.preference.mode,
            intent: change.preference.intent,
          });
        },
        readRevision: () => this._combatRevision,
        readEncounterId: () => this._encounterId,
        displayNameFor: (combatantId) => this._displayNameFor(combatantId),
        appendLog: (text) => this._appendCombatLogEntry({ actionText: text, actor: 'You' }),
        debug: (event, data) => {
          this.debug(event, data);
        },
      });
    }
    const intent = options.intent;
    const aiTurns = options.aiTurns;
    if (aiTurns !== undefined) {
      // C-526 AC-5: the engine defers an AI actor's turn to this controller,
      // which serves a prefetched decision or falls back before the deadline.
      this._aiController = createCombatAiController({
        bridge: () => this._bridge,
        enabled: aiTurns.enabled,
        decide: (request) => aiTurns.decide(request),
        decideBatch: (requests) => aiTurns.decideBatch(requests),
        cancel: (decisionId) => aiTurns.cancel(decisionId),
        cancelAll: () => aiTurns.cancelAll(),
        currentRun: () => this._encounterRun.current(),
        // C-526 AC-6: a companion's decision is a PROPOSAL, not a commit, and it
        // never times out — the player may deliberate for as long as they like.
        requiresApproval: (combatantId) =>
          this._companionFlow?.requiresApproval(combatantId) === true,
        isPlayerControlled: (combatantId) => this._companionFlow?.isDirect(combatantId) === true,
        continuationFor: (combatantId) => this._companionFlow?.continuationFor(combatantId),
        deliverProposal: (proposal) =>
          this._companionFlow?.presentProposal({
            requestId: proposal.requestId,
            combatantId: proposal.combatantId,
            basedOnRevision: proposal.basedOnRevision,
            state: proposal.state,
            steps: proposal.steps,
            ...(proposal.fallback === undefined ? {} : { fallback: proposal.fallback }),
            ...(proposal.stepIndex === undefined ? {} : { stepIndex: proposal.stepIndex }),
          }),
        // C-526 AC-8/AC-6: the authored character policy plus a companion's
        // standing goal. Without this the snapshot the model reads is neutral.
        policyFor: (combatantId) => this._policyFor(combatantId),
        playerCombatantId: COMBAT_PLAYER_COMBATANT_ID,
        debug: (...args) => this.debug(...args),
        info: (...args) => this.info(...args),
      });
    }
    // C-526 AC-7/AC-11: outcome narration reserves its log slot from the
    // authored template the moment events resolve, then replaces the text in
    // place when the model answers — so a slow narrator cannot reorder the log.
    // The flow is ALWAYS attached: telegraph and degradation presentation must
    // work with no narrator at all (that is what the kill switch does).
    const narrator = this._narration;
    this._narrationFlow = createCombatNarrationFlow({
      bridge: () => this._bridge,
      enabled: narrator?.enabled === true,
      ...(narrator === undefined ? {} : { narrate: (request) => narrator.narrate(request) }),
      cancelAll: () => narrator?.cancelAll(),
      currentRun: () => this._encounterRun.current(),
      displayNameFor: (combatantId) => this._displayNameFor(combatantId),
      setCombatantNames: (names) => {
        this._combatantNames = names;
      },
      appendLogEntry: (entry) => this._appendCombatLogEntry(entry),
      updateLogEntry: (entry) => this._updateCombatLogEntry(entry),
      debug: (...args) => this.debug(...args),
      info: (...args) => this.info(...args),
    });
    this._selection = createCombatSelectionController({
      bridge: () => this._bridge,
      readRevision: () => this._combatRevision,
      readEncounterId: () => this._encounterId,
      readEngine: () => this._combatEngine,
      isInCombat: () => this.inCombat,
      debug: (event, data) => {
        this.debug(event, data);
      },
    });
    this._reactionFlow = getCombatReactionFlowViewModel({
      className: 'CombatReactionFlow',
      bridge: () => this._bridge,
      readEncounterId: () => this._encounterId,
      readRevision: () => this._combatRevision,
      displayNameFor: (combatantId) => this._displayNameFor(combatantId),
      abilityNameFor: (abilityId) => abilityId,
      translate: (key) => this.translateIntentMessage(key),
      policyFor: (combatantId) => this.reactionPolicies[combatantId],
      optionalTimerSeconds: () => this.reactionTimerSeconds,
      onDecisionChanged: () => this._syncReactionFlow(),
      debug: (event, data) => {
        this.debug(event, data);
      },
    });
    this._objectivePanel = getCombatObjectivePanelViewModel({
      className: 'CombatObjectivePanel',
      bridge: () => this._bridge,
      readEncounterId: () => this._encounterId,
      onStateChanged: () => this._syncObjectivePanel(),
      debug: (event, data) => {
        this.debug(event, data);
      },
    });
    this._objectInspector = new CombatObjectInspector({
      bridge: () => this._bridge,
      readRevision: () => this._combatRevision,
      readEncounterId: () => this._encounterId,
      readActorId: () => COMBAT_PLAYER_COMBATANT_ID,
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
      bridge: () => this._bridge,
      readRevision: () => this._combatRevision,
      readEncounterId: () => this._encounterId,
      actorId: COMBAT_PLAYER_COMBATANT_ID,
      readActorName: () => this.playerName || 'You',
      appendLog: (text) => {
        this._appendCombatLogEntry({ actionText: text, actor: 'You' });
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
   * Active encounter run identity (C-526 lifecycle repair).
   *
   * An authored encounter id recurs on retry and a `stateRevision` repeats
   * across runs, so neither identifies a run by itself. Every cache, callback
   * and late-arrival guard uses this generation instead.
   */
  private _encounterRun = createEncounterRunTracker();

  /** LLM outcome narrator, when the encounter pinned the flag on. */
  private _narration: CombatNarrationCapabilities | undefined;

  /** Outcome-narration + readable-intent presentation (C-526 AC-7/AC-11). */
  private _narrationFlow: ReturnType<typeof createCombatNarrationFlow> | undefined;

  /** Companion control modes + the approval surface (C-526 AC-6). */
  private _companionFlow: CombatCompanionFlow | undefined;
  private _companions: CombatCompanionCapabilities | undefined;

  /** Client half of the deferred AI turn (C-526 AC-5). */
  private _aiController: ReturnType<typeof createCombatAiController> | undefined;

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

  /** @inheritdoc */
  get companionModes(): Record<string, CompanionControlMode> {
    return this._companionFlow?.modes ?? {};
  }

  /**
   * The companions the player can command, with their persisted preference.
   *
   * A presentation projection only: it reads the roster and re-renders on a mode
   * change, and it never becomes a second source of truth for the mode.
   */
  get companionControls(): Array<{
    combatantId: string;
    name: string;
    mode: CompanionControlMode;
    intent: string;
  }> {
    const companions = this._companions;
    if (companions === undefined) {
      return [];
    }
    return companions.list().map((entry) => ({
      combatantId: entry.combatantId,
      name: entry.name,
      mode: this.companionModes[entry.combatantId] ?? companions.modeFor(entry.combatantId),
      intent: companions.intentFor(entry.combatantId),
    }));
  }

  /** @inheritdoc */
  get companionProposal(): CompanionProposal | null {
    return this._companionFlow?.proposal ?? null;
  }

  /** @inheritdoc */
  get companionDecisionStatus(): CompanionDecisionState['status'] {
    return this._companionFlow?.decision.status ?? 'idle';
  }

  /** @inheritdoc */
  companionIntentDraft(options: { combatantId: string; persistedIntent: string }): string {
    return this.companionIntentDrafts[options.combatantId] ?? options.persistedIntent;
  }

  /** @inheritdoc */
  setCompanionIntentDraft(options: { combatantId: string; intent: string }): void {
    this.companionIntentDrafts = {
      ...this.companionIntentDrafts,
      [options.combatantId]: options.intent,
    };
  }

  /** @inheritdoc */
  displayNameForCombatant(combatantId: string): string {
    return this._displayNameFor(combatantId);
  }

  /** @inheritdoc */
  setCompanionMode(options: {
    combatantId: string;
    mode: CompanionControlMode;
    intent?: string;
  }): void {
    this._companionFlow?.setMode(options);
    const remainingDrafts = { ...this.companionIntentDrafts };
    delete remainingDrafts[options.combatantId];
    this.companionIntentDrafts = remainingDrafts;
  }

  /** @inheritdoc */
  approveCompanionPlan(): void {
    this._companionFlow?.approve();
  }

  /** @inheritdoc */
  declineCompanionPlan(): void {
    this._companionFlow?.decline('player');
  }

  /** @inheritdoc */
  replanCompanionPlan(): void {
    this._companionFlow?.replan();
  }

  /** @inheritdoc */
  endCompanionTurn(): void {
    this._companionFlow?.endTurn();
  }

  /** @inheritdoc */
  takeCompanionControl(): void {
    this._companionFlow?.takeControl();
  }

  /** @inheritdoc */
  editCompanionTarget(combatantId: string): void {
    this._companionFlow?.editTarget(combatantId);
  }

  /** @inheritdoc */
  editCompanionApproach(band: 'melee' | 'reach' | 'ranged'): void {
    this._companionFlow?.editApproach(band);
  }

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
    // A companion proposal is grounded against the revision it was compiled
    // from; once the fight moves on it must not be approvable (AC-6).
    this._companionFlow?.invalidate(revision);
  }
  /**
   * Engine-reported combatant display names (C-526 AC-7).
   *
   * The names map travels with `COMBAT_EVENTS_RESOLVED` and is the only place an
   * AI actor id is translated to something a player can read.
   */
  private _combatantNames: Record<string, string> = {};
  /** Runtime eid → authored combatant id, from the engine (C-532, review F4). */
  private _combatantIdsByEntity: Record<string, string> = {};

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
      if (event.combatantIdsByEntity !== undefined) {
        this._combatantIdsByEntity = event.combatantIdsByEntity;
      }
      this.currentTurnEntity = event.currentEntityId;
      // C-531: the authored objects the actor can act on belong to the ACTIVE
      // turn, so the inspector is re-read whenever the turn changes.
      if (this.isDirectControl) {
        this.refreshObjectInspector();
      }

      // C-234: Update initiative entries for new turn
      // C-532 (review F4): the player owns their OWN turn and every
      // `direct`-mode companion's turn. Deriving "player turn" from the player
      // entity id alone left a Direct companion's turn unoperable — the AI
      // runner stops on it, but the UI showed it as an enemy turn.
      const isPlayerEntity = this._isPlayerControlledEntity(event.currentEntityId);
      this.initiativeEntries = this.initiativeEntries.map((e) => ({
        ...e,
        isCurrentTurn: e.entityId === event.currentEntityId,
      }));

      // C-234: Update turn state
      this.turnState = {
        currentEntityId: event.currentEntityId,
        currentEntityName: isPlayerEntity
          ? (this.initiativeEntries.find((entry) => entry.entityId === event.currentEntityId)
              ?.name ?? this.playerName)
          : this.enemyName || 'Enemy',
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

    // C-531: the object inspector answers from the engine's own snapshot and
    // forecast — never from a locally re-derived availability.
    const removeObjectSnapshot = bridge.on('COMBAT_STATE_SNAPSHOT', (event) => {
      this._objectInspector.handleStateSnapshot(event);
      this._syncObjectInspector();
    });
    const removeObjectPreview = bridge.on('COMBAT_PREVIEW_READY', (event) => {
      this._objectInspector.handlePreviewReady(event);
      this._syncObjectInspector();
    });
    const removeObjectPreviewRejected = bridge.on('COMBAT_PLAN_REJECTED', (event) => {
      this._objectInspector.handlePreviewReady({
        requestId: event.requestId,
        messageKey: event.messageKey,
      });
      this._syncObjectInspector();
    });
    // C-532 AC-1: the objective panel answers from the SAME engine snapshot the
    // inspector does, so the panel and the kernel cannot disagree.
    const removeObjectiveSnapshot = bridge.on('COMBAT_STATE_SNAPSHOT', () => {
      this._syncObjectivePanel();
    });
    this._disposeListeners.push(
      removeObjectSnapshot,
      removeObjectPreview,
      removeObjectPreviewRejected,
      removeObjectiveSnapshot,
      this._objectivePanel.attach(),
      // C-532 AC-4: the reaction decision surface. Its own listeners own the
      // open/resolve cycle; the ViewModel only mirrors the state into runes.
      this._reactionFlow.attach(),
    );
    const removeReactionOpened = bridge.on('COMBAT_REACTION_OPENED', () => {
      this._syncReactionFlow();
    });
    const removeReactionSettled = bridge.on('COMBAT_COMMAND_REJECTED', () => {
      this._syncReactionFlow();
    });
    this._disposeListeners.push(removeReactionOpened, removeReactionSettled);

    // C-525: the composed controllers own their own bridge listeners — the
    // selection round trip and the language decision loop.
    this._disposeListeners.push(this._selection.attach(), this._intentFlow.attach());
    if (this._aiController !== undefined) {
      this._disposeListeners.push(this._aiController.attach());
    }
    this._disposeListeners.push(removeCommandRejected);

    // C-526 AC-7/AC-11: narration, telegraphs and AI degradation are
    // presentation only. The flow reserves the log slot from the authored
    // template synchronously and replaces the text in place when the model
    // answers, so out-of-order provider completion cannot reorder the log, and
    // a late callback from an ended run is discarded by run identity.
    if (this._narrationFlow !== undefined) {
      this._disposeListeners.push(this._narrationFlow.attach());
    }
    if (this._companionFlow !== undefined) {
      this._disposeListeners.push(this._companionFlow.attach());
    }

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
      // C-532 AC-1: request the initial objective snapshot once the encounter
      // identity is established. The panel is event-driven afterwards; without
      // this first request the authored objectives stay invisible until the
      // first committed command. Contract: C-532 AC-1.
      this._objectivePanel.requestRefresh();
      // A new run invalidates every cached decision, snapshot and in-flight
      // narration from the previous attempt at the same authored encounter id.
      this._encounterRun.begin(this._encounterId);
      this._narrationFlow?.reset();
      this._companionFlow?.reset();
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
      // End the run BEFORE any late provider callback can observe it: a reply
      // from this encounter must never repaint the log of the next one.
      this._encounterRun.end();
      this._narrationFlow?.reset();
      this._companionFlow?.reset();
      this.debug('COMBAT_ENDED received', {
        victory: event.victory,
        result: event.settlement?.result ?? null,
        reasonCode: event.settlement?.reasonCode ?? null,
      });
      // C-532 (review F9): the settlement result is the authority when present;
      // `victory` remains the legacy projection for the legacy engine. An
      // `escape` is a disengagement on the player's terms, not a defeat.
      const settlementResult = event.settlement?.result;
      const isPlayerLoss =
        settlementResult === 'defeat' || (settlementResult === undefined && !event.victory);
      if (isPlayerLoss) {
        this.combatResult = 'defeat';
        this.playerExpression = 'pained';
        this.enemyExpression = 'happy';
      } else {
        this.combatResult = 'victory';
        this.playerExpression = 'happy';
        this.enemyExpression = 'pained';
      }
      this.currentTurnEntity = null;
      this.isPlayerTurn = false;
      this.isAttacking = false;
      this.queuedRolls = [];

      // Label each initiative row from the AUTHORITATIVE participation status,
      // never from "every non-player actor is defeated on victory": an ally, a
      // surrendered actor or an escaper must not be painted as a kill. Falls
      // back to the legacy heuristic only when the engine supplies no
      // participation (legacy encounters). Contract: C-532 AC-5.
      const participationByEntity = event.participationByEntity;
      this.initiativeEntries = this.initiativeEntries.map((e) => {
        const status = participationByEntity?.[String(e.entityId)];
        // A legacy encounter (no participation) falls back to the historical
        // heuristic: the player is the only casualty of a loss, and every
        // non-player actor is presumed down after a win.
        let isDefeated = e.entityId !== this._playerEntityId;
        if (status !== undefined) {
          isDefeated = status === 'defeated';
        } else if (isPlayerLoss) {
          isDefeated = e.entityId === this._playerEntityId;
        }
        return {
          ...e,
          isCurrentTurn: false,
          isDefeated,
        };
      });
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
    // Order matters: end the run first so any in-flight provider callback is
    // discarded, then cancel outstanding work, then drop the subscriptions.
    this._encounterRun.end();
    this._narrationFlow?.reset();
    this._companionFlow?.reset();
    this._aiController?.reset();
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
      basedOnRevision: this._combatRevision,
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
      basedOnRevision: this._combatRevision,
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

  /**
   * Whether the client owns this entity's turn.
   *
   * The player entity, or a RECRUITED companion currently in `direct` control
   * mode. This mirrors the engine's `isPlayerControlled` policy exactly: the
   * AI runner stops on a Direct companion, so the UI must offer it the same
   * controls the player has. Contract: C-526 §12.5, C-532 AC-4.
   */
  private _isPlayerControlledEntity(entityId: number): boolean {
    if (entityId === this._playerEntityId) {
      return true;
    }
    const combatantId = this._combatantIdsByEntity[String(entityId)];
    if (combatantId === undefined) {
      return false;
    }
    return this.companionModes[combatantId] === 'direct';
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
    this._bridge.send({ type: 'COMBAT_END_TURN', basedOnRevision: this._combatRevision });
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

  // ── Objective panel (C-532) ───────────────────────────────────────────

  /** Mirrors the panel flow's plain state into the render runes. */
  private _syncObjectivePanel(): void {
    this.objectives = this._objectivePanel.objectives;
  }

  get objectivePanelViewModel(): CombatObjectivePanelViewModelInterface {
    return this._objectivePanel;
  }

  // ── Reaction decision surface (C-532) ─────────────────────────────────

  /** Mirrors the reaction flow's plain state into the render runes. */
  private _syncReactionFlow(): void {
    this.reactionDecision = this._reactionFlow.decision;
  }

  get reactionFlowViewModel(): CombatReactionFlowViewModelInterface {
    return this._reactionFlow;
  }

  /**
   * Optional, player-enabled reaction timer. `null` — the default — means NO
   * time limit: player deliberation is never a provider timeout.
   */
  reactionTimerSeconds: number | null = $state(null);

  /** Stable i18n key for the reaction cost, resolved by the component. */
  get reactionCostLabel(): string {
    return this.translateIntentMessage(REACTION_COST_MESSAGE_KEY);
  }

  /** Sets an actor's Ask / Auto / Never policy. */
  setReactionPolicy(combatantId: string, policy: ReactionPolicy): void {
    this.reactionPolicies = { ...this.reactionPolicies, [combatantId]: policy };
  }

  /** Enables or disables the optional reaction timer. */
  setReactionTimer(seconds: number | null): void {
    this.reactionTimerSeconds = seconds;
  }

  /** Takes the open reaction. */
  acceptReaction(): void {
    this._reactionFlow.accept();
    this._syncReactionFlow();
  }

  /** Declines the open reaction (also the Escape path). */
  declineReaction(): void {
    this._reactionFlow.decline();
    this._syncReactionFlow();
  }

  /** Asks the engine for the encounter's authored objective progress. */
  refreshObjectives(): void {
    this._objectivePanel.requestRefresh();
    this._syncObjectivePanel();
  }

  // ── Authored-object inspector (C-531) ─────────────────────────────────

  /** Mirrors the controller's plain state into the render runes. */
  private _syncObjectInspector(): void {
    this.inspectedObjects = this._objectInspector.objects.map((object) => ({
      ...object,
      coverLabel: object.cover === 'none' ? 'no cover' : `${object.cover} cover`,
    }));
    this.inspectorStatus = this._objectInspector.status;
    this.inspectedObjectId = this._objectInspector.selectedObjectId;
    this.inspectorPreview = this._objectInspector.preview;
    this.inspectorRejectionKey = this._objectInspector.rejectionKey;
  }

  /** Asks the engine what this actor can do to the encounter's objects. */
  refreshObjectInspector(): void {
    if (!this.isDirectControl) {
      return;
    }
    this._objectInspector.refresh();
    this._syncObjectInspector();
  }

  /** Opens one authored object. */
  selectInspectedObject(objectId: string): void {
    this._objectInspector.selectObject(objectId);
    this._syncObjectInspector();
  }

  /** Previews one action on the open object without committing it. */
  previewInspectedAction(affordanceId: string): void {
    this._objectInspector.previewAction(affordanceId);
    this._syncObjectInspector();
  }

  /** Commits the previewed action. Returns `false` when nothing is previewed. */
  confirmInspectedAction(): boolean {
    const committed = this._objectInspector.confirm();
    this._syncObjectInspector();
    if (committed) {
      // The committed command changed object and surface state by definition,
      // so re-read now: waiting for the next turn change leaves a destroyed
      // object listed as intact — and the next turn change may never come
      // (C-531). The worker answers in order, so the reply reflects the commit.
      this.refreshObjectInspector();
    }
    return committed;
  }

  /** Cancels the outstanding interaction — nothing is committed. */
  cancelInspectedAction(): void {
    this._objectInspector.cancel();
    this._syncObjectInspector();
  }

  /** @inheritdoc */
  translateIntentMessage(messageKey: string): string {
    return COMBAT_INTENT_TRANSLATIONS[messageKey]?.() ?? m.combatIntentRefused();
  }

  /**
   * Display name for an engine-reported AI actor id (C-526 AC-7).
   *
   * The raw id is the honest fallback — labelling every AI actor with the primary
   * enemy's name would misattribute a companion's telegraph.
   */
  private _displayNameFor(actorId: string): string {
    const named = this._combatantNames[actorId];
    if (named !== undefined && named.length > 0) {
      return named;
    }
    return actorId.length > 0 ? actorId : 'System';
  }

  /** Appends one narration entry to the combat log. */
  private _appendCombatLogEntry(options: { actionText: string; actor: string }): string {
    const entry: CombatLogEntry = {
      id: `log-${++this._logEntryCounter}`,
      turnNumber: this._turnCounter,
      actor: options.actor,
      actionText: options.actionText,
      outcomeText: '',
    };
    this.combatLog = [entry, ...this.combatLog];
    return entry.id;
  }

  /**
   * The character policy for one actor (C-526 AC-8).
   *
   * Authored role/personality comes from the roster seam; a companion's standing
   * goal comes from the same persisted preference Intent mode writes. Returns
   * `undefined` when nothing is authored, so the snapshot's neutral defaults
   * apply rather than an invented personality.
   */
  private _policyFor(combatantId: string): CombatDecisionPolicy | undefined {
    const companions = this._companions;
    if (companions === undefined || !companions.isCompanion(combatantId)) {
      return undefined;
    }
    const goal = companions.intentFor(combatantId);
    return goal.length === 0 ? undefined : { standingGoal: goal };
  }

  /**
   * Rewrites an already-reserved log entry in place (C-526 AC-11).
   *
   * Replacing rather than appending is what preserves combat-log ordering when
   * the narrator answers out of order: the entry's position was reserved when
   * the events resolved, so only its text moves.
   */
  private _updateCombatLogEntry(options: {
    entryId: string;
    actionText: string;
    actor: string;
  }): void {
    this.combatLog = this.combatLog.map((entry) =>
      entry.id === options.entryId
        ? { ...entry, actionText: options.actionText, actor: options.actor }
        : entry,
    );
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
