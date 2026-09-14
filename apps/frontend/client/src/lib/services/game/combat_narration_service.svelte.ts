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
//   - ONE time budget per narration, with the same soft/hard discipline as the
//     decision service (`combat_ai_lifecycle`): a soft timeout aborts the
//     outstanding transport immediately instead of clearing the only abort
//     timer while the provider call keeps running;
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
import {
  createBoundedResultCache,
  createProviderTransport,
  createTimeBudget,
  raceSoftDeadline,
} from './combat_ai_lifecycle';
import { validateCombatNarrationDraft } from './combat_narration_policy';

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
  /** Hard deadline in ms — defaults to the §18 budget (4 s). */
  hardDeadlineMs?: number;
  /** Terminal-result cache cap; defaults to {@link DEFAULT_CACHE_ENTRIES}. */
  maxCachedResults?: number;
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
const DEFAULT_HARD_DEADLINE_MS = 4000;
const DEFAULT_CACHE_ENTRIES = 64;
const SCHEMA_NAME = 'CombatNarrationDraft';
const TASK = 'combat-narration';

class CombatNarrationService
  extends BaseFrontendClass<CombatNarrationServiceOptions>
  implements CombatNarrationServiceInterface
{
  private readonly _softDeadlineMs: number;
  private readonly _hardDeadlineMs: number;
  private readonly _transports = new Map<string, ReturnType<typeof createProviderTransport>>();
  private readonly _completed = createBoundedResultCache<string, CombatNarrationResult>({
    maxEntries: DEFAULT_CACHE_ENTRIES,
  });
  private readonly _inFlight = new Map<string, Promise<CombatNarrationResult>>();

  constructor(options: CombatNarrationServiceOptions) {
    super(options);
    this._softDeadlineMs = options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS;
    this._hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  }

  /** @inheritdoc */
  get activeNarrationCount(): number {
    return this._transports.size;
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
      return await inFlight;
    }
    const promise = this._run(request).finally(() => {
      this._inFlight.delete(request.narrationId);
    });
    this._inFlight.set(request.narrationId, promise);
    return await promise;
  }

  /** @inheritdoc */
  cancel(narrationId: string): void {
    const transport = this._transports.get(narrationId);
    if (transport === undefined) {
      return;
    }
    this.debug('cancel', { narrationId });
    // Abort the provider call AND drop the controller in one step: a narration
    // that lost its transport must never leave the provider request running.
    transport.abort();
    this._transports.delete(narrationId);
  }

  /** @inheritdoc */
  cancelAll(): void {
    this.debug('cancelAll', { count: this._transports.size });
    for (const narrationId of [...this._transports.keys()]) {
      this.cancel(narrationId);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async _run(request: CombatNarrationRequest): Promise<CombatNarrationResult> {
    // The flag-off path is synchronous templates only — no provider call, no
    // graceful degradation, exactly the shipped pre-526 behaviour (AC-9).
    if (this._options.enabled !== true) {
      return this._remember(request, this._template(request));
    }

    const transport = createProviderTransport({ id: request.narrationId });
    this._transports.set(request.narrationId, transport);
    const startedAt = Date.now();
    const budget = createTimeBudget({ startedAt, hardDeadlineMs: this._hardDeadlineMs });
    let hardDeadlineHit = false;
    transport.armHardAbort(budget.remainingMs(startedAt), () => {
      hardDeadlineHit = true;
      this.debug('narrate:hard-deadline', { narrationId: request.narrationId });
    });

    try {
      const prompt = buildOutcomeNarrationPrompt({
        events: [...request.events],
        ...(request.names === undefined ? {} : { names: request.names }),
      });
      const outcome = await raceSoftDeadline({
        transport,
        softDeadlineMs: Math.min(this._softDeadlineMs, budget.remainingMs()),
        call: () =>
          this._text.extractStructure({
            // guard-ignore lint/type-safety/casting: TypeBox schema handed to the AI gateway as its JSON-schema record.
            schema: CombatNarrationDraftSchema as unknown as Record<string, unknown>,
            schemaName: SCHEMA_NAME,
            prompt,
            signal: transport.signal,
            task: TASK,
          }),
      });

      if (outcome.kind !== 'value') {
        if (outcome.kind === 'soft_timeout') {
          // Fall back now and abort the outstanding call rather than clearing
          // the only abort path while the provider keeps working.
          this.debug('narrate:soft-timeout', { narrationId: request.narrationId });
        } else if (outcome.kind === 'aborted') {
          this.debug('narrate:aborted', {
            narrationId: request.narrationId,
            hardDeadlineHit,
          });
        } else {
          this.debug('narrate:provider-rejected', { narrationId: request.narrationId });
        }
        return this._remember(request, this._template(request));
      }

      if (!Value.Check(CombatNarrationDraftSchema, outcome.value)) {
        this.debug('narrate:invalid-draft', { narrationId: request.narrationId });
        return this._remember(request, this._template(request));
      }
      // A reply that lands after the encounter ended must never be applied.
      if (this._options.isStale?.() === true) {
        this.info('narrate:late-reply-discarded', { narrationId: request.narrationId });
        return this._remember(request, this._template(request));
      }
      const validated = validateCombatNarrationDraft({
        draft: outcome.value,
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
      return this._remember(request, {
        narrationId: request.narrationId,
        encounterId: request.encounterId,
        basedOnRevision: request.basedOnRevision,
        source: 'llm',
        text: validated.text,
      });
    } catch (error: unknown) {
      this.error('narrate:provider-error', error);
      return this._remember(request, this._template(request));
    } finally {
      // A soft/timed-out transport has already been aborted; anything else
      // clears its tracked hard-abort timer now.
      transport.abort();
      if (this._transports.get(request.narrationId) === transport) {
        this._transports.delete(request.narrationId);
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
    return this._completed.set(request.narrationId, result);
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
