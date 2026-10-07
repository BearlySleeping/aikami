// apps/frontend/client/src/lib/services/game/combat_intent_service.svelte.ts
//
// Natural-language combat intent interpreter (Combat-05).
//
// Sits behind the existing AI abstraction: it consumes the `text.extractStructure`
// capability already injected at the composition root (task preset
// `combat-intent`) and returns only a typed intent envelope — never ids,
// coordinates, dice, HP or hidden entities. The envelope identity
// (`intentId`/`encounterId`/`actorId`/`basedOnRevision`/`source`) is minted here
// from the caller's request, so a model cannot forge it; the model only fills
// the closed `CombatIntentDraft` shape.
//
// 🔴 REQUEST LIFETIME (issue #382)
//
// The service previously raced each attempt against a FRESH soft deadline,
// resolved the race as a timeout, and then walked away — leaving the provider
// call running with nothing to abort it. The player fell back to the
// deterministic parser immediately, so the failure looked correct, while the
// runtime kept generating a response nobody would ever read. On a local runtime
// that is real GPU time; on a BYOK provider it is a real bill.
//
// Four properties this now guarantees, each covered by a regression in
// `combat_intent_service.test.ts`:
//
//   - ONE soft budget across all attempts, measured from the moment the
//     interpretation started. A retry draws from what is left rather than
//     restarting the clock, so a slow first attempt plus a retry cannot exceed
//     the budget the player is waiting on.
//   - The losing attempt is ABORTED the instant the race is lost, and its
//     resources are released. No orphaned provider call survives a fallback.
//   - A LATE response is never usable. The race settles once; a provider that
//     ignores its abort signal and answers afterwards cannot turn a fallback
//     into a model-driven result.
//   - Every live operation is OWNED. A second `interpret` with the same
//     `requestId` supersedes the first deterministically rather than
//     overwriting its controller in a map and orphaning it, and `cancel` /
//     `cancelAll` abort every operation still running.
//
// Reliability policy (AC-2, AC-6, AC-8):
//   - bounded retry (2 attempts) on an invalid/partial response;
//   - soft deadline → typed failure immediately (the caller's deterministic
//     fallback keeps combat playable), hard deadline → abort;
//   - cancellable and idempotent by `requestId`;
//   - oversized text is refused before any provider call.
//
// Contract: C-525 AC-2, AC-6, AC-8

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { COMBAT_INTENT_BOUNDS, CombatIntentDraftSchema } from '@aikami/schemas';
import type { ActionIntent, IntentInterpreterResult } from '@aikami/types';
import { parseCombatIntent } from '@aikami/utils';
import { Value } from 'typebox/value';
import {
  buildCombatIntentContext,
  buildCombatIntentPrompt,
  buildCombatIntentSystemPrompt,
} from './combat_intent_prompt';
import type { CombatIntentRequest } from './types/combat_intent.ts';

/** Injected structured-output capability (the production wiring pins the task). */
export type CombatIntentServiceOptions = BaseFrontendClassOptions & {
  text: {
    extractStructure(options: {
      schema: Record<string, unknown>;
      schemaName: string;
      prompt: string;
      systemPrompt?: string;
      signal?: AbortSignal;
      /** Absolute epoch ms by which the call must finish. */
      deadlineAt?: number;
    }): Promise<unknown>;
  };
  /** Soft deadline in ms — defaults to the §18 budget (1.5 s). */
  softDeadlineMs?: number;
  /** Hard deadline in ms — defaults to the §18 budget (4 s). */
  hardDeadlineMs?: number;
};

export type CombatIntentServiceInterface = BaseFrontendClassInterface & {
  /**
   * Interprets one instruction through the model.
   *
   * Always resolves — a provider failure is a typed failure, never a throw.
   */
  interpret(request: CombatIntentRequest): Promise<IntentInterpreterResult>;

  /**
   * Interprets, then falls back to the deterministic offline parser.
   *
   * This is the single entry point the ViewModel uses: the model can only
   * change PRESENTATION, never the rules (architecture §5.5).
   */
  interpretWithFallback(request: CombatIntentRequest): Promise<IntentInterpreterResult>;

  /** Cancels one outstanding request by id, including every attempt of it. */
  cancel(requestId: string): void;

  /** Cancels every outstanding request (e.g. combat ended). */
  cancelAll(): void;

  /** Number of requests currently in flight. */
  readonly activeRequestCount: number;
};

