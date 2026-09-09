// apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts
//
// Concrete MemoryRetrievalBackend using deterministic keyword-overlap scoring.
//
// Retrieval here is KEYWORD-BASED, not semantic: entries are scored by the
// fraction of query words that appear (case-insensitive, word-boundary
// tokenisation), and results are ranked by that overlap ratio. There is no
// embedding model, no @huggingface/transformers import, no cosine similarity,
// and no ONNX runtime — the index is a rebuildable projection over bounded
// content that is cheap to rebuild on every boot.
//
// Why keyword retrieval (C-492 AC-1)? The semantic/cosine path that preceded
// this was inverted (the indexed case took the keyword branch, the model load
// happened only when embeddings were absent), never ran in a production boot,
// and dragged in a 2MB+ ONNX dependency the boot never loaded. Keyword
// retrieval is deterministic, fully offline, and testable in Bun's runtime —
// sufficient at the content scale of a five-character village (C-458 AC-1's
// semantic ambition is superseded for that scale).
//
// The index is ephemeral. It is NOT registered with serializable_service and
// is never persisted into a save; it is rebuilt on load from its authoritative
// sources (lore, session summaries, C-491 committed narrative events).
//
// Contract: C-458 In-House Memory & Lore Retrieval System (C-492 resolves the
// retrieval fork toward keyword retrieval)
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  MEMORY_QUERY_SCOPE_SOURCE_TYPES,
} from '@aikami/constants';
import type {
  InMemoryIndexEntry,
  MemoryIndexable,
  MemoryQuery,
  MemoryResult,
  MemoryRetrievalBackend,
  MemorySourceType,
} from '@aikami/types';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// LocalEmbeddingBackend
// ---------------------------------------------------------------------------

/**
 * In-memory retrieval backend using deterministic keyword-overlap scoring.
 *
 * - Indexes content verbatim (no embeddings are computed or stored)
 * - Scores by the fraction of query words found in each entry's content
 * - Index is a rebuildable projection — never persisted into a save
 * - Fully offline and model-free — no network calls, no ONNX startup
 * - `isReady` means "index initialised", not "model loaded"
 */
export class LocalEmbeddingBackend implements MemoryRetrievalBackend {
  private _entries: InMemoryIndexEntry[] = [];
  private _initialised = false;

  /**
   * Create a new LocalEmbeddingBackend. No model is loaded.
   */
  static create(): LocalEmbeddingBackend {
    return new LocalEmbeddingBackend();
  }

  /** Whether the backend is ready to index/query (index initialised). */
  get isReady(): boolean {
    return this._initialised;
  }

  /**
   * Initialise the backend. With keyword retrieval this is a no-op that marks
   * the index ready — there is no model to load. Safe to call multiple times.
   */
  async init(): Promise<void> {
    this._initialised = true;
    logger.debug('LocalEmbeddingBackend:initialised', { mode: 'keyword' });
  }

  /** @inheritdoc */
  async index(entries: MemoryIndexable[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      const indexed: InMemoryIndexEntry = {
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        content: entry.content,
        metadata: entry.metadata,
      };

      // Remove existing entry with same sourceType + sourceId (idempotent)
      const existingIdx = this._entries.findIndex(
        (e) => e.sourceType === entry.sourceType && e.sourceId === entry.sourceId,
      );
      if (existingIdx >= 0) {
        this._entries[existingIdx] = indexed;
      } else {
        this._entries.push(indexed);
      }
    }

    logger.debug('LocalEmbeddingBackend:indexed', {
      count: entries.length,
      total: this._entries.length,
    });
  }

  /** @inheritdoc */
  async query(q: MemoryQuery): Promise<MemoryResult[]> {
    if (this._entries.length === 0) {
      return [];
    }

    // Keyword-overlap scoring is the ONLY path (C-492 AC-1). No model load.
    const queryWords = q.text.toLowerCase().split(/\W+/).filter(Boolean);
    const results: MemoryResult[] = [];
    const scope = q.scope ?? 'all';
    const sourceTypes = MEMORY_QUERY_SCOPE_SOURCE_TYPES[scope];
    const candidates = this._entries.filter((entry) =>
      sourceTypes.some((sourceType) => sourceType === entry.sourceType),
    );

    for (const entry of candidates) {
      const entryWords = entry.content.toLowerCase().split(/\W+/).filter(Boolean);
      const matched = queryWords.filter((w) => entryWords.includes(w)).length;
      const score = queryWords.length > 0 ? matched / queryWords.length : 0;
      if (score >= DEFAULT_MIN_SCORE) {
        results.push({
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          content: entry.content,
          relevanceScore: score,
          metadata: entry.metadata,
        });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const limit = q.limit ?? DEFAULT_MAX_RESULTS;
    return results.slice(0, limit);
  }

  /** @inheritdoc */
  async remove(options: { sourceType: MemorySourceType; sourceId: string }): Promise<void> {
    const { sourceType, sourceId } = options;
    const before = this._entries.length;
    this._entries = this._entries.filter(
      (e) => !(e.sourceType === sourceType && e.sourceId === sourceId),
    );
    if (this._entries.length < before) {
      logger.debug('LocalEmbeddingBackend:removed', { sourceType, sourceId });
    }
  }

  /** @inheritdoc */
  async clear(): Promise<void> {
    this._entries = [];
    logger.debug('LocalEmbeddingBackend:cleared');
  }

  /** @inheritdoc */
  async size(): Promise<number> {
    return this._entries.length;
  }

  // ── Serialisation ────────────────────────────────────────────────────

  /**
   * Export the current index as a plain snapshot. NOTE: the index is a
   * rebuildable projection and is NOT persisted into saves — this exists for
   * tests and in-memory inspection only.
   */
  toSnapshot(): { entries: InMemoryIndexEntry[] } {
    return { entries: this._entries };
  }

  /**
   * Restore the index from a previously exported snapshot. No model is needed
   * — queries are keyword-based.
   */
  loadSnapshot(snapshot: { entries: InMemoryIndexEntry[] }): void {
    this._entries = snapshot.entries;
    this._initialised = true;
    logger.debug('LocalEmbeddingBackend:snapshot-loaded', { count: this._entries.length });
  }
}
