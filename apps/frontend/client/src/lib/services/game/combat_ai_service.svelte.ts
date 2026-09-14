// apps/frontend/client/src/lib/services/game/combat_ai_service.svelte.ts
//
// AI combat decision service (Combat-06).
//
// Mirrors the player interpreter's reliability contract (`combat_intent_service`)
// over the new `combat-ai` task preset:
//
//   - the model fills ONLY `AiCombatDecisionDraft`; the envelope identity
//     (`decisionId`/`encounterId`/`actorId`/`basedOnRevision`) is minted here
//     from the caller's request, so a model cannot forge it (AC-1, AC-3);
//   - ONE lifecycle for single and batch decisions: every decision id owns a
//     slot, every provider call owns a transport, and a batch is just several
//     slots sharing one transport (C-526 lifecycle repair);
//   - ONE time budget for the whole request group. Retries consume the
//     remaining budget instead of starting a fresh soft deadline, so two
//     attempts can never outlive the §18 hard budget (`combat_ai_lifecycle`);
//   - a soft timeout aborts the transport immediately and settles every
//     member, so no provider call is left running unobserved;
//   - cancellable and idempotent by `decisionId`; cancelling one batch member
//     never lets a later batch completion overwrite it, and the shared
//     transport is aborted only when its LAST member releases;
//   - a stale revision reply is discarded rather than applied (AC-3, AC-5);
//   - every attempt produces a `CombatAiDecisionRecord` (AC-3) with the
//     offline/timeout/invalid/stale/disabled/cancelled distinction preserved.
//
// The service NEVER throws: a provider failure is a typed failure, and the
// caller keeps the deterministic fallback playable (AC-4, AC-9).
//
// Contract: C-526 AC-3, AC-4, AC-5, AC-8, AC-9

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  AiCombatDecisionBatchDraftSchema,
  AiCombatDecisionDraftSchema,
  AiCombatDecisionSchema,
} from '@aikami/schemas';
import type {
  AiCombatDecision,
  CombatAiDecisionRecord,
  CombatAiDecisionRequest,
  CombatAiDecisionResult,
  CombatAiDegradedReason,
} from '@aikami/types';
import { Value } from 'typebox/value';
import {
  attemptWindowMs,
  type BoundedResultCache,
  createBoundedResultCache,
  createProviderTransport,
  createTimeBudget,
  type ProviderTransport,
  raceSoftDeadline,
} from './combat_ai_lifecycle';
import {
  buildCombatAiBatchPrompt,
  buildCombatAiPrompt,
  buildCombatAiSystemPrompt,
} from './combat_ai_prompt';

// ── Options ────────────────────────────────────────────────────────────────

/** Injected structured-output capability (the production wiring pins the task). */
export type CombatAiServiceOptions = BaseFrontendClassOptions & {
  text: {
    extractStructure(options: {
      schema: Record<string, unknown>;
      schemaName: string;
      prompt: string;
      systemPrompt?: string;
      signal?: AbortSignal;
      task?: string;
    }): Promise<unknown>;
  };
  /** Soft deadline in ms — defaults to the §18 budget (1.5 s). */
  softDeadlineMs?: number;
  /** Hard deadline in ms — defaults to the §18 budget (4 s). */
  hardDeadlineMs?: number;
  /** Terminal-result cache cap; defaults to {@link DEFAULT_CACHE_ENTRIES}. */
  maxCachedResults?: number;
  /** Telemetry provenance pinned by the composition root. */
  provider?: string;
  model?: string;
  /** Receives one telemetry record for every provider attempt. */
  onRecord?: (record: CombatAiDecisionRecord) => void;
  /**
   * Stale-revision predicate. When it returns true for a reply's revision, the
   * reply is discarded as `stale` instead of applied (AC-5).
   */
  isStale?: (revision: number) => boolean;
};

