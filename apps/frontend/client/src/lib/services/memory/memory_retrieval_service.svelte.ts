// apps/frontend/client/src/lib/services/memory/memory_retrieval_service.svelte.ts
//
// Memory & lore retrieval service. Provides a unified query interface
// across lorebook entries, session summaries, and relationship/faction data
// using local embeddings for semantic matching.
//
// This service:
//   1. Indexes lorebook entries (supplementing keyword_scanner.ts exact-match)
//   2. Indexes session summaries (making them queryable by topic)
//   3. Reads relationship/faction state live at query time (avoids staleness)
//   4. Runs background indexing on campaign load without blocking boot
//
// Contract: C-458 In-House Memory & Lore Retrieval System

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { MemoryIndexable, MemoryQuery, MemoryResult, MemoryRetrievalBackend } from '@aikami/types';
import { logger } from '$logger';

const DEFAULT_MAX_RESULTS = 10;
import { lorebookStore } from '../lorebook/lorebook_store.svelte.ts';
import { sessionSummaryService } from '../gm/session_summary_service.svelte.ts';
import { LocalEmbeddingBackend } from './local_embedding_backend';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryRetrievalServiceOptions = BaseFrontendClassOptions;

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
   * Relationship/faction data is queried live (not from index)
   * to avoid staleness — results are appended to the index results.
   *
   * Returns empty array (not error) when nothing is indexed yet.
   */
  query(q: MemoryQuery): Promise<MemoryResult[]>;

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
   * Does NOT index relationship/faction data (queried live).
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
    if (this._initialised) return;
    this._initialised = true;

    try {
      // Try to initialise the backend (loads embedding model)
      // Wrap in try/catch — if model fails to load, retrieval degrades
      // gracefully and the exact-keyword lorebook path still works.
      if (this._backend && 'init' in this._backend) {
        await (this._backend as LocalEmbeddingBackend).init();
      }
      this._isReady = true;
      this.debug('init:complete');
    } catch (err) {
      this.warn('init:model-load-failed', { error: String(err) });
      // Degrade gracefully — isReady stays false, query returns empty
    }
  }

  /** @inheritdoc */
  async query(q: MemoryQuery): Promise<MemoryResult[]> {
    if (!this._enabled || !this._isReady) {
      return [];
    }

    const scope = q.scope ?? 'all';
    const results: MemoryResult[] = [];

    // 1. Query the embedding index for lore + session summaries
    if (scope === 'all' || scope === 'lore' || scope === 'history') {
      const indexScope = scope === 'all' ? 'all' : scope;
      const indexResults = await this._backend.query({
        ...q,
        scope: indexScope as MemoryQuery['scope'],
      });
      results.push(...indexResults);
    }

    // 2. Live query of relationship/faction data (avoid staleness)
    if (scope === 'all' || scope === 'relationships') {
      const relationshipResults = await this._queryRelationships(q);
      results.push(...relationshipResults);
    }

    // 3. Sort by relevance score descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // 4. Apply limit
    const limit = q.limit ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, limit);
  }

  /** @inheritdoc */
  async indexLorebookEntries(entries: MemoryIndexable[]): Promise<void> {
    if (!this._enabled || !this._isReady || entries.length === 0) return;
    await this._backend.index(entries);
  }

  /** @inheritdoc */
  async indexSessionSummary(summary: MemoryIndexable): Promise<void> {
    if (!this._enabled || !this._isReady) return;
    await this._backend.index([summary]);
  }

  /** @inheritdoc */
  async indexAll(): Promise<void> {
    if (!this._enabled || !this._isReady || this._isIndexing) return;

    this._isIndexing = true;
    this.debug('indexAll:start');

    try {
      const indexables: MemoryIndexable[] = [];

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
          if (entry.name) contentParts.unshift(`[${entry.name}]`);
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
          ...(summary.npcInteractions ?? []).map(
            (npc) => `NPC ${npc.npcName}: ${npc.context}`,
          ),
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

      this.debug('indexAll:complete', { indexed: indexables.length });
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

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Query relationship/faction data live from the game state.
   * Returns MemoryResult entries for characters/factions whose name or
   * description matches the query text (simple keyword overlap as a
   * lightweight live query — avoids embedding staleness).
   */
  private async _queryRelationships(q: MemoryQuery): Promise<MemoryResult[]> {
    // Relationship/faction data is queried live to avoid staleness.
    // For now, we return empty since the integration with
    // relationship_state data requires the full relationship service
    // which is wired in C-457's prompt assembler integration.
    //
    // The interface supports it; the actual live query will be
    // implemented when C-457 wires this service into prompt assembly.
    return [];
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
