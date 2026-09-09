// apps/frontend/client/src/lib/services/memory/memory_retrieval_service.svelte.ts
//
// Memory & lore retrieval service. Provides a unified query interface
// across lorebook entries and session summaries using local embeddings for
// semantic matching.
//
// This service:
//   1. Indexes lorebook entries (supplementing keyword_scanner.ts exact-match)
//   2. Indexes session summaries (making them queryable by topic)
//   3. Runs background indexing on campaign load without blocking boot
//
// Contract: C-458 In-House Memory & Lore Retrieval System

import {
  DEFAULT_MAX_RESULTS,
  MEMORY_QUERY_SCOPE_SOURCE_TYPES,
  NPC_RECALL_MAX_RESULTS,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  CommittedNarrativeEvent,
  MemoryIndexable,
  MemoryQuery,
  MemoryResult,
  MemoryRetrievalBackend,
  NpcMemoryRecallQuery,
} from '@aikami/types';
import { narrativeEventService } from '../game/narrative_event_service.svelte';
import { sessionSummaryService } from '../gm/session_summary_service.svelte.ts';
import { lorebookStore } from '../lorebook/lorebook_store.svelte.ts';
import { LocalEmbeddingBackend } from './local_embedding_backend';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Construction options for the memory retrieval service. */
export type MemoryRetrievalServiceOptions = BaseFrontendClassOptions;