const DEFAULT_SOFT_DEADLINE_MS = 1500;
const DEFAULT_HARD_DEADLINE_MS = 4000;
const MAX_ATTEMPTS = 2;
const SCHEMA_NAME = 'CombatIntentDraft';

/**
 * One live interpretation, and the controller every attempt of it draws from.
 *
 * Attempts get their own child controllers so a soft timeout can release ONE
 * attempt without tearing down the operation, while a cancellation reaches all
 * of them.
 */
class InterpretationOperation {
  readonly requestId: string;
  /** Aborted on cancellation, on the hard deadline, or on supersession. */
  readonly controller = new AbortController();
  /** Live attempt controllers, so cleanup can reach every one of them. */
  private readonly _liveAttempts = new Set<AbortController>();
  private _finished = false;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  /** Creates a controller for one attempt, linked to this operation. */
  attemptController(): AbortController {
    const controller = new AbortController();
    this._liveAttempts.add(controller);
    const onAbort = (): void => {
      controller.abort(this.controller.signal.reason);
    };
    if (this.controller.signal.aborted) {
      onAbort();
    } else {
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
    }
    controller.signal.addEventListener(
      'abort',
      () => this.controller.signal.removeEventListener('abort', onAbort),
      { once: true },
    );
    return controller;
  }

  /** Releases one attempt. Idempotent, and always called. */
  releaseAttempt(controller: AbortController): void {
    this._liveAttempts.delete(controller);
    if (!controller.signal.aborted) {
      controller.abort(new Error('Attempt settled'));
    }
  }

  /**
   * Aborts the operation and every attempt still running.
   *
   * Called on the hard deadline, on cancellation, and on the way out of
   * `interpret` — so a settled interpretation leaves nothing behind that could
   * still be generating.
   */
  finish(): void {
    if (this._finished) {
      return;
    }
    this._finished = true;
    for (const controller of this._liveAttempts) {
      if (!controller.signal.aborted) {
        controller.abort(new Error('Interpretation finished'));
      }
    }
    this._liveAttempts.clear();
    if (!this.controller.signal.aborted) {
      this.controller.abort(new Error('Interpretation finished'));
    }
  }

  /** Aborts one attempt, so a lost race releases the provider call at once. */
  abortAttempt(controller: AbortController, reason: string): void {
    this._liveAttempts.delete(controller);
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  }
}

