// apps/frontend/client/src/lib/views/combat/combat_companion_flow.svelte.ts
//
// Companion control-mode flow (C-526 AC-6).
//
// Owns the four §12.5 modes end to end on the client:
//
//   direct      the player owns the turn; the AI layer is never asked
//   suggest     the companion proposes a plan; the player edits or approves it
//   intent      as suggest, plus a persisted standing goal fed into the policy
//   autonomous  the companion decides; the player confirms under the SAME
//               preview/confirm policy (C-525 Q1: no auto-commit in this release)
//
// Extracted from `combat_view_model.svelte.ts` so the ~2,500-line ViewModel keeps
// rendering and delegating rather than growing a fifth decision loop.
//
// Reuse, not reinvention:
//   - the proposal is compiled by the SAME C-525 compiler the player's language
//     input uses (`compileActionIntent`), against the SAME engine snapshot;
//   - it is previewed through the SAME `CombatIntentPreview` shape the sidebar
//     already renders, with the same costs/risks/warnings;
//   - approving submits the decision through the SAME
//     `COMBAT_AI_DECISION_SUBMITTED` path, so the kernel still compiles and
//     re-validates every step and mode is never a second rules path.
//
// Nothing here commits a command by itself. `approve()` is the only method that
// reaches the engine, and it is reachable only from an explicit player action —
// which is what makes "changes invalidate obsolete proposals" and "duplicate
// approval cannot double-commit" hold.
//
// Contract: C-526 AC-6

