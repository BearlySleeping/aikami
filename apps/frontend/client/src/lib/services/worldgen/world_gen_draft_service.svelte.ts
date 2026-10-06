// apps/frontend/client/src/lib/services/worldgen/world_gen_draft_service.svelte.ts
//
// G01 — private narrative-world draft orchestration.
//
// What this service is FOR: turning wizard answers into a bounded, coherent,
// durable PRIVATE DRAFT, with run identity, cancellation and stage
// checkpoints.
//
// What this service is NOT FOR, and what it therefore never calls:
// `subscribeToWorld`, `addLocation`, `addNpc`, any `seed*` method, or
// `setWorldGenOutput`. In G01 a generated world has no playable form and no
// live-world meaning at all, so the ONLY thing that happens after the user
// accepts a draft is that the draft row's status becomes `accepted_preview`.
// Nothing is published to the combat GM context: the wizard's preview is a
// private draft row the player can read, not narrative state the running game
// would pick up. `WorldGenSeedingService.assembleGmPrompt` therefore keeps
// reading whatever world-seed output the live game already had, untouched.
//
// Lifecycle invariants (each pinned by a test in world_gen_draft_service.test):
//
//   I1  ONE run at a time. Duplicate `generate` intents return no new result
//       and cannot start a second pipeline.
//   I2  ONE absolute deadline per run, shared by every stage of that run, so
//       four stages cannot each restart the clock — and the run checks that
//       deadline BEFORE each attempt, so a provider that ignores the deadline
//       still cannot drag the orchestration past it.
//   I3  ONE AbortController per run. Navigation, edit, restart, explicit
//       cancel and dispose all abort it synchronously.
//   I4  A late completion from a superseded run is dropped. Run identity AND
//       abort state are re-checked immediately before every mutation of
//       anything shared — accumulator, checkpoints, attempt counts, run state
//       and persistence results.
//   I5  Abort NEVER retries. A cancelled run ends.
//   I6  A stage that succeeded is never re-issued because a sibling failed.
//       Only stages with no valid checkpoint are retried.
//   I7  Durable reload is distinguishable from the in-memory cache: a draft
//       the service still holds in memory is not evidence that it was saved.
//   I8  ONE acceptance at a time. Concurrent `accept()` calls share a single
//       write, and an acceptance whose draft has been superseded by a newer
//       revision may not claim the result.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  parseWorldGenDraft,
  schemaCheck,
  unreadableStorageDiagnostic,
  validateWorldGenDraft,
  WORLD_GEN_DRAFT_SCHEMA_VERSION,
  type WorldGenDraft,
  type WorldGenDraftDiagnostic,
  type WorldGenDraftInput,
  WorldGenDraftInputSchema,
  type WorldGenDraftStage,
} from '@aikami/schemas';
import type {
  WorldGenDraftPersistence,
  WorldGenDraftRunState,
  WorldGenDraftStore,
  WorldGenDraftStoreResolver,
  WorldGenDraftTextCapabilities,
} from './types/world_gen_draft_service.types.ts';
import {
  createDraftAccumulator,
  disambiguateNames,
  type WorldGenDraftAccumulator,
} from './world_gen_draft_builder.ts';
import {
  accumulatorFromDraft,
  checkpointsFromDraft,
  cloneAccumulator,
  readLatestStoredDraft,
  readStoredDraft,
} from './world_gen_draft_hydration.ts';
import {
  invalidatedStages,
  stagesInvalidatedBy,
  WORLD_GEN_STAGE_LABELS,
  WORLD_GEN_STAGES,
} from './world_gen_stage_graph.ts';
import {
  type PipelineRun,
  runPipeline,
  type StageRunnerPort,
  stageContext,
} from './world_gen_stage_runner.ts';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Options for constructing the service. */
export type WorldGenDraftServiceOptions = BaseFrontendClassOptions & {
  text: WorldGenDraftTextCapabilities;
  resolveStore: WorldGenDraftStoreResolver;
  /** Wall-clock budget for one whole run, shared across its stages. */
  runBudgetMs?: number;
  /** Total attempts per invalidated stage, including the first. */
  maxAttemptsPerStage?: number;
};

