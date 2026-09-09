// packages/shared/types/src/lib/domain/memory_retrieval.ts
//
// TypeScript types for the in-house memory/lore retrieval system.
// Types are derived from TypeBox schemas in @aikami/schemas wherever possible.
//
// Contract: C-458 In-House Memory & Lore Retrieval System

import type {
  IndexSnapshotSchema,
  InMemoryIndexEntrySchema,
  MemoryIndexableSchema,
  MemoryQuerySchema,
  MemoryResultSchema,
  MemoryRetrievalSettingsSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

// ---------------------------------------------------------------------------
// Derived types (lockstep with schemas)
// ---------------------------------------------------------------------------

/** Natural-language lookup and optional source scope for memory retrieval. */
export type MemoryQuery = Static<typeof MemoryQuerySchema>;
/** Ranked content returned from a memory retrieval query. */
export type MemoryResult = Static<typeof MemoryResultSchema>;
/** Source content accepted by a memory retrieval backend for indexing. */
export type MemoryIndexable = Static<typeof MemoryIndexableSchema>;
/** Serializable indexed content paired with its embedding vector. */
export type InMemoryIndexEntry = Static<typeof InMemoryIndexEntrySchema>;
/** Serializable snapshot of the complete in-memory retrieval index. */
export type IndexSnapshot = Static<typeof IndexSnapshotSchema>;
/** User-configurable settings for memory retrieval and background indexing. */
export type MemoryRetrievalSettings = Static<typeof MemoryRetrievalSettingsSchema>;

// ---------------------------------------------------------------------------
// MemoryRetrievalBackend — the pluggable retrieval interface
// ---------------------------------------------------------------------------

/**
 * Pluggable backend for the memory/lore retrieval system.
 *
 * One concrete implementation (LocalEmbeddingBackend) is provided; a third-party
 * or user-swappable backend can be added by implementing this interface.
 *
 * All methods must work fully offline — no cloud dependencies.
 */
export type MemoryRetrievalBackend = {
  /**
   * Index one or more entries, computing and storing their embeddings.
   * Must be idempotent — re-indexing the same sourceId replaces the old entry.
   */
  index(entries: MemoryIndexable[]): Promise<void>;

  /**
   * Query the index with a natural-language query string.
   * Returns ranked results sorted by relevance (highest first).
   * Returns empty array (not error) when the index is empty.
   */
  query(q: MemoryQuery): Promise<MemoryResult[]>;

  /**
   * Remove an entry from the index by sourceType + sourceId.
   * No-op if the entry doesn't exist.
   */
  remove(options: { sourceType: MemoryIndexable['sourceType']; sourceId: string }): Promise<void>;

  /**
   * Clear the entire index.
   */
  clear(): Promise<void>;

  /**
   * Returns the number of entries currently indexed.
   */
  size(): Promise<number>;
};

// ---------------------------------------------------------------------------
// Source types that can be indexed
// ---------------------------------------------------------------------------

/** Source categories accepted by memory retrieval backends. */
export type MemorySourceType = MemoryIndexable['sourceType'];

// ---------------------------------------------------------------------------
// Query scope
// ---------------------------------------------------------------------------

/** Public source groupings available to memory retrieval queries. */
export type MemoryQueryScope = NonNullable<MemoryQuery['scope']>;
