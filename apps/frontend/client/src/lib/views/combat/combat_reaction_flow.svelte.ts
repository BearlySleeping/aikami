// apps/frontend/client/src/lib/views/combat/combat_reaction_flow.svelte.ts
//
// Reaction decision surface (Combat-08 AC-4).
//
// Owns the Ask / Auto / Never policy end to end on the client:
//
//   ask     the window is presented and the player decides. There is NO
//           default time limit: player deliberation is not a provider timeout,
//           and a forced timer is an accessibility failure. An OPTIONAL,
//           player-enabled timer may expire to Decline, and the expiry is
//           recorded as an external input (`source: 'timeout'`), never as a
//           provider failure.
//   auto    applies the configured legal policy — accept, because the engine
//           has already established eligibility when it opened the window.
//   never   declines.
//
// Nothing here decides mechanics. The window (reactor queue, trigger cell,
// ability, cost, consequence) comes from the ENGINE's `COMBAT_REACTION_OPENED`
// event; this flow only chooses and submits, and the worker revalidates window
// identity, version, run identity and eligibility before anything is spent.
//
// A stale companion approval cannot execute through a suspended turn: while a
// window is open the engine refuses every other command, so the companion flow's
// submission is rejected by the kernel rather than silently committed.
//
// Contract: C-532 AC-4

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type {
  GridPoint,
  ReactionChoice,
  ReactionChoiceSource,
  ReactionPolicy,
} from '@aikami/types';

/** The slice of the engine bridge this flow uses. */
export type CombatReactionFlowBridge = Pick<EngineBridge, 'send' | 'on'>;

/** The decision surface's view of one open window. */
export type ReactionPrompt = {
  windowId: string;
  windowVersion: number;
  encounterRunId: string;
  /**
   * The committed state revision this window belongs to (C-532).
   *
   * Captured from `COMBAT_REACTION_OPENED`, NOT from the ViewModel's live
   * counter: the engine emits the window before the economy/`TURN_CHANGED`
   * events, so reading the ViewModel counter here raced the commit and the
   * choice was rejected as stale.
   */
  basedOnRevision: number;
  /** The reactor being asked. */
  reactorId: string;
  reactorName: string;
  /** The actor whose movement provoked the reaction. */
  targetId: string;
  targetName: string;
  /** The registered ability that would be used, and its authored cost label. */
  abilityId: string;
  abilityName: string;
  /** Stable i18n key for the cost, never raw prose. */
  costMessageKey: string;
  /** The consequence in one screen-reader sentence. */
  consequence: string;
  triggerCell: GridPoint;
  /** Cells the mover already committed before the trigger cell. */
  committedCells: GridPoint[];
  /** Whether other reactors are still queued behind this one. */
  remainingReactors: number;
  /** The policy that governs this actor. */
  policy: ReactionPolicy;
};

/** The prompt plus its optional, player-enabled timer. */
export type ReactionDecisionState = {
  status: 'idle' | 'awaiting_player' | 'resolved';
  prompt: ReactionPrompt | null;
  /**
   * Seconds remaining on the OPTIONAL timer, or `null` when the player has not
   * enabled one. `null` is the default and means "no time limit".
   */
  secondsRemaining: number | null;
};

export type CombatReactionFlowDeps = {
  bridge(): CombatReactionFlowBridge | undefined;
  readEncounterId(): string;
  /** The live state revision the choice is made against. */
  readRevision(): number;
  /** Authored display name for a combatant id. */
  displayNameFor(combatantId: string): string;
  /** Authored display name for an ability id. */
  abilityNameFor(abilityId: string): string;
  /** Resolves a stable i18n key to display text. */
  translate(key: string): string;
  /** Current policy for an actor. Absent means `ask`. */
  policyFor?(combatantId: string): ReactionPolicy | undefined;
  /** Whether the player enabled the optional timer, and its length. */
  optionalTimerSeconds?(): number | null;
  debug?(event: string, data?: Record<string, unknown>): void;
  /** Mirrors every decision replacement into the owning combat ViewModel. */
  onDecisionChanged?(): void;
};

/** View-facing reaction prompt state and input handlers. */
export type CombatReactionFlowViewModelInterface = BaseViewModelInterface & {
  readonly decision: ReactionDecisionState;
  readonly prompt: ReactionPrompt | null;
  readonly isAwaitingPlayer: boolean;
  readonly costLabel: string;
  readonly timerLabel: string | null;
  dialogElement: HTMLDivElement | undefined;
  attach(): () => void;
  accept(): void;
  decline(): void;
  handleKeydown(event: KeyboardEvent): void;
  /**
   * Forgets the pending window and its optional countdown (encounter
   * start/end/disposal). Review F9.
   */
  reset(): void;
};

/** Dependencies and lifecycle metadata for the reaction-flow ViewModel. */
export type CombatReactionFlowViewModelOptions = BaseViewModelOptions & CombatReactionFlowDeps;

