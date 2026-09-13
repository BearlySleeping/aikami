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
// Reliability policy (AC-2, AC-6, AC-8):
//   - bounded retry (2 attempts) on an invalid/partial response;
//   - soft deadline → typed failure immediately (the caller's deterministic
//     fallback keeps combat playable), hard deadline → abort;
//   - cancellable and idempotent by `requestId`; a cancelled or superseded
//     request never yields a usable answer;
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

  /** Cancels one outstanding request by id (idempotent). */
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

/** Sentinel for "the provider did not answer inside the soft deadline". */
const TIMED_OUT: unique symbol = Symbol('combat-intent-timeout');

class CombatIntentService
  extends BaseFrontendClass<CombatIntentServiceOptions>
  implements CombatIntentServiceInterface
{
  private readonly _maxAttempts = MAX_ATTEMPTS;
  private readonly _softDeadlineMs: number;
  private readonly _hardDeadlineMs: number;
  private readonly _controllers = new Map<string, AbortController>();

  constructor(options: CombatIntentServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
    this._hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  }

  /** @inheritdoc */
  get activeRequestCount(): number {
    return this._controllers.size;
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

    const controller = new AbortController();
    this._controllers.set(requestId, controller);
    const hardTimer = setTimeout(() => {
      controller.abort();
    }, this._hardDeadlineMs);

    try {
      const prompt = buildCombatIntentPrompt({ context, text });
      let lastFailure: IntentInterpreterResult = { ok: false, reason: 'unparseable' };

      for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
        const raw = await this._requestDraft(prompt, controller);
        if (raw === TIMED_OUT || raw === undefined) {
          // A timeout, an abort or a provider error: fall back immediately
          // rather than making the player wait out the hard deadline.
          this.debug(controller.signal.aborted ? 'interpret:cancelled' : 'interpret:timeout', {
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
      if (this._controllers.get(requestId) === controller) {
        this._controllers.delete(requestId);
      }
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
    const controller = this._controllers.get(requestId);
    if (controller === undefined) {
      return;
    }
    this.debug('cancel', { requestId });
    controller.abort();
    this._controllers.delete(requestId);
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this._controllers.size });
    for (const controller of this._controllers.values()) {
      controller.abort();
    }
    this._controllers.clear();
  }

  /**
   * One provider call raced against the soft deadline.
   *
   * Returns {@link TIMED_OUT} for a timeout, an abort, or any provider error —
   * the caller treats all three identically (deterministic fallback).
   */
  private async _requestDraft(
    prompt: string,
    controller: AbortController,
  ): Promise<unknown | typeof TIMED_OUT> {
    const call = this._text.extractStructure({
      // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
      schema: CombatIntentDraftSchema as unknown as Record<string, unknown>,
      schemaName: SCHEMA_NAME,
      prompt,
      systemPrompt: buildCombatIntentSystemPrompt(),
    });
    return await new Promise<unknown | typeof TIMED_OUT>((resolve) => {
      const timer = setTimeout(() => {
        resolve(TIMED_OUT);
      }, this._softDeadlineMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(TIMED_OUT);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      call.then(
        (value) => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
          resolve(controller.signal.aborted ? TIMED_OUT : value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
          this.debug('requestDraft:rejected', { aborted: controller.signal.aborted });
          void error;
          resolve(TIMED_OUT);
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
