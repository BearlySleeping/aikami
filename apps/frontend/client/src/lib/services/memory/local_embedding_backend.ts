// apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts
//
// Concrete MemoryRetrievalBackend using @huggingface/transformers with
// Xenova/all-MiniLM-L6-v2 for local, offline embedding generation and
// in-memory cosine-similarity search. The index is serializable for
// save/load via the campaign save system.
//
// Contract: C-458 In-House Memory & Lore Retrieval System

import type {
  InMemoryIndexEntry,
  MemoryIndexable,
  MemoryQuery,
  MemoryResult,
  MemoryRetrievalBackend,
  MemorySourceType,
} from '@aikami/types';
import { logger } from '$logger';

// Inline constants to avoid workspace dependency resolution issues in tests.
// These mirror the values in @aikami/constants/src/lib/memory.ts.
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MIN_SCORE = 0.25;
const EMBEDDING_DIMENSION = 384;
const LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmbeddingModel = {
  embed: (texts: string[]) => Promise<number[][]>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 */
const _cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

/**
 * Normalise a float32 array to unit length.
 */
const _normalise = (vec: number[]): number[] => {
  let sumSq = 0;
  for (const v of vec) {
    sumSq += v * v;
  }
  const mag = Math.sqrt(sumSq);
  return mag === 0 ? vec : vec.map((v) => v / mag);
};

// ---------------------------------------------------------------------------
// LocalEmbeddingBackend
// ---------------------------------------------------------------------------

/**
 * In-memory retrieval backend using local embeddings.
 *
 * - Embeds indexable content via @huggingface/transformers (all-MiniLM-L6-v2)
 * - Performs cosine-similarity search over in-memory vectors
 * - Index is serializable to/from a plain snapshot for save/load
 * - Fully offline — no network calls
 * - Degrades gracefully to empty results when index is empty
 */
export class LocalEmbeddingBackend implements MemoryRetrievalBackend {
  private _entries: InMemoryIndexEntry[] = [];
  private _model: EmbeddingModel | null = null;
  private _modelLoadPromise: Promise<EmbeddingModel> | null = null;
  private _initialised = false;

  /**
   * Create a new LocalEmbeddingBackend.
   * Model is loaded lazily on first embed call.
   */
  static create(): LocalEmbeddingBackend {
    return new LocalEmbeddingBackend();
  }

  /** Whether the backend is ready to index/query. */
  get isReady(): boolean {
    return this._initialised;
  }

  /**
   * Initialise the backend. Loads the embedding model.
   * Safe to call multiple times — returns the same promise.
   */
  async init(): Promise<void> {
    if (this._modelLoadPromise) {
      await this._modelLoadPromise;
      return;
    }

    this._modelLoadPromise = this._loadModel();
    try {
      await this._modelLoadPromise;
      this._initialised = true;
      logger.debug('LocalEmbeddingBackend:initialised', { dimension: EMBEDDING_DIMENSION });
    } catch (err) {
      this._modelLoadPromise = null; // Allow retry on failure
      logger.error('LocalEmbeddingBackend:init-failed', { error: String(err) });
      throw err;
    }
  }

  /** @inheritdoc */
  async index(entries: MemoryIndexable[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this._ensureModel();

    // Extract texts to embed
    const texts = entries.map((e) => e.content);
    const embeddings = await this._model.embed(texts);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const embedding = _normalise(embeddings[i]);

      // Remove existing entry with same sourceType + sourceId (idempotent)
      const existingIdx = this._entries.findIndex(
        (e) => e.sourceType === entry.sourceType && e.sourceId === entry.sourceId,
      );
      if (existingIdx >= 0) {
        this._entries[existingIdx] = {
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          content: entry.content,
          embedding,
          metadata: entry.metadata,
        };
      } else {
        this._entries.push({
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          content: entry.content,
          embedding,
          metadata: entry.metadata,
        });
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

    const hasPrecomputedEmbeddings =
      this._entries.length > 0 && this._entries[0].embedding.length > 0;

    if (!hasPrecomputedEmbeddings) {
      await this._ensureModel();
    }

    if (hasPrecomputedEmbeddings) {
      // With pre-computed embeddings, use keyword overlap scoring
      const queryWords = q.text.toLowerCase().split(/\W+/).filter(Boolean);
      const results: MemoryResult[] = [];
      const scope = q.scope ?? 'all';
      const candidates =
        scope === 'all' ? this._entries : this._entries.filter((e) => e.sourceType === scope);

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

    const rawQueryVec = (await this._model.embed([q.text]))[0];
    const normalisedQuery = _normalise(rawQueryVec);

    // Filter by scope
    const scope = q.scope ?? 'all';
    const candidates =
      scope === 'all' ? this._entries : this._entries.filter((e) => e.sourceType === scope);

    // Score and rank
    const scored: Array<{ entry: InMemoryIndexEntry; score: number }> = [];
    for (const entry of candidates) {
      const score = _cosineSimilarity(normalisedQuery, entry.embedding);
      if (score >= DEFAULT_MIN_SCORE) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // Apply limit
    const limit = q.limit ?? DEFAULT_MAX_RESULTS;
    const top = scored.slice(0, limit);

    logger.debug('LocalEmbeddingBackend:query', {
      queryLength: q.text.length,
      candidates: candidates.length,
      results: top.length,
    });

    return top.map((r) => ({
      sourceType: r.entry.sourceType,
      sourceId: r.entry.sourceId,
      content: r.entry.content,
      relevanceScore: r.score,
      metadata: r.entry.metadata,
    }));
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
   * Export the current index as a plain snapshot for save/load.
   */
  toSnapshot(): { entries: InMemoryIndexEntry[] } {
    return { entries: this._entries };
  }

  /**
   * Restore the index from a previously exported snapshot.
   * Does NOT require the model — queries still need it.
   */
  loadSnapshot(snapshot: { entries: InMemoryIndexEntry[] }): void {
    this._entries = snapshot.entries;
    this._initialised = true;
    logger.debug('LocalEmbeddingBackend:snapshot-loaded', { count: this._entries.length });
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async _loadModel(): Promise<EmbeddingModel> {
    // Dynamic import: @huggingface/transformers is ~2MB+ and should not
    // block boot — it is loaded lazily on first indexing/query.
    const { pipeline } = await import('@huggingface/transformers');

    const pipe = await pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL, {
      quantized: true,
    });

    logger.debug('LocalEmbeddingBackend:model-loaded', { model: LOCAL_EMBEDDING_MODEL });

    return {
      embed: async (texts: string[]): Promise<number[][]> => {
        const results: number[][] = [];
        for (const text of texts) {
          const output = await pipe(text, {
            pooling: 'mean',
            normalize: true,
          });
          // Extract the embedding vector from the output tensor
          const data = output.data as Float32Array;
          // Only take the first EMBEDDING_DIMENSION values
          const vec = Array.from(data.slice(0, EMBEDDING_DIMENSION));
          results.push(vec);
        }
        return results;
      },
    };
  }

  private async _ensureModel(): Promise<void> {
    if (!this._model) {
      this._model = await this._loadModel();
      this._initialised = true;
    }
  }
}
