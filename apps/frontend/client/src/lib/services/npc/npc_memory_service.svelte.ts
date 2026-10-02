// apps/frontend/client/src/lib/services/npc/npc_memory_service.svelte.ts
//
// Per-NPC conversational memory. NPCs remember the player between separate
// conversations and greet a returning player with a fresh, history-aware line.
//
// Lifecycle:
//   1. Dialogue closes → `recordConversation()` stores the tail verbatim AND,
//      immediately and deterministically, folds the transcript into the rolling
//      summary. A background digest then compacts that into notes and
//      pre-generates the next opener.
//   2. Every NPC turn → `getPromptFacts()` projects the bounded memory into the
//      prompt, so replies reference past conversations.
//   3. Player walks up to / loads a map with a remembered NPC →
//      `prefetchByName()` / `prefetchForNpcs()` refreshes a stale opener in the
//      background, so it is ready before the player presses interact.
//   4. Dialogue opens → `resolveGreeting()` swaps the authored greeting for the
//      prepared opener (zero added latency; falls back to authored text).
//
// BACKGROUND LIFECYCLE (issue #382)
//
// All background work is owned by `npc_memory_lifecycle.ts`, which holds a
// GENERATION bumped by reset/hydrate/campaign-switch/dispose. Every unit is
// dropped BEFORE dispatch when its generation is stale, so obsolete queued work
// costs zero provider calls rather than one wasted call. Bookkeeping is keyed by
// ticket, so one unit's cleanup can never clear another's marker.
//
// Two properties the previous bare promise chain did not have:
//
//   - AN OPENER IS STAMPED WITH THE STATE IT WAS GENERATED AGAINST, not with
//     its completion time. `_refreshOpener` revalidates the world-state
//     fingerprint after the call returns; if the world moved on, the result is
//     discarded and the opener is left stale rather than being dated forward
//     into a freshness it has not earned. Unrelated frame-level churn does not
//     invalidate memory, because the fingerprint is built from task-relevant
//     world facts, not from a frame counter.
//   - AND IT IS REVALIDATED WHEN IT IS CONSUMED, not only when it is produced.
//     `resolveGreeting` recomputes the fingerprint it was stamped with. A quest
//     completed, an item carried or a persona rewritten between the refresh and
//     the moment the player actually presses interact used to leave the old
//     greeting on screen and display it as current. The player now sees the
//     AUTHORED greeting instead, and a refresh is requested in the background —
//     a bounded, debounced, one-at-a-time retry, never an unbounded loop.
//   - A SUPERSEDED DIGEST DOES NOT LOSE THE CONVERSATION. A digest carries
//     durable notes and promises. If it is dropped, its lines are carried
//     forward (bounded) and offered to the next digest, which is the only
//     lossless option. Latest-only is correct for a replaceable opener refresh
//     and is NOT correct here.
//
// Persisted through the save registry (`npcMemory`). All state is bounded by
// NPC_MEMORY_LIMITS so neither the save nor the prompt grows with play time.

import {
  NPC_MEMORY_LIMITS,
  NPC_MEMORY_MAP_PREFETCH_LIMIT,
  NPC_MEMORY_OPENER_MAX_AGE_MS,
  NPC_MEMORY_PREFETCH_COOLDOWN_MS,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  NpcMemoryDigestSchema,
  NpcMemoryOpenerOutputSchema,
  NpcMemoryStateSchema,
} from '@aikami/schemas';
import type { NpcMemoryLine, NpcMemoryRecord, NpcMemoryState } from '@aikami/types';
import { Value } from 'typebox/value';
import type { DialogueNpcData } from '$types';
import { textGenerationService } from '../ai/text_generation_service.svelte.ts';
import { campaignService } from '../campaign/campaign_service.svelte.ts';
import { buildGameStateFacts } from '../game/game_state_facts.ts';
import { npcDialogueService } from '../game/npc_dialogue_service.svelte.ts';
import { registerSerializable } from '../game/serializable_service';
import {
  createNpcBackgroundContextReader,
  type NpcBackgroundContextReader,
  type NpcBackgroundInputs,
} from './npc_background_context.ts';
import { publishNpcMemoryBackgroundDiagnostics } from './npc_memory_diagnostics.ts';
import {
  createNpcMemoryLifecycle,
  type NpcBackgroundContext,
  type NpcBackgroundOutcome,
  type NpcMemoryLifecycle,
} from './npc_memory_lifecycle.ts';
import {
  buildDigestUserPrompt,
  buildMemoryPromptFacts,
  buildOpenerUserPrompt,
  clampSummary,
  clampText,
  evictOldest,
  fallbackSummary,
  mergeNotes,
  mergeRestoredDigestLines,
  sanitizeChips,
  toMemoryLines,
} from './npc_memory_utils.ts';
import { type OpenerRejection, revalidateOpener } from './npc_opener_freshness.ts';
import { renderBackgroundFacts } from './npc_prompt_projection.ts';

