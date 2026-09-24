// apps/frontend/client/src/lib/services/npc/npc_memory_service.svelte.ts
//
// Per-NPC conversational memory. NPCs remember the player between separate
// conversations and greet a returning player with a fresh, history-aware line.
//
// Lifecycle:
//   1. Dialogue closes → `recordConversation()` stores the tail verbatim and
//      runs ONE background digest call that compacts the transcript into a
//      bounded rolling summary + notes AND pre-generates the next opener.
//   2. Every NPC turn → `getPromptFacts()` projects the bounded memory into the
//      prompt, so replies reference past conversations.
//   3. Player walks up to / loads a map with a remembered NPC →
//      `prefetchByName()` / `prefetchForNpcs()` refreshes a stale opener in the
//      background, so it is ready before the player presses interact.
//   4. Dialogue opens → `resolveGreeting()` swaps the authored greeting for the
//      prepared opener (zero added latency; falls back to authored text).
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
  buildDigestSystemPrompt,
  buildDigestUserPrompt,
  buildMemoryPromptFacts,
  buildOpenerSystemPrompt,
  buildOpenerUserPrompt,
  clampSummary,
  clampText,
  evictOldest,
  fallbackSummary,
  mergeNotes,
  sanitizeChips,
  toMemoryLines,
} from './npc_memory_utils.ts';

export type NpcMemoryServiceOptions = BaseFrontendClassOptions;

/** Plain JSON-schema dictionaries for the structured-output transport (built once). */
const toJsonSchema = (schema: object): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema));
const DIGEST_JSON_SCHEMA = toJsonSchema(NpcMemoryDigestSchema);
const OPENER_JSON_SCHEMA = toJsonSchema(NpcMemoryOpenerOutputSchema);

