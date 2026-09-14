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
//   - bounded retry (2 attempts) on an invalid/partial response;
//   - soft deadline → typed failure immediately, hard deadline → abort;
//   - cancellable and idempotent by `decisionId`; a duplicate request returns
//     the first result instead of a second model call;
//   - a stale revision reply is discarded rather than applied (AC-3, AC-5);
//   - every attempt produces a `CombatAiDecisionRecord` (AC-3).
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
   * Each actor still gets its own validated, independently-failing decision.
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
const MAX_ATTEMPTS = 2;
const SCHEMA_NAME = 'AiCombatDecisionDraft';
const BATCH_SCHEMA_NAME = 'AiCombatDecisionBatchDraft';
const TASK = 'combat-ai';

/** Sentinel for "the provider did not answer inside the soft deadline". */
const TIMED_OUT: unique symbol = Symbol('combat-ai-decision-timeout');
/** The provider rejected/errored — a deterministic fallback is warranted. */
const PROVIDER_ERROR: unique symbol = Symbol('combat-ai-provider-error');
/** The request was aborted (hard deadline or cancellation). */
const ABORTED: unique symbol = Symbol('combat-ai-aborted');
type DraftReply = unknown | typeof TIMED_OUT | typeof PROVIDER_ERROR | typeof ABORTED;

