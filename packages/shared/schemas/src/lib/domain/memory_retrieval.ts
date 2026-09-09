// packages/shared/schemas/src/lib/domain/memory_retrieval.ts
//
// TypeBox schemas for the in-house memory/lore retrieval system.
// These define the query/result contract between the retrieval service
// and its consumers (notably C-457's prompt assembler).
//
// Contract: C-458 In-House Memory & Lore Retrieval System

import { Type } from 'typebox';

// ---------------------------------------------------------------------------
// MemoryQuery — a natural-language query into the retrieval index
// ---------------------------------------------------------------------------

export const MemoryQuerySchema = Type.Object({
  /** Natural-language query, e.g. current player message or scene context. */
  text: Type.String({ minLength: 1, description: 'Query text' }),
  /** Scope filter — which source types to search. Defaults to "all". */
  scope: Type.Optional(
    Type.Union([Type.Literal('lore'), Type.Literal('history'), Type.Literal('all')]),
  ),
  /** Maximum number of results to return. Defaults to 10. */
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

// ---------------------------------------------------------------------------
// MemoryResult — a single ranked retrieval result
// ---------------------------------------------------------------------------

export const MemoryResultSchema = Type.Object({
  /** Which source type produced this result. */
  sourceType: Type.Union([
    Type.Literal('lore'),
    Type.Literal('session_summary'),
    Type.Literal('relationship'),
    Type.Literal('faction'),
  ]),
  /** ID of the source entry (entry ID, session ID, character ID, faction ID). */
  sourceId: Type.String({ description: 'Source entry identifier' }),
  /** The retrievable text content. */
  content: Type.String({ description: 'Retrievable text content' }),
  /** Relevance score 0..1 (cosine similarity). */
  relevanceScore: Type.Number({ minimum: 0, maximum: 1 }),
  /** Optional metadata keyed by category (e.g. characterId, factionId, sessionId). */
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
});

// ---------------------------------------------------------------------------
// MemoryIndexable — a single entry to be indexed
// ---------------------------------------------------------------------------

export const MemoryIndexableSchema = Type.Object({
  /** Source type this entry belongs to. */
  sourceType: Type.Union([
    Type.Literal('lore'),
    Type.Literal('session_summary'),
    Type.Literal('relationship'),
    Type.Literal('faction'),
  ]),
  /** Unique identifier within the source type. */
  sourceId: Type.String({ minLength: 1 }),
  /** Text content to embed and index. */
  content: Type.String({ minLength: 1 }),
  /** Optional metadata for filtering at query time. */
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
});

// ---------------------------------------------------------------------------
// InMemoryIndexEntry — persisted shape of an indexed entry with its vector
// ---------------------------------------------------------------------------

export const InMemoryIndexEntrySchema = Type.Object({
  sourceType: Type.Union([
    Type.Literal('lore'),
    Type.Literal('session_summary'),
    Type.Literal('relationship'),
    Type.Literal('faction'),
  ]),
  sourceId: Type.String(),
  content: Type.String(),
  /** Float32Array serialized as number[] for JSON persistence. */
  embedding: Type.Array(Type.Number()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
});

// ---------------------------------------------------------------------------
// IndexSnapshot — the full index state for save/load serialization
// ---------------------------------------------------------------------------

export const IndexSnapshotSchema = Type.Object({
  entries: Type.Array(InMemoryIndexEntrySchema),
  /** ISO timestamp of last indexing operation. */
  lastIndexedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

// ---------------------------------------------------------------------------
// Feature flag / settings
// ---------------------------------------------------------------------------

export const MemoryRetrievalSettingsSchema = Type.Object({
  /** Master toggle — disable retrieval without redeploy. */
  enabled: Type.Boolean({ default: true }),
  /** Whether to run background indexing on campaign load. */
  autoIndex: Type.Boolean({ default: true }),
  /** Maximum results returned per query. */
  maxResults: Type.Integer({ minimum: 1, maximum: 50, default: 10 }),
});
