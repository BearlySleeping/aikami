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

import { COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type { CombatState, CompanionControlMode, CompiledPlan, IntentStep } from '@aikami/types';
import { compileActionIntent } from '@aikami/utils';
import {
  type CombatCompanionFlowDeps,
  type CompanionDecisionState,
  type CompanionModePreference,
  type CompanionProposal,
  commandTargets,
  companionRequiresApproval,
  editableTargets,
  IDLE_COMPANION_DECISION,
  toCompanionPreview,
} from './combat_companion_preview.ts';
import type { CombatIntentPreview } from './types/combat_direct_control.ts';

/** Bounded wait for the engine's state snapshot during a re-preview. */
const DEFAULT_SNAPSHOT_DEADLINE_MS = 2500;

type PendingSnapshot = {
  requestId: string;
  resolve(state: CombatState | undefined): void;
  timer: ReturnType<typeof setTimeout>;
};

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
  /** Invalidates superseded asynchronous re-preview chains. */
  private _repreviewGeneration = 0;
  /**
   * The remaining steps of an acknowledged step-wise plan (AC-6).
   *
   * Set when the player approves a step that is not the last. The engine then
   * re-requests the next decision at the new revision and {@link continuationFor}
   * hands these steps to the controller so it presents them instead of planning
   * a fresh decision.
   */
  private _continuation:
    | { combatantId: string; steps: IntentStep[]; fallback: IntentStep[]; stepIndex: number }
    | undefined;
  /** The requestId of the submission currently being activated, if any. */
  private _activeRequestId: string | undefined;

  constructor(deps: CombatCompanionFlowDeps) {
    this._deps = deps;
    this._snapshotDeadlineMs = deps.snapshotDeadlineMs ?? DEFAULT_SNAPSHOT_DEADLINE_MS;
  }

  /** Whether a produced decision for `combatantId` must wait for the player. */
  requiresApproval(combatantId: string): boolean {
    const preference = this._deps.preferenceFor(combatantId);
    return preference === undefined ? false : companionRequiresApproval(preference.mode);
  }

  /** Whether a companion is in `direct` mode (player-owned turn). */
  isDirect(combatantId: string): boolean {
    return this._deps.preferenceFor(combatantId)?.mode === 'direct';
  }

  /** The remaining steps of a step-wise plan the engine is continuing. */
  continuationFor(
    combatantId: string,
  ):
    | { steps: readonly IntentStep[]; fallback: readonly IntentStep[]; stepIndex: number }
    | undefined {
    if (this.decision.status !== 'partially_committed') {
      return undefined;
    }
    const continuation = this._continuation;
    if (continuation === undefined || continuation.combatantId !== combatantId) {
      return undefined;
    }
    return {
      steps: continuation.steps,
      fallback: continuation.fallback,
      stepIndex: continuation.stepIndex,
    };
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
      this._continuation = undefined;
      this.decision = {
        status: 'declined',
        combatantId: proposal.combatantId,
        reason: 'withdrawn',
      };
      this._debug('proposalWithdrawn', { requestId: event.requestId });
    });
    const removeStepResolved = bridge.on('COMBAT_AI_STEP_RESOLVED', (event) => {
      // Only steps this flow submitted are ours to interpret.
      if (this._activeRequestId === undefined || event.requestId !== this._activeRequestId) {
        return;
      }
      this._activeRequestId = undefined;
      this._debug('stepResolved', {
        actorId: event.actorId,
        committed: event.committed,
        partial: event.partial,
        continues: event.continues,
      });
      if (event.continues) {
        // Keep `_continuation`; the engine has already re-requested the next
        // decision and the controller will present it with those steps.
        return;
      }
      this._continuation = undefined;
      if (!event.committed) {
        this._deps.appendLog(
          `${this._deps.displayNameFor(event.actorId)}'s plan could not be carried out.`,
        );
      } else if (event.partial) {
        this._deps.appendLog(
          `${this._deps.displayNameFor(event.actorId)}'s plan was only partly carried out.`,
        );
      }
      if (
        this.decision.status === 'partially_committed' &&
        this.decision.combatantId === event.actorId
      ) {
        this.decision = { ...IDLE_COMPANION_DECISION };
      }
    });
    return () => {
      removeSnapshot();
      removeSnapshotRejected();
      removeWithdrawn();
      removeStepResolved();
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
    /** The step being presented after an earlier step was approved. */
    stepIndex?: number;
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
    this._repreviewGeneration += 1;
    this._state = options.state;
    const fallback = options.fallback ?? [];
    const stepIndex = options.stepIndex ?? 0;
    const compiled = this._compileStep({
      state: options.state,
      stepIndex,
      steps: options.steps,
      fallback,
      combatantId: options.combatantId,
      basedOnRevision: options.basedOnRevision,
      revision: options.basedOnRevision,
    });
    if (compiled === undefined) {
      // Nothing legal to propose from this decision. Never commit on the
      // model's behalf and never authorise the fallback: surface an actionable
      // recovery (Replan / Take Control / End Turn) instead of an invisible wait.
      this._debug('proposalUncompilable', { requestId: options.requestId });
      this.decision = {
        status: 'recovery',
        combatantId: options.combatantId,
        reason: 'uncompilable',
        requestId: options.requestId,
        basedOnRevision: options.basedOnRevision,
      };
      return;
    }
    this.decision = {
      status: 'awaiting_approval',
      proposal: {
        combatantId: options.combatantId,
        requestId: options.requestId,
        basedOnRevision: options.basedOnRevision,
        mode: preference.mode,
        stepIndex,
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
   * Commits the approved step.
   *
   * A step-wise plan is submitted ONE approved step at a time. The engine
   * activates it, emits `COMBAT_AI_STEP_RESOLVED`, and (when more remain)
   * re-requests the next decision at the new revision. The flow does NOT reuse
   * the consumed requestId — the acknowledged continuation mints a fresh engine
   * request and recompiles the next step against the current revision, so the
   * player never approves a step they have not seen.
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
      this._debug('approve:stale');
      this._recover(proposal, 'stale');
      return;
    }
    const approvedStep = proposal.steps[proposal.stepIndex];
    if (approvedStep === undefined) {
      this._recover(proposal, 'uncompilable');
      return;
    }
    const remaining = proposal.steps.slice(proposal.stepIndex + 1);
    const stepwise = remaining.length > 0;
    // Block a duplicate approval immediately: the consumed requestId must never
    // be submitted twice.
    this.decision = {
      status: 'partially_committed',
      combatantId: proposal.combatantId,
      remainingSteps: remaining.length,
    };
    this._activeRequestId = proposal.requestId;
    this._continuation = stepwise
      ? {
          combatantId: proposal.combatantId,
          steps: [...proposal.steps],
          fallback: [...proposal.fallback],
          stepIndex: proposal.stepIndex + 1,
        }
      : undefined;
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
      stepwise,
    });
    this._deps.appendLog(`You take command of ${this._deps.displayNameFor(proposal.combatantId)}.`);
  }

  /**
   * The player declined the plan.
   *
   * Declining commits nothing and never authorises the fallback: it opens the
   * recovery surface so the player explicitly chooses Replan, Take Control or
   * End Turn (C-526 AC-6).
   */
  decline(reason: 'player' | 'stale' = 'player'): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    this._debug('decline', { requestId: proposal.requestId, reason });
    this._recover(proposal, reason === 'player' ? 'declined' : 'stale');
  }

  /** Recovery: ask the engine to re-request a decision at the current revision. */
  replan(): void {
    const pending = this._recoveryRequest();
    if (pending === undefined) {
      return;
    }
    this._debug('replan', { requestId: pending.requestId });
    this._resolve(pending, 'stale');
  }

  /** Recovery: end the actor's turn without spending anything. */
  endTurn(): void {
    const pending = this._recoveryRequest();
    if (pending === undefined) {
      return;
    }
    this._debug('endTurn', { requestId: pending.requestId });
    this._resolve(pending, 'end_turn');
  }

  /** Recovery: hand the turn to the player by switching to `direct`. */
  takeControl(): void {
    const pending = this._recoveryRequest();
    if (pending === undefined) {
      return;
    }
    this.setMode({ combatantId: pending.combatantId, mode: 'direct' });
  }

  /** Moves a live proposal to the recovery surface (nothing is submitted). */
  private _recover(
    proposal: CompanionProposal,
    reason: 'uncompilable' | 'stale' | 'declined',
  ): void {
    this._continuation = undefined;
    this.decision = {
      status: 'recovery',
      combatantId: proposal.combatantId,
      reason,
      requestId: proposal.requestId,
      basedOnRevision: proposal.basedOnRevision,
    };
  }

  /** The open request behind a recovery state, if any. */
  private _recoveryRequest():
    | { requestId: string; combatantId: string; basedOnRevision: number }
    | undefined {
    const decision = this.decision;
    if (decision.status !== 'recovery') {
      return undefined;
    }
    return {
      requestId: decision.requestId,
      combatantId: decision.combatantId,
      basedOnRevision: decision.basedOnRevision,
    };
  }

  /**
   * Sends an explicit typed resolution for a pending request.
   *
   * The engine distinguishes an authorised `fallback` from `stale`/`decline`/
   * `end_turn`, so abandoning a plan can never silently authorise an attack.
   */
  private _resolve(
    request: { requestId: string; combatantId: string; basedOnRevision: number },
    resolution: 'stale' | 'decline' | 'end_turn',
  ): void {
    this._deps.bridge()?.send({
      type: 'COMBAT_AI_DECISION_SUBMITTED',
      requestId: request.requestId,
      encounterId: this._deps.readEncounterId(),
      combatantId: request.combatantId,
      stateRevision: request.basedOnRevision,
      decision: null,
      resolution,
    });
    this._continuation = undefined;
    this._activeRequestId = undefined;
    this.decision = {
      status: 'declined',
      combatantId: request.combatantId,
      reason: resolution === 'stale' ? 'stale' : 'player',
    };
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

    // A local plan was grounded under the OLD preference. Switching to `direct`
    // hands the turn to the player — the engine's `refresh()` withdraws the
    // pending decision — so the local surface is dropped WITHOUT a fallback.
    // Every other target keeps the same open request; only the mode changes.
    if (this._ownsActor(options.combatantId)) {
      if (options.mode === 'direct') {
        this._continuation = undefined;
        this._activeRequestId = undefined;
        this.decision = {
          status: 'declined',
          combatantId: options.combatantId,
          reason: 'withdrawn',
        };
      } else if (this.decision.status === 'awaiting_approval') {
        this.decision = {
          status: 'awaiting_approval',
          proposal: { ...this.decision.proposal, mode: options.mode },
        };
      }
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

  /** Whether the flow currently holds a surface owned by `combatantId`. */
  private _ownsActor(combatantId: string): boolean {
    const decision = this.decision;
    if (decision.status === 'awaiting_approval') {
      return decision.proposal.combatantId === combatantId;
    }
    if (decision.status === 'partially_committed' || decision.status === 'recovery') {
      return decision.combatantId === combatantId;
    }
    return false;
  }

  /** The standing goal for a companion, for the decision policy. */
  standingIntent(combatantId: string): string | undefined {
    const intent = this._deps.preferenceFor(combatantId)?.intent ?? '';
    return intent.length === 0 ? undefined : intent;
  }

  /** Moves a proposal whose revision is gone to the recovery surface. */
  invalidate(revision: number): void {
    const proposal = this.proposal;
    if (proposal === null) {
      return;
    }
    if (proposal.basedOnRevision >= revision) {
      return;
    }
    this._debug('invalidate', { proposalRevision: proposal.basedOnRevision, revision });
    // Nothing is committed and the fallback is NOT authorised: the player gets
    // the recovery surface (Replan / Take Control / End Turn).
    this._recover(proposal, 'stale');
  }

  /**
   * Forgets everything (encounter start/end/disposal).
   *
   * A live proposal/recovery releases the engine's turn with an explicit
   * `decline` (never the fallback), so disposing mid-encounter cannot leave the
   * coordinator waiting on a decision nobody can make — and a teardown can
   * never authorise an attack.
   */
  reset(): void {
    this._repreviewGeneration += 1;
    const live = this.proposal;
    if (live !== null) {
      this._resolve(
        {
          requestId: live.requestId,
          combatantId: live.combatantId,
          basedOnRevision: live.basedOnRevision,
        },
        'decline',
      );
    } else {
      const pending = this._recoveryRequest();
      if (pending !== undefined) {
        this._resolve(pending, 'decline');
      }
    }
    this._clearSnapshot();
    this._state = undefined;
    this._continuation = undefined;
    this._activeRequestId = undefined;
    this.decision = { ...IDLE_COMPANION_DECISION };
  }

  // ── Internals ────────────────────────────────────────────────────────────

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
    const generation = ++this._repreviewGeneration;
    const state = await this._resolveState(proposal.basedOnRevision);
    if (state === undefined) {
      // The re-preview could not be grounded: surface recovery (nothing is
      // submitted and the fallback is not authorised).
      const current = this.proposal;
      if (
        generation === this._repreviewGeneration &&
        current !== null &&
        current.requestId === proposal.requestId
      ) {
        this._recover(current, 'stale');
      }
      return;
    }
    // The proposal may have been replaced while the snapshot was in flight.
    const current = this.proposal;
    if (
      generation !== this._repreviewGeneration ||
      current === null ||
      current.requestId !== proposal.requestId
    ) {
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
    this._clearSnapshot();
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

/** Builds the companion flow for one combat ViewModel. */
export const createCombatCompanionFlow = (deps: CombatCompanionFlowDeps): CombatCompanionFlow =>
  new CombatCompanionFlow(deps);