/** Public reactive state and operations exposed by the memory retrieval service. */
export type MemoryRetrievalServiceInterface = BaseFrontendClassInterface & {
  /** Whether the retrieval backend is ready. */
  readonly isReady: boolean;

  /** Whether a background indexing pass is in progress. */
  readonly isIndexing: boolean;

  /** Whether semantic retrieval is enabled (settings toggle). */
  readonly enabled: boolean;

  /** Enable or disable semantic retrieval. */
  setEnabled(value: boolean): void;

  /**
   * Initialise the service. Must be called before query().
   * Loads the embedding model lazily on first use.
   */
  init(): Promise<void>;

  /**
   * Query the memory index with a natural-language query.
   * Returns ranked results from all indexed sources.
   *
   * Returns empty array (not error) when nothing is indexed yet.
   */
  query(q: MemoryQuery): Promise<MemoryResult[]>;

  /**
   * Witness-scoped NPC recall. Returns only narrative events the NPC
   * witnessed plus shared lore — never the player's private session summary
   * (C-492 trust boundary). Returns empty array when the NPC witnessed
   * nothing relevant or retrieval is disabled/not ready.
   */
  retrieveForNpc(query: NpcMemoryRecallQuery): Promise<MemoryResult[]>;

  /**
   * Index a single lorebook entry or batch of entries.
   * Idempotent — re-indexing the same entry replaces it.
   */
  indexLorebookEntries(entries: MemoryIndexable[]): Promise<void>;

  /**
   * Index the current session summary.
   * Idempotent — re-indexing the same session replaces it.
   */
  indexSessionSummary(summary: MemoryIndexable): Promise<void>;

  /**
   * Run a full indexing pass over all available data:
   * lorebook entries + session summaries.
   * Safe to call multiple times — idempotent.
   */
  indexAll(): Promise<void>;

  /**
   * Run background indexing on campaign load.
   * Must not block — returns immediately, indexing happens in background.
   */
  backgroundIndexOnLoad(): void;

  /**
   * Clear the entire retrieval index.
   */
  clearIndex(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Coordinates indexing and scoped lookup across campaign memory sources. */
class MemoryRetrievalService
  extends BaseFrontendClass<MemoryRetrievalServiceOptions>
  implements MemoryRetrievalServiceInterface
{
  private _backend: MemoryRetrievalBackend = LocalEmbeddingBackend.create();
  private _isIndexing = $state(false);
  private _isReady = $state(false);
  private _enabled = $state(true);
  private _initialised = false;

  get isReady(): boolean {
    return this._isReady;
  }

  get isIndexing(): boolean {
    return this._isIndexing;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
    this.debug('setEnabled', { value });
  }

  /** @inheritdoc */
  async init(): Promise<void> {
    if (this._initialised) {
      return;
    }
    this._initialised = true;

    // Keyword retrieval has no model to load (C-492 AC-1). Backend init marks
    // the index ready; a failure degrades to empty retrieval without breaking
    // boot.
    try {
      if (this._backend && 'init' in this._backend) {
        await (this._backend as LocalEmbeddingBackend).init();
      }
      this._isReady = true;
      this.debug('init:complete');
    } catch (err) {
      this._initialised = false;
      this.warn('init:failed', { error: String(err) });
      // Degrade gracefully — isReady stays false, query returns empty
    }
  }

  /** @inheritdoc */
  async query(q: MemoryQuery): Promise<MemoryResult[]> {
    if (!this._enabled || !this._isReady) {
      return [];
    }

    const scope = q.scope ?? 'all';
    const sourceTypes = MEMORY_QUERY_SCOPE_SOURCE_TYPES[scope];
    const indexResults = await this._backend.query({ ...q, scope });
    const results = indexResults.filter((result) =>
      sourceTypes.some((sourceType) => sourceType === result.sourceType),
    );

    // Sort by relevance score descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Apply limit
    const limit = q.limit ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, limit);
  }

  /** @inheritdoc */
  async retrieveForNpc(query: NpcMemoryRecallQuery): Promise<MemoryResult[]> {
    if (!this._enabled || !this._isReady) {
      return [];
    }

    const limit = query.limit ?? NPC_RECALL_MAX_RESULTS;

    // One witness authority: filter narrative-event results through
    // narrativeEventService.witnessedBy — never re-derive witness membership
    // from the raw event list (C-492 Architecture Directive).
    const witnessedIds = new Set(narrativeEventService.witnessedBy(query.npcId).map((e) => e.id));

    // Use the dedicated `npc` scope so session_summary never even reaches the
    // filter — the exclusion lives at the scope layer, not in a post-hoc drop.
    const indexResults = await this._backend.query({
      text: query.text,
      scope: 'npc',
      limit: 50,
    });

    const results: MemoryResult[] = [];
    let droppedUnwitnessed = 0;
    for (const result of indexResults) {
      if (result.sourceType === 'narrative_event' && !witnessedIds.has(result.sourceId)) {
        droppedUnwitnessed += 1;
        continue;
      }
      results.push(result);
    }

    if (droppedUnwitnessed > 0) {
      // Secret-leak attempts are visible without leaking content (C-492).
      this.info('retrieveForNpc:filtered-unwitnessed', {
        npcId: query.npcId,
        dropped: droppedUnwitnessed,
      });
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, limit);
  }

  /** @inheritdoc */
  async indexLorebookEntries(entries: MemoryIndexable[]): Promise<void> {
    if (!this._enabled || !this._isReady || entries.length === 0) {
      return;
    }
    await this._backend.index(entries);
  }

  /** @inheritdoc */
  async indexSessionSummary(summary: MemoryIndexable): Promise<void> {
    if (!this._enabled || !this._isReady) {
      return;
    }
    await this._backend.index([summary]);
  }

  /** @inheritdoc */
  async indexAll(): Promise<void> {
    if (!this._enabled || !this._isReady || this._isIndexing) {
      return;
    }

    this._isIndexing = true;
    this.debug('indexAll:start');

    try {
      const indexables: MemoryIndexable[] = [];

      // Collect committed narrative events (C-491) with attribution-aware
      // content so the prompt can distinguish knowledge from hearsay.
      for (const event of narrativeEventService.events) {
        indexables.push({
          sourceType: 'narrative_event',
          sourceId: event.id,
          content: _buildEventRecallContent(event),
          metadata: {
            kind: event.kind,
            informationKind: event.informationKind,
            claimantId: event.claimantId ?? '',
            campaignId: event.campaignId,
            sequence: String(event.sequence),
          },
        });
      }

      // Collect lorebook entries
      const lorebooks = lorebookStore.lorebooks;
      for (const lb of lorebooks) {
        for (const entry of (lb.entries ?? []) as Array<{
          id: string;
          content: string;
          keywords?: string[];
          name?: string;
        }>) {
          // Build a rich text representation that includes keywords for better matching
          const contentParts = [entry.content];
          if (entry.name) {
            contentParts.unshift(`[${entry.name}]`);
          }
          if (entry.keywords?.length) {
            contentParts.push(`Keywords: ${entry.keywords.join(', ')}`);
          }

          indexables.push({
            sourceType: 'lore',
            sourceId: entry.id,
            content: contentParts.join(' '),
            metadata: { lorebookId: lb.id },
          });
        }
      }

      // Collect session summary (if available)
      const summary = sessionSummaryService.currentSummary;
      if (summary) {
        const summaryText = [
          summary.synopsis,
          ...(summary.keyEvents ?? []),
          ...(summary.npcInteractions ?? []).map((npc) => `NPC ${npc.npcName}: ${npc.context}`),
        ].join(' ');

        indexables.push({
          sourceType: 'session_summary',
          sourceId: summary.id,
          content: summaryText,
          metadata: {
            createdAt: String(summary.createdAt),
          },
        });
      }

      if (indexables.length > 0) {
        await this._backend.index(indexables);
      }

      this.debug('indexAll:complete', {
        indexed: indexables.length,
        eventCount: narrativeEventService.events.length,
      });
    } catch (err) {
      this.error('indexAll:failed', { error: String(err) });
    } finally {
      this._isIndexing = false;
    }
  }

  /** @inheritdoc */
  backgroundIndexOnLoad(): void {
    // Fire-and-forget — does not block boot
    this.indexAll().catch((err) => {
      this.warn('backgroundIndexOnLoad:failed', { error: String(err) });
    });
  }

  /** @inheritdoc */
  async clearIndex(): Promise<void> {
    await this._backend.clear();
    this.debug('clearIndex');
  }
}

export { MemoryRetrievalService };

/**
 * Shared singleton instance of the memory retrieval service.
 */
export const memoryRetrievalService: MemoryRetrievalServiceInterface =
  MemoryRetrievalService.create({
    className: 'MemoryRetrievalService',
  }) as MemoryRetrievalServiceInterface;

/**
 * Builds recall content for a committed narrative event, carrying the
 * attribution so the prompt distinguishes knowledge from hearsay (C-492).
 * Belief/claim events are prefixed with who believes/claims so the model
 * never manufactures a modifier itself; world facts use the plain summary.
 */
const _buildEventRecallContent = (event: CommittedNarrativeEvent): string => {
  if (event.informationKind === 'character_belief') {
    return `[${event.claimantId ?? 'someone'} believes] ${event.summary}`;
  }
  if (event.informationKind === 'dialogue_claim') {
    return `[${event.claimantId ?? 'someone'} claims] ${event.summary}`;
  }
  return event.summary;
};