class CombatIntentService
  extends BaseFrontendClass<CombatIntentServiceOptions>
  implements CombatIntentServiceInterface
{
  private readonly _maxAttempts = MAX_ATTEMPTS;
  private readonly _softDeadlineMs: number;
  private readonly _hardDeadlineMs: number;
  /**
   * Every live operation, keyed by `requestId`.
   *
   * A SET per id, not a single controller: two interpretations sharing a
   * request id are two operations, and storing one controller per id orphaned
   * the other — it kept running, could not be cancelled, and its result could
   * not be reasoned about. The newest interpretation still wins the identity;
   * the older one is SUPERSEDED and aborted, which is deterministic rather than
   * dependent on which one finished first.
   */
  private readonly _operations = new Map<string, Set<InterpretationOperation>>();

  constructor(options: CombatIntentServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
    this._hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  }

  /** @inheritdoc */
  get activeRequestCount(): number {
    let total = 0;
    for (const operations of this._operations.values()) {
      total += operations.size;
    }
    return total;
  }

  /** @inheritdoc */
  async interpret(request: CombatIntentRequest): Promise<IntentInterpreterResult> {
    const { requestId, text } = request;

    if (text.length > COMBAT_INTENT_BOUNDS.rawTextChars) {
      this.debug('interpret:oversized', { requestId, length: text.length });
      return { ok: false, reason: 'unparseable' };
    }

    const context = buildCombatIntentContext({ state: request.state, actorId: request.actorId });
    if (context === null) {
      this.debug('interpret:unknown-actor', { requestId, actorId: request.actorId });
      return { ok: false, reason: 'unknown_capability' };
    }

    // ONE soft budget and ONE hard budget, both measured from here. A retry
    // draws from what is left; it never restarts either clock.
    const startedAt = Date.now();
    const softDeadlineAt = startedAt + this._softDeadlineMs;
    const deadlineAt = startedAt + this._hardDeadlineMs;

    const operation = new InterpretationOperation(requestId);
    this._register(operation);

    const hardTimer = setTimeout(() => {
      operation.controller.abort(new Error('Combat intent hard deadline expired'));
    }, this._hardDeadlineMs);

    try {
      const prompt = buildCombatIntentPrompt({ context, text });
      let lastFailure: IntentInterpreterResult = { ok: false, reason: 'unparseable' };

      for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
        if (Date.now() >= softDeadlineAt) {
          // The ONE soft budget is spent. A second attempt would be starting
          // work the player is no longer waiting for.
          this.debug('interpret:soft-budget-spent', { requestId, attempt });
          return lastFailure;
        }
        const raw = await this._requestDraft({
          prompt,
          operation,
          attempt,
          deadlineAt,
          softDeadlineAt,
        });
        if (raw === undefined) {
          // A timeout, an abort or a provider error: fall back immediately
          // rather than making the player wait out the hard deadline.
          this.debug(operation.aborted ? 'interpret:cancelled' : 'interpret:timeout', {
            requestId,
            attempt,
          });
          return lastFailure;
        }
        const draft = Value.Check(CombatIntentDraftSchema, raw) ? raw : undefined;
        if (draft === undefined) {
          this.debug('interpret:invalid-draft', { requestId, attempt });
          lastFailure = { ok: false, reason: 'unparseable' };
          continue;
        }
        if (draft.kind === 'refusal') {
          this.info('interpret:refused', { requestId, reason: draft.reason });
          return { ok: false, reason: draft.reason };
        }
        const intent: ActionIntent = {
          intentId: request.intentId,
          encounterId: request.encounterId,
          actorId: request.actorId,
          basedOnRevision: request.basedOnRevision,
          source: 'player_language',
          steps: draft.steps,
          ...(draft.fallback === undefined ? {} : { fallback: draft.fallback }),
          rawText: text.slice(0, COMBAT_INTENT_BOUNDS.rawTextChars),
        };
        this.debug('interpret:ok', { requestId, steps: intent.steps.length });
        return { ok: true, intent };
      }

      this.info('interpret:failed', { requestId, attempts: this._maxAttempts });
      return lastFailure;
    } catch (error: unknown) {
      this.error('interpret:provider-error', error);
      return { ok: false, reason: 'unparseable' };
    } finally {
      clearTimeout(hardTimer);
      // Releases every attempt controller and the operation's own. Without this
      // an abandoned provider call keeps generating behind a settled request.
      operation.finish();
      this._unregister(operation);
    }
  }

  /** @inheritdoc */
  async interpretWithFallback(request: CombatIntentRequest): Promise<IntentInterpreterResult> {
    const interpreted = await this.interpret(request);
    if (interpreted.ok) {
      return interpreted;
    }
    const parsed = parseCombatIntent({
      intentId: request.intentId,
      encounterId: request.encounterId,
      actorId: request.actorId,
      basedOnRevision: request.basedOnRevision,
      text: request.text,
    });
    if (parsed.ok) {
      this.info('interpret:deterministic-fallback', {
        requestId: request.requestId,
        modelReason: interpreted.reason,
      });
      return parsed;
    }
    this.info('interpret:unresolved', {
      requestId: request.requestId,
      modelReason: interpreted.reason,
      parserReason: parsed.reason,
    });
    return parsed;
  }

  /** @inheritdoc */
  cancel(requestId: string): void {
    const operations = this._operations.get(requestId);
    if (operations === undefined || operations.size === 0) {
      return;
    }
    this.debug('cancel', { requestId, operations: operations.size });
    // EVERY live operation under this id, not just the newest.
    for (const operation of [...operations]) {
      operation.controller.abort(new Error('Cancelled by caller'));
    }
    this._operations.delete(requestId);
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this.activeRequestCount });
    for (const operations of this._operations.values()) {
      for (const operation of operations) {
        operation.controller.abort(new Error('Cancelled by caller'));
      }
    }
    this._operations.clear();
  }

  /** Adds an operation to its id's set, superseding any predecessor. */
  private _register(operation: InterpretationOperation): void {
    const existing = this._operations.get(operation.requestId);
    if (existing === undefined) {
      this._operations.set(operation.requestId, new Set([operation]));
      return;
    }
    // Deterministic duplicate handling: the newest interpretation owns the
    // identity and any earlier one is aborted rather than left running with
    // nothing able to cancel it.
    for (const previous of existing) {
      this.debug('interpret:superseded', { requestId: operation.requestId });
      previous.controller.abort(new Error('Superseded by a newer request with the same id'));
    }
    existing.add(operation);
  }

  /** Removes one operation, dropping the id once it holds none. */
  private _unregister(operation: InterpretationOperation): void {
    const existing = this._operations.get(operation.requestId);
    if (existing === undefined) {
      return;
    }
    existing.delete(operation);
    if (existing.size === 0) {
      this._operations.delete(operation.requestId);
    }
  }

  /**
   * One provider attempt, raced against what is LEFT of the soft budget.
   *
   * The race is bounded by `min(soft remaining, hard remaining)`, so neither a
   * soft budget that has already been partly spent by an earlier attempt nor an
   * exhausted hard budget can buy more provider time.
   *
   * Returns `undefined` for a timeout, an abort, or a provider error — the
   * caller treats all three identically (deterministic fallback). The promise
   * settles once, so a provider that IGNORES its abort signal and answers
   * afterwards cannot produce a usable late result.
   */
  private async _requestDraft(options2: {
    prompt: string;
    operation: InterpretationOperation;
    attempt: number;
    deadlineAt: number;
    softDeadlineAt: number;
  }): Promise<unknown | undefined> {
    const { prompt, operation, attempt, deadlineAt, softDeadlineAt } = options2;

    const now = Date.now();
    const softRemaining = Math.max(0, softDeadlineAt - now);
    const hardRemaining = Math.max(0, deadlineAt - now);
    const window = Math.min(softRemaining, hardRemaining);
    if (window <= 0) {
      return undefined;
    }

    const controller = operation.attemptController();

    return await new Promise<unknown | undefined>((resolve) => {
      // Declared inside the executor so `settle` closes over the live bindings
      // rather than a not-yet-initialised temporal dead zone.
      const settle = (value: unknown | undefined): void => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        // Released either way, and ABORTED if it is still running: a losing
        // attempt must not keep the provider generating.
        operation.releaseAttempt(controller);
        resolve(value);
      };

      const call = this._text.extractStructure({
        // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
        schema: CombatIntentDraftSchema as unknown as Record<string, unknown>,
        schemaName: SCHEMA_NAME,
        prompt,
        systemPrompt: buildCombatIntentSystemPrompt(),
        signal: controller.signal,
        // ONE clock: the remaining soft window and the hard deadline are both
        // already reflected in `window`, and the absolute hard deadline is passed
        // down so no layer below mints a fresh budget (issue #382 P0).
        deadlineAt: Math.min(deadlineAt, Date.now() + window),
      });

      const onAbort = (): void => {
        settle(undefined);
      };
      const timer = setTimeout(() => {
        this.debug('requestDraft:soft-timeout', { attempt, window });
        // Abort the LOSING attempt immediately. Before, the race simply
        // resolved and the provider call kept running with nothing to stop it.
        operation.abortAttempt(controller, 'Soft deadline expired');
        settle(undefined);
      }, window);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      call.then(
        (value) => {
          // A late answer after the race was lost is not usable. The promise
          // has already settled; this branch only exists so a provider that
          // ignores its abort cannot be mistaken for a fresh result.
          if (controller.signal.aborted) {
            settle(undefined);
            return;
          }
          settle(value);
        },
        (error: unknown) => {
          this.debug('requestDraft:rejected', { attempt, aborted: controller.signal.aborted });
          void error;
          settle(undefined);
        },
      );
    });
  }

  /** The injected structured-output capability. */
  private get _text(): CombatIntentServiceOptions['text'] {
    return this._options.text;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Builds a combat intent interpreter over the injected `text.extractStructure`
 * capability. Production wiring pins the `combat-intent` task preset there.
 */
export const getCombatIntentService = (
  options: CombatIntentServiceOptions,
): CombatIntentServiceInterface => CombatIntentService.create(options);
