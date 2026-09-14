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
    return this._controllers.size;
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

    const startedAt = Date.now();
    const contexts = requests.map((request) => request.context);
    const controller = new AbortController();
    const batchKey = requests.map((request) => request.decisionId).join('|');
    this._controllers.set(batchKey, controller);
    const hardTimer = setTimeout(() => {
      controller.abort();
    }, this._hardDeadlineMs);

    try {
      const raw = await this._requestDraft({
        prompt: buildCombatAiBatchPrompt({ contexts }),
        schemaName: BATCH_SCHEMA_NAME,
        // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
        schema: AiCombatDecisionBatchDraftSchema as unknown as Record<string, unknown>,
        controller,
      });
      const latencyMs = Date.now() - startedAt;
      if (raw === TIMED_OUT || raw === PROVIDER_ERROR || raw === ABORTED || raw === undefined) {
        this.info('decideBatch:failed', { actors: requests.length });
        return requests.map((request) =>
          this._failure({
            request,
            reason: raw === PROVIDER_ERROR || raw === undefined ? 'offline' : 'timeout',
            latencyMs,
          }),
        );
      }
      if (!Value.Check(AiCombatDecisionBatchDraftSchema, raw)) {
        return requests.map((request) => this._failure({ request, reason: 'invalid', latencyMs }));
      }
      const decisions = raw.decisions;
      return requests.map((request) => {
        const draft = decisions[request.actorId];
        if (draft === undefined) {
          return this._failure({ request, reason: 'invalid', latencyMs });
        }
        return this._fromDraft({ request, draft, latencyMs });
      });
    } catch (error: unknown) {
      this.error('decideBatch:provider-error', error);
      return requests.map((request) =>
        this._failure({ request, reason: 'offline', latencyMs: Date.now() - startedAt }),
      );
    } finally {
      clearTimeout(hardTimer);
      if (this._controllers.get(batchKey) === controller) {
        this._controllers.delete(batchKey);
      }
    }
  }

  /** @inheritdoc */
  cancel(decisionId: string): void {
    const controller = this._controllers.get(decisionId);
    if (controller === undefined) {
      return;
    }
    this.debug('cancel', { decisionId });
    // A cancelled decision is stale by definition: it must never be applied.
    this._completed.set(decisionId, {
      ok: false,
      reason: 'stale',
      latencyMs: 0,
      record: this._record({
        request: undefined,
        decisionId,
        source: 'fallback',
        latencyMs: 0,
        reason: 'stale',
      }),
    });
    controller.abort();
    this._controllers.delete(decisionId);
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this._controllers.size });
    for (const controller of this._controllers.values()) {
      controller.abort();
    }
    this._controllers.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Runs one uncached decision request with bounded retry and deadlines. */
  private async _run(request: CombatAiDecisionRequest): Promise<CombatAiDecisionResult> {
    const controller = new AbortController();
    this._controllers.set(request.decisionId, controller);
    const hardTimer = setTimeout(() => {
      controller.abort();
    }, this._hardDeadlineMs);
    const startedAt = Date.now();

    try {
      const prompt = buildCombatAiPrompt({ context: request.context });
      let lastReason: CombatAiDegradedReason = 'invalid';

      for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
        const raw = await this._requestDraft({
          prompt,
          schemaName: SCHEMA_NAME,
          // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
          schema: AiCombatDecisionDraftSchema as unknown as Record<string, unknown>,
          controller,
        });
        if (raw === TIMED_OUT || raw === PROVIDER_ERROR || raw === ABORTED || raw === undefined) {
          const reason: CombatAiDegradedReason =
            raw === PROVIDER_ERROR || raw === undefined ? 'offline' : 'timeout';
          this.debug('decide:provider-failure', {
            decisionId: request.decisionId,
            attempt,
            reason,
          });
          return this._remember(
            request.decisionId,
            this._failure({
              request,
              reason,
              latencyMs: Date.now() - startedAt,
            }),
          );
        }
        if (!Value.Check(AiCombatDecisionDraftSchema, raw)) {
          this.debug('decide:invalid-draft', { decisionId: request.decisionId, attempt });
          lastReason = 'invalid';
          continue;
        }
        const result = this._fromDraft({
          request,
          draft: raw,
          latencyMs: Date.now() - startedAt,
        });
        if (result.ok) {
          return this._remember(request.decisionId, result);
        }
        lastReason = result.reason;
        if (result.reason === 'stale') {
          return this._remember(request.decisionId, result);
        }
      }

      this.info('decide:failed', { decisionId: request.decisionId, attempts: this._maxAttempts });
      return this._remember(
        request.decisionId,
        this._failure({
          request,
          reason: lastReason,
          latencyMs: Date.now() - startedAt,
        }),
      );
    } catch (error: unknown) {
      this.error('decide:provider-error', error);
      return this._remember(
        request.decisionId,
        this._failure({
          request,
          reason: 'offline',
          latencyMs: Date.now() - startedAt,
        }),
      );
    } finally {
      clearTimeout(hardTimer);
      if (this._controllers.get(request.decisionId) === controller) {
        this._controllers.delete(request.decisionId);
      }
    }
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
  }): Promise<DraftReply> {
    if (options.controller.signal.aborted) {
      return ABORTED;
    }
    const call = this._text.extractStructure({
      schema: options.schema,
      schemaName: options.schemaName,
      prompt: options.prompt,
      systemPrompt: buildCombatAiSystemPrompt(),
      signal: options.controller.signal,
      task: TASK,
    });
    return await new Promise<DraftReply>((resolve) => {
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
          clearTimeout(timer);
          options.controller.signal.removeEventListener('abort', onAbort);
          resolve(options.controller.signal.aborted ? ABORTED : value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          options.controller.signal.removeEventListener('abort', onAbort);
          this.debug('requestDraft:rejected', { aborted: options.controller.signal.aborted });
          void error;
          resolve(options.controller.signal.aborted ? ABORTED : PROVIDER_ERROR);
        },
      );
    });
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
