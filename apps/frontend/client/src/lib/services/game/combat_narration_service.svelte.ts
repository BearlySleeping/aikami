// apps/frontend/client/src/lib/services/game/combat_narration_service.svelte.ts
//
// LLM outcome narrator (Combat-06).
//
// Consumes the facts the kernel emitted — `narrationFactsFromEvents` rendered
// by the existing `buildOutcomeNarrationPrompt` — over the new
// `combat-narration` task. Presentation only:
//
//   - the model authors a single bounded prose block (`CombatNarrationDraft`);
//     it cannot express a mechanic, a number or an outcome (AC-11);
//   - the already-wired authored template is the guaranteed fallback when the
//     flag is off, the provider fails, the soft deadline expires or the output
//     fails the facts-only policy;
//   - fire-and-forget: `narrate` is awaited by whoever wants the text, but the
//     mechanical/UI step that triggered it never waits on it;
//   - cancellable and idempotent by `narrationId`; a late reply after the
//     encounter ended is discarded and the template stands;
//   - provenance (`llm` | `template`) is recorded in the result.
//
// Importing the pure builders from the view module is intentional and
// cycle-free: the view module never imports a service.
//
// Contract: C-526 AC-10, AC-11

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { CombatNarrationDraftSchema } from '@aikami/schemas';
import type { CombatNarrationRequest, CombatNarrationResult } from '@aikami/types';
import { Value } from 'typebox/value';
import {
  buildOutcomeNarration,
  buildOutcomeNarrationPrompt,
} from '../../views/combat/combat_narration';
import { validateCombatNarrationText } from './combat_narration_policy';

// ── Options ────────────────────────────────────────────────────────────────

export type CombatNarrationServiceOptions = BaseFrontendClassOptions & {
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
  /**
   * Whether the narration is being enabled at all. Read from the pinned
   * `PUBLIC_COMBAT_LLM_AGENTS` encounter flag (AC-9); false ⇒ templates only.
   */
  enabled?: boolean;
  /**
   * Called when a reply arrives after the encounter moved on: the late text is
   * discarded and the template stands (AC-11 edge case).
   */
  isStale?: () => boolean;
  /** Provenance for telemetry. */
  provider?: string;
  model?: string;
};

