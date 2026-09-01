// packages/shared/constants/src/lib/config.ts
//
// Configuration constants — memory types, embedding models, emotion methods.

// ---------------------------------------------------------------------------
// Memory types
// ---------------------------------------------------------------------------

/** Memory subsystem type identifiers. */
export const MEMORY_TYPES = ['none', 'basic', 'hypa-style', 'hanurai'] as const;

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

/** Embedding model providers. */
export const EMBEDDING_MODELS = [
  { id: 'minilm', label: 'MiniLM (local)' },
  { id: 'nomic', label: 'Nomic Embed' },
  { id: 'bge', label: 'BGE (BAAI)' },
  { id: 'openai', label: 'OpenAI Embeddings' },
  { id: 'voyage', label: 'Voyage AI' },
  { id: 'custom', label: 'Custom API' },
] as const;

// ---------------------------------------------------------------------------
// Emotion methods
// ---------------------------------------------------------------------------

/** Emotion resolution methods. */
export const EMOTION_METHODS = ['submodel', 'embedding'] as const;