import type { EngineBridge } from '@aikami/frontend/engine';
import { COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type { CombatState, CompanionControlMode, CompiledPlan, IntentStep } from '@aikami/types';
import { compileActionIntent } from '@aikami/utils';
import type { CombatIntentPreview } from './types/combat_direct_control.ts';

/** Bounded wait for the engine's state snapshot during a re-preview. */
const DEFAULT_SNAPSHOT_DEADLINE_MS = 2500;

/** The bridge slice this flow uses. */
export type CombatCompanionFlowBridge = Pick<EngineBridge, 'send' | 'on'>;

/** One companion's persisted preference. */
export type CompanionModePreference = {
  mode: CompanionControlMode;
  /** Standing goal for `intent` mode; empty for the other modes. */
  intent: string;
};

/** A decision awaiting the player's approval. */
export type CompanionProposal = {
  combatantId: string;
  /** The engine's decision request id — the ONLY id that may be submitted. */
  requestId: string;
  basedOnRevision: number;
  mode: CompanionControlMode;
  /** The step currently being previewed. */
  stepIndex: number;
  /** The full intent the player is approving (originally the model's). */
  steps: IntentStep[];
  fallback: IntentStep[];
  /** The compiled, uncommitted plan for the current step. */
  plan: CompiledPlan;
  preview: CombatIntentPreview;
  /** Editable target choices for a `use_ability` step. */
  targets: Array<{ combatantId: string; name: string }>;
  /** The standing goal the plan was produced under, when in `intent` mode. */
  intent: string;
};

export type CompanionDecisionState =
  | { status: 'idle' }
  | { status: 'awaiting_approval'; proposal: CompanionProposal }
  /** One step committed; more steps remain and require the player's approval. */
  | { status: 'partially_committed'; combatantId: string; remainingSteps: number }
  | { status: 'declined'; combatantId: string; reason: 'player' | 'stale' | 'withdrawn' };

export const IDLE_COMPANION_DECISION: CompanionDecisionState = { status: 'idle' };

export type CombatCompanionFlowDeps = {
  bridge(): CombatCompanionFlowBridge | undefined;
  /** The persisted preference for a companion, or undefined for a non-companion. */
  preferenceFor(combatantId: string): CompanionModePreference | undefined;
  /** Persists a preference change (party roster + policy seam). */
  persistPreference(change: { combatantId: string; preference: CompanionModePreference }): void;
  readRevision(): number;
  readEncounterId(): string;
  /** Display name for a combatant, for the proposal header. */
  displayNameFor(combatantId: string): string;
  /** Appends one narration line to the combat log. */
  appendLog(text: string): void;
  snapshotDeadlineMs?: number;
  debug?(event: string, data?: Record<string, unknown>): void;
};

type PendingSnapshot = {
  requestId: string;
  resolve(state: CombatState | undefined): void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Whether a produced AI decision for this actor must be approved by the player.
 *
 * Every companion mode except `direct` requires confirmation in this release;
 * `direct` never reaches this layer at all because the engine gives the turn to
 * the player.
 */
export const companionRequiresApproval = (mode: CompanionControlMode | undefined): boolean =>
  mode !== undefined && mode !== 'direct';

export class CombatCompanionFlow {
  /** The proposal the sidebar renders, plus its lifecycle state. */
  decision: CompanionDecisionState = $state({ ...IDLE_COMPANION_DECISION });

  /** Mode preferences, mirrored for the UI (the roster owns persistence). */
  modes: Record<string, CompanionControlMode> = $state({});

  private readonly _deps: CombatCompanionFlowDeps;
  private readonly _snapshotDeadlineMs: number;
  /** The snapshot the current proposal was compiled against. */
  private _state: CombatState | undefined;
  private _snapshot: PendingSnapshot | undefined;
  private _counter = 0;

  constructor(deps: CombatCompanionFlowDeps) {
    this._deps = deps;
    this._snapshotDeadlineMs = deps.snapshotDeadlineMs ?? DEFAULT_SNAPSHOT_DEADLINE_MS;
  }

  /** Whether a produced decision for `combatantId` must wait for the player. */
  requiresApproval(combatantId: string): boolean {
    const preference = this._deps.preferenceFor(combatantId);
    return preference === undefined ? false : companionRequiresApproval(preference.mode);
  }

  /** The compiled plan awaiting approval, if any. */
  get proposal(): CompanionProposal | null {
    return this.decision.status === 'awaiting_approval' ? this.decision.proposal : null;
  }

  /** Whether the flow is holding a player decision open. */
  get isAwaitingPlayer(): boolean {
    return this.decision.status === 'awaiting_approval';
  }

  /** Registers the bridge listeners this flow needs; returns a cleanup. */
  attach(): () => void {
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return () => {};
    }
    const removeSnapshot = bridge.on('COMBAT_STATE_SNAPSHOT', (event) => {
      this._resolveSnapshot(event.requestId, event.state);
    });
    const removeSnapshotRejected = bridge.on('COMBAT_STATE_SNAPSHOT_REJECTED', (event) => {
      this._resolveSnapshot(event.requestId, undefined);
    });
    const removeWithdrawn = bridge.on('COMBAT_AI_DECISION_WITHDRAWN', (event) => {
      const proposal = this.proposal;
      if (proposal === null || proposal.requestId !== event.requestId) {
        return;
      }
      // The engine no longer wants this decision (mode changed to `direct`):
      // drop the proposal WITHOUT submitting anything.
      this.decision = {
        status: 'declined',
        combatantId: proposal.combatantId,
        reason: 'withdrawn',
      };
      this._debug('proposalWithdrawn', { requestId: event.requestId });
    });
    return () => {
      removeSnapshot();
      removeSnapshotRejected();
      removeWithdrawn();
    };
  }

  /**
   * Presents a produced decision for approval instead of committing it.
   *
   * Called by the AI controller when {@link requiresApproval} is true; the
   * decision is untouched, so the engine still owns compilation and commit.
   */
  presentProposal(options: {
    requestId: string;
    combatantId: string;
    basedOnRevision: number;
    state: CombatState;
    /** The ordered steps to propose. The first is previewed. */
    steps: readonly IntentStep[];
    /** Fallback steps the engine may use when a step becomes illegal. */
    fallback?: readonly IntentStep[];
  }): void {
    const preference = this._deps.preferenceFor(options.combatantId);
    if (preference === undefined) {
      return;
    }
    if (this.decision.status === 'awaiting_approval') {
      // A newer proposal replaces the old one; the old one is abandoned, never
      // committed, so a duplicate approval can never double-commit.
      this._debug('proposalReplaced', {
        dropped: this.decision.proposal.requestId,
        incoming: options.requestId,
      });
    }
    this._state = options.state;
    const fallback = options.fallback ?? [];
    const compiled = this._compileStep({
      state: options.state,
      stepIndex: 0,
      steps: options.steps,
      fallback,
      combatantId: options.combatantId,
      basedOnRevision: options.basedOnRevision,
      revision: options.basedOnRevision,
    });
    if (compiled === undefined) {
      // Nothing legal to propose from this decision: fall back deterministically
      // rather than showing the player an unapprovable plan.
      this._debug('proposalUncompilable', { requestId: options.requestId });
      this.decline('stale');
      return;
    }
    this.decision = {
      status: 'awaiting_approval',
      proposal: {
        combatantId: options.combatantId,
        requestId: options.requestId,
        basedOnRevision: options.basedOnRevision,
        mode: preference.mode,
        stepIndex: 0,
        steps: [...options.steps],
        fallback: [...fallback],
        plan: compiled.plan,
        preview: compiled.preview,
        targets: compiled.targets,
        intent: preference.intent,
      },
    };
    this._debug('proposalPresented', {
      requestId: options.requestId,
      combatantId: options.combatantId,
      mode: preference.mode,
      steps: options.steps.length,
    });
  }

  /**
   * Commits the approved step and asks for the engine's decision.
   *
   * The engine re-validates and re-compiles against the CURRENT revision, so an
   * approval for a stale revision is refused there as well as here.
   */
  approve(): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return;
    }
    if (proposal.basedOnRevision !== this._deps.readRevision()) {
      // The fight moved on while the player deliberated: never approve a plan
      // that was grounded against a superseded state. Releasing the engine's
      // turn is what keeps the encounter moving.
      this._debug('approve:stale');
      this._abandon(proposal, 'stale');
      return;
    }
    // The approved step plays first; the remainder is re-approved step by step
    // so the kernel never executes a step the player has not seen.
    const approvedStep = proposal.steps[proposal.stepIndex];
    if (approvedStep === undefined) {
      this._abandon(proposal, 'stale');
      return;
    }
    const remaining = proposal.steps.slice(proposal.stepIndex + 1);
    bridge.send({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: proposal.requestId,
      encounterId: this._deps.readEncounterId(),
      combatantId: proposal.combatantId,
      stateRevision: proposal.basedOnRevision,
      decision: {
        decisionId: proposal.requestId,
        encounterId: this._deps.readEncounterId(),
        actorId: proposal.combatantId,
        basedOnRevision: proposal.basedOnRevision,
        goal: 'player_approved',
        intent: [approvedStep],
        fallback: proposal.fallback,
        confidence: 'high',
      },
    });
    this._deps.appendLog(`You take command of ${this._deps.displayNameFor(proposal.combatantId)}.`);
    if (remaining.length === 0 || proposal.stepIndex > 0) {
      this.decision = { status: 'idle' };
      return;
    }
    this.decision = {
      status: 'partially_committed',
      combatantId: proposal.combatantId,
      remainingSteps: remaining.length,
    };
  }

  /** Refuses the proposal — nothing is committed and the engine falls back. */
  decline(reason: 'player' | 'stale' = 'player'): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    this._debug('decline', { requestId: proposal.requestId, reason });
    this._abandon(proposal, reason);
  }

  /**
   * Drops a live proposal AND tells the engine it is gone.
   *
   * 🔴 This is not bookkeeping: an approval-required turn has no model deadline
   * (player deliberation is not an AI timeout), so a proposal dropped WITHOUT a
   * `decision: null` leaves the engine waiting for a submission that will never
   * come and deadlocks the encounter. Every path that abandons a proposal must
   * release the engine's turn — except {@link handleWithdrawn}, where the engine
   * already knows.
   */
  private _abandon(proposal: CompanionProposal, reason: 'player' | 'stale' | 'withdrawn'): void {
    const bridge = this._deps.bridge();
    bridge?.send({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: proposal.requestId,
      encounterId: this._deps.readEncounterId(),
      combatantId: proposal.combatantId,
      stateRevision: proposal.basedOnRevision,
      decision: null,
    });
    this._setDeclined(proposal.combatantId, reason);
  }

  /**
   * Re-points the current step at a specific target and re-previews it.
   *
   * The intent envelope is deliberately id-free (`combat_2.md` §11.1: the model
   * emits SELECTORS, deterministic code grounds them), so an exact choice is
   * expressed as an `explicit` named reference and grounded by the compiler —
   * the same path a player's "attack the goblin archer" takes. The requested
   * combatant id is used only to disambiguate the compiler's own candidate
   * plans, never to build a command.
   */
  editTarget(targetCombatantId: string): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    const step = proposal.steps[proposal.stepIndex];
    if (step === undefined || step.kind !== 'use_ability') {
      return;
    }
    const name = this._state?.combatants[targetCombatantId]?.name ?? targetCombatantId;
    const edited: IntentStep = {
      ...step,
      target: { kind: 'explicit', namedRef: name.slice(0, COMBAT_INTENT_BOUNDS.namedRefChars) },
    };
    void this._repreview(edited, targetCombatantId);
  }

  /**
   * Re-aims a `move` step at a range band and re-previews it.
   *
   * The envelope carries no exact cell (that is a trusted UI input the direct
   * controls own, not something the intent vocabulary can express), so the
   * editable choices are the grounded bands the compiler understands. An edit is
   * still a fresh compile, never a patched path.
   */
  editApproach(band: 'melee' | 'reach' | 'ranged'): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    const step = proposal.steps[proposal.stepIndex];
    if (step === undefined || step.kind !== 'move') {
      return;
    }
    const edited: IntentStep = {
      ...step,
      destination: { kind: 'relative', relativeTo: { kind: 'nearest_hostile' }, band },
    };
    void this._repreview(edited);
  }

  /** Changes a companion's mode (and standing goal) and tells the engine. */
  setMode(options: { combatantId: string; mode: CompanionControlMode; intent?: string }): void {
    const intent = options.mode === 'intent' ? (options.intent ?? '').trim() : '';
    if (intent.length > COMBAT_INTENT_BOUNDS.rawTextChars) {
      return;
    }
    const preference: CompanionModePreference = { mode: options.mode, intent };
    this.modes = { ...this.modes, [options.combatantId]: options.mode };
    this._deps.persistPreference({ combatantId: options.combatantId, preference });
    // A mode change invalidates an outstanding proposal: the interaction the
    // player is looking at no longer matches their preference.
    const proposal = this.proposal;
    if (proposal !== null && proposal.combatantId === options.combatantId) {
      // The player changed the interaction they were looking at, so the
      // proposal is void — but the engine's turn must be released first or the
      // fight waits for a decision that will never arrive.
      this._abandon(proposal, 'withdrawn');
    }
    const bridge = this._deps.bridge();
    bridge?.send({
      type: 'COMBAT_COMPANION_MODE_SET',
      encounterId: this._deps.readEncounterId(),
      combatantId: options.combatantId,
      mode: options.mode,
      ...(preference.intent.length === 0 ? {} : { intent: preference.intent }),
    });
    this._debug('setMode', { combatantId: options.combatantId, mode: options.mode });
  }

  /** The standing goal for a companion, for the decision policy. */
  standingIntent(combatantId: string): string | undefined {
    const intent = this._deps.preferenceFor(combatantId)?.intent ?? '';
    return intent.length === 0 ? undefined : intent;
  }

  /** Drops a proposal whose revision is gone (a newer revision superseded it). */
  invalidate(revision: number): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    if (proposal.basedOnRevision >= revision) {
      return;
    }
    this._debug('invalidate', { proposalRevision: proposal.basedOnRevision, revision });
    this._abandon(proposal, 'stale');
  }

  /**
   * Forgets everything (encounter start/end/disposal).
   *
   * A proposal that is still live releases the engine's turn first: disposal
   * can happen mid-encounter (the overlay closing), and the coordinator would
   * otherwise keep waiting on a decision nobody can make.
   */
  reset(): void {
    const proposal = this.proposal;
    if (proposal !== null) {
      this._abandon(proposal, 'stale');
    }
    this._clearSnapshot();
    this._state = undefined;
    this.decision = { ...IDLE_COMPANION_DECISION };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _setDeclined(combatantId: string, reason: 'player' | 'stale' | 'withdrawn'): void {
    this.decision = { status: 'declined', combatantId, reason };
  }

  /** Compiles one step of the proposal against a snapshot. */
  private _compileStep(options: {
    state: CombatState;
    stepIndex: number;
    steps: readonly IntentStep[];
    fallback: readonly IntentStep[];
    combatantId: string;
    basedOnRevision: number;
    revision: number;
    /** Disambiguates a clarification produced by an `explicit` name edit. */
    expectedTargetId?: string;
  }):
    | {
        plan: CompiledPlan;
        preview: CombatIntentPreview;
        targets: Array<{ combatantId: string; name: string }>;
      }
    | undefined {
    const step = options.steps[options.stepIndex];
    if (step === undefined) {
      return undefined;
    }
    const compiled = compileActionIntent({
      state: options.state,
      intent: {
        intentId: `${options.combatantId}:proposal:${options.stepIndex}`.slice(
          0,
          COMBAT_INTENT_BOUNDS.intentIdChars,
        ),
        encounterId: options.state.encounterId,
        actorId: options.combatantId,
        basedOnRevision: options.revision,
        source: 'ai_decision',
        steps: [step],
      },
    });
    if (!compiled.ok) {
      return undefined;
    }
    const plan =
      compiled.kind === 'plan'
        ? compiled.plan
        : // An `explicit` name can be ambiguous (two goblins). The compiler
          // answers with candidate plans; pick the one that actually targets the
          // combatant the player chose, and refuse if none does.
          compiled.plans.find((candidate) => commandTargets(candidate, options.expectedTargetId));
    if (plan === undefined) {
      return undefined;
    }
    return {
      plan,
      preview: toCompanionPreview(plan),
      targets: editableTargets(options.state, options.combatantId),
    };
  }

  /** Recompiles an edited step and republishes the proposal. */
  private async _repreview(edited: IntentStep, expectedTargetId?: string): Promise<void> {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    const state = await this._resolveState(proposal.basedOnRevision);
    if (state === undefined) {
      // The re-preview could not be grounded, so the proposal is abandoned —
      // and the engine's turn must be released with it.
      this._abandon(proposal, 'stale');
      return;
    }
    // The proposal may have been replaced while the snapshot was in flight.
    const current = this.proposal;
    if (current === null || current.requestId !== proposal.requestId) {
      return;
    }
    const steps = [...current.steps];
    steps[current.stepIndex] = edited;
    const compiled = this._compileStep({
      state,
      stepIndex: current.stepIndex,
      steps,
      fallback: current.fallback,
      combatantId: current.combatantId,
      basedOnRevision: current.basedOnRevision,
      revision: state.stateRevision,
      ...(expectedTargetId === undefined ? {} : { expectedTargetId }),
    });
    if (compiled === undefined) {
      // An illegal edit is refused without partial effects; the previous plan
      // stays on screen so the player can pick another target.
      this._debug('editRejected', { requestId: current.requestId });
      return;
    }
    this.decision = {
      status: 'awaiting_approval',
      proposal: {
        ...current,
        steps,
        plan: compiled.plan,
        preview: compiled.preview,
        targets: compiled.targets,
      },
    };
    this._debug('editRepreviewed', { requestId: current.requestId });
  }

  /** The snapshot for a revision: the cached one, else a bounded request. */
  private async _resolveState(revision: number): Promise<CombatState | undefined> {
    const cached = this._state;
    if (cached !== undefined && cached.stateRevision === revision) {
      return cached;
    }
    const bridge = this._deps.bridge();
    if (bridge === undefined) {
      return undefined;
    }
    const requestId = `companion-snapshot-${++this._counter}`;
    const state = await new Promise<CombatState | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this._snapshot = undefined;
        resolve(undefined);
      }, this._snapshotDeadlineMs);
      this._snapshot = { requestId, resolve, timer };
      bridge.send({
        type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
        requestId,
        encounterId: this._deps.readEncounterId(),
      });
    });
    if (state !== undefined && state.stateRevision === revision) {
      this._state = state;
      return state;
    }
    return undefined;
  }

  private _resolveSnapshot(requestId: string, state: CombatState | undefined): void {
    const pending = this._snapshot;
    if (pending === undefined || pending.requestId !== requestId) {
      return;
    }
    clearTimeout(pending.timer);
    this._snapshot = undefined;
    pending.resolve(state);
  }

  private _clearSnapshot(): void {
    const pending = this._snapshot;
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this._snapshot = undefined;
    pending.resolve(undefined);
  }

  private _debug(event: string, data?: Record<string, unknown>): void {
    this._deps.debug?.(event, data);
  }
}

/** Projects a compiled companion plan into the SAME preview shape the sidebar renders. */
export const toCompanionPreview = (plan: CompiledPlan): CombatIntentPreview => {
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

/** Whether a compiled candidate's command targets `combatantId`. */
const commandTargets = (plan: CompiledPlan, combatantId: string | undefined): boolean => {
  if (combatantId === undefined) {
    return false;
  }
  const command = plan.command;
  return command.kind === 'useAbility' && command.targetIds.includes(combatantId);
};

/** Every living combatant the acting companion could legally target instead. */
const editableTargets = (
  state: CombatState,
  actorId: string,
): Array<{ combatantId: string; name: string }> =>
  Object.values(state.combatants)
    .filter((combatant) => combatant.combatantId !== actorId && !combatant.defeated)
    .sort((left, right) => (left.combatantId < right.combatantId ? -1 : 1))
    .map((combatant) => ({ combatantId: combatant.combatantId, name: combatant.name }));

/** Builds the companion flow for one combat ViewModel. */
export const createCombatCompanionFlow = (deps: CombatCompanionFlowDeps): CombatCompanionFlow =>
  new CombatCompanionFlow(deps);
