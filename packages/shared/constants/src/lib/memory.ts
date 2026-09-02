// packages/shared/constants/src/lib/memory.ts
//
// Constants for the in-house memory/lore retrieval system.
//
// Contract: C-458 In-House Memory & Lore Retrieval System

/** Default maximum results per retrieval query. */
export const DEFAULT_MAX_RESULTS = 10;

/** Minimum confidence threshold for returning a retrieval result (0..1). */
export const DEFAULT_MIN_SCORE = 0.25;

/** Maximum entries in the retrieval index before prioritization kicks in. */
export const MAX_INDEX_ENTRIES = 500;

/** Soft warning threshold for index size (entries). */
export const INDEX_SIZE_WARN = 250;

/** Embedding dimension for all-MiniLM-L6-v2. */
export const EMBEDDING_DIMENSION = 384;

/** HuggingFace model ID for local embedding generation. */
export const LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
