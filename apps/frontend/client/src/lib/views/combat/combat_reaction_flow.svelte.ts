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
};

const IDLE: ReactionDecisionState = {
  status: 'idle',
  prompt: null,
  secondsRemaining: null,
};

/** Stable i18n key for the reaction's cost. */
export const REACTION_COST_MESSAGE_KEY = 'combat.reaction.cost';

export class CombatReactionFlow {
  /** The decision surface's state. Plain, mirrored into runes by the ViewModel. */
  decision: ReactionDecisionState = { ...IDLE };

  private readonly _deps: CombatReactionFlowDeps;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _pending: ReactionPrompt | null = null;

  constructor(deps: CombatReactionFlowDeps) {
    this._deps = deps;
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
      this.decision = { ...IDLE };
    });
    const removeRejected = bridge.on('COMBAT_COMMAND_REJECTED', () => {
      // A stale or duplicate choice is refused by the kernel. Drop the prompt
      // WITHOUT spending anything — the engine owns the truth.
      if (this.decision.status === 'awaiting_player') {
        this._clearTimer();
        this._pending = null;
        this.decision = { ...IDLE };
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
    this.decision = {
      status: 'awaiting_player',
      prompt,
      // `null` is the default: NO default time limit.
      secondsRemaining: timerSeconds,
    };
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
    let remaining = seconds;
    this._timer = setInterval(() => {
      remaining -= 1;
      if (this.decision.status !== 'awaiting_player') {
        this._clearTimer();
        return;
      }
      if (remaining <= 0) {
        this._clearTimer();
        this._resolve('decline', 'timeout');
        return;
      }
      this.decision = { ...this.decision, secondsRemaining: remaining };
    }, 1000);
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
    this.decision = {
      status: 'resolved',
      prompt,
      secondsRemaining: null,
    };
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
      basedOnRevision: this._deps.readRevision(),
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
  }
}

export const createCombatReactionFlow = (deps: CombatReactionFlowDeps): CombatReactionFlow =>
  new CombatReactionFlow(deps);