export type CombatNarrationServiceInterface = BaseFrontendClassInterface & {
  /** Narrates one resolved action. Always resolves; never throws. */
  narrate(request: CombatNarrationRequest): Promise<CombatNarrationResult>;

  /** Cancels one outstanding narration by id (idempotent). */
  cancel(narrationId: string): void;

  /** Cancels every outstanding narration (e.g. encounter ended). */
  cancelAll(): void;

  /** Number of narrations currently in flight. */
  readonly activeNarrationCount: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_SOFT_DEADLINE_MS = 1500;
const SCHEMA_NAME = 'CombatNarrationDraft';
const TASK = 'combat-narration';

/** Sentinel for "the provider did not answer inside the soft deadline". */
const TIMED_OUT: unique symbol = Symbol('combat-narration-timeout');

class CombatNarrationService
  extends BaseFrontendClass<CombatNarrationServiceOptions>
  implements CombatNarrationServiceInterface
{
  private readonly _softDeadlineMs: number;
  private readonly _controllers = new Map<string, AbortController>();
  private readonly _completed = new Map<string, CombatNarrationResult>();
  private readonly _inFlight = new Map<string, Promise<CombatNarrationResult>>();

  constructor(options: CombatNarrationServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
  }

  /** @inheritdoc */
  get activeNarrationCount(): number {
    return this._controllers.size;
  }

  /** @inheritdoc */
  async narrate(request: CombatNarrationRequest): Promise<CombatNarrationResult> {
    const completed = this._completed.get(request.narrationId);
    if (completed !== undefined) {
      this.debug('narrate:idempotent-hit', { narrationId: request.narrationId });
      return completed;
    }
    const inFlight = this._inFlight.get(request.narrationId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = this._run(request).finally(() => {
      this._inFlight.delete(request.narrationId);
    });
    this._inFlight.set(request.narrationId, promise);
    return promise;
  }

  /** @inheritdoc */
  cancel(narrationId: string): void {
    const controller = this._controllers.get(narrationId);
    if (controller === undefined) {
      return;
    }
    this.debug('cancel', { narrationId });
    controller.abort();
    this._controllers.delete(narrationId);
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

  private async _run(request: CombatNarrationRequest): Promise<CombatNarrationResult> {
    // The flag-off path is synchronous templates only — no provider call, no
    // graceful degradation, exactly the shipped pre-526 behaviour (AC-9).
    if (this._options.enabled !== true) {
      return this._remember(request, this._template(request));
    }

    const controller = new AbortController();
    this._controllers.set(request.narrationId, controller);
    try {
      const prompt = buildOutcomeNarrationPrompt({
        events: [...request.events],
        ...(request.names === undefined ? {} : { names: request.names }),
      });
      const raw = await this._requestDraft(prompt, controller);
      if (raw === TIMED_OUT || raw === undefined) {
        return this._remember(request, this._template(request));
      }
      if (!Value.Check(CombatNarrationDraftSchema, raw)) {
        this.debug('narrate:invalid-draft', { narrationId: request.narrationId });
        return this._remember(request, this._template(request));
      }
      // A reply that lands after the encounter ended must never be applied.
      if (this._options.isStale?.() === true) {
        this.info('narrate:late-reply-discarded', { narrationId: request.narrationId });
        return this._remember(request, this._template(request));
      }
      const validated = validateCombatNarrationText({
        text: raw.text,
        events: request.events,
        ...(request.names === undefined ? {} : { names: request.names }),
      });
      if (!validated.ok) {
        this.info('narrate:policy-rejected', {
          narrationId: request.narrationId,
          reason: validated.reason,
        });
        return this._remember(request, this._template(request));
      }
      const result: CombatNarrationResult = {
        narrationId: request.narrationId,
        encounterId: request.encounterId,
        basedOnRevision: request.basedOnRevision,
        source: 'llm',
        text: validated.text,
      };
      return this._remember(request, result);
    } catch (error: unknown) {
      this.error('narrate:provider-error', error);
      return this._remember(request, this._template(request));
    } finally {
      if (this._controllers.get(request.narrationId) === controller) {
        this._controllers.delete(request.narrationId);
      }
    }
  }

  /** Keeps the first terminal result for an id, including template fallbacks. */
  private _remember(
    request: CombatNarrationRequest,
    result: CombatNarrationResult,
  ): CombatNarrationResult {
    const completed = this._completed.get(request.narrationId);
    if (completed !== undefined) {
      return completed;
    }
    this._completed.set(request.narrationId, result);
    return result;
  }

  /** The authored template — always safe, always available. */
  private _template(request: CombatNarrationRequest): CombatNarrationResult {
    return {
      narrationId: request.narrationId,
      encounterId: request.encounterId,
      basedOnRevision: request.basedOnRevision,
      source: 'template',
      text: buildOutcomeNarration({
        events: [...request.events],
        ...(request.names === undefined ? {} : { names: request.names }),
      }),
    };
  }

  /**
   * One provider call raced against the soft deadline.
   *
   * Returns {@link TIMED_OUT} for a timeout, an abort or any provider error —
   * all three degrade to the template.
   */
  private async _requestDraft(
    prompt: string,
    controller: AbortController,
  ): Promise<unknown | typeof TIMED_OUT> {
    const call = this._text.extractStructure({
      // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
      schema: CombatNarrationDraftSchema as unknown as Record<string, unknown>,
      schemaName: SCHEMA_NAME,
      prompt,
      signal: controller.signal,
      task: TASK,
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

  private get _text(): CombatNarrationServiceOptions['text'] {
    return this._options.text;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Builds an outcome narrator over the injected `text.extractStructure`
 * capability. Production wiring pins the `combat-narration` task preset there.
 */
export const getCombatNarrationService = (
  options: CombatNarrationServiceOptions,
): CombatNarrationServiceInterface => CombatNarrationService.create(options);