export type CombatAiServiceInterface = BaseFrontendClassInterface & {
  /** Requests one decision. Never throws; idempotent by `decisionId`. */
  decide(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult>;

  /**
   * Requests decisions for a same-squad batch in ONE provider call (AC-5).
   *
   * Each actor still gets its own validated, independently-failing decision,
   * and each member owns an independently cancellable lifecycle slot.
   */
  decideBatch(requests: readonly CombatAiDecisionRequest[]): Promise<CombatAiDecisionResult[]>;

  /** Cancels one outstanding decision by id (idempotent). */
  cancel(decisionId: string): void;

  /** Cancels every outstanding decision (e.g. encounter ended). */
  cancelAll(): void;

  /** Number of decisions currently in flight. */
  readonly activeDecisionCount: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_SOFT_DEADLINE_MS = 1500;
const DEFAULT_HARD_DEADLINE_MS = 4000;
const DEFAULT_CACHE_ENTRIES = 128;
const MAX_ATTEMPTS = 2;
const SCHEMA_NAME = 'AiCombatDecisionDraft';
const BATCH_SCHEMA_NAME = 'AiCombatDecisionBatchDraft';
const TASK = 'combat-ai';

/**
 * One decision id's lifecycle slot.
 *
 * Every decision — single or batch member — gets one of these, which is what
 * makes batch and single handling identical from the caller's point of view.
 */
type DecisionSlot = {
  readonly request: CombatAiDecisionRequest;
  readonly transportId: string;
  settled: boolean;
  result?: CombatAiDecisionResult;
  resolve(result: CombatAiDecisionResult): void;
  readonly promise: Promise<CombatAiDecisionResult>;
};

/** The draft shape a validated single response carries. */
type DecisionDraft = {
  goal: string;
  intent: AiCombatDecision['intent'];
  fallback: AiCombatDecision['fallback'];
  confidence: AiCombatDecision['confidence'];
  shortReason?: string;
  proposedLine?: string;
};

/**
 * The closed JSON-schema record the AI gateway expects for one decision call.
 *
 * Extracted from the call site so each `guard-ignore` sits ALONE on the line
 * above its cast — the type-safety guard only recognises that form, and an
 * inline `? // guard-ignore …` silently stops suppressing.
 */
const draftSchemaFor = (batch: boolean): Record<string, unknown> => {
  if (batch) {
    // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
    return AiCombatDecisionBatchDraftSchema as unknown as Record<string, unknown>;
  }
  // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
  return AiCombatDecisionDraftSchema as unknown as Record<string, unknown>;
};

class CombatAiService
  extends BaseFrontendClass<CombatAiServiceOptions>
  implements CombatAiServiceInterface
{
  private readonly _maxAttempts = MAX_ATTEMPTS;
  private readonly _softDeadlineMs: number;
  private readonly _hardDeadlineMs: number;
  private readonly _slots = new Map<string, DecisionSlot>();
  private readonly _transports = new Map<string, ProviderTransport>();
  private readonly _completed: BoundedResultCache<string, CombatAiDecisionResult>;
  /**
   * Results whose telemetry record was already emitted by the attempt loop.
   *
   * Telemetry is per ATTEMPT, not per settle: two invalid replies produce two
   * records plus the terminal one is the second attempt's own record. A
   * `cancel()` result is created outside the loop and emitted on settle.
   */
  private readonly _recorded = new WeakSet<CombatAiDecisionResult>();
  private _transportCounter = 0;

  constructor(options: CombatAiServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
    this._hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
    this._completed = createBoundedResultCache({
      maxEntries: options.maxCachedResults ?? DEFAULT_CACHE_ENTRIES,
    });
  }

  /** @inheritdoc */
  get activeDecisionCount(): number {
    return this._slots.size;
  }

  /** @inheritdoc */
  async decide(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult> {
    // Idempotency: a duplicate/late request for the same decision never issues
    // a second model call and never produces a different answer.
    const completed = this._completed.get(request.decisionId);
    if (completed !== undefined) {
      this.debug('decide:idempotent-hit', { decisionId: request.decisionId });
      return completed;
    }
    const slot = this._slots.get(request.decisionId);
    if (slot !== undefined) {
      return slot.promise;
    }
    const results = await this._runGroup([request], false);
    return results[0] ?? this._failure({ request, reason: 'invalid', latencyMs: 0 });
  }

  /** @inheritdoc */
  async decideBatch(
    requests: readonly CombatAiDecisionRequest[],
  ): Promise<CombatAiDecisionResult[]> {
    if (requests.length === 0) {
      return [];
    }
    if (requests.length === 1) {
      const only = requests[0];
      return only === undefined ? [] : [await this.decide(only)];
    }
    // A batch is only worth one provider call when at least two members still
    // need an answer; settled members short-circuit below.
    const fresh = requests.filter(
      (request) => !this._completed.has(request.decisionId) && !this._slots.has(request.decisionId),
    );
    if (fresh.length > 1) {
      await this._runGroup(fresh, true);
    } else if (fresh.length === 1) {
      const only = fresh[0];
      if (only !== undefined) {
        await this.decide(only);
      }
    }
    return await Promise.all(
      requests.map(async (request) => {
        const completed = this._completed.get(request.decisionId);
        if (completed !== undefined) {
          return completed;
        }
        const slot = this._slots.get(request.decisionId);
        if (slot !== undefined) {
          return await slot.promise;
        }
        return await this.decide(request);
      }),
    );
  }

  /** @inheritdoc */
  cancel(decisionId: string): void {
    const slot = this._slots.get(decisionId);
    if (slot === undefined || slot.settled) {
      return;
    }
    this.debug('cancel', { decisionId });
    this._settle(slot, this._failure({ request: slot.request, reason: 'cancelled', latencyMs: 0 }));
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this._slots.size });
    for (const decisionId of [...this._slots.keys()]) {
      this.cancel(decisionId);
    }
  }

  // ── Group lifecycle ──────────────────────────────────────────────────────

  /**
   * Runs one provider group: one transport, one time budget, N decision slots.
   *
   * Always resolves with one result per slot; a slot that was already settled
   * (e.g. cancelled, or a duplicate request) keeps its first result.
   */
  private async _runGroup(
    requests: readonly CombatAiDecisionRequest[],
    batch: boolean,
  ): Promise<CombatAiDecisionResult[]> {
    this._transportCounter += 1;
    const transport = createProviderTransport({ id: `combat-ai:${this._transportCounter}` });
    this._transports.set(transport.id, transport);

    const startedAt = Date.now();
    const budget = createTimeBudget({ startedAt, hardDeadlineMs: this._hardDeadlineMs });
    const hardAbort = { hit: false };
    // Safety net: every transport has a bounded lifetime even if a provider
    // ignores its AbortSignal entirely. Cleared by `settle()`/`abort()`.
    transport.armHardAbort(budget.remainingMs(startedAt), () => {
      hardAbort.hit = true;
      this.debug('decision:hard-deadline', { transport: transport.id });
    });

    const slots: DecisionSlot[] = [];
    for (const request of requests) {
      const existing = this._slots.get(request.decisionId);
      if (existing !== undefined) {
        slots.push(existing);
        continue;
      }
      const slot = this._createSlot({ request, transport });
      slots.push(slot);
    }

    const outcomes = await this._attemptLoop({
      transport,
      budget,
      slots,
      batch,
      startedAt,
      hardAbort,
    });

    for (const slot of slots) {
      if (slot.settled) {
        continue;
      }
      const reason: CombatAiDegradedReason = hardAbort.hit ? 'timeout' : 'cancelled';
      const result = outcomes.get(slot.request.decisionId);
      this._settle(
        slot,
        result ??
          this._failure({ request: slot.request, reason, latencyMs: Date.now() - startedAt }),
      );
    }

    if (transport.softTimedOut || transport.aborted) {
      transport.abort();
    } else {
      transport.settle();
    }
    this._transports.delete(transport.id);
    return slots.map(
      (slot) =>
        slot.result ?? this._failure({ request: slot.request, reason: 'invalid', latencyMs: 0 }),
    );
  }

  /** One attempt loop over the group's single time budget. */
  private async _attemptLoop(options: {
    transport: ProviderTransport;
    budget: ReturnType<typeof createTimeBudget>;
    slots: readonly DecisionSlot[];
    batch: boolean;
    startedAt: number;
    hardAbort: { hit: boolean };
  }): Promise<Map<string, CombatAiDecisionResult>> {
    const { transport, budget, slots, batch, startedAt, hardAbort } = options;
    const requests = slots.map((slot) => slot.request);
    const abortedReason = (): CombatAiDegradedReason => {
      // The hard deadline and a soft timeout are both "the answer did not
      // arrive in time"; only a member release is a genuine cancellation.
      if (hardAbort.hit || transport.softTimedOut) {
        return 'timeout';
      }
      return 'cancelled';
    };
    let lastReason: CombatAiDegradedReason = 'invalid';

    for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
      if (budget.expired()) {
        return this._fill(new Map(), requests, 'timeout', 0);
      }
      if (transport.aborted) {
        return this._fill(new Map(), requests, abortedReason(), 0);
      }
      const window = attemptWindowMs({ softDeadlineMs: this._softDeadlineMs, budget });
      const first = requests[0];
      if (first === undefined) {
        return new Map();
      }
      const prompt = batch
        ? buildCombatAiBatchPrompt({ contexts: requests.map((request) => request.context) })
        : buildCombatAiPrompt({ context: first.context });
      const schema = draftSchemaFor(batch);

      const outcome = await raceSoftDeadline({
        transport,
        softDeadlineMs: window,
        call: () =>
          this._text.extractStructure({
            schema,
            schemaName: batch ? BATCH_SCHEMA_NAME : SCHEMA_NAME,
            prompt,
            systemPrompt: buildCombatAiSystemPrompt(),
            signal: transport.signal,
            task: TASK,
          }),
      });
      const latencyMs = Date.now() - startedAt;

      if (outcome.kind === 'aborted') {
        return this._fill(new Map(), requests, abortedReason(), latencyMs);
      }
      if (outcome.kind === 'soft_timeout') {
        // The soft window expired: fall back NOW and abort the outstanding
        // transport so no provider call is left running unobserved.
        transport.markSoftTimedOut();
        this.debug('decision:soft-timeout', { actors: requests.length, attempt });
        return this._fill(new Map(), requests, 'timeout', latencyMs);
      }
      if (outcome.kind === 'rejected') {
        // A provider rejection (offline / refused) is not fixed by asking
        // again inside the same budget: fall back deterministically now so the
        // player's turn is not delayed by a second round trip.
        lastReason = 'offline';
        return this._fill(new Map(), requests, 'offline', latencyMs);
      }

      if (batch) {
        if (!Value.Check(AiCombatDecisionBatchDraftSchema, outcome.value)) {
          lastReason = 'invalid';
          // One record per actor per attempt: the shared call failed schema
          // validation, but each actor's lifecycle is still accounted for.
          const failures = this._attemptFailures(requests, 'invalid', latencyMs);
          if (attempt === this._maxAttempts || budget.expired()) {
            return failures;
          }
          continue;
        }
        const draft = outcome.value;
        const outcomes = new Map<string, CombatAiDecisionResult>();
        for (const slot of slots) {
          const perActor = draft.decisions[slot.request.actorId];
          outcomes.set(
            slot.request.decisionId,
            perActor === undefined
              ? this._failure({ request: slot.request, reason: 'invalid', latencyMs })
              : this._fromDraft({ request: slot.request, draft: perActor, latencyMs }),
          );
        }
        return outcomes;
      }

      if (!Value.Check(AiCombatDecisionDraftSchema, outcome.value)) {
        lastReason = 'invalid';
        this.debug('decide:invalid-draft', { attempt });
        const failures = this._attemptFailures(requests, 'invalid', latencyMs);
        if (attempt === this._maxAttempts || budget.expired()) {
          return failures;
        }
        continue;
      }
      const only = slots[0];
      if (only === undefined) {
        return new Map();
      }
      const result = this._fromDraft({ request: only.request, draft: outcome.value, latencyMs });
      if (result.ok) {
        return new Map([[only.request.decisionId, result]]);
      }
      lastReason = result.reason;
      if (result.reason === 'stale' || attempt === this._maxAttempts || budget.expired()) {
        return new Map([[only.request.decisionId, result]]);
      }
    }

    this.info('decide:failed', { actors: requests.length, attempts: this._maxAttempts });
    return this._fill(new Map(), requests, lastReason, Date.now() - startedAt);
  }

  /**
   * Builds AND records one telemetry record per request for a failed ATTEMPT.
   *
   * The returned results are the attempt's own outcomes. When the attempt loop
   * gives up they ARE the terminal results — so telemetry stays exactly one
   * record per attempt per decision instead of doubling the final one.
   */
  private _attemptFailures(
    requests: readonly CombatAiDecisionRequest[],
    reason: CombatAiDegradedReason,
    latencyMs: number,
  ): Map<string, CombatAiDecisionResult> {
    const failures = new Map<string, CombatAiDecisionResult>();
    for (const request of requests) {
      const failure = this._failure({ request, reason, latencyMs });
      this._emitRecord(failure.record);
      this._recorded.add(failure);
      failures.set(request.decisionId, failure);
    }
    return failures;
  }

  /** Fills a terminal failure for every request that has no outcome yet. */
  private _fill(
    outcomes: Map<string, CombatAiDecisionResult>,
    requests: readonly CombatAiDecisionRequest[],
    reason: CombatAiDegradedReason,
    latencyMs: number,
  ): Map<string, CombatAiDecisionResult> {
    for (const request of requests) {
      if (!outcomes.has(request.decisionId)) {
        outcomes.set(
          request.decisionId,
          this._failure({ request, reason, latencyMs: Math.max(0, latencyMs) }),
        );
      }
    }
    return outcomes;
  }

  /** Creates, registers and retains one decision slot on a transport. */
  private _createSlot(options: {
    request: CombatAiDecisionRequest;
    transport: ProviderTransport;
  }): DecisionSlot {
    let resolveSlot: (result: CombatAiDecisionResult) => void = () => {};
    const promise = new Promise<CombatAiDecisionResult>((resolve) => {
      resolveSlot = resolve;
    });
    const slot: DecisionSlot = {
      request: options.request,
      transportId: options.transport.id,
      settled: false,
      resolve: resolveSlot,
      promise,
    };
    options.transport.retain(options.request.decisionId);
    this._slots.set(options.request.decisionId, slot);
    return slot;
  }

  /**
   * Settles one slot at most once.
   *
   * Releasing the slot also releases its transport membership: a cancelled
   * batch member therefore cannot be overwritten by the batch's later
   * completion, and the shared provider call is aborted only when the last
   * member releases it.
   */
  private _settle(slot: DecisionSlot, result: CombatAiDecisionResult): void {
    if (slot.settled) {
      return;
    }
    slot.settled = true;
    const stored = this._remember(slot.request.decisionId, result);
    slot.result = stored;
    this._slots.delete(slot.request.decisionId);
    const transport = this._transports.get(slot.transportId);
    transport?.release(slot.request.decisionId);
    // Emit only for a result the attempt loop has not already recorded, and
    // only for a genuinely new terminal outcome — a duplicate settle for the
    // same id must not double-record telemetry.
    if (stored === result && !this._recorded.has(stored)) {
      this._emitRecord(stored.record);
      this._recorded.add(stored);
    }
    slot.resolve(stored);
  }

  /**
   * Stores a terminal result unless one is already recorded.
   *
   * Cancellation seeds a `cancelled` failure; a late provider reply must never
   * overwrite it, or a cancelled decision would become usable.
   */
  private _remember(decisionId: string, result: CombatAiDecisionResult): CombatAiDecisionResult {
    const existing = this._completed.get(decisionId);
    if (existing !== undefined) {
      return existing;
    }
    return this._completed.set(decisionId, result);
  }

  /** Mints the envelope identity around a validated draft. */
  private _fromDraft(options: {
    request: CombatAiDecisionRequest;
    draft: DecisionDraft;
    latencyMs: number;
  }): CombatAiDecisionResult {
    const { request, draft } = options;
    if (this._options.isStale?.(request.basedOnRevision) === true) {
      this.info('decide:stale-reply', { decisionId: request.decisionId });
      return this._failure({ request, reason: 'stale', latencyMs: options.latencyMs });
    }
    const decision: AiCombatDecision = {
      decisionId: request.decisionId,
      encounterId: request.encounterId,
      actorId: request.actorId,
      basedOnRevision: request.basedOnRevision,
      goal: draft.goal,
      intent: draft.intent,
      fallback: draft.fallback,
      confidence: draft.confidence,
      ...(draft.shortReason === undefined ? {} : { shortReason: draft.shortReason }),
      ...(draft.proposedLine === undefined ? {} : { proposedLine: draft.proposedLine }),
    };
    if (!Value.Check(AiCombatDecisionSchema, decision)) {
      return this._failure({ request, reason: 'invalid', latencyMs: options.latencyMs });
    }
    this.debug('decide:ok', { decisionId: request.decisionId, steps: decision.intent.length });
    return {
      ok: true,
      decision,
      latencyMs: options.latencyMs,
      record: this._record({
        request,
        decisionId: request.decisionId,
        source: 'llm',
        latencyMs: options.latencyMs,
        goal: decision.goal,
        confidence: decision.confidence,
        ...(decision.shortReason === undefined ? {} : { rationale: decision.shortReason }),
      }),
      ...(this._provider === undefined ? {} : { provider: this._provider }),
      ...(this._model === undefined ? {} : { model: this._model }),
    };
  }

  /** Builds a typed failure and its telemetry record. */
  private _failure(options: {
    request: CombatAiDecisionRequest;
    reason: CombatAiDegradedReason;
    latencyMs: number;
  }): CombatAiDecisionResult {
    return {
      ok: false,
      reason: options.reason,
      latencyMs: options.latencyMs,
      record: this._record({
        request: options.request,
        decisionId: options.request.decisionId,
        source: 'fallback',
        latencyMs: options.latencyMs,
        reason: options.reason,
      }),
      ...(this._provider === undefined ? {} : { provider: this._provider }),
      ...(this._model === undefined ? {} : { model: this._model }),
    };
  }

  /** Telemetry record — provider/model/latency/fallback, never a secret. */
  private _record(options: {
    request?: CombatAiDecisionRequest;
    decisionId: string;
    source: 'llm' | 'fallback';
    latencyMs: number;
    reason?: CombatAiDegradedReason;
    goal?: string;
    confidence?: AiCombatDecision['confidence'];
    rationale?: string;
  }): CombatAiDecisionRecord {
    const request = options.request;
    const record: CombatAiDecisionRecord = {
      decisionId: options.decisionId,
      encounterId: request?.encounterId ?? 'unknown',
      actorId: request?.actorId ?? 'unknown',
      basedOnRevision: request?.basedOnRevision ?? 0,
      source: options.source,
      latencyMs: options.latencyMs,
      ...(options.reason === undefined ? {} : { fallbackReason: options.reason }),
      ...(options.goal === undefined ? {} : { goal: options.goal }),
      ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
      ...(options.rationale === undefined ? {} : { rationale: options.rationale }),
      ...(this._provider === undefined ? {} : { provider: this._provider }),
      ...(this._model === undefined ? {} : { model: this._model }),
    };
    return record;
  }

  /** Emits one attempt record through the optional telemetry sink. */
  private _emitRecord(record: CombatAiDecisionRecord): void {
    try {
      this._options.onRecord?.(record);
    } catch (error: unknown) {
      this.error('record-sink-failed', error);
    }
  }

  private get _text(): CombatAiServiceOptions['text'] {
    return this._options.text;
  }

  private get _provider(): string | undefined {
    return this._options.provider;
  }

  private get _model(): string | undefined {
    return this._options.model;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Builds an AI decision service over the injected `text.extractStructure`
 * capability. Production wiring pins the `combat-ai` task preset there.
 */
export const getCombatAiService = (options: CombatAiServiceOptions): CombatAiServiceInterface =>
  CombatAiService.create(options);