/** Public interface. */
export type WorldGenDraftServiceInterface = BaseFrontendClassInterface & {
  readonly run: WorldGenDraftRunState | undefined;
  readonly draft: WorldGenDraft | undefined;
  readonly persistence: WorldGenDraftPersistence;
  readonly diagnostics: readonly WorldGenDraftDiagnostic[];
  generate(options: { input: WorldGenDraftInput }): Promise<WorldGenDraft | undefined>;
  cancel(reason?: string): void;
  accept(): Promise<WorldGenDraft | undefined>;
  /** Re-reads the draft from the device store, bypassing the in-memory cache. */
  reload(): Promise<WorldGenDraft | undefined>;
  /**
   * Hydrates from the newest durable draft.
   *
   * This is what a REAL browser reload needs: a service rebuilt from scratch
   * holds no `_draft`, so `reload()` has no id to ask the store for. Call it
   * once at production start-up; it is a no-op while a run is live.
   */
  initialize(): Promise<WorldGenDraft | undefined>;
  dispose(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Whole-run wall-clock budget, shared by every stage and retry. */
const WORLD_GEN_DRAFT_RUN_BUDGET_MS = 120_000;

/** Attempts per invalidated stage, including the first. */
const WORLD_GEN_DRAFT_MAX_ATTEMPTS = 3;

/**
 * The live run, as the pipeline's shape. Aliased rather than re-declared so the
 * service's `_active` and the object `runPipeline` receives cannot drift.
 */
type ActiveRun = PipelineRun & Pick<WorldGenDraftRunState, 'draftId' | 'revision'>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class WorldGenDraftService
  extends BaseFrontendClass<WorldGenDraftServiceOptions>
  implements WorldGenDraftServiceInterface
{
  private readonly _text: WorldGenDraftTextCapabilities;
  private readonly _resolveStore: WorldGenDraftStoreResolver;
  private readonly _runBudgetMs: number;
  private readonly _maxAttempts: number;

  private _run = $state<WorldGenDraftRunState | undefined>(undefined);
  private _draft = $state<WorldGenDraft | undefined>(undefined);
  private _persistence = $state<WorldGenDraftPersistence>('unknown');
  private _diagnostics = $state<WorldGenDraftDiagnostic[]>([]);

  /** Live run with detached data; retired promises cannot write through to its successor. */
  private _active: ActiveRun | undefined;

  /** Retry/edit progress, detached from retired runs at every terminal transition. */
  private _session: {
    accumulator: WorldGenDraftAccumulator;
    checkpoints: Map<WorldGenDraftStage, string>;
  } = { accumulator: createDraftAccumulator(), checkpoints: new Map() };

  /** Single-flight durable acceptance; concurrent callers share one guarded write. */
  private _acceptance:
    | { draftId: string; revision: number; promise: Promise<WorldGenDraft | undefined> }
    | undefined;

  private _disposed = false;

  constructor(options: WorldGenDraftServiceOptions) {
    super(options);
    this._text = options.text;
    this._resolveStore = options.resolveStore;
    this._runBudgetMs = options.runBudgetMs ?? WORLD_GEN_DRAFT_RUN_BUDGET_MS;
    this._maxAttempts = options.maxAttemptsPerStage ?? WORLD_GEN_DRAFT_MAX_ATTEMPTS;
  }

  get run(): WorldGenDraftRunState | undefined {
    return this._run;
  }

  get draft(): WorldGenDraft | undefined {
    return this._draft;
  }

  get persistence(): WorldGenDraftPersistence {
    return this._persistence;
  }

  get diagnostics(): readonly WorldGenDraftDiagnostic[] {
    return this._diagnostics;
  }

  // ── Generation ──────────────────────────────────────────────────────────

  async generate(options: { input: WorldGenDraftInput }): Promise<WorldGenDraft | undefined> {
    // A duplicate intent must neither admit work nor claim an old draft as its result.
    if (this._active !== undefined) {
      this.debug('generate:already-running', { runId: this._active.runId });
      return undefined;
    }
    if (this._disposed) {
      return undefined;
    }

    const active = this._beginRun(options.input);
    if (active === undefined) {
      return undefined;
    }
    const { runId, draftId, revision, controller } = active;

    try {
      await runPipeline(this._stageRunner(active, options.input), active);
    } catch (error) {
      if (controller.signal.aborted) {
        this._finishCancelled(runId, 'Cancelled');
        return undefined;
      }
      this._finishFailed(runId, error);
      return undefined;
    }

    // I4 — re-check identity immediately before writing. A run that was
    // aborted while awaiting cannot publish its result.
    if (!this._ownsRun(runId)) {
      this.debug('generate:stale-run-dropped', { runId });
      return undefined;
    }

    const draft = this._buildDraft(active, draftId, revision, options.input);
    if (draft === undefined) {
      this._finishFailed(runId, new Error('No stage produced a draft.'));
      return undefined;
    }

    // A run is complete only when EVERY stage has a checkpoint. Without this a
    // stage that exhausted its retries would silently yield a draft with that
    // section missing — the exact "half a world" outcome this milestone exists
    // to prevent.
    const missing = WORLD_GEN_STAGES.filter((stage) => !active.checkpoints.has(stage));
    if (missing.length > 0) {
      this._finishFailed(
        runId,
        new Error(
          `Draft is incomplete — these stages produced nothing: ${missing
            .map(worldGenStageLabel)
            .join(', ')}.`,
        ),
      );
      return undefined;
    }

    if (!this._validateProposal(active, draft)) {
      return undefined;
    }

    const complete: WorldGenDraft = { ...draft, status: 'complete' };
    this._draft = complete;
    const completedRunState: WorldGenDraftRunState = {
      ...(this._run as WorldGenDraftRunState),
      status: 'running',
      completedStages: [...active.checkpoints.keys()],
    };
    this._run = completedRunState;
    this._session = { accumulator: active.accumulator, checkpoints: active.checkpoints };

    // A complete draft is a normal stop. Persistence is best-effort but never
    // silent: if the device store is unavailable the run is still complete and
    // `_persistence` says 'memory' so the UI can tell the truth.
    //
    // `_active` is cleared only AFTER the write settles, because the run is
    // still the live run for as long as this run is the one being written.
    // Clearing it first would make every run's own persistence result look
    // like a superseded run's and silently pin `_persistence` to 'unknown'.
    await this._persist(complete, runId);
    if (!this._ownsRun(runId)) {
      return undefined;
    }
    this._run = { ...completedRunState, status: 'complete' };
    this._active = undefined;
    return complete;
  }

  /** Validates inputs before hashing, provider admission or checkpoint invalidation. */
  private _beginRun(input: WorldGenDraftInput): ActiveRun | undefined {
    const runId = crypto.randomUUID();
    const draftId = this._draft?.draftId ?? crypto.randomUUID();
    const revision = (this._draft?.revision ?? -1) + 1;
    this._diagnostics = [];
    this._run = {
      runId,
      draftId,
      revision,
      status: 'running',
      completedStages: [],
      failures: [],
      error: undefined,
    };
    if (!schemaCheck(WorldGenDraftInputSchema, input) || !Number.isSafeInteger(revision)) {
      this._run = {
        ...this._run,
        status: 'failed',
        error: 'Draft inputs or revision exceed the supported bounds.',
      };
      return undefined;
    }
    const previous = this._session;
    const changed = new Set<WorldGenDraftStage>(
      invalidatedStages(previous.checkpoints, stageContext(input, previous.accumulator)),
    );
    for (const stage of stagesInvalidatedBy(changed)) {
      previous.checkpoints.delete(stage);
    }
    const active: ActiveRun = {
      runId,
      draftId,
      revision,
      controller: new AbortController(),
      deadlineAt: Date.now() + this._runBudgetMs,
      accumulator: cloneAccumulator(previous.accumulator),
      checkpoints: new Map(previous.checkpoints),
      attempts: new Map<WorldGenDraftStage, number>(),
    };
    this._active = active;
    return active;
  }

  // ── Cancellation ────────────────────────────────────────────────────────

  cancel(reason = 'Cancelled'): void {
    const active = this._active;
    if (active === undefined) {
      return;
    }
    // I3 — abort is synchronous; the awaiting stage observes it and the run
    // stops. I5 — cancellation is terminal and never enters the retry loop.
    active.controller.abort();
    this._finishCancelled(active.runId, reason);
  }

  // ── Acceptance ──────────────────────────────────────────────────────────

  /**
   * Accepts the current draft, in private, durably.
   *
   * Idempotent: accepting twice returns the same accepted draft and performs
   * no second write. Refuses while a run is live — accepting a half-generated
   * draft is exactly the incoherence this milestone exists to remove.
   *
   * Writes exactly ONE thing: the draft row's status. No campaign, world-state
   * node, NPC, map or save is touched, and nothing is published to the live
   * combat GM context — the wizard's preview is this row, read back by the
   * wizard, and nothing else.
   *
   * Single-flight (I8): a concurrent caller joins the in-flight acceptance
   * instead of opening a second write, and if the draft is superseded while
   * the write is in flight the result is discarded rather than claimed.
   */
  async accept(): Promise<WorldGenDraft | undefined> {
    const inFlight = this._acceptance;
    if (inFlight !== undefined) {
      this.debug('accept:joined-in-flight', {
        draftId: inFlight.draftId,
        revision: inFlight.revision,
      });
      return inFlight.promise;
    }

    const draft = this._draft;
    if (draft === undefined) {
      return undefined;
    }
    if (this._active !== undefined) {
      this.warn('accept:run-in-flight');
      return undefined;
    }
    if (draft.status === 'accepted_preview') {
      this.debug('accept:already-accepted', { draftId: draft.draftId });
      return draft;
    }

    const diagnostics = validateWorldGenDraft(draft);
    if (diagnostics.length > 0) {
      this._diagnostics = diagnostics;
      this.warn('accept:invalid-draft', { count: diagnostics.length });
      return undefined;
    }

    const revision = draft.revision;
    const promise = this._runAcceptance(draft, revision);
    this._acceptance = { draftId: draft.draftId, revision, promise };
    try {
      return await promise;
    } finally {
      // Cleared on success AND on failure: a stuck latch would make every
      // later accept a no-op forever.
      if (this._acceptance?.promise === promise) {
        this._acceptance = undefined;
      }
    }
  }

  /** The guarded body of one acceptance. Never called without the latch set. */
  private async _runAcceptance(
    draft: WorldGenDraft,
    revision: number,
  ): Promise<WorldGenDraft | undefined> {
    const accepted: WorldGenDraft = { ...draft, status: 'accepted_preview' };

    // Durable write first: if the device store refuses, the in-memory draft
    // must NOT advance to 'accepted', or a reload would resurrect a draft the
    // user was told was saved but which was not.
    const persisted = await this._persist(accepted, undefined, revision);
    if (!persisted) {
      return undefined;
    }

    // A cancel, a new generate or a dispose may have landed while the write was
    // in flight. Advancing `_draft` now would resurrect a superseded draft over
    // whatever the newer run produced.
    if (this._disposed || this._active !== undefined || this._draft?.revision !== revision) {
      this.warn('accept:superseded', { revision, current: this._draft?.revision });
      return undefined;
    }

    this._draft = accepted;
    return accepted;
  }

  // ── Durable reload ──────────────────────────────────────────────────────

  async reload(): Promise<WorldGenDraft | undefined> {
    const draftId = this._draft?.draftId;
    if (draftId === undefined) {
      return undefined;
    }
    const observedRunId = this._run?.runId;
    const store = await this._safeStore();
    if (!this._canHydrate(observedRunId)) {
      return undefined;
    }
    if (store === undefined) {
      this._persistence = 'memory';
      return undefined;
    }
    const read = await readStoredDraft(store, draftId);
    if (!this._canHydrate(observedRunId)) {
      return undefined;
    }
    if (!read.ok) {
      this.warn('reload:failed', { reason: read.reason });
      this._persistence = 'memory';
      return undefined;
    }
    this._persistence = read.draft === undefined ? 'memory' : 'durable';
    if (read.draft !== undefined) {
      this._adopt(read.draft);
    }
    return read.draft;
  }

  /**
   * Hydrates the newest validated private draft after a page reload.
   * Rejects unreadable rows and reads superseded by generation or disposal.
   */
  async initialize(): Promise<WorldGenDraft | undefined> {
    if (this._active !== undefined || this._disposed) {
      return this._draft;
    }
    const observedRunId = this._run?.runId;
    const store = await this._safeStore();
    if (!this._canHydrate(observedRunId)) {
      return undefined;
    }
    if (store === undefined) {
      this._persistence = 'memory';
      return undefined;
    }
    const read = await readLatestStoredDraft(store);
    if (!this._canHydrate(observedRunId)) {
      return undefined;
    }
    if (!read.ok) {
      // Fail CLOSED and say so. Silently returning "no draft" for a row that
      // is on disk but unreadable is how a player concludes their work was
      // never saved.
      this.warn('initialize:failed', { reason: read.reason });
      this._diagnostics = [...this._diagnostics, unreadableStorageDiagnostic(read.reason)];
      this._persistence = 'memory';
      return undefined;
    }
    if (read.draft === undefined) {
      // The store answered, and the answer was "nothing here". That IS durable
      // knowledge, so the persistence state says so rather than guessing.
      this._persistence = 'durable';
      return undefined;
    }
    this._persistence = 'durable';
    this._adopt(read.draft);
    return read.draft;
  }

  /**
   * Installs a loaded draft as both the current draft and the checkpoint
   * session, so a re-run reuses its stages instead of re-billing the provider.
   */
  private _canHydrate(observedRunId: string | undefined): boolean {
    return !this._disposed && this._active === undefined && this._run?.runId === observedRunId;
  }

  private _adopt(draft: WorldGenDraft): void {
    this._draft = draft;
    this._session = {
      accumulator: accumulatorFromDraft(draft),
      checkpoints: checkpointsFromDraft(draft) as Map<WorldGenDraftStage, string>,
    };
  }

  // ── Disposal ────────────────────────────────────────────────────────────

  override async dispose(): Promise<void> {
    this._disposed = true;
    // Cancel first so the run reaches its terminal `cancelled` state rather
    // than vanishing — the same path a navigation takes.
    this.cancel('Draft service disposed');
    this._active = undefined;
    this._acceptance = undefined;
    await super.dispose();
  }

  // ── Private — stage results ─────────────────────────────────────────────

  /** Pipeline capabilities; this service remains the run-identity authority. */
  private _stageRunner(active: ActiveRun, input: WorldGenDraftInput): StageRunnerPort {
    return {
      text: this._text,
      maxAttempts: this._maxAttempts,
      budgetMs: this._runBudgetMs,
      input,
      ownsRun: (runId) => this._ownsRun(runId),
      publishProgress: (completedStages, failures) => {
        if (!this._ownsRun(active.runId)) {
          return;
        }
        this._run = {
          ...(this._run as WorldGenDraftRunState),
          completedStages,
          failures: failures.map((failure) => ({
            stage: failure.stage,
            message: failure.message,
          })),
        };
      },
      debug: (event, data) => {
        this.debug(event, data);
      },
    };
  }

  /** Whether `runId` is still the live run. The single I4 predicate. */
  private _ownsRun(runId: string): boolean {
    return this._active?.runId === runId && !this._active.controller.signal.aborted;
  }

  // ── Private — draft assembly ────────────────────────────────────────────

  private _buildDraft(
    active: ActiveRun,
    draftId: string,
    revision: number,
    input: WorldGenDraftInput,
  ): WorldGenDraft | undefined {
    const { setting, cast, places, arcs, hudWidgets } = active.accumulator;
    if (setting === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    const uniqueNames = disambiguateNames(cast.map((npc) => npc.name));
    return {
      schemaVersion: WORLD_GEN_DRAFT_SCHEMA_VERSION,
      draftId,
      runId: active.runId,
      revision,
      status: 'in_progress',
      // Literal invariants: this draft is a preview and is not playable.
      preview: true,
      playable: false,
      createdAt: this._draft?.createdAt ?? now,
      updatedAt: now,
      input,
      setting,
      // Labels are disambiguated here, ids stay exactly as allocated during the
      // cast stage, so every reference already resolved in `arcs` still points
      // at the right character.
      cast: cast.map((npc, index) => ({ ...npc, name: uniqueNames[index] as string })),
      places,
      arcs,
      hudWidgets,
      checkpoints: [...active.checkpoints.entries()].map(([stage, fingerprint]) => ({
        stage,
        fingerprint,
        completedAt: now,
      })),
    };
  }

  /** Reject invalid aggregates without retaining their checkpoints for Retry. */
  private _validateProposal(active: ActiveRun, draft: WorldGenDraft): boolean {
    const parsed = parseWorldGenDraft(draft);
    this._diagnostics = validateWorldGenDraft(draft);
    if (parsed.ok) {
      return true;
    }
    active.checkpoints.clear();
    const reason =
      this._diagnostics.length > 0 ? _describeDiagnostics(this._diagnostics) : parsed.reason;
    this._finishFailed(active.runId, new Error(reason));
    return false;
  }

  private _finishCancelled(runId: string, reason = 'Cancelled'): void {
    if (this._run?.runId !== runId) {
      return;
    }
    const active = this._active;
    this._run = {
      ...this._run,
      status: 'cancelled',
      error: reason,
      completedStages: active === undefined ? [] : [...active.checkpoints.keys()],
    };
    // Carry the progress forward BY CLONE. The run's own map may still be
    // written to by a stage that has not observed its abort yet, and adopting
    // that same object would let it write through into the next run.
    if (active !== undefined) {
      this._session = {
        accumulator: cloneAccumulator(active.accumulator),
        checkpoints: new Map(active.checkpoints),
      };
    }
    this._active = undefined;
    this.debug('run:cancelled', { runId, reason });
  }

  private _finishFailed(runId: string, error: unknown): void {
    if (this._run?.runId !== runId) {
      return;
    }
    const active = this._active;
    this._run = {
      ...this._run,
      status: 'failed',
      error: error instanceof Error ? error.message : 'World generation failed.',
      completedStages: active === undefined ? [] : [...active.checkpoints.keys()],
    };
    // A failed run still yields its checkpoints (I6: the retry must not redo
    // the stages that worked), cloned for the same reason as on cancellation.
    if (active !== undefined) {
      this._session = {
        accumulator: cloneAccumulator(active.accumulator),
        checkpoints: new Map(active.checkpoints),
      };
    }
    this._active = undefined;
    this.warn('run:failed', { runId, error });
  }

  /**
   * Writes the draft, and reports whether it reached the device store.
   *
   * @param runId - when given, `_persistence` is only updated while that run
   * is still live. A superseded run's late persistence result must not claim
   * 'durable' for a draft the user is no longer looking at.
   * @param revision - when given, additionally requires the current draft to
   * still be at this revision before reporting the outcome.
   */
  private async _persist(
    draft: WorldGenDraft,
    runId?: string,
    revision?: number,
  ): Promise<boolean> {
    const store = await this._safeStore();
    if (this._disposed || (runId !== undefined && !this._ownsRun(runId))) {
      return false;
    }
    if (revision !== undefined && this._draft?.revision !== revision) {
      return false;
    }
    if (store === undefined) {
      this._settlePersistence('memory', runId, revision);
      return false;
    }
    try {
      await store.upsert(draft);
      this._settlePersistence('durable', runId, revision);
      return true;
    } catch (error) {
      // I7 — a persistence failure downgrades to 'memory' and says so. It is
      // never reported as durable and never retried silently.
      this.warn('persist:failed', { draftId: draft.draftId, error });
      this._settlePersistence('memory', runId, revision);
      return false;
    }
  }

  /** Applies a persistence outcome unless the write belonged to a dead run. */
  private _settlePersistence(
    value: WorldGenDraftPersistence,
    runId: string | undefined,
    revision: number | undefined,
  ): void {
    if (this._disposed) {
      return;
    }
    if (runId !== undefined && !this._ownsRun(runId)) {
      this.debug('persist:dropped-for-superseded-run', { runId, value });
      return;
    }
    if (revision !== undefined && this._draft?.revision !== revision) {
      this.debug('persist:dropped-for-superseded-revision', { revision, value });
      return;
    }
    this._persistence = value;
  }

  private async _safeStore(): Promise<WorldGenDraftStore | undefined> {
    try {
      return await this._resolveStore();
    } catch (error) {
      this.warn('resolveStore:failed', { error });
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Renders validation diagnostics as one human-readable sentence. */
const _describeDiagnostics = (diagnostics: readonly WorldGenDraftDiagnostic[]): string =>
  diagnostics
    .map((diagnostic) => `${diagnostic.path || 'draft'}: ${diagnostic.message}`)
    .join('; ');

/** Human label for a stage id, tolerating an unknown id. */
const worldGenStageLabel = (stage: string): string =>
  WORLD_GEN_STAGE_LABELS[stage as WorldGenDraftStage] ?? stage;

/** Builds a draft service from explicit capabilities. */
export const createWorldGenDraftService = (
  options: WorldGenDraftServiceOptions,
): WorldGenDraftServiceInterface => WorldGenDraftService.create(options);