const IDLE: ReactionDecisionState = {
  status: 'idle',
  prompt: null,
  secondsRemaining: null,
};

/** Stable i18n key for the reaction's cost. */
export const REACTION_COST_MESSAGE_KEY = 'combat.reaction.cost';

export class CombatReactionFlow
  extends BaseViewModel<CombatReactionFlowViewModelOptions>
  implements CombatReactionFlowViewModelInterface
{
  /** The decision surface's reactive state. */
  decision: ReactionDecisionState = $state({ ...IDLE });

  dialogElement = $state<HTMLDivElement | undefined>(undefined);

  private readonly _deps: CombatReactionFlowDeps;
  private _timer: ReturnType<typeof setInterval> | undefined;
  /**
   * The window identity the running optional timer belongs to (review F9).
   *
   * A timer that survives into a REPLACEMENT window would decrement that
   * window's countdown from the previous window's remaining seconds and could
   * force it to Decline — a mechanical consequence decided by a stale timer.
   */
  private _timerWindowId: string | null = null;
  private _timerWindowVersion = -1;
  private _pending: ReactionPrompt | null = null;

  constructor(options: CombatReactionFlowViewModelOptions) {
    super(options);
    this._deps = options;
  }

  get prompt(): ReactionPrompt | null {
    return this.decision.prompt;
  }

  get isAwaitingPlayer(): boolean {
    return this.decision.status === 'awaiting_player' && this.decision.prompt !== null;
  }

  get costLabel(): string {
    return this._deps.translate(REACTION_COST_MESSAGE_KEY);
  }

  get timerLabel(): string | null {
    const remaining = this.decision.secondsRemaining;
    return remaining === null ? null : `Decline in ${remaining}s unless you choose.`;
  }

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      $effect(() => {
        if (this.isAwaitingPlayer) {
          this.dialogElement?.focus();
        }
      });
    });
    await super.initialize();
  }

  /** Registers the bridge listeners this flow needs; returns a cleanup. */
  attach(): () => void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return () => {};
    }
    const removeOpened = bridge.on('COMBAT_REACTION_OPENED', (event) => {
      this._open({
        windowId: event.windowId,
        windowVersion: event.windowVersion,
        encounterRunId: event.encounterRunId,
        basedOnRevision: event.stateRevision,
        reactorId: event.currentReactorId ?? event.reactorQueue[0] ?? '',
        targetId: event.moverId,
        abilityId: event.abilityId,
        triggerCell: event.triggerCell,
        committedCells: event.committedCells,
        remainingReactors: Math.max(0, event.reactorQueue.length - 1),
        policy: event.reactionPolicy,
      });
    });
    const removeEnded = bridge.on('COMBAT_ENDED', () => {
      // Encounter end invalidates the pending window: a continuation must not
      // outlive the fight it belongs to.
      this._clearTimer();
      this._pending = null;
      this._setDecision({ ...IDLE });
    });
    const removeRejected = bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
      if (event.commandType !== 'COMBAT_REACTION_SELECTED') {
        return;
      }
      // A stale or duplicate choice is refused by the kernel. Drop the prompt
      // WITHOUT spending anything — the engine owns the truth.
      if (this.decision.status === 'resolved') {
        this._clearTimer();
        this._pending = null;
        this._setDecision({ ...IDLE });
      }
    });
    return () => {
      removeOpened();
      removeEnded();
      removeRejected();
      this._clearTimer();
    };
  }

  /** Opens a decision for one window, honouring the actor's policy. */
  private _open(input: {
    windowId: string;
    windowVersion: number;
    encounterRunId: string;
    basedOnRevision: number;
    reactorId: string;
    targetId: string;
    abilityId: string;
    triggerCell: GridPoint;
    committedCells: GridPoint[];
    remainingReactors: number;
    policy: ReactionPolicy;
  }): void {
    if (input.reactorId === '') {
      return;
    }
    const policy = this._deps.policyFor?.(input.reactorId) ?? input.policy;
    const prompt: ReactionPrompt = {
      windowId: input.windowId,
      windowVersion: input.windowVersion,
      encounterRunId: input.encounterRunId,
      basedOnRevision: input.basedOnRevision,
      reactorId: input.reactorId,
      reactorName: this._deps.displayNameFor(input.reactorId),
      targetId: input.targetId,
      targetName: this._deps.displayNameFor(input.targetId),
      abilityId: input.abilityId,
      abilityName: this._deps.abilityNameFor(input.abilityId),
      costMessageKey: REACTION_COST_MESSAGE_KEY,
      consequence: this._consequenceText(input),
      triggerCell: { ...input.triggerCell },
      committedCells: input.committedCells.map((cell) => ({ x: cell.x, y: cell.y })),
      remainingReactors: input.remainingReactors,
      policy,
    };

    if (policy === 'auto') {
      // Auto applies the configured legal policy: the engine only opens a
      // window for an eligible reactor, so the legal choice is to accept.
      this._pending = prompt;
      this._submit('accept', 'ai_policy', prompt);
      return;
    }
    if (policy === 'never') {
      this._pending = prompt;
      this._submit('decline', 'ai_policy', prompt);
      return;
    }

    this._pending = prompt;
    const timerSeconds = this._deps.optionalTimerSeconds?.() ?? null;
    this._setDecision({
      status: 'awaiting_player',
      prompt,
      // `null` is the default: NO default time limit.
      secondsRemaining: timerSeconds,
    });
    if (timerSeconds !== null && timerSeconds > 0) {
      this._startOptionalTimer(timerSeconds);
    }
    this._deps.debug?.('reactionOpened', {
      windowId: prompt.windowId,
      reactorId: prompt.reactorId,
    });
  }

  private _consequenceText(input: {
    reactorId: string;
    targetId: string;
    abilityId: string;
  }): string {
    return [
      `${this._deps.displayNameFor(input.reactorId)} may use`,
      this._deps.abilityNameFor(input.abilityId),
      `against ${this._deps.displayNameFor(input.targetId)}`,
      'as they leave its reach.',
    ].join(' ');
  }

  /**
   * Starts the OPTIONAL, player-enabled timer. Its expiry records Decline as an
   * external input — it is never presented as a provider timeout.
   */
  private _startOptionalTimer(seconds: number): void {
    this._clearTimer();
    const prompt = this._pending;
    // Bind the timer to the exact window it was started for.
    this._timerWindowId = prompt?.windowId ?? null;
    this._timerWindowVersion = prompt?.windowVersion ?? -1;
    let remaining = seconds;
    this._timer = setInterval(() => {
      remaining -= 1;
      // The window this timer belongs to is no longer the live one: a stale
      // countdown must not touch the replacement window.
      if (!this._timerMatchesLiveWindow()) {
        this._clearTimer();
        return;
      }
      if (this.decision.status !== 'awaiting_player') {
        this._clearTimer();
        return;
      }
      if (remaining <= 0) {
        this._clearTimer();
        this._resolve('decline', 'timeout');
        return;
      }
      this._setDecision({ ...this.decision, secondsRemaining: remaining });
    }, 1000);
  }

  /** Whether the running timer still belongs to the live pending window. */
  private _timerMatchesLiveWindow(): boolean {
    const live = this._pending;
    return (
      live !== null &&
      live.windowId === this._timerWindowId &&
      live.windowVersion === this._timerWindowVersion
    );
  }

  /** The player's explicit choice. */
  resolve(choice: ReactionChoice): void {
    this._resolve(choice, 'player');
  }

  /** Player-initiated Decline — the Escape/Decline path. */
  decline(): void {
    this._resolve('decline', 'player');
  }

  /** Player-initiated Accept. */
  accept(): void {
    this._resolve('accept', 'player');
  }

  /** Declines on Escape while leaving all other keyboard input untouched. */
  handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.decline();
  }

  private _resolve(choice: ReactionChoice, source: ReactionChoiceSource): void {
    const prompt = this._pending;
    if (prompt === null || this.decision.status !== 'awaiting_player') {
      return;
    }
    this._clearTimer();
    this._submit(choice, source, prompt);
  }

  private _submit(
    choice: ReactionChoice,
    source: ReactionChoiceSource,
    prompt: ReactionPrompt,
  ): void {
    const bridge = this._deps.bridge();
    this._pending = null;
    this._setDecision({
      status: 'resolved',
      prompt,
      secondsRemaining: null,
    });
    if (bridge === undefined) {
      return;
    }
    bridge.send({
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: this._deps.readEncounterId(),
      encounterRunId: prompt.encounterRunId,
      windowId: prompt.windowId,
      windowVersion: prompt.windowVersion,
      reactorId: prompt.reactorId,
      choice,
      source,
      // The window's own committed revision, never the timing-dependent
      // ViewModel counter. Contract: C-532 AC-3.
      basedOnRevision: prompt.basedOnRevision,
    });
    this._deps.debug?.('reactionResolved', {
      windowId: prompt.windowId,
      reactorId: prompt.reactorId,
      choice,
      source,
    });
  }

  private _clearTimer(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    this._timerWindowId = null;
    this._timerWindowVersion = -1;
  }

  /**
   * Forgets everything (encounter start/end/disposal).
   *
   * Without this the decision surface keeps the previous encounter's prompt and
   * its optional countdown alive into the next fight.
   */
  reset(): void {
    this._clearTimer();
    this._pending = null;
    this._setDecision({ ...IDLE });
  }

  private _setDecision(decision: ReactionDecisionState): void {
    this.decision = decision;
    this._deps.onDecisionChanged?.();
  }
}

/** Creates the reaction-flow ViewModel through the instrumented class factory. */
export const getCombatReactionFlowViewModel = (
  options: CombatReactionFlowViewModelOptions,
): CombatReactionFlowViewModelInterface => CombatReactionFlow.create(options);