export type NpcMemoryServiceOptions = BaseFrontendClassOptions;

/** Plain JSON-schema dictionaries for the structured-output transport (built once). */
const toJsonSchema = (schema: object): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema));
const DIGEST_JSON_SCHEMA = toJsonSchema(NpcMemoryDigestSchema);
const OPENER_JSON_SCHEMA = toJsonSchema(NpcMemoryOpenerOutputSchema);

/**
 * Ceiling on transcript lines carried forward for a conversation whose digest
 * was superseded before it could run.
 *
 * Bounded so a player who talks to an NPC in a burst cannot grow the save. The
 * cap is deliberately generous against `digestTranscriptLines`, because losing
 * the middle of a burst is the failure this carry-forward exists to prevent.
 */
const MAX_CARRIED_LINES = NPC_MEMORY_LIMITS.digestTranscriptLines * 2;

/** Public contract for per-NPC conversational memory. */
export type NpcMemoryServiceInterface = BaseFrontendClassInterface & {
  /**
   * Stores a finished conversation. No-op when the player never spoke (an
   * opened-and-closed dialogue must not consume the prepared opener). Runs the
   * digest in the background; the returned promise settles when it finishes or
   * is dropped.
   */
  recordConversation(options: {
    npcId: string;
    npcName: string;
    messages: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
  }): Promise<void>;
  /** Bounded memory facts for the NPC's dialogue prompt. Empty for strangers. */
  getPromptFacts(npcId: string): string[];
  /** Replaces the authored greeting with the prepared returning opener, if any. */
  resolveGreeting(npc: DialogueNpcData): DialogueNpcData;
  /** Proximity hook — the engine reports targets by display name only. */
  prefetchByName(npcName: string): void;
  /** Map-load hook — refreshes openers for remembered NPCs present on the map. */
  prefetchForNpcs(npcIds: readonly string[]): void;
  /** Save-registry: current state snapshot. */
  serialize(): NpcMemoryState;
  /** Save-registry: restore from a snapshot (validated; invalid resets). */
  hydrate(data: unknown): void;
  /** Save-registry: clear memory (new game / older save without memory). */
  reset(): void;
};