class CombatAiService
  extends BaseFrontendClass<CombatAiServiceOptions>
  implements CombatAiServiceInterface
{
  private readonly _maxAttempts = MAX_ATTEMPTS;
  private readonly _softDeadlineMs: number;
  private readonly _hardDeadlineMs: number;
  private readonly _controllers = new Map<string, AbortController>();
  private readonly _batchControllers = new Map<string, AbortController>();
  private readonly _activeRequests = new Map<string, CombatAiDecisionRequest>();
  private readonly _inFlight = new Map<string, Promise<CombatAiDecisionResult>>();
  private readonly _completed = new Map<string, CombatAiDecisionResult>();

  constructor(options: CombatAiServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
    this._hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  }

  /**
   * Stores a terminal result unless a cancellation already recorded one.
   *
   * Cancellation seeds `_completed` with a `stale` failure; a late provider
   * reply must never overwrite it, or a cancelled decision would become usable.
   */
  private _remember(decisionId: string, result: CombatAiDecisionResult): CombatAiDecisionResult {
    const existing = this._completed.get(decisionId);
    if (existing !== undefined) {
      return existing;
    }
    this._completed.set(decisionId, result);
    return result;
  }

  /** @inheritdoc */
  get activeDecisionCount(): number {
    return this._controllers.size + this._batchControllers.size;
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
    const inFlight = this._inFlight.get(request.decisionId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = this._run(request).finally(() => {
      this._inFlight.delete(request.decisionId);
    });
    this._inFlight.set(request.decisionId, promise);
    return promise;
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

    const fresh = new Map<string, CombatAiDecisionRequest>();
    for (const request of requests) {
      if (
        !this._completed.has(request.decisionId) &&
        !this._inFlight.has(request.decisionId) &&
        !fresh.has(request.decisionId)
      ) {
        fresh.set(request.decisionId, request);
      }
    }
    const freshRequests = [...fresh.values()];
    if (freshRequests.length > 0) {
      const batchPromise = this._runBatch(freshRequests);
      for (const [index, request] of freshRequests.entries()) {
        const promise = batchPromise
          .then((results) =>
            this._remember(
              request.decisionId,
              results[index] ?? this._failure({ request, reason: 'invalid', latencyMs: 0 }),
            ),
          )
          .finally(() => {
            if (this._inFlight.get(request.decisionId) === promise) {
              this._inFlight.delete(request.decisionId);
            }
          });
        this._inFlight.set(request.decisionId, promise);
      }
    }
    return await Promise.all(
      requests.map((request) => {
        const completed = this._completed.get(request.decisionId);
        if (completed !== undefined) {
          return completed;
        }
        const inFlight = this._inFlight.get(request.decisionId);
        return inFlight ?? this.decide(request);
      }),
    );
  }

  /** @inheritdoc */
  cancel(decisionId: string): void {
    const controller = this._controllers.get(decisionId);
    const batchController = this._batchControllers.get(decisionId);
    const request = this._activeRequests.get(decisionId);
    if (controller === undefined && batchController === undefined) {
      return;
    }
    this.debug('cancel', { decisionId });
    const completed = this._completed.get(decisionId);
    if (completed !== undefined) {
      controller?.abort();
      this._controllers.delete(decisionId);
      this._batchControllers.delete(decisionId);
      this._activeRequests.delete(decisionId);
      if (
        batchController !== undefined &&
        ![...this._batchControllers.values()].includes(batchController)
      ) {
        batchController.abort();
      }
      return;
    }
    // A cancelled decision is stale by definition: it must never be applied.
    const result =
      request === undefined
        ? {
            ok: false as const,
            reason: 'stale' as const,
            latencyMs: 0,
            record: this._record({
              request: undefined,
              decisionId,
              source: 'fallback',
              latencyMs: 0,
              reason: 'stale',
            }),
          }
        : this._failure({ request, reason: 'stale', latencyMs: 0 });
    this._emitRecord(result.record);
    this._remember(decisionId, result);
    controller?.abort();
    this._controllers.delete(decisionId);
    this._batchControllers.delete(decisionId);
    this._activeRequests.delete(decisionId);
    if (
      batchController !== undefined &&
      ![...this._batchControllers.values()].includes(batchController)
    ) {
      batchController.abort();
    }
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this.activeDecisionCount });
    const decisionIds = new Set([...this._controllers.keys(), ...this._batchControllers.keys()]);
    for (const decisionId of decisionIds) {
      this.cancel(decisionId);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Runs one uncached decision request with bounded retry and deadlines. */
  private async _run(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult> {
    const controller = new AbortController();
    this._controllers.set(request.decisionId, controller);
    this._activeRequests.set(request.decisionId, request);
    let preserveHardAbort = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearTimeout(hardTimer);
      if (this._controllers.get(request.decisionId) === controller) {
        this._controllers.delete(request.decisionId);
        this._activeRequests.delete(request.decisionId);
      }
    };
    const hardTimer = setTimeout(() => {
      controller.abort();
      cleanup();
    }, this._hardDeadlineMs);
    const startedAt = Date.now();

    try {
      const prompt = buildCombatAiPrompt({ context: request.context });
      let lastReason: CombatAiDegradedReason = 'invalid';

      for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
        const draftReply = await this._requestDraft({
          prompt,
          schemaName: SCHEMA_NAME,
          // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
          schema: AiCombatDecisionDraftSchema as unknown as Record<string, unknown>,
          controller,
        });
        const raw = draftReply.reply;
        if (raw === TIMED_OUT) {
          preserveHardAbort = true;
          void draftReply.settled.then(cleanup);
        }
        const cancelled = this._completed.get(request.decisionId);
        if (cancelled !== undefined) {
          return cancelled;
        }
        if (raw === TIMED_OUT || raw === PROVIDER_ERROR || raw === ABORTED || raw === undefined) {
          const reason: CombatAiDegradedReason =
            raw === PROVIDER_ERROR || raw === undefined ? 'offline' : 'timeout';
          this.debug('decide:provider-failure', {
            decisionId: request.decisionId,
            attempt,
            reason,
          });
          const result = this._failure({ request, reason, latencyMs: Date.now() - startedAt });
          this._emitRecord(result.record);
          return this._remember(request.decisionId, result);
        }
        if (!Value.Check(AiCombatDecisionDraftSchema, raw)) {
          this.debug('decide:invalid-draft', { decisionId: request.decisionId, attempt });
          lastReason = 'invalid';
          const result = this._failure({
            request,
            reason: 'invalid',
            latencyMs: Date.now() - startedAt,
          });
          this._emitRecord(result.record);
          if (attempt === this._maxAttempts) {
            return this._remember(request.decisionId, result);
          }
          continue;
        }
        const result = this._fromDraft({
          request,
          draft: raw,
          latencyMs: Date.now() - startedAt,
        });
        this._emitRecord(result.record);
        if (result.ok) {
          return this._remember(request.decisionId, result);
        }
        lastReason = result.reason;
        if (result.reason === 'stale' || attempt === this._maxAttempts) {
          return this._remember(request.decisionId, result);
        }
      }

      this.info('decide:failed', { decisionId: request.decisionId, attempts: this._maxAttempts });
      const result = this._failure({
        request,
        reason: lastReason,
        latencyMs: Date.now() - startedAt,
      });
      this._emitRecord(result.record);
      return this._remember(request.decisionId, result);
    } catch (error: unknown) {
      this.error('decide:provider-error', error);
      const result = this._failure({
        request,
        reason: 'offline',
        latencyMs: Date.now() - startedAt,
      });
      this._emitRecord(result.record);
      return this._remember(request.decisionId, result);
    } finally {
      if (!preserveHardAbort) {
        cleanup();
      }
    }
  }

  /** Runs one shared provider call while preserving per-decision lifecycle state. */
  private async _runBatch(
    requests: readonly CombatAiDecisionRequest[],
  ): Promise<CombatAiDecisionResult[]> {
    const startedAt = Date.now();
    const controller = new AbortController();
    for (const request of requests) {
      this._batchControllers.set(request.decisionId, controller);
      this._activeRequests.set(request.decisionId, request);
    }
    let preserveHardAbort = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearTimeout(hardTimer);
      for (const request of requests) {
        if (this._batchControllers.get(request.decisionId) === controller) {
          this._batchControllers.delete(request.decisionId);
          this._activeRequests.delete(request.decisionId);
        }
      }
    };
    const hardTimer = setTimeout(() => {
      controller.abort();
      cleanup();
    }, this._hardDeadlineMs);

    try {
      const prompt = buildCombatAiBatchPrompt({
        contexts: requests.map((request) => request.context),
      });
      for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
        const draftReply = await this._requestDraft({
          prompt,
          schemaName: BATCH_SCHEMA_NAME,
          // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
          schema: AiCombatDecisionBatchDraftSchema as unknown as Record<string, unknown>,
          controller,
        });
        const raw = draftReply.reply;
        if (raw === TIMED_OUT) {
          preserveHardAbort = true;
          void draftReply.settled.then(cleanup);
        }
        const latencyMs = Date.now() - startedAt;
        if (raw === TIMED_OUT || raw === PROVIDER_ERROR || raw === ABORTED || raw === undefined) {
          const reason: CombatAiDegradedReason =
            raw === PROVIDER_ERROR || raw === undefined ? 'offline' : 'timeout';
          this.info('decideBatch:failed', { actors: requests.length, attempt });
          return requests.map((request) => this._terminalFailure({ request, reason, latencyMs }));
        }
        if (!Value.Check(AiCombatDecisionBatchDraftSchema, raw)) {
          const results = requests.map((request) =>
            this._failure({ request, reason: 'invalid', latencyMs }),
          );
          for (const result of results) {
            this._emitRecord(result.record);
          }
          if (attempt === this._maxAttempts) {
            return results.map((result, index) => {
              const request = requests[index];
              return request === undefined ? result : this._remember(request.decisionId, result);
            });
          }
          continue;
        }
        return requests.map((request) => {
          const completed = this._completed.get(request.decisionId);
          if (completed !== undefined) {
            return completed;
          }
          const draft = raw.decisions[request.actorId];
          const result =
            draft === undefined
              ? this._failure({ request, reason: 'invalid', latencyMs })
              : this._fromDraft({ request, draft, latencyMs });
          this._emitRecord(result.record);
          return this._remember(request.decisionId, result);
        });
      }
      return requests.map((request) =>
        this._terminalFailure({ request, reason: 'invalid', latencyMs: Date.now() - startedAt }),
      );
    } catch (error: unknown) {
      this.error('decideBatch:provider-error', error);
      return requests.map((request) =>
        this._terminalFailure({
          request,
          reason: 'offline',
          latencyMs: Date.now() - startedAt,
        }),
      );
    } finally {
      if (!preserveHardAbort) {
        cleanup();
      }
    }
  }

  /** Creates, emits and caches one terminal failure. */
  private _terminalFailure(options: {
    request: CombatAiDecisionRequest;
    reason: CombatAiDegradedReason;
    latencyMs: number;
  }): CombatAiDecisionResult {
    const completed = this._completed.get(options.request.decisionId);
    if (completed !== undefined) {
      return completed;
    }
    const result = this._failure(options);
    this._emitRecord(result.record);
    return this._remember(options.request.decisionId, result);
  }

  /** Mints the envelope identity around a validated draft. */
  private _fromDraft(options: {
    request: CombatAiDecisionRequest;
    draft: {
      goal: string;
      intent: AiCombatDecision['intent'];
      fallback: AiCombatDecision['fallback'];
      confidence: AiCombatDecision['confidence'];
      shortReason?: string;
      proposedLine?: string;
    };
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

  /**
   * One provider call raced against the soft deadline.
   *
   * Returns {@link TIMED_OUT} for a timeout, an abort or any provider error —
   * the caller treats all three identically (deterministic fallback).
   */
  private async _requestDraft(options: {
    prompt: string;
    schemaName: string;
    schema: Record<string, unknown>;
    controller: AbortController;
  }): Promise<{ reply: DraftReply; settled: Promise<void> }> {
    if (options.controller.signal.aborted) {
      return { reply: ABORTED, settled: Promise.resolve() };
    }
    const call = this._text.extractStructure({
      schema: options.schema,
      schemaName: options.schemaName,
      prompt: options.prompt,
      systemPrompt: buildCombatAiSystemPrompt(),
      signal: options.controller.signal,
      task: TASK,
    });
    let resolveSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const reply = await new Promise<DraftReply>((resolve) => {
      const timer = setTimeout(() => {
        resolve(TIMED_OUT);
      }, this._softDeadlineMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(ABORTED);
      };
      options.controller.signal.addEventListener('abort', onAbort, { once: true });
      call.then(
        (value) => {
          resolveSettled?.();
          clearTimeout(timer);
          options.controller.signal.removeEventListener('abort', onAbort);
          resolve(options.controller.signal.aborted ? ABORTED : value);
        },
        (error: unknown) => {
          resolveSettled?.();
          clearTimeout(timer);
          options.controller.signal.removeEventListener('abort', onAbort);
          this.debug('requestDraft:rejected', { aborted: options.controller.signal.aborted });
          void error;
          resolve(options.controller.signal.aborted ? ABORTED : PROVIDER_ERROR);
        },
      );
    });
    return { reply, settled };
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