/** Public contract for per-NPC conversational memory. */
export type NpcMemoryServiceInterface = BaseFrontendClassInterface & {
  /**
   * Stores a finished conversation. No-op when the player never spoke (an
   * opened-and-closed dialogue must not consume the prepared opener). Runs the
   * digest in the background; the returned promise settles when it finishes.
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

  /** Per-NPC serialisation of background work (digest before refresh). */
  private _queues = new Map<string, Promise<void>>();

  /** Per-NPC timestamp of the last prefetch attempt (debounce). */
  private _lastPrefetchAt = new Map<string, number>();

  /** In-flight opener refreshes (dedupe). */
  private _prefetching = new Set<string>();

  /** Bumped on reset/hydrate so in-flight results for old state are dropped. */
  private _epoch = 0;

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
    // Deterministic update first — memory survives even if the digest fails.
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
    this.info('recordConversation', {
      npcId: options.npcId,
      conversationCount: record.conversationCount,
      lines: lines.length,
    });

    return this._enqueue(options.npcId, () =>
      this._digest({ npcId: options.npcId, previous, lines }),
    );
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
    const opener = record.opener;
    if (!opener || opener.forConversation !== record.conversationCount) {
      // Not ready — keep the authored greeting; prompt memory still applies.
      this.debug('resolveGreeting:no-opener', { npcId: npc.npcId });
      void this._prefetchOpener(npc.npcId);
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
      void this._prefetchOpener(record.npcId);
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
      void this._prefetchOpener(record.npcId);
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
    this._epoch++;
    this._campaignId = data.campaignId;
    this._records = structuredClone(data.records);
    this._lastPrefetchAt.clear();
    this.info('hydrate', { records: Object.keys(this._records).length });
  }

  /** @inheritdoc */
  reset(): void {
    this._epoch++;
    this._campaignId = campaignService.activeCampaign?.id;
    this._records = {};
    this._lastPrefetchAt.clear();
  }

  // ── Private ───────────────────────────────────────────────────────────

  /** Record lookup scoped to the active campaign. */
  private _getRecord(npcId: string): NpcMemoryRecord | undefined {
    this._syncCampaign();
    return this._records[npcId];
  }

  /** Refreshes a remembered NPC's opener when missing or stale (debounced, deduped). */
  private _prefetchOpener(npcId: string): Promise<void> {
    const record = this._getRecord(npcId);
    if (!record || !this._isOpenerStale(record) || this._prefetching.has(npcId)) {
      return Promise.resolve();
    }
    const now = Date.now();
    if (now - (this._lastPrefetchAt.get(npcId) ?? 0) < NPC_MEMORY_PREFETCH_COOLDOWN_MS) {
      return Promise.resolve();
    }
    this._lastPrefetchAt.set(npcId, now);
    this._prefetching.add(npcId);
    return this._enqueue(npcId, () => this._refreshOpener(npcId)).finally(() => {
      this._prefetching.delete(npcId);
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
      this._epoch++;
    }
    this._campaignId = active;
  }

  /** Whether the record needs a (new) opener. */
  private _isOpenerStale(record: NpcMemoryRecord): boolean {
    const opener = record.opener;
    return (
      !opener ||
      opener.forConversation !== record.conversationCount ||
      Date.now() - opener.generatedAt > NPC_MEMORY_OPENER_MAX_AGE_MS
    );
  }

  /** Chains work per NPC so a refresh never races the digest it depends on. */
  private _enqueue(npcId: string, task: () => Promise<void>): Promise<void> {
    const previous = this._queues.get(npcId) ?? Promise.resolve();
    const next = previous.then(task).catch((error: unknown) => {
      this.warn('background-task:failed', { npcId, error: String(error) });
    });
    this._queues.set(npcId, next);
    void next.finally(() => {
      if (this._queues.get(npcId) === next) {
        this._queues.delete(npcId);
      }
    });
    return next;
  }

  /** Persona + current world facts for a background call. */
  private _npcContext(record: NpcMemoryRecord): { persona: string; gameStateFacts: string[] } {
    const gameStateFacts = buildGameStateFacts({ npcId: record.npcId });
    try {
      const projection = npcDialogueService.buildContext({
        npcId: record.npcId,
        npcName: record.npcName,
        messages: [],
        gameStateFacts: [],
      });
      return { persona: projection.persona, gameStateFacts };
    } catch {
      // Orchestrator not configured (dev harness) — name-only persona.
      return { persona: `You are ${record.npcName}.`, gameStateFacts };
    }
  }

  /** One background call: compact memory + prepare the next opener. */
  private async _digest(options: {
    npcId: string;
    previous: NpcMemoryRecord | undefined;
    lines: NpcMemoryLine[];
  }): Promise<void> {
    const epoch = this._epoch;
    const record = this._records[options.npcId];
    if (!record) {
      return;
    }
    const { persona, gameStateFacts } = this._npcContext(record);
    const structured = await textGenerationService.extractStructure({
      schema: DIGEST_JSON_SCHEMA,
      schemaName: 'NpcMemoryDigest',
      systemPrompt: buildDigestSystemPrompt({ persona, npcName: record.npcName }),
      prompt: buildDigestUserPrompt({
        record: options.previous,
        npcName: record.npcName,
        lines: options.lines,
        gameStateFacts,
      }),
      task: 'summarization',
    });
    const current = this._records[options.npcId];
    if (epoch !== this._epoch || current !== record) {
      this.debug('digest:stale-result-dropped', { npcId: options.npcId });
      return;
    }
    if (!Value.Check(NpcMemoryDigestSchema, structured)) {
      this.warn('digest:invalid-output — keeping deterministic memory', { npcId: options.npcId });
      return;
    }
    current.summary = clampSummary(structured.summary);
    current.notes = mergeNotes({ existing: current.notes, incoming: structured.notes });
    current.opener = {
      text: clampText({ text: structured.opener, max: NPC_MEMORY_LIMITS.openerChars }),
      suggestions: sanitizeChips(structured.suggestions),
      generatedAt: Date.now(),
      forConversation: current.conversationCount,
    };
    this.info('digest:complete', {
      npcId: options.npcId,
      summaryChars: current.summary.length,
      notes: current.notes.length,
      chips: current.opener.suggestions.length,
    });
  }

  /** Opener-only refresh for a remembered NPC (world state moved on). */
  private async _refreshOpener(npcId: string): Promise<void> {
    const epoch = this._epoch;
    const record = this._records[npcId];
    if (!record || !this._isOpenerStale(record)) {
      return;
    }
    const { persona, gameStateFacts } = this._npcContext(record);
    const structured = await textGenerationService.extractStructure({
      schema: OPENER_JSON_SCHEMA,
      schemaName: 'NpcMemoryOpener',
      systemPrompt: buildOpenerSystemPrompt({ persona, npcName: record.npcName }),
      prompt: buildOpenerUserPrompt({ record, gameStateFacts }),
      task: 'summarization',
    });
    if (epoch !== this._epoch || this._records[npcId] !== record) {
      return;
    }
    if (!Value.Check(NpcMemoryOpenerOutputSchema, structured)) {
      this.warn('refreshOpener:invalid-output', { npcId });
      return;
    }
    record.opener = {
      text: clampText({ text: structured.opener, max: NPC_MEMORY_LIMITS.openerChars }),
      suggestions: sanitizeChips(structured.suggestions),
      generatedAt: Date.now(),
      forConversation: record.conversationCount,
    };
    this.info('refreshOpener:complete', { npcId });
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