class NpcMemoryService
  extends BaseFrontendClass<NpcMemoryServiceOptions>
  implements NpcMemoryServiceInterface
{
  /** Campaign the records belong to. */
  private _campaignId: string | undefined;

  /** Records keyed by NPC ID (plain object — serialized as-is). */
  private _records: NpcMemoryState['records'] = {};

  /** Per-NPC timestamp of the last prefetch attempt (debounce). */
  private _lastPrefetchAt = new Map<string, number>();

  /**
   * Monotonic counter of refreshes DISPATCHED for each NPC.
   *
   * Keyed by ticket rather than by "is this NPC refreshing", so a newer refresh
   * supersedes an older one explicitly and a stale `finally` cannot clear a
   * live marker. It is deliberately NOT a "currently refreshing" set: such a
   * set was the previous cleanup bug, and the per-NPC cooldown plus the global
   * pending bound already do that job without a marker that can leak.
   */
  private _refreshTicketByNpc = new Map<string, number>();

  /**
   * Transcript lines whose digest has not completed, per NPC.
   *
   * The lossless half of supersession: a digest that never runs does not take
   * its conversation with it, because the lines are offered again to the next
   * digest. Bounded by {@link MAX_CARRIED_LINES}.
   */
  private _unsummarized = new Map<string, NpcMemoryLine[]>();

  /**
   * Compiled immutable prompt blocks, keyed by CONTENT (issue #382).
   *
   * Not a result cache: nothing a model produced is ever stored here. Every
   * entry is a pure function of content the client already holds, so a changed
   * input is a DIFFERENT key rather than a stale hit. Cleared on every
   * lifecycle retirement, so a campaign switch cannot retain another
   * campaign's projections.
   *
   * Measured justification: a second opener refresh for the same NPC against
   * an unchanged world re-derives 99.4% of the previous prompt's characters.
   * That is client CPU and allocation, not a provider saving — the provider is
   * only paid for what it is sent, and this lane reports those two costs
   * separately rather than conflating them.
   */

  /**
   * The inputs a background memory call sees: persona, projected world facts,
   * and the compiled system prompt.
   *
   * Owned by its own module so the same reader answers the pre-dispatch,
   * post-completion and at-consumption questions with one implementation. See
   * `npc_background_context.ts` for why the three must not drift.
   */
  private readonly _context: NpcBackgroundContextReader = createNpcBackgroundContextReader({
    readGameStateFacts: (npcId) => buildGameStateFacts({ npcId }),
    readPersona: (subject) => this._npcPersona(subject),
  });

  /**
   * Generation-scoped background work.
   *
   * Replaces the previous bare per-NPC promise chain, which could not cancel
   * obsolete queued work and whose `finally` blocks raced across generations.
   */
  private readonly _lifecycle: NpcMemoryLifecycle = createNpcMemoryLifecycle({
    onError: ({ npcId, kind, error }) => {
      this.warn('background-task:failed', { npcId, kind, error: String(error) });
    },
    // Published on every transition AND on every release, so a snapshot taken
    // while work is in flight is meaningful, every discard is individually
    // attributable, and "nothing is left running" is observable from outside.
    onEvent: () => {
      publishNpcMemoryBackgroundDiagnostics(this._lifecycle.snapshot());
    },
    onSettled: () => {
      publishNpcMemoryBackgroundDiagnostics(this._lifecycle.snapshot());
    },
  });

  // ── Public API ────────────────────────────────────────────────────────

  /** @inheritdoc */
  recordConversation(options: {
    npcId: string;
    npcName: string;
    messages: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
  }): Promise<void> {
    this._syncCampaign();
    const lines = toMemoryLines(options.messages);
    if (!lines.some((line) => line.role === 'player')) {
      this.debug('recordConversation:skip-no-player-turn', { npcId: options.npcId });
      return Promise.resolve();
    }

    const previous = this._records[options.npcId];
    // Deterministic update first — memory survives even if the digest fails,
    // is cancelled, or is superseded before it ever reaches the provider.
    const record: NpcMemoryRecord = {
      npcId: options.npcId,
      npcName: options.npcName,
      conversationCount: (previous?.conversationCount ?? 0) + 1,
      lastTalkedAt: Date.now(),
      summary: fallbackSummary({ previous: previous?.summary ?? '', lines }),
      notes: previous?.notes ?? [],
      lastExchange: lines.slice(-NPC_MEMORY_LIMITS.lastExchangeLines),
      // The previous opener was consumed by this conversation.
      opener: undefined,
    };
    this._records[options.npcId] = record;
    evictOldest(this._records);
    this._carryUnsummarized(options.npcId, lines);
    this.info('recordConversation', {
      npcId: options.npcId,
      conversationCount: record.conversationCount,
      lines: lines.length,
    });

    return this._lifecycle.enqueue({
      npcId: options.npcId,
      kind: 'digest',
      run: (context) => this._digest({ npcId: options.npcId, previous, context }),
    });
  }

  /** @inheritdoc */
  getPromptFacts(npcId: string): string[] {
    return buildMemoryPromptFacts(this._getRecord(npcId));
  }

  /** @inheritdoc */
  resolveGreeting(npc: DialogueNpcData): DialogueNpcData {
    const record = this._getRecord(npc.npcId);
    if (!record || record.conversationCount === 0) {
      return npc;
    }
    const rejection = this._revalidateOpener(record);
    if (rejection !== undefined) {
      // The AUTHORED greeting is always a valid answer. Falling back to it is
      // what makes a stale opener a degradation rather than a failure: the
      // player still gets a line, memory facts still apply to the prompt, and
      // the next conversation regenerates the opener against current state.
      //
      // The refresh is requested rather than awaited. Blocking dialogue opening
      // on a provider call would trade a cosmetic staleness for a multi-second
      // wait on the one interaction that must never wait.
      this.debug('resolveGreeting:rejected', { npcId: npc.npcId, reason: rejection });
      void this._prefetchOpener({ npcId: npc.npcId, validation: { rejection } });
      return npc;
    }
    // An opener that has merely AGED is still shown: nothing it depends on
    // changed, so it is still the right line, and the background refresh below
    // will re-date it without asking the provider anything. Age bounds how
    // often memory is looked at; it does not decide what is true.
    void this._prefetchOpener({ npcId: npc.npcId, validation: { rejection } });
    const opener = record?.opener;
    /* c8 ignore next -- _revalidateOpener only returns undefined for a usable opener */
    if (!opener) {
      return npc;
    }
    this.debug('resolveGreeting:returning', {
      npcId: npc.npcId,
      ageMs: Date.now() - opener.generatedAt,
      chips: opener.suggestions.length,
    });
    return {
      ...npc,
      dialog: opener.text,
      initialSuggestions:
        opener.suggestions.length > 0 ? opener.suggestions : npc.initialSuggestions,
    };
  }

  /** @inheritdoc */
  prefetchByName(npcName: string): void {
    this._syncCampaign();
    const key = npcName.trim().toLowerCase();
    const record = Object.values(this._records).find(
      (entry) => entry.npcName.trim().toLowerCase() === key,
    );
    if (record) {
      void this._prefetchOpener({ npcId: record.npcId });
    }
  }

  /** @inheritdoc */
  prefetchForNpcs(npcIds: readonly string[]): void {
    const remembered = npcIds
      .map((id) => this._getRecord(id))
      .filter((record): record is NpcMemoryRecord => record !== undefined)
      .sort((a, b) => b.lastTalkedAt - a.lastTalkedAt)
      .slice(0, NPC_MEMORY_MAP_PREFETCH_LIMIT);
    for (const record of remembered) {
      void this._prefetchOpener({ npcId: record.npcId });
    }
  }

  /** @inheritdoc */
  serialize(): NpcMemoryState {
    this._syncCampaign();
    return { campaignId: this._campaignId, records: structuredClone(this._records) };
  }

  /** @inheritdoc */
  hydrate(data: unknown): void {
    if (!Value.Check(NpcMemoryStateSchema, data)) {
      this.warn('hydrate:invalid-snapshot — resetting');
      this.reset();
      return;
    }
    // Invalidate BEFORE the new records land, so a result from the old state
    // can never write into the new one.
    this._retireGeneration();
    this._campaignId = data.campaignId;
    this._records = structuredClone(data.records);
    this._lastPrefetchAt.clear();
    this._unsummarized.clear();
    this.info('hydrate', { records: Object.keys(this._records).length });
  }

  /** @inheritdoc */
  reset(): void {
    this._retireGeneration();
    this._campaignId = campaignService.activeCampaign?.id;
    this._records = {};
    this._lastPrefetchAt.clear();
    this._unsummarized.clear();
    // A new game starts from a clean diagnostic baseline; otherwise the
    // previous campaign's discards would be reported against this one.
    this._lifecycle.resetDiagnostics();
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    // Retire first so nothing queued can dispatch, then clear the bookkeeping
    // that generation owned. A queued unit's `finally` runs against ITS OWN
    // ticket, so it cannot remove state belonging to a later generation.
    this._retireGeneration();
    this._records = {};
    this._lastPrefetchAt.clear();
    this._unsummarized.clear();
    this._refreshTicketByNpc.clear();
    // Teardown waits for the retired generation to finish unwinding before the
    // service is gone, so a caller awaiting `recordConversation` is never left
    // on a promise this service will never fulfil.
    await this._lifecycle.drain();
    await super.dispose();
  }

  // ── Private ───────────────────────────────────────────────────────────

  /** Record lookup scoped to the active campaign. */
  private _getRecord(npcId: string): NpcMemoryRecord | undefined {
    this._syncCampaign();
    return this._records[npcId];
  }

  /**
   * Retires the current background generation and releases its bookkeeping.
   *
   * Split out so `reset`, `hydrate`, the campaign switch and `dispose` all do
   * the same thing in the same order. Forgetting it in one of them is exactly
   * how a queued subscriber outlives the state it was queued for.
   */
  private _retireGeneration(): void {
    this._lifecycle.invalidate();
    this._refreshTicketByNpc.clear();
    // Compiled prompts are content-keyed, so an entry could never be served
    // for the wrong content — but a campaign switch should not RETAIN another
    // campaign's personas in memory either, and the bound is the point.
    this._context.clear();
  }

  /** Refreshes a remembered NPC's opener when missing, expired or unshowable. */
  private _prefetchOpener(options: {
    npcId: string;
    validation?: { rejection: OpenerRejection | undefined };
  }): Promise<void> {
    const { npcId, validation } = options;
    const record = this._getRecord(npcId);
    if (!record) {
      return Promise.resolve();
    }
    const needsOpener = validation
      ? this._isOpenerAged(record) || validation.rejection !== undefined
      : this._needsOpener(record);
    if (!needsOpener) {
      return Promise.resolve();
    }
    const now = Date.now();
    if (now - (this._lastPrefetchAt.get(npcId) ?? 0) < NPC_MEMORY_PREFETCH_COOLDOWN_MS) {
      return Promise.resolve();
    }
    this._lastPrefetchAt.set(npcId, now);

    return this._lifecycle.enqueue({
      npcId,
      kind: 'refresh',
      run: (context) => this._refreshOpener({ npcId, context }),
    });
  }

  /** Drops records that belong to a different campaign than the active one. */
  private _syncCampaign(): void {
    const active = campaignService.activeCampaign?.id;
    if (active === undefined || active === this._campaignId) {
      return;
    }
    if (this._campaignId !== undefined) {
      this.info('campaign-changed:clearing', { from: this._campaignId, to: active });
      this._records = {};
      this._unsummarized.clear();
      // The subscribers queued for the OLD campaign are cancelled here, not
      // merely ignored on arrival: a campaign switch must not leave a digest
      // for the previous world queued behind the next one.
      this._retireGeneration();
    }
    this._campaignId = active;
  }

  /**
   * Whether the record's opener has outlived its max age.
   *
   * A REFRESH TRIGGER, not a display veto. The max age bounds how long an
   * opener may go without being looked at; it does not assert that the answer
   * became wrong. An opener that is old but whose world and persona are
   * unchanged is still the right greeting, and #422 measured that re-asking the
   * provider for it is a full call spent on a byte-identical prompt. Those two
   * facts are why age and validity are separate predicates here and must stay
   * that way: conflating them turns every fifteen minutes of play into either a
   * silent suppression or a wasted call.
   */
  private _isOpenerAged(record: NpcMemoryRecord): boolean {
    const opener = record.opener;
    return opener === undefined || Date.now() - opener.generatedAt > NPC_MEMORY_OPENER_MAX_AGE_MS;
  }

  /**
   * Whether this record's opener should be regenerated.
   *
   * 🔴 Consumption-time revalidation and the refresh trigger have to agree, or
   * the fix is worse than the defect. `resolveGreeting` refuses to show an
   * opener whose world or persona moved on; if `_prefetchOpener` still asked
   * only "has it expired?", nothing would ever be requested, and the player
   * would get the authored greeting for a FULL MAX-AGE after every quest they
   * completed — a silent regression wearing the fix's own name.
   *
   * One predicate, used by both paths, is what keeps the offer and the refusal
   * in step.
   */
  private _needsOpener(record: NpcMemoryRecord): boolean {
    return this._isOpenerAged(record) || this._revalidateOpener(record) !== undefined;
  }
  /**
   * Whether a prepared opener may still be SHOWN, checked at the moment it is
   * consumed rather than only at the moment it was produced.
   *
   * 🔴 THIS IS THE CHECK THAT WAS MISSING. Every previous validation happened
   * when the opener was generated: `_refreshOpener` compared the fingerprint
   * before and after its own call, which can only detect a change that happened
   * DURING the call. Nothing compared the opener against the world at the
   * instant the player pressed interact. The window between them is the whole
   * map walk: a quest completes, the player picks up the sword they were told
   * to find, an author ships a persona rewrite — and the greeting that greets
   * them is the one generated before all of it, presented without complaint.
   *
   * DEGRADATION IS DELIBERATE AND BOUNDED. A refusal returns the AUTHORED
   * greeting and asks for exactly one debounced, generation-scoped refresh —
   * `NPC_MEMORY_PREFETCH_COOLDOWN_MS` between attempts and one unit per NPC, so
   * a world that keeps moving produces a bounded amount of background work
   * rather than a regeneration loop. Deliberate REUSE is preserved: if nothing
   * relevant changed, the opener is served from the existing value and no
   * provider call is made.
   *
   * The decision itself — which of the four failures applies, and why age is
   * not one of them — lives in `npc_opener_freshness.ts`, and is tested there
   * exhaustively.
   */
  private _revalidateOpener(record: NpcMemoryRecord): OpenerRejection | undefined {
    const { fingerprint, promptRevision } = this._inputs(record);
    return revalidateOpener(record, { worldFingerprint: fingerprint, promptRevision });
  }

  /** Appends transcript lines to the carry-forward buffer, bounded. */
  private _carryUnsummarized(npcId: string, lines: readonly NpcMemoryLine[]): void {
    const existing = this._unsummarized.get(npcId) ?? [];
    const next = [...existing, ...lines];
    this._unsummarized.set(npcId, next.slice(-MAX_CARRIED_LINES));
  }

  /** Removes the carry-forward buffer; used when a digest actually consumes it. */
  private _takeUnsummarized(npcId: string): NpcMemoryLine[] {
    const lines = this._unsummarized.get(npcId) ?? [];
    this._unsummarized.delete(npcId);
    return lines;
  }

  /** Returns the carry-forward buffer to the pool when a digest never runs. */
  private _restoreUnsummarized(npcId: string, lines: readonly NpcMemoryLine[]): void {
    if (lines.length === 0) {
      return;
    }
    // Chronology, not append order — see `mergeRestoredDigestLines`. Everything
    // already in the buffer arrived AFTER these lines were claimed, so they go
    // in front, and overflow drops the oldest rather than the newest.
    this._unsummarized.set(
      npcId,
      mergeRestoredDigestLines({
        claimed: lines,
        accumulated: this._unsummarized.get(npcId) ?? [],
        limit: MAX_CARRIED_LINES,
      }),
    );
  }

  /** What a background call for this record would see, right now. */
  private _inputs(record: NpcMemoryRecord): NpcBackgroundInputs {
    return this._context.inputs({ npcId: record.npcId, npcName: record.npcName });
  }

  /**
   * The NPC's persona block, without the rest of a turn's context.
   *
   * Falls back to the name-only persona when the orchestrator is not configured
   * (the dev harness), which is the same fallback the previous full-projection
   * path had.
   */
  private _npcPersona(subject: { npcId: string; npcName: string }): string {
    try {
      return npcDialogueService.buildNpcPersonaForPrompt(subject);
    } catch {
      return `You are ${subject.npcName}.`;
    }
  }

  /** One background call: compact memory + prepare the next opener. */
  private async _digest(options: {
    npcId: string;
    previous: NpcMemoryRecord | undefined;
    context: NpcBackgroundContext;
  }): Promise<NpcBackgroundOutcome> {
    const { npcId, previous, context } = options;
    const record = this._records[npcId];
    if (context.isStale() || record === undefined) {
      this.debug('digest:stale-before-dispatch', { npcId });
      return 'superseded-before-dispatch';
    }
    // Claim the carry-forward buffer only now that the call is actually about to
    // happen. Claiming it at enqueue time would lose the lines to any earlier
    // supersession without a digest ever having consumed them.
    const lines = this._takeUnsummarized(npcId);
    const { gameStateFacts, fingerprint: dispatchedAgainst, promptRevision } = this._inputs(record);
    let structured: unknown;
    try {
      structured = await textGenerationService.extractStructure({
        schema: DIGEST_JSON_SCHEMA,
        schemaName: 'NpcMemoryDigest',
        systemPrompt: this._context.digestSystemPrompt(record),
        prompt: buildDigestUserPrompt({
          record: previous,
          npcName: record.npcName,
          lines,
          gameStateFacts,
          renderFacts: renderBackgroundFacts,
        }),
        task: 'summarization',
        // Scoped so a result computed inside one campaign can never be shared
        // with a request in another.
        scope: this._campaignId ?? 'no-campaign',
        signal: context.signal,
      });
    } catch {
      // Preserve failed conversations only within their original generation.
      if (!context.isStale()) {
        this._restoreUnsummarized(npcId, lines);
      }
      this.warn('digest:provider-failed — keeping deterministic memory', { npcId });
      return 'failed';
    }
    const current = this._records[npcId];
    if (context.isStale() || current !== record) {
      this.debug('digest:stale-result-dropped', { npcId });
      if (!context.isStale()) {
        this._restoreUnsummarized(npcId, lines);
      }
      return 'invalidated-after-completion';
    }
    if (!Value.Check(NpcMemoryDigestSchema, structured)) {
      this.warn('digest:invalid-output — keeping deterministic memory', { npcId });
      this._restoreUnsummarized(npcId, lines);
      return 'failed';
    }
    current.summary = clampSummary(structured.summary);
    current.notes = mergeNotes({ existing: current.notes, incoming: structured.notes });
    if (this._inputs(current).fingerprint === dispatchedAgainst) {
      current.opener = {
        text: clampText({ text: structured.opener, max: NPC_MEMORY_LIMITS.openerChars }),
        suggestions: sanitizeChips(structured.suggestions),
        generatedAt: Date.now(),
        forConversation: current.conversationCount,
        // Same contract as the refreshed opener: stamped with the fingerprint
        // it was generated against, so a later refresh can distinguish "the
        // world moved on" from "nothing changed".
        worldFingerprint: dispatchedAgainst,
        // …and with the persona/prompt revision, so CONSUMPTION can tell a
        // greeting written in a voice that still exists from one written in a
        // voice that was since deleted.
        promptRevision,
      };
    }
    this.info('digest:complete', {
      npcId,
      summaryChars: current.summary.length,
      notes: current.notes.length,
      chips: current.opener?.suggestions.length ?? 0,
    });
    return 'applied';
  }

  /** Opener-only refresh for a remembered NPC (world state moved on). */
  private async _refreshOpener(options: {
    npcId: string;
    context: NpcBackgroundContext;
  }): Promise<NpcBackgroundOutcome> {
    const { npcId, context } = options;
    const record = this._records[npcId];
    if (context.isStale() || record === undefined || !this._needsOpener(record)) {
      return 'superseded-before-dispatch';
    }
    // Claimed HERE, not at enqueue time: a unit that never runs must not consume
    // a ticket number that a later, live refresh would then look older than.
    const ticket = (this._refreshTicketByNpc.get(npcId) ?? 0) + 1;
    this._refreshTicketByNpc.set(npcId, ticket);

    const { gameStateFacts, fingerprint: dispatchedAgainst, promptRevision } = this._inputs(record);
    // The world state this opener is being generated AGAINST. Stamping the
    // result with its completion time instead is what made a deferred, stale
    // opener read as fresh: staleness had been judged when the unit was queued,
    // and the world then moved on.
    //
    // 🔴 AND the reason this call is worth making at all. If the fingerprint
    // matches the one the opener in hand was generated against, then the memory
    // has not changed and the world has not changed, so the prompt would be
    // byte-identical to the one that produced the greeting the player already
    // saw. Measured: 2 of 3 calls issued in a chronological 40-minute replay were
    // re-asks of an unchanged question. Re-asking is not free — it is a full
    // provider call whose answer is a second greeting for the same situation.
    //
    // It is NOT an exact-result cache. Nothing is replayed: the existing opener
    // simply stays, and is re-dated, because it is still the right answer for
    // the world it was generated against. A real world change still refreshes.
    //
    // 🔴 The `!_needsOpener` half is load-bearing. Re-dating is a statement
    // that the existing answer is still the right answer, so it may only be
    // reached when nothing the prompt depends on has moved AND the opener is
    // not being refreshed for its own sake. Re-stamping an opener that is
    // semantically current but belongs to a previous conversation would hand
    // the player a greeting for a talk that already happened.
    if (
      record.opener?.forConversation === record.conversationCount &&
      dispatchedAgainst === record.opener.worldFingerprint &&
      promptRevision === record.opener.promptRevision
    ) {
      this.debug('refreshOpener:inputs-unchanged — re-dating instead of re-asking', { npcId });
      record.opener = {
        ...record.opener,
        generatedAt: Date.now(),
      };
      return 'applied';
    }
    let structured: unknown;
    try {
      structured = await textGenerationService.extractStructure({
        schema: OPENER_JSON_SCHEMA,
        schemaName: 'NpcMemoryOpener',
        systemPrompt: this._context.openerSystemPrompt(record),
        prompt: buildOpenerUserPrompt({
          record,
          gameStateFacts,
          renderFacts: renderBackgroundFacts,
        }),
        task: 'summarization',
        scope: this._campaignId ?? 'no-campaign',
        signal: context.signal,
      });
    } catch {
      this.warn('refreshOpener:provider-failed', { npcId });
      return 'failed';
    }
    // Apply-time revalidation, in two independent directions.
    if (context.isStale() || this._records[npcId] !== record || !this._needsOpener(record)) {
      return 'invalidated-after-completion';
    }
    if (this._refreshTicketByNpc.get(npcId) !== ticket) {
      // A newer refresh for this NPC was dispatched; this result is not it.
      return 'superseded-before-dispatch';
    }
    if (this._inputs(record).fingerprint !== dispatchedAgainst) {
      // The world moved on while the call was in flight. The opener is
      // therefore still stale, and dating it now would make it read as fresh
      // for another full max-age on the strength of a call that predates the
      // change. It is left absent; the next proximity or map load regenerates.
      this.debug('refreshOpener:world-moved-on', { npcId });
      return 'invalidated-after-completion';
    }
    // The same argument for the persona: a call dispatched before an authored
    // rewrite must not be dated into it.
    if (this._inputs(record).promptRevision !== promptRevision) {
      this.debug('refreshOpener:prompt-revised', { npcId });
      return 'invalidated-after-completion';
    }
    if (!Value.Check(NpcMemoryOpenerOutputSchema, structured)) {
      this.warn('refreshOpener:invalid-output', { npcId });
      return 'failed';
    }
    record.opener = {
      text: clampText({ text: structured.opener, max: NPC_MEMORY_LIMITS.openerChars }),
      suggestions: sanitizeChips(structured.suggestions),
      generatedAt: Date.now(),
      forConversation: record.conversationCount,
      // 🔴 Stamped with the fingerprint it was generated AGAINST, so a later
      // refresh can tell "the world moved on" from "nothing changed at all".
      // Absent on an opener hydrated from an older save, and an absent
      // fingerprint never matches, so an old save refreshes — the safe
      // direction.
      worldFingerprint: dispatchedAgainst,
      // Same for the persona/prompt revision. Both are checked again when the
      // greeting is CONSUMED, which is the only check that covers a change made
      // between the refresh finishing and the player pressing interact.
      promptRevision,
    };
    this.info('refreshOpener:complete', { npcId });
    return 'applied';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const npcMemoryService: NpcMemoryServiceInterface = NpcMemoryService.create({
  className: 'NpcMemoryService',
});

// Save/load participation — memory travels with the campaign save.
registerSerializable('npcMemory', npcMemoryService);
