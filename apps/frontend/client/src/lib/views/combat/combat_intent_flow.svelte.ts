// apps/frontend/client/src/lib/views/combat/combat_intent_flow.svelte.ts
//
// Natural-language decision loop for a combat surface (C-525 AC-4, AC-5).
//
// Extracted from `combat_view_model.svelte.ts` (C-525 R-1) so the ViewModel owns
// no decision logic: it delegates and renders.
//
// The loop is interpretation → compilation → preview → CONFIRMATION. Nothing in
// this module sends a mechanical command by itself except {@link
// CombatIntentFlow.confirm}, which is reachable only from an explicit player
// confirmation of a compiled plan (there is no auto-commit path in this
// release). Every asynchronous step is keyed to `requestId` AND the combat
// revision, so a superseded or stale answer can never become a preview.
//
// Contract: C-525 AC-4, AC-5

import { BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import type { EngineBridge } from '@aikami/frontend/engine';
import { COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type {
  CombatCommand,
  CombatState,
  CompiledPlan,
  IntentInterpreterResult,
} from '@aikami/types';
import { compileActionIntent } from '@aikami/utils';
import { buildAttemptNarration, type CombatAttemptKind } from './combat_narration.ts';
import type {
  CombatIntentDecisionState,
  CombatIntentPreview,
} from './types/combat_direct_control.ts';
import { IDLE_COMBAT_INTENT_DECISION } from './types/combat_direct_control.ts';

/**
 * The slice of the engine bridge this flow uses.
 *
 * Derived from the engine bridge so the ViewModel can pass its own bridge
 * directly — no assertion — and every `on(...)` handler receives the engine's
 * precisely typed payload.
 */
export type CombatIntentFlowBridge = Pick<EngineBridge, 'send' | 'on'>;

/** Everything the flow needs from its owner. */
export type CombatIntentFlowDeps = {
  /**
   * Whether the language surface is available at all (kill switch AND a v2
   * encounter — legacy fights keep their existing controls and prose flow).
   */
  isEnabled(): boolean;
  /**
   * How long to wait for the engine's state snapshot before giving up with a
   * typed rejection. The loop has no other exit from 'interpreting', so this
   * bound is what keeps a missing engine reply from hanging the UI.
   */
  snapshotDeadlineMs?: number;
  /** Model interpretation with the deterministic-parser fallback. */
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
  cancelRequest(requestId: string): void;
  /** The engine bridge, or undefined before initialization. */
  bridge(): CombatIntentFlowBridge | undefined;
  /** The revision the engine last reported. */
  readRevision(): number;
  /** The encounter id the engine last reported. */
  readEncounterId(): string;
  /** The authored combatant id of the player in the v2 kernel. */
  actorId: string;
  /** Name used by attempt narration. */
  readActorName(): string;
  /** Appends one narration entry to the combat log. */
  appendLog(text: string): void;
  /** Debug hook (the ViewModel's logger). */
  debug?(event: string, data?: Record<string, unknown>): void;
};

/** Projects a compiled plan into the editable preview the sidebar renders. */
export const toIntentPreview = (plan: CompiledPlan): CombatIntentPreview => {
  const command = plan.command;
  const destination = command.kind === 'move' ? (command.path.at(-1) ?? null) : null;
  const hitChance = plan.forecast.hitChance;
  return {
    planId: plan.planId,
    commandKind: command.kind,
    destination,
    movementCost: plan.forecast.movementCost ?? null,
    hitPercentage: hitChance === undefined ? null : Math.round(hitChance * 100),
    damageMinimum: plan.forecast.damageRange?.minimum ?? null,
    damageMaximum: plan.forecast.damageRange?.maximum ?? null,
    path: command.kind === 'move' ? command.path.map((cell) => ({ x: cell.x, y: cell.y })) : [],
    warnings: [...plan.warnings],
    assumptions: [...plan.assumptions],
    requiresConfirmation: true,
  };
};

/** Resolves narration names from the same snapshot that grounded the plan. */
const planDisplayNames = (
  state: CombatState,
  plan: CompiledPlan,
): { abilityName: string | null; targetName: string | null } => {
  if (plan.command.kind !== 'useAbility') {
    return { abilityName: null, targetName: null };
  }
  const targetId = plan.command.targetIds[0];
  return {
    abilityName: state.abilityCatalog[plan.command.abilityId]?.name ?? null,
    targetName: targetId === undefined ? null : (state.combatants[targetId]?.name ?? null),
  };
};

export class CombatIntentFlow {
  /** The decision the sidebar renders. */
  decision: CombatIntentDecisionState = $state({ ...IDLE_COMBAT_INTENT_DECISION });

  private readonly _deps: CombatIntentFlowDeps;
  private readonly _snapshotDeadlineMs: number;
  private _counter = 0;
  /** Bounded wait for the engine's state snapshot (never an unbounded hang). */
  private _snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last target a confirmed plan committed (feeds `previous_target`). */
  private _lastTargetId: string | undefined;

  constructor(deps: CombatIntentFlowDeps) {
    this._deps = deps;
    this._snapshotDeadlineMs = deps.snapshotDeadlineMs ?? 2500;
  }

  /** Whether the language surface is available at all. */
  get enabled(): boolean {
    return this._deps.isEnabled();
  }

  /** Whether the loop is waiting on the interpreter/compiler. */
  get isPending(): boolean {
    return (
      this.decision.status === 'interpreting' ||
      this.decision.status === 'compiling' ||
      this.decision.status === 'committed'
    );
  }

  /** The compiled preview awaiting explicit confirmation, if any. */
  get preview(): CombatIntentPreview | null {
    const plan = this.decision.plan;
    if (plan === null || this.decision.status !== 'awaiting_confirmation') {
      return null;
    }
    return toIntentPreview(plan);
  }

  /** Registers the bridge listeners this flow needs; returns a cleanup. */
  attach(): () => void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return () => {};
    }
    const removeDecisionPending = bridge.on('COMBAT_DECISION_PENDING', (event) => {
      if (event.requestId !== this.decision.requestId || event.state !== 'interpreting') {
        return;
      }
      if (this.decision.status !== 'interpreting') {
        return;
      }
      this._debug('decisionPending');
    });
    const removeSnapshot = bridge.on('COMBAT_STATE_SNAPSHOT', (event) => {
      this._handleStateSnapshot(event);
    });
    const removeSnapshotRejected = bridge.on('COMBAT_STATE_SNAPSHOT_REJECTED', (event) => {
      if (event.requestId !== this.decision.requestId) {
        return;
      }
      this._setRejection(event.messageKey);
    });
    return () => {
      removeDecisionPending();
      removeSnapshot();
      removeSnapshotRejected();
    };
  }

  /**
   * Submits player language.
   *
   * Never commits anything: it asks the engine for the live state, then
   * interprets and compiles. Order of operations per architecture §7.2.
   */
  submit(text: string): void {
    if (!this._deps.isEnabled()) {
      this._debug('submit:disabled');
      return;
    }
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      this._debug('submit:no-bridge');
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (trimmed.length > COMBAT_INTENT_BOUNDS.rawTextChars) {
      this._setRejection('combat.intent.too_long');
      return;
    }
    const revision = this._deps.readRevision();
    const encounterId = this._deps.readEncounterId();
    this._clearSnapshotDeadline();
    if (this.decision.requestId !== null) {
      this._deps.cancelRequest(this.decision.requestId);
    }
    const requestId = `intent-${++this._counter}`;
    this.decision = {
      status: 'interpreting',
      requestId,
      basedOnRevision: revision,
      text: trimmed,
      plan: null,
      abilityName: null,
      targetName: null,
      clarification: null,
      rejection: null,
    };
    bridge.send({
      type: 'COMBAT_LANGUAGE_INTENT_SUBMITTED',
      requestId,
      encounterId,
      basedOnRevision: revision,
      text: trimmed,
    });
    bridge.send({ type: 'COMBAT_STATE_SNAPSHOT_REQUESTED', requestId, encounterId });
    this._armSnapshotDeadline(requestId);
    this._debug('submit', { requestId, length: trimmed.length });
  }

  /** Picks one clarification reading and moves to confirmation. */
  chooseClarification(optionId: string): void {
    const option = this.decision.clarification?.options.find(
      (candidate) => candidate.optionId === optionId,
    );
    if (option === undefined) {
      return;
    }
    this._debug('chooseClarification', { optionId });
    this.decision = {
      ...this.decision,
      status: 'awaiting_confirmation',
      plan: option.plan,
      abilityName: option.abilityName,
      targetName: option.targetName,
      clarification: null,
    };
  }

  /** Commits the confirmed plan through the existing v2 command path. */
  confirm(): void {
    const plan = this.decision.plan;
    if (plan === null || this.decision.status !== 'awaiting_confirmation') {
      return;
    }
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    if (plan.basedOnRevision !== this._deps.readRevision()) {
      this._setRejection('combat.intent.stale');
      return;
    }
    // The single commit path: only an explicit confirmation reaches the kernel.
    this._commit(plan.command, bridge);
    // A reaction selection is not a committed action attempt: it is narrated
    // from the `reactionResolved` / `attackRolled` kernel events instead, so it
    // has no attempt template. Contract: C-532 AC-3.
    if (plan.command.kind !== 'resolveReaction' && plan.command.kind !== 'surrender') {
      this._deps.appendLog(
        buildAttemptNarration({
          kind: narrationKindFor(plan.command.kind),
          actorName: this._deps.readActorName(),
          ...(this.decision.abilityName === null ? {} : { abilityName: this.decision.abilityName }),
          ...(this.decision.targetName === null ? {} : { targetName: this.decision.targetName }),
        }),
      );
    }
    this._clearSnapshotDeadline();
    this.decision = {
      ...this.decision,
      status: 'committed',
      clarification: null,
      rejection: null,
    };
  }

  /** Cancels the outstanding decision — nothing is committed. */
  cancel(): void {
    this._clearSnapshotDeadline();
    const requestId = this.decision.requestId;
    if (requestId !== null) {
      this._deps.cancelRequest(requestId);
    }
    this.decision = { ...IDLE_COMBAT_INTENT_DECISION, basedOnRevision: this._deps.readRevision() };
  }

  /** Drops a decision whose revision is gone (a newer revision superseded it). */
  invalidate(revision: number): void {
    if (this.decision.status === 'idle') {
      return;
    }
    this._clearSnapshotDeadline();
    if (this.decision.requestId !== null) {
      this._deps.cancelRequest(this.decision.requestId);
    }
    this.decision = { ...IDLE_COMBAT_INTENT_DECISION, basedOnRevision: revision };
  }

  /** Forgets everything (encounter start/end). */
  reset(): void {
    this._clearSnapshotDeadline();
    this._lastTargetId = undefined;
    this.decision = { ...IDLE_COMBAT_INTENT_DECISION };
  }

  /**
   * Surfaces a rejected commit (R-5) — a refusal that arrives while a plan is
   * awaiting confirmation belongs on the language surface.
   */
  handleCommandRejected(messageKey: string): void {
    if (this.decision.status !== 'awaiting_confirmation' && this.decision.status !== 'committed') {
      return;
    }
    this._setRejection(messageKey);
  }

  /** The engine's v2 state snapshot the compiler grounds selectors against. */
  private _handleStateSnapshot(event: { requestId: string; state: CombatState }): void {
    const decision = this.decision;
    if (event.requestId !== decision.requestId) {
      return; // A reply for a superseded decision — never ground a stale intent.
    }
    if (decision.status !== 'interpreting' && decision.status !== 'compiling') {
      return;
    }
    this._clearSnapshotDeadline();
    if (event.state.stateRevision !== decision.basedOnRevision) {
      this._setRejection('combat.intent.stale');
      return;
    }
    if (event.state.encounterId !== this._deps.readEncounterId()) {
      this._setRejection('combat.intent.stale');
      return;
    }
    this.decision = { ...decision, status: 'compiling' };
    void this._runDecision(event.state);
  }

  /**
   * Interprets then compiles the pending instruction.
   *
   * The interpreter may use the model; the compiler never does. Both are keyed
   * to `requestId` + revision, so a late answer is dropped, not previewed.
   */
  private async _runDecision(state: CombatState): Promise<void> {
    const decision = this.decision;
    const requestId = decision.requestId;
    if (requestId === null) {
      return;
    }
    const result = await this._deps.interpretWithFallback({
      requestId,
      intentId: `${this._deps.readEncounterId()}:${requestId}`,
      encounterId: this._deps.readEncounterId(),
      actorId: this._deps.actorId,
      basedOnRevision: decision.basedOnRevision,
      text: decision.text,
      state,
    });
    if (this.decision.requestId !== requestId) {
      return; // Superseded while the interpreter ran.
    }
    if (this._deps.readRevision() !== decision.basedOnRevision) {
      this._setRejection('combat.intent.stale');
      return;
    }
    if (!result.ok) {
      this._setRejection(
        result.reason === 'ambiguous' ? 'combat.intent.ambiguous' : 'combat.intent.unresolved',
      );
      return;
    }
    const compiled = compileActionIntent({
      state,
      intent: result.intent,
      ...(this._lastTargetId === undefined
        ? {}
        : { history: { previousTargetId: this._lastTargetId } }),
    });
    if (!compiled.ok) {
      this._setRejection(compiled.messageKey);
      return;
    }
    if (compiled.kind === 'clarification') {
      const options = compiled.clarification.options.flatMap((option, index) => {
        const plan = compiled.plans[index] ?? compiled.plans[0];
        return plan === undefined
          ? []
          : [
              {
                optionId: option.optionId,
                labelKey: option.labelKey,
                plan,
                ...planDisplayNames(state, plan),
              },
            ];
      });
      this.decision = {
        ...this.decision,
        status: 'clarifying',
        plan: null,
        abilityName: null,
        targetName: null,
        clarification: { questionKey: compiled.clarification.questionKey, options },
      };
      return;
    }
    this.decision = {
      ...this.decision,
      status: 'awaiting_confirmation',
      plan: compiled.plan,
      ...planDisplayNames(state, compiled.plan),
      clarification: null,
    };
  }

  /** Commits one compiled command through the existing v2 command path. */
  private _commit(command: CombatCommand, bridge: CombatIntentFlowBridge): void {
    switch (command.kind) {
      case 'move': {
        const destination = command.path.at(-1);
        if (destination === undefined) {
          return;
        }
        bridge.send({ type: 'COMBAT_MOVE', cellX: destination.x, cellY: destination.y });
        return;
      }
      case 'useAbility': {
        const targetId = command.targetIds[0];
        if (targetId === undefined) {
          return;
        }
        this._lastTargetId = targetId;
        const numeric = Number(targetId);
        bridge.send({
          type: 'COMBAT_ACTION',
          action: command.abilityId === BASIC_MELEE_ABILITY_ID ? 'ATTACK' : 'ABILITY',
          abilityId: command.abilityId,
          targetId: Number.isNaN(numeric) ? targetId : numeric,
        });
        return;
      }
      case 'defend':
        bridge.send({ type: 'COMBAT_ACTION', action: 'DEFEND' });
        return;
      case 'wait':
        // `WAIT` is v2-kernel vocabulary the public `GameCommand` union does not
        // expose, and the v2 resolver resolves the bridge's `DEFEND` and `WAIT`
        // actions identically (`combat_v2_resolver.ts`). Send the declared one.
        bridge.send({ type: 'COMBAT_ACTION', action: 'DEFEND' });
        return;
      case 'endTurn':
        bridge.send({ type: 'COMBAT_END_TURN' });
        return;
      default:
        return;
    }
  }

  /**
   * Bounds the wait for the snapshot reply.
   *
   * The engine answers a snapshot request with `COMBAT_STATE_SNAPSHOT` or
   * `COMBAT_STATE_SNAPSHOT_REJECTED`, and that reply is the loop's ONLY
   * transition out of 'interpreting'. If neither arrives (worker not stepping,
   * encounter torn down mid-request, a dropped command) the surface would wait
   * forever, so it degrades to a typed rejection instead.
   */
  private _armSnapshotDeadline(requestId: string): void {
    this._clearSnapshotDeadline();
    this._snapshotTimer = setTimeout(() => {
      this._snapshotTimer = null;
      if (this.decision.requestId !== requestId || this.decision.status !== 'interpreting') {
        return;
      }
      this._debug('snapshot-timeout', { requestId });
      this._setRejection('combat.intent.unavailable');
    }, this._snapshotDeadlineMs);
  }

  private _clearSnapshotDeadline(): void {
    if (this._snapshotTimer !== null) {
      clearTimeout(this._snapshotTimer);
      this._snapshotTimer = null;
    }
  }

  /** Records a typed rejection on the language surface. */
  private _setRejection(messageKey: string): void {
    this._clearSnapshotDeadline();
    this._debug('rejected', { messageKey });
    this.decision = {
      ...this.decision,
      status: 'rejected',
      plan: null,
      abilityName: null,
      targetName: null,
      clarification: null,
      rejection: { messageKey },
    };
  }

  private _debug(event: string, data?: Record<string, unknown>): void {
    this._deps.debug?.(`intentFlow:${event}`, data);
  }
}

/** Builds the flow for one combat surface. */
/**
 * The narration family for one committed command kind.
 *
 * Ability and object interactions narrate differently from a plain command, so
 * they are named here rather than inline at the commit site.
 */
type NarratedCommandKind =
  | 'move'
  | 'retreat'
  | 'defend'
  | 'wait'
  | 'endTurn'
  | 'useAbility'
  | 'interactWithObject';

const narrationKindFor = (kind: NarratedCommandKind): CombatAttemptKind => {
  if (kind === 'useAbility') {
    return 'ability';
  }
  if (kind === 'interactWithObject') {
    return 'interact';
  }
  // A declared withdrawal is narrated as the movement it is. Surrender never
  // reaches this mapper: participationChanged narrates it after resolution.
  // Contract: C-532 AC-2.
  if (kind === 'retreat') {
    return 'move';
  }
  return kind;
};

export const createCombatIntentFlow = (deps: CombatIntentFlowDeps): CombatIntentFlow =>
  new CombatIntentFlow(deps);
